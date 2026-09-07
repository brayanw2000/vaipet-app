-- Phase 3: Final Polish, Security Hardening & Scheduling

-- 1. DROP ALL POTENTIAL VERSIONS OF FUNCTIONS TO AVOID PARAMETER CONFLICTS
DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Drop all versions of create_walk_request
    FOR r IN (SELECT oid::regprocedure as proc FROM pg_proc WHERE proname = 'create_walk_request') LOOP
        EXECUTE 'DROP FUNCTION ' || r.proc;
    END LOOP;

    -- Drop all versions of operational RPCs
    FOR r IN (SELECT oid::regprocedure as proc FROM pg_proc WHERE proname IN (
        'petwalker_start_heading', 'petwalker_arrive_pickup', 'petwalker_start_walk', 
        'petwalker_complete_walk', 'customer_cancel_search', 'customer_request_return', 
        'customer_confirm_arrival', 'get_active_walker_location'
    )) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proc;
    END LOOP;

    -- Drop all versions of update_walker_location
    FOR r IN (SELECT oid::regprocedure as proc FROM pg_proc WHERE proname = 'update_walker_location') LOOP
        EXECUTE 'DROP FUNCTION ' || r.proc;
    END LOOP;
END $$;

-- 2. CREATE WALK REQUEST (Canonical Signature & Mandatory Fields Sync)
CREATE OR REPLACE FUNCTION public.create_walk_request(
    _pet_id uuid,
    _duration_minutes integer,
    _request_mode public.walk_request_mode,
    _scheduled_for timestamptz,
    _meeting_point_lng double precision,
    _meeting_point_lat double precision,
    _meeting_point_address text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session_id uuid;
    _start_time timestamptz;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    
    -- Validate ownership
    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = _user_id) THEN
        RAISE EXCEPTION 'Invalid pet or ownership';
    END IF;

    -- Validate duration
    IF _duration_minutes < 15 OR _duration_minutes % 15 != 0 THEN
        RAISE EXCEPTION 'Invalid duration (minimum 15 minutes, steps of 15)';
    END IF;

    -- Determine start time
    _start_time := CASE WHEN _request_mode = 'now' THEN now() ELSE _scheduled_for END;
    IF _request_mode = 'scheduled' AND (_scheduled_for IS NULL OR _scheduled_for <= now()) THEN
        RAISE EXCEPTION 'Scheduled time must be in the future';
    END IF;

    -- Create session (Sync status and current_status)
    INSERT INTO public.walk_sessions (
        customer_id,
        pet_id,
        planned_duration_minutes,
        status, 
        current_status, 
        walk_type, 
        request_mode,
        scheduled_for,
        search_started_at,
        start_time,
        meeting_point_geom,
        meeting_point_address,
        search_radius_km
    ) VALUES (
        _user_id,
        _pet_id,
        _duration_minutes,
        'searching', 
        'searching', 
        'livre', 
        _request_mode,
        _scheduled_for,
        CASE WHEN _request_mode = 'now' THEN now() ELSE NULL END,
        _start_time,
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address,
        1.5
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) TO authenticated, service_role;

-- 3. OPERATIONAL RPCS (Standardizing to _session_id)

CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'heading_to_pickup', status = 'heading_to_pickup' 
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'accepted';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'arrived', status = 'arrived' 
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'heading_to_pickup';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'in_progress', status = 'in_progress', start_time = now() 
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'arrived';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid := auth.uid();
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', status = 'completed', end_time = now()
    WHERE id = _session_id 
      AND walker_id = _walker_id 
      AND current_status = 'in_progress';
    
    IF NOT FOUND THEN RETURN false; END IF;

    UPDATE public.petwalker_profiles SET current_walk_id = NULL WHERE user_id = _walker_id;
    RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.customer_cancel_search(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'cancelled', status = 'cancelled'
    WHERE id = _session_id 
      AND customer_id = auth.uid() 
      AND current_status = 'searching';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.customer_request_return(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'returning', status = 'returning'
    WHERE id = _session_id 
      AND customer_id = auth.uid() 
      AND current_status = 'in_progress';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.customer_confirm_arrival(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid;
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', status = 'completed', end_time = now()
    WHERE id = _session_id 
      AND customer_id = auth.uid() 
      AND current_status = 'returning'
    RETURNING walker_id INTO _walker_id;
    
    IF NOT FOUND THEN RETURN false; END IF;

    IF _walker_id IS NOT NULL THEN
        UPDATE public.petwalker_profiles SET current_walk_id = NULL WHERE user_id = _walker_id;
    END IF;
    RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.get_active_walker_location(_session_id uuid)
RETURNS TABLE (lat double precision, lng double precision, accuracy double precision, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN QUERY
    SELECT 
        st_y(location::geometry), st_x(location::geometry), t.accuracy, created_at
    FROM public.walker_tracking t
    WHERE walk_session_id = _session_id 
      AND (
          EXISTS (SELECT 1 FROM public.walk_sessions WHERE id = _session_id AND customer_id = auth.uid())
          OR 
          EXISTS (SELECT 1 FROM public.walk_sessions WHERE id = _session_id AND walker_id = auth.uid())
      )
    ORDER BY created_at DESC
    LIMIT 1;
END; $$;

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_start_walk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_cancel_search(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_request_return(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_confirm_arrival(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated, service_role;

-- 4. UPDATE WALKER LOCATION (Harden & Accuracy)

CREATE OR REPLACE FUNCTION public.update_walker_location(
  _lat double precision,
  _lng double precision,
  _accuracy double precision
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _current_walk_id uuid;
    _loc geography;
BEGIN
    -- Auth & Role Check
    IF NOT public.has_role(_walker_id, 'petwalker') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    
    -- Profile Approval Check
    IF NOT EXISTS (SELECT 1 FROM public.petwalker_profiles WHERE user_id = _walker_id AND approval_status = 'approved') THEN
        RAISE EXCEPTION 'Walker profile not approved';
    END IF;

    -- Coordinate validation
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;

    _loc := st_setsrid(st_point(_lng, _lat), 4326)::geography;

    UPDATE public.petwalker_profiles
    SET last_known_location = _loc,
        last_location_at = now()
    WHERE user_id = _walker_id
    RETURNING current_walk_id INTO _current_walk_id;

    -- Track only during active session
    IF _current_walk_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.walk_sessions WHERE id = _current_walk_id AND walker_id = _walker_id) THEN
            INSERT INTO public.walker_tracking (walker_id, walk_session_id, location, accuracy)
            VALUES (_walker_id, _current_walk_id, _loc, _accuracy);
        END IF;
    END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision) TO authenticated, service_role;

-- 5. SCHEDULING (Documentation)
-- In Lovable Cloud, please use the Supabase Dashboard to enable pg_cron if required.
-- SELECT cron.schedule('walk-matching-job', '*/3 * * * *', 'SELECT public.process_walk_matching()');

-- 6. SECURITY: Hardening Matching RPC
REVOKE ALL ON FUNCTION public.process_walk_matching() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_walk_matching() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;
