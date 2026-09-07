-- PHASE 4.3 — PATCH 1B — FINAL AUDIT HARDENING (V4 FIX)

-- 1. HARDEN SYNC LOGIC (Fail-closed on divergence)
CREATE OR REPLACE FUNCTION public.fn_sync_walk_status_v4()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Case A: Only current_status changed
        IF NEW.current_status IS DISTINCT FROM OLD.current_status AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
            NEW.status := NEW.current_status;
        -- Case B: Only status changed
        ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
            NEW.current_status := NEW.status;
        -- Case C: Both changed to same value
        ELSIF NEW.status = NEW.current_status THEN
            NULL; -- Accept
        -- Case D: Divergence
        ELSE
            RAISE EXCEPTION 'status (%) and current_status (%) diverged during update', NEW.status, NEW.current_status
            USING ERRCODE = 'P0001';
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.current_status IS NOT NULL AND NEW.status IS NOT NULL THEN
            IF NEW.current_status <> NEW.status THEN
                RAISE EXCEPTION 'Initial status (%) and current_status (%) must match', NEW.status, NEW.current_status
                USING ERRCODE = 'P0001';
            END IF;
        ELSIF NEW.current_status IS NOT NULL THEN
            NEW.status := NEW.current_status;
        ELSIF NEW.status IS NOT NULL THEN
            NEW.current_status := NEW.status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. DETERMINISTIC TRIGGER ORDER
DROP TRIGGER IF EXISTS tr_01_sync_walk_status ON public.walk_sessions;
DROP TRIGGER IF EXISTS tr_02_validate_walk_status_transition ON public.walk_sessions;

-- Sync first
CREATE TRIGGER tr_01_sync_walk_status
    BEFORE INSERT OR UPDATE ON public.walk_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_sync_walk_status_v4();

-- Validate second
CREATE TRIGGER tr_02_validate_walk_status_transition
    BEFORE UPDATE ON public.walk_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_walk_status_transition_v5();
