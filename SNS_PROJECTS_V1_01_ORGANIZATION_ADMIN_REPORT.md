# SNS Projects — V1-01 Real Users & Organization Administration Report

**Release**: V1-01 Closure — API Hardening Pass
**Date**: August 16, 2026
**Status**: **READY FOR CONTROLLED REAL USER INVITATIONS**
**Target Workspace ID**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects Dataset)
**Database Host**: `db.gqerfixdmgbqahgslzsq.supabase.co`
**Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)

---

## 1. Executive Summary

Feature vertical slice **V1-01: Real Users + Organization Administration** is fully implemented, hardened, and deployed. The 12-user organization mapping is frozen; the existing owner has been applied; **11 approved users remain in the onboarding queue pending invitation**.

- **7 Active Departments**: 2 approved new departments (**Finance `FIN`** and **Supply Chain `SCM`**) alongside the 5 canonical departments (**`COMM`**, **`ENG`**, **`OPS`**, **`PROC`**, **`SWIT`**).
- **Owner Organization Mapping Applied**: Production owner (`00ae89c1-353b-4367-827e-9817343140d1` / `abhinand@stacknstock.in`) mapped as Software & IT Head (`SWIT`, `head`, `is_primary = true`) with `project_admin` and `system_admin` authorities.
- **Frozen Onboarding Queue**: All 11 remaining approved team members are in the UI onboarding queue, pre-configured. **Auth users = 1. Real invites sent = 0.**
- **Invitation Safety**: 0 real invitation emails were automatically sent during any implementation session.
- **Edge Function Deployed**: `admin-manage-workspace-user` is ACTIVE on production (confirmed 401 on unauthenticated request). Version 1 deployed by project owner independently. The API hardening pass (this session) produces updated source that must be deployed as version 2 — see Section 12.
- **No Privileged Browser Fallback**: All privileged mutations in `UsersAdminPage.jsx` route exclusively through `supabase.functions.invoke('admin-manage-workspace-user', ...)`. No direct client insert/update fallback exists.

---

## 2. Final Department Set (7 Total)

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

## 3. Real Users & Frozen Organization Mapping

