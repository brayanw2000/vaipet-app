
-- Redefinição canônica de accept_walk_request sem dependência de coluna inexistente em walk_offers

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

    -- Bloquear sessão para aceite exclusivo. Usamos matching_expires_at da walk_sessions
    SELECT customer_id, matching_expires_at, current_status 
    INTO v_customer_id, v_matching_expires_at, v_current_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Sessão não encontrada'; END IF;
    IF v_customer_id = v_walker_id THEN RAISE EXCEPTION 'Auto-aceite proibido'; END IF;
    IF v_current_status != 'searching' THEN RAISE EXCEPTION 'Sessão não está em busca'; END IF;
    IF v_matching_expires_at IS NOT NULL AND v_matching_expires_at < now() THEN RAISE EXCEPTION 'Prazo de aceite expirado'; END IF;

    -- Validar oferta (FOR UPDATE). walk_offers não possui matching_expires_at no schema atual.
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
