import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { SplashScreen } from '@/components/SplashScreen';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type PetwalkerProfile = Database['public']['Tables']['petwalker_profiles']['Row'];

const RoleLanding = () => {
  const { 
    authStatus, 
    profileStatus, 
    profile, 
    rolesStatus, 
    roles,
    hasRole,
    applicationStatus,
    refreshRoles,
    refreshProfile,
    refreshApplication,
    user
  } = useAuth();

  const [waitApproved, setWaitApproved] = useState(0);
  const [petwalkerProfile, setPetwalkerProfile] = useState<PetwalkerProfile | null>(null);
  const [pwProfileStatus, setPwProfileStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [pwProfileError, setPwProfileError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    if (hasRole('petwalker') && user) {
      setPwProfileStatus('loading');
      setPwProfileError(null);

      const fetchPwProfile = async () => {
        try {
          const response = await Promise.race([
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            (supabase.from('petwalker_profiles').select('*').eq('user_id', user.id).maybeSingle() as any).abortSignal(controller.signal),
            new Promise<any>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 10000)
            )
          ]);
          
          const { data, error } = response;

          if (!mounted) return;

          if (error) {
            setPwProfileError(new Error(error.message));
            setPwProfileStatus('error');
          } else if (!data) {
            setPwProfileStatus('missing');
          } else {
            setPetwalkerProfile(data);
            setPwProfileStatus('ready');
          }
        } catch (err) {
          if (!mounted) return;
          setPwProfileError(err instanceof Error ? err : new Error(String(err)));
          setPwProfileStatus('error');
        }
      };

      fetchPwProfile();
    }

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [hasRole, user]);

  useEffect(() => {
    if (applicationStatus === 'approved' && !hasRole('petwalker') && waitApproved < 3) {
      const timer = setTimeout(() => {
        refreshRoles();
        setWaitApproved(prev => prev + 1);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [applicationStatus, hasRole, waitApproved, refreshRoles]);

  const isLoading = authStatus === 'initializing' || 
                   (authStatus === 'authenticated' && (
                     profileStatus === 'loading' || 
                     profileStatus === 'idle' || 
                     rolesStatus === 'loading' || 
                     rolesStatus === 'idle' || 
                     applicationStatus === 'loading' || 
                     applicationStatus === 'idle' ||
                     (hasRole('petwalker') && pwProfileStatus === 'loading') ||
                     (hasRole('petwalker') && pwProfileStatus === 'idle')
                   ));
  
  const isError = authStatus === 'error' || 
                  profileStatus === 'error' || 
                  rolesStatus === 'error' || 
                  (profile?.signup_intent === 'petwalker' && applicationStatus === 'error') ||
                  profileStatus === 'missing' ||
                  (hasRole('petwalker') && pwProfileStatus === 'error');

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#F7F5EF] z-[100]">
        <SplashScreen variant="logo" />
        <div className="absolute bottom-20 flex flex-col items-center gap-4 px-6 w-full max-w-xs">
          <div className="text-[12px] font-medium opacity-40 text-center">
            Redirecionando...
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <Navigate to="/auth" replace />;
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#F7F5EF]">
        <h2 className="text-xl font-bold mb-2">Erro ao carregar dados</h2>
        <p className="text-gray-500 mb-2">Não conseguimos identificar seu destino.</p>
        
        <div className="text-[10px] text-gray-400 mb-6 font-mono uppercase">
          {profileStatus === 'missing' && 'PROFILE_MISSING'}
          {profileStatus === 'error' && 'PROFILE_LOAD_FAILED'}
          {rolesStatus === 'error' && 'ROLES_LOAD_FAILED'}
          {applicationStatus === 'error' && 'APPLICATION_LOAD_FAILED'}
          {pwProfileStatus === 'error' && 'PETWALKER_PROFILE_LOAD_FAILED'}
        </div>

        <Button 
          onClick={() => {
            if (profileStatus === 'error' || profileStatus === 'missing') refreshProfile();
            if (rolesStatus === 'error') refreshRoles();
            if (applicationStatus === 'error') refreshApplication();
            if (pwProfileStatus === 'error') window.location.reload();
          }}
          className="px-6 py-3 font-bold"
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (hasRole('petwalker')) {
    if (pwProfileStatus === 'missing') {
      return <Navigate to="/petwalker/onboarding" replace />;
    }
    if (petwalkerProfile && !petwalkerProfile.profile_completed) {
      return <Navigate to="/petwalker/onboarding" replace />;
    }
    return <Navigate to="/petwalker" replace />;
  }

  if (applicationStatus === 'approved' && !hasRole('petwalker')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#F7F5EF]">
        <h2 className="text-xl font-bold mb-2">Quase lá!</h2>
        <p className="text-gray-500 mb-6">Sua candidatura foi aprovada. Estamos preparando seu perfil de PetWalker...</p>
        <Button onClick={() => refreshRoles()} className="mt-4">
          Verificar agora
        </Button>
      </div>
    );
  }

  if (applicationStatus === 'pending' || applicationStatus === 'rejected') {
    return <Navigate to="/petwalker/inscricao" replace />;
  }

  if (profile?.signup_intent === 'petwalker' && applicationStatus === 'none') {
    return <Navigate to="/petwalker/inscricao" replace />;
  }

  if (profile?.role === 'petshop' || hasRole('petshop')) {
    return <Navigate to="/petshop-dashboard" replace />;
  }

  if (profile?.onboarding_completed === false) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Navigate to="/inicio" replace />;
};

export default RoleLanding;
