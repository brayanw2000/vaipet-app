DO $$
BEGIN
  UPDATE auth.instances 
  SET raw_base_config = (raw_base_config::jsonb || jsonb_build_object(
    'hook_send_email_enabled', true, 
    'hook_send_email_uri', 'https://jlmknenhvvapkzglhoqo.supabase.co/functions/v1/resend-auth-hook',
    'mailer_otp_exp', 600,
    'external_email_enabled', true
  ))::text;
END $$;