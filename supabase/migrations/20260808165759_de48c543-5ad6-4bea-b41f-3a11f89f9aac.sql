
-- FASE 3: MATCHING, SOLICITAÇÃO REAL E LOCALIZAÇÃO

-- 1. EXTENSÕES GEOESPACIAIS (PostGIS)
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;

-- 2. ENUMS DE ESTADO DA SOLICITAÇÃO
DO $$ BEGIN
    CREATE TYPE public.walk_session_status AS ENUM (
        'searching',        -- Dono solicitou, procurando walkers
        'offered',          -- Walker recebeu oferta
        'accepted',         -- Walker aceitou
        'heading_to_pickup',-- Walker a caminho do pet
        'arrived',          -- Walker chegou no local de encontro
        'in_progress',      -- Passeio iniciado
        'completed',        -- Passeio finalizado com sucesso
        'cancelled',        -- Cancelado por Dono ou Walker
        'expired'           -- Ninguém aceitou no tempo limite
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. ADAPTAÇÃO DA TABELA WALK_SESSIONS
ALTER TABLE public.walk_sessions 
ADD COLUMN IF NOT EXISTS meeting_point_location geometry(Point, 4326),
ADD COLUMN IF NOT EXISTS meeting_point_address text,
ADD COLUMN IF NOT EXISTS search_radius_km numeric(10,2) DEFAULT 2.0,
ADD COLUMN IF NOT EXISTS search_started_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS petwalker_notified_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS current_status public.walk_session_status DEFAULT 'searching',
ADD COLUMN IF NOT EXISTS pet_ids uuid[] DEFAULT '{}';

-- 4. TABELA DE LOCALIZAÇÃO EM TEMPO REAL (TRACKING)
CREATE TABLE public.walker_tracking (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    walker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    walk_session_id uuid REFERENCES public.walk_sessions(id) ON DELETE CASCADE,
    location geometry(Point, 4326) NOT NULL,
    accuracy numeric,
    heading numeric,
    speed numeric,
    is_simulated boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- 5. CONFIGURAÇÕES DE MATCHING (PLATAFORMA)
CREATE TABLE public.walk_matching_settings (
    id integer PRIMARY KEY DEFAULT 1,
    initial_search_radius_km numeric DEFAULT 2.0,
    max_search_radius_km numeric DEFAULT 15.0,
    radius_expansion_step_km numeric DEFAULT 3.0,
    expansion_interval_minutes integer DEFAULT 3,
    max_search_duration_minutes integer DEFAULT 15,
    active boolean DEFAULT true,
    CHECK (id = 1)
);

INSERT INTO public.walk_matching_settings (id, initial_search_radius_km, max_search_radius_km, radius_expansion_step_km, expansion_interval_minutes, max_search_duration_minutes)
VALUES (1, 2.0, 15.0, 3.0, 3, 15)
ON CONFLICT (id) DO NOTHING;

-- 6. RPC: CRIAR SOLICITAÇÃO REAL
CREATE OR REPLACE FUNCTION public.create_walk_request(
    _pet_ids uuid[],
    _planned_duration_minutes integer,
    _request_mode public.walk_request_mode,
    _scheduled_for timestamp with time zone,
    _meeting_lng numeric,
    _meeting_lat numeric,
    _meeting_address text,
    _walk_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session_id uuid;
    v_pet_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    IF array_length(_pet_ids, 1) = 0 THEN RAISE EXCEPTION 'Selecione pelo menos um pet'; END IF;
    
    v_pet_id := _pet_ids[1]; 

    INSERT INTO public.walk_sessions (
        customer_id,
        pet_id,
        pet_ids,
        planned_duration_minutes,
        request_mode,
        scheduled_for,
        meeting_point_location,
        meeting_point_address,
        walk_type,
        current_status,
        search_radius_km,
        search_started_at,
        start_time,
        status 
    ) VALUES (
        auth.uid(),
        v_pet_id,
        _pet_ids,
        _planned_duration_minutes,
        _request_mode,
        _scheduled_for,
        ST_SetSRID(ST_MakePoint(_meeting_lng, _meeting_lat), 4326),
        _meeting_address,
        _walk_type,
        'searching',
        2.0,
        now(),
        COALESCE(_scheduled_for, now()),
        'requested'
    ) RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

-- 7. RPC: ACEITE ATÔMICO
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    
    IF NOT public.has_role(auth.uid(), 'petwalker') THEN
        RAISE EXCEPTION 'Apenas PetWalkers aprovados podem aceitar solicitações';
    END IF;

    UPDATE public.walk_sessions
    SET 
        walker_id = auth.uid(),
        current_status = 'accepted',
        status = 'accepted',
        updated_at = now()
    WHERE id = _session_id 
      AND current_status = 'searching' 
      AND walker_id IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitação indisponível ou já aceita';
    END IF;
END;
$$;

-- 8. RPC: ATUALIZAR LOCALIZAÇÃO
CREATE OR REPLACE FUNCTION public.update_walker_location(
    _session_id uuid,
    _lng numeric,
    _lat numeric,
    _accuracy numeric DEFAULT NULL,
    _heading numeric DEFAULT NULL,
    _speed numeric DEFAULT NULL,
    _is_simulated boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.walk_sessions 
        WHERE id = _session_id AND walker_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Não autorizado a enviar localização para esta sessão';
    END IF;

    INSERT INTO public.walker_tracking (
        walker_id,
        walk_session_id,
        location,
        accuracy,
        heading,
        speed,
        is_simulated
    ) VALUES (
        auth.uid(),
        _session_id,
        ST_SetSRID(ST_MakePoint(_lng, _lat), 4326),
        _accuracy,
        _heading,
        _speed,
        _is_simulated
    );
END;
$$;

-- 9. RLS & GRANTS
ALTER TABLE public.walker_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view assigned session tracking" ON public.walker_tracking
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.walk_sessions
        WHERE id = walk_session_id AND (customer_id = auth.uid() OR walker_id = auth.uid())
    )
);

GRANT ALL ON public.walker_tracking TO service_role;
GRANT SELECT, INSERT ON public.walker_tracking TO authenticated;

GRANT SELECT ON public.walk_matching_settings TO authenticated;
GRANT ALL ON public.walk_matching_settings TO service_role;

GRANT EXECUTE ON FUNCTION public.create_walk_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_walk_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location TO authenticated;
