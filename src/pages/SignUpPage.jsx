import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Mail, Lock, User, CheckCircle2 } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import styles from './SignUpPage.module.css';

export default function SignUpPage() {
  const { user, signUp, configError } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { data, error: signUpError } = await signUp(email, password, fullName);
      if (signUpError) {
        setError(signUpError.message || 'Failed to create account');
      } else if (data?.user && !data?.session) {
        setSuccess(true);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className={styles.page}>
        <div className={styles.ambientGlow} />
        <div className={styles.card}>
          <div className={styles.successIcon}>
            <CheckCircle2 size={48} />
          </div>
          <h1 className={styles.title}>Account Created</h1>
          <p className={styles.subtitle}>
            Please check your email <strong>{email}</strong> to confirm your registration.
          </p>
          <Link to="/login" className={styles.submitBtn} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.ambientGlow} />

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logoSection}>
          <BrandLogo height={34} />
          <h1 className={styles.title}>Join Projects Command Center</h1>
          <p className={styles.subtitle}>Create your Stack n Stock account</p>
        </div>

        {(error || configError) && (
          <div className={styles.errorBox}>
            <span className={styles.errorDot} />
            {error || configError}
          </div>
        )}

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="fullName">Full Name</label>
            <div className={styles.inputWrapper}>
              <User size={16} className={styles.inputIcon} />
              <input
                id="fullName"
                type="text"
                className={styles.input}
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Work Email</label>
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
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="password"
                type="password"
                className={styles.input}
                placeholder="Min. 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="confirmPassword">Confirm Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="confirmPassword"
                type="password"
                className={styles.input}
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading || !fullName.trim() || !email.trim() || !password}
        >
          {loading ? (
            <>
              <Loader2 size={18} className={styles.spinner} />
              <span>Creating Account…</span>
            </>
          ) : (
            'Create Account'
          )}
        </button>

        <div>
          <p className={styles.footerText}>
            Already have an account?{' '}
            <Link to="/login" className={styles.footerLink}>
              Sign In
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
