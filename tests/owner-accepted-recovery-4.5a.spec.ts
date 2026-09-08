/**
 * PHASE 4.5A2.1 — OWNER ACCEPTED RELOAD / REOPEN RECOVERY — TEST-ONLY RED PROOF
 *
 * Tests the NEXT lifecycle state after the CERTIFIED `searching` recovery
 * (Phase 4.5A1, do NOT reopen): `accepted`.
 *
 * This test determines, with EVIDENCE, what the product restores when an
 * Owner reloads the app while the SAME real walk_session is in:
 *
 *   current_status = 'accepted'
 *
 * REAL JOURNEY (no manufactured state, no ?resume, no browser storage):
 *   Owner  → cria pedido real pela UI (create_walk_request)     → searching
 *   Scheduler → process_walk_matching real                      → offer pending
 *   Walker → aceita a MESMA oferta pela UI (accept_walk_request) → accepted
 *   Owner  → UI mostra o estado accepted ANTES do reload
 *   THEN   → ownerPage.reload() e ZERO ações do usuário após o reload
 *
 * POST-RELOAD (ZERO user actions): o teste apenas OBSERVA o que o produto
 * restaura automaticamente e exige a MESMA sessão accepted de volta na UI.
 * Se a UI accepted NÃO reaparecer sozinha (produto não implementa a
 * recuperação deste estado), é a prova VERMELHA válida — NÃO corrigir aqui.
 *
 * FAIL-CLOSED:
 *   - O teste NÃO injeta ?resume, NÃO usa history.pushState, NÃO usa
 *     setSearchParams, NÃO escreve sessionStorage/localStorage,
 *   - após ownerPage.reload() NÃO há clique, navegação manual, segundo
 *     SlideToConfirm nem handleSearch,
 *   - nenhuma chamada nova de create_walk_request / accept_walk_request,
 *   - DB proofs via admin são auditorias factuais apenas,
 *   - cleanup fail-closed: qualquer erro de cleanup FALHA a suíte (zero
 *     resíduos).
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
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
// matching ST_DWithin e da chegada do petwalker_arrive_pickup (não usado aqui,
// mas mantém o fixture consistente com os testes certificados 4.4).
const WALKER_POS = { lng: -46.7001, lat: -23.6001 };

// Estados ativos (não terminais) do domínio.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5a2-owner-accepted-recovery] ${msg}`);

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

  // PREFLIGHT FACTUAL (fail-closed): provar que profiles.signup_intent === kind
  // foi realmente persistido — sem isto o teste falha cedo, não no aceite.
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

test.describe('Phase 4.5A2.1: Owner accepted reload recovery (red proof)', () => {
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
  let acceptCountBeforeReload = 0;

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

  test('Owner accepted: reload /search-walk NÃO perde a MESMA sessão aceita sem nenhuma ação', async ({ browser }) => {
    runId = `4.5a2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetAccepted45A2';

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
          geolocation: { longitude: WALKER_POS.lng, latitude: WALKER_POS.lat },
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
        armRpcObserver(walkerPage, 'accept_walk_request');
      });

      await test.step('owner: criar pedido pela UI REAL (create_walk_request) → searching', async () => {
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 10000 });
        await expect(ownerPage!.locator('#tour-start-walk')).toBeVisible({ timeout: 10000 });
        await ownerPage!.locator('#tour-start-walk').click();

        const bottomSheet = ownerPage!.locator('h2, div').filter({ hasText: /INICIAR O PASSEIO/i }).first();
        await expect(bottomSheet).toBeVisible({ timeout: 15000 });

        // Selecionar pet (único pet do dono).
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

        // Tipo de passeio: livre.
        const walkTypeBtn = ownerPage!.locator('button').filter({ hasText: /Livre|Coletivo/i }).first();
        await expect(walkTypeBtn).toBeVisible({ timeout: 15000 });
        await walkTypeBtn.click();
        await ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last().click();

        // Duração (default 30 min).
        await expect(ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last()).toBeVisible({
          timeout: 10000,
        });
        await ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last().click();

        // Quote + SlideToConfirm real.
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

        // Sessão criada pela UI REAL no banco.
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

        // Higiene de cleanup: tag e2e (NÃO toca status/lifecycle).
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

      await test.step('matching job: oferta real via process_walk_matching', async () => {
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

        // Scheduler simulado — NÃO insere oferta manualmente.
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

        // Resposta REAL do accept_walk_request: HTTP 200 + body true.
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

      await test.step('PROVA accepted ANTES do reload (backend + UI do Owner)', async () => {
        // Backend: MESMA sessão, status accepted, MESMO Walker.
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
        const s = await auditSession(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.current_status).toBe('accepted');
        expect(s.status).toBe('accepted');
        expect(s.walker_id).toBe(walkerId);

        // UI do Owner: o marcador ESTÁVEL do estado accepted deve estar
        // visível. Marcador escolhido: data-testid="walk-accepted-state"
        // (pill "A caminho" do WalkInProgress em fase pickup). Ele identifica
        // o estado accepted porque só renderiza quando o domínio é rastreável
        // (accepted/heading_to_pickup/...) e a sessão foi promovida para a
        // tela operacional com isComing=true e PIN de retirada ainda não
        // confirmado (phase === 'pickup').
        await expect(ownerPage!.getByTestId('walk-accepted-state')).toBeVisible({ timeout: 45000 });
        await expect(ownerPage!.getByText('A caminho', { exact: false })).toBeVisible({ timeout: 15000 });
        // Nome REAL do Walker hidratado da sessão (get_session_walker_profile).
        await expect(ownerPage!.getByTestId('walk-walker-name')).toBeVisible({ timeout: 15000 });
        log('UI do Owner: walk-accepted-state visível ANTES do reload (accepted representado)');
      });

      await test.step('AÇÃO DE RESILIÊNCIA: reload da MESMA página /search-walk', async () => {
        // Fatos de URL pré-reload: a rota normal pode conter query params
        // legítimos pré-existentes (ex.: ?petId=<uuid> colocado pelo produto
        // ao navegar de /inicio). O teste NÃO injeta ?resume — a regra é que
        // o TESTE não fabrica estado de recuperação.
        const preReloadPath = new URL(ownerPage!.url()).pathname;
        expect(preReloadPath).toBe('/search-walk');
        log(`pré-reload: ${ownerPage!.url()}`);

        // Zerar contadores: nenhuma chamada nova de create_walk_request ou
        // accept_walk_request é permitida como consequência do reload.
        rpcCalls['create_walk_request'] = [];
        acceptCountBeforeReload = (rpcCalls['accept_walk_request'] || []).length;

        await ownerPage!.reload({ waitUntil: 'domcontentloaded' });

        // Apenas o PATHNAME da rota é verificado — o reload preserva query
        // params legítimos (?petId), e o produto pode adicionar/alterar
        // parâmetros na própria recuperação sem quebrar este teste.
        await expect
          .poll(() => new URL(ownerPage!.url()).pathname, {
            timeout: 15000,
            message: 'pathname permanece /search-walk após reload',
          })
          .toBe('/search-walk');
        log(`reloaded: ${ownerPage!.url()}`);
      });

      await test.step('VERDADE PÓS-RELOAD (ZERO ações do usuário): backend íntegro, sem novas chamadas', async () => {
        // Nenhuma chamada nova de create_walk_request pode ocorrer como
        // consequência do reload/recuperação.
        expect(rpcCalls['create_walk_request']).toHaveLength(0);

        // Nenhuma segunda aceitação pode ocorrer após o reload.
        const acceptCountAfterReload = (rpcCalls['accept_walk_request'] || []).length;
        expect(acceptCountAfterReload).toBe(acceptCountBeforeReload);

        // Verdade autoritativa: MESMA sessão, ainda accepted, MESMO Owner,
        // MESMO Walker.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.current_status).toBe('accepted');
        expect(s.status).toBe('accepted');

        // Exatamente UMA sessão ativa (não terminal) do Owner.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);

        // Exatamente UMA sessão ativa do pet envolvido.
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // Exatamente UMA oferta (nenhuma segunda aceitação criou outra).
        const { data: offers, error: offersErr } = await admin
          .from('walk_offers')
          .select('id')
          .eq('session_id', sessionId)
          .eq('walker_id', walkerId);
        if (offersErr) throw new Error(`offers_audit_failed: ${JSON.stringify(offersErr)}`);
        expect(offers || []).toHaveLength(1);
        log('pós-reload: banco íntegro (same session/owner/walker, accepted, 1 sessão ativa por dono e por pet, zero novas RPCs)');
      });

      await test.step('RECUPERAÇÃO AUTOMÁTICA esperada (RED até o produto restaurar accepted)', async () => {
        // COMPORTAMENTO DESEJADO: após o reload, com ZERO ações do usuário, a
        // MESMA sessão accepted deve restaurar automaticamente a UI de
        // passeio (marcador walk-accepted-state). O produto hoje NÃO
        // restaura accepted (a recuperação certificada cobre apenas
        // `searching`; ?resume não aceita accepted) — este passo é a prova
        // VERMELHA esperada. NÃO corrigir o produto nesta tarefa.
        await expect(ownerPage!.getByTestId('walk-accepted-state')).toBeVisible({ timeout: 20000 });
        log('RECUPERAÇÃO AUTOMÁTICA CONFIRMADA (verde): mesma sessão accepted restaurada sem ação');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos', async () => {
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