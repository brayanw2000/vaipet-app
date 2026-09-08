/**
 * PHASE 4.4 — PATCH I — REVIEW SECURITY TEST
 *
 * Proves the purpose-built customer_submit_walk_review RPC is the ONLY safe
 * persistence path for reviews, and that direct client UPDATE of walk_sessions
 * remains blocked by RLS (no broad UPDATE policy was created).
 *
 * Coverage:
 *   A. real Owner of a completed session → RPC true + rating/feedback persisted
 *   B. unrelated authenticated Owner     → rejected, no mutation
 *   C. assigned PetWalker                → rejected, no mutation
 *   D. Owner on a non-completed session  → rejected, no mutation
 *   E. rating 0                          → rejected
 *   F. rating 6                          → rejected
 *   G. oversized feedback (>2000 chars)  → rejected
 *   H. direct client UPDATE of walk_sessions blocked by RLS
 *   I. failed attempts mutate NOTHING (rating/feedback/status/ownership)
 *   J. idempotent retry (same rating+feedback) → true, no duplicate change
 *   K. different second review → rejected (immutable review)
 *
 * Admin/service_role is used ONLY for deterministic setup, factual audits and
 * fail-closed cleanup — never to fake a lifecycle transition or the review.
 */

import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function getAuthenticatedClient(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`signin_failed: ${JSON.stringify(error)}`);
  return client;
}

