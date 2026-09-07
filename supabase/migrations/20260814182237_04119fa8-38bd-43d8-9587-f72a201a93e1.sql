
-- Migration aditiva para corrigir segurança e assinatura da RPC get_available_walk_offers
-- Timestamp superior a 20260814181116
-- Referência: Auditoria de segurança e elegibilidade Fase 3.1

-- 1. Garante que a função anterior seja removida para evitar conflitos de assinatura ou permissões residuais
DROP FUNCTION IF EXISTS public.get_available_walk_offers();

-- 2. Recria com validações de elegibilidade e segurança endurecidas
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
BEGIN
  -- Rejeitar anônimo explicitamente (SQLSTATE 42501: insufficient_privilege)
  _authenticated_user_id := auth.uid();
  IF _authenticated_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  -- 3. Validar se o usuário é um PetWalker aprovado e disponível
  SELECT * INTO _walker_profile
  FROM public.petwalker_profiles
  WHERE user_id = _authenticated_user_id;

  -- Validações de elegibilidade do PetWalker
  IF _walker_profile.user_id IS NULL THEN
    RETURN; -- Não é um walker
  END IF;

  IF _walker_profile.approval_status != 'approved' OR
     _walker_profile.availability_status != 'available' OR
     _walker_profile.is_accepting_requests = false OR
     _walker_profile.current_walk_id IS NOT NULL OR
     _walker_profile.last_known_location IS NULL THEN
    RETURN; -- Walker inelegível no momento
  END IF;

  -- 4. Retornar ofertas específicas para este Walker
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
    st_distance(_walker_profile.last_known_location, s.start_location) as distance_meters,
    s.duration_minutes,
    s.total_price_cents,
    o.matching_expires_at,
    s.request_mode,
    s.scheduled_for
  FROM public.walk_offers o
  JOIN public.walk_sessions s ON s.id = o.session_id
  JOIN public.pets p ON p.id = s.pet_id
  WHERE o.walker_id = _authenticated_user_id
    AND o.offer_status = 'pending'
    AND o.matching_expires_at > now()
    AND s.current_status = 'searching'
  ORDER BY 
    o.matching_expires_at ASC,
    st_distance(_walker_profile.last_known_location, s.start_location) ASC,
    o.created_at ASC,
    o.id ASC; -- Desempate estável
END;
$$;

-- 5. Revogações e permissões explícitas
REVOKE ALL ON FUNCTION public.get_available_walk_offers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_available_walk_offers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO service_role;
