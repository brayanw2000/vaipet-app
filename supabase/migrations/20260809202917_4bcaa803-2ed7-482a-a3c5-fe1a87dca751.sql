-- 1. DROP OBSOLETE SIGNATURES
DROP FUNCTION IF EXISTS public.accept_walk_request(uuid);
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision);
DROP FUNCTION IF EXISTS public.get_active_walker_location(uuid);
DROP FUNCTION IF EXISTS public.create_walk_request(uuid, integer, text, timestamptz, double precision, double precision, text);

-- 2. ACCEPT WALK REQUEST (Hardened & Atomic)
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _session record;
BEGIN
    SELECT * INTO _session FROM public.walk_sessions WHERE id = _session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada'; END IF;
    IF _session.current_status != 'searching' THEN RETURN false; END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = _walker_id AND approval_status = 'approved' AND availability_status = 'available' AND current_walk_id IS NULL FOR UPDATE
    ) THEN RAISE EXCEPTION 'PetWalker não elegível'; END IF;

    UPDATE public.walk_sessions SET walker_id = _walker_id, current_status = 'accepted', accepted_at = now() WHERE id = _session_id;
    UPDATE public.petwalker_profiles SET current_walk_id = _session_id WHERE user_id = _walker_id;
    UPDATE public.walk_offers SET offer_status = 'expired' WHERE session_id = _session_id AND offer_status = 'pending';
    UPDATE public.walk_offers SET offer_status = 'accepted' WHERE session_id = _session_id AND walker_id = _walker_id;
    RETURN true;
END; $$;

-- 3. UPDATE WALKER LOCATION
CREATE OR REPLACE FUNCTION public.update_walker_location(_lat double precision, _lng double precision, _accuracy double precision DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _current_walk_id uuid;
    _loc geography := st_setsrid(st_point(_lng, _lat), 4326)::geography;
BEGIN
    UPDATE public.petwalker_profiles SET last_known_location = _loc, last_location_at = now() WHERE user_id = _walker_id RETURNING current_walk_id INTO _current_walk_id;
    IF _current_walk_id IS NOT NULL THEN
        INSERT INTO public.walker_tracking (walker_id, walk_session_id, location, accuracy) VALUES (_walker_id, _current_walk_id, _loc, _accuracy);
    END IF;
END; $$;

-- 4. GET ACTIVE WALKER LOCATION
CREATE OR REPLACE FUNCTION public.get_active_walker_location(_session_id uuid)
RETURNS TABLE (lat double precision, lng double precision, accuracy double precision, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN QUERY SELECT st_y(location::geometry), st_x(location::geometry), t.accuracy, created_at FROM public.walker_tracking t WHERE walk_session_id = _session_id ORDER BY created_at DESC LIMIT 1;
END; $$;

-- 5. MATCHING EXPANSION
CREATE OR REPLACE FUNCTION public.process_walk_matching() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _session record; BEGIN
    FOR _session IN SELECT id, meeting_point_geom, search_started_at FROM public.walk_sessions WHERE current_status = 'searching' LOOP
        INSERT INTO public.walk_offers (session_id, walker_id, offer_status)
        SELECT _session.id, p.user_id, 'pending' FROM public.petwalker_profiles p
        WHERE p.approval_status = 'approved' AND p.availability_status = 'available' AND p.current_walk_id IS NULL
        AND st_dwithin(_session.meeting_point_geom, p.last_known_location, 5000)
        AND NOT EXISTS (SELECT 1 FROM public.walk_offers WHERE session_id = _session.id AND walker_id = p.user_id);
    END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;
SELECT cron.schedule('walk-matching-job', '* * * * *', 'SELECT public.process_walk_matching()');
