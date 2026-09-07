-- Ajustando a função RPC para garantir que ela seja acessível e robusta
CREATE OR REPLACE FUNCTION public.check_user_is_petwalker(email_address text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_walker boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 
        FROM public.profiles p
        LEFT JOIN public.user_roles ur ON p.id = ur.user_id
        WHERE p.email = email_address 
        AND (p.signup_intent = 'petwalker' OR ur.role = 'petwalker')
    ) INTO is_walker;
    
    RETURN COALESCE(is_walker, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_user_is_petwalker(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_user_is_petwalker(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_is_petwalker(text) TO service_role;
