-- Migration 20260813193923_9cb836a0-338e-4b73-9480-eb8503e0443c.sql
-- Restauração segura Zero-Trust das RPCs operacionais e financeiras

-- 1. accept_walk_request (Zero-Trust Concurrency)
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid := auth.uid();
    v_customer_id uuid;
    v_offer_id uuid;
BEGIN
    IF v_walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    SELECT customer_id INTO v_customer_id
    FROM public.walk_sessions
    WHERE id = _session_id
      AND current_status = 'searching'
    FOR UPDATE;

    IF v_customer_id IS NULL THEN RETURN false; END IF;
    IF v_customer_id = v_walker_id THEN RAISE EXCEPTION 'Auto-aceite proibido'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_walker_id 
          AND approval_status = 'approved' 
          AND availability_status = 'available'
          AND current_walk_id IS NULL
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'Walker indisponível'; END IF;

    SELECT id INTO v_offer_id
    FROM public.walk_offers
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending'
    FOR UPDATE;

    IF v_offer_id IS NULL THEN RAISE EXCEPTION 'Oferta expirada'; END IF;

    UPDATE public.walk_sessions
    SET walker_id = v_walker_id, current_status = 'accepted', updated_at = now()
    WHERE id = _session_id;

    UPDATE public.walk_offers SET offer_status = 'accepted' WHERE id = v_offer_id;
    UPDATE public.walk_offers SET offer_status = 'expired' WHERE session_id = _session_id AND id <> v_offer_id AND offer_status = 'pending';
    
    UPDATE public.petwalker_profiles SET current_walk_id = _session_id, availability_status = 'busy' WHERE user_id = v_walker_id;

    RETURN true;
END;
$$;

-- 2. create_walk_request (Financial Authority in DB)
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
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    INSERT INTO public.walk_sessions (
        customer_id, pet_id, planned_duration_minutes, current_status, walk_type, 
        request_mode, scheduled_for, start_time, meeting_point_geom, meeting_point_address
    ) VALUES (
        _user_id, _pet_id, _duration_minutes, 'searching', 'livre', 
        _request_mode, _scheduled_for, COALESCE(_scheduled_for, now()),
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

-- 3. Operational RPCs
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', end_time = now()
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status IN ('in_progress', 'returning');
    
    IF FOUND THEN
        UPDATE public.petwalker_profiles SET current_walk_id = NULL, availability_status = 'available' WHERE user_id = auth.uid();
        RETURN true;
    END IF;
    RETURN false;
END; $$;

GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;
