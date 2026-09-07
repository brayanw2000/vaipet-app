-- PHASE 4.1: Security Hardening and State Machine Closure
-- Closing bypasses and enforcing Zero-Trust rules for walk operations.

-- 1. Remove old/insecure RPC signatures
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid);
DROP FUNCTION IF EXISTS public.petwalker_start_walk(uuid);

-- 2. Harden walk_pickup_codes
REVOKE ALL ON public.walk_pickup_codes FROM PUBLIC;
REVOKE ALL ON public.walk_pickup_codes FROM anon;
REVOKE ALL ON public.walk_pickup_codes FROM authenticated;
GRANT ALL ON public.walk_pickup_codes TO service_role;

-- 3. Secure PIN generation and retrieval
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
    -- Auth check
    SELECT customer_id, current_status INTO v_customer_id, v_status
    FROM public.walk_sessions
    WHERE id = _session_id;

    IF v_customer_id != auth.uid() THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    -- customer_get_pickup_code permitido apenas em: accepted, heading_to_pickup e arrived
    IF v_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RAISE EXCEPTION 'Invalid walk status for PIN retrieval' USING ERRCODE = 'P0001';
    END IF;

    -- Check for existing non-expired PIN
    SELECT pickup_code INTO v_code 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id AND expires_at > now() AND attempts < 5;

    IF v_code IS NULL THEN
        -- Gerar PIN determinístico de 6 dígitos baseado em UUID seguro
        v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
        
        -- Expiração obrigatória (30 min)
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

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

-- 4. Harden petwalker_arrive_pickup
CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(
    _session_id uuid,
    _lat numeric,
    _lng numeric,
    _accuracy numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting_point geography;
    v_distance numeric;
BEGIN
    -- Validar auth.uid não nulo e role petwalker (implícito no walker_id)
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Validar coordenadas
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
        RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE = 'P0008';
    END IF;

    -- Validar accuracy entre 0 e 100
    IF _accuracy < 0 OR _accuracy > 100 THEN
        RAISE EXCEPTION 'Low GPS accuracy' USING ERRCODE = 'P0002';
    END IF;

    -- Utilizar ST_SetSRID(ST_MakePoint(...), 4326)::geography
    -- Exigir walker_id = auth.uid() e current_status = heading_to_pickup
    SELECT meeting_point_geom INTO v_meeting_point
    FROM public.walk_sessions
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'heading_to_pickup'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Proximity validation (max 150m)
    v_distance := ST_Distance(v_meeting_point, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography);
    
    IF v_distance > 150 THEN
        RAISE EXCEPTION 'Too far from pickup point' USING ERRCODE = 'P0003';
    END IF;

    -- UPDATE defensivo repetindo walker_id e status
    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    WHERE id = _session_id
      AND walker_id = auth.uid()
      AND current_status = 'heading_to_pickup';

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, numeric, numeric, numeric) TO authenticated;

-- 5. Harden petwalker_confirm_pickup
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(
    _session_id uuid,
    _pickup_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_correct_code text;
    v_attempts integer;
    v_expires timestamp with time zone;
    v_session_walker uuid;
    v_status text;
BEGIN
    -- Bloquear sessão e PIN com FOR UPDATE
    SELECT walker_id, current_status INTO v_session_walker, v_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF v_session_walker != auth.uid() THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    -- Exigir current_status = arrived
    IF v_status != 'arrived' THEN
        RAISE EXCEPTION 'Walk not in arrived status' USING ERRCODE = 'P0004';
    END IF;

    -- Atomic lock for PIN
    SELECT pickup_code, attempts, expires_at 
    INTO v_correct_code, v_attempts, v_expires
    FROM public.walk_pickup_codes
    WHERE session_id = _session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup code not found or already consumed' USING ERRCODE = 'P0005';
    END IF;

    IF v_expires < now() THEN
        RAISE EXCEPTION 'Pickup code expired' USING ERRCODE = 'P0006';
    END IF;

    -- Máximo de 5 tentativas
    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Too many attempts' USING ERRCODE = 'P0007';
    END IF;

    -- Consumir o PIN atomicamente (incrementar tentativa)
    UPDATE public.walk_pickup_codes 
    SET attempts = attempts + 1 
    WHERE session_id = _session_id;

    -- Validar code
    IF v_correct_code != _pickup_code THEN
        RETURN false;
    END IF;

    -- Atualizar arrived → in_progress somente no UPDATE defensivo
    -- Preencher pickup_confirmed_at e start_time
    UPDATE public.walk_sessions
    SET current_status = 'in_progress',
        pickup_confirmed_at = now(),
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id
      AND walker_id = auth.uid()
      AND current_status = 'arrived';

    -- Impedir replay: Deletar PIN consumido
    DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- 6. Harden petwalker_complete_walk
-- REVOKE EXECUTE FROM authenticated nesta fase.
REVOKE EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) FROM authenticated;

