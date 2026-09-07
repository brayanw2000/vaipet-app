-- PHASE 3 CANONICAL FINAL RECONCILIATION
-- Timestamp: 20260810190000

-- 1. CLEANUP PREVIOUS SIGNATURES
DROP FUNCTION IF EXISTS public.accept_walk_request(uuid);
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision);
DROP FUNCTION IF EXISTS public.get_active_walker_location(uuid);
DROP FUNCTION IF EXISTS public.process_walk_matching();
DROP FUNCTION IF EXISTS public.get_session_walker_profile(uuid);
DROP FUNCTION IF EXISTS public.get_walk_quote(uuid, double precision, double precision);

-- 2. ENUMS
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'walk_offer_status') THEN
        CREATE TYPE public.walk_offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
    END IF;
END $$;

-- 3. SCHEMA ALIGNMENT (SRID 4326 Geography)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS postgis_topology;
END $$;

-- Hardening tables
ALTER TABLE public.walker_tracking DROP COLUMN IF EXISTS recorded_at;
ALTER TABLE public.walker_tracking DROP COLUMN IF EXISTS session_id;
ALTER TABLE public.walker_tracking ALTER COLUMN location TYPE geography(Point, 4326);

ALTER TABLE public.petwalker_profiles ALTER COLUMN last_known_location TYPE geography(Point, 4326);
ALTER TABLE public.petwalker_profiles DROP COLUMN IF EXISTS last_location_update_at;

ALTER TABLE public.walk_sessions ALTER COLUMN meeting_point_geom TYPE geography(Point, 4326);

-- 4. ATOMIC ACCEPT WALK REQUEST
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid := auth.uid();
    v_customer_id uuid;
    v_offer_id uuid;
BEGIN
    IF v_walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    SELECT customer_id INTO v_customer_id
    FROM public.walk_sessions
    WHERE id = _session_id
      AND current_status = 'searching'
      AND (matching_expires_at IS NULL OR matching_expires_at > now())
    FOR UPDATE;

    IF v_customer_id IS NULL THEN RETURN false; END IF;
    IF v_customer_id = v_walker_id THEN RAISE EXCEPTION 'Auto-aceite proibido'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_walker_id 
          AND approval_status = 'approved' 
          AND availability_status = 'available'
          AND is_accepting_requests = true
          AND current_walk_id IS NULL
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'Walker indisponível'; END IF;

    SELECT id INTO v_offer_id
    FROM public.walk_offers
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending'
    FOR UPDATE;

    IF v_offer_id IS NULL THEN RAISE EXCEPTION 'Oferta expirada'; END IF;

    UPDATE public.walk_sessions
    SET walker_id = v_walker_id,
        current_status = 'accepted',
        status = 'accepted',
        petwalker_notified_at = now()
    WHERE id = _session_id;

    UPDATE public.walk_offers SET offer_status = 'accepted' WHERE id = v_offer_id;
    UPDATE public.walk_offers SET offer_status = 'expired' WHERE session_id = _session_id AND id <> v_offer_id AND offer_status = 'pending';
    UPDATE public.petwalker_profiles SET current_walk_id = _session_id, availability_status = 'busy' WHERE user_id = v_walker_id;

    RETURN true;
END;
$$;

-- 5. UPDATE WALKER LOCATION
CREATE OR REPLACE FUNCTION public.update_walker_location(
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
    v_walk_id uuid;
BEGIN
    IF v_user_id IS NULL THEN RETURN false; END IF;
    
    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        last_location_at = now()
    WHERE user_id = v_user_id
    RETURNING current_walk_id INTO v_walk_id;

    IF NOT FOUND THEN RETURN false; END IF;

    IF v_walk_id IS NOT NULL THEN
        INSERT INTO public.walker_tracking (walk_session_id, walker_id, location, accuracy)
        VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography, _accuracy);
    END IF;

    RETURN true;
END;
$$;

-- 6. GET ACTIVE WALKER LOCATION
CREATE OR REPLACE FUNCTION public.get_active_walker_location(_session_id uuid)
RETURNS TABLE (
    lat double precision,
    lng double precision,
    accuracy double precision,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.walk_sessions WHERE id = _session_id AND (customer_id = auth.uid() OR walker_id = auth.uid())
    ) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;

    RETURN QUERY
    SELECT 
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        accuracy,
        created_at as updated_at
    FROM public.walker_tracking
    WHERE walk_session_id = _session_id
    ORDER BY created_at DESC
    LIMIT 1;
