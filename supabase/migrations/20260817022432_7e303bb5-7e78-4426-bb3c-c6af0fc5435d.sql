-- Resolve function ambiguity by dropping all overloads of petwalker_arrive_pickup
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid, float8, float8, float8);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid, numeric, numeric, numeric);

-- Recreate with single canonical signature
CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(
    _session_id uuid,
    _lat float8,
    _lng float8,
    _accuracy float8
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_home_loc jsonb;
    v_dist float8;
    v_walker_id uuid;
    v_status text;
    v_updated integer;
BEGIN
    IF _lat IS NULL OR _lng IS NULL OR _accuracy IS NULL THEN
        RAISE EXCEPTION 'Dados GPS incompletos';
    END IF;

    IF _accuracy < 0 OR _accuracy > 200 THEN
        RAISE EXCEPTION 'Precisão GPS insuficiente para confirmação';
    END IF;

    SELECT walker_id, current_status, home_location INTO v_walker_id, v_status, v_home_loc
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF v_walker_id IS NULL OR v_walker_id <> auth.uid() THEN
        RAISE EXCEPTION 'Somente o Walker designado pode realizar esta ação';
    END IF;

    IF v_status <> 'heading_to_pickup' THEN
        RAISE EXCEPTION 'Status inválido para chegada: %', v_status;
    END IF;

    SELECT ST_DistanceSphere(
        ST_MakePoint(_lng, _lat),
        ST_MakePoint((v_home_loc->>'lng')::float8, (v_home_loc->>'lat')::float8)
    ) INTO v_dist;

    IF v_dist > 150 THEN
        RAISE EXCEPTION 'Walker muito distante do ponto de retirada (%m)', round(v_dist::numeric, 2);
    END IF;

    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'heading_to_pickup';

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, float8, float8, float8) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, float8, float8, float8) TO service_role;

-- Fix grants for cleanup in E2E
GRANT DELETE ON public.petwalker_profiles TO service_role;
GRANT DELETE ON public.walk_pickup_codes TO service_role;
GRANT DELETE ON public.pets TO service_role;
GRANT DELETE ON public.profiles TO service_role;
GRANT DELETE ON public.user_roles TO service_role;
GRANT DELETE ON public.walk_sessions TO service_role;
