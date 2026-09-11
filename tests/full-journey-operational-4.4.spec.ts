import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

/**
 * PHASE 4.4 — FULL JOURNEY OPERATIONAL E2E
 *
 * UMA jornada contínua e ininterrupta usando SEMPRE o MESMO:
 *   owner, petwalker, pet, walk_session, sessionId, runId.
 *
 * Lifecycle (todas as transições via UI REAL):
 *   Owner UI create_walk_request
 *   → searching → process_walk_matching (scheduler simulado) → oferta real
 *   → accept UI → accepted
 *   → ActiveWalkSheet "Iniciar deslocamento" (1 clique) → heading_to_pickup
 *   → "Cheguei no Local" com GPS do browser → arrived
 *   → Owner vê PIN real (UI) → Walker digita PIN (UI) → in_progress
 *   → GPS: browser → PetwalkerGpsProvider → update_walker_location
 *   → Owner vê posição ao vivo (get_active_walker_location)
 *   → request-return-button → returning → GPS continua → returning
 *   → confirm-return-arrival-button → completed → ReviewWalk
 *   → avaliação REAL (estrela 5 + comentário) → persiste
 *   → MESMA sessão no histórico do Owner e do PetWalker
 *   → tracking/rota congelados após completion
 *   → cleanup ZERO resíduos (fail-closed).
 *
 * REGRAS:
 * - O teste NUNCA chama diretamente: create_walk_request, accept_walk_request,
 *   petwalker_start_heading, petwalker_arrive_pickup,
 *   customer_get_pickup_code (fonte do PIN), petwalker_confirm_pickup,
 *   update_walker_location, customer_request_return,
 *   customer_confirm_arrival, petwalker_complete_walk.
 * - Admin/service_role: setup determinístico, tag e2e_run_id, auditoria
 *   factual, process_walk_matching (representa o scheduler) e cleanup.
 * - NÃO insere walk_sessions nem walk_offers.
 */

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

