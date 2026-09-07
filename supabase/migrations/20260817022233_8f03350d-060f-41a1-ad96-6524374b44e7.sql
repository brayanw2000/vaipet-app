-- Add e2e_run_id column to walk_sessions for certification isolation
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_sessions' AND column_name = 'e2e_run_id') THEN
        ALTER TABLE public.walk_sessions ADD COLUMN e2e_run_id text;
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.walk_sessions TO authenticated;
GRANT ALL ON public.walk_sessions TO service_role;
