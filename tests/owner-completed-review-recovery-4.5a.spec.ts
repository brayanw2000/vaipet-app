/**
 * PHASE 4.5A2.6 — OWNER COMPLETED / REVIEW RELOAD RECOVERY — TEST-ONLY FIRST PROOF
 *
 * Baseline certificada (NÃO reabrir):
 *   - 4.4 certificou returning → confirm-return-arrival-button →
 *     customer_confirm_arrival (HTTP 200 + true) → completed → ReviewWalk →
 *     avaliação real → histórico. O GPS de returning e a SUBMISSÃO de review
 *     JÁ são certificados e NÃO são repetidos aqui.
 *   - 4.5A recovery GREEN: searching, accepted, heading_to_pickup, arrived,
 *     in_progress (4.5A2.4), returning (4.5A2.5 — TEMPLATE PRIMÁRIO deste
 *     teste).
 *
 * ARQUITETURA ATUAL DO PRODUTO (NÃO alterada):
 *   - ActiveWalkBanner consulta APENAS in_progress/returning — NUNCA
 *     completed. Este teste NÃO vai a /inicio após a conclusão e NÃO exige
 *     banner para completed (isso seria contrato falso).
 *   - SearchWalk ?resume aceita in_progress/returning/completed. Para
 *     completed o produto carrega a MESMA walk_session, valida customer_id,
 *     hidrata pet, preserva currentSessionId, seta sessionStatus='completed',
 *     hidrata end_time/start_time/actual_duration_minutes, hidrata o PetWalker
 *     real via get_session_walker_profile, seta searchStatus('reviewing') e
 *     renderiza ReviewWalk. Este é o caminho de recuperação pretendido.
 *
 * O QUE ESTE TESTE PROVA (4.5A2.6):
 *   1. SETUP até returning = réplica certificada 4.5A2.5: jornada UI real até
 *      in_progress, re-entrada /inicio, banner REAL cria ?resume, UI
 *      in_progress hidratada, UM clique no request-return-button →
 *      customer_request_return 200+true → backend returning →
 *      owner-returning-state + confirm-return-arrival-button.
 *   2. PRÉ-CONDIÇÃO da conclusão: pathname /search-walk + ?resume ===
 *      MESMA sessionId (criado ANTES pelo banner — nada injetado aqui),
 *      backend returning (MESMA sessão/Owner/Walker/Pet), UI returning.
 *   3. TRANSIÇÃO REAL para completed: customer_confirm_arrival count === 0
 *      antes; UM clique no confirm-return-arrival-button → HTTP 200 +
 *      body true → backend completed (status+current_status, MESMA sessão),
 *      end_time NOT NULL, actual_duration_minutes >= 1, distance_km >= 0,
 *      walker current_walk_id NULL (contrato 4.4).
 *   4. PRÉ-RELOAD: SEM navegação — URL ainda /search-walk?resume=<sessionId>;
 *      review-walk-screen visível; review-duration === backend
 *      actual_duration_minutes; review-distance === distance_km formatado
 *      (contrato certificado 4.4). Review NÃO é submetida (sem estrelas, sem
 *      comentário) — customer_submit_walk_review === 0.
 *   5. RELOAD: ownerPage.reload({ waitUntil: 'domcontentloaded' }) e ZERO
 *      ações: pathname + ?resume preservados, backend ainda completed com
 *      métricas intactas, ReviewWalk restaura automaticamente com as MESMAS
 *      métricas, CTAs operacionais ausentes (request-return-button /
 *      owner-returning-state / confirm-return-arrival-button === 0), backend
 *      nunca regredindo a returning/in_progress.
 *   6. ZERO efeitos colaterais: TODOS os 8 contadores RPC comparados
 *      ANTES/DEPOIS (monotônicos, sem reset): create/accept/heading/arrive/
 *      confirm_pickup/request_return/confirm_arrival/submit_review —
 *      confirm_arrival permanece EXATAMENTE 1 e submit_review EXATAMENTE 0
 *      (reload NÃO reconfirma chegada NÃO submete review NÃO cria passeio).
 *   7. INVARIÂNCIAS TERMINAIS (completed é terminal — NÃO usa "ativas === 1"):
 *      exatamente UMA sessão do run (e2e_run_id) com id === sessionId;
 *      exatamente UMA sessão do Owner (qualquer status) e do Pet; sessões
 *      ATIVAS (ACTIVE_STATUSES) === 0 (prova terminal sem classificar
 *      completed como ativa).
 *
 * OBSERVABILIDADE DA CHEGADA: técnica T6 certificada
 * (armInPageArriveObserver ANTES de walkerCtx.newPage()) — ZERO leitores CDP
 * do body da chegada, ZERO barreiras de reload, ZERO preflight de GPS.
 *
 * REGRAS:
 * - O teste NUNCA chama diretamente: create_walk_request, accept_walk_request,
 *   petwalker_start_heading, petwalker_arrive_pickup, customer_get_pickup_code
 *   (fonte do PIN), petwalker_confirm_pickup, customer_request_return,
 *   customer_confirm_arrival, customer_submit_walk_review. ÚNICA exceção
 *   certificada: admin.rpc('process_walk_matching') (scheduler).
 * - NÃO insere walk_sessions nem walk_offers manualmente.
 * - NÃO testa GPS (4.4 já certificou returning/completed GPS).
 * - NÃO submete review (4.4 já certificou; aqui submit_review === 0).
 * - NÃO testa /search-walk SEM ?resume (arquitetura intencional).
 * - NÃO adiciona completed ao banner nem ao auto-discovery.
 * - Cleanup fail-closed: ZERO resíduos; falha de cleanup falha a suíte.
 */

import { test, expect, type BrowserContext, type ConsoleMessage, type Page, type Request, type Response } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const PASSWORD = 'VaiPet@2026';

// create_walk_request RETORNA uuid (NÃO boolean) — matcher estrito de UUID v4.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// GPS do OWNER (browser) = ponto de encontro = home_location esperada.
const MEETING = { lng: -46.7, lat: -23.6 };
// GPS do WALKER (browser) ~14m do ponto de encontro — dentro do raio de
// chegada da petwalker_arrive_pickup (150m + LEAST(_accuracy, 50)).
const ARRIVE_POS = { longitude: -46.7001, latitude: -23.6001 };

