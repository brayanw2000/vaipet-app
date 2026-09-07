import { test, expect, BrowserContext, Page } from '@playwright/test';
import { failClosedCleanup } from './helpers/cleanup';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);


const E2E_RUN_ID = `4.1-op-${Date.now()}`;

const TEST_OWNER = `owner-op-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-op-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

test.describe('Phase 4.1: Operational Flow (Displacement & PIN)', () => {
  test.setTimeout(180000);
  let ownerId: string;
  let walkerId: string;
  let sessionId: string;
  let petId: string;

  test.afterAll(async () => {
    await failClosedCleanup(supabase, [ownerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID);
  });

  test.beforeAll(async () => {
    // 1. Criar Usuários E2E
    const ownerRes = await supabase.auth.admin.createUser({
      email: TEST_OWNER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: E2E_RUN_ID }
    });
    if (ownerRes.error) throw new Error(`Owner creation failed: ${ownerRes.error.message}`);
    ownerId = ownerRes.data.user!.id;

    const walkerRes = await supabase.auth.admin.createUser({
      email: TEST_WALKER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID }
    });
    if (walkerRes.error) throw new Error(`Walker creation failed: ${walkerRes.error.message}`);
    walkerId = walkerRes.data.user!.id;

    // 2. Provisionar Perfis
    const { error: profErr } = await supabase.from('profiles').update({
      onboarding_completed: true,
      e2e_test: true,
      signup_intent: 'pet_owner',
      role: 'user'
    }).eq('id', ownerId);
    if (profErr) throw profErr;

    const { error: profWalkerErr } = await supabase.from('profiles').update({
      onboarding_completed: true,
      e2e_test: true,
      signup_intent: 'petwalker',
      role: 'petwalker'
    }).eq('id', walkerId);
    if (profWalkerErr) throw profWalkerErr;

    const { error: deleteRoleErr } = await supabase.from('user_roles').delete().in('user_id', [ownerId, walkerId]);
    if (deleteRoleErr) throw new Error(`Role deletion failed: ${deleteRoleErr.message}`);

    const { error: roleErr } = await supabase.from('user_roles').insert([
      { user_id: ownerId, role: 'user' },
      { user_id: walkerId, role: 'user' },
      { user_id: walkerId, role: 'petwalker' }
    ]);
    if (roleErr) throw new Error(`Role insertion failed: ${roleErr.message}`);

    const { error: walkerProfErr } = await supabase.from('petwalker_profiles').upsert({
      user_id: walkerId,
      approval_status: 'approved',
      profile_completed: true,
      is_accepting_requests: true,
      availability_status: 'available',
      public_bio: 'Bio operacional para teste 4.1',
      service_radius_km: 5,
      experience_years: 5,
      price_30_minutes: 3000,
      e2e_test: true
    });
    if (walkerProfErr) throw walkerProfErr;

    const { data: pet, error: petErr } = await supabase.from('pets').insert({
      owner_id: ownerId,
      name: `E2E Rex ${E2E_RUN_ID}`,
      breed: 'Vira-lata',
      weight: 10,
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    if (petErr) throw petErr;
    petId = pet!.id;

    // 3. Criar Sessão em status 'accepted' sem timestamps de início
    // Nota: start_time é NOT NULL no schema atual, usamos Epoch (1970) para "vazio" conceitual
    const epoch = new Date(0).toISOString();
    const { data: walk, error: walkErr } = await supabase.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      current_status: 'accepted',
      status: 'accepted',
      planned_duration_minutes: 30,
      total_price_cents: 4500,
      meeting_point_address: 'Rua E2E, 123',
      home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'livre',
      request_mode: 'now',
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID,
      start_time: epoch,
      pickup_confirmed_at: null
    }).select().single();
    
    if (walkErr) throw walkErr;
    sessionId = walk!.id;

    // Auditoria read-only pós-criação
    const { data: audit0, error: err0 } = await supabase.from('walk_sessions')
      .select('status, current_status, start_time, pickup_confirmed_at, walker_id')
      .eq('id', sessionId)
      .single();
    
    if (err0 || audit0?.status !== 'accepted' || audit0?.current_status !== 'accepted' || 
        new Date(audit0?.start_time || '').getTime() !== 0 || audit0?.pickup_confirmed_at !== null || audit0?.walker_id !== walkerId) {
      throw new Error(`Audit creation failed: ${JSON.stringify(audit0)}. Error: ${err0?.message}`);
    }
  });

  test('Operational displacement and PIN confirmation', async ({ browser }) => {
    const login = async (email: string, pass: string, target: string): Promise<{ context: BrowserContext, page: Page }> => {
      const context = await browser.newContext({
        geolocation: { latitude: -23.5505, longitude: -46.6333 },
        permissions: ['geolocation']
      });
      const page = await context.newPage();
      await page.goto('/auth');
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', pass);
      await page.click('button[type="submit"]');
      await page.waitForURL('**/inicio**', { timeout: 15000 }).catch(() => {});
      await page.goto(target);
      return { context, page };

    };

    const [walkerCtx, ownerCtx] = await Promise.all([
      login(TEST_WALKER, TEST_PASS, '/petwalker'),
      login(TEST_OWNER, TEST_PASS, '/inicio')
    ]);

    const walkerPage = walkerCtx.page;
    const ownerPage = ownerCtx.page;

    // --- WALKER: Iniciar Deslocamento ---
    await walkerPage.goto(`/petwalker/passeio/${sessionId}`);
    
    const headingBtn = walkerPage.getByRole('button', { name: /Iniciar Deslocamento/i });
    await expect(headingBtn).toBeVisible({ timeout: 45000 });
    
    // Iniciar deslocamento
    await headingBtn.click();

    // Aguardar transição visual para o próximo botão ('Cheguei no Local')
    const arriveBtn = walkerPage.getByRole('button', { name: /Cheguei no Local/i });
    await expect(arriveBtn).toBeVisible({ timeout: 20000 });

    // Auditoria Banco: current_status = 'heading_to_pickup'
    const { data: audit1, error: err1 } = await supabase.from('walk_sessions').select('current_status').eq('id', sessionId).single();
    if (err1 || audit1?.current_status !== 'heading_to_pickup') {
      throw new Error(`Audit failed: expected heading_to_pickup, got ${audit1?.current_status}. Error: ${err1?.message}`);
    }

    // --- WALKER: Cheguei no Local ---
    await arriveBtn.click();

    // Aguardar transição visual indicando que o PIN agora é necessário
    await expect(walkerPage.locator('[data-testid="pickup-pin-input"]')).toBeVisible({ timeout: 20000 });


    // Auditoria Banco: current_status = 'arrived'
    const { data: audit2, error: err2 } = await supabase.from('walk_sessions').select('current_status').eq('id', sessionId).single();
    if (err2 || audit2?.current_status !== 'arrived') {
      throw new Error(`Audit failed: expected arrived, got ${audit2?.current_status}. Error: ${err2?.message}`);
    }


    // --- OWNER: Obter PIN VISUALMENTE ---
    await ownerPage.goto(`/historico/${sessionId}`);
    const pinDisplay = ownerPage.locator('[data-testid="pickup-pin-display"]');
    await expect(pinDisplay).toBeVisible({ timeout: 30000 });
    
    await expect(async () => {
      const text = await pinDisplay.textContent();
      expect(text?.trim()).toMatch(/^[0-9]{6}$/);
    }).toPass({ timeout: 15000 });
    
    const pin = (await pinDisplay.textContent())?.replace(/\s/g, '').trim();
    if (!pin) throw new Error("PIN not found in UI");

    // --- WALKER: Digitar PIN ---
    const pinInput = walkerPage.locator('[data-testid="pickup-pin-input"]');
    await expect(pinInput).toBeVisible({ timeout: 20000 });
    await pinInput.fill(pin);
    
    const submitBtn = walkerPage.locator('[data-testid="pickup-pin-submit"]');
    await submitBtn.click();

    // --- VERIFICAÇÃO FINAL: in_progress ---
    await expect(walkerPage.locator('[data-testid="walk-in-progress-marker"]')).toBeVisible({ timeout: 20000 });
    
    const { data: finalWalk, error: finalErr } = await supabase.from('walk_sessions')
      .select('status, current_status, pickup_confirmed_at, start_time, walker_id')
      .eq('id', sessionId)
      .single();
    
    if (finalErr) throw new Error(`Final audit query failed: ${finalErr.message}`);
    
    expect(finalWalk?.status).toBe('in_progress');
    expect(finalWalk?.current_status).toBe('in_progress');
    expect(finalWalk?.pickup_confirmed_at).not.toBeNull();
    expect(finalWalk?.start_time).not.toBeNull();
    expect(new Date(finalWalk!.start_time).getTime()).not.toBe(0);
    expect(finalWalk?.walker_id).toBe(walkerId);

    // Verificar que walk_pickup_codes não possui mais registro
    const { data: pinRecord, error: pinAuditErr } = await supabase.from('walk_pickup_codes').select('session_id').eq('session_id', sessionId).maybeSingle();
    if (pinAuditErr) throw new Error(`PIN cleanup audit failed: ${pinAuditErr.message}`);
    expect(pinRecord).toBeNull();

    // --- TESTE DE REPLAY ---
    await walkerPage.goto(`/petwalker/passeio/${sessionId}`);
    await expect(walkerPage.locator('[data-testid="pickup-pin-input"]')).not.toBeVisible();
    await expect(walkerPage.locator('[data-testid="walk-in-progress-marker"]')).toBeVisible();

    // Tentar confirmar PIN novamente (Replay)
    const walkerAuthClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );

    const { data: replayLoginData, error: replayLoginErr } = await walkerAuthClient.auth.signInWithPassword({
      email: TEST_WALKER,
      password: TEST_PASS
    });

    if (replayLoginErr) {
      throw new Error(`Replay walker login failed: ${replayLoginErr.message}`);
    }
    if (!replayLoginData.session) {
      throw new Error('Replay walker login returned no session');
    }
    
    const { data: replayData, error: replayErr } = await walkerAuthClient.rpc(
      'petwalker_confirm_pickup',
      { 
        walk_id: sessionId,
        input_pin: pin
      }
    );

    // Replay deve falhar (PIN consumido)
    expect(replayData).not.toBe(true);
    expect(replayErr).not.toBeNull();

    const { data: auditPostReplay, error: auditPostReplayErr } = await supabase.from('walk_sessions')
        .select('status, current_status, walker_id')
        .eq('id', sessionId)
        .single();
    
    if (auditPostReplayErr) {
      throw new Error(`Audit post-replay failed: ${auditPostReplayErr.message}`);
    }
    
    expect(auditPostReplay?.status).toBe('in_progress');
    expect(auditPostReplay?.current_status).toBe('in_progress');
    expect(auditPostReplay?.walker_id).toBe(walkerId);

    const { data: pins, error: finalPinErr } = await supabase.from('walk_pickup_codes').select('session_id').eq('session_id', sessionId);
    if (finalPinErr) {
      throw new Error(`Final PIN audit failed: ${finalPinErr.message}`);
    }
    expect(pins).toHaveLength(0);




    await walkerCtx.context.close();
    await ownerCtx.context.close();
  });
});
