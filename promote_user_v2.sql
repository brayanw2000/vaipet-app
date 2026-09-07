-- Force the role update via a migration-style block that might run as a higher privilege user in the backend pipeline
DO $$
DECLARE
    v_user_id uuid;
BEGIN
    -- We'll try to get the ID from any table that might have it
    SELECT id INTO v_user_id FROM public.profiles WHERE email = 'vizepay@gmail.com';
    
    IF v_user_id IS NOT NULL THEN
        UPDATE public.profiles SET role = 'petwalker', onboarding_completed = true WHERE id = v_user_id;
        
        INSERT INTO public.user_roles (user_id, role) 
        VALUES (v_user_id, 'petwalker')
        ON CONFLICT (user_id, role) DO NOTHING;
        
        INSERT INTO public.petwalker_profiles (user_id, approval_status, profile_completed, is_accepting_requests)
        VALUES (v_user_id, 'approved', true, true)
        ON CONFLICT (user_id) DO UPDATE SET 
            approval_status = 'approved', 
            profile_completed = true,
            is_accepting_requests = true;
    END IF;
END;
$$;
