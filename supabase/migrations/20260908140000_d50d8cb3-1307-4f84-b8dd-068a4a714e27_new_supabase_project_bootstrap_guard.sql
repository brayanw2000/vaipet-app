-- ============================================================================
-- PHASE S0.2 — NEW SUPABASE PROJECT BOOTSTRAP GUARD (additive migration)
-- ----------------------------------------------------------------------------
-- Fresh-project safe guard. This migration is ADDITIVE: it must be applied
-- AFTER the full historical chain on a brand new Supabase project and must
-- never be edited after being applied.
--
--   A. Redefine public.send_transactional_email so the FINAL function no
--      longer references the discarded Supabase project URL. Runtime
--      configuration is read from Vault via
--      vault.decrypted_secrets.decrypted_secret using the canonical secret
--      names SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The function FAILS
--      CLOSED when either required secret is missing or empty. Secrets are
--      never returned or logged.
--
--   B. Neutralize the LEGACY custom Send Email Auth Hook. The existing
--      resend-auth-hook does not implement the signed Standard Webhooks
--      contract required by current Supabase Send Email Hooks, so the final
--      schema state must NOT leave hook_send_email_enabled = true pointing at
--      the old project or the new project. The hook is DISABLED here; the
--      auth-email modernization phase will deploy/configure a compliant hook.
--
--   C. Reload the PostgREST schema cache.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Canonical send_transactional_email (Vault-backed, fail-closed)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_transactional_email(_to text, _subject text, _html text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_service_role_key text;
  request_id bigint;
BEGIN
  -- Read runtime configuration from Vault.
  -- Never read vault.secrets.value directly: values there are encrypted.
  -- The decrypted view vault.decrypted_secrets exposes plaintext at runtime.
  SELECT decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_URL'
   LIMIT 1;

  SELECT decrypted_secret
    INTO v_service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
   LIMIT 1;

  -- Fail closed: do NOT attempt the request with missing/empty configuration.
  IF v_url IS NULL OR btrim(v_url) = '' OR v_service_role_key IS NULL OR btrim(v_service_role_key) = '' THEN
    RAISE EXCEPTION 'send_transactional_email: required Vault secrets are not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)';
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'to', _to,
      'subject', _subject,
      'html', _html
    )
  ) INTO request_id;

  -- Return only the pg_net request id. Secrets are never returned or logged.
  RETURN json_build_object('request_id', request_id::text);
END;
$$;

-- Preserve the intended ACL hardening:
-- PUBLIC revoked; only authenticated + service_role may execute.
REVOKE ALL ON FUNCTION public.send_transactional_email(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_transactional_email(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_transactional_email(text, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- B. Neutralize the LEGACY Send Email Auth Hook (DISABLED; not re-pointed)
-- ----------------------------------------------------------------------------
-- The legacy resend-auth-hook is not compatible with the current signed
-- Standard Webhooks Send Email Hook contract. Final state: hook disabled and
-- stale hook URI/secret keys removed. The URI is NOT pointed to the new
-- project in this phase.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'instances'
      AND column_name = 'raw_base_config'
  ) THEN
    UPDATE auth.instances
    SET raw_base_config = (
      (raw_base_config::jsonb)
        - 'hook_send_email_uri'
        - 'hook_send_email_secret'
    ) || jsonb_build_object('hook_send_email_enabled', false);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- C. Schema reload
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';