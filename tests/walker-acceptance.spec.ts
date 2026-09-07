import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";


const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const log = (msg: string) => console.log(`[${new Date().toISOString()}] [walker-acceptance] ${msg}`);

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

async function provisionWalker(runId: string) {
  const email = `e2e.walker.${runId}@e2e.vaipet.invalid`;
  const password = "Pass!" + Math.random().toString(36).slice(2, 10);
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: "Walker E2E", signup_intent: "petwalker", e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw error;
  const id = data.user!.id;
  await admin.from("profiles").upsert({ id, full_name: "Walker E2E", onboarding_completed: true, phone: "(11) 98888-8888", age: 25 });
  await admin.from("user_roles").upsert({ user_id: id, role: "petwalker" });
  await admin.from("petwalker_profiles").upsert({
    user_id: id, approval_status: "approved", profile_completed: true, availability_status: "available",
    is_accepting_requests: true, price_30_minutes: 2000, experience_years: 2, service_radius_km: 10,
    last_known_location: `SRID=4326;POINT(-46.7 -23.6)`
  });
  return { id, email, password };
}

async function createOwnerAndRequest(runId: string) {
  const email = `e2e.owner.${runId}@e2e.vaipet.invalid`;
  const { data } = await admin.auth.admin.createUser({ email, password: "Pass!", email_confirm: true, user_metadata: { e2e_test: true, e2e_run_id: runId } });
  const ownerId = data.user!.id;
  await admin.from("profiles").upsert({ id: ownerId, onboarding_completed: true, phone: "(11) 97777-7777", age: 28 });
  const { data: pet } = await admin.from("pets").insert({ owner_id: ownerId, name: "DiagPet", breed: "SRD", is_active: true }).select().single();
  const { data: session } = await admin.from("walk_sessions").insert({
    customer_id: ownerId, pet_id: pet.id, current_status: "searching",
    walk_type: "individual", planned_duration_minutes: 30, request_mode: "now",
    start_time: new Date().toISOString(), meeting_point_geom: `SRID=4326;POINT(-46.7 -23.6)`
  }).select().single();
  return { ownerId, sessionId: session.id };
}

async function quickCleanup(ids: string[], runId?: string) {
  await failClosedCleanup(admin, ids, runId);
}


test("walker-acceptance: ACEITE ISOLADO", async ({ browser }) => {
  const runId = `acc_${Date.now()}`;
  const walker = await provisionWalker(runId);
  const { ownerId, sessionId } = await createOwnerAndRequest(runId);
  const startTime = Date.now();
  
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: { longitude: -46.7, latitude: -23.6 },
  });
  const page = await context.newPage();

  let rpcResponse: any = null;
  page.on('response', async (response) => {
    if (response.url().includes('rpc/accept_walk_request')) {
      try {
        rpcResponse = {
          status: response.status(),
          body: await response.json(),
        };
        log(`RPC_RESPONSE: ${JSON.stringify(rpcResponse)}`);
      } catch (e) {}
    }
  });

  try {
    await admin.from("walk_offers").insert({ session_id: sessionId, walker_id: walker.id, offer_status: "pending" });

    log(`session_id: ${sessionId}`);
    log(`walker_id_esperado: ${walker.id}`);

    log("1. Autenticando PetWalker...");
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(walker.email);
    await page.getByPlaceholder("Senha").fill(walker.password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();
    await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 25000 });

    log("2. Navegando para /petwalker...");
    await page.goto("/petwalker");
    
    log("3. Visualizando oferta...");
    const acceptBtn = page.locator('[data-testid="walker-accept-button"]');
    
    await expect.poll(async () => {
        if (await acceptBtn.isVisible()) return true;
        const onlineBtn = page.getByRole('button', { name: /Ficar Online/i });
        if (await onlineBtn.isVisible()) {
            log("Ficando Online...");
            await onlineBtn.click().catch(() => {});
            await page.waitForTimeout(2000);
        }
        return await acceptBtn.isVisible();
    }, { timeout: 45000 }).toBeTruthy();
    
    const { data: statusAntes } = await admin.from("walk_sessions").select("current_status").eq("id", sessionId).single();
    log(`status_antes: ${statusAntes?.current_status}`);
    log(`url_antes: ${page.url()}`);

    log("4. Aceitando passeio...");
    await acceptBtn.click();
    
    log("5. Validando banco...");
    await expect.poll(async () => {
      const { data, error } = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", sessionId).single();
      if (error) {
          log(`Erro ao consultar banco: ${error.message}`);
          return false;
      }
      const ok = data?.current_status === "accepted" && data?.walker_id === walker.id;
      if (!ok) log(`Status atual: ${data?.current_status}, Walker: ${data?.walker_id}`);
      return ok;
    }, { timeout: 30000, message: "Aguardando aceite no banco" }).toBeTruthy();
    
    const { data: finalSession } = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", sessionId).single();
    log(`status_depois: ${finalSession?.current_status}`);
    log(`walker_id_gravado: ${finalSession?.walker_id}`);

    expect(finalSession?.walker_id).toBe(walker.id);
    expect(statusAntes?.current_status).toBe("searching");
    expect(finalSession?.current_status).toBe("accepted");

    log("6. Clicando no ActiveWalkSheet para navegar...");
    const manageBtn = page.getByRole('button', { name: /Iniciar deslocamento|Gerenciar Passeio/i });
    await expect(manageBtn).toBeVisible({ timeout: 15000 });
    await manageBtn.click();

    log("7. Validando navegação final...");
    await expect(page).toHaveURL(/\/petwalker\/passeio\/.*/, { timeout: 20000 });
    log(`url_depois: ${page.url()}`);
    
    log(`Duração: ${(Date.now() - startTime) / 1000}s`);
    log("walker-acceptance: PASS");
  } finally {
    await context.close();
    await quickCleanup([walker.id, ownerId]);
    log("Cleanup concluído.");
  }
});
