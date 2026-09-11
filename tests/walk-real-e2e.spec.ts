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
      // Contrato fail-closed atual: cleanup é POR RUN. Agrupar pelos EXATOS
      // e2e_run_id dos usuários — nunca misturar IDs de runs diferentes,
      // nunca inventar runId. Alvo E2E sem runId válido = falha explícita.
      const byRun = new Map<string, string[]>();
      for (const u of targets) {
        const runId = u.user_metadata?.e2e_run_id;
        if (typeof runId !== 'string' || runId.length === 0) {
          throw new Error(JSON.stringify({ error: 'e2e_run_id_missing', userId: u.id }));
        }
        const group = byRun.get(runId) || [];
        group.push(u.id);
        byRun.set(runId, group);
      }
      for (const [runId, ids] of byRun) {
        await quickCleanup(ids, runId);
      }
    }
    if (users.length < perPage) break;
    page++;
  }
  log("1. preflightCleanup concluído");
}

async function quickCleanup(ids: string[], runId: string) {
  // Contrato atual de failClosedCleanup: runId OBRIGATÓRIO (throw runId_missing se ausente).
  if (!runId) throw new Error(JSON.stringify({ error: 'runId_missing', context: 'quickCleanup' }));
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

  // Coleta diagnóstico D1 (escopo do teste inteiro — visível no finally).
  const diag: Record<string, unknown> = {};

  // Estado diagnóstico de página/UI — atualizado CONTINUAMENTE pelos handlers
  // e pelo polling, e à PROVA DE TIMEOUT (sobrevive ao finally do teste mesmo
  // quando o expect.poll de oferta visível falha).
  const d1PageRpc = { requestCount: 0, httpStatuses: [] as number[] };
  const d1Ui = {
    pathname: null as string | null,
    onlineButtonSeen: false,
    onlineButtonClicked: 0,
    acceptButtonVisible: false,
  };

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

    await test.step("8.1. cleanup-metadata: tag E2E run na sessão", async () => {
      // APENAS metadata de limpeza (e2e_test/e2e_run_id) para que o
      // failClosedCleanup encontre a sessão via .eq('e2e_run_id', runId).
      // NENHUM campo de ciclo de vida é tocado.
      const { error: tagErr } = await admin
        .from("walk_sessions")
        .update({ e2e_test: true, e2e_run_id: runId })
        .eq("id", sessId);
      if (tagErr) throw tagErr;
      log(`8.1. Sessão ${sessId} marcada com e2e_run_id=${runId} (metadata only)`);
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

    // ================================================================
    // DIAGNÓSTICO D1 — oferta existe no banco, mas a UI do PetWalker
    // não a renderiza. Objetivo: CLASSIFICAR o sintoma entre:
    //   A) RPC segura não retorna a oferta do banco
    //   B) UI nunca chama a RPC (gating isOnline/activeRequest)
    //   C) RPC retorna e a página chama, mas a UI não renderiza
    //   D) RPC autenticada do walker retorna ERRO
    // Diagnóstico SOMENTE LEITURA. Nenhuma mutação de ciclo de vida.
    // ================================================================
    await test.step("D1.1. backend: offer row truth", async () => {
      // Campos SEGUROS da linha real de walk_offers (esquema gerado:
      // walk_offers NÃO possui coluna de expiração — expiração factual é
      // walk_sessions.matching_expires_at, lida junto).
      const { data: offer, error } = await admin
        .from("walk_offers")
        .select("session_id, walker_id, offer_status, created_at")
        .eq("session_id", sessId)
        .eq("walker_id", walkerCreds.id)
        .single();
      if (error) throw error;
      diag.dbOfferExists = true;
      diag.offerRow = {
        session_id: offer.session_id,
        walker_id: offer.walker_id,
        offer_status: offer.offer_status,
        created_at: offer.created_at,
      };
      const { data: sess, error: sErr } = await admin
        .from("walk_sessions")
        .select("matching_expires_at")
        .eq("id", sessId)
        .single();
      if (sErr) throw sErr;
      (diag.offerRow as Record<string, unknown>).matching_expires_at = sess.matching_expires_at;
      log(`D1.1 oferta REAL: ${JSON.stringify(diag.offerRow)}`);

      // Existência e identidade continuam obrigatórias (contrato inalterado).
      expect(offer.session_id).toBe(sessId);
      expect(offer.walker_id).toBe(walkerCreds.id);
    });

    await test.step("D1.2. walker profile/authority truth", async () => {
      const { data: prof, error: pErr } = await admin
        .from("profiles")
        .select("id, signup_intent")
        .eq("id", walkerCreds.id)
        .single();
      if (pErr) throw pErr;
      // user_roles é MULTI-LINHA no modelo RBAC atual (PGRST116 provou:
      // "Results contain 2 rows" para o mesmo user_id). Leitura em ARRAY
      // — .single()/.maybeSingle() são INVÁLIDOS aqui. A lista factual
      // completa é registrada; nada é deduplicado nem escolhido como
      // "o papel". A exigência é apenas a pertinência de "petwalker".
      const { data: roleRows, error: rErr } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", walkerCreds.id);
      if (rErr) throw rErr;
      const roles = (roleRows ?? []).map((r) => r.role);
      const { data: wp, error: wErr } = await admin
        .from("petwalker_profiles")
        .select("user_id, approval_status, availability_status, is_accepting_requests, current_walk_id, service_radius_km")
        .eq("user_id", walkerCreds.id)
        .single();
      if (wErr) throw wErr;
      diag.walkerProfile = {
        signup_intent: prof.signup_intent,
        roles,
        roleCount: roles.length,
        approval_status: wp.approval_status,
        availability_status: wp.availability_status,
        is_accepting_requests: wp.is_accepting_requests,
        current_walk_id: wp.current_walk_id,
        service_radius_km: wp.service_radius_km,
      };
      log(`D1.2 walker roles: ${JSON.stringify(roles)} (roleCount=${roles.length})`);
      log(`D1.2 perfil do walker: ${JSON.stringify(diag.walkerProfile)}`);
      // Fatos certificados do setup (SÓ LEITURA — nada é mutado aqui).
      // Papel: apenas PERTINÊNCIA — múltiplos papéis legítimos NÃO falham;
      // duplicatas idênticas são reportadas como fatos (lista + contagem).
      expect(roles).toContain("petwalker");
      expect(wp.approval_status).toBe("approved");
      expect(wp.availability_status).toBe("available");
      expect(wp.is_accepting_requests).toBe(true);
      expect(wp.current_walk_id).toBeNull();
    });

    await test.step("D1.3. direct authenticated walker RPC (same read-only RPC as product)", async () => {
      // get_available_walk_offers é DESCOBERTA SOMENTE LEITURA de ofertas
      // (NÃO é mutação de ciclo de vida). Chamado com wCtx.client — o MESMO
      // cliente autenticado do Walker REAL. NUNCA admin.
      const res = await wCtx.client.rpc("get_available_walk_offers");
      const rows = (res.data as Array<Record<string, unknown>>) ?? [];
      const directRpc = {
        error: res.error ? `${res.error.code}: ${res.error.message}` : null,
        count: res.error ? null : rows.length,
        sessionIds: res.error ? null : rows.map((r) => r.session_id).slice(0, 10),
        containsSession: res.error ? null : rows.some((r) => r.session_id === sessId),
      };
      diag.directRpc = directRpc;
      if (directRpc.error) {
        log(`DIRECT_WALKER_RPC_ERROR ${JSON.stringify(directRpc)}`);
      } else if (directRpc.containsSession) {
        log(`DIRECT_WALKER_RPC_CONTAINS_SESSION ${JSON.stringify(directRpc)}`);
      } else {
        log(`DIRECT_WALKER_RPC_EMPTY ${JSON.stringify(directRpc)}`);
      }
      // Fatos seguros adicionais do tipo oficial de retorno, quando presentes.
      if (!res.error && rows.length > 0) {
        const mine = rows.find((r) => r.session_id === sessId);
        if (mine) {
          log(`D1.3 linha da sessão: id=${mine.id} offer_status=${mine.offer_status} matching_expires_at=${mine.matching_expires_at}`);
        }
      }
    });

    await test.step("11. walker: offer-visible", async () => {
      // ORDEM OBRIGATÓRIA (comparabilidade com os runs RED originais):
      //   1. armar observadores passivos
      //   2. goto('/petwalker') REAL (a navegação original do teste)
      //   3. produto monta → observamos as chamadas reais de descoberta
      //   4. polling existente de UI
      // Observador PASSIVO de rede da página real (sem route/mock/intercept).
      // Fatos seguros: contagem, método, status HTTP. Corpo é opcional e
      // NUNCA obrigatório (sem corrida CDP de leitura de corpo).
      wCtx.page.on("request", (req) => {
        try {
          if (new URL(req.url()).pathname === "/rest/v1/rpc/get_available_walk_offers") {
            d1PageRpc.requestCount++;
          }
        } catch { /* URL inválida — ignorar */ }
      });
      wCtx.page.on("response", (res) => {
        try {
          if (new URL(res.url()).pathname === "/rest/v1/rpc/get_available_walk_offers") {
            d1PageRpc.httpStatuses.push(res.status());
          }
        } catch { /* URL inválida — ignorar */ }
      });

      // Navegação REAL restaurada (idêntica ao run original) — nenhuma nova
      // Page, nenhum reload repetido, nenhuma invocação manual de descoberta.
      await wCtx.page.goto("/petwalker");
      expect(new URL(wCtx.page.url()).pathname).toBe("/petwalker");

      const onlineBtn = wCtx.page.getByRole('button', { name: /Ficar Online/i });
      const acceptBtn = wCtx.page.locator('[data-testid="walker-accept-button"]');

      // try/finally SEM catch: o expect original NÃO é engolido — em caso de
      // timeout o erro propaga, MAS o estado diagnóstico já foi persistido.
      try {
        await expect.poll(async () => {
          if (await acceptBtn.isVisible()) {
            d1Ui.acceptButtonVisible = true;
            return true;
          }
          if (await onlineBtn.isVisible()) {
            if (!d1Ui.onlineButtonSeen) {
              d1Ui.onlineButtonSeen = true;
              log("ONLINE_BUTTON_SEEN");
            }
            // Comportamento preservado do run original: clicar quando visível.
            await onlineBtn.click().catch(() => {});
            d1Ui.onlineButtonClicked++;
            log(`ONLINE_BUTTON_CLICKED (total=${d1Ui.onlineButtonClicked})`);
            await wCtx.page.waitForTimeout(2000);
          }
          return await acceptBtn.isVisible();
        }, { timeout: 45000, message: "Oferta visível no PetWalker" }).toBeTruthy();
      } finally {
        // Persiste PAGE_RPC/UI ANTES de qualquer propagação de erro —
        // Classificação CASE B vs CASE C permanece possível no timeout.
        d1Ui.pathname = new URL(wCtx.page.url()).pathname;
        diag.pageRpc = { requestCount: d1PageRpc.requestCount, httpStatuses: [...d1PageRpc.httpStatuses] };
        diag.ui = { ...d1Ui };
        log(`PAGE_RPC ${JSON.stringify(diag.pageRpc)}`);
        log(`UI ${JSON.stringify(diag.ui)}`);
      }

      log("11. Oferta visível no PetWalker");
    });

    await test.step("12. walker: accept-via-ui (terminal do matching)", async () => {
      // ORDEM CORRETA (Patch T1): o escopo deste teste termina no ACEITE.
      // O botão "Iniciar deslocamento" executa petwalker_start_heading e
      // avança accepted → heading_to_pickup; clicá-lo ANTES de provar o
      // backend accepted invalidava a asserção de aceite (RED falso
      // determinístico). "Iniciar deslocamento" NÃO é clicado aqui —
      // heading pertence aos testes de ciclo de vida 4.4/4.5.
      const acceptBtn = wCtx.page.locator('[data-testid="walker-accept-button"]');

      // Prova de resposta ARMADA ANTES do clique (determinística, sem
      // corrida de parsing de corpo): POST real à RPC de aceite.
      const acceptResponsePromise = wCtx.page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === "/rest/v1/rpc/accept_walk_request" &&
          res.request().method() === "POST",
        { timeout: 20000 }
      );

      await acceptBtn.click();

      const acceptResponse = await acceptResponsePromise;
      expect(acceptResponse.status()).toBe(200);
      // Corpo é best-effort (NUNCA requisito frágil de leitura CDP):
      try {
        const body = await acceptResponse.json();
        log(`accept_walk_request HTTP 200 body=${JSON.stringify(body)}`);
      } catch {
        log("accept_walk_request HTTP 200 (corpo indisponível para leitura)");
      }

      // AUTORIDADE DE BACKEND antes de qualquer avanço de ciclo de vida:
      // MESMA sessão, accepted, walker correto (status + current_status).
      await expect
        .poll(
          async () => {
            const s = await admin
              .from("walk_sessions")
              .select("id, status, current_status, walker_id")
              .eq("id", sessId)
              .single();
            return (
              s.data?.id === sessId &&
              s.data?.status === "accepted" &&
              s.data?.current_status === "accepted" &&
              s.data?.walker_id === walkerCreds.id
            );
          },
          { message: "accepted + walker_id no banco", timeout: 20000 }
        )
        .toBeTruthy();
      const s = await admin
        .from("walk_sessions")
        .select("id, status, current_status, walker_id")
        .eq("id", sessId)
        .single();
      log(`12. aceite REAL: session_id=${s.data?.id} status=${s.data?.status} current_status=${s.data?.current_status} walker_id=${s.data?.walker_id}`);

      // PROVA DE UI (refreshActiveRequest funcionou): a apresentação de
      // aceite do ActiveWalkSheet. VISIBILIDADE apenas — o botão
      // "Iniciar deslocamento" NÃO é clicado neste teste.
      await expect(
        wCtx.page.getByRole("button", { name: /^Iniciar deslocamento$/i })
      ).toBeVisible({ timeout: 15000 });
      log("12. UI reflete aceite: botão 'Iniciar deslocamento' visível (NÃO clicado)");
    });

    await test.step("13. final-certification", async () => {
      log(`session_id: ${sessId}`);
      log(`URL final (sem navegação para passeio): ${wCtx.page.url()}`);
      log("MATCHING_E2E_COMPLETED");
      expect(true).toBeTruthy();
    });

  } finally {
    await test.step("cleanup", async () => {
      // Resumo diagnóstico D1 — impresso em SUCESSO e FALHA (o objeto `diag`
      // está no escopo do teste; o resumo classifica o sintoma observado).
      log("=== DIAGNOSTIC SUMMARY D1 ===");
      log(`DB_OFFER_EXISTS=${diag.dbOfferExists ?? false}`);
      log("WALKER_PROFILE: " + JSON.stringify(diag.walkerProfile ?? null));
      log("DIRECT_RPC: " + JSON.stringify(diag.directRpc ?? null));
      // PAGE_RPC/UI vêm das variáveis de escopo do teste (d1PageRpc/d1Ui),
      // atualizadas continuamente — NUNCA null apenas porque o poll falhou.
      log("PAGE_RPC: " + JSON.stringify(d1PageRpc));
      log("UI: " + JSON.stringify(d1Ui));

      if (oCtx) await oCtx.context.close();
      if (wCtx) await wCtx.context.close();
      await quickCleanup([ownerCreds.id, walkerCreds.id], runId);
      log("Cleanup concluído com zero resíduos");
    });
  }
});
