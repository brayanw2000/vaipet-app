-- Phase 3: Matching, Tracking and State Machine
-- Target: Zero-Trust, Server-side Matching, PostGIS Geofencing

-- 1. EXTENSIONS & TYPES
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'walk_status') THEN
        CREATE TYPE public.walk_status AS ENUM (
            'searching',        -- Dono solicitou, procurando walkers
            'offered',          -- Walker recebeu oferta
            'accepted',         -- Walker aceitou, a caminho do pickup
            'heading_to_pickup',-- Walker a caminho
            'arrived',          -- Walker chegou no ponto de encontro
            'in_progress',      -- Passeio iniciado
            'returning',        -- Voltando para casa
            'completed',        -- Finalizado
            'cancelled',        -- Cancelado
            'expired'           -- Expirado
        );
    END IF;
END $$;

-- 2. SCHEMA UPDATES (PostGIS & Matching)

-- Add geometry columns for efficient spatial queries
ALTER TABLE public.locations 
ADD COLUMN IF NOT EXISTS geom geography(POINT, 4326);

-- Backfill geom from lat/lng
UPDATE public.locations 
SET geom = ST_SetSRID(ST_Point(longitude, latitude), 4326)::geography
WHERE longitude IS NOT NULL AND latitude IS NOT NULL AND geom IS NULL;

-- Index for spatial search
CREATE INDEX IF NOT EXISTS idx_locations_geom ON public.locations USING GIST (geom);

-- PetWalker Profile updates for matching
ALTER TABLE public.petwalker_profiles
ADD COLUMN IF NOT EXISTS last_known_location geography(POINT, 4326),
ADD COLUMN IF NOT EXISTS last_location_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS current_walk_id uuid;

CREATE INDEX IF NOT EXISTS idx_petwalker_last_known_location ON public.petwalker_profiles USING GIST (last_known_location);

-- Walk Sessions Enhancement
ALTER TABLE public.walk_sessions 
ADD COLUMN IF NOT EXISTS current_status public.walk_status DEFAULT 'searching',
ADD COLUMN IF NOT EXISTS current_radius_meters integer DEFAULT 2000,
ADD COLUMN IF NOT EXISTS last_expansion_at timestamp with time zone DEFAULT now(),
ADD COLUMN IF NOT EXISTS matching_expires_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS meeting_point_geom geography(POINT, 4326),
ADD COLUMN IF NOT EXISTS meeting_point_address text;

-- Backfill meeting_point_geom from home_location if present
UPDATE public.walk_sessions
SET meeting_point_geom = ST_SetSRID(ST_Point((home_location->>'lng')::numeric, (home_location->>'lat')::numeric), 4326)::geography
WHERE home_location IS NOT NULL AND meeting_point_geom IS NULL;

-- 3. OFFER TRACKING
CREATE TABLE IF NOT EXISTS public.walk_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.walk_sessions(id) ON DELETE CASCADE,
    walker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status text DEFAULT 'pending', -- pending, declined
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE (session_id, walker_id)
);

GRANT SELECT, INSERT, UPDATE ON public.walk_offers TO authenticated;
GRANT ALL ON public.walk_offers TO service_role;
ALTER TABLE public.walk_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see offers for their sessions" 
ON public.walk_offers FOR SELECT 
USING (EXISTS (SELECT 1 FROM public.walk_sessions WHERE id = session_id AND customer_id = auth.uid()));

CREATE POLICY "Walkers see their own offers" 
ON public.walk_offers FOR SELECT 
USING (walker_id = auth.uid());

-- 4. SECURE RPCs

-- AGGRESSIVE CLEANUP OF OLD RPCs
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT proname, pg_get_function_identity_arguments(oid) as args 
              FROM pg_proc 
              WHERE proname IN ('create_walk_request', 'accept_walk_request', 'get_active_walker_location', 'get_available_walk_offers', 'update_walker_location')
              AND pronamespace = 'public'::regnamespace) 
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || r.proname || '(' || r.args || ') CASCADE';
    END LOOP;
END $$;

