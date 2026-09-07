-- Correction for Admin RPCs
-- 1. Revoke existing permissions
REVOKE ALL ON FUNCTION public.get_petwalker_applications_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_petwalker_applications_admin(text) FROM anon;

REVOKE ALL ON FUNCTION public.get_petwalker_application_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_petwalker_application_admin(uuid) FROM anon;

-- 2. Redefine get_petwalker_applications_admin
CREATE OR REPLACE FUNCTION public.get_petwalker_applications_admin(_status text DEFAULT NULL)
RETURNS TABLE (
    id uuid,
    legal_name text,
    city text,
    status text,
    document_status text,
    submitted_at timestamptz,
    reviewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
    END IF;

    -- Validate status if provided
    IF _status IS NOT NULL AND _status NOT IN ('pending', 'approved', 'rejected') THEN
        RAISE EXCEPTION 'Status inválido' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT 
        pa.id, 
        pa.legal_name, 
        pa.city, 
        pa.status::text, 
        pa.document_status, 
        pa.submitted_at, 
        pa.reviewed_at
    FROM public.petwalker_applications pa
    WHERE (_status IS NULL OR pa.status::text = _status)
    ORDER BY pa.submitted_at DESC;
END;
$$;

-- 3. Redefine get_petwalker_application_admin
DROP FUNCTION IF EXISTS public.get_petwalker_application_admin(uuid);
CREATE OR REPLACE FUNCTION public.get_petwalker_application_admin(_application_id uuid)
RETURNS TABLE (
    id uuid,
    legal_name text,
    birth_date date,
    phone text,
    city text,
    experience_description text,
    emergency_contact_name text,
    emergency_contact_phone text,
    document_status text,
    status text,
    rejection_reason text,
    submitted_at timestamptz,
    reviewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        pa.id, pa.legal_name, pa.birth_date, pa.phone, pa.city, pa.experience_description, 
        pa.emergency_contact_name, pa.emergency_contact_phone, pa.document_status, 
        pa.status::text, pa.rejection_reason, pa.submitted_at, pa.reviewed_at
    FROM public.petwalker_applications pa
    WHERE pa.id = _application_id;
END;
$$;

-- 4. Admin statistics RPC
CREATE OR REPLACE FUNCTION public.get_admin_application_stats()
RETURNS TABLE (
    pending_count bigint,
    approved_count bigint,
    rejected_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        COUNT(*) FILTER (WHERE status = 'pending'),
        COUNT(*) FILTER (WHERE status = 'approved'),
        COUNT(*) FILTER (WHERE status = 'rejected')
    FROM public.petwalker_applications;
END;
$$;

-- 5. Hardening and Grants
REVOKE ALL ON FUNCTION public.get_admin_application_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_application_stats() FROM anon;

GRANT EXECUTE ON FUNCTION public.get_petwalker_applications_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_petwalker_application_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_application_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_petwalker_applications_admin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_petwalker_application_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_application_stats() TO service_role;

-- Prevent admin from approving own application
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

    SELECT user_id INTO _user_id FROM public.petwalker_applications WHERE id = application_id;

    IF _user_id = auth.uid() THEN
        RAISE EXCEPTION 'Não pode aprovar a própria candidatura' USING ERRCODE = '42501';
    END IF;

    -- Update application
    UPDATE public.petwalker_applications
    SET status = 'approved',
        reviewed_at = now()
    WHERE id = application_id;

    -- Add role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'petwalker')
    ON CONFLICT DO NOTHING;

    -- Create/Update petwalker profile
    INSERT INTO public.petwalker_profiles (id, status, profile_completed)
    VALUES (_user_id, 'approved', true)
    ON CONFLICT (id) DO UPDATE
    SET status = 'approved',
        profile_completed = true;
END;
$$;
