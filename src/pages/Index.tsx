import { useEffect } from 'react';
import { HomePasseio } from '@/components/HomePasseio';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ActiveWalkBanner } from '@/components/ActiveWalkBanner';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { SplashScreen } from '@/components/SplashScreen';
import { GuidedTour } from '@/components/GuidedTour';
import { motion, AnimatePresence } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0,
      delayChildren: 0
    }
  }
};

const itemVariants = {
  hidden: { y: 0, opacity: 1 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0 }
  }
};

const Index = () => {
  const { 
    user, 
    authStatus, 
    profileStatus, 
    profile, 
    signOut, 
    refreshProfile 
  } = useAuth();
  const navigate = useNavigate();
  const { palette } = useHomeTheme();

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      console.log('[Index] User unauthenticated, redirecting to /auth');
      navigate('/auth', { replace: true });
    }
  }, [authStatus, navigate]);

  useEffect(() => {
    if (authStatus === 'authenticated' && profileStatus === 'ready' && profile) {
      if (profile.onboarding_completed === false) {
        navigate('/onboarding', { replace: true });
      } else if (profile.role === 'petshop') {
        navigate('/petshop-dashboard', { replace: true });
      }
    }
  }, [authStatus, profileStatus, profile, navigate]);

  const isLoading = authStatus === 'initializing' || (authStatus === 'authenticated' && (profileStatus === 'loading' || profileStatus === 'idle'));
  const isError = authStatus === 'error' || profileStatus === 'error' || profileStatus === 'missing';
  const isContentReady = authStatus === 'authenticated' && profileStatus === 'ready' && profile?.onboarding_completed !== false && profile?.role !== 'petshop';

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#F7F5EF] z-[100]">
        <SplashScreen variant="logo" />
        <div className="absolute bottom-20 flex flex-col items-center gap-4 px-6 w-full max-w-xs">
          <div className="text-[12px] font-medium opacity-40 text-center">
            {authStatus === 'initializing' ? 'Validando acesso...' : 'Carregando perfil...'}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#F7F5EF] z-[100] p-6">
        <SplashScreen variant="logo" />
        <div className="mt-8 flex flex-col items-center gap-4 w-full max-w-xs text-center">
          <h2 className="text-lg font-bold text-red-500">
            {profileStatus === 'missing' ? 'Perfil não encontrado' : 'Não foi possível carregar seu perfil'}
          </h2>
          <p className="text-sm opacity-60">
            {profileStatus === 'missing' 
              ? 'Parece que sua conta ainda não tem um perfil configurado.' 
              : 'Houve um erro de conexão ou permissão ao buscar seus dados.'}
          </p>
          
          <div className="w-full flex flex-col gap-3 mt-4">
            <button 
              onClick={() => refreshProfile()}
              className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg active:scale-95 transition-transform"
            >
              Tentar novamente
            </button>
            <button 
              onClick={async () => {
                await signOut();
                navigate('/auth', { replace: true });
              }}
              className="w-full py-3 px-4 bg-white border border-gray-200 rounded-2xl text-sm font-bold active:scale-95 transition-transform"
            >
              Sair e entrar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isContentReady) return null;

  return (
    <>
      <GuidedTour />
      <div
        className="min-h-screen"
        style={{ backgroundColor: palette.paper }}
      >
        <motion.div
          key="main-content"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="min-h-screen flex flex-col max-w-md mx-auto relative"
          style={{ background: palette.paper, color: palette.ink }}
        >
          <motion.div variants={itemVariants} className="flex-1 pb-28 pt-10">
            <ActiveWalkBanner />
            <HomePasseio />
          </motion.div>
          <motion.div variants={itemVariants} className="fixed bottom-0 left-0 right-0 z-50">
            <BottomNavigation />
          </motion.div>
        </motion.div>
      </div>
    </>
  );
};

export default Index;
