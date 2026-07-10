import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Loader2, Mail, Lock, User } from 'lucide-react'
import styles from './SignUpPage.module.css'

export default function SignUpPage() {
  const { user, signUp, configError } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const logoSrc = `${import.meta.env.BASE_URL}stacknstock-logo.png`

  if (user) return <Navigate to="/" replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const { error: signUpError } = await signUp(email, password, {
        full_name: fullName,
      })

      if (signUpError) {
        setError(signUpError.message || 'Could not create account')
      } else {
        setSuccess(true)
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className={styles.page}>
        <div className={styles.ambientGlow} />
        <div className={styles.card}>
          <div className={styles.logoSection}>
            <img
              src={logoSrc}
              alt="Stack n Stock"
              className={styles.logo}
            />
            <h1 className={styles.title}>Check Your Email</h1>
            <p className={styles.subtitle}>
              We've sent a confirmation link to <strong>{email}</strong>. Please check your inbox and click the link to activate your account.
            </p>
          </div>
          <div className={styles.successIcon}>
            <Mail size={48} />
          </div>
          <Link to="/login" className={styles.backLink}>
            ← Back to Sign In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.ambientGlow} />

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logoSection}>
          <img
            src={logoSrc}
            alt="Stack n Stock"
            className={styles.logo}
          />
          <h1 className={styles.title}>StacknStock Projects</h1>
          <p className={styles.subtitle}>Create your account</p>
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
                autoComplete="name"
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Email</label>
            <div className={styles.inputWrapper}>
              <Mail size={16} className={styles.inputIcon} />
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="you@company.com"
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
                minLength={6}
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
                minLength={6}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 size={18} className={styles.spinner} />
              Creating account…
            </>
          ) : (
            'Create Account'
          )}
        </button>

        <p className={styles.footerText}>
          Already have an account?{' '}
          <Link to="/login" className={styles.footerLink}>Sign in</Link>
        </p>
      </form>
    </div>
  )
}
