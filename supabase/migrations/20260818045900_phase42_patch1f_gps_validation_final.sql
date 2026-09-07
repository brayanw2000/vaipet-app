-- PHASE 4.2 — PATCH 1F
-- CORREÇÃO FINAL DE VALIDAÇÃO + COMPLETUDE DOS TESTES

-- 1. CORRIGIR SOMENTE update_walker_location
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
    -- 1. NULL INPUTS VALIDATION (Requirement 1)
    IF _lat IS NULL OR _lng IS NULL OR _captured_at IS NULL THEN
        RAISE EXCEPTION 'Latitude, longitude and captured_at are mandatory' USING ERRCODE = '22000';
    END IF;

    -- 2. ACCURACY VALIDATION (Requirement 2)
    -- _accuracy can be NULL, but if not NULL, must be [0, 10000]
    IF _accuracy IS NOT NULL AND (_accuracy < 0 OR _accuracy > 10000) THEN
        RAISE EXCEPTION 'Invalid accuracy: must be between 0 and 10000' USING ERRCODE = '22000';
    END IF;

    -- 3. captured_at VALIDATION (Requirement 3)
    IF _captured_at < 0 THEN
        RAISE EXCEPTION 'Invalid captured_at: must be positive' USING ERRCODE = '22000';
    END IF;

    -- 4. Identity & Role check
    IF _walker_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = _walker_id AND role = 'petwalker'
    ) THEN
        RAISE EXCEPTION 'Access denied: Petwalker role required' USING ERRCODE = '42501';
    END IF;

    -- 5. Profile monotonicity & ownership
    SELECT current_walk_id, last_location_captured_at, approval_status
    INTO _profile
    FROM public.petwalker_profiles
    WHERE user_id = _walker_id
    FOR UPDATE;

    IF NOT FOUND OR _profile.approval_status != 'approved' THEN
        RAISE EXCEPTION 'Petwalker profile not found or not approved' USING ERRCODE = '42501';
    END IF;

    -- Monotonicity check (Requirement 3)
    IF _captured_at <= COALESCE(_profile.last_location_captured_at, 0) THEN
        RETURN false;
    END IF;

    -- Lat/Lng Validation
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
        RETURN false;
    END IF;

    -- 6. Update Walker Live State
    UPDATE public.petwalker_profiles
    SET 
        last_known_location = ST_SetSRID(ST_Point(_lng, _lat), 4326),
        last_location_at = NOW(),
        last_location_captured_at = _captured_at,
        updated_at = NOW()
    WHERE user_id = _walker_id;

    -- 7. Session Context
    IF _profile.current_walk_id IS NOT NULL THEN
        -- Verify walker owns the current session
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

            -- TRAIL APPEND (internal helper handles rate limit, limit, and formats)
            PERFORM public.append_walk_tracking_point(_profile.current_walk_id, _lng, _lat);
        END IF;
    END IF;

    RETURN true;
END;
$$;

-- Ensure privileges remain strict
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO service_role;
