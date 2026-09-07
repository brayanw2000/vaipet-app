import { test, expect, Page, BrowserContext } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

/**
 * PHASE 4.3 — PATCH 2 — OPERATIONAL FRONTEND COMPLETION FLOW
 *
 * O lifecycle (in_progress → returning → completed) é executado EXCLUSIVAMENTE
 * por CLIQUE REAL da UI:
 *   - request-return-button        → customer_request_return
 *   - confirm-return-arrival-button→ customer_confirm_arrival
 *
 * O teste NÃO chama customer_request_return / customer_confirm_arrival /
 * petwalker_complete_walk / update_walker_location diretamente.
 *
 * Admin/service_role: somente setup, auditoria factual e cleanup.
 * GPS do PetWalker: browser geolocation → PetwalkerGpsProvider →
 * update_walker_location (nunca chamado pelo teste).
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const E2E_RUN_ID = `4.3-operational-${Date.now()}`;
const PASSWORD = 'VaiPet@2026';

// Posições GPS do browser Walker (contexto com geolocation).
const LOC_A = { longitude: -46.6333, latitude: -23.5505 };
const LOC_B = { longitude: -46.6353, latitude: -23.5525 };
const LOC_C = { longitude: -46.6373, latitude: -23.5545 };

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [completion-operational-4.3] ${msg}`);

async function loginViaUi(page: Page, email: string) {
  await page.goto('/auth');
  await page.getByPlaceholder('E-mail').fill(email);
  await page.getByPlaceholder('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /^Entrar$/i }).click();
  // Login REAL validado: sair da tela de auth = sucesso.
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 25000 });
}

test.describe('Phase 4.3: Operational Completion Flow (Patch 2)', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 180_000 });

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

  async function auditSession(id: string) {
    const { data, error } = await admin.from('walk_sessions').select('*').eq('id', id).single();
    if (error) throw new Error(`audit_session_failed: ${JSON.stringify(error)}`);
    return data;
  }

  async function auditWalkerProfile() {
    const { data, error } = await admin
      .from('petwalker_profiles')
      .select('current_walk_id, last_location_captured_at, availability_status')
      .eq('user_id', walkerId)
      .single();
    if (error) throw new Error(`audit_walker_profile_failed: ${JSON.stringify(error)}`);
    return data;
  }

  async function trackingStats(id: string) {
    const { data: rows, error } = await admin
      .from('walker_tracking')
      .select('id')
      .eq('walk_session_id', id);
    if (error) throw new Error(`tracking_select_failed: ${JSON.stringify(error)}`);
    const { data: session, error: sErr } = await admin
      .from('walk_sessions')
      .select('route_coordinates')
      .eq('id', id)
      .single();
    if (sErr) throw new Error(`route_select_failed: ${JSON.stringify(sErr)}`);
    return {
      trackingCount: rows ? rows.length : 0,
      routeLen: Array.isArray(session.route_coordinates) ? session.route_coordinates.length : 0,
    };
  }

  test.beforeAll(async ({ browser }) => {
    // ---------- SETUP (admin/service_role — dados E2E) ----------
    const createUser = async (email: string, intent: string) => {
      const res = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { signup_intent: intent, e2e_test: true, e2e_run_id: E2E_RUN_ID },
      });
      if (res.error) throw res.error;
      const uid = res.data.user!.id;

      const { error: pErr } = await admin.from('profiles').upsert({
        id: uid,
        full_name: intent === 'petwalker' ? 'Walker Operacional E2E' : 'Owner Operacional E2E',
        onboarding_completed: true,
        signup_intent: intent,
        e2e_test: true,
      });
      if (pErr) throw pErr;

      const { error: dErr } = await admin.from('user_roles').delete().eq('user_id', uid);
      if (dErr) throw dErr;

      const { error: rErr } = await admin.from('user_roles').insert([
        { user_id: uid, role: 'user' },
        ...(intent === 'petwalker' ? [{ user_id: uid, role: 'petwalker' }] : []),
      ]);
      if (rErr) throw rErr;

      return uid;
    };

    ownerEmail = `owner-${E2E_RUN_ID}@test.com`;
    walkerEmail = `walker-${E2E_RUN_ID}@test.com`;
    ownerId = await createUser(ownerEmail, 'pet_owner');
    walkerId = await createUser(walkerEmail, 'petwalker');

    const { error: wpErr } = await admin.from('petwalker_profiles').upsert({
      user_id: walkerId,
      approval_status: 'approved',
      profile_completed: true,
      availability_status: 'busy',
      is_accepting_requests: false,
      price_30_minutes: 2000,
      experience_years: 2,
      service_radius_km: 10,
      last_known_location: `SRID=4326;POINT(${LOC_A.longitude} ${LOC_A.latitude})`,
      e2e_test: true,
    });
    if (wpErr) throw wpErr;

    const { data: pet, error: petErr } = await admin
      .from('pets')
      .insert({
        owner_id: ownerId,
        name: 'Oper Pet',
        breed: 'Vira-lata',
        weight: 12,
        e2e_test: true,
        e2e_run_id: E2E_RUN_ID,
      })
      .select('id')
      .single();
    if (petErr) throw petErr;
    petId = pet.id;

    const { data: session, error: sErr } = await admin
      .from('walk_sessions')
      .insert({
        customer_id: ownerId,
        walker_id: walkerId,
        pet_id: petId,
        status: 'in_progress',
        current_status: 'in_progress',
        walk_type: 'livre',
        request_mode: 'now',
        start_time: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        planned_duration_minutes: 30,
        total_price_cents: 2500,
        meeting_point_address: 'Av. E2E Operacional, 100',
        meeting_point_geom: `SRID=4326;POINT(${LOC_A.longitude} ${LOC_A.latitude})`,
        home_location: { lng: LOC_A.longitude, lat: LOC_A.latitude },
        e2e_test: true,
        e2e_run_id: E2E_RUN_ID,
      })
      .select('id')
      .single();
    if (sErr) throw sErr;
    sessionId = session.id;

    const { error: cwErr } = await admin
      .from('petwalker_profiles')
      .update({ current_walk_id: sessionId })
      .eq('user_id', walkerId);
    if (cwErr) throw cwErr;

    log(`setup ok runId=${E2E_RUN_ID} sessionId=${sessionId}`);

    // ---------- BROWSERS REAIS ----------
    walkerCtx = await browser.newContext({
      viewport: { width: 430, height: 900 },
      locale: 'pt-BR',
      permissions: ['geolocation'],
      geolocation: LOC_A,
    });
    ownerCtx = await browser.newContext({
      viewport: { width: 430, height: 900 },
      locale: 'pt-BR',
      permissions: ['geolocation'],
      geolocation: LOC_A,
    });
    walkerPage = await walkerCtx.newPage();
    ownerPage = await ownerCtx.newPage();
    armRpcObserver(walkerPage, 'customer_request_return');
    armRpcObserver(walkerPage, 'customer_confirm_arrival');
    armRpcObserver(ownerPage, 'customer_request_return');
    armRpcObserver(ownerPage, 'customer_confirm_arrival');
    armRpcObserver(walkerPage, 'update_walker_location');
  });

  test.afterAll(async () => {
    // Cleanup determinístico — falha fecha o run (fail closed).
    if (walkerCtx) await walkerCtx.close().catch(() => {});
    if (ownerCtx) await ownerCtx.close().catch(() => {});
    await failClosedCleanup(admin, [ownerId, walkerId], E2E_RUN_ID);
  });

  test('01. Setup operacional: sessão in_progress visível nos dois browsers', async () => {
    // ---------- BROWSER WALKER ----------
    await loginViaUi(walkerPage!, walkerEmail);
    await walkerPage!.goto(`/petwalker/passeio/${sessionId}`);
    // Tela operacional carregou + estado in_progress.
    await expect(walkerPage!.getByTestId('walk-in-progress-marker')).toBeVisible({ timeout: 20000 });

    // ---------- BROWSER OWNER ----------
    await loginViaUi(ownerPage!, ownerEmail);
    await ownerPage!.goto(`/search-walk?resume=${sessionId}`);
    // WalkInProgress montado com o CTA determinístico visível.
    await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 20000 });

    // Auditoria factual: sessão in_progress/in_progress + current_walk_id set.
    const s = await auditSession(sessionId);
    expect(s.status).toBe('in_progress');
    expect(s.current_status).toBe('in_progress');
    const prof = await auditWalkerProfile();
    expect(prof.current_walk_id).toBe(sessionId);
  });

  test('02. Botão Back NÃO conclui nem altera a sessão', async () => {
    rpcCalls['customer_request_return'] = [];
    rpcCalls['customer_confirm_arrival'] = [];

    // Clique no botão Back real do Owner (header do WalkInProgress).
    await ownerPage!.getByRole('button', { name: 'Voltar para a Home' }).click();
    // Navegou para a home (rota canônica após redirect do usuário logado).
    await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 15000 });

    // NENHUMA RPC de retorno/confirmação disparou.
    await expect.poll(() => (rpcCalls['customer_request_return'] || []).length).toBe(0);
    await expect.poll(() => (rpcCalls['customer_confirm_arrival'] || []).length).toBe(0);

    // Sessão permanece in_progress no backend (nada foi alterado).
    const s = await auditSession(sessionId);
    expect(s.status).toBe('in_progress');
    expect(s.current_status).toBe('in_progress');
    const prof = await auditWalkerProfile();
    expect(prof.current_walk_id).toBe(sessionId);

    // Reabrir e continuar o lifecycle.
    await ownerPage!.goto(`/search-walk?resume=${sessionId}`);
    await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 20000 });
  });

  test('03. Owner solicita retorno pela UI (request-return-button)', async () => {
    rpcCalls['customer_request_return'] = [];

    await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible();
    await ownerPage!.getByTestId('request-return-button').click();

    // Resposta REAL da página: HTTP 200 + body true.
    await expect.poll(() => lastRpc('customer_request_return')).toBeTruthy();
    const rpc = lastRpc('customer_request_return')!;
    expect(rpc.status).toBe(200);
    expect(rpc.body).toBe(true);

    // Auditoria: returning/returning + current_walk_id mantido.
    await expect
      .poll(
        async () => {
          const s = await auditSession(sessionId);
          return s.current_status;
        },
        { timeout: 15000 }
      )
      .toBe('returning');
    const s = await auditSession(sessionId);
    expect(s.status).toBe('returning');
    expect(s.current_status).toBe('returning');
    const prof = await auditWalkerProfile();
    expect(prof.current_walk_id).toBe(sessionId);

    // UI Owner entrou no estado returning (botão determinístico some).
    await expect(ownerPage!.getByTestId('owner-returning-state')).toBeVisible({ timeout: 15000 });
    await expect(ownerPage!.getByTestId('request-return-button')).toHaveCount(0);
  });

  test('04. PetWalker recebe returning SEM reload manual', async () => {
    // Realtime/polling de WalkDetails atualizam a sessão.
    await expect(walkerPage!.getByTestId('walker-returning-state')).toBeVisible({ timeout: 20000 });

    // Nenhum botão de conclusão unilateral existe na tela do walker.
    await expect(
      walkerPage!.getByRole('button', { name: /Concluir|Encerrar|Finalizar/i })
    ).toHaveCount(0);
  });

  test('05. GPS continua ativo durante returning (browser → Provider)', async () => {
    const before = await trackingStats(sessionId);
    const profBefore = await auditWalkerProfile();
    expect(profBefore.current_walk_id).toBe(sessionId);

    // Move o GPS do BROWSER Walker para B (nunca chamamos update_walker_location).
    await walkerCtx!.setGeolocation(LOC_B);
    // Throttle certificado da Phase 4.2 (10s provider + 5s append): espera >= 10.5s,
    // depois força um novo sample para garantir sync.
    await walkerPage!.waitForTimeout(11000);
    await walkerCtx!.setGeolocation(LOC_C);
    await walkerPage!.waitForTimeout(3000);

    const after = await trackingStats(sessionId);
    const profAfter = await auditWalkerProfile();

    expect(after.trackingCount).toBeGreaterThan(before.trackingCount);
    expect(after.routeLen).toBeGreaterThan(before.routeLen);
    expect(profAfter.last_location_captured_at).toBeGreaterThan(
      profBefore.last_location_captured_at ?? 0
    );
    log(`gps during returning: tracking ${before.trackingCount} -> ${after.trackingCount}; route ${before.routeLen} -> ${after.routeLen}`);
  });

  test('06. Owner confirma chegada pela UI (confirm-return-arrival-button)', async () => {
    rpcCalls['customer_confirm_arrival'] = [];

    await expect(ownerPage!.getByTestId('confirm-return-arrival-button')).toBeVisible();
    await ownerPage!.getByTestId('confirm-return-arrival-button').click();

    await expect.poll(() => lastRpc('customer_confirm_arrival')).toBeTruthy();
    const rpc = lastRpc('customer_confirm_arrival')!;
    expect(rpc.status).toBe(200);
    expect(rpc.body).toBe(true);

    // Auditoria: completed + end_time + métricas persistidas + current_walk_id null.
    await expect
      .poll(
        async () => {
          const s = await auditSession(sessionId);
          return s.current_status;
        },
        { timeout: 15000 }
      )
      .toBe('completed');
    const s = await auditSession(sessionId);
    expect(s.status).toBe('completed');
    expect(s.current_status).toBe('completed');
    expect(s.end_time).not.toBeNull();
    expect(Number(s.actual_duration_minutes)).toBeGreaterThanOrEqual(1);
    expect(Number(s.distance_km)).toBeGreaterThanOrEqual(0);
    const prof = await auditWalkerProfile();
    expect(prof.current_walk_id).toBeNull();
  });

  test('07. Review real SEM reload (sessionId + métricas persistidas)', async () => {
    await expect(ownerPage!.getByTestId('review-walk-screen')).toBeVisible({ timeout: 15000 });

    // Mesma sessão (nenhuma nova sessão criada) e métricas do backend na tela.
    expect(ownerPage!.url()).toContain(`resume=${sessionId}`);
    const s = await auditSession(sessionId);
    const actual = Number(s.actual_duration_minutes);
    const distanceDisplay = (Number(s.distance_km) || 0).toFixed(2);
    const text = (await ownerPage!.getByTestId('review-walk-screen').textContent()) || '';
    expect(text).toContain(`${actual}`);
    expect(text).toContain(distanceDisplay);
  });

  test('08. PetWalker recebe completed e sai da sessão ativa', async () => {
    // WalkDetails navega para /petwalker ao receber completed (sem reload manual).
    await expect(walkerPage!).toHaveURL(/\/petwalker\/?$/, { timeout: 25000 });

    // A sessão concluída NÃO aparece como passeio ativo no painel.
    await expect(walkerPage!.getByRole('button', { name: 'Gerenciar Passeio' })).toHaveCount(0, {
      timeout: 15000,
    });
    await expect(walkerPage!.getByText('Passeio em andamento')).toHaveCount(0);
  });

  test('09. Refresh do Owner em completed volta para ReviewWalk', async () => {
    await ownerPage!.goto(`/search-walk?resume=${sessionId}`);
    // Não pode voltar para idle/walking nem criar outra sessão.
    await expect(ownerPage!.getByTestId('review-walk-screen')).toBeVisible({ timeout: 20000 });
    await expect(ownerPage!.getByTestId('request-return-button')).toHaveCount(0);
    await expect(ownerPage!.getByTestId('owner-returning-state')).toHaveCount(0);

    const s = await auditSession(sessionId);
    expect(s.status).toBe('completed');
    expect(s.current_status).toBe('completed');
  });

  test('10. Tracking freeze operacional pós-completion', async () => {
    const before = await trackingStats(sessionId);

    // Provider ainda rodando? move para C — nenhum dado pode crescer.
    await walkerCtx!.setGeolocation(LOC_C);
    await walkerPage!.waitForTimeout(12000);

    const after = await trackingStats(sessionId);
    expect(after.trackingCount).toBe(before.trackingCount);
    expect(after.routeLen).toBe(before.routeLen);
    log(`tracking freeze: tracking ${before.trackingCount} -> ${after.trackingCount}; route ${before.routeLen} -> ${after.routeLen}`);
  });
});