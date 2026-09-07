-- Migration 20260813201500: Estabilização Final Fase 3.1 - Conclusão Segura
-- Redefinição canônica da petwalker_complete_walk e append_walk_tracking_point.

-- 1. Limpeza de assinaturas antigas e conflitantes
DO $$
BEGIN
    DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid);
    DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid, numeric);
    DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid, double precision);
    DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid, jsonb, double precision);
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Erro ao tentar remover assinaturas antigas: %', SQLERRM;
END $$;

-- 2. Assinatura Canônica Final: petwalker_complete_walk
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(
    _session_id uuid,
    _final_trail jsonb,
    _final_distance_km double precision
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _start_time timestamptz;
    _actual_min integer;
BEGIN
    -- 1. Validações de Identidade e Role
    IF _walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = _walker_id AND role = 'petwalker'
    ) THEN RAISE EXCEPTION 'Usuário não possui role petwalker'; END IF;

    -- 2. Bloqueio da Sessão e Validação de Estado
    SELECT start_time INTO _start_time 
    FROM public.walk_sessions 
    WHERE id = _session_id 
      AND walker_id = _walker_id 
      AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Sessão não encontrada, não pertence ao walker ou já concluída'; 
    END IF;

    IF _start_time IS NULL THEN 
        RAISE EXCEPTION 'Sessão não possui horário de início válido'; 
    END IF;

    -- 3. Validação de Dados de Rota e Distância
    IF _final_distance_km < 0 THEN 
        RAISE EXCEPTION 'Distância não pode ser negativa'; 
    END IF;

    IF _final_distance_km > 50 THEN 
        RAISE EXCEPTION 'Distância excede limite máximo razoável (50km)'; 
    END IF;

    IF jsonb_typeof(_final_trail) != 'array' THEN
        RAISE EXCEPTION '_final_trail deve ser um array JSON';
    END IF;

    IF jsonb_array_length(_final_trail) > 5000 THEN
        RAISE EXCEPTION 'Payload de rota excessivo (máximo 5000 pontos)';
    END IF;

    -- 4. Processamento Temporal
    _actual_min := EXTRACT(EPOCH FROM (now() - _start_time))/60;

    -- 5. Atualização Atômica da Sessão
    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        end_time = now(),
        actual_duration_minutes = GREATEST(_actual_min, 1),
        route_coordinates = _final_trail,
        distance_km = _final_distance_km,
        updated_at = now()
    WHERE id = _session_id;
    
    -- 6. Liberação do PetWalker
    UPDATE public.petwalker_profiles 
    SET current_walk_id = NULL, 
        availability_status = 'available',
        completed_walks = COALESCE(completed_walks, 0) + 1,
        updated_at = now()
    WHERE user_id = _walker_id;

    -- 7. Expiração de ofertas residuais para esta sessão
    UPDATE public.walk_offers
    SET offer_status = 'expired',
        updated_at = now()
    WHERE session_id = _session_id
      AND offer_status = 'pending';

    RETURN true;
END;
$$;

-- 3. Nova RPC para persistência incremental da rota (append_walk_tracking_point)
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
BEGIN
    -- Validações de Segurança
    IF _walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    -- Validação de Coordenadas no JSON
    _lng := (_point->>0)::double precision;
    _lat := (_point->>1)::double precision;
    
    IF _lng NOT BETWEEN -180 AND 180 OR _lat NOT BETWEEN -90 AND 90 THEN
        RAISE EXCEPTION 'Coordenadas inválidas';
    END IF;

    -- Seleção e Bloqueio (prevenção de substituição arbitrária)
    SELECT route_coordinates INTO _current_trail
    FROM public.walk_sessions
    WHERE id = _session_id 
      AND walker_id = _walker_id 
      AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN RETURN false; END IF;

    -- Append limitado e seguro
    IF _current_trail IS NULL OR jsonb_typeof(_current_trail) != 'array' THEN
        _current_trail := '[]'::jsonb;
    END IF;

    -- Impedir payloads gigantes durante o passeio
    IF jsonb_array_length(_current_trail) >= 5000 THEN
        RETURN true; -- Silenciosamente ignora se já atingiu o limite
    END IF;

    UPDATE public.walk_sessions
    SET route_coordinates = _current_trail || jsonb_build_array(_lng, _lat),
        updated_at = now()
    WHERE id = _session_id;

    RETURN true;
END;
$$;

-- 4. Revokes e Grants (Zero-Trust)
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid, jsonb, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid, jsonb, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid, jsonb, double precision) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) TO authenticated, service_role;