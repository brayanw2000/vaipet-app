-- Migration: Phase 4.1 Final Hardening (PIN/Proximity/Atomic)
-- Prevent duplicates and handle existing structure safely

-- 1. Ensure column exists and is named pickup_code (not pin_hash)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_pickup_codes' AND column_name = 'pickup_code') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_pickup_codes' AND column_name = 'pin_hash') THEN
            ALTER TABLE public.walk_pickup_codes RENAME COLUMN pin_hash TO pickup_code;
        ELSE
            ALTER TABLE public.walk_pickup_codes ADD COLUMN pickup_code text;
        END IF;
    END IF;
    
    -- Ensure attempts and expires_at exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_pickup_codes' AND column_name = 'attempts') THEN
        ALTER TABLE public.walk_pickup_codes ADD COLUMN attempts integer DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_pickup_codes' AND column_name = 'expires_at') THEN
        ALTER TABLE public.walk_pickup_codes ADD COLUMN expires_at timestamptz DEFAULT (now() + interval '30 minutes');
    END IF;
END $$;

-- 2. Revoke PUBLIC access from all operational RPCs
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC;

-- Handle petwalker_arrive_pickup overloads
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid, float8, float8, float8);

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

-- Service role grants for jobs/admin
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO service_role;

-- 3. customer_get_pickup_code: Generate strictly 6-digit CSPRNG PIN
CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code text;
    v_owner_id uuid;
    v_status text;
BEGIN
    -- Authorization check
    SELECT customer_id, current_status INTO v_owner_id, v_status
    FROM public.walk_sessions
    WHERE id = _session_id;

    IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    -- State validation: Only valid before in_progress
    IF v_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RETURN NULL;
    END IF;

    -- Get or create PIN
    SELECT pickup_code INTO v_code
    FROM public.walk_pickup_codes
    WHERE session_id = _session_id AND expires_at > now();

    IF v_code IS NULL THEN
        -- Generate 6 digits with leading zeros
        v_code := LPAD(floor(random() * 1000000)::text, 6, '0');
        
        INSERT INTO public.walk_pickup_codes (session_id, pickup_code, expires_at)
        VALUES (_session_id, v_code, now() + interval '30 minutes')
        ON CONFLICT (session_id) DO UPDATE 
        SET pickup_code = EXCLUDED.pickup_code,
            expires_at = EXCLUDED.expires_at,
            attempts = 0;
    END IF;

    RETURN v_code;
END;
$$;

-- 4. petwalker_arrive_pickup: GPS and Role Hardening
CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(
    _session_id uuid,
    _lat float8,
    _lng float8,
    _accuracy float8
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_home_loc jsonb;
    v_dist float8;
    v_walker_id uuid;
    v_status text;
    v_updated integer;
BEGIN
    -- Fail fast if coordinates or accuracy are missing or invalid
    IF _lat IS NULL OR _lng IS NULL OR _accuracy IS NULL THEN
        RAISE EXCEPTION 'Dados GPS incompletos';
    END IF;

    IF _accuracy < 0 OR _accuracy > 200 THEN
        RAISE EXCEPTION 'Precisão GPS insuficiente para confirmação';
    END IF;

    -- Bounds check (rough Brazilian bounds)
    IF _lat < -35 OR _lat > 6 OR _lng < -75 OR _lng > -30 THEN
         RAISE EXCEPTION 'Localização geográfica inválida';
    END IF;

    -- Authorization and Status check
    SELECT walker_id, current_status, home_location INTO v_walker_id, v_status, v_home_loc
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE; -- Lock session

    IF v_walker_id IS NULL OR v_walker_id <> auth.uid() THEN
        RAISE EXCEPTION 'Somente o Walker designado pode realizar esta ação';
    END IF;

    IF v_status <> 'heading_to_pickup' THEN
        RAISE EXCEPTION 'Status inválido para chegada: %', v_status;
    END IF;

    -- Proximity check: 150m
    -- ST_DistanceSphere(ST_MakePoint(lng, lat), ST_MakePoint(lng2, lat2))
    SELECT ST_DistanceSphere(
        ST_MakePoint(_lng, _lat),
        ST_MakePoint((v_home_loc->>'lng')::float8, (v_home_loc->>'lat')::float8)
    ) INTO v_dist;

    IF v_dist > 150 THEN
        RAISE EXCEPTION 'Walker muito distante do ponto de retirada (%m)', round(v_dist::numeric, 2);
    END IF;

    -- Atomic transition
    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'heading_to_pickup';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Erro ao atualizar status para arrived. Concorrência detectada.';
    END IF;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, float8, float8, float8) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, float8, float8, float8) TO service_role;
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, float8, float8, float8) FROM PUBLIC;

-- 5. petwalker_confirm_pickup: Atomic PIN validation
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
    v_walker_id uuid;
    v_status text;
    v_stored_code text;
    v_attempts integer;
    v_expires timestamptz;
    v_updated integer;
BEGIN
    -- PIN format validation
    IF _pickup_code !~ '^[0-9]{6}$' THEN
        RAISE EXCEPTION 'PIN deve ter exatamente 6 dígitos';
    END IF;

    -- 1. Lock and Auth Session
    SELECT walker_id, current_status INTO v_walker_id, v_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF v_walker_id IS NULL OR v_walker_id <> auth.uid() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    IF v_status <> 'arrived' THEN
        RAISE EXCEPTION 'Status deve ser arrived para confirmar retirada';
    END IF;

    -- 2. Lock and Check PIN
    SELECT pickup_code, attempts, expires_at INTO v_stored_code, v_attempts, v_expires
    FROM public.walk_pickup_codes
    WHERE session_id = _session_id
    FOR UPDATE;

    IF v_stored_code IS NULL OR v_expires < now() THEN
        RAISE EXCEPTION 'PIN expirado ou não gerado';
    END IF;

    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'PIN bloqueado por excesso de tentativas';
    END IF;

    -- 3. Validate
    IF v_stored_code = _pickup_code THEN
        -- Success: Atomic Transition
        UPDATE public.walk_sessions
        SET current_status = 'in_progress',
            pickup_confirmed_at = now(),
            start_time = now(),
            updated_at = now()
        WHERE id = _session_id 
          AND walker_id = auth.uid() 
          AND current_status = 'arrived';
        
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        
        IF v_updated = 1 THEN
            -- Delete PIN on success (replay protection)
            DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
            RETURN true;
        ELSE
            RAISE EXCEPTION 'Erro ao transicionar para in_progress';
        END IF;
    ELSE
        -- Failure: Increment attempts without rollback
        UPDATE public.walk_pickup_codes
        SET attempts = attempts + 1
        WHERE session_id = _session_id;
        
        RETURN false;
    END IF;
END;
$$;
