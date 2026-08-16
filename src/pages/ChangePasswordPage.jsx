import { useState, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, Check, X, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import styles from './ChangePasswordPage.module.css';

const DEFAULT_WORKSPACE_ID = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

export default function ChangePasswordPage() {
  const { user, loading: authLoading, updatePassword, refreshSession, signOut } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  // Password requirement checks
  const checks = useMemo(() => {
    const hasMinLength = newPassword.length >= 12;
    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasDigit = /[0-9]/.test(newPassword);
    const hasSymbol = /[!@#$%^&*()_+~|}{[\]:;?><,.\-=]/.test(newPassword);
    const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

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

  if (authLoading) {
    return (
      <div className={styles.page}>
        <Loader2 size={32} className={styles.spinner} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  // If not logged in, redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // If user does NOT need password change, send to main app
  if (user.app_metadata?.must_change_password !== true && !passwordUpdated) {
    return <Navigate to="/" replace />;
  }

  // Complete first login activation helper
  const completeActivation = async (workspaceId) => {
    const { data: edgeData, error: edgeErr } = await supabase.functions.invoke(
      'admin-manage-workspace-user',
      {
        body: {
          action: 'complete_first_login',
          workspace_id: workspaceId || DEFAULT_WORKSPACE_ID,
        },
      }
    );

    if (edgeErr || !edgeData?.success) {
      const errMsg =
        edgeErr?.message ||
        edgeData?.error ||
        'Password updated, but account activation could not be completed. Please retry.';
      throw new Error(errMsg);
    }

    // Refresh auth session to receive updated app_metadata
    await refreshSession();
    showToast('Password updated and account activated! Welcome.', 'success');
    navigate('/', { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!checks.allRequirementsMet || submitting) return;

    setError('');
    setSubmitting(true);

    try {
      // 1. Update password via Supabase Auth official API
      const { error: pwdErr } = await updatePassword(newPassword);
      if (pwdErr) {
        throw new Error(pwdErr.message || 'Failed to update password');
      }

      setPasswordUpdated(true);

      // 2. Discover caller's workspace membership
      let targetWorkspaceId = DEFAULT_WORKSPACE_ID;
      try {
        const { data: memberRows } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user.id)
          .limit(1);

        if (memberRows && memberRows.length > 0) {
          targetWorkspaceId = memberRows[0].workspace_id;
        }
      } catch {
        // Fallback to DEFAULT_WORKSPACE_ID
      }

      // 3. Complete first login Edge Function action
      await completeActivation(targetWorkspaceId);
    } catch (err) {
      console.error('Password change error:', err);
      setError(err.message || 'An error occurred during password change');
      showToast(err.message || 'Failed to complete password change', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryActivation = async () => {
    setError('');
    setSubmitting(true);
    try {
      await completeActivation(DEFAULT_WORKSPACE_ID);
    } catch (err) {
      setError(err.message || 'Activation failed');
      showToast(err.message || 'Failed to activate account', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.ambientGlow} />

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logoSection}>
          <BrandLogo height={34} />
          <h1 className={styles.title}>Set your password</h1>
          <p className={styles.subtitle}>
            You&apos;re signing in for the first time. Create a new password before accessing SNS Projects.
          </p>
        </div>

        {error && (
          <div className={styles.errorBox}>
            <span className={styles.errorDot} />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-password">New Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                className={styles.input}
                placeholder="••••••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={submitting}
                autoFocus
              />
              <button
                type="button"
                className={styles.togglePassword}
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="confirm-password">Confirm New Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                className={styles.input}
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={submitting}
              />
            </div>
          </div>

          <div className={styles.requirementsList}>
            <div className={`${styles.reqItem} ${checks.hasMinLength ? styles.reqMet : ''}`}>
              {checks.hasMinLength ? <Check size={12} className={styles.reqIcon} /> : <X size={12} className={styles.reqIcon} />}
              <span>At least 12 characters</span>
            </div>
            <div className={`${styles.reqItem} ${checks.hasUppercase ? styles.reqMet : ''}`}>
              {checks.hasUppercase ? <Check size={12} className={styles.reqIcon} /> : <X size={12} className={styles.reqIcon} />}
              <span>At least one uppercase letter (A–Z)</span>
            </div>
            <div className={`${styles.reqItem} ${checks.hasLowercase ? styles.reqMet : ''}`}>
              {checks.hasLowercase ? <Check size={12} className={styles.reqIcon} /> : <X size={12} className={styles.reqIcon} />}
              <span>At least one lowercase letter (a–z)</span>
            </div>
            <div className={`${styles.reqItem} ${checks.hasDigit ? styles.reqMet : ''}`}>
              {checks.hasDigit ? <Check size={12} className={styles.reqIcon} /> : <X size={12} className={styles.reqIcon} />}
              <span>At least one number (0–9)</span>
            </div>
            <div className={`${styles.reqItem} ${checks.hasSymbol ? styles.reqMet : ''}`}>
              {checks.hasSymbol ? <Check size={12} className={styles.reqIcon} /> : <X size={12} className={styles.reqIcon} />}
              <span>At least one special character (!@#$%^&*)</span>
            </div>
            <div className={`${styles.reqItem} ${checks.passwordsMatch ? styles.reqMet : ''}`}>
              {checks.passwordsMatch ? <Check size={12} className={styles.reqIcon} /> : <X size={12} className={styles.reqIcon} />}
              <span>Passwords match</span>
            </div>
          </div>
        </div>

        {passwordUpdated && error ? (
          <button
            type="button"
            className={styles.submitBtn}
            onClick={handleRetryActivation}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={18} className={styles.spinner} />
                <span>Activating Account…</span>
              </>
            ) : (
              <>
                <ShieldCheck size={18} />
                <span>Retry Account Activation</span>
              </>
            )}
          </button>
        ) : (
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={submitting || !checks.allRequirementsMet}
          >
            {submitting ? (
              <>
                <Loader2 size={18} className={styles.spinner} />
                <span>Setting Password…</span>
              </>
            ) : (
              'Set Password & Continue'
            )}
          </button>
        )}

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.signOutBtn}
            onClick={handleSignOut}
            disabled={submitting}
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </form>
    </div>
  );
}
