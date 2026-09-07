-- 1. Hardening set_petwalker_availability with role check and approval validation
CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
RETURNS void AS $$
BEGIN
    IF _status NOT IN ('available', 'offline') THEN
        RAISE EXCEPTION 'Invalid status. Must be available or offline';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'petwalker'
    ) THEN
        RAISE EXCEPTION 'Access denied: User does not have petwalker role';
    END IF;

    UPDATE public.petwalker_profiles
    SET availability_status = _status,
        is_accepting_requests = (_status = 'available'),
        last_online_at = now(),
        updated_at = now()
    WHERE user_id = auth.uid()
      AND approval_status = 'approved';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Petwalker profile not found or not approved';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.set_petwalker_availability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_petwalker_availability(text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.check_storage_path(text);