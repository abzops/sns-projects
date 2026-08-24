import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { evaluatePassword } from '../lib/passwordPolicy';
import {
  Lock,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  AlertCircle,
  ArrowLeft,
  KeyRound,
} from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import styles from './ResetPasswordPage.module.css';

export default function ResetPasswordPage() {
  const {
    isPasswordRecovery,
    updatePassword,
    signOut,
    clearPasswordRecoveryState,
    loading: authLoading,
  } = useAuth();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const checks = useMemo(
    () => evaluatePassword(newPassword, confirmPassword),
    [newPassword, confirmPassword]
  );

  if (authLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.ambientGlow} />
        <div className={styles.card} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '260px' }}>
          <Loader2 size={32} className={styles.spinner} style={{ color: 'var(--accent)' }} />
        </div>
      </div>
    );
  }

  // Entry Gate: Fail closed if no valid recovery session / state
  if (!isPasswordRecovery) {
    return (
      <div className={styles.page}>
        <div className={styles.ambientGlow} />
        <div className={`${styles.card} ${styles.invalidState}`}>
          <div className={styles.invalidIconWrapper}>
            <AlertCircle size={32} />
          </div>
          <h1 className={styles.title}>Reset link invalid or expired</h1>
          <p className={styles.subtitle}>
            The password reset link is invalid, expired, or has already been used.
          </p>

          <div className={styles.actionBtnGroup}>
            <Link to="/forgot-password" className={styles.submitBtn}>
              <KeyRound size={16} />
              Request a New Link
            </Link>
            <Link to="/login" className={styles.secondaryBtn}>
              <ArrowLeft size={16} />
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!checks.allRequirementsMet || submitting) return;

    setError('');
    setSubmitting(true);

    try {
      const { error: updateError } = await updatePassword(newPassword);

      if (updateError) {
        setError(updateError.message || 'Failed to update password. Please try again.');
        return;
      }

      // Password successfully updated:
      // 1. Sign out globally to invalidate old sessions
      // 2. Clear recovery state
      // 3. Navigate to login with success confirmation
      try {
        await signOut({ scope: 'global' });
      } catch {
        // Safe fallback if global sign-out encounters network edge-case
      }

      clearPasswordRecoveryState();

      navigate('/login', {
        replace: true,
        state: {
          message: 'Password reset successfully. Sign in with your new password.',
        },
      });
    } catch {
      setError('An unexpected error occurred while resetting your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.ambientGlow} />

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logoSection}>
          <BrandLogo height={34} />
          <h1 className={styles.title}>Create a new password</h1>
          <p className={styles.subtitle}>
            Choose a secure password for your SNS Projects account.
          </p>
        </div>

        {error && (
          <div className={styles.errorBox}>
            <span className={styles.errorDot} />
            {error}
          </div>
        )}

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="newPassword">New Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                className={styles.input}
                placeholder="••••••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                autoFocus
                disabled={submitting}
              />
              <button
                type="button"
                className={styles.togglePasswordBtn}
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="confirmPassword">Confirm New Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="confirmPassword"
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
        </div>

        <div className={styles.checklist}>
          <div className={`${styles.checklistItem} ${checks.hasMinLength ? styles.checklistItemMet : styles.checklistItemUnmet}`}>
            {checks.hasMinLength ? <Check size={14} className={styles.checkIcon} /> : <X size={14} className={styles.checkIcon} />}
            <span>At least 12 characters</span>
          </div>
          <div className={`${styles.checklistItem} ${checks.hasUppercase ? styles.checklistItemMet : styles.checklistItemUnmet}`}>
            {checks.hasUppercase ? <Check size={14} className={styles.checkIcon} /> : <X size={14} className={styles.checkIcon} />}
            <span>Uppercase letter (A-Z)</span>
          </div>
          <div className={`${styles.checklistItem} ${checks.hasLowercase ? styles.checklistItemMet : styles.checklistItemUnmet}`}>
            {checks.hasLowercase ? <Check size={14} className={styles.checkIcon} /> : <X size={14} className={styles.checkIcon} />}
            <span>Lowercase letter (a-z)</span>
          </div>
          <div className={`${styles.checklistItem} ${checks.hasDigit ? styles.checklistItemMet : styles.checklistItemUnmet}`}>
            {checks.hasDigit ? <Check size={14} className={styles.checkIcon} /> : <X size={14} className={styles.checkIcon} />}
            <span>Number (0-9)</span>
          </div>
          <div className={`${styles.checklistItem} ${checks.hasSymbol ? styles.checklistItemMet : styles.checklistItemUnmet}`}>
            {checks.hasSymbol ? <Check size={14} className={styles.checkIcon} /> : <X size={14} className={styles.checkIcon} />}
            <span>Special character (!@#$%^&*...)</span>
          </div>
          <div className={`${styles.checklistItem} ${checks.passwordsMatch ? styles.checklistItemMet : styles.checklistItemUnmet}`}>
            {checks.passwordsMatch ? <Check size={14} className={styles.checkIcon} /> : <X size={14} className={styles.checkIcon} />}
            <span>Passwords match</span>
          </div>
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!checks.allRequirementsMet || submitting}
        >
          {submitting ? (
            <>
              <Loader2 size={18} className={styles.spinner} />
              <span>Updating Password…</span>
            </>
          ) : (
            'Reset Password'
          )}
        </button>

        <div className={styles.footerText}>
          <Link to="/login" className={styles.backLink}>
            <ArrowLeft size={15} />
            Back to Sign In
          </Link>
        </div>
      </form>
    </div>
  );
}
