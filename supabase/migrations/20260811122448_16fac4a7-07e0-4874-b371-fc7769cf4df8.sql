CREATE OR REPLACE FUNCTION public.check_user_is_petwalker(email_address text)
RETURNS boolean AS $$
DECLARE
    v_user_id uuid;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = email_address;
    
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN public.has_role(v_user_id, 'petwalker');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.check_user_is_petwalker(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_user_is_petwalker(text) TO anon, authenticated, service_role;
