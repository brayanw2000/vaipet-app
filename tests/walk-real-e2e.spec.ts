import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

 
 /**
  * E2E OPERACIONAL REAL — Fase 3.1 (Instrumentação Fail-Fast PetWalker)
  */
 
 test.setTimeout(240000); 

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const log = (msg: string) => console.log(`[${new Date().toISOString()}] [e2e] ${msg}`);

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await preflightCleanup();
});

async function preflightCleanup() {
  log("1. preflightCleanup iniciado");
  let page = 1;
  const perPage = 100;
  const ttlMs = 3600_000;
  const cutoff = new Date(Date.now() - ttlMs).toISOString();

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    if (users.length === 0) break;

    const targets = users.filter(u => 
      u.email?.endsWith("@e2e.vaipet.invalid") && 
      u.user_metadata?.e2e_test === true &&
      u.created_at < cutoff
    );

    if (targets.length > 0) {
      await quickCleanup(targets.map(u => u.id));
    }
    if (users.length < perPage) break;
    page++;
  }
  log("1. preflightCleanup concluído");
}

async function quickCleanup(ids: string[], runId?: string) {
  await failClosedCleanup(admin, ids, runId);
}


async function provisionUser(runId: string, kind: "pet_owner" | "petwalker") {
  const email = `e2e.${kind}.${runId}.${Math.random().toString(36).slice(2, 6)}@e2e.vaipet.invalid`;
  const password = `Pass!${Math.random().toString(36).slice(2, 10)}`;
  
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `E2E ${kind}`, signup_intent: kind, e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw error;
  const id = data.user!.id;
  
  await admin.from("profiles").upsert({ id, full_name: `E2E ${kind}`, onboarding_completed: true, phone: "(11) 96666-6666", age: 32 });
  
  if (kind === "petwalker") {
    await admin.from("user_roles").insert({ user_id: id, role: "petwalker" });
    await admin.from("petwalker_profiles").upsert({
      user_id: id, approval_status: "approved", profile_completed: true, availability_status: "available",
      is_accepting_requests: true, price_30_minutes: 2250, experience_years: 2, service_radius_km: 10,
      last_known_location: `SRID=4326;POINT(-46.7009 -23.6004)`
    });
  }
  return { id, email, password };
}

async function createAuthedContext(browser: any, credentials: { email: string; password: string; id: string }, coords: { lng: number; lat: number }) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: { longitude: coords.lng, latitude: coords.lat },
    locale: "pt-BR",
  });
  const page = await context.newPage();
  await page.goto("/auth");
  await page.getByPlaceholder("E-mail").fill(credentials.email);
  await page.getByPlaceholder("Senha").fill(credentials.password);
  await page.getByRole("button", { name: /^Entrar$/i }).click();
  await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 45000 });
  
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const storageState = await context.storageState();
  const token = storageState.origins.find(o => o.origin.includes("localhost"))?.localStorage.find(i => i.name === STORAGE_KEY);
  if (token) {
    const session = JSON.parse(token.value);
    await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  }
  return { context, page, client };
}

test.describe.configure({ mode: "serial", retries: 0 });

