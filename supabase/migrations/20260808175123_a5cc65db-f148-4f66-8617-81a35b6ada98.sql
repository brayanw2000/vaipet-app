
-- 1. ENUM WALK_OFFER_STATUS
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'walk_offer_status') THEN
        CREATE TYPE public.walk_offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
    END IF;
END $$;

-- 2. UPDATE walk_offers SCHEMA
ALTER TABLE public.walk_offers ADD COLUMN IF NOT EXISTS offer_status_new public.walk_offer_status DEFAULT 'pending';

-- Migrate data if possible
UPDATE public.walk_offers SET offer_status_new = 'accepted' WHERE offer_status = 'accepted';
UPDATE public.walk_offers SET offer_status_new = 'declined' WHERE offer_status = 'cancelled';
UPDATE public.walk_offers SET offer_status_new = 'expired' WHERE offer_status = 'expired';

-- Drop old status fields and rename new one
ALTER TABLE public.walk_offers DROP COLUMN IF EXISTS status;
ALTER TABLE public.walk_offers DROP COLUMN IF EXISTS offer_status;
ALTER TABLE public.walk_offers RENAME COLUMN offer_status_new TO offer_status;

-- 3. REINFORCE accept_walk_request
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated boolean;
    v_walker_profile record;
BEGIN
    -- 1. Validation
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT * INTO v_walker_profile FROM public.petwalker_profiles WHERE user_id = auth.uid();
    
    IF v_walker_profile.user_id IS NULL THEN RAISE EXCEPTION 'Perfil PetWalker não encontrado'; END IF;
    IF v_walker_profile.approval_status != 'approved' THEN RAISE EXCEPTION 'Conta não aprovada'; END IF;
    IF v_walker_profile.availability_status != 'available' THEN RAISE EXCEPTION 'Você está offline'; END IF;
    
    IF v_walker_profile.current_walk_id IS NOT NULL THEN
         RAISE EXCEPTION 'Você já possui um passeio em andamento';
    END IF;
    
    IF EXISTS (SELECT 1 FROM public.walk_sessions WHERE walker_id = auth.uid() AND current_status NOT IN ('completed', 'cancelled', 'expired')) THEN
        RAISE EXCEPTION 'Você já possui um passeio em andamento';
    END IF;

    -- 2. Atomic Lock & Update
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
      AND customer_id != auth.uid()
      AND EXISTS (
          SELECT 1 FROM public.walk_offers wo 
          WHERE wo.session_id = _session_id 
            AND wo.walker_id = auth.uid() 
            AND wo.offer_status = 'pending'
      )
    RETURNING true INTO v_updated;

    IF NOT v_updated THEN
        RAISE EXCEPTION 'Solicitação indisponível, expirada ou você não possui uma oferta pendente para este passeio.';
    END IF;

    -- 3. Update offers status
    UPDATE public.walk_offers SET offer_status = 'accepted' WHERE session_id = _session_id AND walker_id = auth.uid();
    UPDATE public.walk_offers SET offer_status = 'expired' WHERE session_id = _session_id AND walker_id != auth.uid() AND offer_status = 'pending';
    
    -- 4. Assign walker to session
    UPDATE public.petwalker_profiles SET current_walk_id = _session_id WHERE user_id = auth.uid();
END;
$$;