test.describe('Phase 4.4: Review Security (Patch I)', () => {
  let runId = '';
  let ownerId = '';
  let intruderId = '';
  let walkerId = '';
  let petId = '';
  let ownerEmail = '';
  let intruderEmail = '';
  let walkerEmail = '';

  test.describe.configure({ mode: 'serial', retries: 0, timeout: 120_000 });

  test.beforeAll(async () => {
    runId = `4.4review_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const createUser = async (kind: 'pet_owner' | 'petwalker') => {
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
        signup_intent: kind,
      });
      if (profErr) throw new Error(`profile_upsert_failed: ${JSON.stringify(profErr)}`);
      if (kind === 'petwalker') {
        const { error: roleErr } = await admin.from('user_roles').insert({ user_id: id, role: 'petwalker' });
        if (roleErr) throw new Error(`role_insert_failed: ${JSON.stringify(roleErr)}`);
      }
      return { id, email };
    };

    const owner = await createUser('pet_owner');
    const intruder = await createUser('pet_owner');
    const walker = await createUser('petwalker');
    ownerId = owner.id;
    ownerEmail = owner.email;
    intruderId = intruder.id;
    intruderEmail = intruder.email;
    walkerId = walker.id;
    walkerEmail = walker.email;

    // Preflight fail-closed: signup_intent persisted for all three users.
    for (const [id, expected] of [
      [ownerId, 'pet_owner'],
      [intruderId, 'pet_owner'],
      [walkerId, 'petwalker'],
    ] as const) {
      const { data: pf, error: pfErr } = await admin
        .from('profiles')
        .select('signup_intent')
        .eq('id', id)
        .single();
      if (pfErr) throw new Error(`profile_preflight_failed: ${JSON.stringify(pfErr)}`);
      if (pf!.signup_intent !== expected) {
        throw new Error(`profile_signup_intent_mismatch: ${expected} != ${pf!.signup_intent}`);
      }
    }

    const { data: pet, error: petErr } = await admin
      .from('pets')
      .insert({
        owner_id: ownerId,
        name: 'E2E Review Pet',
        breed: 'Vira-lata',
        weight: 10,
        e2e_test: true,
        e2e_run_id: runId,
      })
      .select()
      .single();
    if (petErr) throw new Error(`pet_insert_failed: ${JSON.stringify(petErr)}`);
    petId = pet.id;
  });

  test.afterAll(async () => {
    // Fail-closed: any error here must fail the suite. Sessions created in
    // tests are tagged e2e_run_id and removed by the helper (children first).
    await failClosedCleanup(admin, [ownerId, intruderId, walkerId], runId);
  });

  /** Deterministic session via admin (setup only; review transitions are NOT faked). */
  async function createSession(status: 'completed' | 'in_progress') {
    const { data, error } = await admin
      .from('walk_sessions')
      .insert({
        customer_id: ownerId,
        walker_id: walkerId,
        pet_id: petId,
        status,
        current_status: status,
        walk_type: 'livre',
        start_time: new Date(Date.now() - 3_600_000).toISOString(),
        end_time: status === 'completed' ? new Date().toISOString() : null,
        planned_duration_minutes: 30,
        actual_duration_minutes: status === 'completed' ? 31 : null,
        e2e_test: true,
        e2e_run_id: runId,
      })
      .select()
      .single();
    if (error) throw new Error(`session_insert_failed: ${JSON.stringify(error)}`);
    return data;
  }

  async function auditSession(id: string) {
    const { data, error } = await admin
      .from('walk_sessions')
      .select('id, customer_id, walker_id, pet_id, status, current_status, rating, feedback')
      .eq('id', id)
      .single();
    if (error) throw new Error(`audit_session_failed: ${JSON.stringify(error)}`);
    return data;
  }

  test('A. Owner real de sessão completed submete avaliação → true + persistido', async () => {
    const session = await createSession('completed');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    const { data, error } = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 5,
      _feedback: `Review A ${runId}`,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);

    const s = await auditSession(session.id);
    expect(Number(s.rating)).toBe(5);
    expect(s.feedback).toBe(`Review A ${runId}`);
    expect(s.id).toBe(session.id);
    expect(s.current_status).toBe('completed');
  });

  test('B. Owner não relacionado não avalia a sessão', async () => {
    const session = await createSession('completed');
    const intruderClient = await getAuthenticatedClient(intruderEmail);

    const { data, error } = await intruderClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 1,
      _feedback: null,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const s = await auditSession(session.id);
    expect(s.rating).toBeNull();
    expect(s.feedback).toBeNull();
    expect(s.customer_id).toBe(ownerId);
  });

  test('C. PetWalker designado não submete avaliação de cliente', async () => {
    const session = await createSession('completed');
    const walkerClient = await getAuthenticatedClient(walkerEmail);

    const { data, error } = await walkerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 5,
      _feedback: null,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const s = await auditSession(session.id);
    expect(s.rating).toBeNull();
    expect(s.feedback).toBeNull();
    expect(s.walker_id).toBe(walkerId);
  });

  test('D. Owner não avalia sessão não-completed', async () => {
    const session = await createSession('in_progress');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    const { data, error } = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 5,
      _feedback: null,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const s = await auditSession(session.id);
    expect(s.current_status).toBe('in_progress');
    expect(s.rating).toBeNull();
  });

  test('E. rating 0 rejeitado', async () => {
    const session = await createSession('completed');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    const { data, error } = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 0,
      _feedback: null,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const s = await auditSession(session.id);
    expect(s.rating).toBeNull();
  });

  test('F. rating 6 rejeitado', async () => {
    const session = await createSession('completed');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    const { data, error } = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 6,
      _feedback: null,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const s = await auditSession(session.id);
    expect(s.rating).toBeNull();
  });

  test('G. feedback oversized (>2000) rejeitado', async () => {
    const session = await createSession('completed');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    const { data, error } = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 4,
      _feedback: 'x'.repeat(2001),
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const s = await auditSession(session.id);
    expect(s.rating).toBeNull();
    expect(s.feedback).toBeNull();
  });

  test('H. UPDATE direto do cliente em walk_sessions continua bloqueado por RLS', async () => {
    const session = await createSession('completed');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    // Direct table UPDATE must NOT succeed for authenticated customers.
    const { error: upErr } = await ownerClient
      .from('walk_sessions')
      .update({ rating: 5, feedback: 'bypass attempt' })
      .eq('id', session.id);
    expect(upErr).not.toBeNull();

    const s = await auditSession(session.id);
    expect(s.rating).toBeNull();
    expect(s.feedback).toBeNull();
  });

  test('I. tentativas falhas não mutam rating/feedback/status/ownership', async () => {
    const session = await createSession('in_progress');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    await ownerClient.rpc('customer_submit_walk_review', { _session_id: session.id, _rating: 3, _feedback: null });
    await getAuthenticatedClient(intruderEmail).then((c) =>
      c.rpc('customer_submit_walk_review', { _session_id: session.id, _rating: 5, _feedback: 'x' })
    );

    const s = await auditSession(session.id);
    expect(s.rating).toBeNull();
    expect(s.feedback).toBeNull();
    expect(s.status).toBe('in_progress');
    expect(s.current_status).toBe('in_progress');
    expect(s.customer_id).toBe(ownerId);
    expect(s.walker_id).toBe(walkerId);
  });

  test('J. retry idempotente (mesmo rating+feedback) → true', async () => {
    const session = await createSession('completed');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    const first = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 5,
      _feedback: `Retry ${runId}`,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    const retry = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 5,
      _feedback: `Retry ${runId}`,
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(true);

    const s = await auditSession(session.id);
    expect(Number(s.rating)).toBe(5);
    expect(s.feedback).toBe(`Retry ${runId}`);
  });

  test('K. segunda avaliação diferente é rejeitada (review imutável)', async () => {
    const session = await createSession('completed');
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    const first = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 5,
      _feedback: `First ${runId}`,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    const second = await ownerClient.rpc('customer_submit_walk_review', {
      _session_id: session.id,
      _rating: 2,
      _feedback: `Second ${runId}`,
    });
    expect(second.error).not.toBeNull();
    expect(second.data).toBeNull();

    const s = await auditSession(session.id);
    expect(Number(s.rating)).toBe(5);
    expect(s.feedback).toBe(`First ${runId}`);
  });
});
