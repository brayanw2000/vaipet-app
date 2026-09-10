/**
 * PHASE 4.5B3 — AUTH SESSION REHYDRATION + CROSS-OWNER RESUME ISOLATION —
 * TEST-ONLY FIRST PROOF
 *
 * Baseline certificada (NÃO reabrir):
 *   - 4.4: jornada real completa ✅
 *   - 4.5A: reload/re-entrada para todos os estados principais ✅
 *   - 4.5B1: recuperação de lacuna temporária de rede ✅
 *   - Patch P1 (WalkInProgress): autoridade de domínio
 *     in_progress/returning → phase walking ✅
 *   - 4.5B2: INCONCLUSIVO por ambiente (Chromium do Playwright não tornou a
 *     página realmente document.visibilityState === 'hidden') — AMBIENTE NÃO
 *     SUPORTADO; NÃO é RED de produto e NÃO é GREEN de produto. NÃO reaberto.
 *
 * ARQUITETURA DE AUTH SOB TESTE (NÃO modificada):
 *   - Supabase client: storage localStorage + persistSession +
 *     autoRefreshToken.
 *   - AuthProvider monta → supabase.auth.getSession() → initialSession →
 *     setSession/setUser → authStatus 'authenticated'; onAuthStateChange
 *     ativo.
 *   Portanto FECHAR a Page e abrir uma NOVA Page no MESMO BrowserContext
 *   destrói o app/AuthProvider e exige reidratação da sessão Supabase já
 *   persistida no storage do browser — SEM novo login.
 *
 * PROVA A — REIDRATAÇÃO DE AUTH / RE-ENTRADA DO APP:
 *   Owner A com passeio REAL in_progress
 *   → ownerPage.close() (a página/app é destruída; BrowserContext permanece)
 *   → NOVA Page (reentryPage) no MESMO ownerCtx
 *   → goto('/inicio') — ÚNICA navegação legítima de re-entrada
 *   → ZERO ações de login (nunca fill/click/signInWithPassword/setItem/token)
 *   → AuthProvider reidratado → Home autenticada → Banner REAL
 *     "Passeio em andamento" (Owner-scoped: product query
 *     customer_id = user.id, in_progress/returning) aparece sozinho
 *   → UM clique no banner → /search-walk?resume=<MESMA sessionId> criado
 *     PELO BANNER → request-return-button restaurado
 *   → identidade NÃO deriva: o observador read-only de requests prova que a
 *     consulta Owner-scoped usa customer_id = eq.<ownerAId>
 *   → ZERO novas RPCs de lifecycle causadas pela reidratação.
 *
 * PROVA B — ISOLAMENTO CROSS-OWNER (fail-closed):
 *   ownerB = usuário REAL distinto (ownerBId !== ownerAId), login REAL pela
 *   UI /auth em BrowserContext PRÓPRIO
 *   → probe AUTORIZAÇÃO (única exceção consciente: URL direta
 *     /search-walk?resume=<sessionId da vítima> — simula "outro usuário
 *     autenticado que conhece o sessionId alheio")
 *   → produto deve FALHAR FECHADO (resume consulta
 *     .eq('id', sessionId).eq('customer_id', user.id).maybeSingle()):
 *     pathname /search-walk + ?resume REMOVIDO (searchParams.get('resume')
 *     === null) + NENHUMA UI de lifecycle da vítima (request-return-button,
 *     owner-returning-state, confirm-return-arrival-button, review-walk-screen,
 *     pickup-pin-input — todas count 0)
 *   → ZERO RPCs de lifecycle de ownerB (incl. customer_confirm_arrival)
 *   → backend da vítima INALTERADO (mesma sessão in_progress, dono ownerA)
 *   → nenhuma nova walk_session para o run.
 *
 * PIN: obtido SOMENTE da UI do Owner (/historico/<id> em página TEMPORÁRIA
 * do ownerAContext, fechada ao final) — nunca customer_get_pickup_code,
 * admin, DB ou RPC manual.
 *
 * NUNCA (no arquivo inteiro): supabase.auth.signOut(); clearCookies();
 * localStorage.clear(); injeção/restauração de storage; export/import de
 * tokens; login na reentryPage; criação manual de sessões/ofertas; RPCs de
 * lifecycle manuais (exceção certificada:
 * admin.rpc('process_walk_matching')). Nenhum header/token/cookie é logado.
 *
 * CONTADORES MONOTÔNICOS: rpcCalls (ownerA/walker) e rpcCallsB (ownerB) são
 * SEPARADOS e NUNCA resetados. Totais pré-fechamento exigidos:
 * create=1, accept=1, heading=1, arrive=1, confirmPickup=1, returnReq=0.
 *
 * O QUE ESTE TESTE CERTIFICA (sem overclaim): reidratação de sessão
 * persistida do browser através de CLOSE Page → NOVA Page → NOVO mount
 * React/AuthProvider → MESMO BrowserContext/localStorage. NÃO certifica
 * reinício do processo do browser, kill de OS, expiração de token,
 * revogação de sessão no servidor ou reboot de dispositivo.
 *
 * FAIL-CLOSED: cleanup para as TRÊS identidades (ownerA, walker, ownerB);
 * qualquer falha de cleanup FALHA a suíte.
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
// (150m + LEAST(_accuracy, 50)) — fixture consistente com 4.4/4.5A/B1/B2.
const WALKER_POS = { lng: -46.7001, lat: -23.6001 };

// Estados ativos (não terminais) do domínio.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

// Filtro estrito de console — apenas erros relevantes. NUNCA dumpa objetos
// arbitrários (podem conter segredos): apenas a mensagem de texto.
const ARRIVE_CONSOLE_FILTER = /arriv|pickup|GPS|geolocation|supabase|fetch/i;

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5b3-owner-auth-rehydration-isolation] ${msg}`);

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

test.describe('Phase 4.5B3: auth rehydration (page close → new page) + cross-owner resume isolation', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 420_000 });

  let runId = '';
  let ownerAId = '';
  let walkerId = '';
  let ownerBId = '';
  let petId = '';
  let sessionId = '';
  let ownerAEmail = '';
  let walkerEmail = '';
  let ownerBEmail = '';
  let ownerPin = '';

  let ownerACtx: BrowserContext | null = null;
  let walkerCtx: BrowserContext | null = null;
  let ownerBCtx: BrowserContext | null = null;
  let ownerPage: Page | null = null;
  let walkerPage: Page | null = null;
  let reentryPage: Page | null = null;
  let ownerBPage: Page | null = null;
  // Página TEMPORÁRIA do ownerAContext usada SOMENTE para ler o PIN REAL na
  // rota certificada /historico/<id> — fechada ao final do step (try/finally).
  let ownerPinPage: Page | null = null;

  // ——— Observador factual das respostas RPC reais (HTTP + body) ———
  // Dois registros SEPARADOS e NUNCA resetados: ownerA/walker (principal) e
  // ownerB (isolamento) — nenhuma observação de ownerB contamina os totais
  // da vítima.
  const rpcCalls: Record<string, Array<{ status: number; body: unknown }>> = {};
  const rpcCallsB: Record<string, Array<{ status: number; body: unknown }>> = {};

  type RpcRecord = Record<string, Array<{ status: number; body: unknown }>>;

  const armRpcObserver = (record: RpcRecord, page: Page, rpcName: string) => {
    page.on('response', (res) => {
      if (!res.url().includes(`/rest/v1/rpc/${rpcName}`)) return;
      res
        .json()
        .then((body) => {
          record[rpcName] = record[rpcName] || [];
          record[rpcName].push({ status: res.status(), body });
          log(`RPC_OBSERVED ${rpcName} HTTP ${res.status()} body=${JSON.stringify(body)}`);
        })
        .catch(() => {
          record[rpcName] = record[rpcName] || [];
          record[rpcName].push({ status: res.status(), body: 'NON_JSON' });
        });
    });
  };

  const lastRpc = (rpcName: string) => {
    const calls = rpcCalls[rpcName] || [];
    return calls[calls.length - 1];
  };

  const lifecycleCounts = (record: RpcRecord = rpcCalls) => ({
    create: (record['create_walk_request'] || []).length,
    accept: (record['accept_walk_request'] || []).length,
    heading: (record['petwalker_start_heading'] || []).length,
    arrive: (record['petwalker_arrive_pickup'] || []).length,
    confirmPickup: (record['petwalker_confirm_pickup'] || []).length,
    returnReq: (record['customer_request_return'] || []).length,
    confirmArrival: (record['customer_confirm_arrival'] || []).length,
  });

  // ——— T6: observador IN-PAGE do body REAL da chegada (sem CDP race) ———
  // Idêntico ao certificado em owner-arrived-recovery-4.5a / 4.5B1 / B2:
  // exposeBinding + addInitScript (ANTES de qualquer JS do app) instalam um
  // wrapper TRANSPARENTES de window.fetch — para a RPC de chegada apenas,
  // executa o fetch nativo ORIGINAL, clona a resposta REAL, lê o clone,
  // entrega fatos SEGUROS (status+body+pathname) ao Node e devolve a Response
  // ORIGINAL intocada ao app.
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
    // Apenas STATUS HTTP — NENHUM leitor de body CDP.
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

  // ——— Observador read-only de IDENTIDADE (Owner-scoped reads) ———
  // Na reentryPage: toda consulta GET /rest/v1/walk_sessions com filtro
  // customer_id é registrada como fato SEGURO (timestamp + filtro). Prova que
  // o app reidratado consulta como ownerA (customer_id = eq.<ownerAId>) —
  // sem inspecionar/logar headers/tokens/cookies. NUNCA page.route.
  type OwnerScopedRead = { timestamp: number; customerFilter: string };
  const ownerScopedReads: OwnerScopedRead[] = [];
  let detachOwnerScopedReadObserver: () => void = () => {};

  const armOwnerScopedReadObserver = (page: Page) => {
    const onReq = (req: Request) => {
      try {
        if (req.method() !== 'GET') return;
        const u = new URL(req.url());
        if (u.pathname !== '/rest/v1/walk_sessions') return;
        const cf = u.searchParams.get('customer_id') || '';
        if (!cf.startsWith('eq.')) return;
        ownerScopedReads.push({ timestamp: Date.now(), customerFilter: cf });
        log(`OWNER_SCOPED_READ customer_id=${cf} (#${ownerScopedReads.length})`);
      } catch {
        /* URL inválida — ignora */
      }
    };
    page.on('request', onReq);
    detachOwnerScopedReadObserver = () => {
      page.off('request', onReq);
      detachOwnerScopedReadObserver = () => {};
    };
  };

  // ——— Diagnóstico factual de navegações para /auth na reentryPage ———
  // (somente contagem de eventos; a prova autoritativa é a UI autenticada).
  let reentryAuthNavigations = 0;
  let detachReentryNavObserver: () => void = () => {};

  const armReentryNavObserver = (page: Page) => {
    const onNav = (frame: any) => {
      try {
        if (frame !== page.mainFrame()) return;
        if (new URL(frame.url()).pathname === '/auth') {
          reentryAuthNavigations += 1;
          log(`REENTRY_NAV_TO_AUTH (#${reentryAuthNavigations})`);
        }
      } catch {
        /* URL inválida — ignora */
      }
    };
    page.on('framenavigated', onNav);
    detachReentryNavObserver = () => {
      page.off('framenavigated', onNav);
      detachReentryNavObserver = () => {};
    };
  };

  async function auditSession(id: string) {
    const { data, error } = await admin.from('walk_sessions').select('*').eq('id', id).single();
    if (error) throw new Error(`audit_session_failed: ${JSON.stringify(error)}`);
    return data;
  }

  async function activeOwnerASessionCount() {
    const { data, error } = await admin
      .from('walk_sessions')
      .select('id')
      .eq('customer_id', ownerAId)
      .in('current_status', ACTIVE_STATUSES);
    if (error) throw new Error(`active_owner_a_sessions_failed: ${JSON.stringify(error)}`);
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

  test('Reidratação de auth (close page → new page) retoma o MESMO in_progress; ownerB NÃO retoma a sessão alheia', async ({ browser }) => {
    runId = `4.5b3_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetAuth45B3';

    try {
      await test.step('setup: ownerA + walker + ownerB E2E determinísticos + 1 pet real (do ownerA)', async () => {
        const ownerA = await provisionUser(runId, 'pet_owner');
        const walker = await provisionUser(runId, 'petwalker');
        const ownerB = await provisionUser(runId, 'pet_owner');
        ownerAId = ownerA.id;
        walkerId = walker.id;
        ownerBId = ownerB.id;
        ownerAEmail = ownerA.email;
        walkerEmail = walker.email;
        ownerBEmail = ownerB.email;
        expect(ownerBId).not.toBe(ownerAId);
        log(`ownerA_id: ${ownerAId}`);
        log(`walker_id: ${walkerId}`);
        log(`ownerB_id: ${ownerBId} (distinto do ownerA)`);

        const { data: pet, error: petErr } = await admin
          .from('pets')
          .insert({
            owner_id: ownerAId,
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
        log(`pet_id: ${petId} (do ownerA)`);
      });

      await test.step('login REAL via /auth (ownerA + walker) + observadores (T6 in-page ANTES da página)', async () => {
        walkerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          // Fixture certificada 4.4: posição real do Walker.
          geolocation: { longitude: WALKER_POS.lng, latitude: WALKER_POS.lat, accuracy: 10 },
        });
        ownerACtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: { longitude: MEETING.lng, latitude: MEETING.lat },
        });
        // T6: binding + wrapper de fetch instalados NO CONTEXT, ANTES da
        // criação da página e de qualquer JS do app.
        await armInPageArriveObserver(walkerCtx);
        walkerPage = await walkerCtx.newPage();
        ownerPage = await ownerACtx.newPage();
        await loginViaUi(ownerPage, ownerAEmail);
        await loginViaUi(walkerPage, walkerEmail);

        // Posse dos observadores (contrato 4.5B1 T1): RPCs do Owner na página
        // do Owner; RPCs do Walker na página do Walker; chegada via T6.
        armRpcObserver(rpcCalls, ownerPage, 'create_walk_request');
        armRpcObserver(rpcCalls, ownerPage, 'customer_request_return');
        armRpcObserver(rpcCalls, ownerPage, 'customer_confirm_arrival'); // T1: confirmação de chegada também é RPC do LADO DO OWNER
        armRpcObserver(rpcCalls, walkerPage, 'accept_walk_request');
        armRpcObserver(rpcCalls, walkerPage, 'petwalker_start_heading');
        armRpcObserver(rpcCalls, walkerPage, 'petwalker_confirm_pickup');
        armArriveObservers(walkerPage); // T3: request/status/erros (sem body CDP)
      });

      await test.step('ownerA: criar pedido pela UI REAL (create_walk_request) → searching', async () => {
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

        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('id')
                .eq('customer_id', ownerAId)
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
          .eq('customer_id', ownerAId)
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

      await test.step('auditoria: searching + MESMA sessão + dono/pet corretos + 1 ativa', async () => {
        const s = await auditSession(sessionId);
        expect(s.customer_id).toBe(ownerAId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('searching');
        expect(s.current_status).toBe('searching');

        const ownerActive = await activeOwnerASessionCount();
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

      await test.step('walker: oferta visível + aceite pela UI REAL (accept_walk_request)', async () => {
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
        log('petwalker_start_heading real observado (HTTP 200, via UI)');

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

      await test.step("walker: 'Cheguei no Local' REAL (GPS + T6 in-page) → arrived", async () => {
        const arriveBtn = walkerPage!.getByRole('button', { name: /Cheguei no Local/i });
        await expect(arriveBtn).toBeVisible({ timeout: 30000 });

        const preClickPathname = new URL(walkerPage!.url()).pathname;
        expect(preClickPathname).toBe(`/petwalker/passeio/${sessionId}`);

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

        // UMA única ação real de usuário: o clique no botão do produto.
        await arriveBtn.click();
        await processandoProbe;

        // Resposta REAL: HTTP 200 + body true — autoridade in-page T6.
        await expect
          .poll(
            () => {
              const rpc = lastRpc('petwalker_arrive_pickup');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, intervals: [250, 500, 1000] }
          )
          .toBeTruthy();
        log('petwalker_arrive_pickup real observado (HTTP 200 + true, via UI)');

        // Backend: MESMA sessão arrived, MESMO Walker.
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
        log('backend arrived confirmado');
      });

      await test.step('ownerA: PIN REAL da UI (/historico/:id em página TEMPORÁRIA do ownerAContext) — nunca admin/DB', async () => {
        // Página TEMPORÁRIA do MESMO ownerAContext (mesma autenticação) para a
        // rota certificada do PIN; a ownerPage principal NÃO é navegada aqui.
        ownerPinPage = await ownerACtx!.newPage();
        try {
          await ownerPinPage.goto(`/historico/${sessionId}`);
          const pinDisplay = ownerPinPage.getByTestId('pickup-pin-display');
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
          log(`PIN lido da UI do OWNER (página temporária /historico, nunca via admin): ${ownerPin}`);
        } finally {
          await ownerPinPage.close().catch(() => {});
          ownerPinPage = null;
        }
      });

      await test.step('walker: PIN digitado pela UI → petwalker_confirm_pickup → in_progress (contrato 4.4)', async () => {
        const pinInput = walkerPage!.getByTestId('pickup-pin-input');
        await expect(pinInput).toBeVisible({ timeout: 20000 });
        // O PIN preenchido vem EXCLUSIVAMENTE da UI do Owner (ownerPin).
        await pinInput.fill(ownerPin);

        const submitBtn = walkerPage!.getByTestId('pickup-pin-submit');
        await expect(submitBtn).toBeEnabled({ timeout: 10000 });

        // Contrato CERTIFICADO 4.4: WalkDetails executa window.location.reload()
        // IMEDIATAMENTE após data === true — sucesso provado por HTTP 200 real
        // + reload REAL (só ocorre no branch data === true) + DB in_progress.
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

      // ================================================================
      // PRÉ-RE-ENTRADA: precondição de retomabilidade (banner REAL na
      // ownerPage ORIGINAL) + baseline de contadores
      // ================================================================
      await test.step('PRÉ-RE-ENTRADA: banner REAL cria ?resume + request-return-button (precondição) + retorno a /inicio', async () => {
        // Re-entrada legítima de produto na ownerPage ORIGINAL (não é a prova A;
        // apenas comprova que a sessão está retomável NESTE momento).
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 15000 });

        // Backend continua a MESMA sessão in_progress MESMO ownerA/Walker/Pet.
        const s0 = await auditSession(sessionId);
        expect(s0.id).toBe(sessionId);
        expect(s0.customer_id).toBe(ownerAId);
        expect(s0.walker_id).toBe(walkerId);
        expect(s0.pet_id).toBe(petId);
        expect(s0.status).toBe('in_progress');
        expect(s0.current_status).toBe('in_progress');

        // Banner REAL (Owner-scoped: customer_id = user.id, in_progress/returning).
        const banner0 = ownerPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner0).toBeVisible({ timeout: 30000 });

        // UM clique no banner → ?resume criado PELO BANNER → UI in_progress.
        await banner0.click();
        await expect
          .poll(
            () => {
              const u = new URL(ownerPage!.url());
              return u.pathname === '/search-walk' && u.searchParams.get('resume') === sessionId;
            },
            { timeout: 15000, message: 'pathname /search-walk + ?resume (criado pelo banner)' }
          )
          .toBeTruthy();
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 20000 });
        log('precondição: sessão retomável pela UI (request-return-button visível; NÃO clicado)');

        // Retorna Owner A a /inicio (a ownerPage permanece autenticada).
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 15000 });
        const banner1 = ownerPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner1).toBeVisible({ timeout: 30000 });
        log('ownerPage de volta a /inicio com o banner REAL visível');

        // Invariâncias de backend + baseline de contadores ANTES do fechamento.
        const s = await auditSession(sessionId);
        expect(s.current_status).toBe('in_progress');
        const ownerActive = await activeOwnerASessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        const c = lifecycleCounts(rpcCalls);
        expect(c.create).toBe(1);
        expect(c.accept).toBe(1);
        expect(c.heading).toBe(1);
        expect(c.arrive).toBe(1);
        expect(c.confirmPickup).toBe(1);
        expect(c.returnReq).toBe(0);
        expect(c.confirmArrival).toBe(0);
        log(`pré-fechamento: ${JSON.stringify(c)}`);
      });

      // ================================================================
      // PROVA A — FECHAR a página do app (BrowserContext permanece VIVO)
      // ================================================================
      await test.step('PROVA A: ownerPage.close() — app destruído, BrowserContext autenticado intacto', async () => {
        const pagesBefore = ownerACtx!.pages().length;
        log(`ownerACtx.pages() antes do fechamento: ${pagesBefore}`);
        expect(pagesBefore).toBeGreaterThanOrEqual(1);

        // A página do APLICATIVO é fechada — NÃO é logout: sem signOut, sem
        // clearCookies, sem storage.clear, sem injeção/export de tokens.
        await ownerPage!.close();
        expect(ownerPage!.isClosed()).toBe(true);
        log('ownerPage fechada (app/AuthProvider destruídos); ownerCtx continua VIVO');

        // O contexto permanece utilizável (nenhuma destruição de storage).
        expect(ownerACtx!.pages().length).toBeGreaterThanOrEqual(0);
      });

      await test.step('PROVA A: NOVA Page no MESMO ownerCtx → /inicio SEM NENHUM login → reidratação de auth', async () => {
        // NOVA instância de app (novo React/AuthProvider; mesmo storage).
        reentryPage = await ownerACtx!.newPage();
        expect(reentryPage).not.toBe(ownerPage);

        // Diagnóstico factual: navegações de topo para /auth (somente contagem).
        armReentryNavObserver(reentryPage);
        // Identidade read-only: consultas Owner-scoped do app reidratado.
        armOwnerScopedReadObserver(reentryPage);
        // T1: CONTINUIDADE de observabilidade de RPCs do lado do Owner através
        // da reidratação — a ownerPage com os listeners originais foi fechada;
        // a NOVA Page recebe os MESMOS observers sobre o MESMO registro
        // monotônico rpcCalls. Armados ANTES do goto('/inicio') para cobrir
        // a reidratação de auth e o mount da Home desde o primeiro momento.
        // NÃO é observação duplicada: a página antiga já está fechada.
        armRpcObserver(rpcCalls, reentryPage, 'create_walk_request');
        armRpcObserver(rpcCalls, reentryPage, 'customer_request_return');
        armRpcObserver(rpcCalls, reentryPage, 'customer_confirm_arrival');

        // ÚNICA navegação legítima de re-entrada. ZERO ações de login:
        // nunca fill email/senha, nunca click Entrar, nunca
        // signInWithPassword/setSession/setItem — a auth deve vir SOMENTE da
        // sessão Supabase persistida + inicialização normal do AuthProvider.
        await reentryPage.goto('/inicio');
        log(`reentryPage goto('/inicio') concluído (sem nenhuma interação de login)`);

        // UI autenticada REAL (evita asserção instantânea frágil durante a
        // navegação inicial): o Banner "Passeio em andamento" é Owner-scoped
        // pela consulta customer_id = user.id — sua visibilidade prova
        // reidratação como ownerA + sessão ativa in_progress.
        const banner = reentryPage.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner).toBeVisible({ timeout: 30000 });

        // Outcome final de autenticação: NÃO é a tela de login.
        expect(new URL(reentryPage.url()).pathname).toBe('/inicio');
        log(`REENTRY_AUTH_REHYDRATED: ${reentryPage.url()} (authNavigationsToAuth=${reentryAuthNavigations})`);

        // Identidade NÃO deriva: o app reidratado consultou walk_sessions com
        // customer_id = eq.<ownerAId> (fatos seguros do observador).
        await expect
          .poll(() => ownerScopedReads.length, {
            timeout: 10000,
            message: 'nenhuma consulta Owner-scoped (customer_id) observada na reentryPage',
          })
          .toBeGreaterThan(0);
        const seenFilters = new Set(ownerScopedReads.map((r) => r.customerFilter));
        expect(seenFilters.has(`eq.${ownerAId}`)).toBe(true);
        expect(seenFilters.has(`eq.${ownerBId}`)).toBe(false);
        log(`identidade reidratada = ownerA (customer_id eq.${ownerAId} observado)`);

        // Backend: MESMA sessão in_progress MESMO ownerA/Walker/Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerAId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');

        // ZERO novas RPCs de lifecycle causadas pela reidratação.
        const cAfterRehydration = lifecycleCounts(rpcCalls);
        expect(cAfterRehydration.create).toBe(1);
        expect(cAfterRehydration.accept).toBe(1);
        expect(cAfterRehydration.heading).toBe(1);
        expect(cAfterRehydration.arrive).toBe(1);
        expect(cAfterRehydration.confirmPickup).toBe(1);
        expect(cAfterRehydration.returnReq).toBe(0);
        expect(cAfterRehydration.confirmArrival).toBe(0); // T1: mount de /inicio reidratado NÃO confirma chegada
        log('reidratação: ZERO novas RPCs de lifecycle');
      });

      await test.step('PROVA A: banner REAL na reentryPage → clique ÚNICO → ?resume criado PELO BANNER → request-return-button', async () => {
        const banner = reentryPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner).toBeVisible({ timeout: 15000 });

        // UM clique real no banner — é ele quem cria a URL de retomada.
        await banner.click();

        // Navegação automática do produto: pathname /search-walk + ?resume.
        await expect
          .poll(
            () => {
              const u = new URL(reentryPage!.url());
              return u.pathname === '/search-walk' && u.searchParams.get('resume') === sessionId;
            },
            { timeout: 15000, message: '?resume=<MESMA sessionId> criado pelo banner na reentryPage' }
          )
          .toBeTruthy();
        log(`banner reidratado criou a retomada: ${reentryPage!.url()}`);

        // UI in_progress restaurada automaticamente (ZERO ações do teste).
        await expect(reentryPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 30000 });

        // Backend: MESMA sessão in_progress; 1 ativa por dono/pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerAId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');
        const ownerActive = await activeOwnerASessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // ZERO novas RPCs de lifecycle pela retomada pós-reidratação.
        const c = lifecycleCounts(rpcCalls);
        expect(c.create).toBe(1);
        expect(c.accept).toBe(1);
        expect(c.heading).toBe(1);
        expect(c.arrive).toBe(1);
        expect(c.confirmPickup).toBe(1);
        expect(c.returnReq).toBe(0);
        expect(c.confirmArrival).toBe(0); // T1: retomada via banner NÃO confirma chegada
        log('PROVA A COMPLETA: reidratação + banner resume + request-return-button + ZERO efeitos colaterais');
      });

      // ================================================================
      // PROVA B — SEGUNDO OWNER REAL NÃO PODE RETOMAR A SESSÃO ALHEIA
      // ================================================================
      await test.step('PROVA B: ownerB REAL (usuário distinto) autenticado pela UI /auth em contexto PRÓPRIO', async () => {
        // Contexto PRÓPRIO para ownerB (nada compartilhado com ownerA).
        ownerBCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: { longitude: MEETING.lng, latitude: MEETING.lat },
        });
        ownerBPage = await ownerBCtx.newPage();

        // Login REAL pela UI (usuário genuinamente distinto; sem papel de
        // petwalker/admin; sem posse do pet/sessão do ownerA).
        await loginViaUi(ownerBPage, ownerBEmail);

        // Reaching /inicio com sucesso = usuário autenticado normal.
        await ownerBPage.goto('/inicio');
        await expect(ownerBPage).toHaveURL(/\/inicio/, { timeout: 15000 });

        // Distinção factual de identidade.
        expect(ownerBId).not.toBe(ownerAId);

        // Observadores de RPC de ownerB em registro SEPARADO (rpcCallsB):
        // nenhuma lifecycle pode ocorrer a partir daqui.
        armRpcObserver(rpcCallsB, ownerBPage, 'create_walk_request');
        armRpcObserver(rpcCallsB, ownerBPage, 'accept_walk_request');
        armRpcObserver(rpcCallsB, ownerBPage, 'petwalker_start_heading');
        armRpcObserver(rpcCallsB, ownerBPage, 'petwalker_arrive_pickup');
        armRpcObserver(rpcCallsB, ownerBPage, 'petwalker_confirm_pickup');
        armRpcObserver(rpcCallsB, ownerBPage, 'customer_request_return');
        armRpcObserver(rpcCallsB, ownerBPage, 'customer_confirm_arrival');

        // Backend: vítima permanece in_progress MESMO ownerA.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerAId);
        expect(s.current_status).toBe('in_progress');
        log(`ownerB autenticado normalmente (${ownerBPage.url()}); vítima intacta`);
      });

      await test.step('PROBE de autorização: ownerB abre /search-walk?resume=<sessionId da vítima> — deve FALHAR FECHADO', async () => {
        // Exceção consciente desta prova de segurança: URL direta construída
        // pelo TESTE (não é o caminho legítimo de produto). Simula "outro
        // usuário autenticado que conhece o sessionId alheio".
        await ownerBPage!.goto(`/search-walk?resume=${sessionId}`);
        log(`probe de retomada não autorizada emitida: ${ownerBPage!.url()}`);

        // Contrato fail-closed do produto (resume consulta
        // .eq('id').eq('customer_id', user.id).maybeSingle() — erro/ausência →
        // setIsResuming(false) + setSearchParams({}, { replace: true })):
        // pathname permanece /search-walk e o ?resume estranho é REMOVIDO.
        await expect
          .poll(
            () => {
              const u = new URL(ownerBPage!.url());
              return u.pathname === '/search-walk' && u.searchParams.get('resume') === null;
            },
            {
              timeout: 20000,
              intervals: [250, 500, 1000],
              message:
                'CROSS-OWNER FAIL-CLOSED RED: o ?resume estranho não foi limpo (ownerB pode ter hidratado sessão alheia)',
            }
          )
          .toBeTruthy();
        expect(new URL(ownerBPage!.url()).pathname).toBe('/search-walk');
        expect(new URL(ownerBPage!.url()).searchParams.get('resume')).toBeNull();
        log('fail-closed confirmado: pathname /search-walk + ?resume removido');

        // NENHUMA UI de lifecycle da vítima para ownerB.
        await expect(ownerBPage!.getByTestId('request-return-button')).toHaveCount(0);
        await expect(ownerBPage!.getByTestId('owner-returning-state')).toHaveCount(0);
        await expect(ownerBPage!.getByTestId('confirm-return-arrival-button')).toHaveCount(0);
        await expect(ownerBPage!.getByTestId('review-walk-screen')).toHaveCount(0);
        // Nenhuma apresentação operacional de arrived (PIN) da vítima.
        await expect(ownerBPage!.getByTestId('pickup-pin-input').first()).toHaveCount(0);
        log('UI da vítima AUSENTE para ownerB (count 0 em todos os marcadores de lifecycle)');

        // ZERO RPCs de lifecycle de ownerB (probe não pode mutar ciclo de vida).
        const b = lifecycleCounts(rpcCallsB);
        expect(b.create).toBe(0);
        expect(b.accept).toBe(0);
        expect(b.heading).toBe(0);
        expect(b.arrive).toBe(0);
        expect(b.confirmPickup).toBe(0);
        expect(b.returnReq).toBe(0);
        expect(b.confirmArrival).toBe(0);
        log(`ownerB lifecycle: ${JSON.stringify(b)} — ZERO efeitos colaterais`);

        // Backend: vítima INALTERADA (mesma identidade/lifecycle).
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerAId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');

        // Exatamente UMA sessão ativa do ownerA e do pet; nenhuma nova sessão
        // criada pela re-entrada ou pelo probe.
        const ownerActive = await activeOwnerASessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);
        const { data: runSessions, error: rErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('e2e_run_id', runId);
        if (rErr) throw new Error(`run_sessions_failed: ${JSON.stringify(rErr)}`);
        expect(runSessions || []).toHaveLength(1);
        expect(runSessions![0].id).toBe(sessionId);
        log('PROVA B COMPLETA: fail-closed + vítima inalterada + nenhuma sessão duplicada');
      });

      await test.step('invariante final: MESMA sessão única do run (vítima intacta após as duas provas)', async () => {
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerAId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');
        log('AUTH_REHYDRATION_CROSS_OWNER_ISOLATION_4.5B3_PROOF_COMPLETED');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos para as 3 identidades', async () => {
        // Higiene de listeners.
        detachOwnerScopedReadObserver();
        detachReentryNavObserver();
        if (walkerPage) detachArriveObservers();
        // Páginas temporárias/extra: fechadas com segurança.
        if (ownerPinPage && !ownerPinPage.isClosed()) await ownerPinPage.close().catch(() => {});
        ownerPinPage = null;
        if (reentryPage && !reentryPage.isClosed()) await reentryPage.close().catch(() => {});
        if (ownerBPage && !ownerBPage.isClosed()) await ownerBPage.close().catch(() => {});
        // Contextos: fechados (ownerA, walker, ownerB).
        if (walkerCtx) await walkerCtx.close().catch(() => {});
        if (ownerBCtx) await ownerBCtx.close().catch(() => {});
        if (ownerACtx) await ownerACtx.close().catch(() => {});
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
        // Usuários/perfis/pets: helper certificado para TODAS as identidades
        // do run (ownerA, walker, ownerB) — valida metadata E2E e exige ZERO
        // resíduos; qualquer falha FALHA a suíte.
        if (runId && ownerAId && walkerId && ownerBId) {
          await failClosedCleanup(admin, [ownerAId, walkerId, ownerBId], runId);
        }
        log('cleanup concluído — zero resíduos (ownerA + walker + ownerB)');
      });
    }
  });
});
