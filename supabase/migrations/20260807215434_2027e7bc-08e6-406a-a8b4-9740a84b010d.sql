-- Fix PetWalker availability functional inconsistency
CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
RETURNS void AS $$
BEGIN
    IF _status NOT IN ('available', 'offline') THEN
        RAISE EXCEPTION 'Invalid status. Must be available or offline';
    END IF;

    -- Update status, request acceptance, and activity timestamp atomically
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
