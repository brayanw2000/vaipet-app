import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const RedirectIndex = () => {
  const { user, loading, authStatus, profile } = useAuth();

  if (loading || authStatus === 'initializing') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (user) {
    if (profile && !profile.onboarding_completed) {
      return <Navigate to="/onboarding" replace />;
    }
    return <Navigate to="/inicio" replace />;
  }

  return <Navigate to="/auth" replace />;
};

export default RedirectIndex;