// Estados ativos (não terminais) — completed é TERMINAL e NÃO pertence aqui.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

// T6: filtro estrito de console — apenas erros relevantes. NUNCA dumpa
// objetos arbitrários: apenas a mensagem de texto.
const ARRIVE_CONSOLE_FILTER = /arriv|pickup|GPS|geolocation|supabase|fetch|confirm|return|review/i;

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5a2.6-owner-completed-review-recovery] ${msg}`);

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function provisionUser(runId: string, kind: 'pet_owner' | 'petwalker') {
  const email = `e2e.${kind}.${runId}.${Math.random().toString(36).slice(2, 6)}@e2e.vaipet.invalid`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${kind}`, signup_intent: kind, e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw new Error(`user_creation_failed: ${error.message}`);
  const id = data.user!.id;

  // FIXTURE certificada (Blocker Patch A1): handle_new_user NÃO copia
  // signup_intent para profiles.
  const { error: profErr } = await admin.from('profiles').upsert({
    id,
    full_name: `E2E ${kind}`,
    onboarding_completed: true,
    phone: '(11) 96666-6666',
    age: 32,
    signup_intent: kind,
  });
  if (profErr) throw new Error(`profile_upsert_failed: ${JSON.stringify(profErr)}`);

  // PREFLIGHT factual (fail-closed): profiles.signup_intent === kind.
  const { data: pf, error: pfErr } = await admin
    .from('profiles')
    .select('signup_intent')
    .eq('id', id)
    .single();
  if (pfErr) throw new Error(`profile_preflight_failed: ${JSON.stringify(pfErr)}`);
  if (pf!.signup_intent !== kind) {
    throw new Error(`profile_signup_intent_mismatch: esperado ${kind}, obtido ${pf!.signup_intent}`);
  }

  if (kind === 'petwalker') {
    const { error: roleErr } = await admin.from('user_roles').insert({ user_id: id, role: 'petwalker' });
    if (roleErr) throw new Error(`role_insert_failed: ${JSON.stringify(roleErr)}`);

    const { error: wpErr } = await admin.from('petwalker_profiles').upsert({
      user_id: id,
      approval_status: 'approved',
      profile_completed: true,
      availability_status: 'available',
      is_accepting_requests: true,
      price_30_minutes: 2250,
      experience_years: 2,
      service_radius_km: 10,
      last_known_location: `SRID=4326;POINT(${ARRIVE_POS.longitude} ${ARRIVE_POS.latitude})`,
    });
    if (wpErr) throw new Error(`walker_profile_failed: ${JSON.stringify(wpErr)}`);

    const { data: wp, error: wpChkErr } = await admin
      .from('petwalker_profiles')
      .select('approval_status, availability_status, is_accepting_requests')
      .eq('user_id', id)
      .single();
    if (wpChkErr) throw new Error(`walker_profile_preflight_failed: ${JSON.stringify(wpChkErr)}`);
    if (
      wp!.approval_status !== 'approved' ||
      wp!.availability_status !== 'available' ||
      wp!.is_accepting_requests !== true
    ) {
      throw new Error(
        'walker_profile_preflight_mismatch: esperado approved/available/accepting, obtido ' +
          JSON.stringify(wp)
      );
    }
  }
  return { id, email };
}

async function loginViaUi(page: Page, email: string) {
  await page.goto('/auth');
  await page.getByPlaceholder('E-mail').fill(email);
  await page.getByPlaceholder('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /^Entrar$/i }).click();
  // Login REAL validado: sair da tela de auth = sucesso.
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 45000 });
}

