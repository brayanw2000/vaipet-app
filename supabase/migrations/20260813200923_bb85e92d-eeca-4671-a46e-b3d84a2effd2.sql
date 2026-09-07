-- Migration 20260813203000: Correção de Regressões Fase 3.1
-- Foco em integridade da rota, controle de frequência e autoridade do servidor.

-- 1. Limpeza de assinaturas conflitantes
DO $$
BEGIN
    DROP FUNCTION IF EXISTS public.append_walk_tracking_point(uuid, jsonb);
    DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid, jsonb, double precision);
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Erro ao limpar assinaturas: %', SQLERRM;
END $$;

-- 2. Redefinição de append_walk_tracking_point com Controle de Frequência e Estrutura Correta
CREATE OR REPLACE FUNCTION public.append_walk_tracking_point(
    _session_id uuid,
    _point jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _current_trail jsonb;
    _lng double precision;
    _lat double precision;
    _last_updated timestamptz;
BEGIN
    -- Validações Básicas
    IF _walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF _point IS NULL OR jsonb_typeof(_point) != 'array' OR jsonb_array_length(_point) != 2 THEN
        RAISE EXCEPTION 'Ponto inválido: deve ser [longitude, latitude]';
    END IF;

    _lng := (_point->>0)::double precision;
    _lat := (_point->>1)::double precision;
    
    IF _lng NOT BETWEEN -180 AND 180 OR _lat NOT BETWEEN -90 AND 90 THEN
        RAISE EXCEPTION 'Coordenadas fora dos limites geográficos';
    END IF;

    -- Bloqueio e Validação de Estado/Propriedade
    SELECT route_coordinates, updated_at INTO _current_trail, _last_updated
    FROM public.walk_sessions
    WHERE id = _session_id 
      AND walker_id = _walker_id 
      AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Sessão inválida, não pertence ao walker ou já encerrada'; 
    END IF;

    -- Controle de Frequência (Máximo 1 atualização a cada 5 segundos)
    IF _last_updated IS NOT NULL AND (now() - _last_updated) < interval '5 seconds' THEN
        RETURN false; -- Rejeita silenciosamente ou retorna false para o cliente lidar
    END IF;

    -- Append Correto (Preservando Estrutura de Array de Arrays)
    IF _current_trail IS NULL OR jsonb_typeof(_current_trail) != 'array' THEN
        _current_trail := '[]'::jsonb;
    END IF;

    IF jsonb_array_length(_current_trail) >= 5000 THEN
        RAISE EXCEPTION 'Limite de 5.000 pontos atingido para esta sessão';
    END IF;

    UPDATE public.walk_sessions
    SET route_coordinates = _current_trail || jsonb_build_array(_point), -- _point já é [lng, lat]
        updated_at = now()
    WHERE id = _session_id;

    RETURN true;
END;
$$;

-- 3. Redefinição Simplificada de petwalker_complete_walk (Autoridade do Servidor)
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(
    _session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _start_time timestamptz;
    _trail jsonb;
    _dist_km double precision := 0;
    _actual_min integer;
    _i integer;
    _p1 jsonb;
    _p2 jsonb;
BEGIN
    -- 1. Validações de Identidade e Role
    IF _walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = _walker_id AND role = 'petwalker'
    ) THEN RAISE EXCEPTION 'Acesso negado: role petwalker necessária'; END IF;

    -- 2. Bloqueio e Validação de Estado
    SELECT start_time, route_coordinates INTO _start_time, _trail
    FROM public.walk_sessions 
    WHERE id = _session_id 
      AND walker_id = _walker_id 
      AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Sessão não encontrada ou já concluída'; 
    END IF;

    -- 3. Cálculo de Distância no Servidor (Haversine simplificado entre pontos persistidos)
    IF _trail IS NOT NULL AND jsonb_array_length(_trail) > 1 THEN
        FOR _i IN 0 .. jsonb_array_length(_trail) - 2 LOOP
            _p1 := _trail->_i;
            _p2 := _trail->(_i+1);
            -- Soma das distâncias entre pontos consecutivos
            _dist_km := _dist_km + (
                6371 * acos(
                    cos(radians((_p1->>1)::double precision)) * cos(radians((_p2->>1)::double precision)) * 
                    cos(radians((_p2->>0)::double precision) - radians((_p1->>0)::double precision)) + 
                    sin(radians((_p1->>1)::double precision)) * sin(radians((_p2->>1)::double precision))
                )
            );
        END LOOP;
    END IF;

    -- 4. Cálculo de Duração
    _actual_min := EXTRACT(EPOCH FROM (now() - _start_time))/60;

    -- 5. Atualização Atômica
    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        end_time = now(),
        actual_duration_minutes = GREATEST(_actual_min, 1),
        distance_km = COALESCE(_dist_km, 0),
        updated_at = now()
    WHERE id = _session_id;
    
    -- 6. Liberação do PetWalker
    UPDATE public.petwalker_profiles 
    SET current_walk_id = NULL, 
        availability_status = 'available',
        completed_walks = COALESCE(completed_walks, 0) + 1,
        updated_at = now()
    WHERE user_id = _walker_id;

    -- 7. Expiração de ofertas
    UPDATE public.walk_offers
    SET offer_status = 'expired',
        updated_at = now()
    WHERE session_id = _session_id
      AND offer_status = 'pending';

    RETURN true;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao concluir passeio: %', SQLERRM;
END;
$$;

-- 4. Revokes e Grants (Zero-Trust)
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated, service_role;