-- Baseline Schema (Security-Hardened & Validated)
-- Target: Zero-Trust architecture with server-side validation

-- 1. UTILITIES & EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pg_net" SCHEMA public;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 2. ENUMS
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'petshop', 'petwalker');
CREATE TYPE public.application_status AS ENUM ('pending', 'approved', 'rejected');

-- 3. TABLES

-- Profiles: Multi-layered protection
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    email text,
    phone text,
    bio text,
    avatar_url text,
    role text DEFAULT 'user',
    onboarding_completed boolean DEFAULT false,
    age integer DEFAULT 0,
    birthday date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- User Roles: Authority Source
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.app_role NOT NULL,
    UNIQUE (user_id, role)
);

-- Pets
CREATE TABLE public.pets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name text NOT NULL,
    breed text NOT NULL,
    age integer DEFAULT 0,
    gender text,
    weight numeric(10,2) DEFAULT 0.00,
    avatar_url text,
    behavioral_notes text,
    medical_info text,
    emergency_contact text,
    is_active boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- PetWalker Applications: Server-side validation
CREATE TABLE public.petwalker_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    legal_name text NOT NULL,
    birth_date date NOT NULL,
    phone text NOT NULL,
    city text NOT NULL,
    experience_description text NOT NULL,
    emergency_contact_name text NOT NULL,
    emergency_contact_phone text NOT NULL,
    status text DEFAULT 'pending',
    rejection_reason text,
    document_status text DEFAULT 'pending',
    submitted_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by uuid REFERENCES auth.users(id),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE (user_id),
    CONSTRAINT valid_initial_status CHECK (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
);

-- PetWalker Profiles: Metrics protection
CREATE TABLE public.petwalker_profiles (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_bio text,
    experience_years integer DEFAULT 0,
    service_radius_km numeric(10,2) DEFAULT 0.00,
    price_30_minutes integer DEFAULT 0,
    rating_average numeric(3,2) DEFAULT 0.00,
    completed_walks integer DEFAULT 0,
    cancellation_rate numeric(5,2) DEFAULT 0.00,
    is_accepting_requests boolean DEFAULT false,
    availability_status text DEFAULT 'offline',
    approval_status text DEFAULT 'pending',
    profile_completed boolean DEFAULT false,
    last_online_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Operational Tables
CREATE TABLE public.posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content text NOT NULL,
    image_url text,
    likes_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.post_likes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE (post_id, user_id)
);

CREATE TABLE public.post_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    petshop_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL DEFAULT 0.00,
    category text,
    dimensions text,
    weight numeric(10,2),
    origin_city text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.product_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    image_url text NOT NULL,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity integer NOT NULL DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE (product_id)
);

CREATE TABLE public.walk_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    walker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    pet_id uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    status text NOT NULL,
    walk_type text NOT NULL,
    planned_duration_minutes integer NOT NULL DEFAULT 0,
    actual_duration_minutes integer DEFAULT 0,
    distance_km numeric(10,2) DEFAULT 0.00,
    rating numeric(3,2),
    feedback text,
    home_location jsonb,
    local_stops jsonb,
    route_coordinates jsonb,
    walker_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.petwalker_earnings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    petwalker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    walk_session_id uuid REFERENCES public.walk_sessions(id) ON DELETE SET NULL,
    gross_amount numeric(10,2) NOT NULL DEFAULT 0.00,
    platform_fee numeric(10,2) NOT NULL DEFAULT 0.00,
    net_amount numeric(10,2) NOT NULL DEFAULT 0.00,
    status text,
    available_at timestamp with time zone,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text NOT NULL,
    message text NOT NULL,
    type text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    data jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name text NOT NULL,
    address text,
    city text,
    state text,
    postal_code text,
    latitude numeric(10,8) DEFAULT 0.00,
    longitude numeric(11,8) DEFAULT 0.00,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pet_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
    document_type text NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_size numeric NOT NULL,
    mime_type text NOT NULL,
    notes text,
    uploaded_at timestamp with time zone DEFAULT now(),
    uploaded_by uuid REFERENCES auth.users(id)
);

