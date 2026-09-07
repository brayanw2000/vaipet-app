-- PHASE 4.3 — PATCH 1 — CANONICAL COMPLETION BACKEND HARDENING
-- HEAD BASE REAL CERTIFICADO: 7b0e8ae8f889b8a43db7f731aa6a07dbffab7571

DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Drop all versions of functions to prevent parameter/return type conflicts
    FOR r IN (SELECT oid::regprocedure as proc FROM pg_proc WHERE proname IN (
        'customer_request_return', 'customer_confirm_arrival', 'petwalker_complete_walk'
    )) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proc;
    END LOOP;
END $$;

-- 1. customer_request_return
CREATE OR REPLACE FUNCTION public.customer_request_return(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session record;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

    -- Lock session row for atomic state transition
    SELECT * INTO _session 
    FROM public.walk_sessions 
    WHERE id = _session_id 
    FOR UPDATE;

    IF NOT FOUND THEN RETURN false; END IF;

    -- Strict authority check
    IF _session.customer_id <> _user_id THEN 
        RAISE EXCEPTION 'Only the customer can request a return' USING ERRCODE = '42501'; 
    END IF;

    -- State transition requirements
    IF _session.current_status <> 'in_progress' THEN 
        RETURN false; 
    END IF;

    UPDATE public.walk_sessions 
    SET current_status = 'returning', 
        status = 'returning',
        updated_at = now()
    WHERE id = _session_id;

    RETURN true;
END;
$$;

-- 2. customer_confirm_arrival
CREATE OR REPLACE FUNCTION public.customer_confirm_arrival(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session record;
    _distance_meters float := 0;
    _duration_minutes integer;
    _end_time timestamptz := now();
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

    -- Lock session row for atomic completion
    SELECT * INTO _session 
    FROM public.walk_sessions 
    WHERE id = _session_id 
    FOR UPDATE;

    IF NOT FOUND THEN RETURN false; END IF;

    -- Authority check
    IF _session.customer_id <> _user_id THEN 
        RAISE EXCEPTION 'Only the customer can confirm arrival' USING ERRCODE = '42501'; 
    END IF;

    -- Transition requirements
    IF _session.current_status <> 'returning' THEN 
        RETURN false; 
    END IF;

    -- Calculate duration (min 1 min)
    _duration_minutes := GREATEST(1, EXTRACT(EPOCH FROM (_end_time - _session.start_time)) / 60);

    -- Calculate distance using PostGIS ST_Length on walker_tracking points
    SELECT COALESCE(
        ST_Length(
            ST_MakeLine(location::geometry ORDER BY created_at)::geography
        ), 0
    ) INTO _distance_meters
    FROM public.walker_tracking
    WHERE walk_session_id = _session_id;

    -- Atomic completion update
    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        status = 'completed',
        end_time = _end_time,
        actual_duration_minutes = _duration_minutes,
        distance_km = _distance_meters / 1000.0,
        updated_at = now()
    WHERE id = _session_id;

    -- Release Walker
    IF _session.walker_id IS NOT NULL THEN
        UPDATE public.petwalker_profiles 
        SET current_walk_id = NULL 
        WHERE user_id = _session.walker_id;
    END IF;

    RETURN true;
END;
$$;

-- 3. petwalker_complete_walk (DEPRECATED/ADMIN ONLY)
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        status = 'completed', 
        end_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND current_status IN ('in_progress', 'returning');
    
    IF FOUND THEN
        UPDATE public.petwalker_profiles 
        SET current_walk_id = NULL 
        WHERE user_id = (SELECT walker_id FROM public.walk_sessions WHERE id = _session_id);
        RETURN true;
    END IF;
    RETURN false;
END; $$;

-- 4. STATE MACHINE HARDENING (Trigger)
CREATE OR REPLACE FUNCTION public.fn_validate_walk_status_transition_v3()
RETURNS TRIGGER AS $$
BEGIN
    -- Terminal states cannot change
    IF OLD.current_status IN ('completed', 'cancelled', 'expired') AND NEW.current_status <> OLD.current_status THEN
        RAISE EXCEPTION 'Terminal status % cannot be changed', OLD.current_status;
    END IF;

    -- Strict transition blocking: Must go through returning
    IF OLD.current_status = 'in_progress' AND NEW.current_status = 'completed' THEN
        RAISE EXCEPTION 'Cannot complete directly from in_progress. Must request return first.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validate_walk_status_transition ON public.walk_sessions;
CREATE TRIGGER tr_validate_walk_status_transition
    BEFORE UPDATE OF current_status ON public.walk_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_walk_status_transition_v3();

-- 5. ACL HARDENING
REVOKE EXECUTE ON FUNCTION public.customer_request_return(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_confirm_arrival(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_request_return(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_confirm_arrival(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO service_role;

-- 6. AUDIT: Synchronize status
CREATE OR REPLACE FUNCTION public.fn_sync_walk_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_status IS DISTINCT FROM OLD.current_status THEN
        NEW.status := NEW.current_status;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.current_status := NEW.status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_sync_walk_status ON public.walk_sessions;
CREATE TRIGGER tr_sync_walk_status
    BEFORE INSERT OR UPDATE OF status, current_status ON public.walk_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_sync_walk_status();
