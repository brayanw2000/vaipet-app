-- ACL Hardening for Phase 4.1 RPCs and Tables
-- Revokes all public/anon access and grants execution rights only to authenticated users.

DO $$
BEGIN
    -- 1. customer_get_pickup_code(uuid)
    REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

    -- 2. petwalker_confirm_pickup(uuid, text)
    REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

    -- 3. petwalker_start_heading(uuid)
    REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

    -- 4. petwalker_arrive_pickup(uuid, double precision, double precision, double precision)
    REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;

    -- 5. petwalker_complete_walk(uuid)
    REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;

    -- Secure walk_pickup_codes table
    REVOKE ALL ON TABLE public.walk_pickup_codes FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.walk_pickup_codes TO service_role;
    ALTER TABLE public.walk_pickup_codes ENABLE ROW LEVEL SECURITY;
END $$;
