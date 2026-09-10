/**
 * PHASE 4.5B1 — OWNER TEMPORARY NETWORK GAP / MISSED REALTIME RECOVERY —
 * TEST-ONLY FIRST PROOF
 *
 * Diferença para a 4.5A (NÃO reaberta, todas GREEN):
 *   4.5A provou recuperação por RELOAD/re-entrada da página do Owner.
 *   4.5B1 prova recuperação SEM RELOAD: a página do Owner permanece MONTADA,
 *   a conectividade de rede do Owner fica temporariamente indisponível e o
 *   Walker executa transições REAIS. Quando a rede volta, o produto já
 *   montado deve convergir sozinho para o current_status canônico do banco.
 *
 * DUAS lacunas de rede na MESMA jornada real:
 *
 *   A) heading_to_pickup → Owner OFFLINE → Walker clica REAL
 *      "Cheguei no Local" → backend arrived → Owner ONLINE →
 *      apresentação arrived (pickup-pin-input do Owner + backend arrived)
 *      automaticamente, SEM reload/navegação/clique/ação.
 *
 *   B) arrived → Owner OFFLINE novamente → Walker digita o PIN REAL e
 *      confirma (petwalker_confirm_pickup) → backend in_progress →
 *      Owner ONLINE → apresentação in_progress
 *      (data-testid="request-return-button") automaticamente, SEM
 *      reload/navegação/clique/ação.
 *
 * ARQUITETURA DE PRODUTO SOB TESTE (NÃO modificada):
 *   SearchWalk (sessão ativa) mantém:
 *     - realtime subscription (postgres_changes em walk_sessions),
 *     - fetchStatus('initial') imediato,
 *     - polling de recuperação fetchStatus('recovery') a cada 5s,
 *     - re-sincronia em focus/visibilitychange,
 *   com o backend walk_sessions.current_status como AUTORIDADE do domínio.
 *
 * CONTRATO HONESTO (sem contrato falso):
 *   - NÃO exigimos que o Supabase Realtime entregue o evento perdido;
 *     a recuperação pode ocorrer legítimamente por reconexão de realtime,
 *     pelo polling de recuperação de 5s ou por focus/visibility.
 *   - O que exigimos é CONVERGÊNCIA FINAL visível ao usuário dentro de uma
 *     janela factual (as expectativas usam timeout ~15s, compatível com o
 *     polling de 5s), sem nenhuma ação do Owner.
 *
 * JORNADA REAL (mesma sessão/Owner/Walker/Pet, sem estado fabricado):
 *   Owner  → cria pedido pela UI (create_walk_request)        → searching
 *   Scheduler → process_walk_matching real (ÚNICA admin.rpc)  → oferta pending
 *   Walker → aceita pela UI (accept_walk_request)             → accepted
 *   Walker → "Iniciar deslocamento" (petwalker_start_heading) → heading_to_pickup
 *   GAP A   → ownerContext.setOffline(true)
 *   Walker → "Cheguei no Local" real (petwalker_arrive_pickup) → arrived
 *             (observador T6 in-page: clone do fetch real — sem race CDP)
 *   Owner ONLINE → ZERO ações → UI convergindo para arrived
 *   Owner  → lê o PIN REAL da UI (/historico/:id em página TEMPORÁRIA do
 *            MESMO ownerCtx — a ownerPage MONTADA permanece intocada; nunca
 *            admin/DB)
 *   GAP B   → ownerContext.setOffline(true) novamente
 *   Walker → digita PIN real na UI + petwalker_confirm_pickup  → in_progress
 *             (contrato certificado 4.4: HTTP 200 + reload real do produto)
 *   Owner ONLINE → ZERO ações → request-return-button automaticamente
 *
 * NUNCA: create/accept/heading/arrive/confirm por admin ou test; mock de GPS;
 * mock de Supabase; reload do Owner (ZERO ownerPage.reload no arquivo inteiro);
 * injeção de ?resume ou storage; eventos sintéticos de focus/lifecycle;
 * fetchStatus manual; novo UX offline no produto.
 *
 * CONTADORES MONOTÔNICOS: as observações de RPC são acumulativas; antes de
 * cada reconexão registramos as contagens e, após a reconexão, exigimos
 * igualdade (nenhuma RPC de ciclo de vida pode ser disparada pela recuperação
 * do Owner — os únicos arrive/confirm são as ações REAIS do Walker).
 *
 * FAIL-CLOSED: se o contexto do Owner estiver offline ao falhar, restauramos
 * a rede ANTES do cleanup; qualquer falha de cleanup FALHA a suíte.
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
// (150m + LEAST(_accuracy, 50)) — fixture consistente com os testes 4.4/4.5A.
const WALKER_POS = { lng: -46.7001, lat: -23.6001 };

// Estados ativos (não terminais) do domínio.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

// Filtro estrito de console — apenas erros relevantes. NUNCA dumpa objetos
// arbitrários (podem conter segredos): apenas a mensagem de texto.
const ARRIVE_CONSOLE_FILTER = /arriv|pickup|GPS|geolocation|supabase|fetch/i;

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5b1-owner-network-gap-recovery] ${msg}`);

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

test.describe('Phase 4.5B1: Owner network-gap recovery (no reload)', () => {
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

  // Contadores monotônicos de RPC (NUNCA resetados — comparação antes/depois).
  let acceptCountBeforeReconnectA = 0;
  let headingCountBeforeReconnectA = 0;
  let arriveCountBeforeReconnectA = 0;
  let acceptCountBeforeReconnectB = 0;
  let headingCountBeforeReconnectB = 0;
  let arriveCountBeforeReconnectB = 0;
  let confirmPickupCountBeforeReconnectB = 0;

  // URL EXATA do Owner (produzida pelo produto real, capturada de
  // ownerPage.url() — NUNCA construída manualmente) imediatamente ANTES de
  // cada lacuna de rede. Após cada reconexão, a página MONTADA deve manter
  // a MESMA URL exata (sem navegação/mutação de query pela recuperação).
  let ownerUrlBeforeGapA = '';
  let ownerUrlBeforeGapB = '';

  // Observador factual das respostas RPC reais da página (HTTP + body).
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
  // Idêntico ao certificado em tests/owner-arrived-recovery-4.5a.spec.ts:
  // exposeBinding + addInitScript (ANTES de qualquer JS do app) instalam um
  // wrapper TRANSPARENTES de window.fetch — para a RPC de chegada apenas,
  // executa o fetch nativo ORIGINAL, clona a resposta REAL (response.clone()),
  // lê o clone, entrega os fatos SEGUROS (status + body + pathname — sem
  // headers/tokens) ao Node e devolve a Response ORIGINAL intocada ao app.
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

  test('Owner montado atravessa 2 lacunas de rede e converge para arrived e in_progress SEM reload/ação', async ({ browser }) => {
    runId = `4.5b1_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetNetGap45B1';

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
        armRpcObserver(ownerPage, 'customer_request_return'); // T1: RPC do LADO DO OWNER — observada na página do Owner
        armRpcObserver(walkerPage, 'petwalker_confirm_pickup');
        armRpcObserver(walkerPage, 'accept_walk_request');
        armRpcObserver(walkerPage, 'petwalker_start_heading');
        armArriveObservers(walkerPage); // T3: observabilidade factual da chegada
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
      // GAP A — Owner OFFLINE em heading_to_pickup (página MONTADA)
      // ================================================================
      await test.step('GAP A: Owner OFFLINE (contexto, não produto) em heading_to_pickup — página MONTADA', async () => {
        // Estado do domínio exigido antes da lacuna.
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

        // URL EXATA atual do Owner, produzida pelo produto real (capturada,
        // não construída) — invariante de igualdade total pós-reconexão.
        ownerUrlBeforeGapA = ownerPage!.url();
        log(`GAP A: ownerUrlBeforeGapA=${ownerUrlBeforeGapA}`);

        // Lacuna de rede REAL do ambiente de teste — NÃO é uma ação de produto.
        // A página do Owner permanece MONTADA e intocada.
        await ownerCtx!.setOffline(true);
        log('GAP A: ownerContext.setOffline(true) — Owner offline, página montada');
      });

      await test.step('GAP A: Walker ONLINE clica REAL "Cheguei no Local" → petwalker_arrive_pickup (T6) → arrived', async () => {
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

        // Handler-entry (fato factual, nunca falha por si só): o botão passa a
        // "Processando..." (setArriving(true) ANTES da RPC).
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

        // Backend: MESMA sessão arrived, MESMO Walker — enquanto o Owner está
        // OFFLINE (nenhuma prova via UI do Owner neste ponto).
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
            { timeout: 20000, message: 'backend arrived (Owner offline)' }
          )
          .toBeTruthy();
        log('backend arrived confirmado — Owner permanece OFFLINE');
      });

      await test.step('RECONEXÃO A: setOffline(false) e ZERO ações do Owner → catch-up automático para arrived', async () => {
        // Contadores monotônicos ANTES da reconexão (nenhuma nova RPC de ciclo
        // de vida pode ocorrer como consequência da recuperação do Owner).
        const before = lifecycleCounts();
        acceptCountBeforeReconnectA = before.accept;
        headingCountBeforeReconnectA = before.heading;
        arriveCountBeforeReconnectA = before.arrive;
        log(`pré-reconexão A: ${JSON.stringify(before)}`);

        // Apenas a conectividade volta. NENHUMA ação de produto após esta
        // linha: sem clique, sem reload, sem goto, sem pushState, sem
        // setSearchParams, sem RPC manual, sem injeção de storage, sem nova
        // página. A página do Owner permanece MONTADA.
        await ownerCtx!.setOffline(false);
        log('RECONEXÃO A: ownerContext.setOffline(false) — ZERO ações do Owner daqui em diante');

        // Invariantes de sessão: MESMA sessão, ainda arrived.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.current_status).toBe('arrived');

        // CONVERGÊNCIA VISÍVEL (sem reload/navegação): a apresentação arrived
        // do Owner (overlay PIN do WalkInProgress) deve reaparecer sozinha na
        // página MONTADA. Janela factual ~15s (polling de recuperação de 5s +
        // reconexão de realtime + focus/visibility) — a expectativa espera
        // deterministicamente, sem sleep cego.
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toBeVisible({ timeout: 15000 });
        await expect(ownerPage!.getByTestId('pickup-pin-submit')).toBeVisible({ timeout: 15000 });
        log('CATCH-UP A CONFIRMADO: UI arrived do Owner restaurada SEM reload/navegação/ação');

        // URL inalterada: a página MONTADA mantém a MESMA URL EXATA (igualdade
        // total — sem navegação/mutação de query pela recuperação). O pathname
        // permanece como asserção suplementar.
        expect(ownerPage!.url()).toBe(ownerUrlBeforeGapA);
        expect(new URL(ownerPage!.url()).pathname).toBe('/search-walk');

        // ZERO novas RPCs de ciclo de vida causadas pela reconexão (comparação
        // monotônica antes/depois).
        const after = lifecycleCounts();
        expect(after.create).toBe(before.create);
        expect(after.accept).toBe(acceptCountBeforeReconnectA);
        expect(after.heading).toBe(headingCountBeforeReconnectA);
        expect(after.arrive).toBe(arriveCountBeforeReconnectA);
        expect(after.confirmPickup).toBe(before.confirmPickup);
        expect(after.returnReq).toBe(before.returnReq);

        // Nenhuma segunda sessão ativa apareceu.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);
        log('pós-reconexão A: zero RPCs duplicadas + 1 sessão ativa por dono/pet');
      });

      await test.step('Owner lê o PIN REAL da UI (/historico/:id em página TEMPORÁRIA do mesmo ownerCtx) — nunca admin/DB', async () => {
        // 1) A ownerPage MONTADA permanece EXATAMENTE onde a reconexão A a
        //    deixou: MESMA URL EXATA + pathname /search-walk + apresentação
        //    arrived (pickup-pin-input/submit) ainda presente.
        expect(ownerPage!.url()).toBe(ownerUrlBeforeGapA);
        expect(new URL(ownerPage!.url()).pathname).toBe('/search-walk');
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toBeVisible({ timeout: 15000 });
        await expect(ownerPage!.getByTestId('pickup-pin-submit')).toBeVisible({ timeout: 15000 });

        // 2) Backend ainda: MESMA sessão/Owner/Walker/Pet, arrived.
        const s0 = await auditSession(sessionId);
        expect(s0.id).toBe(sessionId);
        expect(s0.customer_id).toBe(ownerId);
        expect(s0.walker_id).toBe(walkerId);
        expect(s0.pet_id).toBe(petId);
        expect(s0.status).toBe('arrived');
        expect(s0.current_status).toBe('arrived');

        // 3) Página TEMPORÁRIA do MESMO ownerCtx (mesma autenticação) para a
        //    rota certificada 4.5A2.4 do PIN (/historico/:id). A ownerPage
        //    MONTADA NÃO é navegada, não é recarregada e não é recriada.
        const ownerPinPage = await ownerCtx!.newPage();
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
          // A página temporária é fechada SEMPRE (inclusive em falha do step)
          // e ANTES do GAP B — setOffline(true) aplica-se ao contexto inteiro.
          await ownerPinPage.close().catch(() => {});
        }

        // 4) Reafirmação: a ownerPage MONTADA segue intocada — MESMA URL
        //    EXATA, pathname /search-walk, apresentação arrived presente e
        //    backend still same-session arrived.
        expect(ownerPage!.url()).toBe(ownerUrlBeforeGapA);
        expect(new URL(ownerPage!.url()).pathname).toBe('/search-walk');
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toBeVisible({ timeout: 15000 });

        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('arrived');
        expect(s.current_status).toBe('arrived');
      });

      // ================================================================
      // GAP B — Owner OFFLINE novamente em arrived (página MONTADA)
      // ================================================================
      await test.step('GAP B: Owner OFFLINE novamente (contexto, não produto) — página MONTADA em arrived', async () => {
        // Owner já está na tela arrived legítima (mesma página montada da
        // reconexão A — nenhuma navegação foi executada; reafirmamos o estado).
        expect(new URL(ownerPage!.url()).pathname).toBe('/search-walk');
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toBeVisible({ timeout: 15000 });

        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('arrived');
        expect(s.current_status).toBe('arrived');

        const before = lifecycleCounts();
        log(`pré-GAP B: ${JSON.stringify(before)}`);

        // URL EXATA atual do Owner, produzida pelo produto real (capturada,
        // não construída) — invariante de igualdade total pós-reconexão.
        ownerUrlBeforeGapB = ownerPage!.url();
        log(`GAP B: ownerUrlBeforeGapB=${ownerUrlBeforeGapB}`);

        await ownerCtx!.setOffline(true);
        log('GAP B: ownerContext.setOffline(true) — Owner offline novamente, página montada');
      });

      await test.step('GAP B: Walker ONLINE digita PIN REAL → petwalker_confirm_pickup → in_progress (contrato 4.4)', async () => {
        const pinInput = walkerPage!.getByTestId('pickup-pin-input');
        await expect(pinInput).toBeVisible({ timeout: 20000 });
        // O PIN preenchido vem EXCLUSIVAMENTE da UI do Owner (ownerPin).
        await pinInput.fill(ownerPin);

        const submitBtn = walkerPage!.getByTestId('pickup-pin-submit');
        await expect(submitBtn).toBeEnabled({ timeout: 10000 });

        // Contrato CERTIFICADO 4.4: WalkDetails.handleConfirmPickup executa
        // window.location.reload() IMEDIATAMENTE após data === true — sucesso
        // provado por HTTP 200 real + reload REAL + DB in_progress + UI marker.
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
        log('petwalker_confirm_pickup real (HTTP 200 + reload do produto)');

        // Backend: MESMA sessão, status + current_status in_progress, MESMO
        // Walker — enquanto o Owner está OFFLINE.
        await expect
          .poll(
            async () => {
              const s2 = await auditSession(sessionId);
              return (
                s2.status === 'in_progress' &&
                s2.current_status === 'in_progress' &&
                s2.walker_id === walkerId
              );
            },
            { timeout: 20000, message: 'in_progress/in_progress + walker_id (Owner offline)' }
          )
          .toBeTruthy();

        // Marker REAL do Walker na UI in_progress.
        await expect(walkerPage!.getByTestId('walk-in-progress-marker')).toBeVisible({ timeout: 15000 });
        log('backend in_progress + walk-in-progress-marker — Owner permanece OFFLINE');
      });

      await test.step('RECONEXÃO B: setOffline(false) e ZERO ações do Owner → request-return-button automaticamente', async () => {
        // Contadores monotônicos ANTES da reconexão B.
        const before = lifecycleCounts();
        acceptCountBeforeReconnectB = before.accept;
        headingCountBeforeReconnectB = before.heading;
        arriveCountBeforeReconnectB = before.arrive;
        confirmPickupCountBeforeReconnectB = before.confirmPickup;
        log(`pré-reconexão B: ${JSON.stringify(before)}`);

        // Apenas a conectividade volta. NENHUMA ação de produto.
        await ownerCtx!.setOffline(false);
        log('RECONEXÃO B: ownerContext.setOffline(false) — ZERO ações do Owner daqui em diante');

        // Backend invariante: MESMA sessão in_progress, MESMO Owner/Walker/Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('in_progress');
        expect(s.current_status).toBe('in_progress');

        // CONVERGÊNCIA VISÍVEL (sem reload/navegação): a UI do Owner deve
        // sair da apresentação arrived e mostrar o CTA canônico in_progress
        // (request-return-button) automaticamente na página MONTADA.
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 15000 });
        log('CATCH-UP B CONFIRMADO: request-return-button visível SEM reload/navegação/ação');

        // Apresentação arrived deixa de ser a autoridade: o overlay PIN de
        // chegada não pode mais ser a apresentação dominante. O produto pode
        // mantê-lo brevemente em desmontagem; a exigência é que NÃO exista
        // input de PIN ativo após a convergência (a apresentação in_progress
        // é a visível).
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toHaveCount(0, {
          timeout: 15000,
        });

        // URL inalterada: a página MONTADA mantém a MESMA URL EXATA (igualdade
        // total — sem navegação/mutação de query pela recuperação). O pathname
        // permanece como asserção suplementar.
        expect(ownerPage!.url()).toBe(ownerUrlBeforeGapB);
        expect(new URL(ownerPage!.url()).pathname).toBe('/search-walk');

        // ZERO novas RPCs de ciclo de vida causadas pela reconexão.
        const after = lifecycleCounts();
        expect(after.create).toBe(before.create);
        expect(after.accept).toBe(acceptCountBeforeReconnectB);
        expect(after.heading).toBe(headingCountBeforeReconnectB);
        expect(after.arrive).toBe(arriveCountBeforeReconnectB);
        expect(after.confirmPickup).toBe(confirmPickupCountBeforeReconnectB);
        expect(after.returnReq).toBe(before.returnReq);

        // Nenhuma segunda sessão ativa apareceu.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);
        log('pós-reconexão B: zero RPCs duplicadas + 1 sessão ativa por dono/pet');
      });

      await test.step('VERDADE FINAL: totais monotônicos factuais da jornada real', async () => {
        const c = lifecycleCounts();
        // Exatamente as chamadas REAIS da UI (1 cada); request_return ZERO
        // (nunca avançamos para returning).
        expect(c.create).toBe(1);
        expect(c.accept).toBe(1);
        expect(c.heading).toBe(1);
        expect(c.arrive).toBe(1);
        expect(c.confirmPickup).toBe(1);
        expect(c.returnReq).toBe(0);
        log(`totais finais: ${JSON.stringify(c)}`);
      });
    } finally {
      await test.step('cleanup fail-closed: rede restaurada + ZERO resíduos', async () => {
        // Se o Owner estiver offline (falha durante uma lacuna), restaura a
        // rede ANTES do cleanup para permitir a navegação de fechamento.
        try {
          await ownerCtx!.setOffline(false);
        } catch {
          /* contexto já fechado */
        }
        // T3: desinstala os observadores de chegada (higiene de listeners).
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
