/**
 * Concorrência real de aceite — Fase 3.
 *
 * Um dono, dois PetWalkers elegíveis e online no mesmo raio, uma única
 * solicitação. Os dois aceites disparam simultaneamente (Promise.allSettled)
 * contra o banco real. A garantia é validada nos registros finais do banco,
 * nunca no frontend.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

const OWNER = { lng: -46.71, lat: -23.61 };
const W1 = { lng: -46.7108, lat: -23.6104 };
const W2 = { lng: -46.7112, lat: -23.6108 };

const rand = () => Math.random().toString(36).slice(2, 10);
const short = (id?: string | null) => (id ? `${String(id).slice(0, 8)}…` : "null");
const log = (m: string) => console.log(`[conc] ${m}`);

let admin: SupabaseClient;
let ownerId = "";
let petId = "";
let sessionId = "";
const walkers: { id: string; client: SupabaseClient }[] = [];

const signedClient = async (email: string, password: string) => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
};

test.describe.configure({ mode: "serial", retries: 0 });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  expect(SUPABASE_URL).toBeTruthy();
  expect(SERVICE_KEY).toBeTruthy();
  expect(ANON_KEY).toBeTruthy();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const runId = rand();
  const ownerEmail = `e2e.conc.owner.${runId}@e2e.vaipet.invalid`;
  const ownerPassword = `Ow${rand()}!Aa1`;
  const o = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { 
      full_name: "Conc Owner", 
      signup_intent: "pet_owner",
      e2e_test: true,
      e2e_run_id: runId
    },
  });
  if (o.error) throw o.error;
  ownerId = o.data.user!.id;
  await admin.from("profiles").upsert({ id: ownerId, full_name: "Conc Owner", onboarding_completed: true });

  const pet = await admin
    .from("pets")
    .insert({ owner_id: ownerId, name: `PetConc${runId.slice(0, 4)}`, breed: "SRD", is_active: true })
    .select("id")
    .single();
  if (pet.error) throw pet.error;
  petId = pet.data.id;

  for (const [i, pos] of [W1, W2].entries()) {
    const email = `e2e.conc.walker${i}.${runId}@e2e.vaipet.invalid`;
    const password = `Wk${rand()}!Aa1`;
    const w = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { 
        full_name: `Conc Walker ${i + 1}`, 
        signup_intent: "petwalker",
        e2e_test: true,
        e2e_run_id: runId
      },
    });
    if (w.error) throw w.error;
    const id = w.data.user!.id;
    await admin.from("profiles").upsert({ id, full_name: `Conc Walker ${i + 1}`, onboarding_completed: true });
    const role = await admin.from("user_roles").insert({ user_id: id, role: "petwalker" });
    if (role.error && !/duplicate/i.test(role.error.message)) throw role.error;
    const prof = await admin.from("petwalker_profiles").upsert(
      {
        user_id: id,
        approval_status: "approved",
        profile_completed: true,
        availability_status: "offline",
        is_accepting_requests: false,
        public_bio: "conc",
        experience_years: 1,
        service_radius_km: 5,
        price_30_minutes: 4500,
        completed_walks: 0,
      },
      { onConflict: "user_id" },
    );
    if (prof.error) throw prof.error;

    const client = await signedClient(email, password);
    const av = await client.rpc("set_petwalker_availability", { _status: "available" });
    if (av.error) throw av.error;
    const loc = await client.rpc("update_walker_location", { _lat: pos.lat, _lng: pos.lng, _accuracy: 8 });
    if (loc.error) throw loc.error;
    walkers.push({ id, client });
  }
  log(`walkers online: ${walkers.map((w) => short(w.id)).join(", ")}`);

  const ownerClient = await signedClient(ownerEmail, ownerPassword);
  const req = await ownerClient.rpc("create_walk_request", {
    _pet_id: petId,
    _duration_minutes: 15,
    _request_mode: "now",
    _scheduled_for: null,
    _meeting_point_lng: OWNER.lng,
    _meeting_point_lat: OWNER.lat,
    _meeting_point_address: "Ponto sintético de teste",
  });
  if (req.error) throw req.error;
  sessionId = req.data as string;
  log(`sessão ${short(sessionId)} criada`);
});

test.afterAll(async () => {
  if (!admin) return;
  const ids = [ownerId, ...walkers.map((w) => w.id)].filter(Boolean);
  if (ids.length === 0) return;

  log(`iniciando teardown rigoroso para ${ids.length} usuários...`);

  // Preservar sessionIds antes da exclusão
  const { data: sessions, error: sErr } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  if (sErr) throw new Error(`Teardown falhou ao buscar sessões: ${sErr.message}`);
  const sIds = sessions?.map((s) => s.id) || [];

  if (sIds.length) {
    // 2. Exclusão walker_tracking
    const { error: tErr } = await admin.from("walker_tracking").delete().in("walk_session_id", sIds);
    if (tErr) throw new Error(`Teardown falhou ao excluir tracking: ${tErr.message}`);

    // 3. Exclusão walk_offers
    const { error: oErr } = await admin.from("walk_offers").delete().in("session_id", sIds);
    if (oErr) throw new Error(`Teardown falhou ao excluir ofertas: ${oErr.message}`);

    // 4. Exclusão petwalker_earnings
    const { error: eErr } = await admin.from("petwalker_earnings").delete().in("walk_session_id", sIds);
    if (eErr) throw new Error(`Teardown falhou ao excluir ganhos: ${eErr.message}`);

    // 5. Exclusão walk_sessions
    const { error: wsErr } = await admin.from("walk_sessions").delete().in("id", sIds);
    if (wsErr) throw new Error(`Teardown falhou ao excluir sessões: ${wsErr.message}`);
  }

  // 6. Exclusão pets
  const { error: pErr } = await admin.from("pets").delete().in("owner_id", ids);
  if (pErr) throw new Error(`Teardown falhou ao excluir pets: ${pErr.message}`);

  // 7. perfis e roles
  await admin.from("petwalker_profiles").delete().in("user_id", ids);
  await admin.from("user_roles").delete().in("user_id", ids);
  await admin.from("profiles").delete().in("id", ids);

  // 10. auth.admin.deleteUser + getUserById rigoroso
  for (const id of ids) {
    const { error: dErr } = await admin.auth.admin.deleteUser(id);
    if (dErr) throw new Error(`Teardown falhou ao deletar usuário Auth ${id}: ${dErr.message}`);
    
    const { data: check, error: checkErr } = await admin.auth.admin.getUserById(id);
    
    if (checkErr) {
        // Aceita somente "User not found" (status 404)
        if (checkErr.status === 404 || checkErr.message.includes("User not found")) {
            log(`confirmação individual: usuário ${short(id)} deletado`);
        } else {
            throw new Error(`Erro rigoroso ao validar exclusão de ${id}: ${checkErr.message} (Status: ${checkErr.status})`);
        }
    } else if (check?.user) {
        throw new Error(`Teardown falhou: usuário Auth ${id} ainda existe após exclusão.`);
    } else {
        // data vazio sem erro é inconsistente na SDK, tratamos como falha de validação
        throw new Error(`Validação inconclusiva para exclusão de ${id}: data vazio sem erro 404.`);
    }
  }

  // Verificações fail-closed pós-cleanup
  const checkTables = [
    { name: "walker_tracking", filter: sIds.length ? `walk_session_id.in.(${sIds.join(",")})` : null },
    { name: "walk_offers", filter: `walker_id.in.(${ids.join(",")})` },
    { name: "petwalker_earnings", filter: sIds.length ? `walk_session_id.in.(${sIds.join(",")})` : null },
    { name: "walk_sessions", filter: `customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})` },
    { name: "pets", filter: `owner_id.in.(${ids.join(",")})` },
    { name: "petwalker_profiles", filter: `user_id.in.(${ids.join(",")})` },
    { name: "user_roles", filter: `user_id.in.(${ids.join(",")})` },
    { name: "profiles", filter: `id.in.(${ids.join(",")})` }
  ];

  for (const t of checkTables) {
      if (t.filter === null && (t.name === "walker_tracking" || t.name === "petwalker_earnings")) continue;
      
      const { count, error } = await admin.from(t.name)
        .select("*", { count: "exact", head: true })
        .or(t.filter!);

      if (error) throw new Error(`Erro rigoroso ao validar cleanup na tabela ${t.name}: ${error.message}`);
      if (count !== 0) throw new Error(`Teardown INCOMPLETO: ${count} registros residuais detectados na tabela ${t.name}`);
      log(`tabela ${t.name}: count=0 confirmado`);
  }

  log("teardown rigoroso e validação fail-closed concluídos");
});


test("dois petwalkers aceitam simultaneamente: apenas um vence", async () => {
  test.setTimeout(180_000);

  // Matching real (mesma função executada pelo job agendado).
  let offers: any[] = [];
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await admin.rpc("process_walk_matching");
    const r = await admin.from("walk_offers").select("id, walker_id, offer_status").eq("session_id", sessionId);
    offers = r.data ?? [];
    if (offers.filter((o) => o.offer_status === "pending").length >= 2) break;
    await new Promise((res) => setTimeout(res, 3_000));
  }
  log(`ofertas geradas: ${offers.map((o) => o.offer_status).join(",")}`);
  expect(offers.filter((o) => o.offer_status === "pending").length).toBeGreaterThanOrEqual(2);

  // Aceites simultâneos, cada um com a própria sessão autenticada.
  const results = await Promise.allSettled(
    walkers.map((w) => w.client.rpc("accept_walk_request", { _session_id: sessionId })),
  );
  const outcomes = results.map((r) =>
    r.status === "fulfilled"
      ? { ok: (r.value as any).data === true, err: (r.value as any).error?.message ?? null }
      : { ok: false, err: String(r.reason).slice(0, 120) },
  );
  log(`resultados: ${JSON.stringify(outcomes)}`);
  expect(outcomes.filter((o) => o.ok).length).toBe(1);

  // Verificação exclusivamente pelos registros finais do banco.
  const s = await admin.from("walk_sessions").select("walker_id, current_status").eq("id", sessionId).single();
  expect(s.error).toBeNull();
  const winnerId = s.data!.walker_id as string;
  expect([walkers[0].id, walkers[1].id]).toContain(winnerId);
  expect(s.data!.current_status).toBe("accepted");

  const finalOffers = await admin
    .from("walk_offers")
    .select("walker_id, offer_status")
    .eq("session_id", sessionId);
  const rows = finalOffers.data ?? [];
  log(`ofertas finais: ${rows.map((o: any) => `${short(o.walker_id)}=${o.offer_status}`).join(", ")}`);
  expect(rows.filter((o: any) => o.offer_status === "accepted").length).toBe(1);
  expect(rows.find((o: any) => o.offer_status === "accepted")!.walker_id).toBe(winnerId);
  expect(rows.filter((o: any) => o.offer_status === "pending").length).toBe(0);
  for (const o of rows.filter((r: any) => r.walker_id !== winnerId)) {
    expect(["expired", "declined"]).toContain(o.offer_status);
  }

  const loserId = walkers.find((w) => w.id !== winnerId)!.id;
  const profs = await admin
    .from("petwalker_profiles")
    .select("user_id, availability_status, current_walk_id")
    .in("user_id", [winnerId, loserId]);
  const winner = (profs.data ?? []).find((p: any) => p.user_id === winnerId)!;
  const loser = (profs.data ?? []).find((p: any) => p.user_id === loserId)!;
  expect(winner.availability_status).toBe("busy");
  expect(winner.current_walk_id).toBe(sessionId);
  expect(loser.availability_status).toBe("available");
  expect(loser.current_walk_id).toBeNull();

  // O perdedor não vê mais a oferta (retorno controlado da RPC de ofertas).
  const loserClient = walkers.find((w) => w.id === loserId)!.client;
  const stillOffered = await loserClient.rpc("get_available_walk_offers");
  expect(stillOffered.error).toBeNull();
  expect(((stillOffered.data as any[]) ?? []).some((o) => o.session_id === sessionId)).toBe(false);
});
