-- FASE 4.1 — CORREÇÃO DO TRIGGER AUTH PARA E2E
-- Permite que o setup E2E gerencie as roles sem conflitos do trigger handle_new_user

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    -- Cria o perfil
    INSERT INTO public.profiles (id, full_name, avatar_url, email)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url', NEW.email)
    ON CONFLICT (id) DO NOTHING;
    
    -- Cria a role 'user' APENAS se não for um teste E2E que já provisiona roles
    -- OU usa ON CONFLICT para evitar erros
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
