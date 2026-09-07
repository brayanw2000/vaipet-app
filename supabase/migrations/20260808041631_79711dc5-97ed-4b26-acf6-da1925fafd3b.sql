-- Final Fix for Petwalker Operational Profile RPC
-- Removes the incorrect overload and redefines the original one correctly

-- 1. Remove the incorrect overload (integer service radius)
DROP FUNCTION IF EXISTS public.update_petwalker_operational_profile(
  text,
  integer,
  integer,
  integer
);

-- 2. Redefine the original signature (numeric service radius)
CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(
    _public_bio text,
    _experience_years integer,
    _service_radius_km numeric,
    _price_30_minutes integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 1. Auth check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- 2. Role check
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'petwalker'
    ) THEN
        RAISE EXCEPTION 'User does not have petwalker role' USING ERRCODE = '42501';
    END IF;

    -- 3. Status check
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = auth.uid() AND approval_status = 'approved'
    ) THEN
        RAISE EXCEPTION 'Approved petwalker profile not found' USING ERRCODE = '42501';
    END IF;

    -- 4. Server-side validation
    IF _public_bio IS NULL OR length(trim(_public_bio)) < 10 THEN
        RAISE EXCEPTION 'Bio must be at least 10 characters' USING ERRCODE = '22023';
    END IF;

    IF _experience_years < 0 OR _experience_years > 50 THEN
        RAISE EXCEPTION 'Experience years must be between 0 and 50' USING ERRCODE = '22023';
    END IF;

    IF _service_radius_km < 1 OR _service_radius_km > 50 THEN
        RAISE EXCEPTION 'Service radius must be between 1 and 50' USING ERRCODE = '22023';
    END IF;

    IF _price_30_minutes < 10 THEN
        RAISE EXCEPTION 'Price must be at least R$ 10' USING ERRCODE = '22023';
    END IF;

    -- 5. Atomic Update
    UPDATE public.petwalker_profiles
    SET 
        public_bio = _public_bio,
        experience_years = _experience_years,
        service_radius_km = _service_radius_km,
        price_30_minutes = _price_30_minutes,
        profile_completed = true,
        updated_at = now()
    WHERE user_id = auth.uid() 
      AND approval_status = 'approved';

    -- 6. Safety check
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to update petwalker profile' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- 3. Grants and Revokes
REVOKE ALL ON FUNCTION public.update_petwalker_operational_profile(text, integer, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_petwalker_operational_profile(text, integer, numeric, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, numeric, integer) TO service_role;
