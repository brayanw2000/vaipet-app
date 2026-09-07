-- PHASE 4.2 — TRACKING INFRASTRUCTURE AND AUTHORITY
-- 1. ADD COLUMNS FOR MONOTONICITY
ALTER TABLE public.petwalker_profiles 
ADD COLUMN IF NOT EXISTS last_location_captured_at bigint DEFAULT 0;

ALTER TABLE public.walker_tracking 
ADD COLUMN IF NOT EXISTS captured_at bigint DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- 2. HARDEN update_walker_location
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision, double precision);

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
    v_status text;
BEGIN
    IF v_user_id IS NULL THEN RETURN false; END IF;
    
    SELECT current_walk_id, last_location_captured_at
    INTO v_walk_id, v_last_captured
    FROM public.petwalker_profiles
    WHERE user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN RETURN false; END IF;

    IF _captured_at <= v_last_captured THEN
        RETURN false;
    END IF;

    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        last_location_at = now(),
        last_location_captured_at = _captured_at
    WHERE user_id = v_user_id;

    IF v_walk_id IS NOT NULL THEN
        SELECT current_status INTO v_status 
        FROM public.walk_sessions 
        WHERE id = v_walk_id;

        INSERT INTO public.walker_tracking (walk_session_id, walker_id, location, accuracy, captured_at)
        VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography, _accuracy, _captured_at);

        IF v_status IN ('in_progress', 'returning') THEN
            PERFORM public.append_walk_tracking_point(v_walk_id, ARRAY[_lng, _lat]);
        END IF;
    END IF;

    RETURN true;
END;
$$;

-- 3. ACL HARDENING
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision, bigint) TO service_role;
