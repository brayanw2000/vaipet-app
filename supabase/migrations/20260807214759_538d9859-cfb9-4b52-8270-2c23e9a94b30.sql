-- Baseline Consolidation & Security Hardening Turn 2

-- 1. Correct PetWalker Applications Constraints & RLS
ALTER TABLE public.petwalker_applications DROP CONSTRAINT IF EXISTS valid_initial_status;

-- Re-apply RLS for INSERT with strict checks
DROP POLICY IF EXISTS "Users insert own pending applications" ON public.petwalker_applications;
CREATE POLICY "Users insert own pending applications" ON public.petwalker_applications 
FOR INSERT WITH CHECK (
    auth.uid() = user_id 
    AND status = 'pending' 
    AND reviewed_by IS NULL 
    AND reviewed_at IS NULL 
    AND rejection_reason IS NULL
    AND document_status = 'pending'
);

-- 2. Secure PetWalker Profile Access
DROP POLICY IF EXISTS "Anyone view approved profiles" ON public.petwalker_profiles;
CREATE POLICY "Anyone view approved profiles" ON public.petwalker_profiles 
FOR SELECT USING (false); -- Restricted to RPC

-- 3. Implement get_public_petwalker_profiles RPC
CREATE OR REPLACE FUNCTION public.get_public_petwalker_profiles()
RETURNS TABLE (
    user_id uuid,
    full_name text,
    avatar_url text,
    public_bio text,
    experience_years integer,
    service_radius_km numeric,
    price_30_minutes integer,
    rating_average numeric,
    completed_walks integer,
    availability_status text,
    is_accepting_requests boolean
) AS $$
BEGIN
    RETURN QUERY 
    SELECT 
        p.id as user_id,
        p.full_name,
        p.avatar_url,
        pw.public_bio,
        pw.experience_years,
        pw.service_radius_km,
        pw.price_30_minutes,
        pw.rating_average,
        pw.completed_walks,
        pw.availability_status,
        pw.is_accepting_requests
    FROM public.petwalker_profiles pw
    JOIN public.profiles p ON p.id = pw.user_id
    WHERE pw.approval_status = 'approved';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_public_petwalker_profiles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_petwalker_profiles() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_public_petwalker_profiles() TO authenticated, service_role;

-- 4. Finalize Storage Policies (Idempotent Bucket & Folder-scoped RLS)
-- Assume buckets pet-photos, pet-documents, product-images already inserted via previous attempts or manual config
-- This migration ensures the policies are consolidated.

-- Helper for folder-scoped validation
CREATE OR REPLACE FUNCTION public.check_storage_path(path text, user_id uuid)
RETURNS boolean AS $$
BEGIN
    RETURN path LIKE (user_id::text || '/%');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Pet Photos (Public)
DROP POLICY IF EXISTS "Owners manage own pet photos" ON storage.objects;
CREATE POLICY "Owners manage own pet photos" ON storage.objects
FOR ALL TO authenticated
USING (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Pet Documents (Private)
DROP POLICY IF EXISTS "Owners manage own pet documents" ON storage.objects;
CREATE POLICY "Owners manage own pet documents" ON storage.objects
FOR ALL TO authenticated
USING (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Product Images (Public - Petshop only)
DROP POLICY IF EXISTS "Petshops manage own product images" ON storage.objects;
CREATE POLICY "Petshops manage own product images" ON storage.objects
FOR ALL TO authenticated
USING (
    bucket_id = 'product-images' 
    AND (storage.foldername(name))[1] = auth.uid()::text 
    AND public.has_role(auth.uid(), 'petshop')
)
WITH CHECK (
    bucket_id = 'product-images' 
    AND (storage.foldername(name))[1] = auth.uid()::text 
    AND public.has_role(auth.uid(), 'petshop')
);
