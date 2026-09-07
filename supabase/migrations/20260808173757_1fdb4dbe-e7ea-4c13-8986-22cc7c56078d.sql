-- 1. ENUM RECONCILIATION
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'walk_status') THEN
        CREATE TYPE public.walk_status AS ENUM (
            'offered', 'searching', 'scheduled', 'accepted', 'heading_to_pickup', 
            'arrived', 'in_progress', 'returning', 'completed', 'cancelled', 'expired'
        );
    ELSE
        BEGIN
            ALTER TYPE public.walk_status ADD VALUE IF NOT EXISTS 'offered';
            ALTER TYPE public.walk_status ADD VALUE IF NOT EXISTS 'scheduled';
            ALTER TYPE public.walk_status ADD VALUE IF NOT EXISTS 'returning';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;
END $$;

-- 2. SCHEMA UNIFICATION (walk_sessions)
-- Drop default first to allow type change
ALTER TABLE public.walk_sessions ALTER COLUMN current_status DROP DEFAULT;

DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'walk_sessions' 
        AND column_name = 'current_status' 
        AND udt_name != 'walk_status'
    ) THEN
        ALTER TABLE public.walk_sessions 
        ALTER COLUMN current_status TYPE public.walk_status 
        USING current_status::text::public.walk_status;
    END IF;
END $$;

ALTER TABLE public.walk_sessions ALTER COLUMN current_status SET DEFAULT 'searching';

-- Canonicalize geography
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS meeting_point_geom geography(POINT, 4326);
CREATE INDEX IF NOT EXISTS idx_walk_sessions_meeting_geom ON public.walk_sessions USING GIST (meeting_point_geom);
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS current_radius_meters integer DEFAULT 2000;

-- 3. OFFER TABLE IMPROVEMENTS
ALTER TABLE public.walk_offers ADD COLUMN IF NOT EXISTS offer_status public.walk_status DEFAULT 'offered';
ALTER TABLE public.walk_offers DROP CONSTRAINT IF EXISTS walk_offers_session_walker_unique;
ALTER TABLE public.walk_offers ADD CONSTRAINT walk_offers_session_walker_unique UNIQUE (session_id, walker_id);

-- 4. MATCHING SETTINGS
CREATE TABLE IF NOT EXISTS public.walk_matching_settings (
    id integer PRIMARY KEY DEFAULT 1,
    initial_radius_meters integer DEFAULT 2000,
    max_radius_meters integer DEFAULT 10000,
    expansion_interval_minutes integer DEFAULT 3,
    expansion_step_meters integer DEFAULT 2000,
    session_expiry_minutes integer DEFAULT 15,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT one_row CHECK (id = 1)
);

INSERT INTO public.walk_matching_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.walk_matching_settings TO authenticated;
GRANT ALL ON public.walk_matching_settings TO service_role;

-- 5. MATCHING SCHEDULER
CREATE OR REPLACE FUNCTION public.process_walk_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_settings record;
    v_session record;
BEGIN
    SELECT * INTO v_settings FROM public.walk_matching_settings WHERE id = 1;

    UPDATE public.walk_sessions
    SET current_status = 'searching',
        matching_expires_at = now() + (v_settings.session_expiry_minutes * interval '1 minute'),
        last_expansion_at = now(),
        current_radius_meters = v_settings.initial_radius_meters
    WHERE current_status = 'scheduled'
      AND scheduled_for <= now();

    FOR v_session IN 
        SELECT id, meeting_point_geom, current_radius_meters, last_expansion_at 
        FROM public.walk_sessions 
        WHERE current_status = 'searching' 
          AND walker_id IS NULL 
          AND matching_expires_at > now()
    LOOP
        IF v_session.last_expansion_at + (v_settings.expansion_interval_minutes * interval '1 minute') <= now() 
           AND v_session.current_radius_meters < v_settings.max_radius_meters THEN
           
            UPDATE public.walk_sessions
            SET current_radius_meters = LEAST(v_session.current_radius_meters + v_settings.expansion_step_meters, v_settings.max_radius_meters),
                last_expansion_at = now()
            WHERE id = v_session.id;
        END IF;

        INSERT INTO public.walk_offers (session_id, walker_id)
        SELECT v_session.id, pp.user_id
        FROM public.petwalker_profiles pp
        WHERE pp.approval_status = 'approved'
          AND pp.availability_status = 'available'
          AND pp.current_walk_id IS NULL
          AND ST_DWithin(pp.last_known_location, v_session.meeting_point_geom, v_session.current_radius_meters)
          AND NOT EXISTS (SELECT 1 FROM public.walk_offers wo WHERE wo.session_id = v_session.id AND wo.walker_id = pp.user_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    UPDATE public.walk_sessions
    SET current_status = 'expired'
    WHERE current_status = 'searching'
      AND matching_expires_at <= now()
      AND walker_id IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_walk_matching FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_walk_matching TO service_role;

-- 6. RPC: CANCEL SESSION
CREATE OR REPLACE FUNCTION public.cancel_walk_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.walk_sessions
    SET current_status = 'cancelled',
        status = 'cancelled',
        updated_at = now()
    WHERE id = _session_id 
      AND (customer_id = auth.uid() OR walker_id = auth.uid())
      AND current_status NOT IN ('completed', 'cancelled', 'expired');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_walk_session TO authenticated;

-- 7. ATOMIC ACCEPT
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
          SELECT 1 FROM public.walk_offers wo 
          WHERE wo.session_id = _session_id 
            AND wo.walker_id = auth.uid() 
            AND wo.offer_status = 'offered'
      )
    RETURNING true INTO v_updated;

    IF NOT v_updated THEN
        RAISE EXCEPTION 'Solicitação indisponível ou você não recebeu esta oferta.';
    END IF;

    UPDATE public.walk_offers SET offer_status = 'accepted' WHERE session_id = _session_id AND walker_id = auth.uid();
    UPDATE public.walk_offers SET offer_status = 'expired' WHERE session_id = _session_id AND walker_id != auth.uid();
    UPDATE public.petwalker_profiles SET current_walk_id = _session_id WHERE user_id = auth.uid();
END;
$$;

-- 8. DECLINE OFFER
CREATE OR REPLACE FUNCTION public.decline_walk_offer(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.walk_offers
    SET offer_status = 'cancelled'
    WHERE session_id = _session_id AND walker_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_walk_offer TO authenticated;
