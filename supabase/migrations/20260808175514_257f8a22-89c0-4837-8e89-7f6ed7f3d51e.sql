DROP FUNCTION IF EXISTS public.petwalker_start_heading(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid);
DROP FUNCTION IF EXISTS public.petwalker_start_walk(uuid);
DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid);

CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'heading_to_pickup',
        status = 'heading_to_pickup',
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'accepted';
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'arrived',
        status = 'arrived',
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'heading_to_pickup';
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'in_progress',
        status = 'in_progress',
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'arrived';
END;
$$;

CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'completed',
        status = 'completed',
        end_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'in_progress';
      
    -- Simple earnings logic (mock for now, should be based on pricing snapshot)
    INSERT INTO petwalker_earnings (petwalker_id, walk_session_id, amount_cents, status)
    SELECT walker_id, id, total_price_cents, 'pending'
    FROM walk_sessions
    WHERE id = _session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_start_walk(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated;