-- Admin Infrastructure
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    pa.id, 
    pa.legal_name, 
    pa.city, 
    pa.status::text, 
    pa.document_status, 
    pa.submitted_at, 
    pa.reviewed_at
  FROM public.petwalker_applications pa
  WHERE (SELECT public.has_role(auth.uid(), 'admin'))
  AND (_status IS NULL OR pa.status::text = _status);
$$;

GRANT EXECUTE ON FUNCTION public.get_petwalker_applications_admin(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_petwalker_application_admin(_application_id uuid)
RETURNS TABLE (
    id uuid,
    legal_name text,
    birth_date text,
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id, legal_name, birth_date, phone, city, experience_description, 
    emergency_contact_name, emergency_contact_phone, document_status, 
    status::text, rejection_reason, submitted_at, reviewed_at
  FROM public.petwalker_applications
  WHERE (SELECT public.has_role(auth.uid(), 'admin'))
  AND id = _application_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_petwalker_application_admin(uuid) TO authenticated;
