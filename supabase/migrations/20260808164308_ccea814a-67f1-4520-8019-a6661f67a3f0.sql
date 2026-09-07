
-- 1. Restore/Correct get_admin_application_stats RPC
CREATE OR REPLACE FUNCTION public.get_admin_application_stats()
RETURNS TABLE (
  pending_count bigint,
  approved_count bigint,
  rejected_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*) FILTER (WHERE status = 'rejected')
  FROM public.petwalker_applications;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_application_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_application_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_application_stats() TO authenticated, service_role;

-- 2. Final Grant alignment for other Phase 2 components
GRANT SELECT ON public.walk_pricing_settings TO service_role;
GRANT EXECUTE ON FUNCTION public.get_walk_quote(integer, public.walk_request_mode) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer) TO authenticated, service_role;
