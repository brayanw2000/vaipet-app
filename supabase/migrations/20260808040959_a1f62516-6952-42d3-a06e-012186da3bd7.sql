-- Fix for Petwalker Operational Profile completion
-- Atomic update of operational fields and marking profile as completed

CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(
    _public_bio text,
    _experience_years integer,
    _service_radius_km integer,
    _price_30_minutes integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 1. Check if user is authenticated
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- 2. Check if user has petwalker role
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'petwalker'
    ) THEN
        RAISE EXCEPTION 'User does not have petwalker role' USING ERRCODE = '42501';
    END IF;

    -- 3. Check if profile exists and is approved
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = auth.uid() AND approval_status = 'approved'
    ) THEN
        RAISE EXCEPTION 'Approved petwalker profile not found' USING ERRCODE = '42501';
    END IF;

    -- 4. Validate inputs (basic)
    IF length(_public_bio) < 10 THEN
        RAISE EXCEPTION 'Bio too short' USING ERRCODE = '22023';
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

    -- 6. Safety check: emit error if no row updated
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to update petwalker profile' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- Revoke and Grant
REVOKE ALL ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, integer) TO service_role;
