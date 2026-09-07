import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  throw new Error("Missing environment variables");
}

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

test.describe("Phase 4.2 Patch 1F: GPS Tracking Final Validation & Completeness", () => {
  
  test("Security & Role Isolation Matriz", async () => {
    const runId = `gps_sec_${Date.now()}`;
    const password = "Pass123456!";
    
    const emailW1 = `walker1.${runId}@e2e.vaipet.invalid`;
    const emailW2 = `walker2.${runId}@e2e.vaipet.invalid`;
    const emailNoRole = `norole.${runId}@e2e.vaipet.invalid`;
    const emailOwner = `owner.${runId}@e2e.vaipet.invalid`;

    const { data: uW1 } = await admin.auth.admin.createUser({ email: emailW1, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidW1 = uW1.user!.id;
    await admin.from('profiles').upsert({ id: uidW1, full_name: 'Walker 1', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW1, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW1, role: 'petwalker' });

    const { data: uW2 } = await admin.auth.admin.createUser({ email: emailW2, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidW2 = uW2.user!.id;
    await admin.from('profiles').upsert({ id: uidW2, full_name: 'Walker 2', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW2, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW2, role: 'petwalker' });

    const { data: uNR } = await admin.auth.admin.createUser({ email: emailNoRole, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidNR = uNR.user!.id;
    await admin.from('profiles').upsert({ id: uidNR, full_name: 'No Role', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidNR, approval_status: 'approved', e2e_test: true });

    const { data: uO } = await admin.auth.admin.createUser({ email: emailOwner, password, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: runId } });
    const uidO = uO.user!.id;

    const clientW1 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientW1.auth.signInWithPassword({ email: emailW1, password });

    const clientW2 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientW2.auth.signInWithPassword({ email: emailW2, password });

    const clientNR = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientNR.auth.signInWithPassword({ email: emailNoRole, password });

    const clientOwner = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientOwner.auth.signInWithPassword({ email: emailOwner, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ owner_id: uidO, name: "P", breed: "P", e2e_test: true }).select().single();
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: uidO, walker_id: uidW1, pet_id: pet!.id, current_status: 'in_progress',
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: new Date().toISOString(), status: 'in_progress', home_location: { lat: 0, lng: 0 }, route_coordinates: []
      }).select().single();

      await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW1);

      // A) ROLE: update_walker_location without petwalker role -> 42501
      const { error: errNR } = await clientNR.rpc('update_walker_location', { _lat: 1, _lng: 1, _accuracy: 10, _captured_at: Date.now() });
      expect(errNR?.code).toBe('42501');

      // B) HELPER DIRETO: designated walker blocked from direct append_walk_tracking_point (42501)
      const { error: errDir } = await clientW1.rpc('append_walk_tracking_point', { _session_id: session!.id, _lng: 1, _lat: 1 });
      expect(errDir?.code).toBe('42501');

      // C) OWNER BLOCKED from update_walker_location (42501)
      const { error: errOwner } = await clientOwner.rpc('update_walker_location', { _lat: 1, _lng: 1, _accuracy: 10, _captured_at: Date.now() });
      expect(errOwner?.code).toBe('42501');

      // D) WALKER ADVERSARIAL REAL: Walker 2 simulated takeover attempt
      await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW2);
      await clientW2.rpc('update_walker_location', { _lat: 55, _lng: 55, _accuracy: 10, _captured_at: Date.now() });
      
      const { data: wCheck } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(wCheck?.route_coordinates).not.toContainEqual([55, 55]);
      
      const { count: trackingCount } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session!.id).eq('walker_id', uidW2);
      expect(trackingCount || 0).toBe(0);

    } finally {
      await failClosedCleanup(admin, [uidW1, uidW2, uidNR, uidO], runId);
    }
  });

  test("Logic: Matrix A-I Hardening Validation", async () => {
    const runId = `gps_logic_${Date.now()}`;
    const password = "Pass123456!";
    const emailW = `walker.${runId}@e2e.vaipet.invalid`;
    const emailO = `owner.${runId}@e2e.vaipet.invalid`;

    const { data: uW } = await admin.auth.admin.createUser({ email: emailW, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidW = uW.user!.id;
    await admin.from('profiles').upsert({ id: uidW, full_name: 'W', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW, role: 'petwalker' });

    const { data: uO } = await admin.auth.admin.createUser({ email: emailO, password, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: runId } });
    const uidO = uO.user!.id;

    const walker = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await walker.auth.signInWithPassword({ email: emailW, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ owner_id: uidO, name: "P", breed: "P", e2e_test: true }).select().single();

      const createSession = async (status: 'in_progress' | 'completed' | 'cancelled') => {
        const { data: session, error: sErr } = await admin.from("walk_sessions").insert({
          customer_id: uidO, walker_id: uidW, pet_id: pet!.id, current_status: status,
          walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
          start_time: new Date().toISOString(), status: status, home_location: { lat: 0, lng: 0 }, route_coordinates: []
        }).select().single();
        expect(sErr).toBeNull();
        
        // Se for in_progress, vincula ao walker
        if (status === 'in_progress') {
          const { error: pErr } = await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW);
          expect(pErr).toBeNull();
        }
        return session!;
      };

      // A-C: MONOTONICIDADE, NULLS, ACCURACY (Usa sessão ATIVA 1)
      const sessionActive = await createSession('in_progress');
      const t1 = Date.now();

      // A) NULL INPUTS
      const { data: profBeforeNull } = await admin.from('petwalker_profiles').select('last_location_captured_at, last_known_location').eq('user_id', uidW).single();
      const { count: countBeforeNull } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionActive.id);

      const { error: errLat } = await walker.rpc('update_walker_location', { _lat: null, _lng: 20, _accuracy: 10, _captured_at: t1 });
      expect(errLat?.code).toBe('22000');
      const { error: errLng } = await walker.rpc('update_walker_location', { _lat: 10, _lng: null, _accuracy: 10, _captured_at: t1 });
      expect(errLng?.code).toBe('22000');
      const { error: errCap } = await walker.rpc('update_walker_location', { _lat: 10, _lng: 20, _accuracy: 10, _captured_at: null });
      expect(errCap?.code).toBe('22000');

      const { data: profAfterNull } = await admin.from('petwalker_profiles').select('last_location_captured_at, last_known_location').eq('user_id', uidW).single();
      const { count: countAfterNull } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionActive.id);
      expect(profAfterNull).toEqual(profBeforeNull);
      expect(countAfterNull).toBe(countBeforeNull);

      // B) ACCURACY
      const { error: errAccNeg } = await walker.rpc('update_walker_location', { _lat: 10, _lng: 20, _accuracy: -1, _captured_at: t1 });
      expect(errAccNeg?.code).toBe('22000');
      const { error: errAccHigh } = await walker.rpc('update_walker_location', { _lat: 10, _lng: 20, _accuracy: 10001, _captured_at: t1 });
      expect(errAccHigh?.code).toBe('22000');
      
      const { data: resAccNull } = await walker.rpc('update_walker_location', { _lat: 10, _lng: 20, _accuracy: null, _captured_at: t1 });
      expect(resAccNull).toBe(true);

      // C) MONOTONICIDADE
      const { data: profMonoBefore } = await admin.from('petwalker_profiles').select('last_location_captured_at, last_known_location').eq('user_id', uidW).single();
      const { data: resMono } = await walker.rpc('update_walker_location', { _lat: 12, _lng: 22, _accuracy: 10, _captured_at: t1 - 100 });
      expect(resMono).toBe(false);
      const { data: profMonoAfter } = await admin.from('petwalker_profiles').select('last_location_captured_at, last_known_location').eq('user_id', uidW).single();
      expect(profMonoAfter?.last_location_captured_at).toBe(profMonoBefore?.last_location_captured_at);

      // D) COMPLETED (Sessão DEDICADA)
      const sessionCompleted = await createSession('completed');
      // Garantir vínculo stale se necessário
      await admin.from('petwalker_profiles').update({ current_walk_id: sessionCompleted.id }).eq('user_id', uidW);
      
      const { data: routeBeforeCompleted } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionCompleted.id).single();
      const { count: countBeforeCompleted } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionCompleted.id);
      
      await walker.rpc('update_walker_location', { _lat: 16, _lng: 26, _accuracy: 10, _captured_at: t1 + 30000 });
      
      const { data: routeAfterCompleted } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionCompleted.id).single();
      const { count: countAfterCompleted } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionCompleted.id);
      
      expect(routeAfterCompleted?.route_coordinates).toEqual(routeBeforeCompleted?.route_coordinates);
      expect(countAfterCompleted).toBe(countBeforeCompleted);

      // E) CANCELLED (Sessão DEDICADA)
      const sessionCancelled = await createSession('cancelled');
      await admin.from('petwalker_profiles').update({ current_walk_id: sessionCancelled.id }).eq('user_id', uidW);
      
      const { data: routeBeforeCanc } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionCancelled.id).single();
      const { count: countBeforeCanc } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionCancelled.id);
      
      await walker.rpc('update_walker_location', { _lat: 17, _lng: 27, _accuracy: 10, _captured_at: t1 + 40000 });
      
      const { data: routeAfterCanc } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionCancelled.id).single();
      const { count: countAfterCanc } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionCancelled.id);
      
      expect(routeAfterCanc?.route_coordinates).toEqual(routeBeforeCanc?.route_coordinates);
      expect(countAfterCanc).toBe(countBeforeCanc);

      // F) LIMITE DE 5000 (Sessão ATIVA 2)
      const sessionLimit = await createSession('in_progress');
      const mockCoords = Array.from({ length: 5000 }, () => [0, 0]);
      const { error: errSetupLimit } = await admin.from('walk_sessions').update({ 
        route_coordinates: mockCoords,
        last_tracking_at: new Date(Date.now() - 10000).toISOString()
      }).eq('id', sessionLimit.id);
      expect(errSetupLimit).toBeNull();
      
      const { count: countBeforeLimit } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionLimit.id);
      
      const { error: errLimit } = await walker.rpc('update_walker_location', { _lat: 1, _lng: 1, _accuracy: 10, _captured_at: t1 + 50000 });
      expect(errLimit?.message).toMatch(/Max tracking points/);
      
      const { data: wLimit } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionLimit.id).single();
      const { count: countAfterLimit } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionLimit.id);
      
      expect(wLimit?.route_coordinates).toHaveLength(5000);
      expect(wLimit?.route_coordinates).toEqual(mockCoords);
      expect(countAfterLimit).toBe(countBeforeLimit);

      // G) FORMATO INVÁLIDO (Sessão ATIVA 3)
      const sessionInvalid = await createSession('in_progress');
      const invalidFormat = { not: "an_array" };
      const { error: errSetupInv } = await admin.from('walk_sessions').update({ 
        route_coordinates: invalidFormat,
        last_tracking_at: new Date(Date.now() - 10000).toISOString()
      }).eq('id', sessionInvalid.id);
      expect(errSetupInv).toBeNull();
      
      const { count: countBeforeInv } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionInvalid.id);
      
      const { error: errInv } = await walker.rpc('update_walker_location', { _lat: 1, _lng: 1, _accuracy: 10, _captured_at: t1 + 60000 });
      expect(errInv?.message).toMatch(/Invalid route_coordinates format/);
      
      const { data: wInv } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionInvalid.id).single();
      const { count: countAfterInv } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionInvalid.id);
      
      expect(wInv?.route_coordinates).toEqual(invalidFormat);
      expect(countAfterInv).toBe(countBeforeInv);

    } finally {
      await failClosedCleanup(admin, [uidW, uidO], runId);
    }
  });
});
