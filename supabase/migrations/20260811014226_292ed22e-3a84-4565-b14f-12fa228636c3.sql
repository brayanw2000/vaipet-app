-- 1. UTILITIES & EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pg_net" SCHEMA public;

-- 2. SECURE EMAIL FUNCTION (RESEND)
-- This function allows sending emails via the Resend Edge Function
-- It requires the RESEND_API_KEY environment variable to be set
CREATE OR REPLACE FUNCTION public.send_transactional_email(
  _to text,
  _subject text,
  _html text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_resend_key text;
  v_response_id text;
BEGIN
  -- We don't read the key here to avoid leaks, the Edge Function handles it.
  -- But we use pg_net to call our own Edge Function for internal reliability if needed,
  -- or we simply provide this for other DB functions to call.
  
  -- For direct DB-to-Edge calls:
  PERFORM net.http_post(
    url := (SELECT value FROM vault.secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := jsonb_build_object(
      'to', _to,
      'subject', _subject,
      'html', _html
    )
  );

  RETURN json_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_transactional_email(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_transactional_email(text, text, text) TO service_role;

-- 3. HOOK INTO AUTH (OPTIONAL BUT RECOMMENDED)
-- To override Supabase Default Auth Emails with Resend, we'd normally use the Supabase Dashboard.
-- Since we are on Lovable Cloud, we implement a trigger that sends a "Welcome" or "OTP" email
-- if we want to bypass the internal SMTP entirely for specific flows.

-- For now, let's just make the utility available for the whole system.
