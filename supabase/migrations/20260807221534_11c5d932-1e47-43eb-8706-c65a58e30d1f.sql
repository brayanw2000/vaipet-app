DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signup_intent_type') THEN
        CREATE TYPE public.signup_intent_type AS ENUM ('pet_owner', 'petwalker');
    END IF;
END $$;

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS signup_intent public.signup_intent_type NOT NULL DEFAULT 'pet_owner';

CREATE OR REPLACE FUNCTION public.set_signup_intent(_intent public.signup_intent_type)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    UPDATE public.profiles
    SET signup_intent = _intent,
        updated_at = now()
    WHERE id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_signup_intent(public.signup_intent_type) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_signup_intent(public.signup_intent_type) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_signup_intent(public.signup_intent_type) TO authenticated;

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

    INSERT INTO public.profiles (id, full_name, avatar_url, signup_intent)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url',
        _intent
    );
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    RETURN NEW;
END;
$$;
