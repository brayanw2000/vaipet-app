-- CORREÇÃO FINAL DE SCHEMA: walk_sessions utiliza customer_id
-- O erro "column user_id does not exist" ocorre porque em walk_sessions a coluna é customer_id.

CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _customer_id uuid;
    _pin text;
    _pin_hash text;
BEGIN
    -- 1. Validação de Ownership (Apenas o customer dono da sessão pode ver/gerar o PIN)
    SELECT customer_id INTO _customer_id 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF _customer_id IS NULL OR _customer_id <> auth.uid() THEN
        RAISE EXCEPTION 'Acesso negado: Você não é o proprietário desta sessão.';
    END IF;

    -- 2. Invalidar PIN anterior se existir para garantir que o retornado é o mais recente
    DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;

    -- 3. Gerar novo PIN 6 dígitos (Fallback seguro se gen_random_bytes falhar)
    BEGIN
        _pin := (abs(get_byte(gen_random_bytes(4), 0) << 24 | 
                     get_byte(gen_random_bytes(4), 1) << 16 | 
                     get_byte(gen_random_bytes(4), 2) << 8 | 
                     get_byte(gen_random_bytes(4), 3)) % 900000 + 100000)::text;
    EXCEPTION WHEN OTHERS THEN
        _pin := (floor(random() * 899999) + 100000)::text;
    END;

    -- 4. Salvar (Atomic Upsert)
    INSERT INTO public.walk_pickup_codes (session_id, pin_hash, expires_at)
    VALUES (_session_id, crypt(_pin, gen_salt('bf')), now() + interval '30 minutes')
    ON CONFLICT (session_id) DO UPDATE 
    SET pin_hash = EXCLUDED.pin_hash,
        attempts = 0,
        expires_at = EXCLUDED.expires_at;

    RETURN _pin;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;
GRANT ALL ON public.walk_pickup_codes TO service_role;

-- Recarregar cache
NOTIFY pgrst, 'reload schema';