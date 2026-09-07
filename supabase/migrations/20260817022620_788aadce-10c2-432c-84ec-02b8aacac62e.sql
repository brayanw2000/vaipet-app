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
