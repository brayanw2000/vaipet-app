-- Phase 4.2 Patch 1C: Final Reconciliation
-- Establish canonical hardened versions of update_walker_location and append_walk_tracking_point.

-- 1. Remove insecure overloads and PUBLIC access
DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, double precision[]);
DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, jsonb);

-- 2. Create canonical append_walk_tracking_point (Internal Helper Only)
CREATE OR REPLACE FUNCTION public.append_walk_tracking_point(_session_id uuid, _point jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid;
    _lng double precision;
    _lat double precision;
BEGIN
    -- Only allow if caller is authenticated (it's SECURITY DEFINER, but we still verify auth.uid())
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- Extract and validate coordinates
    _lng := (_point->>0)::double precision;
    _lat := (_point->>1)::double precision;

    IF _lat IS NULL OR _lng IS NULL OR _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
        RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE = '22023';
    END IF;

    -- Lock session and verify authority/status
    SELECT walker_id INTO _walker_id
    FROM public.walk_sessions
    WHERE id = _session_id
      AND walker_id = auth.uid()
      AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Append point to trail (maximum 5000 points)
    UPDATE public.walk_sessions
    SET route_coordinates = CASE 
        WHEN jsonb_array_length(route_coordinates) < 5000 THEN route_coordinates || _point
        ELSE route_coordinates 
    END,
    last_tracking_at = now()
    WHERE id = _session_id;

    RETURN true;
END;
$$;

-- REVOKE EXECUTE from everyone but the system/owner (SECURITY DEFINER allows internal calls)
REVOKE EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) TO service_role;

-- 3. Create canonical update_walker_location
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision, double precision, bigint);

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

    -- Reject structural absurdity (> 10km accuracy is usually noise/placeholder)
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

    -- 6. Monotonicity check (Captured at must be strictly greater than last capture)
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

    -- 8. Async trail appending (Internal call)
    IF _profile.current_walk_id IS NOT NULL THEN
        PERFORM public.append_walk_tracking_point(
            _profile.current_walk_id, 
            jsonb_build_array(_lng, _lat)
        );
    END IF;

    -- 9. Insert tracking record (Raw log)
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

    RETURN true;
END;
$$;

-- GRANT to authenticated only
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;

-- 4. Hardening walker_tracking Table
REVOKE INSERT ON public.walker_tracking FROM authenticated;
GRANT ALL ON public.walker_tracking TO service_role;
-- SELECT is already guarded by RLS for participants.