CREATE OR REPLACE FUNCTION public.append_walk_tracking_point(_session_id uuid, _lng double precision, _lat double precision)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _session record;
BEGIN
    SELECT route_coordinates, last_tracking_at, walker_id, current_status
    INTO _session
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF NOT FOUND THEN RETURN false; END IF;
    IF _session.walker_id != auth.uid() THEN RETURN false; END IF;
    IF _session.current_status NOT IN ('in_progress', 'returning') THEN RETURN false; END IF;

    IF _session.last_tracking_at IS NOT NULL AND (now() - _session.last_tracking_at) < interval '5 seconds' THEN
        RETURN false;
    END IF;

    UPDATE public.walk_sessions
    SET 
        route_coordinates = COALESCE(route_coordinates, '[]'::jsonb) || jsonb_build_array(jsonb_build_array(_lng, _lat)),
        last_tracking_at = now()
    WHERE id = _session_id;

    RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, double precision, double precision) FROM PUBLIC, anon, authenticated;

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
    _walk_session record;
    _is_active_status boolean;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'petwalker') THEN
        RAISE EXCEPTION 'Unauthorized: Role petwalker required' USING ERRCODE = '42501';
    END IF;

    IF _lat IS NULL OR _lng IS NULL OR _captured_at IS NULL THEN
        RAISE EXCEPTION 'lat, lng and captured_at are mandatory' USING ERRCODE = '23502';
    END IF;

    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
        RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE = '22023';
    END IF;

    IF _accuracy IS NOT NULL AND (_accuracy < 0 OR _accuracy > 10000) THEN
        RAISE EXCEPTION 'Invalid accuracy' USING ERRCODE = '22023';
    END IF;

    SELECT current_walk_id, approval_status, last_location_captured_at
    INTO _profile
    FROM public.petwalker_profiles
    WHERE user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND OR _profile.approval_status != 'approved' THEN
        RAISE EXCEPTION 'Petwalker profile not approved' USING ERRCODE = '42501';
    END IF;

    IF _captured_at <= COALESCE(_profile.last_location_captured_at, 0) THEN
        RETURN false;
    END IF;

    UPDATE public.petwalker_profiles
    SET 
        last_known_location = st_setsrid(st_makepoint(_lng, _lat), 4326),
        last_location_at = now(),
        last_location_captured_at = _captured_at
    WHERE user_id = auth.uid();

    IF _profile.current_walk_id IS NOT NULL THEN
        SELECT walker_id, current_status INTO _walk_session
        FROM public.walk_sessions
        WHERE id = _profile.current_walk_id
        FOR UPDATE;

        IF FOUND AND _walk_session.walker_id = auth.uid() THEN
            _is_active_status := _walk_session.current_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning');
            
            IF _is_active_status THEN
                INSERT INTO public.walker_tracking (
                    walker_id,
                    walk_session_id,
                    location,
                    accuracy,
                    captured_at
                ) VALUES (
                    auth.uid(),
                    _profile.current_walk_id,
                    st_setsrid(st_makepoint(_lng, _lat), 4326),
                    _accuracy,
                    _captured_at
                );

                PERFORM public.append_walk_tracking_point(_profile.current_walk_id, _lng, _lat);
            END IF;
        END IF;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
