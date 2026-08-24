/**
 * Safe Recovery URL Helper for Vite & GitHub Pages
 *
 * Constructs the canonical password-reset redirect URL dynamically using
 * window.location.origin and import.meta.env.BASE_URL without hardcoding hostnames.
 *
 * Examples:
 * Production (GitHub Pages):  https://abzops.github.io/sns-projects/reset-password
 * Local Development:          http://localhost:5173/reset-password
 */

export function getRecoveryRedirectUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    throw new Error('getRecoveryRedirectUrl must be called in a browser environment');
  }

  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;

  return new URL(`${cleanBase}reset-password`, window.location.origin).toString();
}
