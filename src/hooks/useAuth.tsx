import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Tables, Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];
type SignupIntent = Database['public']['Enums']['signup_intent_type'];

type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
type RolesStatus = 'idle' | 'loading' | 'ready' | 'error';
type ApplicationStatus = 'idle' | 'loading' | 'none' | 'pending' | 'approved' | 'rejected' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Tables<'profiles'> | null;
  roles: AppRole[];
  signupIntent: SignupIntent | null;
  petwalkerApplication: Tables<'petwalker_applications'> | null;
  applicationStatus: ApplicationStatus;
  loading: boolean;
  authStatus: AuthStatus;
  profileStatus: ProfileStatus;
  rolesStatus: RolesStatus;
  authError: Error | null;
  profileError: Error | null;
  rolesError: Error | null;
  applicationError: Error | null;

  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  refreshApplication: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Tables<'profiles'> | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing');
  const [initialized, setInitialized] = useState(false);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  const [rolesStatus, setRolesStatus] = useState<RolesStatus>('idle');
  const [petwalkerApplication, setPetwalkerApplication] = useState<Tables<'petwalker_applications'> | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<ApplicationStatus>('idle');
  const [authError, setAuthError] = useState<Error | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const [rolesError, setRolesError] = useState<Error | null>(null);
  const [applicationError, setApplicationError] = useState<Error | null>(null);

  const currentUserIdRef = useRef<string | null>(null);
  const profileRequestIdRef = useRef<number>(0);
  const intentRequestIdRef = useRef<number>(0);
  const rolesRequestIdRef = useRef<number>(0);
  const appRequestIdRef = useRef<number>(0);
  const profileAbortControllerRef = useRef<AbortController | null>(null);
  const rolesAbortControllerRef = useRef<AbortController | null>(null);
  const appAbortControllerRef = useRef<AbortController | null>(null);

  const fetchRoles = useCallback(async (userId: string) => {
    if (rolesAbortControllerRef.current) rolesAbortControllerRef.current.abort();
    const requestId = ++rolesRequestIdRef.current;
    const controller = new AbortController();
    rolesAbortControllerRef.current = controller;
    setRolesStatus('loading');
    setRolesError(null);

    try {
      const response = await Promise.race([
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        (supabase.from('user_roles').select('role').eq('user_id', userId) as any).abortSignal(controller.signal),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]);

      const { data, error } = response;

      if (requestId !== rolesRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        setRolesError(new Error(error.message));
        setRolesStatus('error');
      } else {
        setRoles(data?.map((r) => r.role as AppRole) || []);
        setRolesStatus('ready');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestId !== rolesRequestIdRef.current) return;
      setRolesError(err instanceof Error ? err : new Error(String(err)));
      setRolesStatus('error');
    }
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    if (profileAbortControllerRef.current) profileAbortControllerRef.current.abort();
    const requestId = ++profileRequestIdRef.current;
    const controller = new AbortController();
    profileAbortControllerRef.current = controller;
    setProfileStatus('loading');
    setProfileError(null);

    try {
      const response = await Promise.race([
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        (supabase.from('profiles').select('*').eq('id', userId).maybeSingle() as any).abortSignal(controller.signal),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]);

      const { data, error } = response;

      if (requestId !== profileRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        setProfileError(new Error(error.message));
        setProfileStatus('error');
      } else if (!data) {
        try {
          await supabase.rpc('ensure_current_user_profile');
          const { data: retryData, error: retryError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();
            
          if (retryError || !retryData) {
            setProfileStatus('missing');
          } else {
            setProfile(retryData);
            setProfileStatus('ready');
          }
        } catch (e: unknown) {
          setProfileStatus('missing');
        }
      } else {
        setProfile(data);
        setProfileStatus('ready');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestId !== profileRequestIdRef.current) return;
      setProfileError(err instanceof Error ? err : new Error(String(err)));
      setProfileStatus('error');
    }
  }, []);

  const fetchApplication = useCallback(async (userId: string) => {
    if (appAbortControllerRef.current) appAbortControllerRef.current.abort();
    const requestId = ++appRequestIdRef.current;
    const controller = new AbortController();
    appAbortControllerRef.current = controller;
    setApplicationStatus('loading');
    setApplicationError(null);

    try {
      const response = await Promise.race([
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        (supabase.from('petwalker_applications').select('*').eq('user_id', userId).maybeSingle() as any).abortSignal(controller.signal),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]);

      const { data, error } = response;

      if (requestId !== appRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        setApplicationError(new Error(error.message));
        setApplicationStatus('error');
      } else if (!data) {
        setPetwalkerApplication(null);
        setApplicationStatus('none');
      } else {
        setPetwalkerApplication(data);
        setApplicationStatus(data.status as ApplicationStatus);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestId !== appRequestIdRef.current) return;
      setApplicationError(err instanceof Error ? err : new Error(String(err)));
      setApplicationStatus('error');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const initAuth = async () => {
      try {
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        
        if (mounted) {
          if (error) {
            setAuthError(new Error(error.message));
            setAuthStatus('error');
          } else if (initialSession) {
            setSession(initialSession);
            setUser(initialSession.user);
            setAuthStatus('authenticated');
          } else {
            setAuthStatus('unauthenticated');
          }
          setInitialized(true);
        }
      } catch (e: unknown) {
        if (mounted) {
          setAuthStatus('error');
          setInitialized(true);
        }
      }
    };
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!mounted) return;
      
      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user);
        setAuthStatus('authenticated');
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setProfile(null);
        setRoles([]);
        setPetwalkerApplication(null);
        setAuthStatus('unauthenticated');
        setProfileStatus('idle');
        setRolesStatus('idle');
        setApplicationStatus('idle');
      }
      
      if (!initialized && event === 'INITIAL_SESSION') {
        setInitialized(true);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [initialized]);

  useEffect(() => {
    currentUserIdRef.current = user?.id || null;
    if (authStatus === 'authenticated' && user) {
      fetchProfile(user.id);
      fetchRoles(user.id);
      fetchApplication(user.id);

      const channel = supabase
        .channel(`app-status-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'petwalker_applications',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            setPetwalkerApplication(payload.new as Tables<'petwalker_applications'>);
            const newStatus = (payload.new as Tables<'petwalker_applications'>).status as ApplicationStatus;
            setApplicationStatus(newStatus);
            if (newStatus === 'approved') {
              fetchRoles(user.id);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, authStatus, fetchProfile, fetchRoles, fetchApplication]);

  useEffect(() => {
    if (authStatus === 'authenticated' && user && profileStatus === 'ready') {
      const pendingIntentStr = localStorage.getItem('vaipet_pending_signup_intent');
      if (pendingIntentStr) {
        const processIntent = async () => {
          const requestId = ++intentRequestIdRef.current;
          let intentData: { intent: string; timestamp: number };
          
          try {
            intentData = JSON.parse(pendingIntentStr);
          } catch (e: unknown) {
            console.error('Invalid intent JSON:', e);
            localStorage.removeItem('vaipet_pending_signup_intent');
            return;
          }

          const { intent, timestamp } = intentData;
          const now = Date.now();
          
          if (
            (intent !== 'pet_owner' && intent !== 'petwalker') || 
            (now - timestamp > 30 * 60 * 1000)
          ) {
            console.warn('Expired or invalid intent:', intent);
            localStorage.removeItem('vaipet_pending_signup_intent');
            return;
          }

          try {
            const { error } = await Promise.race([
              supabase.rpc('set_signup_intent', { _intent: intent as SignupIntent }),
              new Promise<{ error: Error | null }>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 10000))
            ]);

            if (error) {
              console.error('Error applying intent:', error);
              return;
            }
            
            if (requestId === intentRequestIdRef.current) {
              await fetchProfile(user.id);
              localStorage.removeItem('vaipet_pending_signup_intent');
            }
          } catch (e: unknown) {
            console.error('Error processing intent RPC:', e);
          }
        };
        processIntent();
      }
    }
  }, [authStatus, user, profileStatus, fetchProfile]);

  const signOut = async () => {
    if (profileAbortControllerRef.current) profileAbortControllerRef.current.abort();
    if (rolesAbortControllerRef.current) rolesAbortControllerRef.current.abort();
    if (appAbortControllerRef.current) appAbortControllerRef.current.abort();
    
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setAuthStatus('unauthenticated');
  };

  const refreshProfile = () => user ? fetchProfile(user.id) : Promise.resolve();
  const refreshRoles = () => user ? fetchRoles(user.id) : Promise.resolve();
  const refreshApplication = () => user ? fetchApplication(user.id) : Promise.resolve();

  const hasRole = (role: AppRole) => roles.includes(role);

  const value = {
    user,
    session,
    profile,
    roles,
    signupIntent: profile?.signup_intent || null,
    petwalkerApplication,
    applicationStatus,
    loading: !initialized || (authStatus === 'authenticated' && (profileStatus === 'loading' || rolesStatus === 'loading')),
    bypassOnboarding: profile?.onboarding_completed || false,
    authStatus,
    profileStatus,
    rolesStatus,
    authError,
    profileError,
    rolesError,
    applicationError,
    signOut,
    refreshProfile,
    refreshRoles,
    refreshApplication,
    hasRole
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
