-- 1. Campo exclusivo para o relógio do GPS
ALTER TABLE public.walk_sessions
  ADD COLUMN IF NOT EXISTS last_tracking_at timestamptz;

-- 2. Redefinição de append_walk_tracking_point usando last_tracking_at
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
    _last_tracking timestamptz;
    _lng double precision;
    _lat double precision;
BEGIN
    IF _walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    -- Estrutura do ponto
    IF _point IS NULL
       OR jsonb_typeof(_point) <> 'array'
       OR jsonb_array_length(_point) <> 2 THEN
        RAISE EXCEPTION 'Ponto inválido: deve ser [longitude, latitude]';
    END IF;

    -- Somente números JSON reais (strings numéricas são rejeitadas)
    IF jsonb_typeof(_point->0) <> 'number' OR jsonb_typeof(_point->1) <> 'number' THEN
        RAISE EXCEPTION 'Coordenadas devem ser números JSON';
    END IF;

    _lng := (_point->>0)::double precision;
    _lat := (_point->>1)::double precision;

    IF _lng NOT BETWEEN -180 AND 180 OR _lat NOT BETWEEN -90 AND 90 THEN
        RAISE EXCEPTION 'Coordenadas fora dos limites geográficos';
    END IF;

    -- Propriedade + estado + lock
    SELECT route_coordinates, last_tracking_at
      INTO _current_trail, _last_tracking
    FROM public.walk_sessions
    WHERE id = _session_id
      AND walker_id = _walker_id
      AND current_status IN ('in_progress', 'returning')
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sessão inválida, não pertence ao walker ou já encerrada';
    END IF;

    -- Controle de frequência exclusivo do GPS (5s por sessão)
    IF _last_tracking IS NOT NULL AND (now() - _last_tracking) < interval '5 seconds' THEN
        RETURN false;
    END IF;

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

REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_walk_tracking_point(uuid, jsonb) TO authenticated, service_role;