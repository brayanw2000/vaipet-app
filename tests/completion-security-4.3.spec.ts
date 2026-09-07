import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const E2E_RUN_ID = `4.3-security-${Date.now()}`;

async function getAuthenticatedClient(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: 'VaiPet@2026'
  });
  if (error) {
    console.error(`SignIn failed for ${email}:`, error);
    throw error;
  }
  if (!data.session) throw new Error(`Failed to establish session for ${email}`);
  return client;
}

test.describe('Phase 4.3: Completion Security Hardening (Patch 1C)', () => {
  let ownerId: string;
  let wrongOwnerId: string;
  let walkerId: string;
  let petId: string;
  let ownerEmail: string;
  let wrongOwnerEmail: string;
  let walkerEmail: string;

  test.describe.configure({
    mode: 'serial',
    retries: 0
  });

  test.beforeAll(async () => {
    const create = async (email: string, intent: string) => {
      const res = await admin.auth.admin.createUser({
        email,
        password: 'VaiPet@2026',
        email_confirm: true,
        user_metadata: { signup_intent: intent, e2e_test: true, e2e_run_id: E2E_RUN_ID }
      });
      if (res.error) throw res.error;
      const uid = res.data.user!.id;
      
      const { error: pErr } = await admin.from('profiles').update({
        onboarding_completed: true,
        e2e_test: true,
        signup_intent: intent,
        role: intent === 'petwalker' ? 'petwalker' : 'user'
      }).eq('id', uid);
      if (pErr) throw pErr;

      const { error: delErr } = await admin.from('user_roles').delete().eq('user_id', uid);
      if (delErr) throw delErr;
      
      const { error: rErr } = await admin.from('user_roles').insert([
        { user_id: uid, role: 'user' },
        ...(intent === 'petwalker' ? [{ user_id: uid, role: 'petwalker' }] : [])
      ]);
      if (rErr) throw rErr;

      return uid;
    };

    ownerEmail = `owner-${E2E_RUN_ID}@test.com`;
    wrongOwnerEmail = `wrong-${E2E_RUN_ID}@test.com`;
    walkerEmail = `walker-${E2E_RUN_ID}@test.com`;

    ownerId = await create(ownerEmail, 'pet_owner');
    wrongOwnerId = await create(wrongOwnerEmail, 'pet_owner');
    walkerId = await create(walkerEmail, 'petwalker');

    const { error: wpErr } = await admin.from('petwalker_profiles').upsert({
      user_id: walkerId,
      approval_status: 'approved',
      profile_completed: true,
      availability_status: 'busy',
      e2e_test: true
    });
    if (wpErr) throw wpErr;

    const { data: pet, error: petErr } = await admin.from('pets').insert({
      owner_id: ownerId,
      name: 'E2E Security Pet',
      breed: 'Vira-lata',
      weight: 10,
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    if (petErr) throw petErr;
    petId = pet.id;
  });

  test.afterAll(async () => {
    await failClosedCleanup(admin, [ownerId, wrongOwnerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID);
  });

  async function createSession(status: string) {
    const { data, error } = await admin.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      status: status,
      current_status: status,
      walk_type: 'livre',
      start_time: new Date(Date.now() - 3600000 * 2).toISOString(),
      planned_duration_minutes: 60,
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    if (error) {
      console.error('Error creating session:', error);
      throw error;
    }
    return data;
  }

  // 1. status/current_status divergentes bloqueados
  test('1. status/current_status divergentes bloqueados', async () => {
    const session = await createSession('in_progress');
    const { error } = await admin.from('walk_sessions').update({ 
      current_status: 'returning', 
      status: 'completed' 
    }).eq('id', session.id);
    expect(error).not.toBeNull();
    const { data, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(data.status).toBe('in_progress');
    expect(data.current_status).toBe('in_progress');
  });

  // 2. transição válida ambos -> returning
  test('2. transição válida ambos -> returning', async () => {
    const session = await createSession('in_progress');
    const { error } = await admin.from('walk_sessions').update({
      status: 'returning',
      current_status: 'returning'
    }).eq('id', session.id);
    expect(error).toBeNull();
    const { data, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(data.status).toBe('returning');
    expect(data.current_status).toBe('returning');
  });

  // 3. Owner request_return
  test('3. Owner request_return', async () => {
    const session = await createSession('in_progress');
    const client = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await client.rpc('customer_request_return', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('returning');
    expect(s.current_status).toBe('returning');
  });

  // 4. Wrong Owner request_return
  test('4. Wrong Owner request_return', async () => {
    const session = await createSession('in_progress');
    const client = await getAuthenticatedClient(wrongOwnerEmail);
    const { error } = await client.rpc('customer_request_return', { _session_id: session.id });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('in_progress');
    expect(s.current_status).toBe('in_progress');
  });

  // 5. Walker request_return
  test('5. Walker request_return', async () => {
    const session = await createSession('in_progress');
    const client = await getAuthenticatedClient(walkerEmail);
    const { error } = await client.rpc('customer_request_return', { _session_id: session.id });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('in_progress');
    expect(s.current_status).toBe('in_progress');
  });

  // 6. replay request_return
  test('6. replay request_return', async () => {
    const session = await createSession('in_progress');
    const client = await getAuthenticatedClient(ownerEmail);
    const r1 = await client.rpc('customer_request_return', { _session_id: session.id });
    expect(r1.error).toBeNull();
    expect(r1.data).toBe(true);
    const r2 = await client.rpc('customer_request_return', { _session_id: session.id });
    expect(r2.error).toBeNull();
    expect(r2.data).toBe(false);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('returning');
    expect(s.current_status).toBe('returning');
  });

  // 7. Owner confirm_arrival
  test('7. Owner confirm_arrival', async () => {
    const session = await createSession('returning');
    const client = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status, end_time, actual_duration_minutes, distance_km').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('completed');
    expect(s.current_status).toBe('completed');
    expect(s.end_time).not.toBeNull();
    expect(s.actual_duration_minutes).toBeGreaterThanOrEqual(1);
    expect(s.distance_km).toBeGreaterThanOrEqual(0);
  });

  // 8. confirm before returning
  test('8. confirm before returning', async () => {
    const session = await createSession('in_progress');
    const client = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(false);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('in_progress');
    expect(s.current_status).toBe('in_progress');
  });

  // 9. Wrong Owner confirm
  test('9. Wrong Owner confirm', async () => {
    const session = await createSession('returning');
    const client = await getAuthenticatedClient(wrongOwnerEmail);
    const { error } = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('returning');
    expect(s.current_status).toBe('returning');
  });

  // 10. Walker confirm
  test('10. Walker confirm', async () => {
    const session = await createSession('returning');
    const client = await getAuthenticatedClient(walkerEmail);
    const { error } = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('returning');
    expect(s.current_status).toBe('returning');
  });

  // 11. replay confirm
  test('11. replay confirm', async () => {
    const session = await createSession('returning');
    const client = await getAuthenticatedClient(ownerEmail);
    const r1 = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(r1.error).toBeNull();
    expect(r1.data).toBe(true);
    const r2 = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(r2.error).toBeNull();
    expect(r2.data).toBe(false);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('completed');
    expect(s.current_status).toBe('completed');
  });

  // 12. petwalker_complete_walk authenticated bloqueado
  test('12. petwalker_complete_walk authenticated bloqueado', async () => {
    const session = await createSession('returning');
    const client = await getAuthenticatedClient(walkerEmail);
    const { error } = await client.rpc('petwalker_complete_walk', { _session_id: session.id });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('returning');
    expect(s.current_status).toBe('returning');
  });

  // 13. petwalker_complete_walk anon bloqueado
  test('13. petwalker_complete_walk anon bloqueado', async () => {
    const session = await createSession('returning');
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error } = await anon.rpc('petwalker_complete_walk', { _session_id: session.id });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('returning');
    expect(s.current_status).toBe('returning');
  });

  // 14. service_role in_progress completion bloqueado
  test('14. service_role in_progress completion bloqueado', async () => {
    const session = await createSession('in_progress');
    const { data, error } = await admin.rpc('petwalker_complete_walk', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(false);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('in_progress');
    expect(s.current_status).toBe('in_progress');
  });

  // 15. distance 0 points
  test('15. distance 0 points', async () => {
    const session = await createSession('returning');
    const client = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('distance_km').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.distance_km).toBe(0);
  });

  // 16. distance 1 point
  test('16. distance 1 point', async () => {
    const session = await createSession('returning');
    const { error: iErr } = await admin.from('walker_tracking').insert({
      walk_session_id: session.id,
      walker_id: walkerId,
      location: 'POINT(-46.6333 -23.5505)',
      captured_at: Date.now()
    });
    expect(iErr).toBeNull();
    const client = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('distance_km').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.distance_km).toBe(0);
  });

  // 17. distance 2+ points
  test('17. distance 2+ points', async () => {
    const session = await createSession('returning');
    const points = [
      { walk_session_id: session.id, walker_id: walkerId, location: 'POINT(-46.6333 -23.5505)', captured_at: Date.now() - 10000 },
      { walk_session_id: session.id, walker_id: walkerId, location: 'POINT(-46.6343 -23.5515)', captured_at: Date.now() }
    ];
    for (const p of points) {
      const { error: iErr } = await admin.from('walker_tracking').insert(p);
      expect(iErr).toBeNull();
    }
    const client = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await client.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('distance_km').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.distance_km).toBeGreaterThan(0);
  });

  // 18. real tracking freeze & 19. route freeze
  test('18-19. real tracking freeze & route freeze', async () => {
    const session = await createSession('returning');
    const { error: upErr } = await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);
    expect(upErr).toBeNull();
    
    const { data: profBefore, error: pErrBefore } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(pErrBefore).toBeNull();
    expect(profBefore.current_walk_id).toBe(session.id);
    
    const walkerClient = await getAuthenticatedClient(walkerEmail);
    const capturedAt = Date.now();
    const { data: preLocData, error: locErr } = await walkerClient.rpc('update_walker_location', {
      _lat: -23.5505,
      _lng: -46.6333,
      _accuracy: 10,
      _captured_at: capturedAt
    });
    expect(locErr).toBeNull();
    expect(preLocData).toBe(true);
    
    const { data: sessionBefore, error: sbErr } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session.id).single();
    expect(sbErr).toBeNull();
    expect(Array.isArray(sessionBefore.route_coordinates)).toBe(true);
    expect(sessionBefore.route_coordinates.length).toBeGreaterThan(0);
    
    const trackingBefore = await admin.from('walker_tracking').select('id').eq('walk_session_id', session.id);
    expect(trackingBefore.error).toBeNull();
    expect(trackingBefore.data!.length).toBeGreaterThan(0);
    const trackingBeforeCount = trackingBefore.data!.length;
    const routeBefore = sessionBefore.route_coordinates;
    
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const { data: cData, error: confirmErr } = await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(confirmErr).toBeNull();
    expect(cData).toBe(true);
    
    const { data: sAfter, error: saErr1 } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(saErr1).toBeNull();
    expect(sAfter.status).toBe('completed');
    expect(sAfter.current_status).toBe('completed');
    
    const { data: profAfter, error: paErr } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(paErr).toBeNull();
    expect(profAfter.current_walk_id).toBeNull();
    
    // GPS post completion
    const { data: postData, error: postErr } = await walkerClient.rpc('update_walker_location', {
      _lat: -23.5515,
      _lng: -46.6343,
      _accuracy: 10,
      _captured_at: capturedAt + 10000
    });
    expect(postErr).toBeNull();
    expect(postData).toBe(true);
    
    const { data: sessionAfter, error: saErr2 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session.id).single();
    expect(saErr2).toBeNull();
    const trackingAfter = await admin.from('walker_tracking').select('id').eq('walk_session_id', session.id);
    expect(trackingAfter.error).toBeNull();
    
    expect(trackingAfter.data!.length).toBe(trackingBeforeCount);
    expect(sessionAfter.route_coordinates).toEqual(routeBefore);
  });

  // 20. current_walk_id release
  test('20. current_walk_id release', async () => {
    const session = await createSession('returning');
    const { error: upErr } = await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);
    expect(upErr).toBeNull();
    const { data: profBefore, error: pErr1 } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(pErr1).toBeNull();
    expect(profBefore.current_walk_id).toBe(session.id);
    
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const { data: cData, error: cErr } = await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(cErr).toBeNull();
    expect(cData).toBe(true);
    
    const { data: profAfter, error: pErr2 } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(pErr2).toBeNull();
    expect(profAfter.current_walk_id).toBeNull();
  });

  // 21. dual confirmation concurrency
  test('21. dual confirmation concurrency', async () => {
    const session = await createSession('returning');
    const { error: upErr } = await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);
    expect(upErr).toBeNull();
    const { data: pBefore, error: pErr1 } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(pErr1).toBeNull();
    expect(pBefore.current_walk_id).toBe(session.id);
    
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const [res1, res2] = await Promise.all([
      ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id }),
      ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id })
    ]);
    
    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();
    const results = [res1.data, res2.data];
    expect(results.filter(v => v === true)).toHaveLength(1);
    expect(results.filter(v => v === false)).toHaveLength(1);
    
    const { data: s, error: sErr } = await admin.from('walk_sessions').select('status, current_status, end_time').eq('id', session.id).single();
    expect(sErr).toBeNull();
    expect(s.status).toBe('completed');
    expect(s.current_status).toBe('completed');
    expect(s.end_time).not.toBeNull();
    
    const { data: pAfter, error: pErr2 } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(pErr2).toBeNull();
    expect(pAfter.current_walk_id).toBeNull();
  });
});