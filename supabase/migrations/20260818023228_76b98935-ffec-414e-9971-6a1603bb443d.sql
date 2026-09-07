-- PHASE 4.2 — TRACKING INFRASTRUCTURE AND AUTHORITY (RECONCILIATION V2)

-- 1. Create append_walk_tracking_point if it doesn't exist (Authority Logic)
CREATE OR REPLACE FUNCTION public.append_walk_tracking_point(_session_id uuid, _point double precision[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- This function is internal/walker-only now.
    -- Appends a [lng, lat] point to the route_coordinates array.
    UPDATE public.walk_sessions
    SET route_coordinates = array_append(COALESCE(route_coordinates, ARRAY[]::double precision[][]), _point),
        updated_at = now()
    WHERE id = _session_id;
    
    RETURN FOUND;
END;
$$;

-- 2. Revoke PUBLIC access to prevent manual owner-side injection via RPC
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, double precision[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, double precision[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision[]) TO service_role;

-- 3. HARDEN update_walker_location (Final Signature with Capture Time)
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision, double precision, bigint);

CREATE OR REPLACE FUNCTION public.update_walker_location(
  _lat double precision,
  _lng double precision,
  _accuracy double precision DEFAULT 0,
  _captured_at bigint DEFAULT (extract(epoch from now()) * 1000)::bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_walk_id uuid;
    v_last_captured bigint;
    v_status text;
BEGIN
    -- Strict ACL check: must be authenticated
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    
    -- Lock walker profile
    SELECT current_walk_id, last_location_captured_at
    INTO v_walk_id, v_last_captured
    FROM public.petwalker_profiles
    WHERE user_id = v_user_id
    FOR UPDATE;

    -- If no petwalker profile, it's an unauthorized call from a non-walker account
    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Acesso negado: Perfil de Petwalker não encontrado.' USING ERRCODE = '42501';
    END IF;

    -- Monotonicity Check
    IF _captured_at <= COALESCE(v_last_captured, 0) THEN
        RETURN false;
    END IF;

    -- Update location
    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        last_location_at = now(),
        last_location_captured_at = _captured_at
    WHERE user_id = v_user_id;

    -- Tracking record
    IF v_walk_id IS NOT NULL THEN
        SELECT current_status INTO v_status 
        FROM public.walk_sessions 
        WHERE id = v_walk_id;

        INSERT INTO public.walker_tracking (walk_session_id, walker_id, location, accuracy, captured_at)
        VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography, _accuracy, _captured_at);

        -- Authority: Walker automatically appends to trail if status matches
        IF v_status IN ('in_progress', 'returning') THEN
            PERFORM public.append_walk_tracking_point(v_walk_id, ARRAY[_lng, _lat]);
        END IF;
    END IF;

    RETURN true;
END;
$$;

-- 4. ACL RE-GRANT
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO service_role;
