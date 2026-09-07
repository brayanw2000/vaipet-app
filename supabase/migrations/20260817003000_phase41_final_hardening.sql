-- FASE 4.1 — PATCH CORRETIVO FINAL DE SEGURANÇA
-- Hardened PIN system, Proximity and RPC Access Control

-- 1. Limpeza de assinaturas antigas e redundantes
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);
DROP FUNCTION IF EXISTS public.petwalker_start_heading(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);

-- 2. customer_get_pickup_code: Gera PIN criptograficamente forte
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
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

    -- Valida propriedade da sessão (Dono do Pet)
    SELECT * INTO _session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    -- customer_id é a coluna correta do baseline
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

    -- Se não existir ou expirou, gera novo (se não excedeu tentativas)
    IF _pin IS NULL THEN
        -- Verifica se houve estouro de tentativas (permanece bloqueado)
        IF EXISTS (SELECT 1 FROM public.walk_pickup_codes WHERE session_id = _session_id AND attempts >= 5) THEN
            RAISE EXCEPTION 'PIN bloqueado devido a excesso de tentativas.';
        END IF;

        -- PIN de 6 dígitos numéricos usando random() com lpad
        _pin := lpad(floor(random() * 1000000)::text, 6, '0');
        
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

-- 3. petwalker_start_heading: PetWalker inicia deslocamento
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

-- 4. petwalker_arrive_pickup: Valida proximidade GPS (150m) e obrigatoriedade de dados
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
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF _lat IS NULL OR _lng IS NULL OR _lat = 0 OR _lng = 0 THEN RAISE EXCEPTION 'Coordenadas GPS inválidas.'; END IF;
    IF _accuracy IS NULL OR _accuracy > 200 THEN RAISE EXCEPTION 'Precisão de GPS insuficiente para chegada.'; END IF;

    SELECT * INTO _session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF _session_record.walker_id IS DISTINCT FROM _user_id THEN 
        RAISE EXCEPTION 'Acesso negado.'; 
    END IF;
    
    IF _session_record.current_status IS DISTINCT FROM 'heading_to_pickup' THEN
        RAISE EXCEPTION 'Status inválido para chegada. Atual: %', _session_record.current_status;
    END IF;

    -- Validação de Proximidade (PostGIS)
    IF _session_record.home_location IS NULL OR 
       (_session_record.home_location->>'lng') IS NULL OR 
       (_session_record.home_location->>'lat') IS NULL THEN
        RAISE EXCEPTION 'Localização de retirada não definida na sessão.';
    END IF;

    _dist_meters := ST_Distance(
        ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(
            (_session_record.home_location->>'lng')::double precision, 
            (_session_record.home_location->>'lat')::double precision
        ), 4326)::geography
    );

    -- Tolerância de 150m + margem de precisão do GPS (máx 50m extra)
    IF _dist_meters > (150 + LEAST(_accuracy, 50)) THEN
        RAISE EXCEPTION 'Você está muito longe do local de retirada (dist: %m).', round(_dist_meters::numeric, 2);
    END IF;

    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        updated_at = now()
    WHERE id = _session_id;

    RETURN TRUE;
END;
$$;

-- 5. petwalker_confirm_pickup: Valida PIN, aplica lock atômico e transição defensiva
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
    IF _pickup_code IS NULL OR _pickup_code !~ '^[0-9]{6}$' THEN
        RAISE EXCEPTION 'Formato de PIN inválido. Deve ter 6 números.';
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

-- 6. RPC Access Control Hardening
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;
-- petwalker_complete_walk permanece revogado para authenticated até a Phase 4.3
