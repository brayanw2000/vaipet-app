/**
 * PHASE 4.5A1 — OWNER SEARCHING RELOAD RECOVERY — TEST-ONLY RED PROOF
 *
 * CHARACTERIZATION (Phase 4.5 read-only audit, gap G1):
 * an Owner session in `searching` is NOT automatically restored after
 * reloading /search-walk:
 *   - ActiveWalkBanner only discovers in_progress/returning;
 *   - SearchWalk ?resume=<id> only accepts in_progress/returning/completed;
 *   - handleSearch detects an existing session only AFTER a new user action.
 *
 * This test proves the DESIRED behavior end-to-end and is expected to be RED
 * until a product fix lands:
 *   REAL Owner → REAL UI request → DB searching → reload /search-walk
 *   → ZERO user actions → SAME searching session automatically restored in UI.
 *
 * FAIL-CLOSED rules:
 *   - NO ?resume injected, NO sessionStorage/localStorage written,
 *   - NO second search/confirm/slide click (no handleSearch re-invocation),
 *   - create_walk_request NOT called from test code (observed via UI only),
 *   - DB proofs via admin are factual audits only,
 *   - cleanup fail-closed: any cleanup error FAILS the suite (zero residues).
 *
 * Admin/service_role is used ONLY for: deterministic fixtures, factual audits,
 * e2e metadata tagging and cleanup. NEVER inserts walk_sessions.
 */

import { test, expect, Page } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BrowserContext } from 'playwright-core';
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

