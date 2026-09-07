-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;

-- 2. SCHEMA UPDATES
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS geom geography(POINT, 4326);

DO $$ 
BEGIN
    UPDATE public.locations 
    SET geom = ST_SetSRID(ST_Point(longitude, latitude), 4326)::geography
    WHERE longitude IS NOT NULL AND latitude IS NOT NULL AND geom IS NULL;
EXCEPTION WHEN OTHERS THEN 
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_locations_geom ON public.locations USING GIST (geom);

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
ADD COLUMN IF NOT EXISTS meeting_point_address text,
ADD COLUMN IF NOT EXISTS scheduled_for timestamp with time zone;

DO $$ 
BEGIN
    UPDATE public.walk_sessions
    SET meeting_point_geom = ST_SetSRID(ST_Point((home_location->>'lng')::numeric, (home_location->>'lat')::numeric), 4326)::geography
    WHERE home_location IS NOT NULL AND meeting_point_geom IS NULL;
EXCEPTION WHEN OTHERS THEN 
    NULL;
END $$;

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

-- 4. WALKER TRACKING
CREATE TABLE IF NOT EXISTS public.walker_tracking (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_session_id uuid NOT NULL REFERENCES public.walk_sessions(id) ON DELETE CASCADE,
    geom geography(POINT, 4326) NOT NULL,
    accuracy numeric,
    created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_walker_tracking_session ON public.walker_tracking(walk_session_id, created_at DESC);
GRANT SELECT, INSERT ON public.walker_tracking TO authenticated;
GRANT ALL ON public.walker_tracking TO service_role;
ALTER TABLE public.walker_tracking ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Participants see tracking' AND tablename = 'walker_tracking') THEN
        CREATE POLICY "Participants see tracking" ON public.walker_tracking FOR SELECT
        USING (EXISTS (SELECT 1 FROM public.walk_sessions s WHERE s.id = walk_session_id AND (s.customer_id = auth.uid() OR s.walker_id = auth.uid())));
    END IF;
END $$;

-- 5. SECURE RPCs

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
    
    INSERT INTO public.walker_tracking (walk_session_id, geom, accuracy)
    SELECT current_walk_id, ST_SetSRID(ST_Point(_lng, _lat), 4326)::geography, _accuracy
    FROM public.petwalker_profiles
    WHERE user_id = auth.uid() AND current_walk_id IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_walker_location FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_walker_location TO authenticated, service_role;

-- E. STATE MACHINE
CREATE OR REPLACE FUNCTION public.fn_validate_walk_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.current_status = NEW.current_status THEN
        RETURN NEW;
    END IF;

    CASE OLD.current_status
        WHEN 'searching' THEN
            IF NEW.current_status NOT IN ('accepted', 'cancelled', 'expired') THEN
                RAISE EXCEPTION 'Invalid transition from searching to %', NEW.current_status;
            END IF;
        WHEN 'accepted' THEN
            IF NEW.current_status NOT IN ('heading_to_pickup', 'cancelled') THEN
                RAISE EXCEPTION 'Invalid transition from accepted to %', NEW.current_status;
            END IF;
        WHEN 'heading_to_pickup' THEN
            IF NEW.current_status NOT IN ('arrived', 'cancelled') THEN
                RAISE EXCEPTION 'Invalid transition from heading_to_pickup to %', NEW.current_status;
            END IF;
        WHEN 'arrived' THEN
            IF NEW.current_status NOT IN ('in_progress', 'cancelled') THEN
                RAISE EXCEPTION 'Invalid transition from arrived to %', NEW.current_status;
            END IF;
        WHEN 'in_progress' THEN
            IF NEW.current_status NOT IN ('returning', 'completed', 'cancelled') THEN
                RAISE EXCEPTION 'Invalid transition from in_progress to %', NEW.current_status;
            END IF;
        WHEN 'returning' THEN
            IF NEW.current_status NOT IN ('completed', 'cancelled') THEN
                RAISE EXCEPTION 'Invalid transition from returning to %', NEW.current_status;
            END IF;
    END CASE;

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
