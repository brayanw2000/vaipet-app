-- Atualizando o e-mail de boas-vindas para ser mais bonito e completo
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
    '<h2 style="font-size: 22px; font-weight: 700; margin-bottom: 16px; text-align: center; letter-spacing: -0.4px;">Seja muito bem-vindo!</h2>' ||
    '<p style="font-size: 16px; line-height: 24px; color: #3A3A3C; text-align: center; margin-bottom: 32px;">' ||
    'Olá ' || COALESCE(NEW.full_name, 'usuário') || '! Estamos muito felizes em ter você conosco no VaiPet.</p>' ||
    '<div style="background: #F2F2F7; padding: 32px; text-align: center; border-radius: 20px; margin-bottom: 32px;">' ||
    '<p style="font-size: 16px; color: #1C1C1E; margin: 0;">Explore o app e encontre os melhores parceiros para cuidar do seu pet com todo o carinho que ele merece.</p>' ||
    '</div>' ||
    '<p style="font-size: 14px; color: #8E8E93; text-align: center;">Se precisar de ajuda, estamos sempre à disposição.</p>'
  );
  RETURN NEW;
END;
$$;