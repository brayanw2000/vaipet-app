/**
 * PHASE 4.5B4 — REAL LOGOUT / REAL LOGIN ACTIVE-WALK RECOVERY —
 * TEST-ONLY FIRST PROOF
 *
 * Baseline certificada (NÃO reabrir):
 *   - 4.4: ciclo de vida real completo ✅
 *   - 4.5A: reload/resume recovery para todos os estados principais ✅
 *   - 4.5B1: recuperação de lacuna temporária de rede ✅
 *   - 4.5B2: automação de visibilidade = AMBIENTE NÃO SUPORTADO (nem RED nem
 *     GREEN de produto) ✅
 *   - 4.5B3: reidratação de sessão (close page → new page) + isolamento
 *     cross-owner ✅
 *
 * DIFERENÇA MATERIAL para 4.5B3:
 *   B3 provou reidratação PASSIVA (mesma sessão persistida no browser).
 *   B4 prova o caminho ATIVO de produto:
 *     Owner com passeio REAL in_progress
 *     → LOGOUT REAL pela UI do produto (Configuracoes → "Sair" —
 *       handleLogout → useAuth.signOut() → supabase.auth.signOut() real)
 *     → sessão Supabase DESTRUÍDA → /auth genuinamente NÃO autenticado
 *     → MESMO Owner faz LOGIN REAL pela UI (senha normal)
 *     → /inicio autenticado novamente → Banner REAL encontra a MESMA sessão
 *       in_progress → retomada pelo banner → request-return-button
 *     → ZERO duplicação de ciclo de vida.
 *   Sem localStorage manipulation; sem setSession; sem reuso de token; sem
 *   atalhos de admin auth.
 *
 * CONTRATO REAL DE LOGOUT DO PRODUTO (NÃO modificado):
 *   Configuracoes.tsx: handleLogout = await signOut(); navigate('/auth');
 *   useAuth.signOut: supabase.auth.signOut() + limpeza de user/session/
 *   profile/roles + authStatus 'unauthenticated'. Botão real: "Sair"
 *   ("Encerrar sessão"). O teste clica UMA vez no botão REAL.
 *
 * JORNADA REAL (réplica certificada 4.4/4.5A/B3 como SETUP até in_progress):
 *   Owner UI create → searching → admin.rpc('process_walk_matching')
 *   (ÚNICA admin.rpc, scheduler simulado) → Walker aceita pela UI →
 *   heading pela UI → "Cheguei no Local" (T6 in-page) → arrived →
 *   PIN REAL somente pela UI (/historico/<id> em página TEMPORÁRIA) →
 *   Walker digita o PIN → petwalker_confirm_pickup (HTTP 200 + reload) →
 *   in_progress + walk-in-progress-marker.
 *
 * PROVA PRÉ-LOGOUT: banner REAL cria ?resume=<sessionId> →
 *   request-return-button visível (NÃO clicado) — a sessão está retomável
 *   ANTES do logout.
 *
 * PROVA DE LOGOUT: UM clique REAL em "Sair" → /auth → UI de login presente →
 *   UI de active-walk AUSENTE (request-return-button count 0, banner
 *   ausente) → SEM re-auth automática (janela de estabilidade factual: a
 *   página permanece em /auth até o login explícito) → backend intacto
 *   (MESMA sessão in_progress; 1 ativa por dono/pet).
 *
 * PROVA PÓS-LOGIN: login REAL do MESMO owner → /inicio → Banner
 *   "Passeio em andamento" visível automaticamente → UM clique no banner →
 *   /search-walk?resume=<MESMA sessionId> criado PELO BANNER →
 *   request-return-button restaurado → backend in_progress íntegro.
 *
 * CONTINUIDADE DE OBSERVABILIDADE: a MESMA ownerPage permanece viva através
 * do logout/login (navegação SPA do produto — a Page não é recriada), então
 * os observers de RPC do Owner permanecem presos continuamente; provamos
 * ownerPage.isClosed() === false. Se o produto recriasse a Page, os observers
 * teriam de ser rearmados ANTES da navegação — aqui isso não ocorre.
 *
 * CONTADORES MONOTÔNICOS (NUNCA resetados):
 *   Owner: create_walk_request, customer_request_return,
 *   customer_confirm_arrival | Walker: accept_walk_request,
 *   petwalker_start_heading, petwalker_confirm_pickup | Chegada: T6.
 *   Esperados: create=1, accept=1, heading=1, arrive=1, confirmPickup=1,
 *   returnReq=0, confirmArrival=0 — antes do logout E no proof final.
 *
 * NUNCA (no arquivo inteiro): supabase.auth.signOut() manual; signOut()
 * importado; page.evaluate de storage/token; clearCookies;
 * localStorage.clear; injeção/restauração de storage; setSession; cópia de
 * token; signInWithPassword fora da UI; criação manual de sessões/ofertas;
 * RPCs de lifecycle manuais (exceção certificada:
 * admin.rpc('process_walk_matching')).
 *
 * SEGURANÇA DE LOGS: nenhum header/Authorization/apikey/cookie/token/
 * conteúdo de storage é logado. Email NÃO é logado; senha NUNCA.
 *
 * O QUE ESTE TESTE CERTIFICA (sem overclaim): logout REAL de produto →
 * estado não autenticado real → login REAL do mesmo usuário →
 * redescoberta/retomada do passeio ativo existente. NÃO certifica: reset de
 * senha, expiração de refresh-token, revogação server-side, reinício do
 * browser, reboot de dispositivo ou sincronia multi-dispositivo.
 *
 * FAIL-CLOSED: cleanup para owner + walker; qualquer falha FALHA a suíte.
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
// (150m + LEAST(_accuracy, 50)) — fixture consistente com 4.4/4.5A/B1/B3.
const WALKER_POS = { lng: -46.7001, lat: -23.6001 };

// Estados ativos (não terminais) do domínio.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

// Filtro estrito de console — apenas erros relevantes. NUNCA dumpa objetos
// arbitrários (podem conter segredos): apenas a mensagem de texto.
const ARRIVE_CONSOLE_FILTER = /arriv|pickup|GPS|geolocation|supabase|fetch/i;

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5b4-owner-logout-login-recovery] ${msg}`);

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

test.describe('Phase 4.5B4: real logout → real login → active-walk rediscovery/resume (zero duplication)', () => {
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
  // Página TEMPORÁRIA do ownerCtx usada SOMENTE para ler o PIN REAL na rota
  // certificada /historico/<id> — fechada ao final do step (try/finally).
  let ownerPinPage: Page | null = null;

  // ——— Observador factual das respostas RPC reais (HTTP + body) ———
  // Registro ÚNICO e monotônico: a MESMA ownerPage permanece viva através do
  // logout/login (navegação SPA), logo os observers do Owner cobrem ambos os
  // estados sem rearme e sem duplicação. NUNCA resetado.
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
    confirmArrival: (rpcCalls['customer_confirm_arrival'] || []).length,
  });

  // ——— T6: observador IN-PAGE do body REAL da chegada (sem CDP race) ———
  // Idêntico ao certificado em owner-arrived-recovery-4.5a / 4.5B1 / B3:
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

  test('Logout REAL → /auth não autenticado → login REAL do MESMO owner → banner redescobre e retoma o MESMO in_progress sem duplicação', async ({ browser }) => {
    runId = `4.5b4_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetLogout45B4';

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

      await test.step('login REAL via /auth (owner + walker) + observadores (T6 in-page ANTES da página)', async () => {
        walkerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          // Fixture certificada 4.4: posição real do Walker.
          geolocation: { longitude: WALKER_POS.lng, latitude: WALKER_POS.lat, accuracy: 10 },
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

        // Posse dos observers (contrato 4.5B3 T1): RPCs do Owner na página do
        // Owner; RPCs do Walker na página do Walker; chegada via T6.
        armRpcObserver(ownerPage, 'create_walk_request');
        armRpcObserver(ownerPage, 'customer_request_return');
        armRpcObserver(ownerPage, 'customer_confirm_arrival');
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

      await test.step('owner: PIN REAL da UI (/historico/:id em página TEMPORÁRIA do ownerCtx) — nunca admin/DB', async () => {
        // Página TEMPORÁRIA do MESMO ownerCtx (mesma autenticação) para a
        // rota certificada do PIN; a ownerPage principal NÃO é navegada aqui.
        ownerPinPage = await ownerCtx!.newPage();
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
          log('PIN lido da UI do OWNER (página temporária /historico, nunca via admin)');
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
      // PRÉ-LOGOUT: prova de retomabilidade (banner REAL → ?resume → CTA)
      // ================================================================
      await test.step('PRÉ-LOGOUT: MESMA sessão in_progress + banner REAL cria ?resume + request-return-button (NÃO clicado)', async () => {
        // Re-entrada legítima de produto (navegação normal).
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 15000 });

        // Backend: MESMA sessão in_progress MESMO owner/Walker/Pet.
        const s0 = await auditSession(sessionId);
        expect(s0.id).toBe(sessionId);
        expect(s0.customer_id).toBe(ownerId);
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
        log('pré-logout: sessão retomável pela UI (request-return-button visível; NÃO clicado)');

        // Exatamente UMA sessão ativa do Owner e do Pet.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // Totais monotônicos ANTES do logout.
        const c = lifecycleCounts();
        expect(c.create).toBe(1);
        expect(c.accept).toBe(1);
        expect(c.heading).toBe(1);
        expect(c.arrive).toBe(1);
        expect(c.confirmPickup).toBe(1);
        expect(c.returnReq).toBe(0);
        expect(c.confirmArrival).toBe(0);
        log(`pré-logout: ${JSON.stringify(c)}`);
      });

      // ================================================================
      // CONFIGURAÇÕES — navegação de precondição + botão REAL "Sair"
      // ================================================================
      await test.step('CONFIGURAÇÕES: /configuracoes carregada + botão REAL "Sair" visível', async () => {
        // Navegação de precondição (a rota existe no produto; nenhum test-id
        // foi adicionado ao produto). NÃO é a prova de recuperação.
        await ownerPage!.goto('/configuracoes');
        await expect(ownerPage!).toHaveURL(/\/configuracoes/, { timeout: 15000 });

        // Botão REAL de logout: texto visível "Sair" ("Encerrar sessão").
        const logoutBtn = ownerPage!.getByRole('button', { name: /Sair/i });
        await expect(logoutBtn).toBeVisible({ timeout: 15000 });
        const logoutText = (await logoutBtn.innerText()).trim();
        expect(logoutText).toMatch(/Sair/i);
        log('página de configurações carregada com o botão REAL "Sair"');
      });

      // ================================================================
      // LOGOUT REAL — UM clique no "Sair" do produto (nada manual)
      // ================================================================
      await test.step('LOGOUT REAL: UM clique no botão "Sair" → /auth genuinamente não autenticado', async () => {
        const logoutBtn = ownerPage!.getByRole('button', { name: /Sair/i });
        await expect(logoutBtn).toBeVisible({ timeout: 10000 });

        // EXATAMENTE UM clique real — invoca o handleLogout real do produto
        // (useAuth.signOut → supabase.auth.signOut() + limpeza de estado +
        // navigate('/auth')). NADA manual: sem supabase.auth.signOut() do
        // teste, sem page.evaluate, sem limpeza manual de storage/tokens.
        await logoutBtn.click();
        log('clique REAL em "Sair" executado (handleLogout do produto)');

        // Outcome real do logout: pathname /auth (navegação SPA — a MESMA
        // ownerPage permanece viva, com os observers do Owner presos).
        await expect
          .poll(() => new URL(ownerPage!.url()).pathname, {
            timeout: 15000,
            message: 'LOGOUT FLOW RED: clique em "Sair" não alcançou /auth não autenticado',
          })
          .toBe('/auth');
        expect(ownerPage!.isClosed()).toBe(false);
        log(`pós-logout: ${ownerPage!.url()} (mesma ownerPage viva — observadores contínuos)`);

        // Prova de estado NÃO autenticado pelo COMPORTAMENTO do produto:
        // a UI de login está presente (campos E-mail/Senha + botão Entrar).
        const emailInput = ownerPage!.getByPlaceholder('E-mail');
        const passInput = ownerPage!.getByPlaceholder('Senha');
        const entrarBtn = ownerPage!.getByRole('button', { name: /^Entrar$/i });
        await expect(emailInput).toBeVisible({ timeout: 15000 });
        await expect(passInput).toBeVisible({ timeout: 15000 });
        await expect(entrarBtn).toBeVisible({ timeout: 15000 });

        // UI de active-walk AUSENTE enquanto desautenticado.
        await expect(ownerPage!.getByTestId('request-return-button')).toHaveCount(0);
        await expect(ownerPage!.getByRole('button', { name: /Passeio em andamento/i })).toHaveCount(0);
        log('não autenticado comprovado: UI de login presente + UI de active-walk ausente');

        // SEM RE-AUTH AUTOMÁTICA (distinção B4 vs B3): janela de estabilidade
        // factual — a página deve PERMANECER em /auth por ≥ 2.5s até o login
        // explícito do teste. Se a sessão "voltar sozinha" (reidratação após
        // signOut real), o predicado falha → LOGOUT SESSION CLEARING RED.
        // Sem sleep cego: expect.poll observando o pathname continuamente.
        const authReachedAt = Date.now();
        await expect
          .poll(
            async () =>
              new URL(ownerPage!.url()).pathname === '/auth' &&
              Date.now() - authReachedAt >= 2500,
            {
              timeout: 8000,
              intervals: [250, 500, 1000],
              message:
                'LOGOUT SESSION CLEARING RED: a UI restaurou autenticação automaticamente após o logout real (sem login explícito)',
            }
          )
          .toBe(true);
        expect(new URL(ownerPage!.url()).pathname).toBe('/auth');
        log('sem re-auth automática: /auth estável por ≥ 2.5s antes do login explícito');

        // Backend: o passeio SOBREVIVE ao logout (admin SOMENTE para auditoria).
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);
        log('backend íntegro pós-logout: MESMA sessão in_progress + 1 ativa por dono/pet');

        // ZERO RPCs de lifecycle causadas pelo logout.
        const c = lifecycleCounts();
        expect(c.create).toBe(1);
        expect(c.returnReq).toBe(0);
        expect(c.confirmArrival).toBe(0);
      });

      // ================================================================
      // LOGIN REAL do MESMO owner — ação genuína de usuário pela UI
      // ================================================================
      await test.step('LOGIN REAL: mesmo owner entra pela UI (/auth → /inicio) — nenhum setSession/token/storage', async () => {
        // Login REAL certificado: preenche E-mail/Senha e clica Entrar —
        // ação genuína de usuário. NÃO há setSession, injeção de access
        // token, restore de storageState, cópia de material de auth antigo
        // nem signInWithPassword fora da UI.
        await loginViaUi(ownerPage!, ownerEmail);
        log(`login REAL do mesmo owner concluído: ${ownerPage!.url()}`);
      });

      // ================================================================
      // PÓS-LOGIN: Home autenticada + Banner redescobre o passeio ativo
      // ================================================================
      await test.step('PÓS-LOGIN: /inicio autenticado + Banner REAL "Passeio em andamento" redescobre a MESMA sessão', async () => {
        // Estado autenticado real (a rota de pouso normal pós-login é /inicio).
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 20000 });

        // Backend continua a MESMA sessão in_progress MESMO owner/Walker/Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');

        // Banner REAL visível automaticamente — redescoberta do passeio ativo
        // pelo novo estado autenticado (consulta Owner-scoped do produto).
        const banner = ownerPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner).toBeVisible({ timeout: 30000 });
        log('POST-LOGIN ACTIVE-WALK REDISCOVERY: banner visível automaticamente');

        // Continuidade do Walker (suplementar): marker in_progress ainda vivo.
        await expect(walkerPage!.getByTestId('walk-in-progress-marker')).toBeVisible({ timeout: 15000 });
        log('walker continuity: walk-in-progress-marker ainda visível (Walker não foi deslogado)');
      });

      await test.step('RETOMADA PÓS-LOGIN: banner → clique ÚNICO → ?resume criado PELO BANNER → request-return-button (NÃO clicado)', async () => {
        const banner = ownerPage!.getByRole('button', { name: /Passeio em andamento/i });
        await expect(banner).toBeVisible({ timeout: 15000 });

        // UM clique real no banner — é ele quem cria a URL de retomada.
        await banner.click();

        // Navegação automática do produto: pathname /search-walk + ?resume.
        await expect
          .poll(
            () => {
              const u = new URL(ownerPage!.url());
              return u.pathname === '/search-walk' && u.searchParams.get('resume') === sessionId;
            },
            { timeout: 15000, message: '?resume=<MESMA sessionId> criado pelo banner pós-login' }
          )
          .toBeTruthy();
        log(`banner pós-login criou a retomada: ${ownerPage!.url()}`);

        // UI in_progress restaurada automaticamente (ZERO ações do teste;
        // request-return-button NÃO é clicado).
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 30000 });

        // Backend: MESMA sessão in_progress; 1 ativa por dono/pet; nenhuma
        // nova walk_session no run.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');
        const ownerActive = await activeOwnerSessionCount();
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
      });

      // ================================================================
      // VERDADE FINAL — contadores monotônicos inalterados pelo ciclo
      // ================================================================
      await test.step('VERDADE FINAL: totais monotônicos factuais (logout/login não duplicam lifecycle)', async () => {
        const c = lifecycleCounts();
        expect(c.create).toBe(1);
        expect(c.accept).toBe(1);
        expect(c.heading).toBe(1);
        expect(c.arrive).toBe(1);
        expect(c.confirmPickup).toBe(1);
        expect(c.returnReq).toBe(0);
        expect(c.confirmArrival).toBe(0);
        log(`totais finais: ${JSON.stringify(c)}`);
        log('REAL_LOGOUT_LOGIN_ACTIVE_WALK_RECOVERY_4.5B4_PROOF_COMPLETED');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos', async () => {
        // Página temporária de PIN: fechada com segurança em QUALQUER cenário.
        if (ownerPinPage && !ownerPinPage.isClosed()) await ownerPinPage.close().catch(() => {});
        ownerPinPage = null;
        // Higiene de listeners.
        if (walkerPage) detachArriveObservers();
        // Contextos: fechados (Owner + Walker).
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
        // Usuários/perfis/pet: helper certificado (valida metadata E2E do run)
        // para AMBAS as identidades; exige ZERO resíduos.
        if (runId && ownerId && walkerId) {
          await failClosedCleanup(admin, [ownerId, walkerId], runId);
        }
        log('cleanup concluído — zero resíduos (owner + walker)');
      });
    }
  });
});
