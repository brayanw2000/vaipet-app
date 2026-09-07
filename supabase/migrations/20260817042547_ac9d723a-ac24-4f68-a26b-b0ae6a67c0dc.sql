-- Migration: Phase 4.1 ACL Hardening

-- 1. customer_get_pickup_code(uuid)
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

-- 2. petwalker_confirm_pickup(uuid, text)
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- 3. petwalker_start_heading(uuid)
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

-- 4. petwalker_arrive_pickup(uuid, double precision, double precision, double precision)
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM anon;
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;

-- 5. petwalker_complete_walk(uuid)
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;

-- 6. walk_pickup_codes table hardening
REVOKE ALL ON TABLE public.walk_pickup_codes FROM PUBLIC;
REVOKE ALL ON TABLE public.walk_pickup_codes FROM anon;
REVOKE ALL ON TABLE public.walk_pickup_codes FROM authenticated;
GRANT ALL ON TABLE public.walk_pickup_codes TO service_role;
