CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule walk matching every 3 minutes
SELECT cron.schedule('walk-matching-job', '*/3 * * * *', 'SELECT public.process_walk_matching()');

-- Ensure it can only be called by service_role (already handled by SECURITY DEFINER and grants in previous turn, but let's be sure)
ALTER FUNCTION public.process_walk_matching() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.process_walk_matching() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;
