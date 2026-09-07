-- migration 20260817035600: Fix RPC function parameter naming and search path

-- customer_get_pickup_code
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);
CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_auth_uid uuid := auth.uid();
    v_customer_id uuid;
    v_status public.walk_status;
    v_pin text;
    v_crypto_bytes bytea;
    v_crypto_int bigint;
BEGIN
    IF v_auth_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    
    SELECT customer_id, current_status INTO v_customer_id, v_status
    FROM public.walk_sessions WHERE id = _session_id FOR UPDATE;
    
    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF v_customer_id IS DISTINCT FROM v_auth_uid THEN 
        RAISE EXCEPTION 'Acesso negado.'; 
    END IF;
    
    IF v_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RAISE EXCEPTION 'PIN indisponível para este status.';
    END IF;

    SELECT pin_code INTO v_pin 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id 
      AND expires_at > now()
      AND attempts < 5 FOR UPDATE;

    IF v_pin IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.walk_pickup_codes WHERE session_id = _session_id AND attempts >= 5) THEN
            RAISE EXCEPTION 'PIN bloqueado por segurança.';
        END IF;

        v_crypto_bytes := extensions.gen_random_bytes(4);
        v_crypto_int := (
            (get_byte(v_crypto_bytes, 0) << 24) |
            (get_byte(v_crypto_bytes, 1) << 16) |
            (get_byte(v_crypto_bytes, 2) << 8) |
            (get_byte(v_crypto_bytes, 3))
        ) & x'7FFFFFFF'::bigint;
        
        v_pin := lpad((v_crypto_int % 1000000)::text, 6, '0');
        
        INSERT INTO public.walk_pickup_codes (session_id, pin_code, expires_at, attempts)
        VALUES (_session_id, v_pin, now() + interval '30 minutes', 0)
        ON CONFLICT (session_id) DO UPDATE 
        SET pin_code = EXCLUDED.pin_code, 
            attempts = 0, 
            expires_at = EXCLUDED.expires_at;
    END IF;

    RETURN v_pin;
END;
$$;

-- petwalker_confirm_pickup
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(walk_id uuid, input_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_auth_uid uuid := auth.uid();
    v_assigned_walker_id uuid;
    v_current_status public.walk_status;
    v_correct_pin text;
    v_attempts int;
    v_expires_at timestamptz;
    v_updated_rows integer;
BEGIN
    IF v_auth_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    
    IF input_pin IS NULL OR input_pin !~ '^[0-9]{6}$' THEN 
        RAISE EXCEPTION 'Formato de PIN inválido.'; 
    END IF;

    SELECT walker_id, current_status 
    INTO v_assigned_walker_id, v_current_status
    FROM public.walk_sessions
    WHERE id = walk_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    
    IF v_assigned_walker_id IS DISTINCT FROM v_auth_uid THEN
        RAISE EXCEPTION 'Acesso negado: você não é o Walker designado para este passeio.';
    END IF;

    IF v_current_status IS DISTINCT FROM 'arrived' THEN
        RAISE EXCEPTION 'Passeio não está em estado de retirada (arrived).';
    END IF;

    SELECT pin_code, attempts, expires_at
    INTO v_correct_pin, v_attempts, v_expires_at
    FROM public.walk_pickup_codes
    WHERE session_id = walk_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'PIN não gerado ou inexistente.'; END IF;

    IF v_expires_at < now() THEN
        RAISE EXCEPTION 'PIN expirado.';
    END IF;

    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Bloqueio de segurança: limite de tentativas excedido.';
    END IF;

    IF v_correct_pin = input_pin THEN
        UPDATE public.walk_sessions
        SET 
            status = 'in_progress',
            current_status = 'in_progress',
            start_time = now(),
            pickup_confirmed_at = now(),
            updated_at = now()
        WHERE id = walk_id 
          AND walker_id = v_auth_uid 
          AND current_status = 'arrived';

        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
        
        IF v_updated_rows = 1 THEN
            DELETE FROM public.walk_pickup_codes WHERE session_id = walk_id;
            RETURN TRUE;
        ELSE
            RAISE EXCEPTION 'Falha atômica ao atualizar status do passeio.';
        END IF;
    ELSE
        UPDATE public.walk_pickup_codes
        SET attempts = attempts + 1
        WHERE session_id = walk_id;
        
        RETURN FALSE;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
