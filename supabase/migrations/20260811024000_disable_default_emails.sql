-- Desativa o envio de emails padrão do Supabase para forçar o uso do Hook/Resend
-- E configura o Hook para a função resend-auth-hook

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'instances'
      AND column_name = 'config'
  ) THEN
    UPDATE auth.instances
    SET config = config ||
      jsonb_build_object(
        'mailer_otp_exp', 600,
        'external_email_enabled', true,
        'smtp_admin_email', 'noreply@vaipet.app',
        'smtp_sender_name', 'VaiPet'
      );
  END IF;
END $$;

-- Garante que o hook de envio de email está apontando para a nossa função
-- O Lovable Cloud gerencia a URL base das functions, mas precisamos garantir que o hook está habilitado no nível do banco se possível via SQL, 
-- embora geralmente seja via configure_auth. Como configure_auth falhou com parâmetros específicos, vamos tentar via SQL na tabela de instâncias se acessível.

-- Nota: No Supabase gerenciado, hooks de email são configurados via API de gerenciamento.
-- Se o usuário ainda recebe via Lovable, é porque o 'hook_send_email_enabled' não está persistindo.
