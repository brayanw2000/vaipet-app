-- ACL Hardening for Phase 4.1 RPCs and Tables

-- 1. Revoke all from PUBLIC and anon for the 5 critical RPCs
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;

-- 2. Secure walk_pickup_codes table
REVOKE ALL ON TABLE public.walk_pickup_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.walk_pickup_codes TO service_role;

ALTER TABLE public.walk_pickup_codes ENABLE ROW LEVEL SECURITY;

-- Record migration manually since it's a direct SQL call
INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20260817041000') ON CONFLICT DO NOTHING;
