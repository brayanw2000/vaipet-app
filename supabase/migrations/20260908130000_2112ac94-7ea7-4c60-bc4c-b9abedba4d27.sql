-- PHASE 4.4 — PATCH I: SECURE CUSTOMER REVIEW RPC
--
-- ReviewWalk previously persisted the review via a direct table UPDATE on
-- public.walk_sessions. RLS on walk_sessions intentionally exposes only
-- participant SELECT and customer INSERT — there is no safe customer UPDATE
-- policy (a broad one would let customers mutate lifecycle, walker assignment,
-- timestamps, pricing and tracking fields). The review therefore moves to a
-- purpose-built SECURITY DEFINER RPC.
--
-- This migration adds ONE new function. It does NOT touch any certified
-- lifecycle RPC, table, column, RLS policy or trigger.

CREATE OR REPLACE FUNCTION public.customer_submit_walk_review(
  _session_id uuid,
  _rating integer,
  _feedback text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _session public.walk_sessions;
  _normalized_feedback text;
BEGIN
  -- 1. Require an authenticated caller (checked inside the definer function).
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 2. Rating must be an integer between 1 and 5.
  IF _rating IS NULL OR _rating < 1 OR _rating > 5 THEN
    RAISE EXCEPTION 'Invalid rating: must be between 1 and 5' USING ERRCODE = '22023';
  END IF;

  -- 8. Feedback normalization: trim; empty string persists as NULL; reject
  --    oversized input instead of silently truncating.
  _normalized_feedback := NULLIF(btrim(COALESCE(_feedback, '')), '');
  IF _normalized_feedback IS NOT NULL AND char_length(_normalized_feedback) > 2000 THEN
    RAISE EXCEPTION 'Feedback too long: maximum is 2000 characters' USING ERRCODE = '22026';
  END IF;

  -- 3. Fetch and lock the target session (concurrency-safe).
  SELECT * INTO _session
  FROM public.walk_sessions
  WHERE id = _session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Walk session not found' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Only the customer of the session may review it.
  IF _session.customer_id IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'Forbidden: only the session customer can submit a review' USING ERRCODE = '42501';
  END IF;

  -- 5. Only completed sessions can be reviewed.
  IF _session.current_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Walk is not completed and cannot be reviewed' USING ERRCODE = '55006';
  END IF;

  -- Idempotency / immutability:
  --   - rating IS NULL              -> first review, persist it
  --   - same rating + same feedback -> retry-safe idempotent TRUE
  --   - different rating/feedback   -> reject (one immutable review)
  IF _session.rating IS NOT NULL THEN
    IF ROUND(_session.rating)::integer = _rating
       AND _session.feedback IS NOT DISTINCT FROM _normalized_feedback THEN
      RETURN TRUE;
    END IF;
    RAISE EXCEPTION 'Review already submitted for this walk' USING ERRCODE = '23505';
  END IF;

  -- 6. Modify ONLY rating, feedback and updated_at — never any lifecycle data.
  UPDATE public.walk_sessions
  SET rating = _rating,
      feedback = _normalized_feedback,
      updated_at = now()
  WHERE id = _session_id
    AND customer_id = _user_id
    AND current_status = 'completed';

  -- 9. Return TRUE only when the correct row was actually persisted.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review persistence failed' USING ERRCODE = '55006';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

-- ACL: revoke broadly, grant narrowly. Authorization is also enforced inside
-- the SECURITY DEFINER function itself.
REVOKE EXECUTE ON FUNCTION public.customer_submit_walk_review(uuid, integer, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_submit_walk_review(uuid, integer, text) TO authenticated, service_role;
