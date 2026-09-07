CREATE OR REPLACE FUNCTION public.check_user_is_petwalker(email_address text)
RETURNS boolean AS $$
DECLARE
    is_walker boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 
        FROM public.profiles p
        JOIN public.user_roles ur ON p.id = ur.user_id
        WHERE p.email = email_address AND ur.role = 'petwalker'
    ) INTO is_walker;
    
    RETURN is_walker;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.check_user_is_petwalker(text) TO anon, authenticated;
