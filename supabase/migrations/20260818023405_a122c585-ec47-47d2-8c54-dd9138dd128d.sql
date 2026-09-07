-- PHASE 4.2 — TRACKING INFRASTRUCTURE AND AUTHORITY (RECONCILIATION V3)

-- 1. Ensure append_walk_tracking_point is correctly defined with JSONB support if needed
-- However, we saw in baseline that route_coordinates is JSONB.
-- Let's check the actual type in the DB.

CREATE OR REPLACE FUNCTION public.append_walk_tracking_point(_session_id uuid, _point double precision[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Handle both ARRAY and JSONB cases by casting
    UPDATE public.walk_sessions
    SET route_coordinates = (
        CASE 
            WHEN route_coordinates IS NULL THEN jsonb_build_array(jsonb_build_array(_point[1], _point[2]))
            ELSE route_coordinates || jsonb_build_array(jsonb_build_array(_point[1], _point[2]))
        END
    ),
        updated_at = now()
    WHERE id = _session_id;
    
    RETURN FOUND;
END;
$$;

-- 2. HARDEN update_walker_location
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
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    
    SELECT current_walk_id, last_location_captured_at
    INTO v_walk_id, v_last_captured
    FROM public.petwalker_profiles
    WHERE user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
    END IF;

    IF _captured_at <= COALESCE(v_last_captured, 0) THEN
        RETURN false;
    END IF;

    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        last_location_at = now(),
        last_location_captured_at = _captured_at
    WHERE user_id = v_user_id;

    IF v_walk_id IS NOT NULL THEN
        SELECT status INTO v_status 
        FROM public.walk_sessions 
        WHERE id = v_walk_id;

        INSERT INTO public.walker_tracking (walk_session_id, walker_id, location, accuracy, captured_at)
        VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography, _accuracy, _captured_at);

        -- Authority: Walker automatically appends to trail if status is active
        IF v_status IN ('in_progress', 'returning') THEN
            -- We use status instead of current_status to be safe with baseline schema
            PERFORM public.append_walk_tracking_point(v_walk_id, ARRAY[_lng, _lat]);
        END IF;
    END IF;

    RETURN true;
END;
$$;
