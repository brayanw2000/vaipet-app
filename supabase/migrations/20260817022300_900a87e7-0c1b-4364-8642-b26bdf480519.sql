-- Add e2e_test column to walk_sessions for certification isolation
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_sessions' AND column_name = 'e2e_test') THEN
        ALTER TABLE public.walk_sessions ADD COLUMN e2e_test boolean DEFAULT false;
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.walk_sessions TO authenticated;
GRANT ALL ON public.walk_sessions TO service_role;
