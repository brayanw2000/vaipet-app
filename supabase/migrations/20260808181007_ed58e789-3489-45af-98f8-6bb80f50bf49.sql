
-- 1. Unify walk_matching_settings table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_matching_settings' AND column_name='initial_radius_meters') THEN
        ALTER TABLE public.walk_matching_settings ADD COLUMN initial_radius_meters integer;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_matching_settings' AND column_name='max_radius_meters') THEN
        ALTER TABLE public.walk_matching_settings ADD COLUMN max_radius_meters integer;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_matching_settings' AND column_name='radius_expansion_step_meters') THEN
        ALTER TABLE public.walk_matching_settings ADD COLUMN radius_expansion_step_meters integer;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_matching_settings' AND column_name='session_expiry_minutes') THEN
        ALTER TABLE public.walk_matching_settings ADD COLUMN session_expiry_minutes integer;
    END IF;
END $$;

DO $$ 
DECLARE
    _col_name text;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_matching_settings' AND column_name='active') THEN
        _col_name := 'active';
    ELSE
        _col_name := 'is_active';
    END IF;

    EXECUTE format('UPDATE public.walk_matching_settings 
    SET 
      initial_radius_meters = COALESCE(initial_radius_meters, (initial_search_radius_km * 1000)::integer),
      max_radius_meters = COALESCE(max_radius_meters, (max_search_radius_km * 1000)::integer),
      radius_expansion_step_meters = COALESCE(radius_expansion_step_meters, (radius_expansion_step_km * 1000)::integer),
      session_expiry_minutes = COALESCE(session_expiry_minutes, max_search_duration_minutes),
      expansion_interval_minutes = 3
    WHERE %I = true', _col_name);
END $$;

-- 2. Clean up walk_offers schema
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_offers' AND column_name='walk_session_id') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_offers' AND column_name='session_id') THEN
            UPDATE public.walk_offers SET session_id = walk_session_id WHERE session_id IS NULL;
            ALTER TABLE public.walk_offers DROP COLUMN walk_session_id;
        ELSE
            ALTER TABLE public.walk_offers RENAME COLUMN walk_session_id TO session_id;
        END IF;
    END IF;
END $$;

-- 3. DROP ALL FUNCTIONS BEFORE RECREATING
DROP FUNCTION IF EXISTS public.get_available_walk_offers();
DROP FUNCTION IF EXISTS public.create_walk_request(uuid, double precision, double precision, integer, text, timestamptz);
DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid);
DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid, double precision);
DROP FUNCTION IF EXISTS public.petwalker_start_heading(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid);
DROP FUNCTION IF EXISTS public.petwalker_start_walk(uuid);
DROP FUNCTION IF EXISTS public.get_active_walker_location(uuid);
DROP FUNCTION IF EXISTS public.process_walk_matching();

-- 4. RECREATE FUNCTIONS

