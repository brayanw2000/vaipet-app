-- PHASE 4.4 — BLOCKER PATCH A — CORRECTIVE MIGRATION (atomic backend fix)
--
-- create_walk_request agora persiste walk_sessions.home_location atomicamente,
-- a partir das MESMAS coordenadas de meeting point já recebidas pela RPC
-- (_meeting_point_lng / _meeting_point_lat).
--
-- NENHUMA outra mudança:
--   - assinatura idêntica
--   - SECURITY DEFINER / search_path idênticos
--   - validações idênticas (auth, pet ownership, pedido em andamento, agendamento)
--   - status logic idêntica (searching/scheduled)
--   - matching logic idêntica (matching_expires_at, search_radius_km)
--   - ACL semantics idênticas (REVOKE/GRANT)
--   - meeting_point behavior idêntico
--
-- Motivação: petwalker_arrive_pickup exige home_location definido. Sessões
-- criadas pela UI REAL via create_walk_request ficavam com home_location NULL,
-- bloqueando a chegada do PetWalker. Agora o ponto de encontro (que é a própria
-- localização do tutor no momento do pedido) é persistido na criação.

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
        meeting_point_geom, meeting_point_address, search_radius_km, home_location
    ) VALUES (
        _user_id, _pet_id, _duration_minutes,
        CASE WHEN _request_mode = 'now' THEN 'searching'::public.walk_status ELSE 'scheduled'::public.walk_status END,
        'livre', _request_mode, _scheduled_for,
        CASE WHEN _request_mode = 'now' THEN now() ELSE NULL END,
        CASE WHEN _request_mode = 'now' THEN now() + (_expiry_minutes * interval '1 minute') ELSE NULL END,
        _start_time,
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address,
        1.5,
        jsonb_build_object('lng', _meeting_point_lng, 'lat', _meeting_point_lat)
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) TO authenticated;