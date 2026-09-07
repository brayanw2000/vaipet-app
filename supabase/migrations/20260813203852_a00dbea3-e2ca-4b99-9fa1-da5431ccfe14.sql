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
    _start_time timestamptz;
    _expiry_minutes integer;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = _user_id) THEN
        RAISE EXCEPTION 'Pet inválido ou não pertence ao usuário';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.walk_sessions
        WHERE pet_id = _pet_id
        AND current_status NOT IN ('completed', 'cancelled', 'expired')
    ) THEN
        RAISE EXCEPTION 'Este pet já possui um pedido em andamento';
    END IF;

    _start_time := CASE WHEN _request_mode = 'now' THEN now() ELSE _scheduled_for END;
    IF _request_mode = 'scheduled' AND (_scheduled_for IS NULL OR _scheduled_for <= now()) THEN
        RAISE EXCEPTION 'Agendamento deve ser para o futuro';
    END IF;

    SELECT session_expiry_minutes INTO _expiry_minutes
    FROM public.walk_matching_settings WHERE active = true LIMIT 1;
    _expiry_minutes := COALESCE(_expiry_minutes, 10);

    INSERT INTO public.walk_sessions (
        customer_id, pet_id, planned_duration_minutes, current_status, walk_type,
        request_mode, scheduled_for, search_started_at, matching_expires_at, start_time,
        meeting_point_geom, meeting_point_address, search_radius_km
    ) VALUES (
        _user_id, _pet_id, _duration_minutes,
        CASE WHEN _request_mode = 'now' THEN 'searching'::public.walk_status ELSE 'scheduled'::public.walk_status END,
        'livre', _request_mode, _scheduled_for,
        CASE WHEN _request_mode = 'now' THEN now() ELSE NULL END,
        CASE WHEN _request_mode = 'now' THEN now() + (_expiry_minutes * interval '1 minute') ELSE NULL END,
        _start_time,
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address,
        1.5
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_walk_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r_session RECORD;
    r_walker RECORD;
    v_radius float;
    v_max_radius float;
    v_initial_radius float;
    v_increment float;
    v_exp_interval float;
    v_expiry float;
    v_elapsed float;
BEGIN
    SELECT
        initial_radius_meters, max_radius_meters, radius_expansion_step_meters,
        expansion_interval_minutes, session_expiry_minutes
    INTO v_initial_radius, v_max_radius, v_increment, v_exp_interval, v_expiry
    FROM public.walk_matching_settings WHERE active = true LIMIT 1;

    IF NOT FOUND THEN RETURN; END IF;

    FOR r_session IN
        SELECT id, meeting_point_geom, customer_id, search_started_at, matching_expires_at
        FROM public.walk_sessions
        WHERE current_status = 'searching'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
          AND (matching_expires_at IS NULL OR matching_expires_at > now())
    LOOP
        IF r_session.search_started_at IS NULL OR r_session.matching_expires_at IS NULL THEN
            UPDATE public.walk_sessions
            SET search_started_at = COALESCE(search_started_at, now()),
                matching_expires_at = COALESCE(
                  matching_expires_at,
                  COALESCE(search_started_at, now()) + (v_expiry * interval '1 minute')
                )
            WHERE id = r_session.id;
            r_session.search_started_at := COALESCE(r_session.search_started_at, now());
        END IF;

        v_elapsed := EXTRACT(EPOCH FROM (now() - r_session.search_started_at)) / 60;
        v_radius := LEAST(v_max_radius, v_initial_radius + (FLOOR(v_elapsed / NULLIF(v_exp_interval, 0)) * v_increment));

        FOR r_walker IN
            SELECT user_id
            FROM public.petwalker_profiles
            WHERE approval_status = 'approved' AND availability_status = 'available'
              AND is_accepting_requests = true AND current_walk_id IS NULL
              AND last_known_location IS NOT NULL
              AND ST_DWithin(last_known_location, r_session.meeting_point_geom, v_radius)
              AND user_id <> r_session.customer_id
        LOOP
            INSERT INTO public.walk_offers (session_id, walker_id, offer_status)
            VALUES (r_session.id, r_walker.user_id, 'pending')
            ON CONFLICT (session_id, walker_id) DO NOTHING;
        END LOOP;
    END LOOP;

    UPDATE public.walk_sessions SET current_status = 'expired'
    WHERE current_status = 'searching' AND matching_expires_at <= now();
END;
$$;