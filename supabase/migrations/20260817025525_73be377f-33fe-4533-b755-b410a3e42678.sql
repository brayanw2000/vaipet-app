-- CORREÇÃO: Limpeza e Redefinição de Funções para Compatibilidade
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);

CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _customer_id uuid;
    _pin text;
BEGIN
    SELECT customer_id INTO _customer_id 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF _customer_id IS NULL OR _customer_id <> auth.uid() THEN
        RAISE EXCEPTION 'Acesso negado: Você não é o proprietário desta sessão.';
    END IF;

    DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;

    _pin := (floor(random() * 899999) + 100000)::text;

    -- Usamos MD5 nativo como baseline universal de segurança no Postgres sem extensões
    INSERT INTO public.walk_pickup_codes (session_id, pin_hash, expires_at)
    VALUES (_session_id, md5(_pin || _session_id::text), now() + interval '30 minutes')
    ON CONFLICT (session_id) DO UPDATE 
    SET pin_hash = EXCLUDED.pin_hash,
        attempts = 0,
        expires_at = EXCLUDED.expires_at;

    RETURN _pin;
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(_session_id uuid, _pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid;
    _stored_hash text;
    _attempts integer;
    _expires_at timestamp with time zone;
BEGIN
    SELECT pin_hash, attempts, expires_at INTO _stored_hash, _attempts, _expires_at
    FROM public.walk_pickup_codes
    WHERE session_id = _session_id
    FOR UPDATE;

    IF _stored_hash IS NULL THEN
        RAISE EXCEPTION 'Código de retirada não gerado para esta sessão.';
    END IF;

    IF _expires_at < now() THEN
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
        RAISE EXCEPTION 'Código de retirada expirado.';
    END IF;

    IF _attempts >= 5 THEN
        RAISE EXCEPTION 'Limite de tentativas excedido. Solicite um novo código ao cliente.';
    END IF;

    SELECT walker_id INTO _walker_id FROM public.walk_sessions WHERE id = _session_id;
    IF _walker_id <> auth.uid() THEN
        RAISE EXCEPTION 'Acesso negado: Você não é o walker designado para este passeio.';
    END IF;

    IF _stored_hash = md5(_pin || _session_id::text) THEN
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
        
        UPDATE public.walk_sessions 
        SET status = 'in_progress', 
            updated_at = now() 
        WHERE id = _session_id;
        
        RETURN true;
    ELSE
        UPDATE public.walk_pickup_codes 
        SET attempts = attempts + 1 
        WHERE session_id = _session_id;
        
        RETURN false;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- Recarregar cache
NOTIFY pgrst, 'reload schema';