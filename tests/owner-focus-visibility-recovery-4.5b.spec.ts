/**
 * PHASE 4.5B2 — OWNER BROWSER TAB VISIBILITY / FOCUS RECOVERY —
 * TEST-ONLY FIRST PROOF
 *
 * Diferença para as fases certificadas (NÃO reabertas):
 *   - 4.4       → jornada real completa (GREEN).
 *   - 4.5A      → recuperação por RELOAD/re-entrada (todos os estados, GREEN).
 *   - 4.5B1     → perda TEMPORÁRIA TOTAL DE REDE do Owner, página montada
 *                 convergindo sozinha pós-reconexão (GAP A + GAP B, GREEN),
 *                 mais o patch de produto P1 (autoridade de domínio em
 *                 WalkInProgress: in_progress/returning → phase walking).
 *   - 4.5B2     → NÃO é outro teste de rede offline. O Owner mantém a MESMA
 *                 página /search-walk MONTADA; a ABA do browser do Owner vai
 *                 para segundo plano (troca real de aba do ambiente de teste,
 *                 NÃO ação de produto); o Walker executa uma transição REAL;
 *                 quando a aba volta ao primeiro plano, a infraestrutura
 *                 EXISTENTE de focus/visibilitychange
 *                 (SearchWalk: onFocus → fetchStatus('recovery')) deve
 *                 produzir uma LEITURA REAL imediata e a apresentação deve
 *                 estar correta — sem reload, navegação, clique ou
 *                 qualquer ação de produto.
 *
 * ESCOPO (UMA transição representativa — suficiente: a recuperação por
 * focus/visibility é infraestrutura independente de estado):
 *
 *   heading_to_pickup
 *     → aba do Owner vai para segundo plano (foregroundDummyPage +
 *       bringToFront — troca de aba REAL do browser)
 *     → Walker REAL "Cheguei no Local" (T6) → backend arrived
 *     → baseline de leituras de status ENQUANTO OCULTO
 *     → ownerPage.bringToFront() (ÚNICA ação de retorno; nível browser)
 *     → visibilityState 'visible' / document.hidden === false
 *     → ≥1 NOVO GET real de walk_sessions p/ MESMA sessão dentro de ~3s
 *       (distingue a recuperação focus/visibility do polling de 5s)
 *     → apresentação arrived canônica do Owner (pickup-pin-input/submit +
 *       backend arrived) sem NENHUMA ação de produto
 *
 * OBSERVADOR DE LEITURA (somente leitura, NUNCA mock):
 *   Observa na ownerPage requests GET /rest/v1/walk_sessions cujo filtro
 *   `id` é exatamente eq.<sessionId>. Armazena APENAS fatos seguros
 *   (timestamp, method, pathname, filtro de sessão). NUNCA inspeciona/loga
 *   headers, Authorization, apikey, tokens ou cookies. NUNCA usa page.route
 *   — o request/response trafegam intocados.
 *
 * FAIL-CLOSED DE AMBIENTE: se o Chromium do ambiente NÃO tornar a ownerPage
 * document.visibilityState === 'hidden' após a troca real de aba, o teste
 * FALHA como BROWSER VISIBILITY TEST ENVIRONMENT UNSUPPORTED — NÃO é um RED
 * de produto e NUNCA é simulado via eventos sintéticos.
 *
 * JORNADA REAL (réplica certificada 4.5B1/4.4 como SETUP até
 * heading_to_pickup): Owner UI create → searching →
 * admin.rpc('process_walk_matching') (ÚNICA admin.rpc, scheduler simulado) →
 * Walker aceita pela UI → heading pela UI → heading_to_pickup.
 *
 * CONTRATO HONESTO:
 *   - NÃO exigimos que a UI fique obsoleta enquanto oculta: um bom produto
 *     PODE atualizar via realtime mesmo oculto. O contrato é CORREÇÃO no
 *     retorno do usuário + leitura real imediata de recuperação.
 *   - Este teste certifica APENAS visibilidade/foco de ABA de browser. NÃO
 *     certifica suspensão de OS, tela bloqueada, freeze de background iOS,
 *     kill de processo Android ou descarte de aba — esses exigem testes
 *     posteriores em dispositivo/manual e NÃO são declarados GREEN aqui.
 *
 * NUNCA (no arquivo inteiro): ownerPage.reload(); recriação/navegação da
 * ownerPage; eventos sintéticos de focus/visibility/blur; manipulação de
 * document.visibilityState; mock de GPS/Supabase/RPC; injeção de ?resume ou
 * storage; fetchStatus manual; RPCs de lifecycle manuais (exceção certificada:
 * admin.rpc('process_walk_matching')).
 *
 * CONTADORES MONOTÔNICOS: observações de RPC são acumulativas; antes do
 * foreground registramos as contagens e, após a recuperação, exigimos
 * IGUALDADE. Totais finais factuais: create=1, accept=1, heading=1, arrive=1,
 * confirmPickup=0, returnReq=0.
 *
 * FAIL-CLOSED: qualquer falha de cleanup FALHA a suíte; a página temporária
 * de visibilidade é fechada com segurança no finally.
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

// GPS do OWNER (browser) = ponto de encontro = home_location esperada.
const MEETING = { lng: -46.7, lat: -23.6 };
// GPS do WALKER (browser) ~14m do ponto de encontro — dentro do raio de
// matching ST_DWithin E do raio de chegada da petwalker_arrive_pickup
// (150m + LEAST(_accuracy, 50)) — fixture consistente com os testes 4.4/4.5A/B1.
const WALKER_POS = { lng: -46.7001, lat: -23.6001 };

// Estados ativos (não terminais) do domínio.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

// Filtro estrito de console — apenas erros relevantes. NUNCA dumpa objetos
// arbitrários (podem conter segredos): apenas a mensagem de texto.
const ARRIVE_CONSOLE_FILTER = /arriv|pickup|GPS|geolocation|supabase|fetch/i;

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5b2-owner-focus-visibility-recovery] ${msg}`);

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

  const { error: profErr } = await admin.from('profiles').upsert({
    id,
    full_name: `E2E ${kind}`,
    onboarding_completed: true,
    phone: '(11) 96666-6666',
    age: 32,
    // FIXTURE GAP (Blocker Patch A1): handle_new_user() não copia
    // signup_intent para profiles. Sem isto o PetwalkerGpsProvider mantém
    // isPetwalker=false e o Painel nunca fica online.
    signup_intent: kind,
  });
  if (profErr) throw new Error(`profile_upsert_failed: ${JSON.stringify(profErr)}`);

  // PREFLIGHT FACTUAL (fail-closed): provar que profiles.signup_intent === kind.
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
      last_known_location: `SRID=4326;POINT(${WALKER_POS.lng} ${WALKER_POS.lat})`,
    });
    if (wpErr) throw new Error(`walker_profile_failed: ${JSON.stringify(wpErr)}`);

    const { data: roles, error: rolesErr } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', id);
    if (rolesErr) throw new Error(`roles_preflight_failed: ${JSON.stringify(rolesErr)}`);
    if (!roles!.some((r) => r.role === 'petwalker')) {
      throw new Error('walker_role_missing: user_roles sem petwalker');
    }

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

test.describe('Phase 4.5B2: Owner browser-tab visibility/focus recovery (no reload)', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 300_000 });

  let runId = '';
  let ownerId = '';
  let walkerId = '';
  let petId = '';
  let sessionId = '';
  let ownerEmail = '';
  let walkerEmail = '';
  let ownerCtx: BrowserContext | null = null;
  let walkerCtx: BrowserContext | null = null;
  let ownerPage: Page | null = null;
  let walkerPage: Page | null = null;
  // Página TEMPORÁRIA e NEUTRA do MESMO ownerCtx — existe APENAS para troca
  // real de aba (backgrounding). Navega apenas a about:blank; nenhum app JS.
  let foregroundDummyPage: Page | null = null;

  // URL EXATA do Owner (produzida pelo produto real, capturada de
  // ownerPage.url() — NUNCA construída) antes do backgrounding. A página
  // MONTADA deve mantê-la intacta após o foreground.
  let ownerUrlBeforeBackground = '';

  // Contadores monotônicos de RPC (NUNCA resetados — comparação antes/depois).
  let createCountBeforeForeground = 0;
  let acceptCountBeforeForeground = 0;
  let headingCountBeforeForeground = 0;
  let arriveCountBeforeForeground = 0;
  let confirmPickupCountBeforeForeground = 0;
  let returnReqCountBeforeForeground = 0;

  // Baseline de leituras de status REAIS, gravado ENQUANTO a aba está oculta
  // (após backend arrived confirmado). A prova de recuperação exige ≥1 NOVA
  // leitura após o foreground em janela curta (~3s).
  let statusReadCountBeforeForeground = 0;

  // ——— Observador SAFE de leituras de status (somente leitura; NUNCA mock) ———
  // Fatos armazenados: timestamp, method, pathname e o filtro de sessão.
  // NUNCA headers/Authorization/apikey/tokens/cookies. NUNCA page.route.
  type StatusRead = { timestamp: number; method: string; pathname: string; sessionFilter: string };
  const statusReads: StatusRead[] = [];
  let detachStatusReadObserver: () => void = () => {};

  const armStatusReadObserver = (page: Page) => {
    const onStatusRead = (req: Request) => {
      try {
        if (req.method() !== 'GET') return;
        const u = new URL(req.url());
        if (u.pathname !== '/rest/v1/walk_sessions') return;
        // A leitura deve identificar a MESMA sessão pelo filtro canônico.
        const sessionFilter = u.searchParams.get('id') || '';
        if (sessionFilter !== `eq.${sessionId}`) return;
        statusReads.push({
          timestamp: Date.now(),
          method: req.method(),
          pathname: u.pathname,
          sessionFilter,
        });
        log(`STATUS_READ_OBSERVED GET ${u.pathname} id=${sessionFilter} (#${statusReads.length})`);
      } catch {
        /* URL inválida — ignora */
      }
    };
    page.on('request', onStatusRead);
    detachStatusReadObserver = () => {
      page.off('request', onStatusRead);
      detachStatusReadObserver = () => {};
    };
  };

  // ——— Observador factual das respostas RPC reais da página (HTTP + body) ———
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

  const lifecycleCounts = () => ({
    create: (rpcCalls['create_walk_request'] || []).length,
    accept: (rpcCalls['accept_walk_request'] || []).length,
    heading: (rpcCalls['petwalker_start_heading'] || []).length,
    arrive: (rpcCalls['petwalker_arrive_pickup'] || []).length,
    confirmPickup: (rpcCalls['petwalker_confirm_pickup'] || []).length,
    returnReq: (rpcCalls['customer_request_return'] || []).length,
  });

  // ——— T6: observador IN-PAGE do body REAL da chegada (sem CDP race) ———
  // Idêntico ao certificado em tests/owner-arrived-recovery-4.5a.spec.ts e
  // reutilizado verbatim na 4.5B1: exposeBinding + addInitScript (ANTES de
  // qualquer JS do app) instalam um wrapper TRANSPARENTES de window.fetch —
  // para a RPC de chegada apenas, executa o fetch nativo ORIGINAL, clona a
  // resposta REAL (response.clone()), lê o clone, entrega os fatos SEGUROS
  // (status + body + pathname — sem headers/tokens) ao Node e devolve a
  // Response ORIGINAL intocada ao app.
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
    fetchCloneObservations: 0,
  };

  const armInPageArriveObserver = async (ctx: BrowserContext) => {
    await ctx.exposeBinding(ARRIVE_RPC_BINDING, async (source, payload: unknown) => {
      // Apenas o frame principal da página do Walker (ignora iframes).
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

  // ——— T3: observabilidade factual e SEGURA do caminho de chegada ———
  let detachArriveObservers: () => void = () => {};

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
    // Apenas STATUS HTTP — NENHUM leitor de body CDP (a autoridade do body é
    // a observação in-page via fetch clone).
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

  test('Owner montado em aba oculta: Walker chega REALMENTE; foreground produz leitura de recuperação e apresentação arrived SEM ação', async ({ browser }) => {
    runId = `4.5b2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetFocus45B2';

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

      await test.step('login real via /auth (owner + walker) + observadores RPC', async () => {
        walkerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          // Fixture = estratégia certificada 4.4: posição real do Walker.
          geolocation: { longitude: WALKER_POS.lng, latitude: WALKER_POS.lat, accuracy: 10 },
        });
        ownerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: { longitude: MEETING.lng, latitude: MEETING.lat },
        });
        // T6: observador in-page do body da chegada instalado NO CONTEXT, ANTES
        // da criação da página e de qualquer JS do app.
        await armInPageArriveObserver(walkerCtx);
        walkerPage = await walkerCtx.newPage();
        ownerPage = await ownerCtx.newPage();
        await loginViaUi(ownerPage, ownerEmail);
        await loginViaUi(walkerPage, walkerEmail);
        armRpcObserver(ownerPage, 'create_walk_request');
        armRpcObserver(ownerPage, 'customer_request_return'); // RPC do LADO DO OWNER
        armRpcObserver(walkerPage, 'petwalker_confirm_pickup');
        armRpcObserver(walkerPage, 'accept_walk_request');
        armRpcObserver(walkerPage, 'petwalker_start_heading');
        armArriveObservers(walkerPage); // T3: observabilidade factual da chegada
        // Observador SAFE de leituras de status na ownerPage (somente leitura;
        // usa o sessionId do escopo — a sessão ainda não existe, mas o closure
        // é avaliado por evento e o sessionId é atribuído antes de qualquer
        // leitura relevante).
        armStatusReadObserver(ownerPage);
      });

      await test.step('owner: criar pedido pela UI REAL (create_walk_request) → searching', async () => {
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 10000 });
        await expect(ownerPage!.locator('#tour-start-walk')).toBeVisible({ timeout: 10000 });
        await ownerPage!.locator('#tour-start-walk').click();

        const bottomSheet = ownerPage!.locator('h2, div').filter({ hasText: /INICIAR O PASSEIO/i }).first();
        await expect(bottomSheet).toBeVisible({ timeout: 15000 });

        const petLabel = ownerPage!.getByText(petName).first();
        await expect(petLabel).toBeVisible({ timeout: 15000 });
        const continueBtn = ownerPage!.locator('button').filter({ hasText: /Selecione|Continuar/i }).last();
        await expect
          .poll(
            async () => {
              const targets = ownerPage!.locator('div, button, span, p').filter({ hasText: petName });
              const count = await targets.count();
              for (let i = 0; i < count; i++) {
                await targets.nth(i).click().catch(() => {});
              }
              const text = await continueBtn.innerText();
              return text.includes('Continuar') && !text.includes('Selecione');
            },
            { timeout: 30000, message: 'Pet selecionado' }
          )
          .toBeTruthy();

        const contBtn = ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last();
        await expect(contBtn).toBeEnabled({ timeout: 10000 });
        await contBtn.click();

        const walkTypeBtn = ownerPage!.locator('button').filter({ hasText: /Livre|Coletivo/i }).first();
        await expect(walkTypeBtn).toBeVisible({ timeout: 15000 });
        await walkTypeBtn.click();
        await ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last().click();

        await expect(ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last()).toBeVisible({
          timeout: 10000,
        });
        await ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last().click();

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
        sessionId = created.id;
        log(`session_id criado pela UI: ${sessionId}`);

        const { error: tagErr } = await admin
          .from('walk_sessions')
          .update({ e2e_test: true, e2e_run_id: runId })
          .eq('id', sessionId);
        if (tagErr) throw new Error(`session_tag_failed: ${JSON.stringify(tagErr)}`);
      });

      await test.step('auditoria: searching + MESMA sessão + dono/pet corretos', async () => {
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

      await test.step('matching job: oferta real via process_walk_matching (ÚNICA admin.rpc)', async () => {
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
            { timeout: 20000, message: 'Oferta real via process_walk_matching' }
          )
          .toBeTruthy();
        log('oferta pending real criada pelo process_walk_matching');
      });

      await test.step('walker: oferta visível + aceite pela UI (accept_walk_request)', async () => {
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
            { timeout: 45000, message: 'Oferta visível no PetWalker' }
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
        log('aceite real confirmado (accept_walk_request HTTP 200 + true)');
      });

      await test.step('walker: "Iniciar deslocamento" pela UI REAL (petwalker_start_heading) → heading_to_pickup', async () => {
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
            { timeout: 20000, message: 'accepted + walker_id no banco' }
          )
          .toBeTruthy();

        const startBtn = walkerPage!.getByRole('button', { name: /Iniciar deslocamento/i });
        await expect(startBtn).toBeVisible({ timeout: 45000 });
        await startBtn.click();

        await expect
          .poll(
            () => {
              const rpc = lastRpc('petwalker_start_heading');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'petwalker_start_heading HTTP 200 + true (via UI)' }
          )
          .toBeTruthy();
        log('petwalker_start_heading real observado (HTTP 200, via UI "Iniciar deslocamento")');

        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('current_status, walker_id')
                .eq('id', sessionId)
                .single();
              return data?.current_status === 'heading_to_pickup' && data.walker_id === walkerId;
            },
            { timeout: 20000, message: 'current_status heading_to_pickup no banco' }
          )
          .toBeTruthy();
        log('backend heading_to_pickup confirmado');

        // Navegação canônica: o próprio produto leva o Walker ao WalkDetails.
        await expect(walkerPage!).toHaveURL(new RegExp(`/petwalker/passeio/${sessionId}`), {
          timeout: 20000,
        });
      });

      // ================================================================
      // OWNER MAIN PAGE — estado canônico heading_to_pickup + URL EXATA
      // ================================================================
      await test.step('OWNER MAIN PAGE: /search-walk montada + backend heading_to_pickup + URL EXATA capturada', async () => {
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('heading_to_pickup');
        expect(s.current_status).toBe('heading_to_pickup');

        // Owner no app real (rota normal /search-walk — descoberta automática
        // certificada de heading_to_pickup). NÃO há ?resume injetado.
        await expect
          .poll(() => new URL(ownerPage!.url()).pathname, {
            timeout: 15000,
            message: 'Owner em /search-walk (apresentação ativa heading_to_pickup)',
          })
          .toBe('/search-walk');

        // Exatamente UMA sessão ativa do Owner e do Pet.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // URL EXATA produzida pelo produto real — NUNCA construída.
        ownerUrlBeforeBackground = ownerPage!.url();
        log(`ownerUrlBeforeBackground=${ownerUrlBeforeBackground}`);
      });

      // ================================================================
      // BACKGROUNDING REAL — troca de ABA do browser (não ação de produto)
      // ================================================================
      await test.step('BACKGROUNDING: aba neutra same-ctx ao frente → ownerPage document.visibilityState === hidden (transição REAL do browser)', async () => {
        // Página temporária NEUTRA no MESMO ownerCtx (mesma autenticação),
        // navegação apenas a about:blank — nenhum JS de app, nenhum RPC.
        foregroundDummyPage = await ownerCtx!.newPage();
        await foregroundDummyPage.goto('about:blank');
        // ÚNICA troca de aba: nível browser (não é despacho de evento).
        await foregroundDummyPage.bringToFront();
        log('foregroundDummyPage.bringToFront() executado (troca real de aba)');

        // A transição de visibilidade deve ser produzida PELO BROWSER —
        // nunca por eventos sintéticos. Fail-closed de ambiente:
        // se o Chromium não ocultar a ownerPage, isto NÃO é RED de produto.
        let hidden = false;
        try {
          await expect
            .poll(
              async () =>
                await ownerPage!.evaluate(
                  () => document.visibilityState === 'hidden' && document.hidden === true
                ),
              { timeout: 5000, intervals: [100, 250, 500, 1000], message: 'ownerPage oculta pelo browser' }
            )
            .toBe(true);
          hidden = true;
        } catch {
          hidden = false;
        }
        if (!hidden) {
          throw new Error(
            'BROWSER VISIBILITY TEST ENVIRONMENT UNSUPPORTED: Chromium não tornou ownerPage document.visibilityState === hidden após bringToFront da aba neutra (NÃO é RED de produto; não simulamos com eventos sintéticos)'
          );
        }
        const vis = await ownerPage!.evaluate(() => ({
          visibilityState: document.visibilityState,
          hidden: document.hidden,
        }));
        log(`BACKGROUNDING CONFIRMADO: visibilityState=${vis.visibilityState} hidden=${vis.hidden}`);
        expect(vis.visibilityState).toBe('hidden');
        expect(vis.hidden).toBe(true);
      });

      // ================================================================
      // WALKER REAL — chegada REAL enquanto a aba do Owner está oculta
      // ================================================================
      await test.step('WALKER (aba Owner oculta): "Cheguei no Local" REAL → petwalker_arrive_pickup (T6) → arrived', async () => {
        const arriveBtn = walkerPage!.getByRole('button', { name: /Cheguei no Local/i });
        await expect(arriveBtn).toBeVisible({ timeout: 30000 });

        const preClickPathname = new URL(walkerPage!.url()).pathname;
        expect(preClickPathname).toBe(`/petwalker/passeio/${sessionId}`);
        const preClickButtonText = (await arriveBtn.innerText()).trim();
        expect(preClickButtonText).toMatch(/Cheguei no Local/i);
        const preClickButtonDisabled = await arriveBtn.isDisabled();
        expect(preClickButtonDisabled).toBe(false);
        log(
          `pré-clique (Walker): pathname=${preClickPathname} text=${JSON.stringify(preClickButtonText)} disabled=${preClickButtonDisabled}`
        );

        // Handler-entry (fato factual, nunca falha por si só).
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

        // UMA única ação real de usuário do Walker.
        await arriveBtn.click();
        await processandoProbe;

        // Resposta REAL da petwalker_arrive_pickup: HTTP 200 + body true.
        // Autoridade factual = observação in-page (fetch clone no renderer).
        await expect
          .poll(
            () => {
              const rpc = lastRpc('petwalker_arrive_pickup');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, intervals: [250, 500, 1000] }
          )
          .toBeTruthy();
        log('petwalker_arrive_pickup real observado (HTTP 200 + true, via UI "Cheguei no Local")');

        // Backend: MESMA sessão arrived, MESMO Owner/Walker/Pet — enquanto a
        // aba do Owner está oculta (nenhuma prova via UI do Owner neste ponto).
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('status, current_status, walker_id, customer_id, pet_id')
                .eq('id', sessionId)
                .single();
              return (
                data?.status === 'arrived' &&
                data?.current_status === 'arrived' &&
                data?.walker_id === walkerId &&
                data?.customer_id === ownerId &&
                data?.pet_id === petId
              );
            },
            { timeout: 20000, message: 'backend arrived (aba Owner oculta)' }
          )
          .toBeTruthy();
        log('backend arrived confirmado — aba do Owner permanece oculta');
      });

      // ================================================================
      // BASELINE PRÉ-FOREGROUND — contagens enquanto a aba está oculta
      // ================================================================
      await test.step('BASELINE pré-foreground: leituras de status + URL EXATA + contadores (aba ainda oculta)', async () => {
        // Backend arrived confirmado; a aba do Owner AINDA está oculta.
        const vis = await ownerPage!.evaluate(() => document.visibilityState);
        expect(vis).toBe('hidden');

        // Baseline factual de leituras de status (GET walk_sessions p/ MESMA
        // sessão) — pode já haver leituras de polling/realtime anteriores;
        // a prova exigirá ACRÉSCIMO após o foreground.
        statusReadCountBeforeForeground = statusReads.length;
        log(`statusReadCountBeforeForeground=${statusReadCountBeforeForeground}`);

        // URL EXATA inalterada enquanto oculta — a página MONTADA não saiu da
        // rota nem mutou a query.
        expect(ownerPage!.url()).toBe(ownerUrlBeforeBackground);

        // Contadores monotônicos de RPC antes do foreground.
        const before = lifecycleCounts();
        createCountBeforeForeground = before.create;
        acceptCountBeforeForeground = before.accept;
        headingCountBeforeForeground = before.heading;
        arriveCountBeforeForeground = before.arrive;
        confirmPickupCountBeforeForeground = before.confirmPickup;
        returnReqCountBeforeForeground = before.returnReq;
        log(`pré-foreground: ${JSON.stringify(before)}`);
      });

      // ================================================================
      // FOREGROUND — ÚNICA ação de retorno (nível browser) + ZERO ações
      // ================================================================
      await test.step('FOREGROUND: ownerPage.bringToFront() → visible + document.hidden=false → ZERO ações de produto', async () => {
        // ÚNICA ação de retorno — nível browser (não é despacho de evento).
        await ownerPage!.bringToFront();
        log('ownerPage.bringToFront() executado (ÚNICA ação de retorno)');

        // Transição de visibilidade produzida PELO BROWSER.
        await expect
          .poll(
            async () =>
              await ownerPage!.evaluate(
                () => document.visibilityState === 'visible' && document.hidden === false
              ),
            { timeout: 5000, intervals: [100, 250, 500, 1000], message: 'ownerPage visível novamente' }
          )
          .toBe(true);
        const vis = await ownerPage!.evaluate(() => ({
          visibilityState: document.visibilityState,
          hidden: document.hidden,
        }));
        log(`FOREGROUND CONFIRMADO: visibilityState=${vis.visibilityState} hidden=${vis.hidden}`);
        expect(vis.visibilityState).toBe('visible');
        expect(vis.hidden).toBe(false);

        // Daqui em diante: ZERO ações de produto. Sem clique, goto, reload,
        // pushState, setSearchParams, storage, fetchStatus manual, RPC manual
        // ou evento sintético de focus/visibility — apenas OBSERVAÇÃO.
        log('ZERO ações de produto a partir daqui (apenas observação/assertions)');
      });

      // ================================================================
      // PROVA DA LEITURA DE RECUPERAÇÃO (focus/visibility) — janela curta
      // ================================================================
      await test.step('RECOVERY READ: ≥1 NOVO GET walk_sessions (mesma sessão) dentro de ~3s após o foreground', async () => {
        // Janela de 3s: distingue a recuperação imediata focus/visibility
        // (onFocus → fetchStatus('recovery')) do polling normal de 5s.
        // Ambos focus e visibilitychange podem legitimamente produzir leituras;
        // exigimos apenas PELO MENOS UMA leitura real adicional.
        await expect
          .poll(() => statusReads.length, {
            timeout: 3000,
            intervals: [100, 250, 500, 1000],
            message:
              'FOCUS/VISIBILITY RECOVERY READ NOT OBSERVED: nenhum novo GET walk_sessions p/ mesma sessão na janela imediata pós-foreground',
          })
          .toBeGreaterThan(statusReadCountBeforeForeground);
        const latest = statusReads[statusReads.length - 1];
        log(
          `FOCUS/VISIBILITY RECOVERY READ CONFIRMADO: #${statusReads.length} GET ${latest.pathname} ${latest.sessionFilter} (baseline=${statusReadCountBeforeForeground})`
        );
        // Fatos seguros do observador — nenhuma leitura corrompida/forânea.
        expect(latest.method).toBe('GET');
        expect(latest.sessionFilter).toBe(`eq.${sessionId}`);
      });

      // ================================================================
      // CATCH-UP VISÍVEL — arrived canônico sem NENHUMA ação de produto
      // ================================================================
      await test.step('CATCH-UP: URL EXATA preservada + backend arrived + apresentação arrived do Owner SEM ação', async () => {
        // URL EXATA: a página MONTADA mantém a MESMA URL exata (igualdade
        // total — sem navegação/mutação de query pela recuperação).
        expect(ownerPage!.url()).toBe(ownerUrlBeforeBackground);
        expect(new URL(ownerPage!.url()).pathname).toBe('/search-walk');

        // Backend: MESMA sessão arrived, MESMO Owner/Walker/Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('arrived');
        expect(s.current_status).toBe('arrived');

        // Apresentação arrived canônica do Owner — o MESMO contrato
        // certificado em owner-arrived-recovery-4.5a / network-gap-4.5b1:
        // overlay arrived/PIN do WalkInProgress (fase 'arrived') com
        // pickup-pin-input + pickup-pin-submit na PÁGINA DO OWNER, válido
        // apenas combinado com a autoridade de backend arrived acima.
        // (pickup-pin-display NÃO — pertence a /historico.)
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toBeVisible({ timeout: 15000 });
        await expect(ownerPage!.getByTestId('pickup-pin-submit')).toBeVisible({ timeout: 15000 });
        log('CATCH-UP CONFIRMADO: apresentação arrived do Owner restaurada SEM reload/navegação/ação');
      });

      // ================================================================
      // ZERO EFEITOS COLATERAIS — contadores monotônicos + totais finais
      // ================================================================
      await test.step('ZERO SIDE EFFECTS: contadores de RPC inalterados pelo foreground + totais finais factuais', async () => {
        const after = lifecycleCounts();
        // Igualdade monotônica: o foreground/recuperação NÃO pode disparar
        // nenhuma RPC de lifecycle.
        expect(after.create).toBe(createCountBeforeForeground);
        expect(after.accept).toBe(acceptCountBeforeForeground);
        expect(after.heading).toBe(headingCountBeforeForeground);
        expect(after.arrive).toBe(arriveCountBeforeForeground);
        expect(after.confirmPickup).toBe(confirmPickupCountBeforeForeground);
        expect(after.returnReq).toBe(returnReqCountBeforeForeground);

        // Totais finais factuais da jornada real:
        // 1 create (UI Owner), 1 accept, 1 heading, 1 arrive (T6/Walker),
        // ZERO confirm pickup, ZERO request return (nunca avançamos).
        expect(after.create).toBe(1);
        expect(after.accept).toBe(1);
        expect(after.heading).toBe(1);
        expect(after.arrive).toBe(1);
        expect(after.confirmPickup).toBe(0);
        expect(after.returnReq).toBe(0);
        log(`totais finais: ${JSON.stringify(after)}`);

        // Nenhuma segunda sessão ativa apareceu.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);
        log('pós-foreground: zero RPCs duplicadas + 1 sessão ativa por dono/pet');
      });

      // ================================================================
      // HIGIENE DA PÁGINA TEMPORÁRIA (antes do cleanup final)
      // ================================================================
      await test.step('higiene: fecha a página temporária de visibilidade (ownerPage MONTADA permanece)', async () => {
        if (foregroundDummyPage && !foregroundDummyPage.isClosed()) {
          await foregroundDummyPage.close().catch(() => {});
        }
        foregroundDummyPage = null;
        // A ownerPage MONTADA permanece aberta até o cleanup final normal.
        expect(ownerPage!.isClosed()).toBe(false);
        expect(ownerPage!.url()).toBe(ownerUrlBeforeBackground);
        log('página temporária fechada; ownerPage montada preservada');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos', async () => {
        // Página temporária: fechada com segurança em QUALQUER cenário.
        if (foregroundDummyPage && !foregroundDummyPage.isClosed()) {
          await foregroundDummyPage.close().catch(() => {});
        }
        foregroundDummyPage = null;
        // Higiene de listeners.
        detachStatusReadObserver();
        if (walkerPage) detachArriveObservers();
        if (walkerCtx) await walkerCtx.close().catch(() => {});
        if (ownerCtx) await ownerCtx.close().catch(() => {});
        // Sessão criada pela UI: remoção direta fail-closed (filhos → sessão).
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
