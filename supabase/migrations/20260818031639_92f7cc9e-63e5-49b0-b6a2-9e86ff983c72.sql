-- Phase 4.2 Patch 1C: Final Reconciliation (Hardening walker_tracking)

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
    _profile record;
    _captured_timestamptz timestamptz;
    _is_active_session boolean := false;
BEGIN
    -- 1. Identity & Role check
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'petwalker') THEN
        RAISE EXCEPTION 'Unauthorized: Role petwalker required' USING ERRCODE = '42501';
    END IF;

    -- 2. Mandatory inputs
    IF _lat IS NULL OR _lng IS NULL OR _captured_at IS NULL THEN
        RAISE EXCEPTION 'lat, lng and captured_at are mandatory' USING ERRCODE = '23502';
    END IF;

    -- 3. Geographic & Accuracy validation
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
        RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE = '22023';
    END IF;

    -- Reject structural absurdity
    IF _accuracy IS NOT NULL AND (_accuracy < 0 OR _accuracy > 10000) THEN
        RAISE EXCEPTION 'Invalid accuracy' USING ERRCODE = '22023';
    END IF;

    -- 4. Convert capture time
    _captured_timestamptz := to_timestamp(_captured_at / 1000.0);

    -- 5. Lock profile and verify approval status
    SELECT * INTO _profile
    FROM public.petwalker_profiles
    WHERE user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND OR _profile.approval_status != 'approved' THEN
        RAISE EXCEPTION 'Petwalker profile not approved' USING ERRCODE = '42501';
    END IF;

    -- 6. Monotonicity check
    IF _profile.last_location_at IS NOT NULL AND _captured_timestamptz <= _profile.last_location_at THEN
        RETURN false;
    END IF;

    -- 7. Update profile
    UPDATE public.petwalker_profiles
    SET 
        last_known_location = st_setsrid(st_makepoint(_lng, _lat), 4326),
        last_location_at = _captured_timestamptz,
        last_sync_at = now()
    WHERE user_id = auth.uid();

    -- 8. Async trail and tracking record (Only if session is active)
    IF _profile.current_walk_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.walk_sessions 
            WHERE id = _profile.current_walk_id 
            AND current_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning')
        ) INTO _is_active_session;

        IF _is_active_session THEN
            -- Trail (Only in_progress/returning via internal helper)
            PERFORM public.append_walk_tracking_point(
                _profile.current_walk_id, 
                jsonb_build_array(_lng, _lat)
            );

            -- Log record
            INSERT INTO public.walker_tracking (
                walker_id,
                session_id,
                location,
                accuracy,
                captured_at
            ) VALUES (
                auth.uid(),
                _profile.current_walk_id,
                st_setsrid(st_makepoint(_lng, _lat), 4326),
                _accuracy,
                _captured_timestamptz
            );
        END IF;
    END IF;

    RETURN true;
END;
$$;