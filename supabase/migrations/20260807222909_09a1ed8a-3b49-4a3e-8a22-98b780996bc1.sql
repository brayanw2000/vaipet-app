-- 1. Correct handle_new_user to preserve all data and validate intent
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _intent public.signup_intent_type;
    _raw_intent text;
BEGIN
    _raw_intent := NEW.raw_user_meta_data->>'signup_intent';
    
    IF _raw_intent = 'petwalker' THEN
        _intent := 'petwalker';
    ELSE
        _intent := 'pet_owner';
    END IF;

    INSERT INTO public.profiles (
        id, 
        full_name, 
        avatar_url, 
        email, 
        phone, 
        signup_intent
    )
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.email,
        NEW.raw_user_meta_data->>'phone',
        _intent
    );
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    RETURN NEW;
END;
$$;

-- 2. Hardened petwalker_applications RLS for INSERT
DROP POLICY IF EXISTS "Users insert own pending applications" ON public.petwalker_applications;
CREATE POLICY "Users insert own pending applications" 
ON public.petwalker_applications 
FOR INSERT 
TO authenticated 
WITH CHECK (
    auth.uid() = user_id AND 
    status = 'pending' AND 
    reviewed_at IS NULL AND 
    reviewed_by IS NULL AND 
    rejection_reason IS NULL AND
    document_status = 'pending' AND
    (EXTRACT(YEAR FROM age(birth_date)) >= 18)
);

-- 3. Correct set_petwalker_availability to sync is_accepting_requests
CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_accepting boolean;
BEGIN
    IF _status NOT IN ('available', 'offline') THEN
        RAISE EXCEPTION 'Invalid status. Must be available or offline';
    END IF;

    -- Only approved petwalkers can change availability
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'petwalker'
    ) THEN
        RAISE EXCEPTION 'User does not have petwalker role';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = auth.uid() AND approval_status = 'approved'
    ) THEN
        RAISE EXCEPTION 'Petwalker profile not approved';
    END IF;

    v_is_accepting := (_status = 'available');

    UPDATE public.petwalker_profiles
    SET 
        availability_status = _status,
        is_accepting_requests = v_is_accepting,
        last_online_at = now(),
        updated_at = now()
    WHERE user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_petwalker_availability(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_petwalker_availability(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_petwalker_availability(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_petwalker_availability(text) TO service_role;
