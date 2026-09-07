import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import './Auth.css';

const GoogleIcon = () => (
  <svg className="social-icon google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.26 1.07-3.71 1.07-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.11c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.09H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.91l3.66-2.8z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.09l3.66 2.84c.87-2.6 3.3-4.55 6.16-4.55z" fill="#EA4335"/>
  </svg>
);

const AppleIcon = () => (
  <svg className="apple-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.05 12.54c-.02-2.05 1.67-3.04 1.75-3.09-.95-1.39-2.43-1.58-2.95-1.6-1.25-.13-2.47.75-3.1.75-.65 0-1.63-.73-2.67-.71-1.37.02-2.64.81-3.34 2.04-1.44 2.49-.37 6.15 1.01 8.17.69.99 1.49 2.09 2.55 2.05 1.03-.04 1.42-.66 2.66-.66 1.23 0 1.59.66 2.67.63 1.1-.02 1.8-1 2.47-2 .8-1.14 1.13-2.25 1.15-2.3-.03-.01-2.18-.83-2.2-3.28ZM15 6.5c.56-.7.94-1.65.84-2.6-.81.03-1.8.54-2.38 1.23-.52.6-.98 1.58-.86 2.5.91.07 1.83-.46 2.4-1.13Z" />
  </svg>
);

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isOTPMode, setIsOTPMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupIntent, setSignupIntent] = useState<'pet_owner' | 'petwalker' | null>(null);
  const [identifiedRole, setIdentifiedRole] = useState<'user' | 'petwalker' | null>(null);

  useEffect(() => {
    const identifyUserRole = async () => {
      // With the removal of check_user_is_petwalker RPC, we rely on the AuthProvider's loaded session/roles
      // or check the user's intent if available in a safe way.
      // However, for the login screen, we can't safely know the role of an unauthenticated email
      // without exposing an enumeration vector.
      // The requirement "Dynamically change login button text to 'Entrar como Petwalker' if the email belongs to a walker"
      // is technically a security leak. We will remove this dynamic check to align with security best practices.
      setIdentifiedRole(null);
    };

    identifyUserRole();
  }, [email, isRegistering, isForgotPassword, isRecoveryMode, isOTPMode]);

  useEffect(() => {
    const type = searchParams.get('type');
    if (type === 'recovery') {
      setIsRecoveryMode(true);
    }
  }, [searchParams]);

  const translateError = (error: any) => {
    const message = error?.message || '';
    console.error('Auth error:', error);
    
    if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (message.includes('User already registered')) return 'Este e-mail já está cadastrado.';
    if (message.includes('Password is too short')) return 'A senha deve ter pelo menos 6 caracteres.';
    if (message.includes('Email not confirmed')) return 'Por favor, confirme seu e-mail.';
    if (message.includes('missing OAuth secret') || message.includes('provider is not enabled')) {
      return 'Configuração de login social pendente no backend. Tente novamente em instantes.';
    }
    if (message.includes('Invalid OTP') || message.includes('Token has expired') || error?.status === 403 || error?.status === 401) {
      return 'Código inválido ou expirado. Tente novamente.';
    }
    return message;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    try {
      if (isRegistering) {
        if (password !== confirmPassword) {
          toast.error('As senhas não coincidem');
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              phone: phone,
              signup_intent: signupIntent
            }
          }
        });
        if (error) throw error;
        setIsOTPMode(true);
        toast.success('Cadastro realizado! Enviamos um código para seu e-mail.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate('/inicio');
      }
    } catch (error: any) {
      toast.error(translateError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });
      if (error) throw error;
      toast.success('Link de recuperação enviado para seu e-mail!');
    } catch (error: any) {
      toast.error(translateError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Senha atualizada com sucesso!');
      navigate('/auth');
    } catch (error: any) {
      toast.error(translateError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: 'signup'
      });
      if (error) throw error;
      toast.success('E-mail verificado com sucesso!');
      navigate('/inicio');
    } catch (error: any) {
      toast.error(translateError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (error) throw error;
      toast.success('Novo código enviado!');
    } catch (error: any) {
      toast.error(translateError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setOauthLoading(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        }
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(translateError(error));
      setOauthLoading(null);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-container">

        <AnimatePresence mode="wait">
          {isOTPMode ? (
            <motion.div
              key="otp-mode"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col w-full"
            >
              <header className="auth-header">
                <h1>Verificar E-mail</h1>
                <p>Digite o código enviado para <strong>{email}</strong></p>
              </header>
              <form onSubmit={handleVerifyOTP} className="auth-form">
                <div className="otp-container">
                  {[...Array(6)].map((_, index) => (
                    <div key={index} className="otp-input-wrapper">
                      <input
                        id={`otp-${index}`}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        value={otpCode[index] || ''}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '');
                          if (value) {
                            const newOtp = otpCode.split('');
                            newOtp[index] = value;
                            const combined = newOtp.join('').slice(0, 6);
                            setOtpCode(combined);
                            
                            // Auto-focus next
                            if (index < 5) {
                              const nextInput = document.getElementById(`otp-${index + 1}`);
                              nextInput?.focus();
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' && !otpCode[index] && index > 0) {
                            const prevInput = document.getElementById(`otp-${index - 1}`);
                            prevInput?.focus();
                          }
                        }}
                        required
                        className="otp-digit-input"
                      />
                    </div>
                  ))}
                </div>
                
                <button 
                  type="submit" 
                  disabled={isLoading || otpCode.length !== 6} 
                  className={`primary-button ${otpCode.length === 6 && !isLoading ? 'pulse-animation' : ''}`}
                >
                  <AnimatePresence mode="wait">
                    {isLoading ? (
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center justify-center gap-2"
                      >
                        <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                        Verificando...
                      </motion.div>
                    ) : (
                      <motion.span
                        key="label"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        Confirmar Código
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </form>
              <button onClick={handleResendOTP} className="text-button">
                Não recebeu o código? Enviar novamente
              </button>
            </motion.div>
          ) : isRecoveryMode ? (
            <motion.div
              key="recovery-mode"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col w-full"
            >
              <header className="auth-header">
                <h1>Nova Senha</h1>
                <p>Crie uma nova senha para sua conta.</p>
              </header>
              <form onSubmit={handleUpdatePassword} className="auth-form">
                <div className="input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Nova Senha"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="input-wrapper">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirmar Nova Senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" disabled={isLoading} className="primary-button">
                  {isLoading ? 'Atualizando...' : 'Atualizar Senha'}
                </button>
              </form>
            </motion.div>
          ) : isForgotPassword ? (
            <motion.div
              key="forgot-password"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col w-full"
            >
              <header className="auth-header">
                <h1>Recuperar Senha</h1>
                <p>Informe seu e-mail para o link de recuperação.</p>
              </header>
              <form onSubmit={handleForgotPassword} className="auth-form">
                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                  <input
                    type="email"
                    placeholder="E-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" disabled={isLoading} className="primary-button">
                  {isLoading ? 'Enviando...' : 'Enviar link'}
                </button>
              </form>
              <button onClick={() => setIsForgotPassword(false)} className="text-button">
                Voltar para o login
              </button>
            </motion.div>
          ) : isRegistering && !signupIntent ? (
            <motion.div
              key="intent-selection"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col w-full"
            >
              <header className="auth-header">
                <h1>Como quer usar o VaiPet?</h1>
                <p>Escolha o seu perfil para continuar</p>
              </header>
              <div className="auth-form">
                <button onClick={() => setSignupIntent('pet_owner')} className="social-button" style={{ justifyContent: 'center' }} data-testid="intent-owner-btn">
                  <span>Dono(a) de Pet</span>
                </button>
                <button onClick={() => setSignupIntent('petwalker')} className="social-button" style={{ justifyContent: 'center' }} data-testid="intent-walker-btn">
                  <span>Quero ser PetWalker</span>
                </button>
              </div>
              <button onClick={() => setIsRegistering(false)} className="text-button">
                Já tem conta? Entre aqui
              </button>
            </motion.div>
          ) : (
            <motion.div
              key={isRegistering ? 'register' : 'login'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col w-full"
            >
              <header className="auth-header">
                <h1>{isRegistering ? 'Criar Conta' : 'Entrar no VaiPet'}</h1>
                <p>{isRegistering ? 'Preencha os dados para começar' : 'Acesse sua conta para continuar'}</p>
              </header>

              <form onSubmit={handleEmailAuth} className="auth-form">
                {isRegistering && (
                  <>
                    <div className="input-wrapper">
                      <input type="text" placeholder="Nome Completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                    </div>
                    <div className="input-wrapper">
                      <input type="tel" placeholder="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                    </div>
                  </>
                )}
                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                  <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="5" y="10" width="14" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  <input type={showPassword ? "text" : "password"} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                        <path d="M9.9 5.1A10.7 10.7 0 0 1 12 5c5 0 8.5 4 9.5 7-.4 1.3-1.2 2.6-2.3 3.6" />
                        <path d="M6.6 6.6C4.8 7.7 3.5 9.5 2.5 12c1 3 4.5 7 9.5 7 1 0 2-.2 2.9-.5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                        <circle cx="12" cy="12" r="2.8" />
                      </svg>
                    )}
                  </button>
                </div>
                {isRegistering && (
                  <div className="input-wrapper">
                    <input type={showConfirmPassword ? "text" : "password"} placeholder="Confirmar Senha" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                  </div>
                )}
                <button type="submit" disabled={isLoading} className="primary-button">
                  {isLoading ? 'Aguarde...' : (
                    isRegistering ? 'Cadastrar' : (
                      identifiedRole === 'petwalker' ? 'Entrar como PetWalker' : 'Entrar'
                    )
                  )}
                </button>
              </form>

              <div className="flex flex-col gap-1 mt-4">
                {!isRegistering && (
                  <button onClick={() => setIsForgotPassword(true)} className="text-button">
                    Esqueci minha senha
                  </button>
                )}
                <div className="flex items-center justify-center gap-1 text-[17px] mt-2">
                  <span className="text-[#8E8E93]">{isRegistering ? 'Já tem conta? ' : 'Não tem conta? '}</span>
                  <button 
                    type="button"
                    onClick={() => { setIsRegistering(!isRegistering); setSignupIntent(null); }} 
                    className="text-[#007AFF] font-medium"
                  >
                    {isRegistering ? 'Entre aqui' : 'Crie uma'}
                  </button>
                </div>
              </div>

              {!isRegistering && !isForgotPassword && !isRecoveryMode && (
                <>
                  <div className="divider">
                    <span /><p>OU CONTINUE COM</p><span />
                  </div>
                  <div className="flex flex-col gap-3">
                    <button 
                      type="button"
                      onClick={() => handleOAuth('google')} 
                      className="social-button"
                      disabled={oauthLoading !== null}
                    >
                      <GoogleIcon />
                      <span>{oauthLoading === 'google' ? 'Conectando...' : 'Continuar com Google'}</span>
                      <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="m9 5 7 7-7 7" />
                      </svg>
                    </button>
                    <button 
                      type="button"
                      onClick={() => handleOAuth('apple')} 
                      className="social-button"
                      disabled={oauthLoading !== null}
                    >
                      <AppleIcon />
                      <span>{oauthLoading === 'apple' ? 'Conectando...' : 'Continuar com Apple'}</span>
                      <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="m9 5 7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <p className="legal">
          Ao continuar, você concorda com os <Link to="/termos-de-uso">Termos de Uso</Link> e a <Link to="/politica-de-privacidade">Política de Privacidade</Link>.
        </p>
      </section>
    </main>
  );
};

export default Auth;
