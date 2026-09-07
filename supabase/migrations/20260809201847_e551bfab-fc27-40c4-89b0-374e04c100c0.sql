-- Standardizing accept_walk_request and decline_walk_offer

DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT oid::regprocedure as proc FROM pg_proc WHERE proname IN ('accept_walk_request', 'decline_walk_offer')) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proc;
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid := auth.uid();
BEGIN
    -- Auth & Role Check
    IF NOT public.has_role(_walker_id, 'petwalker') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    
    -- Profile Approval Check
    IF NOT EXISTS (SELECT 1 FROM public.petwalker_profiles WHERE user_id = _walker_id AND approval_status = 'approved') THEN
        RAISE EXCEPTION 'Walker profile not approved';
    END IF;

    -- Atomic acceptance
    UPDATE public.walk_sessions 
    SET walker_id = _walker_id, 
        current_status = 'accepted', 
        status = 'accepted',
        petwalker_notified_at = now()
    WHERE id = _session_id 
      AND current_status = 'searching' 
      AND walker_id IS NULL;

    IF NOT FOUND THEN RETURN false; END IF;

    -- Bind walker to session
    UPDATE public.petwalker_profiles SET current_walk_id = _session_id WHERE user_id = _walker_id;
    
    -- Mark other offers as superseded
    UPDATE public.walk_offers SET offer_status = 'superseded' WHERE session_id = _session_id AND walker_id != _walker_id;
    UPDATE public.walk_offers SET offer_status = 'accepted' WHERE session_id = _session_id AND walker_id = _walker_id;

    RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.decline_walk_offer(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_offers 
    SET offer_status = 'declined' 
    WHERE session_id = _session_id AND walker_id = auth.uid();
    RETURN FOUND;
END; $$;

GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_walk_offer(uuid) TO authenticated, service_role;
