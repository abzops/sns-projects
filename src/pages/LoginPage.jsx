import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Mail, Lock } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { user, signIn, configError } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage] = useState(location.state?.message || '');

  if (user) {
    if (user.app_metadata?.must_change_password === true) {
      return <Navigate to="/change-password" replace />;
    }
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: signInError } = await signIn(email, password);
      if (signInError) {
        setError(signInError.message || 'Invalid email or password');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.ambientGlow} />

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logoSection}>
          <BrandLogo height={34} />
          <h1 className={styles.title}>Projects Command Center</h1>
          <p className={styles.subtitle}>Sign in to your organization account</p>
        </div>

        {successMessage && !error && (
          <div className={styles.successBox}>
            <span className={styles.successDot} />
            {successMessage}
          </div>
        )}

        {(error || configError) && (
          <div className={styles.errorBox}>
            <span className={styles.errorDot} />
            {error || configError}
          </div>
        )}

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Email</label>
            <div className={styles.inputWrapper}>
              <Mail size={16} className={styles.inputIcon} />
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="name@stacknstock.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="password">Password</label>
              <Link to="/forgot-password" className={styles.forgotLink}>
                Forgot your password?
              </Link>
            </div>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="password"
                type="password"
                className={styles.input}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading || !email.trim() || !password}
        >
          {loading ? (
            <>
              <Loader2 size={18} className={styles.spinner} />
              <span>Signing In…</span>
            </>
          ) : (
            'Sign In'
          )}
        </button>

        <div>
          <p className={styles.footerText}>
            Accounts are managed by your organization.
          </p>
        </div>
      </form>
    </div>
  );
}
