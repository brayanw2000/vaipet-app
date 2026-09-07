-- PHASE 4.2 PATCH 1B — RECONCILIAÇÃO FINAL DE AUTORIDADE GPS
-- Timestamp: 20260818030000

-- 1. ELIMINAR OVERLOAD INSEGURO
DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, double precision[]);

-- 2. ESTABELECER ASSINATURA CANÔNICA SEGURA PARA append_walk_tracking_point
CREATE OR REPLACE FUNCTION public.append_walk_tracking_point(_session_id uuid, _point jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _current_trail jsonb;
    _last_tracking timestamptz;
    _lng double precision;
    _lat double precision;
BEGIN
    IF _walker_id IS NULL THEN 
        RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; 
    END IF;

    -- Estrutura do ponto: [lng, lat]
    IF _point IS NULL
       OR jsonb_typeof(_point) <> 'array'
       OR jsonb_array_length(_point) <> 2 THEN
        RAISE EXCEPTION 'Ponto inválido: deve ser [longitude, latitude]';
    END IF;

    -- Somente números JSON reais
    IF jsonb_typeof(_point->0) <> 'number' OR jsonb_typeof(_point->1) <> 'number' THEN
        RAISE EXCEPTION 'Coordenadas devem ser números JSON';
    END IF;

    _lng := (_point->>0)::double precision;
    _lat := (_point->>1)::double precision;

    -- Limites geográficos
    IF _lng NOT BETWEEN -180 AND 180 OR _lat NOT BETWEEN -90 AND 90 THEN
        RAISE EXCEPTION 'Coordenadas fora dos limites geográficos';
    END IF;

    -- Propriedade + estado + lock (FOR UPDATE)
    SELECT route_coordinates, last_tracking_at
      INTO _current_trail, _last_tracking
    FROM public.walk_sessions
    WHERE id = _session_id
      AND walker_id = _walker_id
      AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sessão inválida, não pertence ao walker ou status não permite tracking' USING ERRCODE = '42501';
    END IF;

    -- Controle de frequência (5s por sessão)
    IF _last_tracking IS NOT NULL AND (now() - _last_tracking) < interval '5 seconds' THEN
        RETURN false;
    END IF;

    -- Limite de pontos para evitar estouro de JSONB
    IF _current_trail IS NULL OR jsonb_typeof(_current_trail) <> 'array' THEN
        _current_trail := '[]'::jsonb;
    END IF;

    IF jsonb_array_length(_current_trail) >= 5000 THEN
        RAISE EXCEPTION 'Limite de 5.000 pontos atingido para esta sessão';
    END IF;

    UPDATE public.walk_sessions
    SET route_coordinates = _current_trail || jsonb_build_array(jsonb_build_array(_lng, _lat)),
        last_tracking_at = now(),
        updated_at = now()
    WHERE id = _session_id;

    RETURN true;
END;
$$;

-- 3. HARDEN update_walker_location (VERSÃO CANÔNICA FINAL)
CREATE OR REPLACE FUNCTION public.update_walker_location(
  _lat double precision,
  _lng double precision,
  _accuracy double precision DEFAULT 0,
  _captured_at bigint DEFAULT (extract(epoch from now()) * 1000)::bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_walk_id uuid;
    v_last_captured bigint;
    v_status walk_status;
BEGIN
    -- 1. Exigir auth.uid()
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- 2. Validar lat/lng
    IF _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'Coordenadas inválidas' USING ERRCODE = '22023';
    END IF;

    -- 3. Validar accuracy
    IF _accuracy < 0 OR _accuracy > 1000 THEN
        RAISE EXCEPTION 'Precisão inválida' USING ERRCODE = '22023';
    END IF;

    -- 4. Exigir petwalker_profiles + approval_status = 'approved' + Lock (FOR UPDATE)
    SELECT current_walk_id, last_location_captured_at
    INTO v_walk_id, v_last_captured
    FROM public.petwalker_profiles
    WHERE user_id = v_user_id
      AND approval_status = 'approved'
    FOR UPDATE;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Acesso negado: Petwalker não aprovado ou perfil inexistente.' USING ERRCODE = '42501';
    END IF;

    -- 5. Monotonicidade via _captured_at
    IF _captured_at <= COALESCE(v_last_captured, 0) THEN
        RETURN false;
    END IF;

    -- 6. Atualizar petwalker_profiles
    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        last_location_at = now(),
        last_location_captured_at = _captured_at
    WHERE user_id = v_user_id;

    -- 7. Validar Sessão e inserir tracking
    IF v_walk_id IS NOT NULL THEN
        -- SELECT com lock da sessão
        SELECT current_status INTO v_status 
        FROM public.walk_sessions 
        WHERE id = v_walk_id
          AND walker_id = v_user_id
        FOR UPDATE;

        -- Exigir status ativos
        IF v_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning') THEN
            INSERT INTO public.walker_tracking (walk_session_id, walker_id, location, accuracy, captured_at)
            VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography, _accuracy, _captured_at);

            -- Authority: route_coordinates só cresce em 'in_progress' ou 'returning'
            IF v_status IN ('in_progress', 'returning') THEN
                PERFORM public.append_walk_tracking_point(v_walk_id, jsonb_build_array(_lng, _lat));
            END IF;
        END IF;
    END IF;

    RETURN true;
END;
$$;

-- 4. ACL HARDENING
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO service_role;

-- 5. walker_tracking ACL
REVOKE INSERT ON public.walker_tracking FROM authenticated;
REVOKE INSERT ON public.walker_tracking FROM anon;

DROP POLICY IF EXISTS "Participants see tracking" ON public.walker_tracking;
CREATE POLICY "Participants see tracking"
ON public.walker_tracking
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.walk_sessions s
    WHERE s.id = walker_tracking.walk_session_id
      AND (s.customer_id = auth.uid() OR s.walker_id = auth.uid())
  )
);