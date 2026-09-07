-- PHASE 4.2 — PATCH 1E (v3)
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
    _last_tracking_at_text text;
    _last_tracking_at_epoch double precision;
    _walk_status text;
BEGIN
    -- Atomic lock
    SELECT route_coordinates, last_tracking_at, current_status
    INTO _current_coords, _last_tracking_at_text, _walk_status
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
    -- Column is text, so we try to cast or use the current server time if invalid
    IF _last_tracking_at_text IS NOT NULL THEN
        BEGIN
            _last_tracking_at_epoch := _last_tracking_at_text::double precision;
            IF (EXTRACT(EPOCH FROM NOW()) - _last_tracking_at_epoch) < 5 THEN
                RETURN;
            END IF;
        EXCEPTION WHEN others THEN
            -- If not numeric text, skip rate limit for this one and overwrite
        END;
    END IF;

    -- Append point: [[lng, lat]] format
    UPDATE public.walk_sessions
    SET 
        route_coordinates = _current_coords || jsonb_build_array(jsonb_build_array(_lng, _lat)),
        last_tracking_at = EXTRACT(EPOCH FROM NOW())::text,
        updated_at = NOW()
    WHERE id = _session_id;
END;
$$;

-- REVOKE PUBLIC ACCESS (Canonical Helper)
REVOKE EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision, double precision) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision, double precision) TO service_role;

-- 4. update_walker_location (HARDENED WRAPPER)
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
    _current_walk_id uuid;
    _last_captured bigint;
    _walk_status text;
BEGIN
    -- 1. Identity & Role check
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = _walker_id AND role = 'petwalker'
    ) THEN
        RAISE EXCEPTION 'Access denied: Petwalker role required' USING ERRCODE = '42501';
    END IF;

    -- 2. Profile monotonicity & ownership
    SELECT current_walk_id, last_location_captured_at
    INTO _current_walk_id, _last_captured
    FROM public.petwalker_profiles
    WHERE user_id = _walker_id AND approval_status = 'approved'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Petwalker profile not found or not approved' USING ERRCODE = '42501';
    END IF;

    -- Monotonicity check
    IF _captured_at <= COALESCE(_last_captured, 0) THEN
        RETURN false;
    END IF;

    -- Validation
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 OR _accuracy > 10000 THEN
        RETURN false;
    END IF;

    -- 3. Update Walker Live State
    UPDATE public.petwalker_profiles
    SET 
        last_location = ST_SetSRID(ST_Point(_lng, _lat), 4326),
        last_location_at = NOW(),
        last_location_captured_at = _captured_at,
        updated_at = NOW()
    WHERE user_id = _walker_id;

    -- 4. Session Context
    IF _current_walk_id IS NOT NULL THEN
        SELECT current_status INTO _walk_status 
        FROM public.walk_sessions 
        WHERE id = _current_walk_id AND walker_id = _walker_id;

        -- Logs are allowed for all active walker-owned statuses
        IF FOUND AND _walk_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning') THEN
            -- LIVE TRACKING LOG
            INSERT INTO public.walker_tracking (
                walk_id, walker_id, location, captured_at
            ) VALUES (
                _current_walk_id, _walker_id, ST_SetSRID(ST_Point(_lng, _lat), 4326), _captured_at
            );

            -- TRAIL APPEND (Internal Helper - status check inside)
            PERFORM public.append_walk_tracking_point(_current_walk_id, _lng, _lat);
        END IF;
    END IF;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO service_role;