END;
$$;

-- 7. MATCHING ENGINE
CREATE OR REPLACE FUNCTION public.process_walk_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r_session RECORD;
    r_walker RECORD;
    v_radius float;
    v_max_radius float;
    v_initial_radius float;
    v_increment float;
    v_exp_interval float;
    v_expiry float;
    v_elapsed float;
BEGIN
    SELECT 
        initial_radius_meters, max_radius_meters, radius_expansion_step_meters,
        expansion_interval_minutes, session_expiry_minutes
    INTO v_initial_radius, v_max_radius, v_increment, v_exp_interval, v_expiry
    FROM public.walk_matching_settings WHERE active = true LIMIT 1;

    IF NOT FOUND THEN RETURN; END IF;

    FOR r_session IN 
        SELECT id, meeting_point_geom, customer_id, search_started_at
        FROM public.walk_sessions 
        WHERE current_status = 'searching'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
          AND (matching_expires_at IS NULL OR matching_expires_at > now())
    LOOP
        IF r_session.search_started_at IS NULL THEN
            UPDATE public.walk_sessions 
            SET search_started_at = now(), matching_expires_at = now() + (v_expiry * interval '1 minute')
            WHERE id = r_session.id;
            r_session.search_started_at := now();
        END IF;

        v_elapsed := EXTRACT(EPOCH FROM (now() - r_session.search_started_at)) / 60;
        v_radius := LEAST(v_max_radius, v_initial_radius + (FLOOR(v_elapsed / NULLIF(v_exp_interval, 0)) * v_increment));

        FOR r_walker IN
            SELECT user_id
            FROM public.petwalker_profiles
            WHERE approval_status = 'approved' AND availability_status = 'available'
              AND is_accepting_requests = true AND current_walk_id IS NULL
              AND last_known_location IS NOT NULL
              AND ST_DWithin(last_known_location, r_session.meeting_point_geom, v_radius)
              AND user_id <> r_session.customer_id
        LOOP
            INSERT INTO public.walk_offers (session_id, walker_id, offer_status)
            VALUES (r_session.id, r_walker.user_id, 'pending')
            ON CONFLICT (session_id, walker_id) DO NOTHING;
        END LOOP;
    END LOOP;

    UPDATE public.walk_sessions SET current_status = 'expired', status = 'expired'
    WHERE current_status = 'searching' AND matching_expires_at <= now();
END;
$$;

-- 8. QUOTE RPC
CREATE OR REPLACE FUNCTION public.get_walk_quote(
  _duration_minutes integer,
  _request_mode text DEFAULT 'now'
)
RETURNS TABLE (
  duration_minutes integer,
  price_per_minute_cents integer,
  request_surcharge_cents integer,
  total_price_cents integer,
  pricing_version integer,
  request_mode text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY SELECT 
        _duration_minutes as duration_minutes,
        150 as price_per_minute_cents,
        0 as request_surcharge_cents,
        (_duration_minutes * 150) as total_price_cents,
        1 as pricing_version,
        _request_mode as request_mode;
END;
$$;

-- 9. PROFILE RPC
CREATE OR REPLACE FUNCTION public.get_session_walker_profile(_session_id uuid)
RETURNS TABLE (
    full_name text,
    avatar_url text,
    rating_average numeric,
    completed_walks integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT p.full_name, p.avatar_url, wp.rating_average, wp.completed_walks
    FROM public.walk_sessions ws
    JOIN public.petwalker_profiles wp ON ws.walker_id = wp.user_id
    JOIN public.profiles p ON wp.user_id = p.id
    WHERE ws.id = _session_id AND (ws.customer_id = auth.uid() OR ws.walker_id = auth.uid());
END;
$$;

-- 10. GRANTS
GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_walker_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_walk_quote(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;

-- 11. CRON JOB
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('walk-matching-job');
SELECT cron.schedule('walk-matching-job', '* * * * *', 'SELECT public.process_walk_matching()');
