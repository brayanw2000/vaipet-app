-- migration 20260817035000: Hardened Phase 4.1 Security Audit Corrective Patch

-- 1. Sincronização de Schema
DO $$ 
BEGIN 
  -- Garantir que a coluna pin_code seja a oficial em walk_pickup_codes
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_pickup_codes' AND column_name='pin_hash') THEN
    ALTER TABLE public.walk_pickup_codes RENAME COLUMN pin_hash TO pin_code;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_pickup_codes' AND column_name='pin_code') THEN
    ALTER TABLE public.walk_pickup_codes ADD COLUMN pin_code text;
  END IF;

  -- Garantir pickup_confirmed_at na walk_sessions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_sessions' AND column_name='pickup_confirmed_at') THEN
    ALTER TABLE public.walk_sessions ADD COLUMN pickup_confirmed_at timestamptz;
  END IF;
END $$;

-- 2. customer_get_pickup_code: CSPRNG e Idempotência Rigorosa
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);
CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    
    -- Trava e validação de propriedade
    SELECT customer_id, current_status INTO v_customer_id, v_status
    FROM public.walk_sessions WHERE id = _session_id FOR UPDATE;
    
    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF v_customer_id IS DISTINCT FROM v_auth_uid THEN 
        RAISE EXCEPTION 'Acesso negado.'; 
    END IF;
    
    IF v_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RAISE EXCEPTION 'PIN indisponível para este status.';
    END IF;

    -- Tentar obter PIN vigente
    SELECT pin_code INTO v_pin 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id 
      AND expires_at > now()
      AND attempts < 5 FOR UPDATE;

    IF v_pin IS NULL THEN
        -- Verificar se está bloqueado por excesso de tentativas
        IF EXISTS (SELECT 1 FROM public.walk_pickup_codes WHERE session_id = _session_id AND attempts >= 5) THEN
            RAISE EXCEPTION 'PIN bloqueado por segurança.';
        END IF;

        -- Geração CSPRNG Real
        v_crypto_bytes := gen_random_bytes(4);
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

-- 3. petwalker_confirm_pickup: Validação de Identidade Designada e Trava Atômica
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(walk_id uuid, input_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    
    -- Validação de Input (Regex 6 dígitos)
    IF input_pin IS NULL OR input_pin !~ '^[0-9]{6}$' THEN 
        RAISE EXCEPTION 'Formato de PIN inválido.'; 
    END IF;

    -- 1. Travar walk_sessions e validar walker designado
    SELECT walker_id, current_status 
    INTO v_assigned_walker_id, v_current_status
    FROM public.walk_sessions
    WHERE id = walk_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    
    -- SEGURANÇA CRÍTICA: Validar se o usuário logado é EXATAMENTE o Walker atribuído
    IF v_assigned_walker_id IS DISTINCT FROM v_auth_uid THEN
        RAISE EXCEPTION 'Acesso negado: você não é o Walker designado para este passeio.';
    END IF;

    -- SEGURANÇA CRÍTICA: Exigir status arrived
    IF v_current_status IS DISTINCT FROM 'arrived' THEN
        RAISE EXCEPTION 'Passeio não está em estado de retirada (arrived).';
    END IF;

    -- 2. Travar walk_pickup_codes
    SELECT pin_code, attempts, expires_at
    INTO v_correct_pin, v_attempts, v_expires_at
    FROM public.walk_pickup_codes
    WHERE session_id = walk_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'PIN não gerado ou inexistente.'; END IF;

    -- Validação de Expiração
    IF v_expires_at < now() THEN
        RAISE EXCEPTION 'PIN expirado.';
    END IF;

    -- Validação de Tentativas
    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Bloqueio de segurança: limite de tentativas excedido.';
    END IF;

    -- Comparação de PIN
    IF v_correct_pin = input_pin THEN
        -- SUCESSO: Update Defensivo com Walker_ID e Status
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
            -- Deletar PIN somente após sucesso do UPDATE
            DELETE FROM public.walk_pickup_codes WHERE session_id = walk_id;
            RETURN TRUE;
        ELSE
            RAISE EXCEPTION 'Falha atômica ao atualizar status do passeio.';
        END IF;
    ELSE
        -- ERRO: Incrementar tentativas
        UPDATE public.walk_pickup_codes
        SET attempts = attempts + 1
        WHERE session_id = walk_id;
        
        RETURN FALSE;
    END IF;
END;
$$;

-- 4. ACL e Restrições de Acesso
REVOKE ALL ON public.walk_pickup_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.walk_pickup_codes TO service_role;

REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- Grants para outras RPCs operacionais (identificadas via pg_proc)
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