-- 4. FIX decline_walk_offer
CREATE OR REPLACE FUNCTION public.decline_walk_offer(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.walk_offers
    SET offer_status = 'declined'
    WHERE session_id = _session_id AND walker_id = auth.uid() AND offer_status = 'pending';
END;
$$;

-- 5. FIX get_available_walk_offers
DROP FUNCTION IF EXISTS public.get_available_walk_offers();
CREATE OR REPLACE FUNCTION public.get_available_walk_offers()
RETURNS TABLE (
    id uuid,
    customer_name text,
    pet_name text,
    pet_breed text,
    meeting_point_address text,
    distance_meters float,
    planned_duration_minutes int,
    total_price_cents int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ws.id,
        p.full_name as customer_name,
        pet.name as pet_name,
        pet.breed as pet_breed,
        ws.meeting_point_address,
        ST_Distance(pp.last_known_location, ws.meeting_point_geom) as distance_meters,
        ws.planned_duration_minutes,
        ws.total_price_cents
    FROM public.walk_offers wo
    JOIN public.walk_sessions ws ON wo.session_id = ws.id
    JOIN public.profiles p ON ws.customer_id = p.id
    JOIN public.pets pet ON ws.pet_id = pet.id
    JOIN public.petwalker_profiles pp ON wo.walker_id = pp.user_id
    WHERE wo.walker_id = auth.uid()
      AND wo.offer_status = 'pending'
      AND ws.current_status = 'searching'
      AND ws.walker_id IS NULL
      AND ws.matching_expires_at > now();
END;
$$;

-- 6. CORRECT RADIUS EXPANSION IN process_walk_matching
CREATE OR REPLACE FUNCTION public.process_walk_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_settings record;
    v_session record;
    v_new_radius integer;
BEGIN
    SELECT * INTO v_settings FROM public.walk_matching_settings WHERE id = 1;

    -- 1. Activate scheduled walks
    UPDATE public.walk_sessions
    SET current_status = 'searching',
        matching_expires_at = now() + (v_settings.session_expiry_minutes * interval '1 minute'),
        last_expansion_at = now(),
        current_radius_meters = v_settings.initial_radius_meters
    WHERE current_status = 'scheduled'
      AND scheduled_for <= now();

    -- 2. Process active searches
    FOR v_session IN 
        SELECT id, meeting_point_geom, current_radius_meters, last_expansion_at 
        FROM public.walk_sessions 
        WHERE current_status = 'searching' 
          AND walker_id IS NULL 
          AND matching_expires_at > now()
    LOOP
        v_new_radius := v_session.current_radius_meters;
        
        IF v_session.last_expansion_at + (v_settings.expansion_interval_minutes * interval '1 minute') <= now() 
           AND v_session.current_radius_meters < v_settings.max_radius_meters THEN
           
            v_new_radius := LEAST(v_session.current_radius_meters + v_settings.expansion_step_meters, v_settings.max_radius_meters);
            
            UPDATE public.walk_sessions
            SET current_radius_meters = v_new_radius,
                last_expansion_at = now()
            WHERE id = v_session.id;
        END IF;

        INSERT INTO public.walk_offers (session_id, walker_id, offer_status)
        SELECT v_session.id, pp.user_id, 'pending'::public.walk_offer_status
        FROM public.petwalker_profiles pp
        WHERE pp.approval_status = 'approved'
          AND pp.availability_status = 'available'
          AND pp.current_walk_id IS NULL
          AND (pp.last_location_at > now() - interval '10 minutes')
          AND ST_DWithin(pp.last_known_location, v_session.meeting_point_geom, v_new_radius)
          AND NOT EXISTS (SELECT 1 FROM public.walk_offers wo WHERE wo.session_id = v_session.id AND wo.walker_id = pp.user_id)
          AND pp.user_id != (SELECT customer_id FROM public.walk_sessions WHERE id = v_session.id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- 3. Expire sessions
    UPDATE public.walk_sessions
    SET current_status = 'expired'
    WHERE current_status = 'searching'
      AND matching_expires_at <= now()
      AND walker_id IS NULL;
END;
$$;

-- 7. FIX create_walk_request SCHEDULING
CREATE OR REPLACE FUNCTION public.create_walk_request(
    _pet_id uuid,
    _duration_minutes int,
    _request_mode public.walk_request_mode,
    _scheduled_for timestamptz DEFAULT NULL,
    _meeting_point_lng float DEFAULT NULL,
    _meeting_point_lat float DEFAULT NULL,
    _meeting_point_address text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session_id uuid;
    v_initial_status public.walk_status;
    v_matching_expiry timestamptz;
    v_pricing record;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT * INTO v_pricing FROM public.get_walk_quote(_duration_minutes, _request_mode::text);

    IF _request_mode = 'now' THEN
        v_initial_status := 'searching';
        v_matching_expiry := now() + (interval '15 minutes');
    ELSE
        v_initial_status := 'scheduled';
        v_matching_expiry := NULL;
    END IF;

    INSERT INTO public.walk_sessions (
        customer_id,
        pet_id,
        planned_duration_minutes,
        request_mode,
        scheduled_for,
        current_status,
        status,
        matching_expires_at,
        meeting_point_geom,
        meeting_point_address,
        total_price_cents,
        price_per_minute_cents,
        request_surcharge_cents,
        pricing_version,
        start_time,
        walk_type
    ) VALUES (
        auth.uid(),
        _pet_id,
        _duration_minutes,
        _request_mode,
        _scheduled_for,
        v_initial_status,
        v_initial_status::text,
        v_matching_expiry,
        ST_SetSRID(ST_MakePoint(_meeting_point_lng, _meeting_point_lat), 4326),
        _meeting_point_address,
        v_pricing.total_price_cents,
        v_pricing.price_per_minute_cents,
        v_pricing.request_surcharge_cents,
        v_pricing.pricing_version,
        COALESCE(_scheduled_for, now()),
        'livre'
    ) RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

-- 8. OPERATIONAL ACTIONS FOR PETWALKERS
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'heading_to_pickup', status = 'heading_to_pickup', updated_at = now()
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status = 'accepted';
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'arrived', status = 'arrived', updated_at = now()
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status = 'heading_to_pickup';
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'in_progress', status = 'in_progress', start_time = now(), updated_at = now()
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status = 'arrived';
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid, _distance_km numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_session record;
    v_duration_min integer;
BEGIN
    SELECT * INTO v_session FROM public.walk_sessions WHERE id = _session_id AND walker_id = auth.uid();
    
    v_duration_min := EXTRACT(EPOCH FROM (now() - v_session.start_time)) / 60;

    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        status = 'completed', 
        end_time = now(), 
        actual_duration_minutes = GREATEST(1, v_duration_min),
        distance_km = _distance_km,
        updated_at = now()
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status = 'in_progress';
    
    UPDATE public.petwalker_profiles SET current_walk_id = NULL WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_walk(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid, numeric) TO authenticated;

-- 9. BETA SIMULATION AUTH
CREATE OR REPLACE FUNCTION public.is_beta_petwalker(_user_id uuid)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = _user_id AND role = 'petwalker'
    ) AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = _user_id AND email LIKE '%beta%'
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
