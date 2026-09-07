-- Fix for approve_petwalker_application RPC
CREATE OR REPLACE FUNCTION public.approve_petwalker_application(application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
    END IF;

    SELECT user_id INTO _user_id 
    FROM public.petwalker_applications 
    WHERE id = application_id AND status = 'pending'
    FOR UPDATE;

    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'Candidatura não encontrada ou já processada' USING ERRCODE = 'P0002';
    END IF;

    IF _user_id = auth.uid() THEN
        RAISE EXCEPTION 'Não pode aprovar a própria candidatura' USING ERRCODE = '42501';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'approved',
        reviewed_at = now(),
        reviewed_by = auth.uid()
    WHERE id = application_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'petwalker')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.petwalker_profiles (user_id, approval_status, profile_completed)
    VALUES (_user_id, 'approved', false)
    ON CONFLICT (user_id) DO UPDATE
    SET approval_status = 'approved';
END;
$$;

REVOKE ALL ON FUNCTION public.approve_petwalker_application(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_petwalker_application(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_petwalker_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_petwalker_application(uuid) TO service_role;