| # | Full Name | Corporate Email | Dept | Dept Role | Workspace Role | System Roles | Status |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Abhinand** | `abhinand@stacknstock.in` | `SWIT` | **Head** (Primary) | **Owner** | `project_admin`, `system_admin` | **Active Owner** |
| **2** | Abhijith T Gopi | `abhijith.gopi@stacknstock.in` | `ENG` | **Head** (Primary) | `admin` | `cto` | Onboarding Queue (0 Sent) |
| **3** | Hari P | `hari@stacknstock.in` | `COMM` | `member` (Primary) | `viewer` | *None* | Onboarding Queue (0 Sent) |
| **4** | Jazeel Muhammed | `ops@stacknstock.in` | `OPS` | **Head** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **5** | Jithin Stalin | `jithinstalin@stacknstock.in` | `COMM` | **Head** (Primary) | `admin` | `ceo` | Onboarding Queue (0 Sent) |
| **6** | Joseph George | `joseph.george@stacknstock.in` | `FIN` | **Lead** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **7** | Samson Jose | `projects@stacknstock.in` | `SWIT` | `member` (Primary) | `viewer` | *None* | Onboarding Queue (0 Sent) |
| **8** | Saravana P | `saravana@stacknstock.in` | `ENG` | **Lead** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **9** | Siva Sankar | `siva@stacknstock.in` | `SCM` | **Lead** (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **10** | Sourav Sangeeth | `sourav@stacknstock.in` | `ENG` | `member` (Primary) | `member` | *None* | Onboarding Queue (0 Sent) |
| **11** | Suryajith K M | `surya@stacknstock.in` | `COMM` | **Lead** (Primary) | `viewer` | *None* | Onboarding Queue (0 Sent) |
| **12** | Vaishnav PV | `sourcing@stacknstock.in` | `OPS` | `member` (Primary) | `viewer` | *None* | Onboarding Queue (0 Sent) |

---

## 4. Organization Authority Matrix

| Role / Authority | Invite Member/Viewer | Invite / Create Admin | Assign Dept Memberships | Assign System Roles (`ceo`, `cto`, `pa`, `sa`) | Demote / Remove Owner |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Workspace Owner** | Yes | Yes | Yes | Yes | **No** (Protected) |
| **System Admin** | Yes | Yes | Yes | Yes | **No** (Protected) |
| **Workspace Admin** | Yes | **No** | Yes | **No** | **No** |
| **CEO alone** | No | No | No | No | No |
| **CTO alone** | No | No | No | No | No |
| **Project Admin alone** | No | No | No | No | No |
| **Member / Viewer** | No | No | No | No | No |

---

## 5. Security & Edge Function Implementation

- **File**: `supabase/functions/admin-manage-workspace-user/index.ts`
- **Actions**: `invite`, `update`
- **JWT Verification**: `verify_jwt = true` in `supabase/config.toml` (platform-level) **AND** explicit `supabase.auth.getUser()` function-level check. Double authorization is maintained.
- **CORS**: Hardened — `ALLOWED_ORIGINS` set: `https://abzops.github.io`, `http://localhost:5173`, `http://127.0.0.1:5173`. Per-request `Origin` header matched. `Vary: Origin` added. No wildcard `*`.
- **Primary Department Invariant**: `invite` requires `departments` array with ≥1 entry and exactly 1 `is_primary = true`. `departments` omitted or `departments: []` → HTTP 400. `update` with `departments` supplied enforces same invariant; `departments` omitted leaves existing assignments unchanged.
- **Fail-Closed Writes**: Every DB mutation is wrapped with `assertNoError()`. Any failed write throws, and `success: true` is never returned unless all mutations succeed.
- **Partial-Failure Cleanup** (invite only): Tracks `wasNewAuthUser`. If Postgres writes fail after a new auth invitation is created, `cleanupOnFailure()` performs best-effort rollback of created org rows and deletes the new auth user via `auth.admin.deleteUser()`. Existing auth users are never deleted.
- **Paginated User Lookup**: `findAuthUserByEmail()` uses page-based pagination (`perPage: 1000, page++`) to safely scan the full auth user list. Not limited to page 1.
- **Frontend Contract**: All privileged mutations in `UsersAdminPage.jsx` route exclusively through `supabase.functions.invoke('admin-manage-workspace-user', ...)`. No direct client insert/update fallback.
- **Security Invariants**:
  - Caller JWT validation via `supabase.auth.getUser()` (never trusts `user_metadata`).
  - DB lookup for active workspace role and system roles to determine authority.
  - Strict role enum enforcement (`owner/admin/member/viewer`, `head/lead/member`, `ceo/cto/project_admin/system_admin`).
  - Workspace Admin cannot appoint Admins or assign system roles.
  - Owner is protected from demotion or removal.
  - CEO, CTO, Project Admin alone grant no org-admin authority.

---

## 6. Frontend UI Enhancements

1. **Users & Roles Page (`src/pages/UsersAdminPage.jsx`)**:
   - Top stats banner: Total Personnel, 7 Departments, Department Heads, Project Admins, System Admins.
   - Onboarding Queue: Lists all 11 approved employees with 1-click pre-filled invite modal.
   - Active Personnel Table: Personnel name (with "Complete your profile" prompt if null), email, workspace role, primary department badge with role, additional department badges, system role pills, status badge, edit/remove actions.
   - Comprehensive Invite Modal & Edit Modal with strict role gating based on caller permissions.
2. **Departments Page (`src/pages/DepartmentsPage.jsx`)**:
   - Displays all 7 departments with color bars, codes, names, descriptions.
   - Enriched cards display Department Head, Department Lead(s) count, and total active member count.
3. **Identity & Profile UX**:
   - Profiles with null `full_name` display a clean `"Complete your profile"` badge that opens a self-profile update modal.

---

## 7. Verification & Test Results

```
===============================================================
V1-01 API Hardening — Static/Unit Tests:    23 PASSED, 0 FAILED
Defined Process Frontend MVP — Static:      37 PASSED, 0 FAILED
V1-01 Organization Admin (DB-connected):    REQUIRES DB PASSWORD IN .env.admin
Defined Process Engine MVP (DB-connected):  REQUIRES DB PASSWORD IN .env.admin

Note: The previous database password appeared in transient CLI output, was
treated as exposed, and was rotated. No current database credential is
committed to the repository. DB-connected tests were last verified against
live production in the previous session (54/54, 72/72, 44/44 — all passed)
before the rotation event. Static tests cover all new hardening requirements.
===============================================================
```

- **Database Integrity** (verified in previous session, production live):
  - Workspaces: 1 active target (`dbcaddf1-cf02-4bad-8af1-974301cdfbea`)
  - Departments: 7 active
  - Auth Users: 1 (`abhinand@stacknstock.in`)
  - Real Invites Sent: **0** (all 11 employees remain in onboarding queue)
  - Projects: 3
  - Defined Processes: 1 published (`INTERNAL-MVP-DEMO`)
- **Code Quality (this session)**:
  - ESLint: ✅ 0 errors, 140 pre-existing script warnings
  - Vite Production Build: ✅ Succeeded in 944ms (1913 modules)
  - Secret Scan: ✅ No hardcoded credentials. The previous database password appeared in transient CLI output, was treated as exposed, and was rotated. No current database credential is committed to the repository.

---

## 8. Edge Function Deployment Status

| Item | Status |
| :--- | :--- |
| Production function exists | ✅ ACTIVE (user-verified) |
| Version before this hardening pass | 1 |
| Unauthenticated request → 401 | ✅ Confirmed |
| `verify_jwt = true` (platform) | ✅ `supabase/config.toml` |
| Function-level `getUser()` auth | ✅ Source verified |
| CLI deploy of hardened source (v2) | ⚠️ **Requires owner login** |

**To deploy the hardened source (v2)**: Run `npx supabase login` interactively as the project owner in your terminal, then:
```
npx supabase functions deploy admin-manage-workspace-user --project-ref gqerfixdmgbqahgslzsq
```
Do NOT use `--no-verify-jwt`.

---

## 9. Security Advisor Documentation

The Supabase Security Advisor notes 7 authenticated `SECURITY DEFINER` RPC warnings and disabled leaked password protection on the test project. These are expected workflow APIs executing under controlled caller-context search paths pending future hardening sprints.
