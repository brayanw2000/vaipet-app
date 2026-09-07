-- ACL Correction: Ensure all 5 functions have correct permissions and signatures are unified.
-- Note: The previous migration might have left different signatures.

-- 1. Fix permissions for the five critical RPCs
DO $$
BEGIN
    -- customer_get_pickup_code(uuid)
    REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

    -- petwalker_confirm_pickup(uuid, text)
    REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

    -- petwalker_start_heading(uuid)
    REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

    -- petwalker_arrive_pickup(uuid, double precision, double precision, double precision)
    REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;

    -- petwalker_complete_walk(uuid)
    REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;

    -- Ensure walk_pickup_codes table is locked
    REVOKE ALL ON TABLE public.walk_pickup_codes FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.walk_pickup_codes TO service_role;
    ALTER TABLE public.walk_pickup_codes ENABLE ROW LEVEL SECURITY;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20260817042000') ON CONFLICT DO NOTHING;
