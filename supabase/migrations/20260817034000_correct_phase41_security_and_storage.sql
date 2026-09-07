-- migration 20260817034000: Correct Phase 4.1 Security and Storage

-- 1. Renomear pin_hash para pin_code (Reconciliação Idempotente)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'walk_pickup_codes'
          AND column_name = 'pin_hash'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'walk_pickup_codes'
          AND column_name = 'pin_code'
    ) THEN
        ALTER TABLE public.walk_pickup_codes
        RENAME COLUMN pin_hash TO pin_code;
    ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'walk_pickup_codes'
          AND column_name = 'pin_hash'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'walk_pickup_codes'
          AND column_name = 'pin_code'
    ) THEN
        UPDATE public.walk_pickup_codes
        SET pin_code = COALESCE(pin_code, pin_hash)
        WHERE pin_hash IS NOT NULL;
        ALTER TABLE public.walk_pickup_codes
        DROP COLUMN pin_hash;
    END IF;
END $$;

-- 2. Restringir acesso total à tabela walk_pickup_codes
REVOKE ALL ON public.walk_pickup_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.walk_pickup_codes TO service_role;

-- 3. Função customer_get_pickup_code serializada com FOR UPDATE
DROP FUNCTION IF EXISTS public.customer_get_pickup_code(uuid);
CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(walk_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer_id uuid;
    v_pin text;
    v_walk_status text;
    v_existing_pin text;
    v_expires_at timestamptz;
BEGIN
    -- Auth check
    v_customer_id := auth.uid();
    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock session and validate ownership
    SELECT current_status INTO v_walk_status
    FROM public.walk_sessions
    WHERE id = walk_id AND customer_id = v_customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Walk session not found or access denied';
    END IF;

    IF v_walk_status != 'accepted' THEN
        RAISE EXCEPTION 'Invalid status for PIN generation: %', v_walk_status;
    END IF;

    -- Check for valid existing PIN (Idempotency)
    SELECT pin_code, expires_at INTO v_existing_pin, v_expires_at
    FROM public.walk_pickup_codes
    WHERE session_id = walk_id
    FOR UPDATE;

    IF v_existing_pin IS NOT NULL AND v_expires_at > now() THEN
        RETURN v_existing_pin;
    END IF;

    -- Generate new 6-digit PIN
    v_pin := lpad(floor(random() * 1000000)::text, 6, '0');

    INSERT INTO public.walk_pickup_codes (
        session_id,
        pin_code,
        expires_at,
        attempts
    ) VALUES (
        walk_id,
        v_pin,
        now() + interval '30 minutes',
        0
    )
    ON CONFLICT (session_id) DO UPDATE SET
        pin_code = EXCLUDED.pin_code,
        expires_at = EXCLUDED.expires_at,
        attempts = 0;

    RETURN v_pin;
END;
$$;

-- 4. Função petwalker_confirm_pickup robusta
DROP FUNCTION IF EXISTS public.petwalker_confirm_pickup(uuid, text);
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(walk_id uuid, input_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid;
    v_actual_pin text;
    v_attempts int;
    v_expires_at timestamptz;
BEGIN
    -- Auth check
    v_walker_id := auth.uid();
    IF v_walker_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock PIN record
    SELECT pin_code, attempts, expires_at INTO v_actual_pin, v_attempts, v_expires_at
    FROM public.walk_pickup_codes
    WHERE session_id = walk_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup code not found';
    END IF;

    -- Security checks
    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Max attempts reached';
    END IF;

    IF v_expires_at < now() THEN
        RAISE EXCEPTION 'PIN expired';
    END IF;

    -- Atomic increment of attempts
    UPDATE public.walk_pickup_codes
    SET attempts = attempts + 1
    WHERE session_id = walk_id;

    IF input_pin != v_actual_pin THEN
        RETURN false;
    END IF;

    -- Success: update status and current_status together
    UPDATE public.walk_sessions
    SET 
        status = 'in_progress',
        current_status = 'in_progress',
        started_at = now(),
        updated_at = now()
    WHERE id = walk_id AND walker_id = v_walker_id;

    -- Delete used PIN
    DELETE FROM public.walk_pickup_codes WHERE session_id = walk_id;

    RETURN true;
END;
$$;

-- 5. Revoke/Grant explicit em todas as RPCs operacionais
REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;

REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
