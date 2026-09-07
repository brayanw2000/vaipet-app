-- Migration 20260813200000: Estabilização Final Fase 3.1
-- Redefinição canônica das RPCs com Zero-Trust e autoridade financeira do banco.

-- 1. accept_walk_request
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid := auth.uid();
    v_customer_id uuid;
    v_offer_id uuid;
    v_matching_expires_at timestamptz;
    v_current_status public.walk_status;
BEGIN
    -- Autenticação básica
    IF v_walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    -- Validar role e perfil (FOR UPDATE para consistência)
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = v_walker_id AND role = 'petwalker'
    ) THEN RAISE EXCEPTION 'Usuário não é um PetWalker'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_walker_id 
          AND approval_status = 'approved' 
          AND availability_status = 'available'
          AND is_accepting_requests = true
          AND current_walk_id IS NULL
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'PetWalker indisponível, não aprovado ou já em serviço'; END IF;

    -- Bloquear sessão para aceite exclusivo
    SELECT customer_id, matching_expires_at, current_status 
    INTO v_customer_id, v_matching_expires_at, v_current_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Sessão não encontrada'; END IF;
    IF v_customer_id = v_walker_id THEN RAISE EXCEPTION 'Auto-aceite proibido'; END IF;
    IF v_current_status != 'searching' THEN RAISE EXCEPTION 'Sessão não está em busca'; END IF;
    IF v_matching_expires_at IS NOT NULL AND v_matching_expires_at < now() THEN RAISE EXCEPTION 'Prazo de aceite expirado'; END IF;

    -- Validar oferta (FOR UPDATE)
    SELECT id INTO v_offer_id
    FROM public.walk_offers
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending'
    FOR UPDATE;

    IF v_offer_id IS NULL THEN RAISE EXCEPTION 'Oferta não encontrada, recusada ou expirada'; END IF;

    -- Execução Atômica
    UPDATE public.walk_sessions
    SET walker_id = v_walker_id,
        current_status = 'accepted',
        petwalker_notified_at = now(),
        updated_at = now()
    WHERE id = _session_id;

    UPDATE public.walk_offers SET offer_status = 'accepted', updated_at = now() WHERE id = v_offer_id;
    UPDATE public.walk_offers SET offer_status = 'expired', updated_at = now() WHERE session_id = _session_id AND id <> v_offer_id AND offer_status = 'pending';
    
    UPDATE public.petwalker_profiles 
    SET current_walk_id = _session_id, 
        availability_status = 'busy',
        updated_at = now()
    WHERE user_id = v_walker_id;

    RETURN true;
END;
$$;

-- 2. decline_walk_offer
CREATE OR REPLACE FUNCTION public.decline_walk_offer(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid := auth.uid();
BEGIN
    IF v_walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    UPDATE public.walk_offers
    SET offer_status = 'declined',
        updated_at = now()
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending';

    RETURN FOUND;
END;
$$;

-- 3. create_walk_request
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
    _matching_expires_at timestamptz := NULL;
    _current_status public.walk_status;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    -- Validações básicas
    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = _user_id) THEN
        RAISE EXCEPTION 'Pet inválido ou não pertence ao usuário';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.walk_sessions 
        WHERE pet_id = _pet_id AND current_status NOT IN ('completed', 'cancelled', 'expired')
    ) THEN RAISE EXCEPTION 'Passeio ativo já existe para este pet'; END IF;

    IF _duration_minutes < 15 OR _duration_minutes % 15 != 0 THEN
        RAISE EXCEPTION 'Duração deve ser mínima de 15 min e múltipla de 15';
    END IF;

    IF _meeting_point_lat NOT BETWEEN -90 AND 90 OR _meeting_point_lng NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'Coordenadas geográficas inválidas';
    END IF;

    IF _meeting_point_address IS NULL OR length(_meeting_point_address) < 5 THEN
        RAISE EXCEPTION 'Endereço de encontro inválido';
    END IF;

    -- Validar se há configuração de preço ativa
    IF NOT EXISTS (SELECT 1 FROM public.walk_pricing_settings WHERE is_active = true) THEN
        RAISE EXCEPTION 'Nenhuma configuração de preço ativa no sistema';
    END IF;

    -- Lógica de status e matching
    IF _request_mode = 'now' THEN
        IF _scheduled_for IS NOT NULL THEN RAISE EXCEPTION 'Modo "now" não permite agendamento'; END IF;
        _current_status := 'searching';
        _matching_expires_at := now() + interval '10 minutes';
    ELSE
        IF _scheduled_for IS NULL OR _scheduled_for <= now() THEN
            RAISE EXCEPTION 'Agendamento requer horário futuro';
        END IF;
        _current_status := 'scheduled';
    END IF;

    -- Inserção sem campos monetários (trigger financial cuida disso)
    INSERT INTO public.walk_sessions (
        customer_id, pet_id, planned_duration_minutes, current_status, walk_type, 
        request_mode, scheduled_for, search_started_at, matching_expires_at,
        meeting_point_geom, meeting_point_address
    ) VALUES (
        _user_id, _pet_id, _duration_minutes, _current_status, 'livre', 
        _request_mode, _scheduled_for, 
        CASE WHEN _request_mode = 'now' THEN now() ELSE NULL END,
        _matching_expires_at,
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

-- 4. petwalker_complete_walk
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(
    _session_id uuid,
    _final_trail jsonb DEFAULT NULL,
    _final_distance_km double precision DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _start_time timestamptz;
    _actual_min integer;
BEGIN
    SELECT start_time INTO _start_time FROM public.walk_sessions 
    WHERE id = _session_id AND walker_id = _walker_id AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN RETURN false; END IF;

    _actual_min := EXTRACT(EPOCH FROM (now() - _start_time))/60;

    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        end_time = now(),
        actual_duration_minutes = _actual_min,
        route_coordinates = COALESCE(_final_trail, route_coordinates),
        distance_km = COALESCE(_final_distance_km, distance_km),
        updated_at = now()
    WHERE id = _session_id;
    
    UPDATE public.petwalker_profiles 
    SET current_walk_id = NULL, 
        availability_status = 'available',
        completed_walks = completed_walks + 1,
        updated_at = now()
    WHERE user_id = _walker_id;

    RETURN true;
END;
$$;

-- Revokes e Grants
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.decline_walk_offer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_walk_offer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.decline_walk_offer(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid, jsonb, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid, jsonb, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid, jsonb, double precision) TO authenticated, service_role;