test("matching: Ciclo real de oferta via job e aceite via UI", async ({ browser }) => {
  const runId = `match_${Date.now()}`;
  const petName = `PetMatch`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let oCtx: any, wCtx: any;
  let sessId: string;

  log(`owner_id: ${ownerCreds.id}`);
  log(`walker_id_esperado: ${walkerCreds.id}`);

  try {
    await test.step("0. preflight: pet no banco", async () => {
      const { error } = await admin.from("pets").insert({ owner_id: ownerCreds.id, name: petName, breed: "SRD", is_active: true });
      if (error) throw error;
      log("0. Pet criado no banco");
    });

    await test.step("1. auth: paralelo", async () => {
      [oCtx, wCtx] = await Promise.all([
        createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 }),
        createAuthedContext(browser, walkerCreds, { lng: -46.7001, lat: -23.6001 })
      ]);
    });

    await test.step("2. owner: start-walk-visible", async () => {
      await expect(oCtx.page).toHaveURL(/.*\/inicio.*/, { timeout: 10000 });
      const startWalkBtn = oCtx.page.locator('#tour-start-walk');
      await expect(startWalkBtn).toBeVisible({ timeout: 10000 });
    });

    await test.step("3. owner: bottom-sheet-open", async () => {
      await oCtx.page.locator('#tour-start-walk').click();
      const bottomSheet = oCtx.page.locator('h2, div').filter({ hasText: /INICIAR O PASSEIO/i }).first();
      await expect(bottomSheet).toBeVisible({ timeout: 15000 });
    });

    await test.step("4. owner: select-pet", async () => {
      const petLabel = oCtx.page.getByText(petName).first();
      await expect(petLabel).toBeVisible({ timeout: 15000 });
      
      const continueBtn = oCtx.page.locator('button').filter({ hasText: /Selecione|Continuar/i }).last();

      await expect.poll(async () => {
          const targets = oCtx.page.locator('div, button, span, p').filter({ hasText: petName });
          const count = await targets.count();
          for (let i = 0; i < count; i++) {
              await targets.nth(i).click().catch(() => {});
          }
          const text = await continueBtn.innerText();
          return text.includes('Continuar') && !text.includes('Selecione');
      }, { timeout: 30000, message: "Pet selecionado" }).toBeTruthy();
    });

    await test.step("5. owner: select-pet-confirm", async () => {
      const continueBtn = oCtx.page.locator('button').filter({ hasText: /^Continuar$/ }).last();
      await expect(continueBtn).toBeEnabled({ timeout: 10000 });
      await continueBtn.click();
    });

    await test.step("6. owner: select-walk-type", async () => {
      const walkTypeBtn = oCtx.page.locator('button').filter({ hasText: /Livre|Coletivo/i }).first();
      await expect(walkTypeBtn).toBeVisible({ timeout: 15000 });
      await walkTypeBtn.click();
      
      const continueBtn = oCtx.page.locator('button').filter({ hasText: /^Continuar$/ }).last();
      await continueBtn.click();
    });

    await test.step("7. owner: select-duration", async () => {
      const continueBtn = oCtx.page.locator('button').filter({ hasText: /^Continuar$/ }).last();
      await expect(continueBtn).toBeVisible({ timeout: 10000 });
      await continueBtn.click();
    });

    await test.step("8. owner: confirm-request", async () => {
      // 7.1 Aguardar quote/preço
      log("7.1 Aguardando quote/preço antes de arrastar");
      await expect(oCtx.page.locator('span').filter({ hasText: /R\$/ })).toBeVisible({ timeout: 20000 });

      const track = oCtx.page.locator('[data-testid-track="slide-to-confirm-track"]');
      const handle = oCtx.page.locator('[data-testid-handle="slide-to-confirm-handle"]');
      await expect(track).toBeVisible({ timeout: 15000 });
      await expect(handle).toBeVisible({ timeout: 15000 });

      const handleBox = await handle.boundingBox();
      const trackBox = await track.boundingBox();
      if (!handleBox || !trackBox) throw new Error("Slider elements not found");

      log(`8. Confirmando pedido. Estado do slider: disabled=${await handle.isDisabled()}`);

      oCtx.page.on('console', msg => {
        if (msg.type() === 'error') log(`[browser-error] ${msg.text()}`);
      });
      oCtx.page.on('requestfailed', request => {
        log(`[request-failed] ${request.url()} - ${request.failure()?.errorText}`);
      });
      oCtx.page.on('response', response => {
        if (response.status() >= 400) {
          log(`[http-error] ${response.url()} - ${response.status()}`);
        }
      });

      await oCtx.page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await oCtx.page.mouse.down();
      await oCtx.page.mouse.move(trackBox.x + trackBox.width - 5, trackBox.y + trackBox.height / 2, { steps: 50 });
      await oCtx.page.mouse.up();
      
      log(`8. Gesto de arrasto concluído. Aguardando criação no banco.`);

      const isRecordCreated = async () => {
        const { data } = await admin.from("walk_sessions")
          .select("id")
          .eq("customer_id", ownerCreds.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data?.id;
      };

      await expect.poll(async () => {
        sessId = (await isRecordCreated()) || "";
        return !!sessId;
      }, { message: "walk_session no banco após arrasto", timeout: 20000 }).toBeTruthy();

      log(`8. Pedido criado e confirmado no banco (ID: ${sessId})`);
    });

    await test.step("9. backend: request-searching", async () => {
      await expect.poll(async () => {
        const { data } = await admin.from("walk_sessions").select("current_status").eq("id", sessId).single();
        return data?.current_status === "searching";
      }, { message: "walk_session searching confirmada", timeout: 20000 }).toBeTruthy();
      
      log(`9. walk_session ${sessId} em busca confirmada.`);
    });

    await test.step("10. walker: eligibility", async () => {
      const { data: profile } = await admin.from("petwalker_profiles").select("*").eq("user_id", walkerCreds.id).single();
      expect(profile?.availability_status).toBe("available");
      expect(profile?.is_accepting_requests).toBe(true);
      log("10. Walker elegível confirmado");
    });

    await test.step("job: process-matching", async () => {
      await admin.rpc("process_walk_matching");
      await expect.poll(async () => {
        const { data } = await admin.from("walk_offers").select("id").eq("session_id", sessId).eq("walker_id", walkerCreds.id);
        return Array.isArray(data) && data.length > 0;
      }, { message: "Aguardando oferta no banco", timeout: 20000 }).toBeTruthy();
      log("Job matching executado");
    });

    await test.step("11. walker: offer-visible", async () => {
      await wCtx.page.goto("/petwalker");
      
      const onlineBtn = wCtx.page.getByRole('button', { name: /Ficar Online/i });
      const acceptBtn = wCtx.page.locator('[data-testid="walker-accept-button"]');
      
      await expect.poll(async () => {
        if (await acceptBtn.isVisible()) return true;
        if (await onlineBtn.isVisible()) {
          await onlineBtn.click().catch(() => {});
          await wCtx.page.waitForTimeout(2000);
        }
        return await acceptBtn.isVisible();
      }, { timeout: 45000, message: "Oferta visível no PetWalker" }).toBeTruthy();
      
      log("11. Oferta visível no PetWalker");
    });

    await test.step("12. walker: accept-via-ui", async () => {
      const acceptBtn = wCtx.page.locator('[data-testid="walker-accept-button"]');
      await acceptBtn.click();
      
      const manageBtn = wCtx.page.getByRole('button', { name: /Iniciar deslocamento|Gerenciar Passeio/i });
      await expect(manageBtn).toBeVisible({ timeout: 15000 });
      await manageBtn.click();

      await expect(wCtx.page).toHaveURL(/\/petwalker\/passeio\/.*/, { timeout: 20000 });
      log("12. Aceite realizado pela interface e navegação iniciada");
    });

    await test.step("13. backend: acceptance-confirmed", async () => {
      let walkerIdGravado = "";
      let statusDepois = "";
      await expect.poll(async () => {
        const { data } = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", sessId).single();
        statusDepois = data?.current_status || "";
        walkerIdGravado = data?.walker_id || "";
        return statusDepois === "accepted" && walkerIdGravado === walkerCreds.id;
      }, { message: "Confirmando walker_id e status no banco", timeout: 20000 }).toBeTruthy();
      
      log(`session_id: ${sessId}`);
      log(`status_depois: ${statusDepois}`);
      log(`walker_id_gravado: ${walkerIdGravado}`);
      log(`URL final: ${wCtx.page.url()}`);
      log("13. Banco confirmado");
    });

    await test.step("14. final-certification", async () => {
      log("MATCHING_E2E_COMPLETED");
      expect(true).toBeTruthy();
    });

  } finally {
    await test.step("cleanup", async () => {
      if (oCtx) await oCtx.context.close();
      if (wCtx) await wCtx.context.close();
      await quickCleanup([ownerCreds.id, walkerCreds.id]);
      log("Cleanup concluído com zero resíduos");
    });
  }
});
