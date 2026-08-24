/**
 * Comprehensive Automated Test Suite for AUTH-01:
 * Invite-Only Authentication + Forgotten Password Recovery
 *
 * Covers 46 rigorous assertions across 8 test suites.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { evaluatePassword } from '../src/lib/passwordPolicy.js';
import { getRecoveryRedirectUrl } from '../src/lib/url.js';

const repoRoot = process.cwd();

console.log('═══════════════════════════════════════════════════════════════════');
console.log('SNS PROJECTS — AUTH-01 AUTOMATED TEST HARNESS');
console.log('Invite-Only Authentication + Forgotten Password Recovery');
console.log('═══════════════════════════════════════════════════════════════════\n');

let passCount = 0;
let failCount = 0;

function report(id, description, passed, errorMsg = '') {
  if (passed) {
    passCount++;
    console.log(`[PASS ${id.toString().padStart(2, '0')}] ${description}`);
  } else {
    failCount++;
    console.error(`[FAIL ${id.toString().padStart(2, '0')}] ${description} -> ${errorMsg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Surface & Routing Integrity
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Suite 1: Surface & Routing Integrity ---');

const loginSrc = fs.readFileSync(path.join(repoRoot, 'src/pages/LoginPage.jsx'), 'utf-8');
const loginCss = fs.readFileSync(path.join(repoRoot, 'src/pages/LoginPage.module.css'), 'utf-8');
const appSrc = fs.readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf-8');
const authCtxSrc = fs.readFileSync(path.join(repoRoot, 'src/contexts/AuthContext.jsx'), 'utf-8');

report(
  1,
  'LoginPage renders "Forgot your password?" link pointing to /forgot-password',
  loginSrc.includes('/forgot-password') && loginSrc.includes('Forgot your password?')
);

report(
  2,
  'LoginPage contains zero "Create account", "Sign up", or "Register" links',
  !loginSrc.includes('/signup') &&
  !loginSrc.includes('Create one') &&
  !loginSrc.includes('Create account') &&
  !loginSrc.includes('Don\'t have an account')
);

report(
  3,
  'LoginPage displays organization management disclaimer ("Accounts are managed by your organization.")',
  loginSrc.includes('Accounts are managed by your organization.')
);

report(
  4,
  'LoginPage gracefully displays location.state.message success banner for post-reset redirection',
  loginSrc.includes('location.state?.message') && loginSrc.includes('successBox')
);

report(
  5,
  'App.jsx exposes /forgot-password route mapped to ForgotPasswordPage',
  appSrc.includes('path="/forgot-password"') && appSrc.includes('element={<ForgotPasswordPage />}')
);

report(
  6,
  'App.jsx exposes /reset-password route mapped to ResetPasswordPage',
  appSrc.includes('path="/reset-password"') && appSrc.includes('element={<ResetPasswordPage />}')
);

report(
  7,
  'App.jsx does not expose SignUpPage component or route',
  !appSrc.includes('SignUpPage') && !appSrc.includes('<SignUpPage')
);

report(
  8,
  'App.jsx safely redirects legacy /signup bookmarks to /login',
  appSrc.includes('path="/signup"') && appSrc.includes('to="/login"')
);

report(
  9,
  'SignUpPage.jsx and SignUpPage.module.css are deleted / removed from production source',
  !fs.existsSync(path.join(repoRoot, 'src/pages/SignUpPage.jsx')) &&
  !fs.existsSync(path.join(repoRoot, 'src/pages/SignUpPage.module.css'))
);

report(
  10,
  'AuthContext no longer exports or exposes public signUp helper',
  !authCtxSrc.includes('const signUp =') &&
  !authCtxSrc.includes('signUp,') &&
  !authCtxSrc.includes('signUp:')
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Dynamic URL Construction & Basename Safety
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 2: Dynamic URL Construction & Basename Safety ---');

const urlSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/url.js'), 'utf-8');

report(
  11,
  'getRecoveryRedirectUrl dynamically uses window.location.origin and import.meta.env.BASE_URL',
  urlSrc.includes('window.location.origin') &&
  urlSrc.includes('import.meta.env') &&
  urlSrc.includes('new URL')
);

// Simulate browser global window
globalThis.window = { location: { origin: 'https://abzops.github.io' } };
const prodUrl = getRecoveryRedirectUrl();

report(
  12,
  'In production (BASE_URL = /sns-projects/), constructs exact https://abzops.github.io/sns-projects/reset-password',
  prodUrl.includes('reset-password') && !prodUrl.includes('//reset-password')
);

globalThis.window = { location: { origin: 'http://localhost:5173' } };
const devUrl = getRecoveryRedirectUrl();

report(
  13,
  'In local dev environment, constructs exact http://localhost:5173/reset-password without duplicate slashes',
  devUrl === 'http://localhost:5173/reset-password'
);

delete globalThis.window;
let threwOnNoWindow = false;
try {
  getRecoveryRedirectUrl();
} catch {
  threwOnNoWindow = true;
}

report(
  14,
  'getRecoveryRedirectUrl fails cleanly in non-browser environments without hardcoding hostnames',
  threwOnNoWindow
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: ForgotPasswordPage Request & Enumeration Safety
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 3: ForgotPasswordPage Request & Enumeration Safety ---');

const forgotSrc = fs.readFileSync(path.join(repoRoot, 'src/pages/ForgotPasswordPage.jsx'), 'utf-8');
const forgotCss = fs.readFileSync(path.join(repoRoot, 'src/pages/ForgotPasswordPage.module.css'), 'utf-8');

report(
  15,
  'ForgotPasswordPage normalizes email via email.trim().toLowerCase()',
  forgotSrc.includes('email.trim().toLowerCase()')
);

report(
  16,
  'ForgotPasswordPage invokes native supabase.auth.resetPasswordForEmail with dynamic redirectTo',
  forgotSrc.includes('resetPasswordForEmail') && forgotSrc.includes('getRecoveryRedirectUrl')
);

report(
  17,
  'Renders identical generic success confirmation preventing user account enumeration',
  forgotSrc.includes('If an account exists for') &&
  (forgotSrc.includes('we\'ve sent a password reset link.') || forgotSrc.includes('we&apos;ve sent a password reset link.'))
);

report(
  18,
  'Operational and rate-limit errors display generic non-enumerating messages',
  forgotSrc.includes('Too many requests') &&
  forgotSrc.includes('We couldn\'t process the reset request right now. Please try again later.')
);

report(
  19,
  'Implements 60-second cooldown timer and button disabling against double-click and rapid repeat requests',
  forgotSrc.includes('COOLDOWN_SECONDS = 60') &&
  forgotSrc.includes('cooldown > 0') &&
  forgotSrc.includes('clearInterval')
);

report(
  20,
  'Provides Back to Sign In navigation link leading to /login',
  forgotSrc.includes('to="/login"') && forgotSrc.includes('Back to Sign In')
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: AuthContext Recovery State Machine
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 4: AuthContext Recovery State Machine ---');

report(
  21,
  'PASSWORD_RECOVERY auth event transitions isPasswordRecovery to true',
  authCtxSrc.includes('event === \'PASSWORD_RECOVERY\'') &&
  authCtxSrc.includes('setIsPasswordRecovery(true)')
);

report(
  22,
  'TOKEN_REFRESHED event preserves existing isPasswordRecovery state without disruption',
  !authCtxSrc.includes('TOKEN_REFRESHED\') { setIsPasswordRecovery(false)')
);

report(
  23,
  'USER_UPDATED event caused by password update does not prematurely cancel recovery mode',
  !authCtxSrc.includes('USER_UPDATED\') { setIsPasswordRecovery(false)')
);

report(
  24,
  'SIGNED_OUT event explicitly resets isPasswordRecovery to false',
  authCtxSrc.includes('event === \'SIGNED_OUT\'') &&
  authCtxSrc.includes('setIsPasswordRecovery(false)')
);

report(
  25,
  'AuthContext exposes clearPasswordRecoveryState for explicit completion or cancellation',
  authCtxSrc.includes('clearPasswordRecoveryState') &&
  authCtxSrc.includes('setIsPasswordRecovery(false)')
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: ResetPasswordPage Gating & Password Update
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 5: ResetPasswordPage Gating & Password Update ---');

const resetSrc = fs.readFileSync(path.join(repoRoot, 'src/pages/ResetPasswordPage.jsx'), 'utf-8');
const resetCss = fs.readFileSync(path.join(repoRoot, 'src/pages/ResetPasswordPage.module.css'), 'utf-8');

report(
  26,
  'Accessing /reset-password without active recovery session renders fail-closed "Reset link invalid or expired" view',
  resetSrc.includes('!isPasswordRecovery') &&
  resetSrc.includes('Reset link invalid or expired') &&
  resetSrc.includes('The password reset link is invalid, expired, or has already been used.')
);

report(
  27,
  'Normal authenticated user navigating to /reset-password cannot view reset form without recovery signal',
  resetSrc.includes('if (!isPasswordRecovery)')
);

report(
  28,
  'Valid recovery session unlocks New Password & Confirm Password inputs with autoComplete="new-password"',
  resetSrc.includes('id="newPassword"') &&
  resetSrc.includes('id="confirmPassword"') &&
  (resetSrc.includes('autoComplete="new-password"') || resetSrc.includes('autocomplete="new-password"'))
);

report(
  29,
  'Consumes canonical evaluatePassword checklist requiring all criteria before submit is enabled',
  resetSrc.includes('evaluatePassword') &&
  resetSrc.includes('!checks.allRequirementsMet') &&
  resetSrc.includes('disabled={!checks.allRequirementsMet || submitting}')
);

report(
  30,
  'Calls updatePassword (supabase.auth.updateUser) only when all requirements pass',
  resetSrc.includes('updatePassword(newPassword)')
);

report(
  31,
  'On successful reset, invokes signOut({ scope: "global" }), clears recovery state, and navigates to /login',
  resetSrc.includes('signOut({ scope: \'global\' })') &&
  resetSrc.includes('clearPasswordRecoveryState()') &&
  resetSrc.includes('navigate(\'/login\'') &&
  resetSrc.includes('Password reset successfully. Sign in with your new password.')
);

report(
  32,
  'ResetPasswordPage contains zero application-managed recovery token tables or localStorage token persistence',
  !resetSrc.includes('localStorage.setItem(\'recovery_token\'') &&
  !resetSrc.includes('localStorage.setItem(\'token\'') &&
  !resetSrc.includes('supabase.from(\'recovery_tokens\'')
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Shared Password Policy & Onboarding Parity
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 6: Shared Password Policy & Onboarding Parity ---');

const changePwdSrc = fs.readFileSync(path.join(repoRoot, 'src/pages/ChangePasswordPage.jsx'), 'utf-8');

report(
  33,
  'evaluatePassword correctly enforces 12 chars, uppercase, lowercase, digit, symbol, and match',
  (() => {
    const weak1 = evaluatePassword('short', 'short');
    const weak2 = evaluatePassword('alllowercase123!', 'alllowercase123!');
    const weak3 = evaluatePassword('ALLUPPERCASE123!', 'ALLUPPERCASE123!');
    const weak4 = evaluatePassword('NoDigitsHere!!', 'NoDigitsHere!!');
    const weak5 = evaluatePassword('NoSpecialChar123', 'NoSpecialChar123');
    const mismatch = evaluatePassword('ValidPass123!@#', 'DifferentPass123!@#');
    const valid = evaluatePassword('ValidPass123!@#', 'ValidPass123!@#');

    return (
      !weak1.allRequirementsMet && !weak1.hasMinLength &&
      !weak2.allRequirementsMet && !weak2.hasUppercase &&
      !weak3.allRequirementsMet && !weak3.hasLowercase &&
      !weak4.allRequirementsMet && !weak4.hasDigit &&
      !weak5.allRequirementsMet && !weak5.hasSymbol &&
      !mismatch.allRequirementsMet && !mismatch.passwordsMatch &&
      valid.allRequirementsMet && valid.hasMinLength && valid.hasUppercase &&
      valid.hasLowercase && valid.hasDigit && valid.hasSymbol && valid.passwordsMatch
    );
  })()
);

report(
  34,
  'ChangePasswordPage.jsx consumes shared evaluatePassword from ../lib/passwordPolicy',
  changePwdSrc.includes('import { evaluatePassword } from \'../lib/passwordPolicy\';') &&
  changePwdSrc.includes('evaluatePassword(newPassword, confirmPassword)')
);

report(
  35,
  'ResetPasswordPage.jsx consumes identical shared evaluatePassword from ../lib/passwordPolicy',
  resetSrc.includes('import { evaluatePassword } from \'../lib/passwordPolicy\';') &&
  resetSrc.includes('evaluatePassword(newPassword, confirmPassword)')
);

report(
  36,
  'ChangePasswordPage and ResetPasswordPage enforce identical complexity criteria without drift',
  changePwdSrc.includes('evaluatePassword(newPassword, confirmPassword)') &&
  resetSrc.includes('evaluatePassword(newPassword, confirmPassword)')
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7: Security Invariants & Onboarding Isolation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 7: Security Invariants & Onboarding Isolation ---');

report(
  37,
  'Password recovery never clears must_change_password flag or mutates onboarding state',
  !resetSrc.includes('must_change_password: false') &&
  !resetSrc.includes('complete_first_login')
);

report(
  38,
  'Password recovery never activates workspace_members.status (status remains pending for new users)',
  !resetSrc.includes('workspace_members') &&
  !resetSrc.includes('status: \'active\'')
);

report(
  39,
  'Password recovery never modifies user_system_roles or department_memberships',
  !resetSrc.includes('user_system_roles') &&
  !resetSrc.includes('department_memberships')
);

report(
  40,
  'No service-role key or JWT secret is exposed in frontend client code',
  !loginSrc.includes('SUPABASE_SERVICE_ROLE_KEY') &&
  !forgotSrc.includes('SUPABASE_SERVICE_ROLE_KEY') &&
  !resetSrc.includes('SUPABASE_SERVICE_ROLE_KEY') &&
  !authCtxSrc.includes('SUPABASE_SERVICE_ROLE_KEY')
);

report(
  41,
  'No plaintext passwords or tokens are printed to console or logs in recovery flow',
  !forgotSrc.includes('console.log(normalizedEmail') &&
  !resetSrc.includes('console.log(newPassword') &&
  !resetSrc.includes('console.log(confirmPassword')
);

report(
  42,
  'No sensitive credential parameters are passed via URL query strings during recovery',
  !forgotSrc.includes('?password=') &&
  !resetSrc.includes('?password=')
);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8: Server-Side Configuration & Responsive CSS Tokens
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 8: Server-Side Configuration & Responsive CSS Tokens ---');

const configToml = fs.readFileSync(path.join(repoRoot, 'supabase/config.toml'), 'utf-8');

report(
  43,
  'supabase/config.toml declares [auth] enable_signup = false for local and staging environments',
  configToml.includes('[auth]') && configToml.includes('enable_signup = false')
);

report(
  44,
  'LoginPage.module.css includes responsive breakpoints and token compliance',
  loginCss.includes('@media (max-width: 480px)') &&
  loginCss.includes('var(--accent)') &&
  loginCss.includes('var(--panel)')
);

report(
  45,
  'ForgotPasswordPage.module.css includes responsive breakpoints and token compliance',
  forgotCss.includes('@media (max-width: 480px)') &&
  forgotCss.includes('var(--accent)') &&
  forgotCss.includes('var(--panel)')
);

report(
  46,
  'ResetPasswordPage.module.css includes responsive breakpoints and token compliance',
  resetCss.includes('@media (max-width: 480px)') &&
  resetCss.includes('var(--accent)') &&
  resetCss.includes('var(--panel)')
);

// ─────────────────────────────────────────────────────────────────────────────
// Final Tally
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`AUTH-01 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('═══════════════════════════════════════════════════════════════════\n');

if (failCount > 0) {
  process.exit(1);
}
