import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabase, supabaseConfigError } from '../lib/supabase';
import { reconcileAuthUser } from '../lib/authGate';

export const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [authEvent, setAuthEvent] = useState(null);

  useEffect(() => {
    let mounted = true;

    if (supabaseConfigError) {
      setLoading(false);
      return undefined;
    }

    const supabase = getSupabase();

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setUser((currentUser) =>
        reconcileAuthUser(currentUser, nextSession?.user ?? null, event)
      );
      setAuthEvent(event);

      // Dedicated Password Recovery Lifecycle State Machine:
      // - PASSWORD_RECOVERY sets recovery mode active.
      // - TOKEN_REFRESHED / USER_UPDATED / INITIAL_SESSION / SIGNED_IN preserve active recovery mode.
      // - SIGNED_OUT explicitly terminates recovery mode.
      // - Explicit signIn() clears recovery mode before authenticating fresh credentials.
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      } else if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    // Explicit standard credential login terminates recovery mode
    setIsPasswordRecovery(false);
    setAuthEvent('SIGNED_IN');

    if (supabaseConfigError) {
      return { error: new Error(supabaseConfigError) };
    }

    const supabase = getSupabase();
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signOut = async (options) => {
    setIsPasswordRecovery(false);
    setAuthEvent('SIGNED_OUT');

    if (supabaseConfigError) {
      setUser(null);
      setSession(null);
      return { error: null };
    }

    const supabase = getSupabase();
    const result = await supabase.auth.signOut(options);
    if (!result?.error) {
      setUser(null);
      setSession(null);
    }
    return result;
  };

  const clearPasswordRecoveryState = () => {
    setIsPasswordRecovery(false);
    setAuthEvent(null);
  };

  const refreshSession = async () => {
    if (supabaseConfigError) {
      return { data: null, error: null };
    }
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session) {
      setSession(data.session);
      setUser((currentUser) =>
        reconcileAuthUser(currentUser, data.session.user ?? null, 'TOKEN_REFRESHED')
      );
    }
    return { data, error };
  };

  const updatePassword = async (newPassword) => {
    if (supabaseConfigError) {
      return { error: new Error(supabaseConfigError) };
    }
    const supabase = getSupabase();
    return supabase.auth.updateUser({ password: newPassword });
  };

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      isPasswordRecovery,
      authEvent,
      signIn,
      signOut,
      clearPasswordRecoveryState,
      refreshSession,
      updatePassword,
      configError: supabaseConfigError,
    }),
    [user, session, loading, isPasswordRecovery, authEvent]
  );

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  return useContext(AuthContext);
};
