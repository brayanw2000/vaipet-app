-- Unificar nomes de colunas
DO $$ 
BEGIN 
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_pickup_codes' AND column_name='pickup_code') THEN
    ALTER TABLE public.walk_pickup_codes RENAME COLUMN pickup_code TO pin_hash;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_pickup_codes' AND column_name='pin_hash') THEN
    ALTER TABLE public.walk_pickup_codes ADD COLUMN pin_hash text;
  END IF;
END $$;

-- Recriar RPCs
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);

CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session_record record;
    _pin text;
    _crypto_bytes bytea;
    _crypto_int bigint;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    SELECT customer_id, current_status INTO _session_record FROM public.walk_sessions WHERE id = _session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF _session_record.customer_id IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'Acesso negado.'; END IF;
    IF _session_record.current_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RAISE EXCEPTION 'PIN indisponível para este status.';
    END IF;

    SELECT pin_hash INTO _pin FROM public.walk_pickup_codes WHERE session_id = _session_id AND expires_at > now() AND attempts < 5;

    IF _pin IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.walk_pickup_codes WHERE session_id = _session_id AND attempts >= 5) THEN
            RAISE EXCEPTION 'PIN bloqueado.';
        END IF;
        _crypto_bytes := gen_random_bytes(4);
        _crypto_int := ((get_byte(_crypto_bytes, 0) << 24) | (get_byte(_crypto_bytes, 1) << 16) | (get_byte(_crypto_bytes, 2) << 8) | (get_byte(_byte(_crypto_bytes, 3)))) & x'7FFFFFFF'::bigint;
        _pin := lpad((_crypto_int % 1000000)::text, 6, '0');
        INSERT INTO public.walk_pickup_codes (session_id, pin_hash, expires_at, attempts) VALUES (_session_id, _pin, now() + interval '30 minutes', 0) ON CONFLICT (session_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, attempts = 0, expires_at = EXCLUDED.expires_at;
    END IF;
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
    _user_id uuid := auth.uid();
    _session_record record;
    _code_record record;
    _updated_rows integer;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF _pin IS NULL OR _pin !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'PIN inválido.'; END IF;

    SELECT walker_id, current_status INTO _session_record FROM public.walk_sessions WHERE id = _session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF _session_record.walker_id IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'Acesso negado.'; END IF;
    IF _session_record.current_status IS DISTINCT FROM 'arrived' THEN RAISE EXCEPTION 'Status inválido.'; END IF;

    SELECT pin_hash, attempts, expires_at INTO _code_record FROM public.walk_pickup_codes WHERE session_id = _session_id FOR UPDATE;
    IF NOT FOUND OR _code_record.expires_at < now() THEN RAISE EXCEPTION 'PIN inválido ou expirado.'; END IF;
    IF _code_record.attempts >= 5 THEN RAISE EXCEPTION 'PIN bloqueado.'; END IF;

    IF _code_record.pin_hash IS DISTINCT FROM _pin THEN
        UPDATE public.walk_pickup_codes SET attempts = attempts + 1 WHERE session_id = _session_id;
        RETURN FALSE;
    END IF;

    UPDATE public.walk_sessions SET current_status = 'in_progress', status = 'in_progress', pickup_confirmed_at = now(), start_time = now(), updated_at = now() WHERE id = _session_id AND walker_id = _user_id AND current_status = 'arrived';
    GET DIAGNOSTICS _updated_rows = ROW_COUNT;
    IF _updated_rows = 1 THEN
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
        RETURN TRUE;
    END IF;
    RETURN FALSE;
END;
$$;

-- ACL
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;