// create_walk_request RETORNA uuid (não boolean).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// GPS do Owner browser = ponto de encontro (SearchWalk envia userLocation como
// _meeting_point_lng/_meeting_point_lat).
const MEETING = { lng: -46.7, lat: -23.6 };

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5a-owner-searching-recovery] ${msg}`);

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function loginViaUi(page: Page, email: string) {
  await page.goto('/auth');
  await page.getByPlaceholder('E-mail').fill(email);
  await page.getByPlaceholder('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /^Entrar$/i }).click();
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 45000 });
}

test.describe('Phase 4.5A1: Owner searching reload recovery (red proof)', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 240_000 });

  let runId = '';
  let ownerId = '';
  let petId = '';
  let ownerEmail = '';
  let sessionId = '';
  let ownerCtx: BrowserContext | null = null;
  let ownerPage: Page | null = null;

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

  test('Owner searching: reload /search-walk restaura automaticamente a MESMA sessão sem nenhuma ação', async ({ browser }) => {
    runId = `4.5a1_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      await test.step('setup: Owner E2E determinístico + 1 pet real', async () => {
        const email = `e2e.pet_owner.${runId}.${Math.random().toString(36).slice(2, 6)}@e2e.vaipet.invalid`;
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: {
            full_name: 'E2E pet_owner',
            signup_intent: 'pet_owner',
            e2e_test: true,
            e2e_run_id: runId,
          },
        });
        if (error) throw new Error(`user_creation_failed: ${error.message}`);
        ownerId = data.user!.id;
        ownerEmail = email;

        // FIXTURE (validada no Blocker Patch A1): handle_new_user não copia
        // signup_intent — persistir explicitamente no perfil.
        const { error: profErr } = await admin.from('profiles').upsert({
          id: ownerId,
          full_name: 'E2E pet_owner',
          onboarding_completed: true,
          signup_intent: 'pet_owner',
        });
        if (profErr) throw new Error(`profile_upsert_failed: ${JSON.stringify(profErr)}`);

        // PREFLIGHT fail-closed: profiles.signup_intent === 'pet_owner'.
        const { data: pf, error: pfErr } = await admin
          .from('profiles')
          .select('signup_intent')
          .eq('id', ownerId)
          .single();
        if (pfErr) throw new Error(`profile_preflight_failed: ${JSON.stringify(pfErr)}`);
        if (pf!.signup_intent !== 'pet_owner') {
          throw new Error(`profile_signup_intent_mismatch: ${pf!.signup_intent}`);
        }

        const { data: pet, error: petErr } = await admin
          .from('pets')
          .insert({
            owner_id: ownerId,
            name: 'PetRecovery45A',
            breed: 'SRD',
            is_active: true,
            e2e_test: true,
            e2e_run_id: runId,
          })
          .select('id')
          .single();
        if (petErr) throw new Error(`pet_creation_failed: ${JSON.stringify(petErr)}`);
        petId = pet!.id;
        log(`owner_id: ${ownerId} · pet_id: ${petId}`);
      });

      await test.step('login real via /auth + observers', async () => {
        ownerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: { longitude: MEETING.lng, latitude: MEETING.lat },
        });
        ownerPage = await ownerCtx.newPage();
        await loginViaUi(ownerPage, ownerEmail);
        armRpcObserver(ownerPage, 'create_walk_request');
      });

      await test.step('owner: criar pedido pela UI REAL (create_walk_request)', async () => {
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 10000 });
        await expect(ownerPage!.locator('#tour-start-walk')).toBeVisible({ timeout: 10000 });
        await ownerPage!.locator('#tour-start-walk').click();

        // FIXTURE: exatamente um pet → o produto AUTO-SELECIONA (fetchPets:
        // petData.length === 1 → setSelectedPets). O card é um TOGGLE — não
        // clicar; confirmar a seleção automática real.
        const petCard = ownerPage!.getByTestId('pet-selection-card').first();
        await expect(petCard).toBeVisible({ timeout: 15000 });
        const confirmPet = ownerPage!.getByTestId('confirm-pet-selection');
        await expect(confirmPet).toBeEnabled({ timeout: 15000 });
        await confirmPet.click();

        // Tipo: Livre.
        await expect(ownerPage!.getByLabel('Livre')).toBeVisible({ timeout: 15000 });
        await ownerPage!.getByLabel('Livre').click();
        const confirmType = ownerPage!.getByTestId('confirm-walk-type');
        await expect(confirmType).toBeEnabled({ timeout: 10000 });
        await confirmType.click();

        // Duração determinística (default 30 min).
        const confirmDuration = ownerPage!.getByTestId('confirm-duration');
        await expect(confirmDuration).toBeVisible({ timeout: 10000 });
        await confirmDuration.click();

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

        // PROVA RPC via UI: HTTP 200 + corpo = UUID válido.
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

        // Fato no banco: a linha criada É o UUID retornado pela RPC da UI.
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
        log(`session_id criado pela UI: ${sessionId}`);

        // Tag de cleanup (não toca lifecycle).
        const { error: tagErr } = await admin
          .from('walk_sessions')
          .update({ e2e_test: true, e2e_run_id: runId })
          .eq('id', sessionId);
        if (tagErr) throw new Error(`session_tag_failed: ${JSON.stringify(tagErr)}`);
      });

      await test.step('auditoria: searching + MESMA sessão + exatamente 1 sessão ativa', async () => {
        const s = await auditSession(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('searching');
        expect(s.current_status).toBe('searching');

        const { data: active, error: aErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('customer_id', ownerId)
          .in('current_status', ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning']);
        if (aErr) throw new Error(`active_sessions_audit_failed: ${JSON.stringify(aErr)}`);
        expect(active || []).toHaveLength(1);
        expect(active![0].id).toBe(sessionId);
      });

      await test.step('prova UI pré-reload: apresentação waiting/searching visível', async () => {
        // Landmarks semânticos EXISTENTES do WaitingForAcceptance (sem novos
        // testids): texto 'Aguardando' e botão 'Cancelar' (aria-label).
        await expect(ownerPage!.getByText('Aguardando', { exact: true })).toBeVisible({
          timeout: 15000,
        });
        await expect(ownerPage!.getByRole('button', { name: 'Cancelar' })).toBeVisible();
        // O formulário de requisição NÃO pode estar aberto neste estado.
        await expect(ownerPage!.getByTestId('pet-selection-card')).toHaveCount(0);
        log('UI pré-reload: waiting/searching renderizado com a sessão searching');
      });

      await test.step('AÇÃO DE RESILIÊNCIA: reload da MESMA página /search-walk', async () => {
        rpcCalls['create_walk_request'] = []; // zero chamadas novas permitidas
        await ownerPage!.reload({ waitUntil: 'domcontentloaded' });
        // URL permanece a rota normal — NENHUM ?resume injetado pelo teste.
        await expect(ownerPage!).toHaveURL(/\/search-walk\/?$/, { timeout: 15000 });
        log(`reloaded: ${ownerPage!.url()}`);
      });

      await test.step('RECUPERAÇÃO AUTOMÁTICA esperada (RED até o produto restaurar)', async () => {
        // COMPORTAMENTO DESEJADO: após o reload, com ZERO ações do usuário, a
        // MESMA sessão searching deve restaurar a apresentação
        // waiting/searching. Hoje o produto NÃO restaura automaticamente
        // (Audit G1) — este passo é a prova VERMELHA esperada.
        await expect(ownerPage!.getByText('Aguardando', { exact: true })).toBeVisible({
          timeout: 15000,
        });
        await expect(ownerPage!.getByRole('button', { name: 'Cancelar' })).toBeVisible();

        // Nenhuma chamada nova de create_walk_request pode ocorrer como
        // consequência do reload/recuperação.
        expect(rpcCalls['create_walk_request']).toHaveLength(0);

        // Verdade autoritativa: MESMA sessão, ainda searching, dono intacto.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.current_status).toBe('searching');
        expect(s.status).toBe('searching');

        // Ainda EXATAMENTE 1 sessão ativa do Owner.
        const { data: active, error: aErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('customer_id', ownerId)
          .in('current_status', ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning']);
        if (aErr) throw new Error(`active_sessions_audit_failed: ${JSON.stringify(aErr)}`);
        expect(active || []).toHaveLength(1);
        expect(active![0].id).toBe(sessionId);

        log('RECUPERAÇÃO AUTOMÁTICA CONFIRMADA (verde): mesma sessão searching restaurada sem ação');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos', async () => {
        if (ownerCtx) await ownerCtx.close().catch(() => {});
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
        if (runId && ownerId) {
          await failClosedCleanup(admin, [ownerId], runId);
        }
        log('cleanup concluído — zero resíduos');
      });
    }
  });
});
