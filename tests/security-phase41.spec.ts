import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  throw new Error("Missing critical environment variables: SUPABASE_URL, SERVICE_KEY, or VITE_SUPABASE_PUBLISHABLE_KEY");
}

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

test.describe("Security Phase 4.1: Hardened PIN and Identity Battery", () => {
  
  test("security: ACL - Acesso Anon/Public deve ser negado com 401/403 real", async ({ request }) => {
    const zeroId = "00000000-0000-0000-0000-000000000000";

    const calls = [
      {
        rpc: "customer_get_pickup_code",
        payload: { _session_id: zeroId }
      },
      {
        rpc: "petwalker_confirm_pickup",
        payload: { walk_id: zeroId, input_pin: "000000" }
      },
      {
        rpc: "petwalker_start_heading",
        payload: { _session_id: zeroId }
      },
      {
        rpc: "petwalker_arrive_pickup",
        payload: {
          _session_id: zeroId,
          _lat: -23.5505,
          _lng: -46.6333,
          _accuracy: 10
        }
      },
      {
        rpc: "petwalker_complete_walk",
        payload: { _session_id: zeroId }
      }
    ];

    for (const call of calls) {
      const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${call.rpc}`, {
        data: call.payload,
        headers: { 'apikey': ANON_KEY }
      });
      
      expect([401, 403]).toContain(response.status());
      
      const body = await response.json();
      expect(body.code).toBe("42501");
      expect(body.message).toMatch(/permission denied/i);
    }

    const tableRes = await request.get(`${SUPABASE_URL}/rest/v1/walk_pickup_codes`, {
      headers: { 'apikey': ANON_KEY }
    });
    expect([401, 403]).toContain(tableRes.status());
    const tableBody = await tableRes.json();
    expect(tableBody.code).toBe("42501");
    expect(tableBody.message).toMatch(/permission denied/i);
  });

  test("security: Ataque de Identidade - Owner/Walker isolation e Bloqueios", async () => {
    const runId = `sec_id_${Date.now()}`;
    const password = "Pass123456!";
    
    const create = async (role: string, intent: string) => {
        const email = `e2e.${role}.${runId}@e2e.vaipet.invalid`;
        const { data, error } = await admin.auth.admin.createUser({ 
            email, password, email_confirm: true, 
            user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: intent } 
        });
        if (error) throw new Error(`User creation failed: ${error.message}`);
        
        const uid = data.user!.id;
        const { error: pErr } = await admin.from('profiles').upsert({ id: uid, full_name: `E2E ${role}`, e2e_test: true });
        if (pErr) throw new Error(`Profile creation failed: ${pErr.message}`);

        if (intent === 'petwalker') {
            const { error: pwErr } = await admin.from('petwalker_profiles').upsert({ user_id: uid, approval_status: 'approved', e2e_test: true });
            if (pwErr) throw new Error(`Petwalker profile creation failed: ${pwErr.message}`);
            
            const { error: rErr } = await admin.from('user_roles').upsert({ user_id: uid, role: 'petwalker' });
            if (rErr) throw new Error(`Role assignment failed: ${rErr.message}`);
        }
        return data.user!;
    };

    const owner = await create('owner', 'pet_owner');
    const walker = await create('walker', 'petwalker');
    const attacker = await create('attacker', 'petwalker');

    const attackerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: aLoginErr } = await attackerClient.auth.signInWithPassword({ email: attacker.email!, password });
    if (aLoginErr) throw new Error(`Attacker login failed: ${aLoginErr.message}`);

    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: oLoginErr } = await ownerClient.auth.signInWithPassword({ email: owner.email!, password });
    if (oLoginErr) throw new Error(`Owner login failed: ${oLoginErr.message}`);

    const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: wLoginErr } = await walkerClient.auth.signInWithPassword({ email: walker.email!, password });
    if (wLoginErr) throw new Error(`Walker login failed: ${wLoginErr.message}`);

    try {
      const { data: pet, error: petErr } = await admin.from("pets").insert({ 
          owner_id: owner.id, name: "SecPet", breed: "SRD", e2e_test: true
      }).select().single();
      if (petErr) throw new Error(`Pet insertion failed: ${petErr.message}`);
      
      const oldStartTime = new Date(Date.now() - 3600000).toISOString();
      const { data: session, error: sessErr } = await admin.from("walk_sessions").insert({
        customer_id: owner.id, walker_id: walker.id, pet_id: pet.id, current_status: "accepted", status: "accepted",
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: oldStartTime,
        home_location: { lat: -23.5505, lng: -46.6333 }
      }).select().single();
      if (sessErr) throw new Error(`Session insertion failed: ${sessErr.message}`);

      const { error: attPinErr } = await attackerClient.rpc('customer_get_pickup_code', { _session_id: session.id });
      expect(attPinErr?.message).toMatch(/permission denied|Acesso negado|Could not find the function/i);

      const { data: pin, error: pinErr } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: session.id });
      if (pinErr) throw new Error(`PIN fetch failed: ${pinErr.message}`);
      expect(pin).toMatch(/^\d{6}$/);

      // Transição segura para arrived via RPCs
      const { error: startErr } = await walkerClient.rpc('petwalker_start_heading', { _session_id: session.id });
      if (startErr) throw new Error(`petwalker_start_heading failed: ${startErr.message}`);
      
      const { error: arriveErr } = await walkerClient.rpc('petwalker_arrive_pickup', { 
        _session_id: session.id, 
        _lat: -23.5505, 
        _lng: -46.6333, 
        _accuracy: 10 
      });
      if (arriveErr) throw new Error(`petwalker_arrive_pickup failed: ${arriveErr.message}`);

      // Verificação da consulta de walk_pickup_codes (deve retornar vazio ou erro 42501 por RLS/ACL para authenticated)
      const { data: pickupCodesData, error: pickupCodesError } = await walkerClient.from('walk_pickup_codes').select('*').eq('session_id', session.id);
      
      if (pickupCodesError) {
        // Se houver erro, deve ser de permissão (42501)
        expect(pickupCodesError.code).toBe("42501");
      } else {
        // Se não houver erro, os dados retornados devem ser vazios (RLS bloqueou)
        expect(pickupCodesData?.length).toBe(0);
      }

      const { data: initialPinData, error: pinFetchErr } = await admin.from('walk_pickup_codes').select('attempts').eq('session_id', session.id).single();
      if (pinFetchErr) throw new Error(`Initial PIN code audit failed: ${pinFetchErr.message}`);
      const initialAttempts = initialPinData.attempts;
      
      const { data: initialSess, error: sAuditErr } = await admin.from('walk_sessions').select('status, current_status, walker_id').eq('id', session.id).single();
      if (sAuditErr) throw new Error(`Initial session audit failed: ${sAuditErr.message}`);

      const { error: attackErr } = await attackerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(attackErr?.message).toMatch(/você não é o Walker designado/i);

      const { data: postAttackPin, error: pinAuditErr2 } = await admin.from('walk_pickup_codes').select('attempts').eq('session_id', session.id).single();
      if (pinAuditErr2) throw new Error(`Post-attack PIN audit failed: ${pinAuditErr2.message}`);
      expect(postAttackPin.attempts).toBe(initialAttempts);

      const { data: postAttackSess, error: sAuditErr2 } = await admin.from('walk_sessions').select('status, current_status, walker_id').eq('id', session.id).single();
      if (sAuditErr2) throw new Error(`Post-attack session audit failed: ${sAuditErr2.message}`);
      expect(postAttackSess.status).toBe(initialSess.status);
      expect(postAttackSess.current_status).toBe(initialSess.current_status);
      expect(postAttackSess.walker_id).toBe(initialSess.walker_id);

      const wrongPin = pin === '111111' ? '222222' : '111111';
      for (let i = 1; i <= 5; i++) {
        const { data: failRes, error: failErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: wrongPin });
        expect(failErr).toBeNull();
        expect(failRes).toBe(false);

        const { data: attemptCheck, error: aCheckErr } = await admin.from('walk_pickup_codes').select('attempts').eq('session_id', session.id).single();
        if (aCheckErr) throw new Error(`Attempt check failed at iteration ${i}: ${aCheckErr.message}`);
        expect(attemptCheck.attempts).toBe(i);
      }
      
      const { data: finalRes, error: bruteErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(finalRes).not.toBe(true);
      expect(bruteErr?.message).toMatch(/limite de tentativas excedido|bloqueado/i);

      const { data: finalSess, error: fAuditErr } = await admin.from('walk_sessions').select('status, current_status, pickup_confirmed_at').eq('id', session.id).single();
      if (fAuditErr) throw new Error(`Final session audit failed: ${fAuditErr.message}`);
      expect(finalSess.status).toBe('arrived');
      expect(finalSess.current_status).toBe('arrived');
      expect(finalSess.pickup_confirmed_at).toBeNull();

      const { data: session2, error: sessErr2 } = await admin.from("walk_sessions").insert({
        customer_id: owner.id, walker_id: walker.id, pet_id: pet.id, current_status: "accepted", status: "accepted",
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: oldStartTime,
        home_location: { lat: -23.5505, lng: -46.6333 }
      }).select().single();
      if (sessErr2) throw new Error(`Session 2 insertion failed: ${sessErr2.message}`);

      const { error: start2Error } = await walkerClient.rpc(
        "petwalker_start_heading",
        { _session_id: session2.id }
      );

      if (start2Error) {
        throw new Error(`Session 2 start heading failed: ${start2Error.message}`);
      }

      const { error: arrive2Error } = await walkerClient.rpc(
        "petwalker_arrive_pickup",
        {
          _session_id: session2.id,
          _lat: -23.5505,
          _lng: -46.6333,
          _accuracy: 10
        }
      );

      if (arrive2Error) {
        throw new Error(`Session 2 arrive pickup failed: ${arrive2Error.message}`);
      }

      const { data: pin2, error: pinErr2 } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: session2.id });
      if (pinErr2) throw new Error(`PIN 2 fetch failed: ${pinErr2.message}`);
      
      const { data: ok, error: okErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session2.id, input_pin: pin2 });
      if (okErr) throw new Error(`Correct confirmation failed: ${okErr.message}`);
      expect(ok).toBe(true);

      const { data: confirmedSess, error: cAuditErr } = await admin.from('walk_sessions').select('*').eq('id', session2.id).single();
      if (cAuditErr) throw new Error(`Confirmed session audit failed: ${cAuditErr.message}`);
      expect(confirmedSess.status).toBe('in_progress');
      expect(confirmedSess.current_status).toBe('in_progress');
      expect(confirmedSess.walker_id).toBe(walker.id);
      expect(confirmedSess.pickup_confirmed_at).not.toBeNull();
      expect(confirmedSess.start_time).not.toBe(oldStartTime);

      const { data: pinRecord, error: pinRecordError } = await admin
        .from("walk_pickup_codes")
        .select("*")
        .eq("session_id", session2.id);

      if (pinRecordError) {
        throw new Error(`PIN deletion audit failed: ${pinRecordError.message}`);
      }

      expect(pinRecord).toHaveLength(0);

      const { data: replayData, error: replayError } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session2.id, input_pin: pin2 });
      expect(replayData).not.toBe(true);
      expect(replayError).not.toBeNull();
      
      const { data: finalCheckSess, error: finalCheckError } = await admin.from('walk_sessions').select('status, current_status, walker_id').eq('id', session2.id).single();
      if (finalCheckError) throw new Error(`Final check session audit failed: ${finalCheckError.message}`);
      expect(finalCheckSess?.status).toBe('in_progress');
      expect(finalCheckSess?.current_status).toBe('in_progress');
      expect(finalCheckSess?.walker_id).toBe(walker.id);

    } finally {
      await failClosedCleanup(admin, [owner.id, walker.id, attacker.id], runId);
    }
  });

  test("security: PIN CSPRNG e Expiração", async () => {
    const runId = `sec_exp_${Date.now()}`;
    const password = "Pass123456!";
    const { data: ownerData, error: ownerCreateErr } = await admin.auth.admin.createUser({ 
        email: `e2e.owner.${runId}@e2e.vaipet.invalid`, password, email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: 'pet_owner' } 
    });
    if (ownerCreateErr) throw new Error(`Owner creation failed: ${ownerCreateErr.message}`);
    const uid = ownerData.user!.id;
    
    const { error: pErr } = await admin.from('profiles').upsert({ id: uid, full_name: 'E2E Exp', e2e_test: true });
    if (pErr) throw new Error(`Profile creation failed: ${pErr.message}`);

    const { error: pwErr } = await admin.from('petwalker_profiles').upsert({ user_id: uid, approval_status: 'approved', e2e_test: true });
    if (pwErr) throw new Error(`Petwalker profile creation failed: ${pwErr.message}`);
    
    const { error: rErr } = await admin.from('user_roles').upsert({ user_id: uid, role: 'petwalker' });
    if (rErr) throw new Error(`Role assignment failed: ${rErr.message}`);
    
    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: loginErr } = await ownerClient.auth.signInWithPassword({ email: ownerData.user!.email!, password });
    if (loginErr) throw new Error(`Login failed: ${loginErr.message}`);

    try {
      const { data: pet, error: petErr } = await admin.from("pets").insert({ owner_id: uid, name: "P", breed: "P", e2e_test: true }).select().single();
      if (petErr) throw new Error(`Pet creation failed: ${petErr.message}`);
      
      const { data: session, error: sessErr } = await admin.from("walk_sessions").insert({
        customer_id: uid, walker_id: uid, pet_id: pet.id, current_status: 'accepted', status: 'accepted',
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: new Date().toISOString(),
        home_location: { lat: -23.5505, lng: -46.6333 }
      }).select().single();
      if (sessErr) throw new Error(`Session creation failed: ${sessErr.message}`);

      const walkerClient = ownerClient;
      
      await new Promise(resolve => setTimeout(resolve, 500));

      const { error: startErr } = await walkerClient.rpc('petwalker_start_heading', { _session_id: session.id });
      if (startErr) throw new Error(`Start heading failed: ${startErr.message}`);
      
      const { error: arriveErr } = await walkerClient.rpc('petwalker_arrive_pickup', { 
        _session_id: session.id, 
        _lat: -23.5505, 
        _lng: -46.6333, 
        _accuracy: 10 
      });
      if (arriveErr) throw new Error(`Arrive pickup failed: ${arriveErr.message}`);

      const { data: pin, error: pinFetchErr } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: session.id });
      if (pinFetchErr) throw new Error(`PIN fetch failed: ${pinFetchErr.message}`);
      expect(pin).toMatch(/^\d{6}$/);

      const { error: expUpErr } = await admin.from('walk_pickup_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('session_id', session.id);
      if (expUpErr) throw new Error(`Forcing expiration failed: ${expUpErr.message}`);
      
      const { error: expErr } = await ownerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(expErr?.message).toMatch(/expirado/i);
    } finally {
      await failClosedCleanup(admin, [uid], runId);
    }
  });
});