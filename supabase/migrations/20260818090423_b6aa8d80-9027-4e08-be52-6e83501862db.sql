-- PHASE 4.3 — PATCH 1A RECONCILIATION
-- HARDENED STATE MACHINE + AUTHORIZED COMPLETION

-- 1. DROP FUNCTIONS to redefine
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT oid::regprocedure as proc FROM pg_proc WHERE proname IN (
        'customer_request_return', 'customer_confirm_arrival', 'petwalker_complete_walk'
    )) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proc;
    END LOOP;
END $$;

-- 2. customer_request_return
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

-- 3. customer_confirm_arrival
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
    _tracking_count integer;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

    SELECT * INTO _session 
    FROM public.walk_sessions 
    WHERE id = _session_id 
    FOR UPDATE;

    IF NOT FOUND THEN RETURN false; END IF;

    -- Authority check
    IF _session.customer_id <> _user_id THEN 
        RAISE EXCEPTION 'Only the customer can confirm arrival' USING ERRCODE = '42501'; 
    END IF;

    -- Transition requirements: ONLY from returning
    IF _session.current_status <> 'returning' THEN 
        RETURN false; 
    END IF;

    -- Calculate duration (min 1 min)
    _duration_minutes := GREATEST(1, EXTRACT(EPOCH FROM (_end_time - _session.start_time)) / 60);

    -- Calculate distance using PostGIS ST_Length on walker_tracking points
    -- Requirement 3: Explicit point counting
    SELECT COUNT(*) INTO _tracking_count
    FROM public.walker_tracking
    WHERE walk_session_id = _session_id;

    IF _tracking_count >= 2 THEN
        SELECT COALESCE(
            ST_Length(
                ST_MakeLine(location::geometry ORDER BY created_at)::geography
            ), 0
        ) INTO _distance_meters
        FROM public.walker_tracking
        WHERE walk_session_id = _session_id;
    ELSE
        _distance_meters := 0;
    END IF;

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

-- 4. petwalker_complete_walk (DEPRECATED/ADMIN ONLY)
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Even for service_role, restrict to returning -> completed
    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        status = 'completed', 
        end_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND current_status = 'returning'; -- Restricted to returning
    
    IF FOUND THEN
        UPDATE public.petwalker_profiles 
        SET current_walk_id = NULL 
        WHERE user_id = (SELECT walker_id FROM public.walk_sessions WHERE id = _session_id);
        RETURN true;
    END IF;
    RETURN false;
END; $$;

-- 5. STATE MACHINE HARDENING (Trigger v5)
CREATE OR REPLACE FUNCTION public.fn_validate_walk_status_transition_v5()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Terminal states lockdown
    IF OLD.current_status IN ('completed', 'cancelled', 'expired') AND NEW.current_status <> OLD.current_status THEN
        RAISE EXCEPTION 'Terminal status % cannot be changed', OLD.current_status;
    END IF;

    -- 2. Transition Matrix
    -- searching -> accepted | cancelled | expired
    IF OLD.current_status = 'searching' AND NEW.current_status NOT IN ('accepted', 'cancelled', 'expired', 'searching') THEN
        RAISE EXCEPTION 'Invalid transition from searching to %', NEW.current_status;
    END IF;

    -- accepted -> heading_to_pickup | cancelled
    IF OLD.current_status = 'accepted' AND NEW.current_status NOT IN ('heading_to_pickup', 'cancelled', 'accepted') THEN
        RAISE EXCEPTION 'Invalid transition from accepted to %', NEW.current_status;
    END IF;

    -- heading_to_pickup -> arrived | cancelled
    IF OLD.current_status = 'heading_to_pickup' AND NEW.current_status NOT IN ('arrived', 'cancelled', 'heading_to_pickup') THEN
        RAISE EXCEPTION 'Invalid transition from heading_to_pickup to %', NEW.current_status;
    END IF;

    -- arrived -> in_progress | cancelled
    IF OLD.current_status = 'arrived' AND NEW.current_status NOT IN ('in_progress', 'cancelled', 'arrived') THEN
        RAISE EXCEPTION 'Invalid transition from arrived to %', NEW.current_status;
    END IF;

    -- in_progress -> returning | cancelled
    -- BYPASS PREVENTION: in_progress -> completed is BLOCKED
    IF OLD.current_status = 'in_progress' AND NEW.current_status = 'completed' THEN
        RAISE EXCEPTION 'Cannot complete directly from in_progress. Must request return first.';
    END IF;
    
    IF OLD.current_status = 'in_progress' AND NEW.current_status NOT IN ('returning', 'cancelled', 'in_progress') THEN
        RAISE EXCEPTION 'Invalid transition from in_progress to %', NEW.current_status;
    END IF;

    -- returning -> completed | cancelled
    IF OLD.current_status = 'returning' AND NEW.current_status NOT IN ('completed', 'cancelled', 'returning') THEN
        RAISE EXCEPTION 'Invalid transition from returning to %', NEW.current_status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validate_walk_status_transition ON public.walk_sessions;
CREATE TRIGGER tr_validate_walk_status_transition
    BEFORE UPDATE ON public.walk_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_walk_status_transition_v5();

-- 6. ACL HARDENING
REVOKE EXECUTE ON FUNCTION public.customer_request_return(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_confirm_arrival(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_request_return(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_confirm_arrival(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO service_role;

-- 7. SYNC AUDIT (v2) - Force synchronization if one is updated
CREATE OR REPLACE FUNCTION public.fn_sync_walk_status_v2()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.current_status IS DISTINCT FROM OLD.current_status AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
            NEW.status := NEW.current_status;
        ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
            NEW.current_status := NEW.status;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.current_status IS NOT NULL THEN
            NEW.status := NEW.current_status;
        ELSIF NEW.status IS NOT NULL THEN
            NEW.current_status := NEW.status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_sync_walk_status ON public.walk_sessions;
CREATE TRIGGER tr_sync_walk_status
    BEFORE INSERT OR UPDATE ON public.walk_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_sync_walk_status_v2();