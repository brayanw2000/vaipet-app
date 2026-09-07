-- PHASE 4.2 — PATCH 1E (v5)
-- HARDENING FINAL DO PATCH 1

-- 3. ELIMINAR OVERLOAD LEGADO + FIX RETURN TYPE
DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, jsonb);
DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, double precision, double precision);

-- Standardize last_tracking_at to timestamp if it was text/bigint
-- Note: walk_sessions.last_tracking_at was previously string | null in types.ts (text in DB)
-- We check if it is already timestamptz to avoid double-casting if it was somehow already changed
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'walk_sessions' 
          AND column_name = 'last_tracking_at' 
          AND data_type = 'text'
    ) THEN
        ALTER TABLE public.walk_sessions 
        ALTER COLUMN last_tracking_at TYPE timestamp with time zone 
        USING (CASE WHEN last_tracking_at ~ '^[0-9.]+$' THEN to_timestamp(last_tracking_at::double precision) ELSE NULL END);
    END IF;
END $$;

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
    IF _walker_id IS NULL OR NOT EXISTS (
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
        last_known_location = ST_SetSRID(ST_Point(_lng, _lat), 4326),
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
        IF FOUND AND _walk_session.walker_id = _walker_id AND _walk_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning') THEN
            -- LIVE TRACKING LOG
            INSERT INTO public.walker_tracking (
                walk_session_id, walker_id, location, accuracy, captured_at
            ) VALUES (
                _current_walk_id, _walker_id, ST_SetSRID(ST_Point(_lng, _lat), 4326), _accuracy, _captured_at
            );

            -- TRAIL APPEND (Internal Helper - status check inside)
            PERFORM public.append_walk_tracking_point(_current_walk_id, _lng, _lat);
        END IF;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO service_role;
