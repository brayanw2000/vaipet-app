import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

/**
 * PHASE 4.4 — BLOCKER PATCH A — REGRESSION OPERACIONAL DE CHEGADA
 *
 * Objetivo: provar que uma walk_session criada pela UI REAL
 * (create_walk_request) persiste home_location atomicamente — com as MESMAS
 * coordenadas do meeting point (localização do tutor) — e que, com isso, o
 * PetWalker consegue chegar ao ponto de retirada pela UI REAL com GPS do
 * browser até o estado 'arrived'.
 *
 * REGRAS:
 * - NENHUMA transição de lifecycle é chamada diretamente pelo teste:
 *   create_walk_request (via UI), accept_walk_request (via UI),
 *   petwalker_start_heading (via UI), petwalker_arrive_pickup (via UI).
 * - Admin/service_role: setup (usuários E2E, perfis, pet), trigger do job de
 *   matching (process_walk_matching — representa o scheduler), auditoria
 *   factual, tag e2e_run_id/e2e_test pós-criação (higiene de cleanup —
 *   NUNCA toca home_location nem status) e cleanup final.
 * - A oferta NÃO é inserida manualmente: vem do process_walk_matching real
 *   operando sobre a sessão criada pela UI.
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

// GPS do OWNER (browser) = ponto de encontro = home_location esperada na sessão
// (SearchWalk envia userLocation como _meeting_point_lng/_meeting_point_lat).
const MEETING = { lng: -46.7, lat: -23.6 };
// GPS do WALKER (browser) ~14m do ponto de encontro — dentro do raio
// (150m + LEAST(accuracy, 50)) exigido por petwalker_arrive_pickup.
const WALKER_POS = { lng: -46.7001, lat: -23.6001 };

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [arrival-blocker-4.4] ${msg}`);

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
  });
  if (profErr) throw new Error(`profile_upsert_failed: ${JSON.stringify(profErr)}`);

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

test.describe('Phase 4.4 Blocker Patch A: home_location + arrival via real UI', () => {
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

  test('Jornada real: request UI → matching → accept UI → heading UI → arrive UI', async ({ browser }) => {
    runId = `4.4blocker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetBlocker44';

    try {
      await test.step('setup: usuários E2E, perfis e pet', async () => {
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
      });

      await test.step('login real via /auth (owner + walker)', async () => {
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
        armRpcObserver(walkerPage, 'accept_walk_request');
        armRpcObserver(walkerPage, 'petwalker_start_heading');
        armRpcObserver(walkerPage, 'petwalker_arrive_pickup');
      });

      await test.step('owner: criar pedido pela UI REAL (create_walk_request)', async () => {
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

        // Duração (default).
        await expect(ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last()).toBeVisible({
          timeout: 10000,
        });
        await ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last().click();

        // Quote + SlideToConfirm real.
        await expect(ownerPage!.locator('span').filter({ hasText: /R\$/ })).toBeVisible({ timeout: 20000 });
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

        // Higiene de cleanup: marcar a sessão como E2E deste run (NÃO toca
        // status nem home_location — somente permite o failClosedCleanup achar).
        const { error: tagErr } = await admin
          .from('walk_sessions')
          .update({ e2e_test: true, e2e_run_id: runId })
          .eq('id', sessionId);
        if (tagErr) throw new Error(`session_tag_failed: ${JSON.stringify(tagErr)}`);
      });

      await test.step('auditoria: searching + home_location persistido (REGRESSÃO)', async () => {
        const s = await auditSession(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.current_status).toBe('searching');
        // O home_location deve ter sido gravado pela create_walk_request com as
        // coordenadas do meeting point (= GPS do tutor). Antes do Blocker Patch A
        // isto era NULL e petwalker_arrive_pickup falhava com
        // 'Localização de retirada não definida.'.
        const hl = s.home_location as { lng?: number; lat?: number } | null;
        expect(hl).not.toBeNull();
        expect(hl!.lng).toBeDefined();
        expect(hl!.lat).toBeDefined();
        expect(Math.abs(Number(hl!.lng) - MEETING.lng)).toBeLessThan(0.0001);
        expect(Math.abs(Number(hl!.lat) - MEETING.lat)).toBeLessThan(0.0001);
        log(`home_location persistido: ${JSON.stringify(hl)}`);
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
      });

      await test.step('walker: oferta visível + aceite pela UI', async () => {
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

      await test.step("accepted → heading via ActiveWalkSheet (1 clique REAL)", async () => {
        const sheetHeadingBtn = walkerPage!.getByRole('button', { name: /Iniciar deslocamento/i });
        await expect(sheetHeadingBtn).toBeVisible({ timeout: 30000 });
        await sheetHeadingBtn.click();

        // Resposta REAL do petwalker_start_heading: HTTP 200 + body true.
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

        // Navegação canônica para o WalkDetails da MESMA sessão.
        await expect(walkerPage!).toHaveURL(new RegExp(`/petwalker/passeio/${sessionId}`), {
          timeout: 20000,
        });
        log('heading_to_pickup confirmado; URL WalkDetails da mesma sessão');
      });

      await test.step("heading → arrived via 'Cheguei no Local' (GPS real do browser)", async () => {
        // O botão só habilita quando o GPS do browser está resolvido.
        const arriveBtn = walkerPage!.getByRole('button', { name: /Cheguei no Local/i });
        await expect(arriveBtn).toBeVisible({ timeout: 30000 });
        await arriveBtn.click();

        // Resposta REAL do petwalker_arrive_pickup: HTTP 200 + body true.
        await expect
          .poll(
            () => {
              const rpc = lastRpc('petwalker_arrive_pickup');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'petwalker_arrive_pickup HTTP 200 + true' }
          )
          .toBeTruthy();

        await expect
          .poll(
            async () => {
              const s = await auditSession(sessionId);
              return s.current_status === 'arrived';
            },
            { timeout: 20000, message: 'arrived no banco' }
          )
          .toBeTruthy();
      });

      await test.step('auditoria final: arrived + home_location + MESMA sessão', async () => {
        const s = await auditSession(sessionId);
        expect(s.current_status).toBe('arrived');
        expect(s.walker_id).toBe(walkerId);
        expect(s.customer_id).toBe(ownerId);
        const hl = s.home_location as { lng?: number; lat?: number } | null;
        expect(Math.abs(Number(hl?.lng) - MEETING.lng)).toBeLessThan(0.0001);
        expect(Math.abs(Number(hl?.lat) - MEETING.lat)).toBeLessThan(0.0001);
        // Invariante: nenhuma sessão extra deste run foi criada.
        const { data: extras, error: extraErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('customer_id', ownerId);
        if (extraErr) throw new Error(`extra_sessions_failed: ${JSON.stringify(extraErr)}`);
        expect(extras || []).toHaveLength(1);
        expect(extras![0].id).toBe(sessionId);
        log('ARRIVAL_BLOCKER_4.4_COMPLETED');
      });
    } finally {
      await test.step('cleanup', async () => {
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