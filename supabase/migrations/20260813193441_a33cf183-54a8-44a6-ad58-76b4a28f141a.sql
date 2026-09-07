-- Migration 20260813193441: Unificação de status (current_status)
-- Somente backfill e trigger de espelhamento.

DO $$
BEGIN
    UPDATE public.walk_sessions
    SET current_status = CASE 
        WHEN status = 'active' THEN 'in_progress'::public.walk_status
        WHEN status = 'finished' THEN 'completed'::public.walk_status
        WHEN status = 'returning' THEN 'returning'::public.walk_status
        WHEN status = 'completed' THEN 'completed'::public.walk_status
        WHEN status = 'cancelled' THEN 'cancelled'::public.walk_status
        WHEN status = 'searching' THEN 'searching'::public.walk_status
        WHEN status = 'accepted' THEN 'accepted'::public.walk_status
        ELSE 'searching'::public.walk_status
    END
    WHERE current_status IS NULL;
END $$;

ALTER TABLE public.walk_sessions
ALTER COLUMN current_status SET DEFAULT 'searching',
ALTER COLUMN current_status SET NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_walk_session_status()
RETURNS TRIGGER AS $$
BEGIN
    NEW.status := NEW.current_status::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_walk_session_status ON public.walk_sessions;
CREATE TRIGGER trg_sync_walk_session_status
BEFORE INSERT OR UPDATE ON public.walk_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sync_walk_session_status();
