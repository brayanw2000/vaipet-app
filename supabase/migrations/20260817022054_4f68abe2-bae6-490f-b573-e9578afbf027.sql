-- Add e2e_test column to pets for certification isolation
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'e2e_test') THEN
        ALTER TABLE public.pets ADD COLUMN e2e_test boolean DEFAULT false;
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pets TO authenticated;
GRANT ALL ON public.pets TO service_role;
