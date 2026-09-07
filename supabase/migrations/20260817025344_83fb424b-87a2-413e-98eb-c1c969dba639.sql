-- CORREÇÃO: PGCrypto gen_random_bytes
-- Substitui gen_random_bytes (que é pgcrypto) por uma alternativa nativa se pgcrypto não estiver disponível,
-- ou apenas ativa a extensão. No Lovable Cloud, pgcrypto geralmente está disponível.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid;
    _pin text;
    _pin_hash text;
BEGIN
    -- 1. Validação de Ownership (Apenas o dono do pet pode ver/gerar o PIN)
    SELECT user_id INTO _user_id 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF _user_id IS NULL OR _user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Acesso negado: Você não é o proprietário desta sessão.';
    END IF;

    -- 2. Tentar recuperar PIN existente se ainda for válido e não expirado
    SELECT pin_hash INTO _pin_hash 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id 
      AND expires_at > now()
      AND attempts < 5;

    IF _pin_hash IS NOT NULL THEN
        -- Retorna o PIN original se possível (não recomendado em sistemas bancários, mas prático aqui)
        -- Como salvamos apenas o HASH, precisamos gerar um novo se o usuário perdeu.
        -- Para simplificar: se o usuário pede o código, geramos um novo e invalidamos o anterior.
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
    END IF;

    -- 3. Gerar novo PIN 6 dígitos (CSPRNG)
    -- Se pgcrypto falhar, usamos um fallback baseado em random() mas tentamos pgcrypto primeiro
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