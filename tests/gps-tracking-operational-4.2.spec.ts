import { test, expect } from '@playwright/test';
import { failClosedCleanup } from './helpers/cleanup';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const E2E_RUN_ID = `4.2-op-${Date.now()}`;
const TEST_OWNER = `owner-42-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-42-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

function parseWalkerLocationResponse(body: any) {
  if (!Array.isArray(body) || body.length < 1) throw new Error('Invalid response format: body must be a non-empty array');
  const row = body[0];
  if (typeof row.lat !== 'number' || typeof row.lng !== 'number' || !row.updated_at) {
    throw new Error('Invalid row structure: lat, lng (number) and updated_at (present) required');
  }
  return row;
}

async function waitForOwnerPollingPosition(page: any, target: { latitude: number, longitude: number }, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      
      const response = await page.waitForResponse(
        (r: any) => r.url().includes('/rest/v1/rpc/get_active_walker_location') && r.request().method() === 'POST',
        { timeout: Math.min(remaining, 15000) }
      );
      
      if (response.status() !== 200) {
        throw new Error(`get_active_walker_location returned HTTP ${response.status()}`);
      }
      
      const body = await response.json();
      const row = parseWalkerLocationResponse(body);
      
      if (Math.abs(row.lat - target.latitude) < 0.001 && Math.abs(row.lng - target.longitude) < 0.001) {
        return row;
      }
    } catch (e: any) {
      // Small hardening: capture individual timeout and continue until global deadline
      if (e?.name === 'TimeoutError') {
        continue;
      }
      throw e; // Fail-closed on other errors (HTTP, JSON, body/structure invalid)
    }
  }
  throw new Error(`waitForOwnerPollingPosition: Timed out after ${timeout}ms without receiving position near [${target.latitude}, ${target.longitude}]`);
}

test.describe('Phase 4.2: Operational Browser GPS Tracking', () => {
  test.setTimeout(240000);
  let ownerId: string, walkerId: string, sessionId: string;

  test.afterAll(async () => {
    await failClosedCleanup(admin, [ownerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID);
  });

  test.beforeAll(async () => {
    const oRes = await admin.auth.admin.createUser({ email: TEST_OWNER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: E2E_RUN_ID } });
    expect(oRes.error).toBeNull();
    ownerId = oRes.data.user!.id;

    const wRes = await admin.auth.admin.createUser({ email: TEST_WALKER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID } });
    expect(wRes.error).toBeNull();
    walkerId = wRes.data.user!.id;

    const { error: p1 } = await admin.from('profiles').update({ onboarding_completed: true, e2e_test: true, signup_intent: 'pet_owner', role: 'user' }).eq('id', ownerId);
    expect(p1).toBeNull();
    const { error: p2 } = await admin.from('profiles').update({ onboarding_completed: true, e2e_test: true, signup_intent: 'petwalker', role: 'petwalker' }).eq('id', walkerId);
    expect(p2).toBeNull();

    const { error: deleteRoleErr } = await admin.from('user_roles').delete().in('user_id', [ownerId, walkerId]);
    expect(deleteRoleErr).toBeNull();

    const { error: r1 } = await admin.from('user_roles').insert([
      { user_id: ownerId, role: 'user' },
      { user_id: walkerId, role: 'user' },
      { user_id: walkerId, role: 'petwalker' }
    ]);
    expect(r1).toBeNull();
    
    const { error: wp1 } = await admin.from('petwalker_profiles').upsert({ 
      user_id: walkerId, 
      approval_status: 'approved', 
      profile_completed: true, 
      is_accepting_requests: true, 
      availability_status: 'available', 
      e2e_test: true 
    });
    expect(wp1).toBeNull();

    const { data: pet, error: petErr } = await admin.from('pets').insert({ 
      owner_id: ownerId, 
      name: 'Dog', 
      breed: 'Vira-lata',
      weight: 10,
      e2e_test: true, 
      e2e_run_id: E2E_RUN_ID 
    }).select().single();
    expect(petErr).toBeNull();

    const { data: walk, error: walkErr } = await admin.from('walk_sessions').insert({
      customer_id: ownerId, 
      walker_id: walkerId, 
      pet_id: pet!.id, 
      status: 'in_progress', 
      current_status: 'in_progress', 
      walk_type: 'livre',
      planned_duration_minutes: 30,
      request_mode: 'now',
      home_location: {
        lat: -23.5505,
        lng: -46.6333
      },
      start_time: new Date().toISOString(), 
      pickup_confirmed_at: new Date().toISOString(), 
      route_coordinates: [],
      e2e_test: true, 
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    expect(walkErr).toBeNull();
    sessionId = walk!.id;

    const { error: linkErr } = await admin.from('petwalker_profiles').update({ current_walk_id: sessionId }).eq('user_id', walkerId);
    expect(linkErr).toBeNull();

    // 4. Auditoria Pré-Browser
    const { data: walkAudit, error: walkAuditErr } = await admin.from('walk_sessions').select('*').eq('id', sessionId).single();
    expect(walkAuditErr).toBeNull();
    expect(walkAudit.status).toBe('in_progress');
    expect(walkAudit.current_status).toBe('in_progress');
    expect(walkAudit.walker_id).toBe(walkerId);
    expect(walkAudit.customer_id).toBe(ownerId);

    const { data: profileAudit, error: profileAuditErr } = await admin.from('petwalker_profiles').select('*').eq('user_id', walkerId).single();
    expect(profileAuditErr).toBeNull();
    expect(profileAudit.current_walk_id).toBe(sessionId);
    expect(profileAudit.approval_status).toBe('approved');
  });

  test('GPS Operational Flow', async ({ browser }) => {
    const create = async (email: string, pos: any) => {
      const ctx = await browser.newContext({ geolocation: pos, permissions: ['geolocation'], viewport: { width: 1280, height: 800 } });
      const p = await ctx.newPage();
      await p.goto('/auth'); await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', TEST_PASS);
      await p.click('button[type="submit"]'); await p.waitForURL('**/inicio**'); return { ctx, p };
    };

    const posA = { latitude: -23.5505, longitude: -46.6333 };
    const { ctx: walkerCtx, p: walkerPage } = await create(TEST_WALKER, posA);
    const { ctx: ownerCtx, p: ownerPage } = await create(TEST_OWNER, posA);

    try {
      // 1. Posição A — Baseline Completa
      await walkerPage.goto(`/petwalker/passeio/${sessionId}`);
      await ownerPage.goto(`/search-walk?resume=${sessionId}`);
      const rowA = await waitForOwnerPollingPosition(ownerPage, posA, 60000);
      expect(rowA.lat).toBeCloseTo(posA.latitude, 3);
      expect(rowA.lng).toBeCloseTo(posA.longitude, 3);
      await expect(ownerPage.locator('[data-testid="active-walker-marker"]')).toBeVisible({ timeout: 30000 });

      // Baseline A Auditoria
      const { data: profA, error: ea1 } = await admin.from('petwalker_profiles').select('last_location_captured_at').eq('user_id', walkerId).single();
      expect(ea1).toBeNull();
      const lastCapA = BigInt(profA?.last_location_captured_at || 0);
      expect(lastCapA).toBeGreaterThan(0n);

      const { count: trackingCountA, error: ea2 } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionId).eq('walker_id', walkerId);
      expect(ea2).toBeNull();
      expect(trackingCountA!).toBeGreaterThanOrEqual(1);

      const { data: sessA, error: ea3 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionId).single();
      expect(ea3).toBeNull();
      const routeLengthA = (sessA?.route_coordinates as any[] || []).length;
      expect(routeLengthA).toBeGreaterThanOrEqual(1);

      // Wait for the real 10s PetwalkerGpsProvider throttle window.
      // This is not an arbitrary delay.
      await walkerPage.waitForTimeout(10500);

      // 2. Posição B — Restaurar Matriz Completa
      const posB = { latitude: -23.5500, longitude: -46.6330 };
      await walkerCtx.setGeolocation(posB);
      const rowB = await waitForOwnerPollingPosition(ownerPage, posB, 60000);
      expect(rowB.lat).toBeCloseTo(posB.latitude, 4);
      expect(rowB.lng).toBeCloseTo(posB.longitude, 4);
      
      const { data: profB, error: eb1 } = await admin.from('petwalker_profiles').select('last_location_captured_at').eq('user_id', walkerId).single();
      expect(eb1).toBeNull();
      const lastCapB = BigInt(profB!.last_location_captured_at);
      expect(lastCapB).toBeGreaterThan(lastCapA);

      const { count: trackingCountB, error: eb2 } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionId).eq('walker_id', walkerId);
      expect(eb2).toBeNull();
      expect(trackingCountB!).toBeGreaterThan(trackingCountA!);

      const { data: sessB, error: eb3 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionId).single();
      expect(eb3).toBeNull();
      const routeB = sessB?.route_coordinates as any[][];
      const routeLengthB = routeB.length;
      expect(routeLengthB).toBeGreaterThan(routeLengthA);
      
      const lastPointB = routeB[routeLengthB - 1];
      expect(Array.isArray(lastPointB)).toBe(true);
      expect(lastPointB.length).toBe(2);
      expect(lastPointB[0]).toBeCloseTo(posB.longitude, 4);
      expect(lastPointB[1]).toBeCloseTo(posB.latitude, 4);

      // 3. Refresh — Provar Polling Pós-Reload
      await ownerPage.reload({ waitUntil: 'domcontentloaded' });
      expect(ownerPage.url()).toContain(`/search-walk?resume=${sessionId}`);
      const rowReload = await waitForOwnerPollingPosition(ownerPage, posB, 60000);
      expect(rowReload.lat).toBeCloseTo(posB.latitude, 4);
      expect(rowReload.lng).toBeCloseTo(posB.longitude, 4);
      await expect(ownerPage.locator('[data-testid="active-walker-marker"]')).toBeVisible();

      // Wait for the real 10s PetwalkerGpsProvider throttle window.
      // This is not an arbitrary delay.
      await walkerPage.waitForTimeout(10500);

      // 4. Posição C — Matriz Completa
      const posC = { latitude: -23.5495, longitude: -46.6327 };
      await walkerCtx.setGeolocation(posC);
      const rowC = await waitForOwnerPollingPosition(ownerPage, posC, 60000);
      expect(rowC.lat).toBeCloseTo(posC.latitude, 4);
      expect(rowC.lng).toBeCloseTo(posC.longitude, 4);

      // Auditoria C
      const { data: profC, error: ec1 } = await admin.from('petwalker_profiles').select('last_location_captured_at').eq('user_id', walkerId).single();
      expect(ec1).toBeNull();
      expect(BigInt(profC!.last_location_captured_at)).toBeGreaterThan(lastCapB);

      const { count: trackingCountC, error: ec2 } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionId).eq('walker_id', walkerId);
      expect(ec2).toBeNull();
      expect(trackingCountC!).toBeGreaterThan(trackingCountB!);

      const { data: sessC, error: ec3 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionId).single();
      expect(ec3).toBeNull();
      const routeC = sessC?.route_coordinates as any[][];
      expect(routeC.length).toBeGreaterThan(routeLengthB);
      
      const lastPointC = routeC[routeC.length - 1];
      expect(Array.isArray(lastPointC)).toBe(true);
      expect(lastPointC.length).toBe(2);
      expect(lastPointC[0]).toBeCloseTo(posC.longitude, 4);
      expect(lastPointC[1]).toBeCloseTo(posC.latitude, 4);

    } finally {
      await walkerCtx.close();
      await ownerCtx.close();
    }
  });
});
