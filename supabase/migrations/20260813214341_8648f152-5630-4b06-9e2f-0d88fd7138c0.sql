DROP FUNCTION IF EXISTS public.get_active_walker_location(uuid);

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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.walk_sessions ws
        WHERE ws.id = _session_id
          AND (ws.customer_id = auth.uid() OR ws.walker_id = auth.uid())
    ) THEN
        RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        ST_Y(wt.location::geometry)::double precision,
        ST_X(wt.location::geometry)::double precision,
        wt.accuracy::double precision,
        wt.created_at
    FROM public.walker_tracking wt
    WHERE wt.walk_session_id = _session_id
    ORDER BY wt.created_at DESC
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_walker_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated, service_role;