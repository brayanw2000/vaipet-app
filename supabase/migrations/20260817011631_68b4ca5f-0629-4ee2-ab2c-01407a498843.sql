-- FASE 4.1 — CORREÇÃO DE SEGURANÇA E ZERO-TRUST V2
-- Hardened PIN system and Proximity Validation

-- 1. Tabela de PINs com expiração e tentativas
CREATE TABLE IF NOT EXISTS public.walk_pickup_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES public.walk_sessions(id) ON DELETE CASCADE NOT NULL,
    pin_hash text NOT NULL,
    attempts integer DEFAULT 0,
    expires_at timestamptz DEFAULT (now() + interval '30 minutes'),
    created_at timestamptz DEFAULT now(),
    UNIQUE(session_id)
);

ALTER TABLE public.walk_pickup_codes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walk_pickup_codes TO service_role;

-- 2. Revogar acesso PUBLIC/Anon de todas as RPCs operacionais
-- Nota: O GRANT EXECUTE TO authenticated será feito após a definição para garantir Zero-Trust

-- 3. customer_get_pickup_code: Gera ou recupera PIN de 6 dígitos
CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session_record record;
    _pin text;
BEGIN
    SELECT * INTO _session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF _session_record.user_id IS DISTINCT FROM _user_id THEN 
        RAISE EXCEPTION 'Acesso negado. Apenas o dono do pet pode ver o PIN.'; 
    END IF;

    IF _session_record.current_status IN ('in_progress', 'returning', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'PIN indisponível para este status.';
    END IF;

    SELECT pin_hash INTO _pin 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id 
      AND expires_at > now()
      AND attempts < 5;

    IF _pin IS NULL THEN
        _pin := lpad(floor(random() * 1000000)::text, 6, '0');
        
        INSERT INTO public.walk_pickup_codes (session_id, pin_hash)
        VALUES (_session_id, _pin)
        ON CONFLICT (session_id) DO UPDATE 
        SET pin_hash = EXCLUDED.pin_hash, 
            attempts = 0, 
            expires_at = (now() + interval '30 minutes'),
            created_at = now();
    END IF;

    RETURN _pin;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

-- 4. petwalker_start_heading: PetWalker inicia deslocamento
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
BEGIN
    UPDATE public.walk_sessions
    SET current_status = 'heading_to_pickup',
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = _user_id
      AND current_status = 'accepted';
      
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

-- 5. petwalker_arrive_pickup: Valida proximidade GPS (150m)
CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(
    _session_id uuid,
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
    _user_id uuid := auth.uid();
    _session_record record;
    _dist_meters float;
BEGIN
    SELECT * INTO _session_record 
    FROM public.walk_sessions 
    WHERE id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada.'; END IF;
    IF _session_record.walker_id IS DISTINCT FROM _user_id THEN 
        RAISE EXCEPTION 'Acesso negado.'; 
    END IF;
    
    IF _session_record.current_status IS DISTINCT FROM 'heading_to_pickup' THEN
        RAISE EXCEPTION 'Status inválido para chegada.';
    END IF;

    _dist_meters := ST_Distance(
        ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(
            (_session_record.home_location->>'lng')::double precision, 
            (_session_record.home_location->>'lat')::double precision
        ), 4326)::geography
    );

    IF _dist_meters > (150 + LEAST(_accuracy, 50)) THEN
        RAISE EXCEPTION 'Você está muito longe do local de retirada (dist: %m).', round(_dist_meters::numeric, 2);
    END IF;

    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        updated_at = now()
    WHERE id = _session_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, double precision, double precision, double precision) TO authenticated;

-- 6. petwalker_confirm_pickup: Valida PIN e inicia passeio
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(_session_id uuid, _pickup_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _code_record record;
BEGIN
    PERFORM 1 FROM public.walk_sessions WHERE id = _session_id FOR UPDATE;

    SELECT * INTO _code_record 
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'PIN não gerado.'; END IF;
    IF _code_record.expires_at < now() THEN RAISE EXCEPTION 'PIN expirado.'; END IF;
    IF _code_record.attempts >= 5 THEN RAISE EXCEPTION 'Limite de tentativas excedido.'; END IF;

    IF _code_record.pin_hash IS DISTINCT FROM _pickup_code THEN
        UPDATE public.walk_pickup_codes SET attempts = attempts + 1 WHERE session_id = _session_id;
        RAISE EXCEPTION 'PIN incorreto.';
    END IF;

    UPDATE public.walk_sessions
    SET current_status = 'in_progress',
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id AND walker_id = _user_id AND current_status = 'arrived';

    DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- 7. Hardened completion: Revoga acesso authenticated
REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM authenticated;