test.describe('Phase 4.5A2.6: Owner completed/review reload recovery (pending ReviewWalk)', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 420_000 });

  let runId = '';
  let ownerId = '';
  let walkerId = '';
  let petId = '';
  let sessionId = '';
  let ownerEmail = '';
  let walkerEmail = '';
  let ownerPin = '';
  let ownerCtx: BrowserContext | null = null;
  let walkerCtx: BrowserContext | null = null;
  let ownerPage: Page | null = null;
  let walkerPage: Page | null = null;

  // Contadores MONOTÔNICOS de lifecycle RPC — registrados ANTES do reload e
  // comparados DEPOIS (NUNCA resetados; aprendizado dos audits T1).
  let createCountBeforeReload = 0;
  let acceptCountBeforeReload = 0;
  let headingCountBeforeReload = 0;
  let arriveCountBeforeReload = 0;
  let confirmPickupCountBeforeReload = 0;
  let returnRequestCountBeforeReload = 0;
  let confirmArrivalCountBeforeReload = 0;
  let submitReviewCountBeforeReload = 0;

  // Observador factual das respostas RPC reais das páginas (HTTP + body) —
  // usado para TODAS as RPCs EXCETO petwalker_arrive_pickup (T6 in-page).
  const rpcCalls: Record<string, Array<{ status: number; body: unknown }>> = {};

  const armRpcObserver = (page: Page, rpcName: string) => {
    page.on('response', (res) => {
      if (!res.url().includes(`/rest/v1/rpc/${rpcName}`)) return;
      res
        .json()
        .then((body) => {
          rpcCalls[rpcName] = rpcCalls[rpcName] || [];
          rpcCalls[rpcName].push({ status: res.status(), body });
          log(`RPC_OBSERVED ${rpcName} HTTP ${res.status()} body=${JSON.stringify(body)}`);
        })
        .catch(() => {
          rpcCalls[rpcName] = rpcCalls[rpcName] || [];
          rpcCalls[rpcName].push({ status: res.status(), body: 'NON_JSON' });
        });
    });
  };

  const lastRpc = (rpcName: string) => {
    const calls = rpcCalls[rpcName] || [];
    return calls[calls.length - 1];
  };

  // ——— T6: observador IN-PAGE do body REAL da chegada (técnica certificada) ———
  const ARRIVE_RPC_BINDING = '__E2E_REPORT_ARRIVE_RPC__';
  const arriveObs = {
    requestSeen: false,
    requestFailed: null as string | null,
    responseStatus: null as number | null,
    responseBody: null as unknown,
    handlerEntryObserved: false,
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    fetchCloneObserved: false,
    fetchCloneStatus: null as number | null,
    fetchCloneFrame: '' as string,
    fetchCloneObservations: 0,
  };

  /** Instala exposeBinding + addInitScript no BrowserContext do Walker, ANTES
   * da criação da página e de qualquer JS do app. */
  const armInPageArriveObserver = async (ctx: BrowserContext) => {
    await ctx.exposeBinding(ARRIVE_RPC_BINDING, async (source, payload: unknown) => {
      // ESCOPO/FRAME SAFETY: apenas o frame principal da página do Walker.
      if (!walkerPage || source.page !== walkerPage || source.frame !== walkerPage.mainFrame()) {
        log('ARRIVE_FETCH_CLONE_IGNORED (frame não principal/página não-Walker)');
        return { ok: false, reason: 'ignored_frame' };
      }
      const p = (payload || {}) as { status?: unknown; body?: unknown; pathname?: unknown };
      const status = typeof p.status === 'number' ? p.status : null;
      const pathname = typeof p.pathname === 'string' ? p.pathname : '';
      if (pathname !== '/rest/v1/rpc/petwalker_arrive_pickup' || status === null) {
        return { ok: false, reason: 'not_arrive_rpc' };
      }
      arriveObs.fetchCloneObservations += 1;
      arriveObs.fetchCloneObserved = true;
      arriveObs.fetchCloneStatus = status;
      arriveObs.fetchCloneFrame = 'main';
      arriveObs.responseStatus = status;
      arriveObs.responseBody = p.body;
      rpcCalls['petwalker_arrive_pickup'] = rpcCalls['petwalker_arrive_pickup'] || [];
      rpcCalls['petwalker_arrive_pickup'].push({ status, body: p.body });
      log(`ARRIVE_FETCH_CLONE_OBSERVED HTTP ${status} body=${JSON.stringify(p.body)}`);
      log(`RPC_OBSERVED petwalker_arrive_pickup HTTP ${status} body=${JSON.stringify(p.body)}`);
      return { ok: true };
    });
    await ctx.addInitScript(
      `(() => {
        const RPC_PATH = '/rest/v1/rpc/petwalker_arrive_pickup';
        const BINDING = '${ARRIVE_RPC_BINDING}';
        if (window.__e2eArriveFetchWrapperInstalled) return;
        window.__e2eArriveFetchWrapperInstalled = true;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          let pathname = '';
          try {
            const u = typeof input === 'string'
              ? new URL(input, window.location.href)
              : (input && input.url) ? new URL(input.url, window.location.href) : null;
            pathname = u ? u.pathname : '';
          } catch { pathname = ''; }
          if (pathname !== RPC_PATH) return nativeFetch(input, init);
          const response = await nativeFetch(input, init);
          try {
            const observationClone = response.clone();
            const cloneText = await observationClone.text();
            let parsed;
            try { parsed = JSON.parse(cloneText); } catch { parsed = 'NON_JSON'; }
            await window[BINDING]({ status: response.status, body: parsed, pathname });
          } catch (obsErr) {
            const msg = obsErr && obsErr.message ? String(obsErr.message) : String(obsErr);
            try {
              await window[BINDING]({ status: response.status, body: 'OBSERVATION_FAILED: ' + msg, pathname });
            } catch { /* binding indisponível */ }
            console.error('e2e_arrive_observation_failed:', msg);
          }
          return response;
        };
      })()`
    );
    log(`T6: observador in-page armado (exposeBinding ${ARRIVE_RPC_BINDING} + addInitScript fetch wrapper)`);
  };

  /** Diagnósticos externos T3 (status/falha/erros) — SEM leitura de body:
   * ZERO leitores Playwright/CDP para o body da chegada. */
  const armArriveObservers = (page: Page) => {
    const onRequest = (req: Request) => {
      if (!new URL(req.url()).pathname.includes('/rest/v1/rpc/petwalker_arrive_pickup')) return;
      arriveObs.requestSeen = true;
      log(`ARRIVE_REQUEST_SEEN=true method=${req.method()} path=/rest/v1/rpc/petwalker_arrive_pickup`);
    };
    const onRequestFailed = (req: Request) => {
      if (!new URL(req.url()).pathname.includes('/rest/v1/rpc/petwalker_arrive_pickup')) return;
      arriveObs.requestFailed = req.failure()?.errorText ?? 'unknown';
      log(`ARRIVE_REQUESTFAILED: ${arriveObs.requestFailed}`);
    };
    const onResponse = (res: Response) => {
      if (!new URL(res.url()).pathname.includes('/rest/v1/rpc/petwalker_arrive_pickup')) return;
      arriveObs.responseStatus = res.status();
      log(`ARRIVE_RPC_RESPONSE_STATUS HTTP ${res.status()} (body lido in-page via clone — sem leitor CDP)`);
    };
    const onPageError = (err: Error) => {
      arriveObs.pageErrors.push(err.message);
      log(`ARRIVE_PAGEERROR: ${err.message}`);
    };
    const onConsole = (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!ARRIVE_CONSOLE_FILTER.test(text)) return;
      arriveObs.consoleErrors.push(text);
      log(`WALKER_CONSOLE_ERROR: ${text}`);
    };
    page.on('request', onRequest);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    detachArriveObservers = () => {
      page.off('request', onRequest);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
      detachArriveObservers = () => {};
    };
  };
  let detachArriveObservers: () => void = () => {};

  /** Relatório factual de timeout da chegada: SOMENTE fatos seguros. */
  const arriveRpcTimeoutDiagnostic = (pre: { pathname: string }) =>
    [
      `petwalker_arrive_pickup não observado (HTTP 200 + true) via UI real`,
      `pathname_before_click=${pre.pathname}`,
      `handler_entry_processando_observed=${arriveObs.handlerEntryObserved}`,
      `ARRIVE_REQUEST_SEEN=${arriveObs.requestSeen}`,
      `requestfailed=${arriveObs.requestFailed ?? 'none'}`,
      `response_status=${arriveObs.responseStatus ?? 'none'}`,
      `response_body=${arriveObs.responseBody === null ? 'none' : JSON.stringify(arriveObs.responseBody)}`,
      `pageerrors=${arriveObs.pageErrors.length ? JSON.stringify(arriveObs.pageErrors) : 'none'}`,
      `console_errors=${arriveObs.consoleErrors.length ? JSON.stringify(arriveObs.consoleErrors) : 'none'}`,
      `fetch_clone_observed=${arriveObs.fetchCloneObserved}`,
      `fetch_clone_observations=${arriveObs.fetchCloneObservations}`,
    ].join(' | ');

  async function auditSession(id: string) {
    const { data, error } = await admin.from('walk_sessions').select('*').eq('id', id).single();
    if (error) throw new Error(`audit_session_failed: ${JSON.stringify(error)}`);
    return data;
  }

  async function activeOwnerSessionCount() {
    const { data, error } = await admin
      .from('walk_sessions')
      .select('id')
      .eq('customer_id', ownerId)
      .in('current_status', ACTIVE_STATUSES);
    if (error) throw new Error(`active_owner_sessions_failed: ${JSON.stringify(error)}`);
    return data || [];
  }

  async function activePetSessionCount() {
    const { data, error } = await admin
      .from('walk_sessions')
      .select('id')
      .eq('pet_id', petId)
      .in('current_status', ACTIVE_STATUSES);
    if (error) throw new Error(`active_pet_sessions_failed: ${JSON.stringify(error)}`);
    return data || [];
  }

  async function auditWalkerProfile() {
    const { data, error } = await admin
      .from('petwalker_profiles')
      .select('current_walk_id, availability_status')
      .eq('user_id', walkerId)
      .single();
    if (error) throw new Error(`audit_walker_profile_failed: ${JSON.stringify(error)}`);
    return data;
  }

  const lifecycleCounts = () => ({
    create: (rpcCalls['create_walk_request'] || []).length,
    accept: (rpcCalls['accept_walk_request'] || []).length,
    heading: (rpcCalls['petwalker_start_heading'] || []).length,
    arrive: (rpcCalls['petwalker_arrive_pickup'] || []).length,
    confirmPickup: (rpcCalls['petwalker_confirm_pickup'] || []).length,
    returnReq: (rpcCalls['customer_request_return'] || []).length,
    confirmArrival: (rpcCalls['customer_confirm_arrival'] || []).length,
    submitReview: (rpcCalls['customer_submit_walk_review'] || []).length,
  });

  test('Owner completed: ?resume (criado pelo banner) sobrevive à conclusão e o reload restaura a ReviewWalk pendente sem ação', async ({ browser }) => {
    runId = `4.5a2.6_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetCompleted45A26';

    try {
      await test.step('setup: Owner + Walker E2E determinísticos + 1 pet real', async () => {
        const owner = await provisionUser(runId, 'pet_owner');
        const walker = await provisionUser(runId, 'petwalker');
        ownerId = owner.id;
        walkerId = walker.id;
        ownerEmail = owner.email;
        walkerEmail = walker.email;
        log(`owner_id: ${ownerId}`);
        log(`walker_id: ${walkerId}`);

        const { data: pet, error: petErr } = await admin
          .from('pets')
          .insert({
            owner_id: ownerId,
            name: petName,
            breed: 'SRD',
            is_active: true,
            e2e_test: true,
            e2e_run_id: runId,
          })
          .select('id')
          .single();
        if (petErr) throw new Error(`pet_creation_failed: ${JSON.stringify(petErr)}`);
        petId = pet!.id;
        log(`pet_id: ${petId}`);
      });

      await test.step('login real via /auth + observadores (T6 in-page ANTES da página)', async () => {
        walkerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          // Fixture certificada 4.4: posição real do Walker.
          geolocation: ARRIVE_POS,
        });
        ownerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: { longitude: MEETING.lng, latitude: MEETING.lat },
        });
        // T6: binding + wrapper de fetch instalados NO CONTEXT, ANTES da
        // criação da página e de qualquer JS do app.
        await armInPageArriveObserver(walkerCtx);
        walkerPage = await walkerCtx.newPage();
        ownerPage = await ownerCtx.newPage();
        await loginViaUi(ownerPage, ownerEmail);
        await loginViaUi(walkerPage, walkerEmail);

        armRpcObserver(ownerPage, 'create_walk_request');
        armRpcObserver(ownerPage, 'customer_request_return');
        armRpcObserver(ownerPage, 'customer_confirm_arrival');
        armRpcObserver(ownerPage, 'customer_submit_walk_review');
        armRpcObserver(walkerPage, 'accept_walk_request');
        armRpcObserver(walkerPage, 'petwalker_start_heading');
        armRpcObserver(walkerPage, 'petwalker_confirm_pickup');
        armArriveObservers(walkerPage); // T3: request/status/erros (sem body CDP)
      });

      await test.step('owner: criar pedido pela UI REAL (create_walk_request) → searching', async () => {
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 10000 });
        await expect(ownerPage!.locator('#tour-start-walk')).toBeVisible({ timeout: 10000 });
        await ownerPage!.locator('#tour-start-walk').click();

        // STEP 1 — pet único (auto-seleção certificada: NÃO clicar no card).
        const petCard = ownerPage!.getByTestId('pet-selection-card').first();
        await expect(petCard).toBeVisible({ timeout: 15000 });
        const confirmPet = ownerPage!.getByTestId('confirm-pet-selection');
        await expect(confirmPet).toBeEnabled({ timeout: 15000 });
        await confirmPet.click();

        // STEP 2 — tipo de passeio: Livre.
        await expect(ownerPage!.getByLabel('Livre')).toBeVisible({ timeout: 15000 });
        await ownerPage!.getByLabel('Livre').click();
        const confirmType = ownerPage!.getByTestId('confirm-walk-type');
        await expect(confirmType).toBeEnabled({ timeout: 10000 });
        await confirmType.click();

        // STEP 3 — duração determinística (default 30 min).
        const confirmDuration = ownerPage!.getByTestId('confirm-duration');
        await expect(confirmDuration).toBeVisible({ timeout: 10000 });
        await confirmDuration.click();

        // STEP 4 — quote + SlideToConfirm real.
        await expect(ownerPage!.locator('span').filter({ hasText: /R\$/ }).first()).toBeVisible({
          timeout: 20000,
        });
        const track = ownerPage!.locator('[data-testid-track="slide-to-confirm-track"]');
        const handle = ownerPage!.locator('[data-testid-handle="slide-to-confirm-handle"]');
        await expect(track).toBeVisible({ timeout: 15000 });
        await expect(handle).toBeVisible({ timeout: 15000 });
        const handleBox = await handle.boundingBox();
        const trackBox = await track.boundingBox();
        if (!handleBox || !trackBox) throw new Error('Slider elements not found');
        await ownerPage!.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await ownerPage!.mouse.down();
        await ownerPage!.mouse.move(trackBox.x + trackBox.width - 5, trackBox.y + trackBox.height / 2, {
          steps: 50,
        });
        await ownerPage!.mouse.up();

        // PROVA: create_walk_request via UI → HTTP 200 + UUID v4.
        await expect
          .poll(
            () => {
              const rpc = lastRpc('create_walk_request');
              return !!(
                rpc &&
                rpc.status === 200 &&
                typeof rpc.body === 'string' &&
                UUID_RE.test(rpc.body)
              );
            },
            { timeout: 20000, message: 'create_walk_request HTTP 200 + UUID via UI' }
          )
          .toBeTruthy();
        const rpcReturnedUuid = String(lastRpc('create_walk_request')!.body);
        log(`create_walk_request retornou UUID via UI: ${rpcReturnedUuid}`);

        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('id')
                .eq('customer_id', ownerId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              return data?.id || '';
            },
            { timeout: 20000, message: 'walk_session no banco após slide' }
          )
          .toBeTruthy();

        const { data: created, error: cErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('customer_id', ownerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cErr || !created) throw new Error('session_not_found_after_ui_creation');
        expect(created.id).toBe(rpcReturnedUuid);
        sessionId = created.id;
        log(`session_id criado pela UI: ${sessionId} (== UUID retornado pela RPC)`);

        // Higiene de cleanup: tag e2e (NÃO toca status/lifecycle).
        const { error: tagErr } = await admin
          .from('walk_sessions')
          .update({ e2e_test: true, e2e_run_id: runId })
          .eq('id', sessionId);
        if (tagErr) throw new Error(`session_tag_failed: ${JSON.stringify(tagErr)}`);
      });

      await test.step('matching: scheduler simulado process_walk_matching + oferta real', async () => {
        const { data: prof, error: profErr } = await admin
          .from('petwalker_profiles')
          .select('approval_status, availability_status, is_accepting_requests, current_walk_id')
          .eq('user_id', walkerId)
          .single();
        if (profErr) throw new Error(`walker_eligibility_failed: ${JSON.stringify(profErr)}`);
        expect(prof.approval_status).toBe('approved');
        expect(prof.availability_status).toBe('available');
        expect(prof.is_accepting_requests).toBe(true);
        expect(prof.current_walk_id).toBeNull();

        const { error: matchErr } = await admin.rpc('process_walk_matching');
        if (matchErr) throw new Error(`matching_failed: ${matchErr.message}`);

        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_offers')
                .select('offer_status')
                .eq('session_id', sessionId)
                .eq('walker_id', walkerId);
              return Array.isArray(data) && data.length > 0 && data[0].offer_status === 'pending';
            },
            { timeout: 20000, message: 'Oferta real via process_walk_matching (mesma sessão + walker)' }
          )
          .toBeTruthy();
      });

      await test.step('walker: oferta visível + aceite pela UI REAL', async () => {
        await walkerPage!.goto('/petwalker');
        const onlineBtn = walkerPage!.getByRole('button', { name: /Ficar Online/i });
        const acceptBtn = walkerPage!.locator('[data-testid="walker-accept-button"]');
        await expect
          .poll(
            async () => {
              if (await acceptBtn.isVisible()) return true;
              if (await onlineBtn.isVisible()) {
                await onlineBtn.click().catch(() => {});
                await walkerPage!.waitForTimeout(2000);
              }
              return await acceptBtn.isVisible();
            },
            { timeout: 45000, message: 'Oferta visível no PetWalker (aceite pela UI)' }
          )
          .toBeTruthy();

        await acceptBtn.click();

        await expect
          .poll(
            () => {
              const rpc = lastRpc('accept_walk_request');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'accept_walk_request HTTP 200 + true' }
          )
          .toBeTruthy();
      });

      await test.step('accepted → heading via ActiveWalkSheet (1 clique REAL)', async () => {
        const sheetHeadingBtn = walkerPage!.getByRole('button', { name: /Iniciar deslocamento/i });
        await expect(sheetHeadingBtn).toBeVisible({ timeout: 30000 });
        await sheetHeadingBtn.click();

        await expect
          .poll(
            () => {
              const rpc = lastRpc('petwalker_start_heading');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'petwalker_start_heading HTTP 200 + true' }
          )
          .toBeTruthy();

        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return s.current_status === 'heading_to_pickup';
            },
            { timeout: 20000, message: 'heading_to_pickup no banco' }
          )
          .toBeTruthy();

        await expect(walkerPage!).toHaveURL(new RegExp(`/petwalker/passeio/${sessionId}`), {
          timeout: 20000,
        });
      });

      await test.step("heading → arrived via 'Cheguei no Local' (GPS real + T6 in-page)", async () => {
        const arriveBtn = walkerPage!.getByRole('button', { name: /Cheguei no Local/i });
        await expect(arriveBtn).toBeVisible({ timeout: 30000 });

        const preClickPathname = new URL(walkerPage!.url()).pathname;
        expect(preClickPathname).toBe(`/petwalker/passeio/${sessionId}`);

        // Handler-entry (B): setArriving(true) → "Processando..." (race-safe).
        const processandoProbe = (async () => {
          try {
            await walkerPage!
              .getByRole('button', { name: /Processando/i })
              .waitFor({ state: 'visible', timeout: 4000 });
            arriveObs.handlerEntryObserved = true;
            log('handler-entry observado: botão em "Processando..." (setArriving(true))');
          } catch {
            log('handler-entry: "Processando..." não observado em 4s (fato factual, não falha)');
          }
        })();

        // UMA única ação real de usuário: o clique no botão do produto.
        await arriveBtn.click();
        await processandoProbe;

        // Resposta REAL do petwalker_arrive_pickup: HTTP 200 + body true —
        // autoridade = observação in-page T6 (ZERO leitores CDP do body).
        try {
          await expect
            .poll(
              () => {
                const rpc = lastRpc('petwalker_arrive_pickup');
                return !!(rpc && rpc.status === 200 && rpc.body === true);
              },
              { timeout: 20000, intervals: [250, 500, 1000] }
            )
            .toBeTruthy();
        } catch (err) {
          throw new Error(
            `${arriveRpcTimeoutDiagnostic({ pathname: preClickPathname })} | underlying=${err instanceof Error ? err.message : String(err)}`
          );
        }
        log('petwalker_arrive_pickup real observado (HTTP 200 + true, via UI "Cheguei no Local")');

        // Backend: MESMA sessão agora arrived, MESMO Walker.
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('current_status, walker_id')
                .eq('id', sessionId)
                .single();
              return data?.current_status === 'arrived' && data.walker_id === walkerId;
            },
            { timeout: 20000, message: 'current_status arrived no banco' }
          )
          .toBeTruthy();
        log('backend arrived confirmado após "Cheguei no Local"');
      });

      await test.step('owner: PIN real renderizado na UI (/historico/:id) — NUNCA admin', async () => {
        await ownerPage!.goto(`/historico/${sessionId}`);
        const pinDisplay = ownerPage!.getByTestId('pickup-pin-display');
        await expect(pinDisplay).toBeVisible({ timeout: 20000 });

        let pin = '';
        await expect
          .poll(
            async () => {
              pin = (await pinDisplay.innerText()).trim();
              return /^[0-9]{6}$/.test(pin);
            },
            { timeout: 20000, message: 'PIN de 6 dígitos renderizado pela UI do Owner' }
          )
          .toBeTruthy();
        expect(pin).toMatch(/^[0-9]{6}$/);
        ownerPin = pin;
        log(`PIN lido da UI do OWNER (nunca via admin): ${ownerPin}`);

        const s = await auditSession(sessionId);
        expect(s.current_status).toBe('arrived');
      });

      await test.step('walker: PIN digitado pela UI → petwalker_confirm_pickup → in_progress', async () => {
        const pinInput = walkerPage!.getByTestId('pickup-pin-input');
        await expect(pinInput).toBeVisible({ timeout: 20000 });
        // O PIN preenchido vem EXCLUSIVAMENTE da UI do Owner (ownerPin).
        await pinInput.fill(ownerPin);

        const submitBtn = walkerPage!.getByTestId('pickup-pin-submit');
        await expect(submitBtn).toBeEnabled({ timeout: 10000 });

        // Contrato CERTIFICADO 4.4: sucesso provado por HTTP 200 real +
        // reload REAL do produto (só ocorre em data === true) + DB in_progress
        // + UI walk-in-progress-marker.
        const confirmPickupResponsePromise = walkerPage!.waitForResponse(
          (res) =>
            res.url().includes('/rest/v1/rpc/petwalker_confirm_pickup') &&
            res.request().method() === 'POST',
          { timeout: 20000 }
        );
        const confirmPickupReloadPromise = walkerPage!.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        await submitBtn.click();

        const confirmPickupResponse = await confirmPickupResponsePromise;
        expect(confirmPickupResponse.status()).toBe(200);
        await confirmPickupReloadPromise;

        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return (
                s.status === 'in_progress' &&
                s.current_status === 'in_progress' &&
                s.walker_id === walkerId
              );
            },
            { timeout: 20000, message: 'in_progress/in_progress + walker_id (MESMA sessão)' }
          )
          .toBeTruthy();

        await expect(walkerPage!.getByTestId('walk-in-progress-marker')).toBeVisible({ timeout: 15000 });
        log('petwalker_confirm_pickup real (HTTP 200 + reload) + backend in_progress + walk-in-progress-marker');
      });

      await test.step('SETUP de retomada: banner REAL /inicio → ?resume → UI in_progress', async () => {
        // Re-entrada legítima de produto — NENHUM ?resume injetado pelo teste.
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 15000 });

        const s = await auditSession(sessionId);
        expect(s.current_status).toBe('in_progress');

        const banner = ownerPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner).toBeVisible({ timeout: 30000 });
        await banner.click();

        // O PRÓPRIO banner cria a URL de retomada.
        await expect
          .poll(
            () => {
              const u = new URL(ownerPage!.url());
              return u.pathname === '/search-walk' && u.searchParams.get('resume') === sessionId;
            },
            { timeout: 15000, message: 'pathname /search-walk + ?resume=<MESMA sessionId> (criado pelo banner)' }
          )
          .toBeTruthy();

        // UI in_progress hidratada (certificado 4.5A2.4).
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 20000 });
        log('SETUP: UI in_progress hidratada via banner (?resume criado pelo produto)');
      });

      await test.step('TRANSIÇÃO REAL para returning: UM clique no request-return-button', async () => {
        expect((rpcCalls['customer_request_return'] || []).length).toBe(0);
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 15000 });

        // A ÚNICA ação permitida para iniciar returning: o clique REAL na UI.
        await ownerPage!.getByTestId('request-return-button').click();

        await expect
          .poll(
            () => {
              const rpc = lastRpc('customer_request_return');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'customer_request_return HTTP 200 + true (via UI REAL)' }
          )
          .toBeTruthy();
        log('customer_request_return real observado (HTTP 200 + true, via UI)');

        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return (
                s.id === sessionId &&
                s.customer_id === ownerId &&
                s.walker_id === walkerId &&
                s.pet_id === petId &&
                s.status === 'returning' &&
                s.current_status === 'returning'
              );
            },
            { timeout: 20000, message: 'returning/returning + MESMA sessão/Owner/Walker/Pet' }
          )
          .toBeTruthy();

        await expect(ownerPage!.getByTestId('owner-returning-state')).toBeVisible({ timeout: 15000 });
        await expect(ownerPage!.getByTestId('confirm-return-arrival-button')).toBeVisible({ timeout: 15000 });
        await expect(ownerPage!.getByTestId('request-return-button')).toHaveCount(0);
        log('owner-returning-state + confirm-return-arrival-button visíveis; request-return-button ausente');
      });

      await test.step('PRÉ-CONDIÇÃO da conclusão: ?resume do banner intacto + backend returning + UI returning', async () => {
        // O ?resume legítimo criado ANTES pelo banner continua na URL — é a
        // âncora de recuperação certificada por esta fase (nada injetado).
        const u = new URL(ownerPage!.url());
        expect(u.pathname).toBe('/search-walk');
        expect(u.searchParams.get('resume')).toBe(sessionId);

        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('returning');
        expect(s.current_status).toBe('returning');

        await expect(ownerPage!.getByTestId('owner-returning-state')).toBeVisible({ timeout: 15000 });
        await expect(ownerPage!.getByTestId('confirm-return-arrival-button')).toBeVisible({ timeout: 15000 });

        // customer_confirm_arrival NUNCA foi chamado até aqui (monotônico).
        expect((rpcCalls['customer_confirm_arrival'] || []).length).toBe(0);
      });

      await test.step('janela factual: aguarda >= 61s desde start_time (actual_duration_minutes >= 1, contrato 4.4)', async () => {
        // Gate factual determinístico (não é sleep cego): a métrica
        // actual_duration_minutes é derivada de start_time/end_time pelo
        // backend; garantimos >= 61s de relógio desde start_time para o
        // contrato >= 1 minuto ser verdadeiro em qualquer ambiente.
        const s0 = await auditSession(sessionId);
        const startedAt = new Date(s0.start_time).getTime();
        await expect
          .poll(async () => Date.now() - startedAt, {
            timeout: 90_000,
            intervals: [1000],
            message: '>= 61s desde start_time (factual)',
          })
          .toBeGreaterThanOrEqual(61_000);
        log('janela factual de 61s desde start_time cumprida (actual_duration_minutes >= 1 garantido)');
      });

      await test.step('TRANSIÇÃO REAL para completed: UM clique no confirm-return-arrival-button', async () => {
        // A ÚNICA ação permitida para concluir: o clique REAL na UI do Owner.
        await ownerPage!.getByTestId('confirm-return-arrival-button').click();

        // Contrato CERTIFICADO 4.4: customer_confirm_arrival HTTP 200 + true.
        await expect
          .poll(
            () => {
              const rpc = lastRpc('customer_confirm_arrival');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'customer_confirm_arrival HTTP 200 + true (via UI REAL)' }
          )
          .toBeTruthy();
        log('customer_confirm_arrival real observado (HTTP 200 + true, via UI "Confirmar chegada")');

        // Backend autoritativo: MESMA sessão, status + current_status completed.
        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return (
                s.id === sessionId &&
                s.customer_id === ownerId &&
                s.walker_id === walkerId &&
                s.pet_id === petId &&
                s.status === 'completed' &&
                s.current_status === 'completed'
              );
            },
            { timeout: 20000, message: 'completed/completed + MESMA sessão/Owner/Walker/Pet' }
          )
          .toBeTruthy();

        // Métricas persistidas (contrato 4.4).
        const s = await auditSession(sessionId);
        expect(s.end_time).not.toBeNull();
        expect(Number(s.actual_duration_minutes)).toBeGreaterThanOrEqual(1);
        expect(Number(s.distance_km)).toBeGreaterThanOrEqual(0);

        // Terminal do Walker (contrato 4.4): sem passeio ativo.
        const prof = await auditWalkerProfile();
        expect(prof.current_walk_id).toBeNull();
        log('backend completed + métricas persistidas + walker current_walk_id NULL');
      });

      await test.step('PRÉ-RELOAD: ReviewWalk pendente SEM navegação (?resume intacto) — review NÃO submetida', async () => {
        // SEM navegação após a conclusão: a URL legítima ?resume permanece.
        const u = new URL(ownerPage!.url());
        expect(u.pathname).toBe('/search-walk');
        expect(u.searchParams.get('resume')).toBe(sessionId);

        // ReviewWalk restaura automaticamente (sessionStatus='completed' →
        // searchStatus='reviewing').
        await expect(ownerPage!.getByTestId('review-walk-screen')).toBeVisible({ timeout: 20000 });

        // Métricas factuais persistidas (contrato certificado 4.4).
        const s = await auditSession(sessionId);
        const actual = Number(s.actual_duration_minutes);
        const distanceDisplay = (Number(s.distance_km) || 0).toFixed(2);
        await expect(ownerPage!.getByTestId('review-duration')).toHaveText(`${actual}`);
        await expect(ownerPage!.getByTestId('review-distance')).toHaveText(distanceDisplay);

        // Review NÃO é submetida: sem estrelas, sem comentário, sem clique.
        // Contadores: confirm_arrival EXATAMENTE 1; submit_review EXATAMENTE 0.
        const c = lifecycleCounts();
        expect(c.create).toBe(1);
        expect(c.accept).toBe(1);
        expect(c.heading).toBe(1);
        expect(c.arrive).toBe(1);
        expect(c.confirmPickup).toBe(1);
        expect(c.returnReq).toBe(1);
        expect(c.confirmArrival).toBe(1);
        expect(c.submitReview).toBe(0);
        log('pré-reload: ReviewWalk pendente com métricas factuais (?resume intacto; review NÃO submetida)');
      });

      await test.step('AÇÃO DE RESILIÊNCIA: reload da MESMA página ?resume=<sessionId>', async () => {
        // Contadores MONOTÔNICOS registrados ANTES do reload (todos os 8).
        const before = lifecycleCounts();
        createCountBeforeReload = before.create;
        acceptCountBeforeReload = before.accept;
        headingCountBeforeReload = before.heading;
        arriveCountBeforeReload = before.arrive;
        confirmPickupCountBeforeReload = before.confirmPickup;
        returnRequestCountBeforeReload = before.returnReq;
        confirmArrivalCountBeforeReload = before.confirmArrival;
        submitReviewCountBeforeReload = before.submitReview;
        expect(confirmArrivalCountBeforeReload).toBe(1);
        expect(submitReviewCountBeforeReload).toBe(0);

        // A URL legítima ?resume=<sessionId> (criada pelo banner) permanece.
        expect(new URL(ownerPage!.url()).searchParams.get('resume')).toBe(sessionId);

        await ownerPage!.reload({ waitUntil: 'domcontentloaded' });
        log(`reloaded: ${ownerPage!.url()}`);
      });

      await test.step('VERDADE PÓS-RELOAD (ZERO ações do usuário): ReviewWalk restaura automaticamente', async () => {
        // 1+2. URL preservada pelo produto: pathname + MESMO ?resume.
        await expect
          .poll(() => new URL(ownerPage!.url()).pathname, {
            timeout: 15000,
            message: 'pathname permanece /search-walk após reload',
          })
          .toBe('/search-walk');
        await expect
          .poll(() => new URL(ownerPage!.url()).searchParams.get('resume') ?? '', {
            timeout: 15000,
            message: '?resume=<MESMA sessionId> preservado após reload',
          })
          .toBe(sessionId);
        log(`pós-reload: ${ownerPage!.url()}`);

        // 3. Backend: MESMA sessão completed, MESMO Owner/Walker/Pet —
        //    sem regressão a returning/in_progress, sem sessão nova.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('completed');
        expect(s.current_status).toBe('completed');

        // 4. Métricas persistidas permanecem intactas.
        expect(s.end_time).not.toBeNull();
        expect(Number(s.actual_duration_minutes)).toBeGreaterThanOrEqual(1);
        expect(Number(s.distance_km)).toBeGreaterThanOrEqual(0);

        // 5+6+7. ReviewWalk restaura automaticamente com as MESMAS métricas.
        await expect(ownerPage!.getByTestId('review-walk-screen')).toBeVisible({ timeout: 30000 });
        const actual = Number(s.actual_duration_minutes);
        const distanceDisplay = (Number(s.distance_km) || 0).toFixed(2);
        await expect(ownerPage!.getByTestId('review-duration')).toHaveText(`${actual}`);
        await expect(ownerPage!.getByTestId('review-distance')).toHaveText(distanceDisplay);

        // 8. A UI operacional ativa NÃO reaparece (completed é terminal).
        await expect(ownerPage!.getByTestId('request-return-button')).toHaveCount(0);
        await expect(ownerPage!.getByTestId('owner-returning-state')).toHaveCount(0);
        await expect(ownerPage!.getByTestId('confirm-return-arrival-button')).toHaveCount(0);

        // 9. Invariâncias TERMINAIS (completed NÃO é classificado como ativo):
        //    exatamente UMA sessão do run e do Owner/Pet (qualquer status);
        //    ZERO sessões ativas; walker terminal.
        const { data: runSessions, error: rErr } = await admin
          .from('walk_sessions')
          .select('id, current_status')
          .eq('e2e_run_id', runId);
        if (rErr) throw new Error(`run_sessions_failed: ${JSON.stringify(rErr)}`);
        expect(runSessions || []).toHaveLength(1);
        expect(runSessions![0].id).toBe(sessionId);
        expect(runSessions![0].current_status).toBe('completed');

        const { data: ownerAll, error: oAllErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('customer_id', ownerId);
        if (oAllErr) throw new Error(`owner_all_sessions_failed: ${JSON.stringify(oAllErr)}`);
        expect(ownerAll || []).toHaveLength(1);
        expect(ownerAll![0].id).toBe(sessionId);

        const { data: petAll, error: pAllErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('pet_id', petId);
        if (pAllErr) throw new Error(`pet_all_sessions_failed: ${JSON.stringify(pAllErr)}`);
        expect(petAll || []).toHaveLength(1);

        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(0);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(0);
        const prof = await auditWalkerProfile();
        expect(prof.current_walk_id).toBeNull();

        // ZERO efeitos colaterais: TODOS os 8 contadores ANTES/DEPOIS.
        expect((rpcCalls['create_walk_request'] || []).length).toBe(createCountBeforeReload);
        expect((rpcCalls['accept_walk_request'] || []).length).toBe(acceptCountBeforeReload);
        expect((rpcCalls['petwalker_start_heading'] || []).length).toBe(headingCountBeforeReload);
        expect((rpcCalls['petwalker_arrive_pickup'] || []).length).toBe(arriveCountBeforeReload);
        expect((rpcCalls['petwalker_confirm_pickup'] || []).length).toBe(confirmPickupCountBeforeReload);
        expect((rpcCalls['customer_request_return'] || []).length).toBe(returnRequestCountBeforeReload);
        // CRÍTICO: confirm_arrival EXATAMENTE 1 total (reload NÃO reconfirma).
        expect((rpcCalls['customer_confirm_arrival'] || []).length).toBe(confirmArrivalCountBeforeReload);
        expect((rpcCalls['customer_confirm_arrival'] || []).length).toBe(1);
        // CRÍTICO: submit_review EXATAMENTE 0 (reload NÃO submete review).
        expect((rpcCalls['customer_submit_walk_review'] || []).length).toBe(submitReviewCountBeforeReload);
        expect((rpcCalls['customer_submit_walk_review'] || []).length).toBe(0);
        log('pós-reload: ReviewWalk restaurada com métricas factuais + backend completed íntegro + ZERO RPCs duplicadas + confirm_arrival=1 + submit_review=0');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos', async () => {
        // T3: desinstala os observadores de chegada (higiene de listeners).
        if (walkerPage) detachArriveObservers();
        if (walkerCtx) await walkerCtx.close().catch(() => {});
        if (ownerCtx) await ownerCtx.close().catch(() => {});
        // Sessão criada pela UI: remoção direta fail-closed (filhos → sessão),
        // cobrindo inclusive o caso de falha antes da tag e2e_run_id.
        if (sessionId) {
          const children = [
            { table: 'walk_pickup_codes', col: 'session_id' },
            { table: 'walker_tracking', col: 'walk_session_id' },
            { table: 'walk_offers', col: 'session_id' },
            { table: 'petwalker_earnings', col: 'walk_session_id' },
          ] as const;
          for (const child of children) {
            const { error: delErr } = await admin.from(child.table).delete().eq(child.col, sessionId);
            if (delErr) throw new Error(`cleanup_child_failed ${child.table}: ${JSON.stringify(delErr)}`);
          }
          const { error: sessDelErr } = await admin.from('walk_sessions').delete().eq('id', sessionId);
          if (sessDelErr) throw new Error(`cleanup_session_failed: ${JSON.stringify(sessDelErr)}`);
        }
        // Usuários/perfis/pet: helper certificado (valida metadata E2E do run).
        if (runId && ownerId && walkerId) {
          await failClosedCleanup(admin, [ownerId, walkerId], runId);
        }
        log('cleanup concluído — zero resíduos');
      });
    }
  });
});