CREATE TABLE public.breed_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    breed text NOT NULL,
    photo_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pet_models_3d (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id uuid REFERENCES public.pets(id) ON DELETE CASCADE,
    breed text NOT NULL,
    glb_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- 4. SECURITY FUNCTIONS

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_profiles(user_ids uuid[])
RETURNS TABLE (id uuid, full_name text, avatar_url text, bio text) AS $$
BEGIN
    RETURN QUERY 
    SELECT p.id, p.full_name, p.avatar_url, p.bio 
    FROM public.profiles p
    WHERE p.id = ANY(user_ids);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, email)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url', NEW.email);
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.approve_petwalker_application(application_id uuid)
RETURNS void AS $$
DECLARE
    v_user_id uuid;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = application_id AND status = 'pending'
    RETURNING user_id INTO v_user_id;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Application not found or already reviewed';
    END IF;
    
    IF v_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot approve your own application';
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'petwalker')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.petwalker_profiles (user_id, approval_status)
    VALUES (v_user_id, 'approved')
    ON CONFLICT (user_id) DO UPDATE SET approval_status = 'approved';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.approve_petwalker_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_petwalker_application(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_petwalker_application(_application_id uuid, _reason text)
RETURNS json AS $$
DECLARE
    v_user_id uuid;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'rejected', rejection_reason = _reason, reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = _application_id AND status = 'pending'
    RETURNING user_id INTO v_user_id;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Application not found or already reviewed';
    END IF;

    UPDATE public.petwalker_profiles
    SET approval_status = 'rejected'
    WHERE user_id = v_user_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.reject_petwalker_application(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_petwalker_application(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
RETURNS void AS $$
BEGIN
    IF _status NOT IN ('available', 'offline') THEN
        RAISE EXCEPTION 'Invalid status. Must be available or offline';
    END IF;

    UPDATE public.petwalker_profiles
    SET availability_status = _status, updated_at = now()
    WHERE user_id = auth.uid();
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Petwalker profile not found';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.set_petwalker_availability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_petwalker_availability(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(_public_bio text, _experience_years integer, _service_radius_km numeric, _price_30_minutes integer)
RETURNS void AS $$
BEGIN
    IF _experience_years < 0 OR _experience_years > 50 THEN RAISE EXCEPTION 'Invalid experience'; END IF;
    IF _service_radius_km < 0 OR _service_radius_km > 100 THEN RAISE EXCEPTION 'Invalid radius'; END IF;
    IF _price_30_minutes < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;

    UPDATE public.petwalker_profiles
    SET public_bio = _public_bio, 
        experience_years = _experience_years, 
        service_radius_km = _service_radius_km, 
        price_30_minutes = _price_30_minutes, 
        updated_at = now()
    WHERE user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Petwalker profile not found';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, numeric, integer) TO authenticated, service_role;

-- 5. RLS & GRANTS

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, bio, avatar_url, birthday, age, onboarding_completed) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.petwalker_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.petwalker_applications TO authenticated;
GRANT ALL ON public.petwalker_applications TO service_role;
CREATE POLICY "Users view own applications" ON public.petwalker_applications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own pending applications" ON public.petwalker_applications FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.petwalker_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.petwalker_profiles TO authenticated;
GRANT ALL ON public.petwalker_profiles TO service_role;
CREATE POLICY "Petwalkers view own profile" ON public.petwalker_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Anyone view approved profiles" ON public.petwalker_profiles FOR SELECT USING (approval_status = 'approved');

ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pets TO authenticated;
GRANT ALL ON public.pets TO service_role;
CREATE POLICY "Owners manage own pets" ON public.pets FOR ALL USING (auth.uid() = owner_id);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
CREATE POLICY "Anyone view posts" ON public.posts FOR SELECT USING (true);
CREATE POLICY "Users manage own posts" ON public.posts FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.post_likes TO authenticated;
GRANT ALL ON public.post_likes TO service_role;
CREATE POLICY "Users manage own likes" ON public.post_likes FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.post_comments TO authenticated;
GRANT ALL ON public.post_comments TO service_role;
CREATE POLICY "Users manage own comments" ON public.post_comments FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
CREATE POLICY "Anyone view products" ON public.products FOR SELECT USING (is_active = true);
CREATE POLICY "Petshops manage own products" ON public.products FOR ALL USING (public.has_role(auth.uid(), 'petshop') AND auth.uid() = petshop_id);

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.product_images TO authenticated;
GRANT ALL ON public.product_images TO service_role;
CREATE POLICY "Anyone view images" ON public.product_images FOR SELECT USING (true);
CREATE POLICY "Petshops manage images" ON public.product_images FOR ALL USING (EXISTS (SELECT 1 FROM public.products WHERE id = product_id AND petshop_id = auth.uid()));

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.inventory TO authenticated;
GRANT ALL ON public.inventory TO service_role;
CREATE POLICY "Petshops manage inventory" ON public.inventory FOR ALL USING (EXISTS (SELECT 1 FROM public.products WHERE id = product_id AND petshop_id = auth.uid()));

ALTER TABLE public.walk_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.walk_sessions TO authenticated;
GRANT ALL ON public.walk_sessions TO service_role;
CREATE POLICY "Participants view walks" ON public.walk_sessions FOR SELECT USING (auth.uid() = customer_id OR auth.uid() = walker_id);
CREATE POLICY "Customers request walks" ON public.walk_sessions FOR INSERT WITH CHECK (auth.uid() = customer_id);

ALTER TABLE public.petwalker_earnings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.petwalker_earnings TO authenticated;
GRANT ALL ON public.petwalker_earnings TO service_role;
CREATE POLICY "Petwalkers view own earnings" ON public.petwalker_earnings FOR SELECT USING (auth.uid() = petwalker_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
CREATE POLICY "Users manage own notifications" ON public.notifications FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
CREATE POLICY "Users manage own locations" ON public.locations FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.pet_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.pet_documents TO authenticated;
GRANT ALL ON public.pet_documents TO service_role;
CREATE POLICY "Owners manage pet documents" ON public.pet_documents FOR ALL USING (EXISTS (SELECT 1 FROM public.pets WHERE id = pet_id AND owner_id = auth.uid()));

ALTER TABLE public.breed_photos ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.breed_photos TO authenticated;
GRANT ALL ON public.breed_photos TO service_role;
CREATE POLICY "Anyone view photos" ON public.breed_photos FOR SELECT USING (true);

ALTER TABLE public.pet_models_3d ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pet_models_3d TO authenticated;
GRANT ALL ON public.pet_models_3d TO service_role;
CREATE POLICY "Anyone view models" ON public.pet_models_3d FOR SELECT USING (true);

-- 6. STORAGE

-- Buckets (Note: assume created via API, here we define RLS)
CREATE POLICY "Public photos access" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'pet-photos');
CREATE POLICY "Upload pet photo" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Private documents access" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Upload pet document" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public products access" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-images');
CREATE POLICY "Upload product image" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'petshop'));

-- 7. TRIGGERS

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pets_updated_at BEFORE UPDATE ON public.pets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_petwalker_profiles_updated_at BEFORE UPDATE ON public.petwalker_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. STORAGE CONFIGURATION
-- Ensure buckets exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('pet-photos', 'pet-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('pet-documents', 'pet-documents', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    ('product-images', 'product-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET 
    public = EXCLUDED.public, 
    file_size_limit = EXCLUDED.file_size_limit, 
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage Policies: Canonical path {userId}/{category}/...
-- Pet Photos (Avatars, Pets, Posts)
CREATE POLICY "Users manage own pet photos" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'pet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public read pet photos" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'pet-photos');

-- Pet Documents (Private)
CREATE POLICY "Users manage own documents" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'pet-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Product Images
CREATE POLICY "Petshops manage own product images" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public read product images" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'product-images');
