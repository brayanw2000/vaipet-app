import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

test("Debug matching flow", async ({ browser }) => {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });
  
  // Provision
  const runId = `debug_${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e.owner.${runId}@e2e.vaipet.invalid`;
  const password = "Pass123!debug";
  
  const { data: userData } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { signup_intent: "pet_owner", e2e_test: true }
  });
  const userId = userData.user!.id;
  await admin.from("profiles").upsert({ id: userId, onboarding_completed: true });
  const { data: pet } = await admin.from("pets").insert({ owner_id: userId, name: "DebugDog", breed: "SRD", is_active: true }).select("id").single();
  
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: signed } = await client.auth.signInWithPassword({ email, password });
  
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();
  
  await page.goto("/");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(signed.session)]);
  await page.goto("/inicio");
  
  console.log("URL:", page.url());
  await page.screenshot({ path: "/tmp/debug_inicio.png" });
  
  const searchBtn = page.locator('button:has-text("Buscar passeio")');
  if (await searchBtn.isVisible()) {
    console.log("Clicking search button");
    await searchBtn.click();
    await page.waitForURL(/\/search-walk/);
    console.log("New URL:", page.url());
    await page.screenshot({ path: "/tmp/debug_search_walk.png" });
    
    // Check pet card
    const petCard = page.locator(`[data-testid="pet-card-${pet!.id}"]`);
    const count = await petCard.count();
    console.log("Pet cards found:", count);
    if (count === 0) {
      console.log("Body HTML:", await page.content());
    }
  } else {
    console.log("Search button NOT found");
    console.log("Body HTML:", await page.content());
  }
  
  await admin.auth.admin.deleteUser(userId);
  await context.close();
});
