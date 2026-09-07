import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test("auth-persistence: verify session survives reload", async ({ browser }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const email = `e2e.persistence.${Date.now()}@e2e.vaipet.invalid`;
  const password = "TestPassword123!";
  const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
  const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
  
  const { data: { user }, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { onboarding_completed: true }
  });
  if (createError) throw createError;
  
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const page = await context.newPage();
    
    // 1. Login
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(email);
    await page.getByPlaceholder("Senha").fill(password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();
    
    // Wait for redirect to /inicio
    await expect(page).toHaveURL(/.*\/inicio.*/, { timeout: 30000 });
    console.log("Logged in successfully");

    // 2. Check localStorage
    const storage = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    if (!storage) throw new Error("Storage is empty after login");
    console.log("LocalStorage token present");

    // 3. Reload and check if still logged in
    await page.reload();
    await expect(page).toHaveURL(/.*\/inicio.*/, { timeout: 10000 });
    console.log("Session persisted after reload");

  } finally {
    if (user) await admin.auth.admin.deleteUser(user.id);
  }
});