CREATE OR REPLACE FUNCTION public.get_available_walk_offers()
RETURNS TABLE (
    id uuid,
    session_id uuid,
    pet_name text,
    pet_avatar_url text,
    meeting_point_lat double precision,
    meeting_point_lng double precision,
    planned_duration_minutes integer,
    total_price_cents integer,
    distance_to_walker_meters double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _walker_lat double precision;
    _walker_lng double precision;
BEGIN
    IF NOT public.has_role(_walker_id, 'petwalker') THEN
        RAISE EXCEPTION 'Access denied: PetWalker role required.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE id = _walker_id 
          AND status = 'approved' 
          AND is_available = true 
          AND current_walk_id IS NULL
    ) THEN
        RETURN;
    END IF;

    SELECT last_lat, last_lng INTO _walker_lat, _walker_lng
    FROM public.petwalker_profiles
    WHERE id = _walker_id;

    RETURN QUERY
    SELECT 
        o.id,
        o.session_id,
        p.name as pet_name,
        p.avatar_url as pet_avatar_url,
        st_y(s.meeting_point_geom::geometry) as meeting_point_lat,
        st_x(s.meeting_point_geom::geometry) as meeting_point_lng,
        s.planned_duration_minutes,
        s.total_price_cents,
        st_distance(
            s.meeting_point_geom,
            st_setsrid(st_point(_walker_lng, _walker_lat), 4326)::geography
        ) as distance_to_walker_meters
    FROM public.walk_offers o
    JOIN public.walk_sessions s ON s.id = o.session_id
    JOIN public.pets p ON p.id = s.pet_id
    WHERE o.walker_id = _walker_id
      AND o.status = 'pending'
      AND s.status = 'searching';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_walk_request(
    _pet_id uuid,
    _lat double precision,
    _lng double precision,
    _duration_minutes integer,
    _mode text DEFAULT 'now',
    _scheduled_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session_id uuid;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    
    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = _user_id) THEN
        RAISE EXCEPTION 'Invalid pet';
    END IF;

    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
        RAISE EXCEPTION 'Invalid coordinates';
    END IF;

    IF _duration_minutes < 15 OR _duration_minutes % 15 != 0 THEN
        RAISE EXCEPTION 'Invalid duration (min 15, step 15)';
    END IF;

    IF _mode NOT IN ('now', 'scheduled') THEN
        RAISE EXCEPTION 'Invalid mode';
    END IF;

    INSERT INTO public.walk_sessions (
        owner_id,
        pet_id,
        status,
        meeting_point_geom,
        planned_duration_minutes,
        mode,
        scheduled_at
    ) VALUES (
        _user_id,
        _pet_id,
        'searching',
        st_setsrid(st_point(_lng, _lat), 4326)::geography,
        _duration_minutes,
        _mode,
        CASE WHEN _mode = 'now' THEN now() ELSE _scheduled_at END
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.walk_sessions 
        WHERE id = _session_id 
          AND walker_id = _walker_id 
          AND status = 'in_progress'
    ) THEN
        RAISE EXCEPTION 'Invalid walk or unauthorized';
    END IF;

    UPDATE public.walk_sessions 
    SET 
        status = 'completed',
        end_time = now()
    WHERE id = _session_id;

    UPDATE public.petwalker_profiles 
    SET current_walk_id = NULL 
    WHERE id = _walker_id;
    
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.walk_sessions SET status = 'heading_to_pickup' 
    WHERE id = _session_id AND walker_id = auth.uid() AND status = 'accepted';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.walk_sessions SET status = 'arrived' 
    WHERE id = _session_id AND walker_id = auth.uid() AND status = 'heading_to_pickup';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.walk_sessions SET status = 'in_progress', start_time = now() 
    WHERE id = _session_id AND walker_id = auth.uid() AND status = 'arrived';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.get_active_walker_location(_session_id uuid)
RETURNS TABLE (lat double precision, lng double precision, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        st_y(geom::geometry), st_x(geom::geometry), t.created_at
    FROM public.walker_tracking t
    JOIN public.walk_sessions s ON s.id = t.session_id
    WHERE s.id = _session_id 
      AND (s.owner_id = auth.uid() OR s.walker_id = auth.uid())
      AND s.status IN ('heading_to_pickup', 'arrived', 'in_progress')
    ORDER BY t.created_at DESC
    LIMIT 1;
END; $$;

CREATE OR REPLACE FUNCTION public.process_walk_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _settings record;
    _session record;
    _col_name text;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='walk_matching_settings' AND column_name='active') THEN
        _col_name := 'active';
    ELSE
        _col_name := 'is_active';
    END IF;

    EXECUTE format('SELECT * FROM public.walk_matching_settings WHERE %I = true LIMIT 1', _col_name) INTO _settings;
    IF _settings IS NULL THEN RETURN; END IF;

    FOR _session IN 
        SELECT id, meeting_point_geom, created_at, 
               extract(epoch from (now() - created_at)) / 60 as age_minutes
        FROM public.walk_sessions 
        WHERE status = 'searching' 
          AND mode = 'now'
    LOOP
        IF _session.age_minutes > _settings.session_expiry_minutes THEN
            UPDATE public.walk_sessions SET status = 'cancelled' WHERE id = _session.id;
            CONTINUE;
        END IF;

        DECLARE
            _intervals integer := floor(_session.age_minutes / _settings.expansion_interval_minutes);
            _current_radius integer := LEAST(
                _settings.initial_radius_meters + (_intervals * _settings.radius_expansion_step_meters),
                _settings.max_radius_meters
            );
        BEGIN
            INSERT INTO public.walk_offers (session_id, walker_id, status)
            SELECT _session.id, p.id, 'pending'
            FROM public.petwalker_profiles p
            WHERE p.status = 'approved' 
              AND p.is_available = true 
              AND p.current_walk_id IS NULL
              AND st_dwithin(
                  _session.meeting_point_geom,
                  st_setsrid(st_point(p.last_lng, p.last_lat), 4326)::geography,
                  _current_radius
              )
              AND NOT EXISTS (
                  SELECT 1 FROM public.walk_offers 
                  WHERE session_id = _session.id AND walker_id = p.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM public.walk_offers
                  WHERE session_id = _session.id AND walker_id = p.id AND status = 'declined'
              );
        END;
    END LOOP;
END;
$$;

-- 5. GRANTS
REVOKE ALL ON FUNCTION public.get_available_walk_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_walk_request(uuid, double precision, double precision, integer, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, double precision, double precision, integer, text, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_start_walk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated, service_role;
