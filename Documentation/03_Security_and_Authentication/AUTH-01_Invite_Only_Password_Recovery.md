# AUTH-01: Invite-Only Authentication & Forgotten Password Recovery

## Status
- **Status**: `VERIFIED / FROZEN`
- **Canonical Baseline Commit**: `3a8ae1176b6ec86be52d0a0684a0d8ba39a73fa4`
- **Date**: 2026-08-24
- **Applies To**: Global Authentication, Session Lifecycle, Password Recovery, Organization Security

---

## 1. Executive Summary & Problem Statement

SNS Projects is an enterprise internal organization command center. Accounts are created exclusively by administrators through the Users Administration interface via the server-side `admin-manage-workspace-user` Edge Function.

Prior to AUTH-01:
1. **Public Self-Registration Exposure**: Legacy `/signup` frontend routes and client `signUp` methods existed, which violated the invite-only access model.
2. **Account Recovery Defect**: Legitimate users who forgot their permanent credentials had no automated mechanism to recover their account, creating administrative bottlenecks.

AUTH-01 closes both defects by:
- Completely eliminating public self-registration from the application bundle and enforcing server-side signup disablement.
- Introducing a secure, enumeration-resistant "Forgot your password?" workflow (`/forgot-password`) and a dedicated "Reset Password" workflow (`/reset-password`).
- Requiring dual provenance on the password-reset gate (`isPasswordRecovery === true && Boolean(session?.user?.id)`).
- Validating global session invalidation (`signOut({ scope: 'global' })`) without silent error swallowing.
- Extracting a canonical shared password complexity evaluator (`src/lib/passwordPolicy.js`) to guarantee zero drift between onboarding and recovery password policies.
- Protecting the existing temporary password first-login onboarding contract (`must_change_password`, `complete_first_login`, `workspace_members.status`).

---

## 2. Authentication Model Architecture

```
                                  [ INVITE / PROVISION FLOW ]
                                                │
                                    Workspace Admin / Owner
                                                │
                                  admin-manage-workspace-user
                                                │
                                 auth.admin.createUser (18-char temp)
                                                │
                                         First-time Login
                                                │
                                         /change-password
                                                │
                                       complete_first_login
                                                │
                                        Active Workspace Access


                                  [ PASSWORD RECOVERY FLOW ]
                                                │
                                           Existing User
                                                │
                                         /forgot-password
                                                │
                                   supabase.auth.resetPasswordForEmail
                                                │
                                     Email Recovery Link Sent
                                                │
                                  User clicks native recovery link
                                                │
                                          /reset-password
                                  (PASSWORD_RECOVERY Auth Event + Session)
                                                │
                                   updateUser({ newPassword })
                                                │
                                      signOut({ scope: 'global' })
                                                │
                                             /login
```

---

## 3. Security Invariants & Core Specifications

### A. Public Self-Registration Surface Elimination
- **Frontend Removal**: Deleted `src/pages/SignUpPage.jsx` and `src/pages/SignUpPage.module.css`. Removed all links to `/signup` from `LoginPage.jsx`. Legacy `/signup` requests redirect to `/login`.
- **Client API Cleanup**: Removed `signUp()` from `AuthContext.jsx`.
- **Server-Side Enforcement**: Configured `[auth] enable_signup = false` in `supabase/config.toml` and verified hosted Supabase GoTrue rejects public signup attempts.

### B. NO Application-Managed Recovery Tokens
- **Native Lifecycle**: Supabase Auth owns the secure recovery token issuance, cryptographic verification, and session establishment.
- **Zero Token Persistence**: SNS Projects does not generate custom tokens, maintain token database tables, persist recovery tokens in `localStorage`, or log tokens in server or browser consoles.

### C. Pure & Dynamic Recovery URL Construction
- **Basename Awareness**: Implemented `buildRecoveryRedirectUrl(origin, base)` and `getRecoveryRedirectUrl()` in `src/lib/url.js` using `window.location.origin` and `import.meta.env.BASE_URL` with the standard `URL` constructor.
- **Zero Hardcoded Hostnames**: Generates `https://abzops.github.io/sns-projects/reset-password` in production and `http://localhost:<port>/reset-password` in development without duplicate slashes.

### D. Recovery State Machine in AuthContext
- `isPasswordRecovery` is set to `true` when `event === 'PASSWORD_RECOVERY'`.
- `isPasswordRecovery` is preserved across `TOKEN_REFRESHED`, `USER_UPDATED`, `INITIAL_SESSION`, and listener `SIGNED_IN` during the active recovery flow.
- `isPasswordRecovery` is reset to `false` upon `SIGNED_OUT`, explicit completion (`clearPasswordRecoveryState`), cancellation, or explicit standard `signIn(email, password)`.

### E. Fail-Closed Reset Gate (Session + Recovery Provenance)
- Navigating to `/reset-password` requires dual authorization:
  ```javascript
  const recoveryAuthorized = isPasswordRecovery === true && Boolean(session?.user?.id);
  ```
- Any unauthorized access renders a fail-closed error card:
  - Title: *"Reset link invalid or expired"*
  - Description: *"The password reset link is invalid, expired, or has already been used."*
  - Actions: `[ Request a New Link ]` (`/forgot-password`) and `[ Back to Sign In ]` (`/login`).

