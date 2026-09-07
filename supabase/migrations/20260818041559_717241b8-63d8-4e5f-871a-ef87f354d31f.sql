-- PHASE 4.2 — PATCH 1E (v7)
-- HARDENING FINAL DO PATCH 1

-- 3. ELIMINAR OVERLOAD LEGADO + FIX RETURN TYPE
DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, jsonb);
DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, double precision, double precision);

-- 1. LIMITE DE 5000 PONTOS + INTERNAL CANONICAL
CREATE OR REPLACE FUNCTION public.append_walk_tracking_point(
  _session_id uuid,
  _lng double precision,
  _lat double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _current_coords jsonb;
    _last_tracking_at timestamptz;
    _walk_status text;
BEGIN
    -- Atomic lock
    SELECT route_coordinates, last_tracking_at, current_status
    INTO _current_coords, _last_tracking_at, _walk_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found: %', _session_id;
    END IF;

    -- 5. TRAIL SOMENTE DURANTE PASSEIO
    IF _walk_status NOT IN ('in_progress', 'returning') THEN
        RETURN;
    END IF;

    -- 2. VALIDAR ESTRUTURA DE route_coordinates
    IF _current_coords IS NULL THEN
        _current_coords := '[]'::jsonb;
    ELSIF jsonb_typeof(_current_coords) <> 'array' THEN
        RAISE EXCEPTION 'Invalid route_coordinates format: expected array, got %', jsonb_typeof(_current_coords);
    END IF;

    -- 1. LIMITE DE 5000 PONTOS
    IF jsonb_array_length(_current_coords) >= 5000 THEN
        RAISE EXCEPTION 'Max tracking points (5000) reached for session %', _session_id;
    END IF;

    -- Rate limit server-side (5 seconds)
    IF _last_tracking_at IS NOT NULL AND (now() - _last_tracking_at) < interval '5 seconds' THEN
        RETURN;
    END IF;

    -- Append point: [[lng, lat]] format
    UPDATE public.walk_sessions
    SET 
        route_coordinates = _current_coords || jsonb_build_array(jsonb_build_array(_lng, _lat)),
        last_tracking_at = NOW(),
        updated_at = NOW()
    WHERE id = _session_id;
END;
$$;

-- REVOKE PUBLIC ACCESS
REVOKE EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision, double precision) TO service_role;

-- 4. update_walker_location (HARDENED WRAPPER WITH TRACING)
CREATE OR REPLACE FUNCTION public.update_walker_location(
    _lat double precision,
    _lng double precision,
    _accuracy double precision,
    _captured_at bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _profile record;
    _session record;
BEGIN
    -- 1. Identity & Role check
    IF _walker_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = _walker_id AND role = 'petwalker'
    ) THEN
        RAISE EXCEPTION 'Access denied: Petwalker role required' USING ERRCODE = '42501';
    END IF;

    -- 2. Profile monotonicity & ownership
    SELECT current_walk_id, last_location_captured_at, approval_status
    INTO _profile
    FROM public.petwalker_profiles
    WHERE user_id = _walker_id
    FOR UPDATE;

    IF NOT FOUND OR _profile.approval_status != 'approved' THEN
        RAISE EXCEPTION 'Petwalker profile not found or not approved' USING ERRCODE = '42501';
    END IF;

    -- Monotonicity check
    IF _captured_at <= COALESCE(_profile.last_location_captured_at, 0) THEN
        RETURN false;
    END IF;

    -- Validation
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 OR _accuracy > 10000 THEN
        RETURN false;
    END IF;

    -- 3. Update Walker Live State
    UPDATE public.petwalker_profiles
    SET 
        last_known_location = ST_SetSRID(ST_Point(_lng, _lat), 4326),
        last_location_at = NOW(),
        last_location_captured_at = _captured_at,
        updated_at = NOW()
    WHERE user_id = _walker_id;

    -- 4. Session Context
    IF _profile.current_walk_id IS NOT NULL THEN
        -- Verify walker owns the current session AND status is active
        SELECT walker_id, current_status INTO _session
        FROM public.walk_sessions 
        WHERE id = _profile.current_walk_id
        FOR UPDATE;

        IF FOUND AND _session.walker_id = _walker_id AND _session.current_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning') THEN
            -- LIVE TRACKING LOG
            INSERT INTO public.walker_tracking (
                walk_session_id, walker_id, location, accuracy, captured_at
            ) VALUES (
                _profile.current_walk_id, _walker_id, ST_SetSRID(ST_Point(_lng, _lat), 4326), _accuracy, _captured_at
            );

            -- TRAIL APPEND (Internal Helper handles its own status check)
            PERFORM public.append_walk_tracking_point(_profile.current_walk_id, _lng, _lat);
        END IF;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO service_role;