-- A. CREATE WALK REQUEST
CREATE OR REPLACE FUNCTION public.create_walk_request(
    _pet_id uuid,
    _duration_minutes integer,
    _request_mode public.walk_request_mode,
    _meeting_point_lng numeric,
    _meeting_point_lat numeric,
    _meeting_point_address text,
    _scheduled_for timestamp with time zone DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session_id uuid;
    v_meeting_geom geography(POINT, 4326);
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    
    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'Pet not found or not yours';
    END IF;

    v_meeting_geom := ST_SetSRID(ST_Point(_meeting_point_lng, _meeting_point_lat), 4326)::geography;

    INSERT INTO public.walk_sessions (
        customer_id,
        pet_id,
        planned_duration_minutes,
        request_mode,
        scheduled_for,
        current_status,
        meeting_point_geom,
        meeting_point_address,
        home_location,
        current_radius_meters,
        last_expansion_at,
        matching_expires_at,
        status,
        walk_type
    ) VALUES (
        auth.uid(),
        _pet_id,
        _duration_minutes,
        _request_mode,
        _scheduled_for,
        'searching',
        v_meeting_geom,
        _meeting_point_address,
        jsonb_build_object('lng', _meeting_point_lng, 'lat', _meeting_point_lat),
        2000,
        now(),
        now() + interval '15 minutes',
        'searching',
        'livre'
    ) RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_walk_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_walk_request TO authenticated, service_role;

-- B. FIND NEARBY OFFERS
CREATE OR REPLACE FUNCTION public.get_available_walk_offers()
RETURNS TABLE (
    id uuid,
    customer_id uuid,
    customer_name text,
    pet_name text,
    pet_breed text,
    meeting_point_address text,
    distance_meters float,
    planned_duration_minutes integer,
    total_price_cents integer,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_geom geography(POINT, 4326);
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    
    SELECT last_known_location INTO v_walker_geom 
    FROM public.petwalker_profiles 
    WHERE user_id = auth.uid();

    IF v_walker_geom IS NULL THEN
        SELECT geom INTO v_walker_geom 
        FROM public.locations 
        WHERE user_id = auth.uid() AND is_default = true 
        LIMIT 1;
    END IF;

    IF v_walker_geom IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        s.id,
        s.customer_id,
        p.full_name as customer_name,
        pet.name as pet_name,
        pet.breed as pet_breed,
        s.meeting_point_address,
        ST_Distance(s.meeting_point_geom, v_walker_geom) as distance_meters,
        s.planned_duration_minutes,
        s.total_price_cents,
        s.created_at
    FROM public.walk_sessions s
    JOIN public.profiles p ON s.customer_id = p.id
    JOIN public.pets pet ON s.pet_id = pet.id
    WHERE s.current_status = 'searching'
      AND s.walker_id IS NULL
      AND s.matching_expires_at > now()
      AND ST_DWithin(s.meeting_point_geom, v_walker_geom, s.current_radius_meters)
      AND NOT EXISTS (SELECT 1 FROM public.walk_offers wo WHERE wo.session_id = s.id AND wo.walker_id = auth.uid() AND wo.status = 'declined')
      AND NOT EXISTS (SELECT 1 FROM public.walk_sessions active WHERE active.walker_id = auth.uid() AND active.current_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress'))
      AND EXISTS (
          SELECT 1 FROM public.petwalker_profiles pp 
          WHERE pp.user_id = auth.uid() 
            AND pp.approval_status = 'approved' 
            AND pp.availability_status = 'available'
      );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_available_walk_offers FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers TO authenticated, service_role;

-- C. ATOMIC ACCEPT
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated boolean;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    UPDATE public.walk_sessions
    SET 
        walker_id = auth.uid(),
        current_status = 'accepted',
        status = 'accepted',
        updated_at = now()
    WHERE id = _session_id 
      AND current_status = 'searching' 
      AND walker_id IS NULL
      AND matching_expires_at > now()
      AND EXISTS (
          SELECT 1 FROM public.petwalker_profiles pp 
          WHERE pp.user_id = auth.uid() 
            AND pp.approval_status = 'approved' 
            AND pp.availability_status = 'available'
            AND pp.user_id != (SELECT customer_id FROM public.walk_sessions WHERE id = _session_id)
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.walk_sessions active 
          WHERE active.walker_id = auth.uid() 
            AND active.current_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress')
      )
    RETURNING true INTO v_updated;

    IF NOT v_updated THEN
        RAISE EXCEPTION 'Solicitação indisponível ou você não atende aos requisitos.';
    END IF;

    UPDATE public.petwalker_profiles
    SET current_walk_id = _session_id
    WHERE user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_walk_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_walk_request TO authenticated, service_role;

-- D. UPDATE WALKER LOCATION
CREATE OR REPLACE FUNCTION public.update_walker_location(
    _lat numeric,
    _lng numeric,
    _accuracy numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    UPDATE public.petwalker_profiles
    SET 
        last_known_location = ST_SetSRID(ST_Point(_lng, _lat), 4326)::geography,
        last_location_at = now(),
        updated_at = now()
    WHERE user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_walker_location FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_walker_location TO authenticated, service_role;

-- E. RADIUS EXPANSION
CREATE OR REPLACE FUNCTION public.expand_walk_search_radius()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.walk_sessions
    SET 
        current_radius_meters = CASE 
            WHEN current_radius_meters < 5000 THEN 5000
            WHEN current_radius_meters < 8000 THEN 8000
            ELSE 12000
        END,
        last_expansion_at = now()
    WHERE current_status = 'searching'
      AND last_expansion_at < (now() - interval '3 minutes')
      AND current_radius_meters < 12000;
END;
$$;

-- F. GET ACTIVE WALKER LOCATION (Privacy enforced)
CREATE OR REPLACE FUNCTION public.get_active_walker_location(_session_id uuid)
RETURNS TABLE (lat numeric, lng numeric, last_updated timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    RETURN QUERY
    SELECT 
        ST_Y(pp.last_known_location::geometry)::numeric as lat,
        ST_X(pp.last_known_location::geometry)::numeric as lng,
        pp.last_location_at
    FROM public.petwalker_profiles pp
    JOIN public.walk_sessions s ON s.walker_id = pp.user_id
    WHERE s.id = _session_id
      AND (s.customer_id = auth.uid() OR s.walker_id = auth.uid())
      AND s.current_status IN ('accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_walker_location FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location TO authenticated, service_role;

-- 5. TRANSITION TRIGGERS
CREATE OR REPLACE FUNCTION public.fn_validate_walk_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.current_status = NEW.current_status THEN
        RETURN NEW;
    END IF;

    -- Basic state machine rules
    IF OLD.current_status = 'searching' AND NEW.current_status NOT IN ('accepted', 'cancelled', 'expired') THEN
        RAISE EXCEPTION 'Invalid transition from searching to %', NEW.current_status;
    END IF;

    -- Clean up current_walk_id on final states
    IF NEW.current_status IN ('completed', 'cancelled', 'expired') AND NEW.walker_id IS NOT NULL THEN
        UPDATE public.petwalker_profiles SET current_walk_id = NULL WHERE user_id = NEW.walker_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_walk_status ON public.walk_sessions;
CREATE TRIGGER trg_validate_walk_status
BEFORE UPDATE ON public.walk_sessions
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_walk_status_transition();
