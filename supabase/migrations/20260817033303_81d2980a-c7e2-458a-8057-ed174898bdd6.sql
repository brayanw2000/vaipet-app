ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS e2e_run_id text;
NOTIFY pgrst, 'reload schema';