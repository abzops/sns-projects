/**
 * Canonical Password Policy Evaluation Utility
 *
 * Enforces SNS Projects Permanent Password Complexity Requirements:
 * - Minimum 12 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one numeric digit (0-9)
 * - At least one special symbol (!@#$%^&*()_+~|}{[]:;?><,.-=)
 * - Passwords match
 */

export function evaluatePassword(password = '', confirmPassword = '') {
  const p = password || '';
  const cp = confirmPassword || '';

  const hasMinLength = p.length >= 12;
  const hasUppercase = /[A-Z]/.test(p);
  const hasLowercase = /[a-z]/.test(p);
  const hasDigit = /[0-9]/.test(p);
  const hasSymbol = /[!@#$%^&*()_+~|}{[\]:;?><,.\-=]/.test(p);
  const passwordsMatch = p.length > 0 && p === cp;

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
}
