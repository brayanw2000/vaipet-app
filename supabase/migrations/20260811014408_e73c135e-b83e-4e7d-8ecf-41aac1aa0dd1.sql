CREATE OR REPLACE FUNCTION public.send_transactional_email(_to text, _subject text, _html text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id text;
BEGIN
  -- Triggering the deployed send-email edge function
  -- On Lovable Cloud, we rely on the service_role being available via vault or pre-configured settings
  -- If direct http_post to the edge function fails due to auth, we fallback to instructions.
  
  SELECT net.http_post(
    url := 'https://jlmknenhvvapkzglhoqo.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object(
      'to', _to,
      'subject', _subject,
      'html', _html
    )
  )::text INTO request_id;

  RETURN json_build_object('request_id', request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_transactional_email(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_transactional_email(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.on_auth_user_created_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.send_transactional_email(
    NEW.email,
    'Bem-vindo ao VaiPet! 🐾',
    '<h1>Olá ' || COALESCE(NEW.full_name, 'usuário') || '!</h1><p>Estamos muito felizes em ter você conosco no VaiPet. Explore o app e encontre os melhores passeadores para seu pet!</p>'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_welcome_email ON public.profiles;
CREATE TRIGGER trigger_welcome_email
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.on_auth_user_created_welcome_email();
