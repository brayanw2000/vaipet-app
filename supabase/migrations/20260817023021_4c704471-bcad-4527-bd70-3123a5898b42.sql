-- PHASE 4.1 — UNIFICAÇÃO FINAL DE RPCs (CORRIGIDO)

-- 1. Limpeza rigorosa
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);
DROP FUNCTION IF EXISTS public.petwalker_start_heading(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);
DROP FUNCTION IF EXISTS public.petwalker_start_walk(uuid);

-- 2. customer_get_pickup_code
CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code text;
    v_customer_id uuid;
    v_status text;
BEGIN
    SELECT customer_id, current_status INTO v_customer_id, v_status
    FROM public.walk_sessions
    WHERE id = _session_id;

    IF v_customer_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Acesso negado. Apenas o dono do pet pode ver o PIN.';
    END IF;

    IF v_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RAISE EXCEPTION 'PIN indisponível para este status: %', v_status;
    END IF;

    SELECT pickup_code INTO v_code 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id AND expires_at > now() AND attempts < 5;

    IF v_code IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.walk_pickup_codes WHERE session_id = _session_id AND attempts >= 5) THEN
            RAISE EXCEPTION 'PIN bloqueado devido a excesso de tentativas.';
        END IF;

        v_code := lpad(floor(random() * 1000000)::text, 6, '0');
        
        INSERT INTO public.walk_pickup_codes (session_id, pickup_code, expires_at, attempts)
        VALUES (_session_id, v_code, now() + interval '30 minutes', 0)
        ON CONFLICT (session_id) DO UPDATE 
        SET pickup_code = EXCLUDED.pickup_code, 
            attempts = 0, 
            expires_at = EXCLUDED.expires_at;
    END IF;

    RETURN v_code;
END;
$$;

-- 3. petwalker_start_heading
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    
    UPDATE public.walk_sessions
    SET current_status = 'heading_to_pickup',
        status = 'heading_to_pickup',
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = v_user_id
      AND current_status = 'accepted';
      
    RETURN FOUND;
END;
$$;

-- 4. petwalker_arrive_pickup
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
    v_user_id uuid := auth.uid();
    v_session_record record;
    v_dist_meters float;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF _lat IS NULL OR _lng IS NULL OR _lat = 0 OR _lng = 0 THEN RAISE EXCEPTION 'Coordenadas GPS inválidas.'; END IF;
    IF _accuracy IS NULL OR _accuracy > 200 THEN RAISE EXCEPTION 'Precisão de GPS insuficiente para chegada.'; END IF;

    SELECT * INTO v_session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF v_session_record.walker_id IS DISTINCT FROM v_user_id THEN 
        RAISE EXCEPTION 'Acesso negado.'; 
    END IF;
    
    IF v_session_record.current_status IS DISTINCT FROM 'heading_to_pickup' THEN
        RAISE EXCEPTION 'Status inválido para chegada. Atual: %', v_session_record.current_status;
    END IF;

    IF v_session_record.home_location IS NULL OR 
       (v_session_record.home_location->>'lng') IS NULL OR 
       (v_session_record.home_location->>'lat') IS NULL THEN
        RAISE EXCEPTION 'Localização de retirada não definida na sessão.';
    END IF;

    v_dist_meters := ST_Distance(
        ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(
            (v_session_record.home_location->>'lng')::double precision, 
            (v_session_record.home_location->>'lat')::double precision
        ), 4326)::geography
    );

    IF v_dist_meters > (150 + LEAST(_accuracy, 50)) THEN
        RAISE EXCEPTION 'Você está muito longe do local de retirada (dist: %m).', round(v_dist_meters::numeric, 2);
    END IF;

    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    WHERE id = _session_id;

    RETURN TRUE;
END;
$$;

-- 5. petwalker_confirm_pickup
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(_session_id uuid, _pickup_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_code_record record;
    v_updated_rows integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF _pickup_code IS NULL OR length(_pickup_code) != 6 OR _pickup_code !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'PIN deve ter exatamente 6 dígitos numéricos.';
    END IF;

    PERFORM 1 FROM public.walk_sessions WHERE id = _session_id FOR UPDATE;

    SELECT * INTO v_code_record 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'PIN não gerado.'; END IF;
    IF v_code_record.expires_at < now() THEN RAISE EXCEPTION 'PIN expirado.'; END IF;
    IF v_code_record.attempts >= 5 THEN RAISE EXCEPTION 'PIN bloqueado devido a excesso de tentativas.'; END IF;

    IF v_code_record.pickup_code IS DISTINCT FROM _pickup_code THEN
        UPDATE public.walk_pickup_codes SET attempts = attempts + 1 WHERE session_id = _session_id;
        RETURN FALSE;
    END IF;

    UPDATE public.walk_sessions
    SET current_status = 'in_progress',
        status = 'in_progress',
        pickup_confirmed_at = now(),
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = v_user_id 
      AND current_status = 'arrived';
    
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    
    IF v_updated_rows = 1 THEN
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- 6. Access Control
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- 7. Grant extra for service_role in E2E tables
GRANT ALL ON TABLE public.walk_pickup_codes TO service_role;
GRANT ALL ON TABLE public.walk_sessions TO service_role;
GRANT ALL ON TABLE public.pets TO service_role;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.user_roles TO service_role;
GRANT ALL ON TABLE public.petwalker_profiles TO service_role;
