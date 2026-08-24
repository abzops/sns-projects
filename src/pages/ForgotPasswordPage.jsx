import { useState, useEffect, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getSupabase, supabaseConfigError } from '../lib/supabase';
import { getRecoveryRedirectUrl } from '../lib/url';
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import styles from './ForgotPasswordPage.module.css';

const COOLDOWN_SECONDS = 60;

export default function ForgotPasswordPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  if (user) {
    if (user.app_metadata?.must_change_password === true) {
      return <Navigate to="/change-password" replace />;
    }
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || loading || cooldown > 0) return;

    setError('');
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();

    try {
      if (supabaseConfigError) {
        throw new Error(supabaseConfigError);
      }

      const supabase = getSupabase();
      const redirectUrl = getRecoveryRedirectUrl();

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: redirectUrl }
      );

      if (resetError) {
        // Genuine infrastructure / rate-limit / network error:
        // Do NOT enumerate account existence, but inform user of service issue
        if (resetError.status === 429 || resetError.message?.toLowerCase().includes('rate limit')) {
          setError("Too many requests. Please wait a few minutes before trying again.");
        } else {
          setError("We couldn't process the reset request right now. Please try again later.");
        }
      } else {
        setSubmitted(true);
        startCooldown();
      }
    } catch {
      setError("We couldn't process the reset request right now. Please try again later.");
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
          <h1 className={styles.title}>Reset your password</h1>
          <p className={styles.subtitle}>
            Enter your work email and we&apos;ll send you a secure password reset link.
          </p>
        </div>

        {submitted && (
          <div className={styles.successBox}>
            <CheckCircle2 size={18} className={styles.successIcon} />
            <div>
              If an account exists for <strong>{email.trim().toLowerCase()}</strong>, we&apos;ve sent a password reset link.
            </div>
          </div>
        )}

        {error && (
          <div className={styles.errorBox}>
            <span className={styles.errorDot} />
            {error}
          </div>
        )}

        <div className={styles.fieldGroup}>
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
                autoFocus
                disabled={loading || cooldown > 0}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading || !email.trim() || cooldown > 0}
        >
          {loading ? (
            <>
              <Loader2 size={18} className={styles.spinner} />
              <span>Sending Link…</span>
            </>
          ) : cooldown > 0 ? (
            `Resend Link (${cooldown}s)`
          ) : submitted ? (
            'Resend Reset Link'
          ) : (
            'Send Reset Link'
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
