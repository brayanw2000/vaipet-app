DROP FUNCTION IF EXISTS public.get_available_walk_offers();

CREATE OR REPLACE FUNCTION public.get_available_walk_offers()
RETURNS TABLE (
    id uuid,
    customer_id uuid,
    customer_name text,
    pet_name text,
    pet_breed text,
    meeting_point_address text,
    distance_meters double precision,
    planned_duration_minutes integer,
    total_price_cents integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_lat double precision;
    v_walker_lng double precision;
BEGIN
    -- Get current walker location
    SELECT 
        ST_Y(last_known_location::geometry),
        ST_X(last_known_location::geometry)
    INTO v_walker_lat, v_walker_lng
    FROM petwalker_profiles
    WHERE user_id = auth.uid();

    IF v_walker_lat IS NULL OR v_walker_lng IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        ws.id,
        ws.customer_id,
        p.full_name as customer_name,
        pet.name as pet_name,
        pet.breed as pet_breed,
        ws.meeting_point_address,
        ST_Distance(
            ws.meeting_point_location,
            ST_SetSRID(ST_Point(v_walker_lng, v_walker_lat), 4326)::geography
        ) as distance_meters,
        ws.planned_duration_minutes,
        ws.total_price_cents
    FROM walk_sessions ws
    JOIN profiles p ON ws.customer_id = p.id
    JOIN pets pet ON ws.pet_id = pet.id
    JOIN walk_offers wo ON ws.id = wo.walk_session_id
    WHERE wo.walker_id = auth.uid()
      AND wo.offer_status = 'pending'
      AND ws.current_status = 'searching'
    ORDER BY distance_meters ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO authenticated;