-- FASE 4.1 — CORREÇÃO DE SCHEMA E CACHE PARA E2E
-- Adiciona colunas e2e_test faltantes e força refresh do cache

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'e2e_test') THEN
        ALTER TABLE public.profiles ADD COLUMN e2e_test boolean DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'e2e_test') THEN
        ALTER TABLE public.pets ADD COLUMN e2e_test boolean DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'petwalker_profiles' AND column_name = 'e2e_test') THEN
        ALTER TABLE public.petwalker_profiles ADD COLUMN e2e_test boolean DEFAULT false;
    END IF;
END $$;

-- Garantir GRANTs para o service_role
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.pets TO service_role;
GRANT ALL ON public.petwalker_profiles TO service_role;
GRANT ALL ON public.walk_sessions TO service_role;
GRANT ALL ON public.walk_pickup_codes TO service_role;

-- Force notify PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
