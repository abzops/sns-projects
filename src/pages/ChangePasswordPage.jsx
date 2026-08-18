import { useState, useMemo, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';
import {
  Lock,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  LogOut,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import styles from './ChangePasswordPage.module.css';

const DEFAULT_WORKSPACE_ID = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

export default function ChangePasswordPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const userId = user?.id || null;
  const mustChangePassword = user?.app_metadata?.must_change_password === true;
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [passwordChangeInProgress, setPasswordChangeInProgress] = useState(false);

  // Fetch authoritative onboarding status from Edge Function.
  // SKIP this entirely when passwordChangeInProgress — the old session token
  // is invalidated and any Edge Function call would produce a false 401.
  useEffect(() => {
    let active = true;

    async function fetchStatus() {
      if (!userId || passwordChangeInProgress) {
        setStatusLoading(false);
        return;
      }

      try {
        const { data, error: statusErr } = await supabase.functions.invoke(
          'admin-manage-workspace-user',
          {
            body: {
              action: 'get_onboarding_status',
              workspace_id: DEFAULT_WORKSPACE_ID,
            },
          }
        );

        if (!active) return;

        if (statusErr || !data?.success) {
          // Fallback to local DB check if Edge function check has an issue
          const { data: memberRow } = await supabase
            .from('workspace_members')
            .select('status')
            .eq('workspace_id', DEFAULT_WORKSPACE_ID)
            .eq('user_id', userId)
            .maybeSingle();

          setOnboardingStatus({
            membership_status: memberRow ? memberRow.status : 'pending',
            must_change_password:
              mustChangePassword,
          });
        } else {
          setOnboardingStatus({
            membership_status: data.membership_status,
            must_change_password: data.must_change_password,
          });
        }
      } catch {
        if (active) {
          setOnboardingStatus({
            membership_status: 'pending',
            must_change_password:
              mustChangePassword,
          });
        }
      } finally {
        if (active) setStatusLoading(false);
      }
    }

    fetchStatus();

    return () => {
      active = false;
    };
  }, [mustChangePassword, passwordChangeInProgress, userId]);

  // Password requirement checks (min 12 chars, uppercase, lowercase, number, symbol)
  const checks = useMemo(() => {
    const hasMinLength = newPassword.length >= 12;
    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasDigit = /[0-9]/.test(newPassword);
    const hasSymbol = /[!@#$%^&*()_+~|}{[\]:;?><,.\-=]/.test(newPassword);
    const passwordsMatch =
      newPassword.length > 0 && newPassword === confirmPassword;

    const allRequirementsMet =
      hasMinLength &&
      hasUppercase &&
      hasLowercase &&
      hasDigit &&
      hasSymbol &&
      passwordsMatch;

    return {
      hasMinLength,
      hasUppercase,
      hasLowercase,
      hasDigit,
      hasSymbol,
      passwordsMatch,
      allRequirementsMet,
    };
  }, [newPassword, confirmPassword]);

  if (authLoading || statusLoading) {
    return (
      <div className={styles.page}>
        <Loader2
          size={32}
          className={styles.spinner}
          style={{ color: 'var(--accent)' }}
        />
      </div>
    );
  }

  // If not logged in, redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // State C: Active member who does NOT need password change -> send to normal app
  if (
    onboardingStatus?.membership_status === 'active' &&
    onboardingStatus?.must_change_password !== true
  ) {
    return <Navigate to="/" replace />;
  }

  // State D: User has no membership in the workspace
  if (onboardingStatus?.membership_status === 'none') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.header}>
            <BrandLogo size="lg" className={styles.brandLogo} />
            <h1 className={styles.title}>Workspace Access Denied</h1>
            <p className={styles.subtitle}>
              Your account (<code>{user.email}</code>) is not assigned to the
              StacknStock workspace. Please contact your administrator.
            </p>
          </div>
          <button
            type="button"
            className={styles.signOutBtn}
            onClick={() => signOut()}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Submit new password directly to server-side Edge Function (complete_first_login)
  //
  // IMPORTANT: After the Edge Function succeeds, the user's OLD auth session is
  // invalidated because the server changed the password. We must NOT attempt to
  // refreshSession() or call get_onboarding_status with the old token. Instead
  // we sign in fresh with the new credentials.
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!checks.allRequirementsMet || submitting) return;

    setError('');
    setSubmitting(true);
    setPasswordChangeInProgress(true);

    // Capture email from current session BEFORE invoking the Edge Function,
    // because the session will become invalid after password change.
    const authenticatedEmail = user?.email;

    try {
      // Direct server-enforced submission to complete_first_login (invoked EXACTLY ONCE)
      const { data: edgeData, error: edgeErr } =
        await supabase.functions.invoke('admin-manage-workspace-user', {
          body: {
            action: 'complete_first_login',
            workspace_id: DEFAULT_WORKSPACE_ID,
            new_password: newPassword,
          },
        });

      if (edgeErr || !edgeData?.success) {
        // CASE 1: complete_first_login itself failed BEFORE password update
        const errMsg =
          edgeData?.error ||
          edgeErr?.message ||
          'Password change could not be completed. Please retry.';
        throw new Error(errMsg);
      }

      // ═══════════════════════════════════════════════════════════════════
      // Server confirmed success: password changed, membership activated,
      // must_change_password cleared. The OLD session is now INVALID.
      //
      // DO NOT call refreshSession() — the old refresh token is revoked.
      // DO NOT call get_onboarding_status — the old access token is invalid.
      // ═══════════════════════════════════════════════════════════════════

      // Attempt to obtain a completely NEW auth session with new credentials
      try {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: authenticatedEmail,
          password: newPassword,
        });

        if (signInErr) {
          throw signInErr;
        }

        // Fresh session obtained — AuthContext onAuthStateChange will pick it up
        showToast(
          'Password updated and account activated! Welcome to SNS Projects.',
          'success'
        );
        navigate('/', { replace: true });
      } catch {
        // CASE 2: Password change SUCCEEDED on server, but automatic re-login failed.
        // This is NOT a failure — the user's password IS changed.
        // Clear stale auth state and redirect to login with success message.
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          // Ignore signOut errors — session is already invalid
        }
        showToast(
          'Password changed successfully. Please sign in with your new password.',
          'success'
        );
        navigate('/login', { replace: true });
      }
    } catch (err) {
      // CASE 1 only: The Edge Function itself failed
      console.error('First login password change error:', err);
      const msg = err.message || 'An error occurred during password change';
      setError(msg);
      showToast(msg, 'error');
      setPasswordChangeInProgress(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <BrandLogo size="lg" className={styles.brandLogo} />
          <h1 className={styles.title}>Set Your Password</h1>
          <p className={styles.subtitle}>
            {onboardingStatus?.must_change_password === true
              ? 'You signed in with a temporary password. Choose a secure permanent password to activate your SNS Projects workspace account.'
              : 'Your workspace membership is pending activation. Choose a secure password to complete your account setup.'}
          </p>
        </div>

        <div className={styles.userInfoBox}>
          <span className={styles.userEmailLabel}>Signed in as:</span>
          <span className={styles.userEmailVal}>{user.email}</span>
        </div>

        {error && (
          <div className={styles.errorAlert}>
            <AlertTriangle size={16} className={styles.errorIcon} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>New Password</label>
            <div className={styles.inputWrap}>
              <Lock size={18} className={styles.inputIcon} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a strong password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={submitting}
                className={styles.input}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Confirm New Password</label>
            <div className={styles.inputWrap}>
              <Lock size={18} className={styles.inputIcon} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Re-type your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={submitting}
                className={styles.input}
                autoComplete="new-password"
              />
            </div>
          </div>

          {/* Password Requirements Checklist */}
          <div className={styles.checklist}>
            <span className={styles.checklistTitle}>Password requirements:</span>
            <div className={styles.checkItem}>
              {checks.hasMinLength ? (
                <Check size={14} className={styles.checkPass} />
              ) : (
                <X size={14} className={styles.checkFail} />
              )}
              <span
                className={
                  checks.hasMinLength ? styles.textPass : styles.textFail
                }
              >
                At least 12 characters
              </span>
            </div>
            <div className={styles.checkItem}>
              {checks.hasUppercase ? (
                <Check size={14} className={styles.checkPass} />
              ) : (
                <X size={14} className={styles.checkFail} />
              )}
              <span
                className={
                  checks.hasUppercase ? styles.textPass : styles.textFail
                }
              >
                At least 1 uppercase letter (A–Z)
              </span>
            </div>
            <div className={styles.checkItem}>
              {checks.hasLowercase ? (
                <Check size={14} className={styles.checkPass} />
              ) : (
                <X size={14} className={styles.checkFail} />
              )}
              <span
                className={
                  checks.hasLowercase ? styles.textPass : styles.textFail
                }
              >
                At least 1 lowercase letter (a–z)
              </span>
            </div>
            <div className={styles.checkItem}>
              {checks.hasDigit ? (
                <Check size={14} className={styles.checkPass} />
              ) : (
                <X size={14} className={styles.checkFail} />
              )}
              <span
                className={checks.hasDigit ? styles.textPass : styles.textFail}
              >
                At least 1 number (0–9)
              </span>
            </div>
            <div className={styles.checkItem}>
              {checks.hasSymbol ? (
                <Check size={14} className={styles.checkPass} />
              ) : (
                <X size={14} className={styles.checkFail} />
              )}
              <span
                className={checks.hasSymbol ? styles.textPass : styles.textFail}
              >
                At least 1 special character (!@#$%^&*...)
              </span>
            </div>
            <div className={styles.checkItem}>
              {checks.passwordsMatch ? (
                <Check size={14} className={styles.checkPass} />
              ) : (
                <X size={14} className={styles.checkFail} />
              )}
              <span
                className={
                  checks.passwordsMatch ? styles.textPass : styles.textFail
                }
              >
                Passwords match
              </span>
            </div>
          </div>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!checks.allRequirementsMet || submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className={styles.btnSpinner} />
                <span>Activating Account…</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Set Password & Enter Workspace</span>
              </>
            )}
          </button>
        </form>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.signOutBtn}
            onClick={handleSignOut}
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
