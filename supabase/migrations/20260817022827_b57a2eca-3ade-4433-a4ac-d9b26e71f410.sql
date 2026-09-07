-- 1. Ajuste na validação do PIN
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(_session_id uuid, _pickup_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _code_record record;
    _updated_rows integer;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF _pickup_code IS NULL OR length(_pickup_code) != 6 OR _pickup_code !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'PIN deve ter exatamente 6 dígitos numéricos.';
    END IF;

    -- Lock atômico na sessão
    PERFORM 1 FROM public.walk_sessions WHERE id = _session_id FOR UPDATE;

    -- Valida PIN
    SELECT * INTO _code_record 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'PIN não gerado.'; END IF;
    IF _code_record.expires_at < now() THEN RAISE EXCEPTION 'PIN expirado.'; END IF;
    IF _code_record.attempts >= 5 THEN RAISE EXCEPTION 'PIN bloqueado devido a excesso de tentativas.'; END IF;

    IF _code_record.pin_hash IS DISTINCT FROM _pickup_code THEN
        -- Incrementar attempts sem disparar exception fatal para persistir o UPDATE
        UPDATE public.walk_pickup_codes SET attempts = attempts + 1 WHERE session_id = _session_id;
        RETURN FALSE; -- Retorna false indicando PIN incorreto
    END IF;

    -- Sucesso: Transição de status defensiva
    UPDATE public.walk_sessions
    SET current_status = 'in_progress',
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = _user_id 
      AND current_status = 'arrived';
    
    GET DIAGNOSTICS _updated_rows = ROW_COUNT;
    
    IF _updated_rows = 1 THEN
        -- Deleta PIN após uso bem-sucedido (Replay Protection)
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- 2. Garantir permissões completas para o service_role para o cleanup E2E
GRANT ALL ON public.walk_pickup_codes TO service_role;
GRANT ALL ON public.petwalker_profiles TO service_role;
GRANT ALL ON public.pets TO service_role;
GRANT ALL ON public.walk_sessions TO service_role;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.user_roles TO service_role;
GRANT ALL ON public.walker_tracking TO service_role;
GRANT ALL ON public.walk_offers TO service_role;
GRANT ALL ON public.petwalker_earnings TO service_role;
