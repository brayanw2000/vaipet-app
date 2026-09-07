drop function if exists public.get_available_walk_offers();

create or replace function public.get_available_walk_offers()
returns table (
  id uuid,
  session_id uuid,
  walker_id uuid,
  offer_status walk_offer_status,
  created_at timestamptz,
  pet_name text,
  pet_breed text,
  pet_avatar_url text,
  distance_meters float8,
  duration_minutes integer,
  total_price_cents integer,
  matching_expires_at timestamptz
) 
language plpgsql
security definer
set search_path = public
as $$
declare
  _walker_id uuid;
  _walker_location geography(point);
begin
  _walker_id := auth.uid();
  
  -- Pega localização atual do walker
  select last_known_location into _walker_location
  from public.petwalker_profiles
  where user_id = _walker_id;

  if _walker_location is null then
    return;
  end if;

  return query
  select 
    o.id,
    o.session_id,
    o.walker_id,
    o.offer_status,
    o.created_at,
    p.name as pet_name,
    p.breed as pet_breed,
    p.avatar_url as pet_avatar_url,
    st_distance(_walker_location, s.start_location) as distance_meters,
    s.duration_minutes,
    s.total_price_cents,
    o.matching_expires_at
  from public.walk_offers o
  join public.walk_sessions s on s.id = o.session_id
  join public.pets p on p.id = s.pet_id
  where o.walker_id = _walker_id
    and o.offer_status = 'pending'
    and o.matching_expires_at > now()
    and s.current_status = 'searching'
  order by 
    o.matching_expires_at asc,
    st_distance(_walker_location, s.start_location) asc,
    o.created_at asc;
end;
$$;

grant execute on function public.get_available_walk_offers() to authenticated;
grant execute on function public.get_available_walk_offers() to service_role;