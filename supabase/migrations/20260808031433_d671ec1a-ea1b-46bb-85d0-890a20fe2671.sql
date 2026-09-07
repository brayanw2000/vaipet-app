CREATE OR REPLACE FUNCTION public.ensure_current_user_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user record;
    _intent public.signup_intent_type;
BEGIN
    -- Only allow authenticated users
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Fetch user data from auth.users
    SELECT raw_user_meta_data, email INTO _user FROM auth.users WHERE id = auth.uid();
    
    -- Default intent
    _intent := 'pet_owner';
    
    -- Check if profile exists
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN
        INSERT INTO public.profiles (
            id, 
            full_name, 
            avatar_url, 
            email,
            signup_intent
        )
        VALUES (
            auth.uid(),
            _user.raw_user_meta_data->>'full_name',
            _user.raw_user_meta_data->>'avatar_url',
            _user.email,
            _intent
        )
        ON CONFLICT (id) DO NOTHING;
        
        -- Always create base user role
        INSERT INTO public.user_roles (user_id, role)
        VALUES (auth.uid(), 'user')
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_current_user_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_profile() TO authenticated, service_role;
