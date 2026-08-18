import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getAuthAccessFingerprint, getProtectedRouteDecision } from '../lib/authGate';
import { supabase } from '../lib/supabase';
import Spinner from './Spinner';
import styles from './ProtectedRoute.module.css';

const DEFAULT_WORKSPACE_ID = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';
const FOREGROUND_REVALIDATION_DEDUPE_MS = 10_000;

export default function ProtectedRoute() {
  const { user, loading, signOut } = useAuth();
  const userId = user?.id || null;
  const mustChangePassword = user?.app_metadata?.must_change_password === true;
  const accessFingerprint = getAuthAccessFingerprint(user);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState(null);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [backgroundError, setBackgroundError] = useState('');
  const currentUserIdRef = useRef(userId);
  const resolvedUserIdRef = useRef(null);
  const inFlightRef = useRef(null);
  const lastValidatedAtRef = useRef(0);

  currentUserIdRef.current = userId;

  const checkStatus = useCallback(async ({ background = false, dedupe = false } = {}) => {
    if (!userId) return;

    if (
      dedupe &&
      Date.now() - lastValidatedAtRef.current < FOREGROUND_REVALIDATION_DEDUPE_MS
    ) {
      return;
    }

    if (inFlightRef.current?.userId === userId) {
      return inFlightRef.current.promise;
    }

    const isColdCheck = !background || resolvedUserIdRef.current !== userId;
    setCheckingStatus(true);
    if (isColdCheck) {
      setOnboardingStatus(null);
      setResolvedUserId(null);
      resolvedUserIdRef.current = null;
    }

    setBackgroundError('');

    let request;
    request = (async () => {
      await Promise.resolve();

      try {
        let nextStatus;

        if (mustChangePassword) {
          nextStatus = {
            must_change_password: true,
            membership_status: 'pending',
          };
        } else {
          const { data: statusData, error: statusErr } =
            await supabase.functions.invoke('admin-manage-workspace-user', {
              body: {
                action: 'get_onboarding_status',
                workspace_id: DEFAULT_WORKSPACE_ID,
              },
            });

          if (statusErr || !statusData?.success) {
            const { data: memberRow, error: memberError } = await supabase
              .from('workspace_members')
              .select('status')
              .eq('workspace_id', DEFAULT_WORKSPACE_ID)
              .eq('user_id', userId)
              .maybeSingle();

            if (memberError) throw memberError;

            nextStatus = {
              must_change_password: mustChangePassword,
              membership_status: memberRow?.status || 'none',
            };
          } else {
            nextStatus = {
              must_change_password: statusData.must_change_password === true,
              membership_status: statusData.membership_status || 'none',
            };
          }
        }

        if (currentUserIdRef.current !== userId) return;

        setOnboardingStatus(nextStatus);
        setResolvedUserId(userId);
        resolvedUserIdRef.current = userId;
        lastValidatedAtRef.current = Date.now();
      } catch (error) {
        if (currentUserIdRef.current !== userId) return;

        if (isColdCheck) {
          setOnboardingStatus({
            must_change_password: mustChangePassword,
            membership_status: 'verification_error',
          });
          setResolvedUserId(userId);
          resolvedUserIdRef.current = userId;
        } else {
          setBackgroundError(
            'Access could not be refreshed. Showing the last verified view while the server recovers.'
          );
        }

        console.warn('Unable to verify workspace access:', error);
      } finally {
        if (currentUserIdRef.current === userId) setCheckingStatus(false);
        if (inFlightRef.current?.promise === request) inFlightRef.current = null;
      }
    })();

    inFlightRef.current = { userId, promise: request };
    return request;
  }, [mustChangePassword, userId]);

  useEffect(() => {
    if (!userId) {
      setCheckingStatus(false);
      setResolvedUserId(null);
      setOnboardingStatus(null);
      setBackgroundError('');
      resolvedUserIdRef.current = null;
      inFlightRef.current = null;
      return;
    }

    const hasVerifiedCurrentUser = resolvedUserIdRef.current === userId;
    void checkStatus({ background: hasVerifiedCurrentUser });
  }, [accessFingerprint, checkStatus, userId]);

  useEffect(() => {
    if (!userId) return undefined;

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        resolvedUserIdRef.current === userId
      ) {
        void checkStatus({ background: true, dedupe: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [checkStatus, userId]);

  const decision = getProtectedRouteDecision({
    authLoading: loading,
    userId,
    mustChangePassword,
    resolvedUserId,
    onboardingStatus,
  });

  if (decision === 'cold-loading') {
    return (
      <div className={styles.coldLoading} data-auth-cold-loading>
        <Spinner size="lg" />
      </div>
    );
  }

  if (decision === 'login') {
    return <Navigate to="/login" replace />;
  }

  // Dual-gate: pending users and must-change-password users cannot enter the app.
  if (
    onboardingStatus?.must_change_password === true ||
    onboardingStatus?.membership_status === 'pending' ||
    mustChangePassword
  ) {
    return <Navigate to="/change-password" replace />;
  }

  if (decision === 'verification-error' || decision === 'access-denied') {
    const verificationFailed = decision === 'verification-error';
    return (
      <main className={styles.blockedPage}>
        <section className={styles.blockedCard} role="alert">
          <AlertTriangle size={30} aria-hidden="true" />
          <h1>{verificationFailed ? 'Unable to verify access' : 'Workspace access denied'}</h1>
          <p>
            {verificationFailed
              ? 'Your session is still signed in, but workspace access could not be verified. Retry when the connection is available.'
              : 'This account no longer has active access to the workspace. Contact an administrator if this is unexpected.'}
          </p>
          <div className={styles.blockedActions}>
            {verificationFailed && (
              <button
                type="button"
                onClick={() => checkStatus({ background: true })}
                disabled={checkingStatus}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Retry
              </button>
            )}
            <button type="button" onClick={() => signOut()}>
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      {backgroundError && (
        <div className={styles.backgroundWarning} role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          {backgroundError}
        </div>
      )}
      <Outlet />
    </>
  );
}
