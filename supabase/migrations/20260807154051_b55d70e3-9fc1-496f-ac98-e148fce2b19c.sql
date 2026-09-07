-- Limpeza rigorosa de políticas de storage antes de recriar
DROP POLICY IF EXISTS "Public photos access" ON storage.objects;
DROP POLICY IF EXISTS "Upload pet photo" ON storage.objects;
DROP POLICY IF EXISTS "Update pet photo" ON storage.objects;
DROP POLICY IF EXISTS "Delete pet photo" ON storage.objects;

DROP POLICY IF EXISTS "Private documents access" ON storage.objects;
DROP POLICY IF EXISTS "Upload pet document" ON storage.objects;
DROP POLICY IF EXISTS "Update pet document" ON storage.objects;
DROP POLICY IF EXISTS "Delete pet document" ON storage.objects;

DROP POLICY IF EXISTS "Public products access" ON storage.objects;
DROP POLICY IF EXISTS "Upload product image" ON storage.objects;
DROP POLICY IF EXISTS "Update product image" ON storage.objects;
DROP POLICY IF EXISTS "Delete product image" ON storage.objects;

-- 1. Drop policy dependente
DROP POLICY IF EXISTS "Anyone view approved profiles" ON public.petwalker_profiles;

-- 2. Alter column
ALTER TABLE public.petwalker_profiles 
ALTER COLUMN approval_status DROP DEFAULT,
ALTER COLUMN approval_status TYPE public.application_status USING approval_status::text::public.application_status,
ALTER COLUMN approval_status SET DEFAULT 'pending';

-- 3. Restore policy
CREATE POLICY "Anyone view approved profiles" ON public.petwalker_profiles FOR SELECT USING (approval_status = 'approved');

-- 4. RPC Hardening
CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
RETURNS void AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'petwalker') THEN
        RAISE EXCEPTION 'Only approved petwalkers can change availability';
    END IF;

    IF _status NOT IN ('available', 'offline') THEN
        RAISE EXCEPTION 'Invalid status. Must be available or offline';
    END IF;

    UPDATE public.petwalker_profiles
    SET availability_status = _status, updated_at = now()
    WHERE user_id = auth.uid() AND approval_status = 'approved';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Approved Petwalker profile not found';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(_public_bio text, _experience_years integer, _service_radius_km numeric, _price_30_minutes integer)
RETURNS void AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'petwalker') THEN
        RAISE EXCEPTION 'Only approved petwalkers can update operational profile';
    END IF;

    IF _experience_years < 0 OR _experience_years > 50 THEN RAISE EXCEPTION 'Invalid experience'; END IF;
    IF _service_radius_km < 0 OR _service_radius_km > 100 THEN RAISE EXCEPTION 'Invalid radius'; END IF;
    IF _price_30_minutes < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;

    UPDATE public.petwalker_profiles
    SET public_bio = _public_bio, 
        experience_years = _experience_years, 
        service_radius_km = _service_radius_km, 
        price_30_minutes = _price_30_minutes, 
        updated_at = now()
    WHERE user_id = auth.uid() AND approval_status = 'approved';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Approved Petwalker profile not found';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Storage Policies
CREATE POLICY "Public photos access" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'pet-photos');
CREATE POLICY "Upload pet photo" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Update pet photo" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Delete pet photo" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Private documents access" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Upload pet document" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Update pet document" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Delete pet document" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public products access" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-images');
CREATE POLICY "Upload product image" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'petshop') AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Update product image" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Delete product image" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