### F. Shared Password Complexity Policy
Extracted `src/lib/passwordPolicy.js` (`evaluatePassword`), enforcing:
- Minimum 12 characters
- At least one uppercase letter (A–Z)
- At least one lowercase letter (a–z)
- At least one numeric digit (0–9)
- At least one special symbol (`!@#$%^&*()_+~|}{[]:;?><,.-=`)
- Password confirmation match

Both `ChangePasswordPage.jsx` and `ResetPasswordPage.jsx` consume this shared evaluator.

### G. Enumeration-Safe Request Handling
- `ForgotPasswordPage.jsx` renders an identical generic confirmation message (*"If an account exists for this email, we've sent a password reset link."*) for both existing and non-existent email addresses.
- Operational infrastructure, rate-limit, or network errors surface generic non-enumerating messages (*"We couldn't process the reset request right now. Please try again later."*).
- Implements a 60-second cooldown timer to prevent rapid duplicate submissions.

### H. Global Session Invalidation Post-Reset
- Upon successful password update, `supabase.auth.signOut({ scope: 'global' })` is invoked to invalidate existing sessions across all browsers.
- `signOut` return value is inspected for errors and fails closed without silent error suppression.
- The user is redirected to `/login` with success confirmation (*"Password reset successfully. Sign in with your new password."*).

### I. Onboarding & First-Login Immutability
- Password recovery updates authentication credentials only.
- It never clears `app_metadata.must_change_password`, mutates `workspace_members.status`, or invokes `complete_first_login`.
- If an onboarding employee forgets their temporary password and uses recovery, their `must_change_password` flag remains `true`, routing them to `/change-password` upon sign-in to complete the official workspace activation.

### J. Multi-User Recovery Isolation
- Opening a recovery link for User B while User A is logged in replaces the session with User B's recovery identity before allowing password modification.

---

## 4. File Changes Summary

| Action | File Path | Purpose |
| :--- | :--- | :--- |
| **NEW** | `src/lib/passwordPolicy.js` | Shared permanent password complexity evaluation utility |
| **NEW** | `src/lib/url.js` | Pure dynamic recovery redirect URL constructor respecting basename |
| **NEW** | `src/pages/ForgotPasswordPage.jsx` | Enumeration-safe password reset request view |
| **NEW** | `src/pages/ForgotPasswordPage.module.css` | Styling for forgot password page with design tokens |
| **NEW** | `src/pages/ResetPasswordPage.jsx` | Gated recovery-session password update view with global signout check |
| **NEW** | `src/pages/ResetPasswordPage.module.css` | Styling for reset password page and invalid state |
| **NEW** | `scripts/test-auth-password-recovery.mjs` | 50-assertion behavioral and contract automated test suite |
| **NEW** | `Documentation/03_Security_and_Authentication/AUTH-01_Invite_Only_Password_Recovery.md` | Security specification & verification record |
| **MODIFY** | `src/contexts/AuthContext.jsx` | Recovery state machine, explicit `signIn` clear, removed `signUp` |
| **MODIFY** | `src/pages/LoginPage.jsx` | Removed signup, added forgot link and success banner |
| **MODIFY** | `src/pages/LoginPage.module.css` | Added labelRow, forgotLink, and successBox styles |
| **MODIFY** | `src/pages/ChangePasswordPage.jsx` | Refactored to consume shared `evaluatePassword` |
| **MODIFY** | `src/App.jsx` | Registered `/forgot-password`, `/reset-password`, `/signup` redirect |
| **MODIFY** | `supabase/config.toml` | Added `[auth] enable_signup = false` |
| **MODIFY** | `package.json` | Registered `npm run test:auth-recovery` |
| **MODIFY** | `Documentation/00_Governance/IMPLEMENTATION_ROADMAP.md` | Recorded AUTH-01 hotfix certification |
| **DELETE** | `src/pages/SignUpPage.jsx` | Removed public self-registration component |
| **DELETE** | `src/pages/SignUpPage.module.css` | Removed public self-registration styling |

---

## 5. Verification & Test Evidence

### Automated Test Suite (`npm run test:auth-recovery`)
- **Assertions Passed**: **`50 / 50`** (100% PASS) across 8 test suites:
  - Suite 1: Surface & Routing Integrity (Assertions 01–10)
  - Suite 2: Pure Dynamic URL Construction & Basename Exactness (Assertions 11–15)
  - Suite 3: ForgotPasswordPage Request & Enumeration Safety (Assertions 16–21)
  - Suite 4: REAL Behavioral AuthContext State Machine Simulation Harness (Assertions 22–27)
  - Suite 5: ResetPasswordPage Gating & Session Provenance (Assertions 28–37)
  - Suite 6: Shared Password Policy & Multi-User Recovery Isolation (Assertions 38–40)
  - Suite 7: Security Invariants & Onboarding Isolation (Assertions 41–46)
  - Suite 8: Server-Side Configuration & Responsive CSS Tokens (Assertions 47–50)

### Full Regression Gate
- `npm run test:auth-recovery`: 50/50 PASS
- `npm run test:p7-02a`: 56/56 PASS
- `npm run test:p7-01`: 41/41 PASS
- `npm run test:ov1-access`: 50/50 PASS
- `npm run test:ov1-frontend`: 37/37 PASS
- `npm run test:ov1-dashboard`: 43/43 PASS
- `npm run test:loading-stabilization`: 24/24 PASS
- `npm run test:stability`: PASS
- Package 6, 5, 4 test suites: 100% PASS
- `npx oxlint src/`: 0 errors
- `npm run build`: Vite production bundle succeeded with 0 errors
