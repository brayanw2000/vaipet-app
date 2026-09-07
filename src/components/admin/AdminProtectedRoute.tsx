
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export const AdminProtectedRoute: React.FC<AdminProtectedRouteProps> = ({ children }) => {
  const { user, roles, rolesStatus, loading, authStatus, refreshRoles } = useAuth();
  const location = useLocation();

  if (loading || rolesStatus === 'loading' || authStatus === 'initializing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground animate-pulse font-medium">Verificando autorização...</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated' || !user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (rolesStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-6 bg-card p-8 rounded-3xl border shadow-sm">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight">Erro de Verificação</h2>
            <p className="text-muted-foreground">Não conseguimos validar suas permissões de acesso no momento.</p>
          </div>
          <Button 
            onClick={() => refreshRoles()} 
            className="w-full h-12 rounded-2xl font-bold"
          >
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  const isAdmin = roles.includes('admin');

  if (!isAdmin) {
    return <Navigate to="/inicio" replace />;
  }

  return <>{children}</>;
};
