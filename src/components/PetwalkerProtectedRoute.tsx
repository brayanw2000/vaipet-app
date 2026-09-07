import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { SplashScreen } from '@/components/SplashScreen';
import { toast } from 'sonner';

interface Props {
  children: React.ReactNode;
}

export const PetwalkerProtectedRoute = ({ children }: Props) => {
  const { authStatus, rolesStatus, hasRole, rolesError, refreshRoles } = useAuth();
  const location = useLocation();
  const [retry, setRetry] = useState(0);

  const isLoading = authStatus === 'initializing' || 
                   (authStatus === 'authenticated' && (rolesStatus === 'loading' || rolesStatus === 'idle'));

  if (isLoading) return <SplashScreen />;

  if (authStatus === 'unauthenticated') {
    return <Navigate to={`/auth?redirect=${location.pathname}`} replace />;
  }

  if (rolesStatus === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-xl font-bold mb-2">Erro ao carregar permissões</h2>
        <p className="text-gray-500 mb-6">Não foi possível verificar seu acesso.</p>
        <button 
          onClick={() => { refreshRoles(); setRetry(r => r + 1); }}
          className="px-6 py-3 bg-primary text-white rounded-xl font-bold"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (authStatus === 'authenticated' && !hasRole('petwalker')) {
    toast.error('Acesso exclusivo para PetWalkers');
    return <Navigate to="/inicio" replace />;
  }

  return <>{children}</>;
};
