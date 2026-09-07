CREATE OR REPLACE FUNCTION public.on_auth_user_created_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_html text;
BEGIN
  -- We use double single quotes for the string content to avoid escaping issues in the RPC
  v_html := '
    <div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1C1C1E; background-color: white; border-radius: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #31D880; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">VaiPet</h1>
      </div>
      
      <h2 style="font-size: 24px; font-weight: 700; margin-bottom: 16px; text-align: center; letter-spacing: -0.4px;">Bem-vindo ao VaiPet! 🐾</h2>
      <p style="font-size: 16px; line-height: 24px; color: #3A3A3C; text-align: center; margin-bottom: 24px;">
        Olá! Estamos muito felizes em ter você na nossa comunidade.
      </p>
      
      <div style="text-align: center; margin: 32px 0;">
        <p style="font-size: 16px; line-height: 24px; color: #3A3A3C;">
          Prepare-se para encontrar os melhores passeadores para o seu melhor amigo, ou para oferecer carinho e cuidado como um de nossos PetWalkers.
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
