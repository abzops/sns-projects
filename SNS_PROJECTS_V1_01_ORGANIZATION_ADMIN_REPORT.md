# SNS Projects — V1-01 Real Users & Organization Administration Report

**Release**: V1-01 — Temporary Password Onboarding Architecture
**Date**: August 16, 2026
**Status**: **READY FOR CONTROLLED TEMPORARY PASSWORD ONBOARDING**
**Target Workspace ID**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects Dataset)
**Database Host**: `db.gqerfixdmgbqahgslzsq.supabase.co`
**Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)

---

## 1. Executive Summary

Email invitation onboarding (`auth.admin.inviteUserByEmail()`) has been completely replaced with a secure **Temporary Password Provisioning Flow**.

- **No Email Onboarding**: Employees no longer receive confirmation or invite emails.
- **Direct Auth Provisioning**: The server-side Edge Function creates the Supabase Auth account directly (`auth.admin.createUser`) with `email_confirm = true`, a cryptographically random 18-character temporary password (`crypto.getRandomValues`), and `app_metadata.must_change_password = true`.
- **Pending Initial State**: `workspace_members.status` starts as `pending` even though the Auth email is confirmed.
- **First-Login Gate**: Users with `app_metadata.must_change_password = true` are locked out of normal workspace routes (`/workspace/...`, `/dashboard`, etc.) by `ProtectedRoute` and redirected to a dedicated `/change-password` page.
- **Activation Action**: After setting their new password via official `supabase.auth.updateUser({ password })`, the employee calls `complete_first_login` on the Edge Function. This marks `app_metadata.must_change_password = false` and `workspace_members.status = 'active'`, then refreshes the session.
- **Transient Credential Display**: The temporary password is generated in memory only, returned in the response payload to the admin once, and never persisted or logged.

---

## 2. Temporary Password Onboarding Matrix

| Check / Requirement | Status | Details |
| :--- | :---: | :--- |
| **Provision action implemented** | **YES** | `action: "provision"` on `admin-manage-workspace-user` |
| **Email invitation workflow disabled in UI** | **YES** | All UI flows use `action: "provision"` with temporary password modal |
| **Temporary password generation** | **PASS** | Server-side 18-char cryptographic randomness (`crypto.getRandomValues`) |
| **Password stored anywhere** | **NO** | Never stored in DB, never logged, never committed, never in metadata |
| **must_change_password gate** | **PASS** | Global `ProtectedRoute` redirects to `/change-password` |
| **pending membership gate** | **PASS** | Member status starts as `pending`; RLS blocks data access |
| **Forced password screen** | **PASS** | `/change-password` without sidebar/nav, with password strength meter |
| **Password update** | **PASS** | Uses official `supabase.auth.updateUser({ password })` |
| **Activation action** | **PASS** | `action: "complete_first_login"` (caller-only, idempotent) |
| **Session refresh** | **PASS** | Calls `supabase.auth.refreshSession()` after password change |
| **Pending user project access blocked** | **PASS** | RLS + `ProtectedRoute` both fail-closed |
| **Samson migration status** | **PREPARED** | Existing Auth user converted via `updateUserById`, roles preserved |
| **Real new users provisioned during implementation** | **0** | No bulk employee creation performed |
| **Emails sent** | **0** | No emails dispatched |
| **Live function version** | **3** (Current live) / **v4** (Updated with provision flow) |

---

## 3. Final Department Set (7 Total)

| Department Code | Department Name | Color | Description | Head Status |
| :--- | :--- | :--- | :--- | :--- |
| **`COMM`** | Commercials & Partnerships | `#ffb020` | Business development, client relationships, and commercial agreements | Jithin Stalin (Approved) |
| **`ENG`** | Engineering | `#60d394` | Hardware, robotics, mechanical, and technical design | Abhijith T Gopi (Approved) |
| **`FIN`** | Finance | `#ff8c42` | Financial planning, accounting, budgets, and fiscal compliance | Joseph George (Lead, Approved) |
| **`OPS`** | Operations | `#fde215` | Field operations, facilities, and process execution | Jazeel Muhammed (Approved) |
| **`PROC`** | Procurement | `#c084fc` | Vendor management, sourcing, and purchasing | Vaishnav PV (Sourcing, Approved) |
| **`SCM`** | Supply Chain | `#2dd4bf` | Supply chain management, logistics, warehousing, and inventory distribution | Siva Sankar (Lead, Approved) |
| **`SWIT`** | Software & IT | `#8cc9ff` | Software engineering, internal tooling, and cloud infrastructure | **Abhinand** (Active) |

---

## 4. Real Users & Frozen Organization Mapping

| # | Full Name | Corporate Email | Dept | Dept Role | Workspace Role | System Roles | Status |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Abhinand** | `abhinand@stacknstock.in` | `SWIT` | **Head** (Primary) | **Owner** | `project_admin`, `system_admin` | **Active Owner** |
| **2** | Abhijith T Gopi | `abhijith.gopi@stacknstock.in` | `ENG` | **Head** (Primary) | `admin` | `cto` | Onboarding Queue (0 Sent) |
| **3** | Hari P | `hari@stacknstock.in` | `COMM` | `member` (Primary) | `viewer` | *None* | Onboarding Queue (0 Sent) |
| **4** | Jazeel Muhammed | `ops@stacknstock.in` | `OPS` | **Head** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **5** | Jithin Stalin | `jithinstalin@stacknstock.in` | `COMM` | **Head** (Primary) | `admin` | `ceo` | Onboarding Queue (0 Sent) |
| **6** | Joseph George | `joseph.george@stacknstock.in` | `FIN` | **Lead** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **7** | Samson Jose | `projects@stacknstock.in` | `SWIT` | `member` (Primary) | `viewer` | *None* | Existing User (Pending) |
| **8** | Saravana P | `saravana@stacknstock.in` | `ENG` | **Lead** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **9** | Siva Sankar | `siva@stacknstock.in` | `SCM` | **Lead** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **10** | Sourav Sangeeth | `sourav@stacknstock.in` | `ENG` | `member` (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **11** | Suryajith K M | `surya@stacknstock.in` | `COMM` | **Lead** (Primary) | `viewer` | *None* | Onboarding Queue (0 Sent) |
| **12** | Vaishnav PV | `sourcing@stacknstock.in` | `OPS` | `member` (Primary) | `viewer` | *None* | Onboarding Queue (0 Sent) |

---

## 5. Test Verification Summary

```
===============================================================
Temporary Password Onboarding Suite (25 Tests): 25 PASSED, 0 FAILED
Invitation 500 Fix — Regression Tests:          20 PASSED, 0 FAILED
V1-01 API Hardening — Static/Unit Tests:        23 PASSED, 0 FAILED
Defined Process Frontend MVP — Static:          37 PASSED, 0 FAILED
===============================================================
Total Static & Unit Verifications:              105 PASSED, 0 FAILED
===============================================================
```

- **Code Quality**:
  - ESLint: ✅ 0 errors
  - Vite Production Build: ✅ Succeeded in 1.08s (1915 modules)
  - Secret Scan: ✅ Clean (No database password or service role secrets committed)

---

## 6. Edge Function Deployment

To deploy the updated function to Supabase:
```bash
npx supabase functions deploy admin-manage-workspace-user --project-ref gqerfixdmgbqahgslzsq
```
*(Do NOT use `--no-verify-jwt`)*
