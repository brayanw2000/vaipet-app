
-- Migration: Add mandatory expiry checks and defensive updates for walk lifecycle

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

    -- Bloquear sessão para aceite exclusivo (Defensivo)
    SELECT customer_id, matching_expires_at, current_status 
    INTO v_customer_id, v_matching_expires_at, v_current_status
    FROM public.walk_sessions
    WHERE id = _session_id
      AND current_status = 'searching'
      AND walker_id IS NULL
    FOR UPDATE;

    IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Sessão não disponível para aceite'; END IF;
    IF v_customer_id = v_walker_id THEN RAISE EXCEPTION 'Auto-aceite proibido'; END IF;
    
    -- Exigência estrita de expiração
    IF v_matching_expires_at IS NULL THEN RAISE EXCEPTION 'Sessão sem prazo de expiração definido'; END IF;
    IF v_matching_expires_at <= now() THEN RAISE EXCEPTION 'Prazo de aceite expirado'; END IF;

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
    WHERE id = _session_id
      AND current_status = 'searching'
      AND walker_id IS NULL;

    IF NOT FOUND THEN RAISE EXCEPTION 'Conflito de aceite: a sessão já foi assumida'; END IF;

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

-- 2. get_available_walk_offers
CREATE OR REPLACE FUNCTION public.get_available_walk_offers()
RETURNS TABLE (
  id uuid,
  session_id uuid,
  walker_id uuid,
  offer_status public.walk_offer_status,
  created_at timestamptz,
  pet_name text,
  pet_breed text,
  pet_avatar_url text,
  distance_meters float8,
  duration_minutes integer,
  total_price_cents integer,
  matching_expires_at timestamptz,
  request_mode text,
  scheduled_for timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _authenticated_user_id uuid;
  _walker_profile record;
  _has_role boolean;
BEGIN
  _authenticated_user_id := auth.uid();
  IF _authenticated_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = _authenticated_user_id 
    AND role = 'petwalker'
  ) INTO _has_role;

  IF NOT _has_role THEN
    RETURN;
  END IF;

  SELECT * INTO _walker_profile
  FROM public.petwalker_profiles
  WHERE user_id = _authenticated_user_id;

  IF _walker_profile.user_id IS NULL OR
     (_walker_profile.approval_status IS DISTINCT FROM 'approved') OR
     (_walker_profile.availability_status IS DISTINCT FROM 'available') OR
     (_walker_profile.is_accepting_requests IS NOT TRUE) OR
     (_walker_profile.current_walk_id IS NOT NULL) OR
     (_walker_profile.last_known_location IS NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    o.id,
    o.session_id,
    o.walker_id,
    o.offer_status,
    o.created_at,
    p.name as pet_name,
    p.breed as pet_breed,
    p.avatar_url as pet_avatar_url,
    st_distance(_walker_profile.last_known_location, s.meeting_point_geom) as distance_meters,
    s.planned_duration_minutes as duration_minutes,
    s.total_price_cents,
    s.matching_expires_at,
    s.request_mode::text,
    s.scheduled_for
  FROM public.walk_offers o
  JOIN public.walk_sessions s ON s.id = o.session_id
  JOIN public.pets p ON p.id = s.pet_id
  WHERE o.walker_id = _authenticated_user_id
    AND o.offer_status = 'pending'
    AND s.matching_expires_at IS NOT NULL 
    AND s.matching_expires_at > now()
    AND s.current_status = 'searching'
  ORDER BY 
    s.matching_expires_at ASC,
    st_distance(_walker_profile.last_known_location, s.meeting_point_geom) ASC,
    o.id ASC;
END;
$$;

-- Permissions Hardening
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_available_walk_offers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_available_walk_offers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO service_role;
