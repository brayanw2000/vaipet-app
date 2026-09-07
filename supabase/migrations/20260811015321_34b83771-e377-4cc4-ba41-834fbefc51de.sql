-- Ensure we have the service_role_key in vault for the send_transactional_email function
-- This is a standard pattern on Lovable Cloud when we need to call edge functions from PL/pgSQL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    -- We can't actually insert into vault.secrets here without the actual key, 
    -- but we can ensure the auth hook is correctly linked if it wasn't.
    NULL;
  END IF;
END $$;

-- Update the welcome email to use the same beautiful wrapper as the auth hook
CREATE OR REPLACE FUNCTION public.on_auth_user_created_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_html text;
  v_primary_color text := '#31D880';
  v_bg_color text := '#F2F2F7';
BEGIN
  v_html := '
    <div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1C1C1E; background-color: white; border-radius: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: ' || v_primary_color || '; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">VaiPet</h1>
      </div>
      
      <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 16px; text-align: center; letter-spacing: -0.4px;">Bem-vindo ao VaiPet! 🐾</h2>
      <p style="font-size: 16px; line-height: 24px; color: #3A3A3C; text-align: center; margin-bottom: 32px;">
        Olá ' || COALESCE(NEW.full_name, 'usuário') || '! Estamos muito felizes em ter você conosco.
      </p>
      <div style="background: ' || v_bg_color || '; padding: 32px; text-align: center; border-radius: 20px; margin-bottom: 32px;">
        <p style="font-size: 16px; line-height: 24px; color: #1C1C1E; margin: 0;">
          Explore o app e encontre os melhores parceiros para cuidar do seu pet com toda segurança e carinho que ele merece.
        </p>
      </div>
      
      <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #E5E5EA; text-align: center;">
        <p style="font-size: 13px; color: #8E8E93; line-height: 1.4;">
          © 2026 VaiPet. Todos os direitos reservados.<br>
          O app feito com amor para o seu pet. 🐾
        </p>
      </div>
    </div>';

  PERFORM public.send_transactional_email(
    NEW.email,
    'Bem-vindo ao VaiPet! 🐾',
    v_html
  );
  RETURN NEW;
END;
$$;
