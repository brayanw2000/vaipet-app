-- FASE 4.1 — PATCH DE SEGURANÇA FINAL (HARDENING ABSOLUTO)
-- Hardened PIN system, Proximity and Multi-User Blocking

-- 1. Limpeza de assinaturas antigas
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);
DROP FUNCTION IF EXISTS public.petwalker_start_heading(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);

-- 2. customer_get_pickup_code: PIN Criptográfico (CSPRNG)
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

    -- Valida propriedade da sessão (Dono do Pet)
    SELECT * INTO _session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF _session_record.customer_id IS DISTINCT FROM _user_id THEN 
        RAISE EXCEPTION 'Acesso negado. Apenas o dono do pet pode ver o PIN.'; 
    END IF;

    -- Liberar PIN somente nos status: accepted, heading_to_pickup, arrived
    IF _session_record.current_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RAISE EXCEPTION 'PIN indisponível para este status: %', _session_record.current_status;
    END IF;

    -- Busca PIN existente e válido
    SELECT pin_hash INTO _pin 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id 
      AND expires_at > now()
      AND attempts < 5;

    -- Se não existir ou expirou, gera novo
    IF _pin IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.walk_pickup_codes WHERE session_id = _session_id AND attempts >= 5) THEN
            RAISE EXCEPTION 'PIN bloqueado devido a excesso de tentativas.';
        END IF;

        -- PIN de 6 dígitos usando CSPRNG (gen_random_bytes)
        -- Geramos 4 bytes, convertemos para inteiro e pegamos mod 1.000.000
        _crypto_bytes := gen_random_bytes(4);
        _crypto_int := (
            (get_byte(_crypto_bytes, 0) << 24) |
            (get_byte(_crypto_bytes, 1) << 16) |
            (get_byte(_crypto_bytes, 2) << 8) |
            (get_byte(_crypto_bytes, 3))
        ) & x'7FFFFFFF'::bigint; -- Garante positivo
        
        _pin := lpad((_crypto_int % 1000000)::text, 6, '0');
        
        INSERT INTO public.walk_pickup_codes (session_id, pin_hash)
        VALUES (_session_id, _pin)
        ON CONFLICT (session_id) DO UPDATE 
        SET pin_hash = EXCLUDED.pin_hash, 
            attempts = 0, 
            expires_at = (now() + interval '30 minutes'),
            created_at = now();
    END IF;

    RETURN _pin;
END;
$$;

-- 3. petwalker_start_heading: PetWalker inicia deslocamento (Validações Adicionais)
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF NOT public.has_role(_user_id, 'petwalker') THEN RAISE EXCEPTION 'Apenas PetWalkers podem iniciar deslocamento.'; END IF;

    UPDATE public.walk_sessions
    SET current_status = 'heading_to_pickup',
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = _user_id
      AND current_status = 'accepted';
      
    RETURN FOUND;
END;
$$;

-- 4. petwalker_arrive_pickup: Validação GPS Hardened + FOR UPDATE
CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(
    _session_id uuid,
    _lat double precision,
    _lng double precision,
    _accuracy double precision DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session_record record;
    _dist_meters float;
    _updated_rows integer;
BEGIN
    -- 1. Validações Básicas
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF NOT public.has_role(_user_id, 'petwalker') THEN RAISE EXCEPTION 'Acesso negado: Requer role petwalker.'; END IF;
    
    IF _lat IS NULL OR _lat < -90 OR _lat > 90 THEN RAISE EXCEPTION 'Latitude inválida.'; END IF;
    IF _lng IS NULL OR _lng < -180 OR _lng > 180 THEN RAISE EXCEPTION 'Longitude inválida.'; END IF;
    IF _accuracy IS NULL OR _accuracy < 0 OR _accuracy > 200 THEN RAISE EXCEPTION 'Precisão de GPS inválida ou insuficiente.'; END IF;

    -- 2. Lock e Validação de Estado
    SELECT * INTO _session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF _session_record.walker_id IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'Acesso negado: Walker incorreto.'; END IF;
    IF _session_record.current_status IS DISTINCT FROM 'heading_to_pickup' THEN
        RAISE EXCEPTION 'Status inválido para chegada. Atual: %', _session_record.current_status;
    END IF;

    -- 3. Proximidade
    IF _session_record.home_location IS NULL OR 
       (_session_record.home_location->>'lng') IS NULL OR 
       (_session_record.home_location->>'lat') IS NULL THEN
        RAISE EXCEPTION 'Localização de retirada não definida.';
    END IF;

    _dist_meters := ST_Distance(
        ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(
            (_session_record.home_location->>'lng')::double precision, 
            (_session_record.home_location->>'lat')::double precision
        ), 4326)::geography
    );

    IF _dist_meters > (150 + LEAST(_accuracy, 50)) THEN
        RAISE EXCEPTION 'Muito longe do local (dist: %m).', round(_dist_meters::numeric, 2);
    END IF;

    -- 4. Update Defensivo
    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    WHERE id = _session_id
      AND walker_id = _user_id
      AND current_status = 'heading_to_pickup';

    GET DIAGNOSTICS _updated_rows = ROW_COUNT;
    IF _updated_rows != 1 THEN RAISE EXCEPTION 'Falha na atualização de status: Concorrência detectada.'; END IF;

    RETURN TRUE;
END;
$$;

-- 5. petwalker_confirm_pickup: Hardened Multi-User Blocking + Lock Atômico
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(_session_id uuid, _pickup_code text)
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
    -- 1. Validação do Usuário e Formato
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF _pickup_code IS NULL OR _pickup_code !~ '^[0-9]{6}$' THEN
        RAISE EXCEPTION 'PIN inválido. Deve ter exatamente 6 números.';
    END IF;

    -- 2. Lock Atômico na Sessão (Bloqueia outros usuários)
    SELECT walker_id, current_status INTO _session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id 
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;

    -- 3. Validação de Ownership e Status (Antes de tocar no PIN)
    IF _session_record.walker_id IS DISTINCT FROM _user_id THEN 
        RAISE EXCEPTION 'Acesso negado: Walker incorreto.'; 
    END IF;
    
    IF _session_record.current_status IS DISTINCT FROM 'arrived' THEN
        RAISE EXCEPTION 'Status inválido. Requer arrived.';
    END IF;

    -- 4. Lock e Validação do PIN
    SELECT * INTO _code_record 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'PIN não gerado.'; END IF;
    IF _code_record.expires_at < now() THEN RAISE EXCEPTION 'PIN expirado.'; END IF;
    IF _code_record.attempts >= 5 THEN RAISE EXCEPTION 'PIN bloqueado: excesso de tentativas.'; END IF;

    -- 5. Verificação do PIN
    IF _code_record.pin_hash IS DISTINCT FROM _pickup_code THEN
        UPDATE public.walk_pickup_codes 
        SET attempts = attempts + 1 
        WHERE session_id = _session_id;
        RETURN FALSE;
    END IF;

    -- 6. Sucesso e Cleanup (Replay Protection)
    UPDATE public.walk_sessions
    SET current_status = 'in_progress',
        pickup_confirmed_at = now(),
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = _user_id 
      AND current_status = 'arrived';
    
    GET DIAGNOSTICS _updated_rows = ROW_COUNT;
    
    IF _updated_rows = 1 THEN
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- 6. RPC Access Control
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- 7. Permissões Service Role para Cleanup
GRANT ALL ON public.walk_pickup_codes TO service_role;
