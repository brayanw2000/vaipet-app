-- Security Hardening and RPC Finalization
-- Revoke PUBLIC and anon access explicitly (redundant but requested for clarity)
REVOKE ALL ON FUNCTION public.get_petwalker_applications_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_petwalker_applications_admin(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_petwalker_application_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_petwalker_application_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_application_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_application_stats() FROM anon;

-- Explicitly allow authenticated and service_role
GRANT EXECUTE ON FUNCTION public.get_petwalker_applications_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_petwalker_application_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_application_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_petwalker_applications_admin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_petwalker_application_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_application_stats() TO service_role;
