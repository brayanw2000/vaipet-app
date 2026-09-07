-- Phase 4.1: Displacement and Secure Pickup
-- Target: heading_to_pickup -> arrived -> in_progress (PIN validation)

-- 1. UTILITIES: Security Definer for PIN Management
CREATE TABLE IF NOT EXISTS public.walk_pickup_codes (
    session_id uuid PRIMARY KEY REFERENCES public.walk_sessions(id) ON DELETE CASCADE,
    pickup_code text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pickup_code_attempts_limit CHECK (attempts <= 5)
);

-- Deny all direct access to codes
ALTER TABLE public.walk_pickup_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.walk_pickup_codes TO service_role;
-- No grants to authenticated/anon for the table itself, only via RPCs.

-- 2. SCHEMA UPDATE: Add tracking columns to walk_sessions
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_sessions' AND column_name='heading_started_at') THEN
        ALTER TABLE public.walk_sessions ADD COLUMN heading_started_at timestamp with time zone;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_sessions' AND column_name='arrived_at') THEN
        ALTER TABLE public.walk_sessions ADD COLUMN arrived_at timestamp with time zone;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_sessions' AND column_name='pickup_confirmed_at') THEN
        ALTER TABLE public.walk_sessions ADD COLUMN pickup_confirmed_at timestamp with time zone;
    END IF;
END $$;

-- 3. RPC: customer_get_pickup_code
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

    -- Valid only after acceptance
    IF v_status NOT IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress') THEN
        RAISE EXCEPTION 'Invalid walk status for PIN' USING ERRCODE = 'P0001';
    END IF;

    -- Upsert code (deterministic or random)
    -- We use a 6-digit random code
    SELECT pickup_code INTO v_code 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id AND expires_at > now();

    IF v_code IS NULL THEN
        v_code := lpad(floor(random() * 1000000)::text, 6, '0');
        INSERT INTO public.walk_pickup_codes (session_id, pickup_code, expires_at)
        VALUES (_session_id, v_code, now() + interval '30 minutes')
        ON CONFLICT (session_id) DO UPDATE 
        SET pickup_code = EXCLUDED.pickup_code, 
            attempts = 0, 
            expires_at = EXCLUDED.expires_at;
    END IF;

    RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

-- 4. RPC: petwalker_start_heading
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.walk_sessions
    SET current_status = 'heading_to_pickup',
        heading_started_at = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'accepted';

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

-- 5. RPC: petwalker_arrive_pickup
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
    -- Basic validation
    IF _accuracy > 100 THEN
        RAISE EXCEPTION 'Low GPS accuracy' USING ERRCODE = 'P0002';
    END IF;

    SELECT meeting_point_geom INTO v_meeting_point
    FROM public.walk_sessions
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'heading_to_pickup';

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Proximity validation (max 150m)
    v_distance := ST_Distance(v_meeting_point, ST_MakePoint(_lng, _lat)::geography);
    
    IF v_distance > 150 THEN
        RAISE EXCEPTION 'Too far from pickup point' USING ERRCODE = 'P0003';
    END IF;

    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    WHERE id = _session_id;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, numeric, numeric, numeric) TO authenticated;

-- 6. RPC: petwalker_confirm_pickup
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
    -- Atomic lock for session and code
    SELECT walker_id, current_status INTO v_session_walker, v_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF v_session_walker != auth.uid() THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

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
        RAISE EXCEPTION 'Pickup code not found' USING ERRCODE = 'P0005';
    END IF;

    IF v_expires < now() THEN
        RAISE EXCEPTION 'Pickup code expired' USING ERRCODE = 'P0006';
    END IF;

    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Too many attempts' USING ERRCODE = 'P0007';
    END IF;

    -- Increment attempts
    UPDATE public.walk_pickup_codes 
    SET attempts = attempts + 1 
    WHERE session_id = _session_id;

    -- Validate code
    IF v_correct_code != _pickup_code THEN
        RETURN false;
    END IF;

    -- Success: Transition to in_progress
    UPDATE public.walk_sessions
    SET current_status = 'in_progress',
        pickup_confirmed_at = now(),
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id;

    -- Cleanup code
    DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- 7. SECURITY: Harden petwalker_complete_walk
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Block transition if not in returning status
    -- During Phase 4.1, we prevent direct in_progress -> completed bypass
    UPDATE public.walk_sessions
    SET current_status = 'completed',
        end_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'returning'; -- Restricted to returning

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;