// create_walk_request RETORNA uuid (NÃO boolean). Matcher estrito de UUID v4
// conforme as variantes aceitas pelo Postgres gen_random_uuid().
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// GPS do OWNER (browser) = ponto de encontro = home_location esperada
// (SearchWalk envia userLocation como _meeting_point_lng/_meeting_point_lat).
const MEETING = { lng: -46.7, lat: -23.6 };
// GPS do WALKER (browser) ~14m do ponto de encontro — dentro do raio
// (150m + LEAST(accuracy, 50)) exigido por petwalker_arrive_pickup.
const ARRIVE_POS = { longitude: -46.7001, latitude: -23.6001 };
// Posições de deslocamento — TODAS distintas entre si e do ponto de chegada.
const LOC_A = { longitude: -46.7100, latitude: -23.6100 };
const LOC_B = { longitude: -46.7125, latitude: -23.6125 };
const LOC_C = { longitude: -46.7150, latitude: -23.6150 };
const LOC_D = { longitude: -46.7180, latitude: -23.6180 };

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [full-journey-4.4] ${msg}`);

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

  // FIXTURE (validação externa Blocker Patch A1): o trigger handle_new_user
  // NÃO copia signup_intent para profiles. Sem isto o PetwalkerGpsProvider
  // mantém isPetwalker=false e o Painel nunca fica online.
  const { error: profErr } = await admin.from('profiles').upsert({
    id,
    full_name: `E2E ${kind}`,
    onboarding_completed: true,
    phone: '(11) 96666-6666',
    age: 32,
    signup_intent: kind,
  });
  if (profErr) throw new Error(`profile_upsert_failed: ${JSON.stringify(profErr)}`);

  // PREFLIGHT FACTUAL (fail-closed): profiles.signup_intent === kind.
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

    // PREFLIGHT PetWalker (fail-closed): papel + perfil pronto.
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
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 45000 });
}

test.describe('Phase 4.4: Full Journey Operational E2E (single continuous walk)', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 420_000 });

  let runId = '';
  let ownerId = '';
  let walkerId = '';
  let petId = '';
  let sessionId = '';
  let petName = '';
  let ownerEmail = '';
  let walkerEmail = '';
  let ownerCtx: BrowserContext | null = null;
  let walkerCtx: BrowserContext | null = null;
  let ownerPage: Page | null = null;
  let walkerPage: Page | null = null;
  let ownerPin = '';
  let rpcReturnedUuid = '';

  // Observador factual das respostas RPC reais das páginas (HTTP + body).
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
    const raw = session.route_coordinates;
    // route_coordinates is nullable JSONB with no default: a UI-created session
    // legitimately has NULL until the first in_progress GPS trail point is
    // persisted (the backend helper treats NULL as the valid empty route).
    // Only explicit null maps to []; every other non-null format must be a
    // well-formed array or the audit fails closed.
    let routeCoordinates: [number, number][];
    if (raw === null) {
      routeCoordinates = [];
    } else {
      if (!Array.isArray(raw)) {
        throw new Error(`route_coordinates_unexpected_format: ${JSON.stringify(raw)}`);
      }
      routeCoordinates = raw.map((c: unknown) => {
        if (
          !Array.isArray(c) ||
          c.length < 2 ||
          !Number.isFinite(Number(c[0])) ||
          !Number.isFinite(Number(c[1]))
        ) {
          throw new Error(`route_coordinate_invalid: ${JSON.stringify(c)}`);
        }
        return [Number(c[0]), Number(c[1])] as [number, number];
      });
    }
    return {
      trackingCount: rows ? rows.length : 0,
      routeLen: routeCoordinates.length,
      routeCoordinates,
    };
  }

  test('Jornada 4.4: request UI → match → accept → heading → arrived → PIN → in_progress → GPS → return → review → history → freeze', async ({ browser }) => {
    runId = `4.4journey_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    petName = 'PetJourney44';

    try {
      await test.step('setup: usuários E2E (signup_intent), perfis e pet', async () => {
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

      await test.step('login real via /auth (owner + walker)', async () => {
        walkerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: ARRIVE_POS,
        });
        ownerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: { longitude: MEETING.lng, latitude: MEETING.lat },
        });
        walkerPage = await walkerCtx.newPage();
        ownerPage = await ownerCtx.newPage();
        await loginViaUi(ownerPage, ownerEmail);
        await loginViaUi(walkerPage, walkerEmail);

        armRpcObserver(ownerPage, 'create_walk_request');
        armRpcObserver(ownerPage, 'customer_request_return');
        armRpcObserver(ownerPage, 'customer_confirm_arrival');
        armRpcObserver(ownerPage, 'get_active_walker_location');
        armRpcObserver(ownerPage, 'customer_submit_walk_review');
        armRpcObserver(walkerPage, 'accept_walk_request');
        armRpcObserver(walkerPage, 'petwalker_start_heading');
        armRpcObserver(walkerPage, 'petwalker_arrive_pickup');
        armRpcObserver(walkerPage, 'petwalker_confirm_pickup');
        armRpcObserver(walkerPage, 'update_walker_location');
      });

      await test.step('owner: criar pedido pela UI REAL (create_walk_request)', async () => {
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 10000 });
        await expect(ownerPage!.locator('#tour-start-walk')).toBeVisible({ timeout: 10000 });
        await ownerPage!.locator('#tour-start-walk').click();

        // STEP 1 — pet (único pet do dono).
        // FIXTURE determinística: o Owner E2E tem EXATAMENTE um pet e o
        // SearchWalk (fetchPets) AUTO-SELECIONA esse pet único (petData.length
        // === 1 → setSelectedPets([petData[0]])). O clique no card é um
        // TOGGLE — clicá-lo DESELECIONARIA o pet e desabilitaria o botão
        // 'Selecione pelo menos um pet'. Portanto: aguardar o card renderizado,
        // NÃO clicar, e confirmar a seleção automática real do produto.
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

        // STEP 3 — duração determinística (default = 30 min).
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

        // PROVA: create_walk_request disparada pela UI. A RPC RETORNA uuid
        // (NÃO boolean) — exige HTTP 200 + corpo = UUID v4 válido.
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
        rpcReturnedUuid = String(lastRpc('create_walk_request')!.body);
        log(`create_walk_request retornou UUID via UI: ${rpcReturnedUuid}`);

        // Sessão criada pela UI no banco — MESMA para toda a jornada.
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
        // PROVA FORTE: a sessão descoberta no banco É exatamente o UUID
        // retornado pela create_walk_request da UI REAL.
        expect(created.id).toBe(rpcReturnedUuid);
        sessionId = created.id;
        log(`session_id criado pela UI: ${sessionId} (== UUID retornado pela RPC)`);

        // Higiene de cleanup: marcar a sessão como E2E do run (NÃO toca
        // status/home_location — somente permite o failClosedCleanup achar).
        const { error: tagErr } = await admin
          .from('walk_sessions')
          .update({ e2e_test: true, e2e_run_id: runId })
          .eq('id', sessionId);
        if (tagErr) throw new Error(`session_tag_failed: ${JSON.stringify(tagErr)}`);
      });

      await test.step('auditoria: searching + home_location + pet + MESMA sessão', async () => {
        const s = await auditSession(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('searching');
        expect(s.current_status).toBe('searching');
        expect(Number(s.planned_duration_minutes)).toBe(30);
        const hl = s.home_location as { lng?: number; lat?: number } | null;
        expect(hl).not.toBeNull();
        expect(Math.abs(Number(hl!.lng) - MEETING.lng)).toBeLessThan(0.0001);
        expect(Math.abs(Number(hl!.lat) - MEETING.lat)).toBeLessThan(0.0001);
        log(`home_location persistido: ${JSON.stringify(hl)}`);
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
        log('accepted confirmado no banco ANTES do Iniciar deslocamento');
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

        // NENHUM segundo clique de início de deslocamento existe no WalkDetails
        // (a UI já está em heading_to_pickup → somente "Cheguei no Local").
        await expect(
          walkerPage!.getByRole('button', { name: /Iniciar Deslocamento/i })
        ).toHaveCount(0, { timeout: 10000 });
        log('heading_to_pickup confirmado; URL WalkDetails da mesma sessão; sem 2º clique');
      });

      await test.step("heading → arrived via 'Cheguei no Local' (GPS real do browser)", async () => {
        const arriveBtn = walkerPage!.getByRole('button', { name: /Cheguei no Local/i });
        await expect(arriveBtn).toBeVisible({ timeout: 30000 });

        // Prova reload-safe (Patch F): WalkDetails.handleArrive executa
        // window.location.reload() IMEDIATAMENTE após data === true. O reload pode
        // destruir o recurso de rede antes de response.json() (Network.getResponseBody
        // → "No resource with given identifier found"). Portanto NÃO lemos o body aqui.
        // O sucesso é provado por: HTTP 200 (request real) + reload real (o reload só
        // ocorre no branch de sucesso data === true) + DB arrived (abaixo).
        const arriveResponsePromise = walkerPage!.waitForResponse(
          (res) =>
            res.url().includes('/rest/v1/rpc/petwalker_arrive_pickup') &&
            res.request().method() === 'POST',
          { timeout: 20000 }
        );
        // waitForNavigation também ARMADO ANTES do clique: captura o reload do branch
        // de sucesso (data === true) executado pelo WalkDetails.handleArrive.
        const arriveReloadPromise = walkerPage!.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        await arriveBtn.click();

        const arriveResponse = await arriveResponsePromise;
        expect(arriveResponse.status()).toBe(200);
        await arriveReloadPromise;

        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return s.current_status === 'arrived';
            },
            { timeout: 20000, message: 'arrived no banco' }
          )
          .toBeTruthy();

        // home_location permanece a original.
        const s = await auditSession(sessionId);
        const hl = s.home_location as { lng?: number; lat?: number } | null;
        expect(Math.abs(Number(hl?.lng) - MEETING.lng)).toBeLessThan(0.0001);
        expect(Math.abs(Number(hl?.lat) - MEETING.lat)).toBeLessThan(0.0001);
      });

      await test.step('owner: PIN real renderizado na UI (/historico/:id)', async () => {
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

        // Nenhuma sessão nova foi criada por esta navegação.
        const s = await auditSession(sessionId);
        expect(s.current_status).toBe('arrived');
      });

      await test.step('walker: PIN digitado pela UI → in_progress', async () => {
        const pinInput = walkerPage!.getByTestId('pickup-pin-input');
        await expect(pinInput).toBeVisible({ timeout: 20000 });
        // O PIN preenchido vem EXCLUSIVAMENTE da UI do Owner (ownerPin).
        await pinInput.fill(ownerPin);

        const submitBtn = walkerPage!.getByTestId('pickup-pin-submit');
        await expect(submitBtn).toBeEnabled({ timeout: 10000 });

        // Prova reload-safe (Patch F): WalkDetails.handleConfirmPickup executa
        // window.location.reload() IMEDIATAMENTE após data === true — mesmo risco de
        // Network.getResponseBody ("No resource with given identifier found") já
        // eliminado para petwalker_arrive_pickup. NÃO lemos o body após o reload.
        // O sucesso é provado por: HTTP 200 (request real) + reload real (só ocorre
        // no branch de sucesso data === true) + DB in_progress + UI walk-in-progress-marker.
        const confirmPickupResponsePromise = walkerPage!.waitForResponse(
          (res) =>
            res.url().includes('/rest/v1/rpc/petwalker_confirm_pickup') &&
            res.request().method() === 'POST',
          { timeout: 20000 }
        );
        // waitForNavigation também ARMADO ANTES do clique: captura o reload do branch
        // de sucesso (data === true) executado pelo WalkDetails.handleConfirmPickup.
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
              return s.status === 'in_progress' && s.current_status === 'in_progress' && s.walker_id === walkerId;
            },
            { timeout: 20000, message: 'in_progress/in_progress + walker_id (MESMA sessão)' }
          )
          .toBeTruthy();

        await expect(walkerPage!.getByTestId('walk-in-progress-marker')).toBeVisible({ timeout: 15000 });
      });

      await test.step('owner: resume da MESMA sessão → CTA determinístico', async () => {
        await ownerPage!.goto(`/search-walk?resume=${sessionId}`);
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible({ timeout: 20000 });
        expect(ownerPage!.url()).toContain(`resume=${sessionId}`);
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
      });

      await test.step('GPS in_progress: browser → Provider → update_walker_location (LOC_A)', async () => {
        const before = await trackingStats(sessionId);
        const profBefore = await auditWalkerProfile();
        expect(profBefore.current_walk_id).toBe(sessionId);

        // Fecha a janela de throttle certificada (10s provider + margem) DESDE
        // o sample anterior para o ponto em LOC_A cair em janela nova.
        await walkerPage!.waitForTimeout(10500);
        rpcCalls['update_walker_location'] = [];

        await walkerCtx!.setGeolocation(LOC_A);

        await expect
          .poll(
            () => {
              const rpc = lastRpc('update_walker_location');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'update_walker_location HTTP 200 + true (in_progress)' }
          )
          .toBeTruthy();

        await expect
          .poll(
            async () => {
              const st = await trackingStats(sessionId);
              const last = st.routeCoordinates[st.routeCoordinates.length - 1];
              if (!last) return false;
              return (
                Math.abs(last[0] - LOC_A.longitude) < 0.0001 &&
                Math.abs(last[1] - LOC_A.latitude) < 0.0001
              );
            },
            { timeout: 20000, message: 'último ponto da rota == LOC_A' }
          )
          .toBeTruthy();

        const after = await trackingStats(sessionId);
        const profAfter = await auditWalkerProfile();
        expect(after.trackingCount).toBeGreaterThan(before.trackingCount);
        expect(after.routeLen).toBeGreaterThan(before.routeLen);
        expect(profAfter.last_location_captured_at).toBeGreaterThan(
          profBefore.last_location_captured_at ?? 0
        );
        log(`gps in_progress: LOC_A provado; tracking ${before.trackingCount} -> ${after.trackingCount}`);
      });

      await test.step('owner: posição ao vivo (get_active_walker_location + marker)', async () => {
        // PROVA 1 (factual): resposta REAL do polling get_active_walker_location
        // da página do Owner aponta para LOC_A.
        await expect
          .poll(
            () => {
              const rpc = lastRpc('get_active_walker_location');
              if (!rpc || rpc.status !== 200 || !Array.isArray(rpc.body) || rpc.body.length === 0) return false;
              const loc = rpc.body[0] as { lng?: number; lat?: number };
              return (
                typeof loc.lng === 'number' &&
                typeof loc.lat === 'number' &&
                Math.abs(loc.lng - LOC_A.longitude) < 0.001 &&
                Math.abs(loc.lat - LOC_A.latitude) < 0.001
              );
            },
            { timeout: 25000, message: 'get_active_walker_location ≈ LOC_A' }
          )
          .toBeTruthy();

        // PROVA 2 (UI): marker ao vivo renderizado no mapa do Owner.
        await expect(ownerPage!.getByTestId('active-walker-marker')).toHaveCount(1, {
          timeout: 20000,
        });
        log('owner live marker visível (active-walker-marker)');
      });

      await test.step('owner: solicita retorno pela UI (request-return-button)', async () => {
        // MANUTENÇÃO 4.4 — observabilidade robusta do customer_request_return:
        // o observador genérico page.on('response') + res.json() é SENSÍVEL A
        // CORRIDA de leitura de corpo (Network.getResponseBody pode falhar e o
        // catch registra 'NON_JSON' — a ausência de body=true NUNCA deve ser
        // interpretada como "a RPC do produto não aconteceu"). Contrato novo:
        //   1. REAL clique na UI (request-return-button) — inalterado;
        //   2. POST real a /rest/v1/rpc/customer_request_return com HTTP 200
        //      provado deterministicamente (waitForResponse ARMADO ANTES do
        //      clique — sem corrida de parsing);
        //   3. body=true é lido como best-effort (NÃO é o gate único);
        //   4. MUTAÇÃO AUTORITATIVA é o backend: MESMA sessão com
        //      status === 'returning' && current_status === 'returning'.
        await expect(ownerPage!.getByTestId('request-return-button')).toBeVisible();

        const returnResponsePromise = ownerPage!.waitForResponse(
          (res) =>
            res.url().includes('/rest/v1/rpc/customer_request_return') &&
            res.request().method() === 'POST',
          { timeout: 20000 }
        );

        await ownerPage!.getByTestId('request-return-button').click();

        const returnResponse = await returnResponsePromise;
        expect(returnResponse.status()).toBe(200);

        // Best-effort: body=true é retido quando legível de forma robusta,
        // mas nunca é o único gate (a mutação é provada pelo backend abaixo).
        try {
          const body = await returnResponse.json();
          log(`customer_request_return HTTP 200 body=${JSON.stringify(body)}`);
        } catch {
          log('customer_request_return HTTP 200 (corpo indisponível para leitura — mutação provada pelo backend)');
        }

        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return s.current_status === 'returning';
            },
            { timeout: 20000, message: 'returning no banco' }
          )
          .toBeTruthy();
        const s = await auditSession(sessionId);
        expect(s.status).toBe('returning');
        expect(s.current_status).toBe('returning');
        expect(s.id).toBe(sessionId);
        const prof = await auditWalkerProfile();
        expect(prof.current_walk_id).toBe(sessionId);

        await expect(ownerPage!.getByTestId('owner-returning-state')).toBeVisible({ timeout: 15000 });
        await expect(ownerPage!.getByTestId('request-return-button')).toHaveCount(0);
      });

      await test.step('walker: recebe returning SEM reload + sem CTA unilateral', async () => {
        await expect(walkerPage!.getByTestId('walker-returning-state')).toBeVisible({ timeout: 20000 });
        await expect(
          walkerPage!.getByRole('button', { name: /Concluir|Encerrar|Finalizar/i })
        ).toHaveCount(0);
      });

      await test.step('GPS continua durante returning (LOC_B)', async () => {
        const before = await trackingStats(sessionId);
        const profBefore = await auditWalkerProfile();
        expect(profBefore.current_walk_id).toBe(sessionId);

        await walkerPage!.waitForTimeout(10500);
        rpcCalls['update_walker_location'] = [];

        await walkerCtx!.setGeolocation(LOC_B);

        await expect
          .poll(
            () => {
              const rpc = lastRpc('update_walker_location');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'update_walker_location HTTP 200 + true (returning)' }
          )
          .toBeTruthy();

        await expect
          .poll(
            async () => {
              const st = await trackingStats(sessionId);
              const last = st.routeCoordinates[st.routeCoordinates.length - 1];
              if (!last) return false;
              return (
                Math.abs(last[0] - LOC_B.longitude) < 0.0001 &&
                Math.abs(last[1] - LOC_B.latitude) < 0.0001
              );
            },
            { timeout: 20000, message: 'último ponto da rota == LOC_B (mesma sessão)' }
          )
          .toBeTruthy();

        const after = await trackingStats(sessionId);
        const profAfter = await auditWalkerProfile();
        expect(after.trackingCount).toBeGreaterThan(before.trackingCount);
        expect(after.routeLen).toBeGreaterThan(before.routeLen);
        expect(profAfter.last_location_captured_at).toBeGreaterThan(
          profBefore.last_location_captured_at ?? 0
        );
        log(`gps returning: LOC_B provado; tracking ${before.trackingCount} -> ${after.trackingCount}`);
      });

      await test.step('owner: confirma chegada pela UI (confirm-return-arrival-button)', async () => {
        rpcCalls['customer_confirm_arrival'] = [];
        await expect(ownerPage!.getByTestId('confirm-return-arrival-button')).toBeVisible();
        await ownerPage!.getByTestId('confirm-return-arrival-button').click();

        await expect
          .poll(
            () => {
              const rpc = lastRpc('customer_confirm_arrival');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'customer_confirm_arrival HTTP 200 + true' }
          )
          .toBeTruthy();

        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return s.current_status === 'completed';
            },
            { timeout: 20000, message: 'completed no banco' }
          )
          .toBeTruthy();
        const s = await auditSession(sessionId);
        expect(s.status).toBe('completed');
        expect(s.current_status).toBe('completed');
        expect(s.end_time).not.toBeNull();
        expect(Number(s.actual_duration_minutes)).toBeGreaterThanOrEqual(1);
        expect(Number(s.distance_km)).toBeGreaterThanOrEqual(0);
        expect(s.id).toBe(sessionId);
        const prof = await auditWalkerProfile();
        expect(prof.current_walk_id).toBeNull();
      });

      await test.step('walker: sai da sessão ativa automaticamente → /petwalker', async () => {
        await expect(walkerPage!).toHaveURL(/\/petwalker\/?$/, { timeout: 25000 });
        await expect(walkerPage!.getByRole('button', { name: 'Gerenciar Passeio' })).toHaveCount(0, {
          timeout: 15000,
        });
      });

      await test.step('owner: ReviewWalk real (métricas factuais) + avaliação pela UI', async () => {
        await expect(ownerPage!.getByTestId('review-walk-screen')).toBeVisible({ timeout: 20000 });
        expect(ownerPage!.url()).toContain(`resume=${sessionId}`);

        const s = await auditSession(sessionId);
        const actual = Number(s.actual_duration_minutes);
        const distanceDisplay = (Number(s.distance_km) || 0).toFixed(2);
        await expect(ownerPage!.getByTestId('review-duration')).toHaveText(`${actual}`);
        await expect(ownerPage!.getByTestId('review-distance')).toHaveText(distanceDisplay);

        // Avaliação REAL: estrela 5 + comentário determinístico.
        const comment = `Phase 4.4 E2E review ${runId}`;
        await ownerPage!.getByTestId('review-star-5').click();
        await ownerPage!.getByTestId('review-comment').fill(comment);

        // Prova RPC (camada 1): observador limpo ANTES do clique — a UI deve
        // chamar customer_submit_walk_review e receber HTTP 200 + body true.
        rpcCalls['customer_submit_walk_review'] = [];
        await ownerPage!.getByTestId('review-submit').click();
        await expect
          .poll(
            () => {
              const rpc = lastRpc('customer_submit_walk_review');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'customer_submit_walk_review HTTP 200 + true via UI' }
          )
          .toBeTruthy();

        // Persistência factual na MESMA sessão (camada 2, via admin — prova
        // independente da observação RPC; nunca via admin para escrever).
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('rating, feedback')
                .eq('id', sessionId)
                .single();
              return data?.rating === 5 && data?.feedback === comment;
            },
            { timeout: 20000, message: 'rating 5 + feedback exato persistidos' }
          )
          .toBeTruthy();

        // UI sai da tela de avaliação (sucesso → onComplete navega).
        await expect(ownerPage!.getByTestId('review-walk-screen')).toHaveCount(0, {
          timeout: 20000,
        });
        log('avaliação real enviada e persistida');
      });

      await test.step('owner: histórico com a MESMA sessão + pet + rating 5', async () => {
        await ownerPage!.goto('/historico');
        await expect(ownerPage!.getByTestId('owner-history-screen')).toBeVisible({ timeout: 15000 });
        const row = ownerPage!.getByTestId(`owner-history-walk-${sessionId}`);
        await expect(row).toBeVisible({ timeout: 20000 });
        await expect(row.getByText(petName)).toBeVisible();
        await expect(row.getByText('5', { exact: true })).toBeVisible();
        log('owner history: mesma sessão, pet e rating 5 provados');
      });

      await test.step('petwalker: histórico com a MESMA sessão concluída', async () => {
        await walkerPage!.goto('/petwalker/historico');
        await expect(walkerPage!.getByTestId('walker-history-screen')).toBeVisible({ timeout: 15000 });
        const row = walkerPage!.getByTestId(`walker-history-walk-${sessionId}`);
        await expect(row).toBeVisible({ timeout: 20000 });
        await expect(row.getByText('Concluído')).toBeVisible();
        log('walker history: mesma sessão concluída provada');
      });

      await test.step('tracking freeze pós-completion (LOC_D real)', async () => {
        const completed = await trackingStats(sessionId);
        expect(completed.routeCoordinates.length).toBeGreaterThan(0);

        // LOC_D distinto de todos os anteriores. Se o provider ainda gravasse,
        // um GPS novo e distinto produziria ponto novo (deep equality falharia).
        await walkerCtx!.setGeolocation(LOC_D);
        await walkerPage!.waitForTimeout(12000);

        const after = await trackingStats(sessionId);
        expect(after.trackingCount).toBe(completed.trackingCount);
        expect(after.routeCoordinates).toEqual(completed.routeCoordinates);
        const prof = await auditWalkerProfile();
        expect(prof.current_walk_id).toBeNull();
        log(`tracking freeze: tracking ${completed.trackingCount} -> ${after.trackingCount} (inalterado)`);
      });

      await test.step('invariante final: MESMA sessão + nenhuma sessão extra', async () => {
        const { data: ownerSessions, error: oErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('customer_id', ownerId);
        if (oErr) throw new Error(`owner_sessions_failed: ${JSON.stringify(oErr)}`);
        expect(ownerSessions || []).toHaveLength(1);
        expect(ownerSessions![0].id).toBe(sessionId);

        const { data: runSessions, error: rErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('e2e_run_id', runId);
        if (rErr) throw new Error(`run_sessions_failed: ${JSON.stringify(rErr)}`);
        expect(runSessions || []).toHaveLength(1);
        expect(runSessions![0].id).toBe(sessionId);

        const { data: tracking, error: tErr } = await admin
          .from('walker_tracking')
          .select('id')
          .eq('walk_session_id', sessionId);
        if (tErr) throw new Error(`tracking_audit_failed: ${JSON.stringify(tErr)}`);
        expect((tracking || []).length).toBeGreaterThan(0);
        log('FULL_JOURNEY_4.4_COMPLETED');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos', async () => {
        if (walkerCtx) await walkerCtx.close().catch(() => {});
        if (ownerCtx) await ownerCtx.close().catch(() => {});
        // Sessão criada pela UI: remoção direta fail-closed (filhos → sessão),
        // cobrindo inclusive falha antes da tag e2e_run_id.
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