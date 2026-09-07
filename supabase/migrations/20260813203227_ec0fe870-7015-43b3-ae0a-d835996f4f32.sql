-- 1. Remove overload legado de create_walk_request (usava colunas inexistentes)
DROP FUNCTION IF EXISTS public.create_walk_request(
  _duration_minutes integer,
  _meeting_point_address text,
  _meeting_point_lat double precision,
  _meeting_point_lng double precision,
  _pet_id uuid,
  _request_mode public.walk_request_mode,
  _scheduled_for timestamptz
);

-- 2. Remove overload legado de get_walk_quote (preço fixo hardcoded)
DROP FUNCTION IF EXISTS public.get_walk_quote(_duration_minutes integer, _request_mode text);

-- 3. Reescreve get_available_walk_offers com o schema canônico
DROP FUNCTION IF EXISTS public.get_available_walk_offers();

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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _walker_id uuid := auth.uid();
  _walker_loc geography;
BEGIN
  IF _walker_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.has_role(_walker_id, 'petwalker') THEN
    RAISE EXCEPTION 'Acesso negado: role petwalker necessária';
  END IF;

  SELECT pp.last_known_location INTO _walker_loc
  FROM public.petwalker_profiles pp
  WHERE pp.user_id = _walker_id
    AND pp.approval_status = 'approved'
    AND pp.availability_status = 'available'
    AND pp.is_accepting_requests = true
    AND pp.current_walk_id IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.session_id,
    p.name,
    p.avatar_url,
    st_y(s.meeting_point_geom::geometry)::double precision,
    st_x(s.meeting_point_geom::geometry)::double precision,
    s.planned_duration_minutes,
    s.total_price_cents,
    CASE
      WHEN _walker_loc IS NULL THEN NULL::double precision
      ELSE st_distance(s.meeting_point_geom, _walker_loc)::double precision
    END
  FROM public.walk_offers o
  JOIN public.walk_sessions s ON s.id = o.session_id
  JOIN public.pets p ON p.id = s.pet_id
  WHERE o.walker_id = _walker_id
    AND o.offer_status = 'pending'
    AND s.current_status = 'searching'
    AND (s.matching_expires_at IS NULL OR s.matching_expires_at > now())
  ORDER BY o.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_walk_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO authenticated;