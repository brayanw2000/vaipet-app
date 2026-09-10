/**
 * PHASE 4.5A2.4 — OWNER IN_PROGRESS RESUME / RELOAD RECOVERY — TEST-ONLY FIRST PROOF
 *
 * Baseline certificada (NÃO reabrir/redecorar):
 *   - 4.4 (tests/full-journey-operational-4.4.spec.ts) prova a jornada REAL
 *     completa: create UI → searching → matching → accept UI → heading UI →
 *     arrived UI → PIN REAL via UI do Owner → confirm_pickup UI → in_progress
 *     → GPS → returning → completed → review → history.
 *   - 4.5A já certificou Owner reload recovery para: searching, accepted,
 *     heading_to_pickup, arrived (TODOS GREEN).
 *
 * O QUE ESTE TESTE PROVA (4.5A2.4) — apenas o contrato EXISTENTE de retomada:
 *   A) Normal mount auto-discovery cobre EXATAMENTE:
 *      searching / accepted / heading_to_pickup / arrived (NÃO alterado;
 *      in_progress NÃO é adicionado — arquitetura intencional do produto).
 *   B) Active-walk resume flow cobre in_progress/returning/completed via
 *      ?resume=<walk_session_id>, entrada REAL pelo banner "Passeio em
 *      andamento" (ActiveWalkBanner) em /inicio — o PRÓPRIO banner cria a URL
 *      /search-walk?resume=<sessionId>; o teste NUNCA injeta ?resume na prova.
 *
 * JORNADA REAL (réplica da certificada 4.4, como SETUP até in_progress):
 *   Owner UI create_walk_request        → searching
 *   admin.rpc('process_walk_matching')  → oferta real (scheduler simulado)
 *   Walker UI accept_walk_request       → accepted
 *   Walker UI petwalker_start_heading   → heading_to_pickup
 *   Walker UI "Cheguei no Local" (GPS)  → petwalker_arrive_pickup → arrived
 *   Owner PIN REAL lido da UI           → Walker digita o PIN na UI
 *   petwalker_confirm_pickup (UI real)  → in_progress
 *
 * OBSERVABILIDADE DA CHEGADA: reuso da técnica T6 certificada no
 * owner-arrived-recovery (clone in-page da Response REAL via
 * exposeBinding + addInitScript, lido ANTES de a Response original voltar ao
 * app). NÃO reutiliza as abordagens abandonadas T3/T4/T5: nenhum leitor CDP
 * (res.text/json/body) como autoridade do body da chegada, nenhuma rota de
 * retenção de reload, nenhum preflight artificial de GPS.
 *
 * CONTRATO CONFIRM PICKUP (certificado 4.4, reutilizado verbatim):
 *   HTTP 200 real + reload REAL do produto (só ocorre em data === true) +
 *   backend in_progress + walk-in-progress-marker — NÃO inventamos contrato
 *   frágil de body para petwalker_confirm_pickup.
 *
 * NOVA PROVA 4.5A2.4:
 *   1. Owner navega legitimamente a /inicio (re-entrada de produto).
 *   2. Banner REAL "Passeio em andamento" aparece automaticamente.
 *   3. UM clique no banner → /search-walk?resume=<MESMA sessionId> (URL criada
 *      pelo próprio banner).
 *   4. UI in_progress hidrata: request-return-button visível + backend
 *      in_progress + MESMA sessão/Owner/Walker/Pet + 1 sessão ativa por dono
 *      e por pet + ZERO RPCs de lifecycle duplicadas pela retomada.
 *   5. ownerPage.reload({ waitUntil: 'domcontentloaded' }) e ZERO ações.
 *   6. Pós-reload: pathname /search-walk, ?resume=<MESMA sessionId>,
 *      backend íntegro, 1 sessão ativa Owner/Pet, ZERO novas RPCs de lifecycle
 *      (create/accept/heading/arrive/confirm) e NENHUM customer_request_return
 *      disparado pelo reload; request-return-button restaura automaticamente.
 *
 * REGRAS:
 * - O teste NUNCA chama diretamente: create_walk_request, accept_walk_request,
 *   petwalker_start_heading, petwalker_arrive_pickup, customer_get_pickup_code
 *   (fonte do PIN), petwalker_confirm_pickup, customer_request_return.
 *   ÚNICA exceção certificada: admin.rpc('process_walk_matching') (scheduler).
 * - O PIN vem EXCLUSIVAMENTE da UI do Owner (pickup-pin-display).
 * - NÃO insere walk_sessions nem walk_offers manualmente.
 * - NÃO testa /search-walk sem ?resume para in_progress (arquitetura
 *   intencional: auto-discovery ≠ resume flow).
 * - Cleanup fail-closed: ZERO resíduos; qualquer falha de cleanup falha a
 *   suíte.
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

// Estados ativos (não terminais) do domínio.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

// T6: filtro estrito de console — apenas erros relevantes ao caminho de
// chegada. NUNCA dumpa objetos arbitrários: apenas a mensagem de texto.
const ARRIVE_CONSOLE_FILTER = /arriv|pickup|GPS|geolocation|supabase|fetch|confirm/i;

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5a2.4-owner-in-progress-recovery] ${msg}`);

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
  // signup_intent para profiles — sem isto o PetwalkerGpsProvider mantém
  // isPetwalker=false e o Painel nunca fica online.
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
      // Próximo ao ponto de encontro para o matching ST_DWithin.
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

test.describe('Phase 4.5A2.4: Owner in_progress resume/reload recovery (banner ?resume flow)', () => {
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

  // Contadores de lifecycle RPC antes do reload (nenhuma nova pode ocorrer).
  let createCountBeforeReload = 0;
  let acceptCountBeforeReload = 0;
  let startHeadingCountBeforeReload = 0;
  let arriveCountBeforeReload = 0;
  let confirmCountBeforeReload = 0;
  let returnRequestCountBeforeReload = 0;

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
  // O window.location.reload() imediato do produto torna o recurso de resposta
  // CDP não confiável. A autoridade ÚNICA do body é o PRÓPRIO renderer: wrapper
  // transparente de window.fetch (addInitScript ANTES de qualquer JS do app)
  // clona a resposta REAL, lê o clone, envia fatos SEGUROS via exposeBinding e
  // devolve a Response ORIGINAL intocada. Nada é mockado.
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

  const lifecycleCounts = () => ({
    create: (rpcCalls['create_walk_request'] || []).length,
    accept: (rpcCalls['accept_walk_request'] || []).length,
    heading: (rpcCalls['petwalker_start_heading'] || []).length,
    arrive: (rpcCalls['petwalker_arrive_pickup'] || []).length,
    confirm: (rpcCalls['petwalker_confirm_pickup'] || []).length,
    returnReq: (rpcCalls['customer_request_return'] || []).length,
  });

  test('Owner in_progress: banner REAL /inicio cria ?resume e reload restaura a UI sem ação', async ({ browser }) => {
    runId = `4.5a2.4_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetInProgress45A24';

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

      await test.step('auditoria: searching + MESMA sessão + dono/pet corretos + 1 ativa', async () => {
        const s = await auditSession(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('searching');
        expect(s.current_status).toBe('searching');

        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);
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

      await test.step('PROVA accepted ANTES do deslocamento', async () => {
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('current_status, walker_id')
                .eq('id', sessionId)
                .single();
              return data?.current_status === 'accepted' && data.walker_id === walkerId;
            },
            { timeout: 20000, message: 'accepted + walker_id ANTES do deslocamento' }
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

        // Fato pré-clique: pathname EXATO do WalkDetails da MESMA sessão.
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
        // autoridade = observação in-page T6 (binding entregue ANTES de a
        // Response original voltar ao app; ZERO leitores CDP do body).
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

        // Contrato CERTIFICADO 4.4 (reutilizado): WalkDetails.handleConfirmPickup
        // executa window.location.reload() IMEDIATAMENTE após data === true —
        // sucesso provado por HTTP 200 real (request real) + reload REAL (só
        // ocorre no branch data === true) + DB in_progress + UI marker.
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

        // Backend: MESMA sessão, status + current_status in_progress, MESMO Walker.
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

        // Marker REAL do Walker na UI in_progress.
        await expect(walkerPage!.getByTestId('walk-in-progress-marker')).toBeVisible({ timeout: 15000 });
        log('petwalker_confirm_pickup real (HTTP 200 + reload) + backend in_progress + walk-in-progress-marker');
      });

      await test.step('NOVA PROVA 4.5A2.4: re-entrada legítima em /inicio (banner REAL)', async () => {
        // Navegação normal de produto (re-entrada) — NENHUM ?resume injetado.
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 15000 });

        // Backend continua a MESMA sessão in_progress MESMO Owner/Walker/Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.current_status).toBe('in_progress');

        // Banner REAL (ActiveWalkBanner): botão acessível "Passeio em andamento"
        // — consulta in_progress/returning do próprio produto.
        const banner = ownerPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner).toBeVisible({ timeout: 30000 });
        log('Home ActiveWalkBanner visível automaticamente (in_progress)');
      });

      await test.step('banner → clique ÚNICO → /search-walk?resume=<sessionId> criado PELO BANNER', async () => {
        const banner = ownerPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner).toBeVisible({ timeout: 15000 });

        // UM clique real no banner — é ele quem cria a URL de retomada.
        await banner.click();

        // Navegação automática do produto: pathname /search-walk + ?resume.
        await expect
          .poll(
            () => {
              const u = new URL(ownerPage!.url());
              return (
                u.pathname === '/search-walk' &&
                u.searchParams.get('resume') === sessionId
              );
            },
            { timeout: 15000, message: 'pathname /search-walk + ?resume=<MESMA sessionId> (criado pelo banner)' }
          )
          .toBeTruthy();
        log(`banner criou a retomada: ${ownerPage!.url()}`);
      });

      await test.step('PROVA pré-reload: UI in_progress hidratada + backend íntegro (ZERO ações)', async () => {
        // UI: CTA canônico in_progress (certificado 4.4) restaurado pela
        // retomada do próprio produto (ZERO ações do teste).
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 20000 });

        // Backend: MESMA sessão in_progress, MESMO Owner/Walker/Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');

        // Exatamente UMA sessão ativa do Owner e do Pet.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // Nenhuma RPC de lifecycle duplicada pela retomada do banner.
        const c = lifecycleCounts();
        expect(c.create).toBe(1); // apenas a create original da UI
        expect(c.returnReq).toBe(0); // nenhuma solicitação de retorno
        log('pré-reload: request-return-button visível + backend in_progress + invariâncias íntegras');
      });

      await test.step('AÇÃO DE RESILIÊNCIA: reload da MESMA página ?resume=<sessionId>', async () => {
        // Registrar contadores de lifecycle ANTES do reload.
        const before = lifecycleCounts();
        createCountBeforeReload = before.create;
        acceptCountBeforeReload = before.accept;
        startHeadingCountBeforeReload = before.heading;
        arriveCountBeforeReload = before.arrive;
        confirmCountBeforeReload = before.confirm;
        returnRequestCountBeforeReload = before.returnReq;
        // A URL legítima ?resume=<sessionId> (criada pelo banner) permanece —
        // o teste NÃO remove ?resume e NÃO testa auto-discovery puro aqui.
        expect(new URL(ownerPage!.url()).searchParams.get('resume')).toBe(sessionId);

        await ownerPage!.reload({ waitUntil: 'domcontentloaded' });
        log(`reloaded: ${ownerPage!.url()}`);
      });

      await test.step('VERDADE PÓS-RELOAD (ZERO ações do usuário): retomada automática intacta', async () => {
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

        // 3. Backend: MESMA sessão in_progress, MESMO Owner/Walker/Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');

        // 4+5. Exatamente UMA sessão ativa para Owner e para Pet.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // 6. ZERO novas RPCs de lifecycle causadas pelo reload do Owner —
        // comparação ANTES/DEPOIS monotônica (a observação ORIGINAL da
        // create_walk_request da UI não é zerada; reload → ZERO NOVAS chamadas).
        expect((rpcCalls['create_walk_request'] || []).length).toBe(createCountBeforeReload);
        expect((rpcCalls['accept_walk_request'] || []).length).toBe(acceptCountBeforeReload);
        expect((rpcCalls['petwalker_start_heading'] || []).length).toBe(startHeadingCountBeforeReload);
        expect((rpcCalls['petwalker_arrive_pickup'] || []).length).toBe(arriveCountBeforeReload);
        expect((rpcCalls['petwalker_confirm_pickup'] || []).length).toBe(confirmCountBeforeReload);
        // 8. Nenhuma solicitação de retorno disparada meramente pelo reload.
        expect((rpcCalls['customer_request_return'] || []).length).toBe(returnRequestCountBeforeReload);

        // 7. UI in_progress restaura automaticamente (ZERO ação).
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 30000 });

        // Backend permanece in_progress após a restauração da UI.
        const s2 = await auditSession(sessionId);
        expect(s2.current_status).toBe('in_progress');
        log('pós-reload: request-return-button restaurado automaticamente + backend in_progress íntegro + ZERO RPCs duplicadas');
      });

      await test.step('invariante final: MESMA sessão única do run', async () => {
        const { data: runSessions, error: rErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('e2e_run_id', runId);
        if (rErr) throw new Error(`run_sessions_failed: ${JSON.stringify(rErr)}`);
        expect(runSessions || []).toHaveLength(1);
        expect(runSessions![0].id).toBe(sessionId);
        log('IN_PROGRESS_RESUME_RECOVERY_4.5A2.4_PROOF_COMPLETED');
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
