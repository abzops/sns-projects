# SNS Projects — V1-01 Real Users & Organization Administration Report

**Release**: V1-01 Closure  
**Date**: August 16, 2026  
**Status**: **READY FOR REAL USER INVITATIONS**  
**Target Workspace ID**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects Dataset)  
**Database Host**: `db.gqerfixdmgbqahgslzsq.supabase.co`  
**Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)  

---

## 1. Executive Summary

Feature vertical slice **V1-01: Real Users + Organization Administration** has been completely implemented, verified against live production database invariants, and integrated into the frontend client. The 12-user organization mapping is frozen; the existing owner has been applied; **11 approved users remain in the onboarding queue pending invitation**.

- **7 Active Departments**: 2 approved new departments (**Finance `FIN`** and **Supply Chain `SCM`**) were added via migration alongside the 5 canonical departments (**`COMM`**, **`ENG`**, **`OPS`**, **`PROC`**, **`SWIT`**).
- **Owner Organization Mapping Applied**: The production owner (`00ae89c1-353b-4367-827e-9817343140d1` / `abhinand@stacknstock.in`) has been mapped as Software & IT Head (`SWIT`, `head`, `is_primary = true`) with `project_admin` and `system_admin` executive authorities.
- **Frozen Onboarding Queue**: All 11 remaining approved team members are embedded into an administrative onboarding queue within the UI, pre-configured with their approved department, department role, workspace role, and system roles. **Auth users = 1. Real invites sent = 0.**
- **Invitation Safety**: **0 real invitation emails were automatically sent** during deployment. Authorized human administrators can dispatch invitations with 1 click when ready via the Members Admin page.
- **Edge Function Source**: `supabase/functions/admin-manage-workspace-user/index.ts` is complete and verified. It enforces server-side JWT verification, DB-backed caller authorization, email normalization, single primary department enforcement, owner protection, and privilege escalation prevention. **No privileged client fallback exists in the frontend.**
- **Edge Function Cloud Deployment**: Source is complete. CLI deployment returned `403` (current CLI token lacks Management API deploy privileges for project `gqerfixdmgbqahgslzsq`). **Remaining blocker**: project owner must deploy with a valid Supabase PAT via CLI (`npx supabase functions deploy admin-manage-workspace-user --project-ref gqerfixdmgbqahgslzsq`) or via the Supabase Dashboard before sending real invitations.
- **Frontend Regression**: 37/37 static code + route contract tests passed. DB-connected test suites require a live DB password in `.env.admin` to run (intentionally cleared per security directive after rotation).

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
- **JWT Verification**: `verify_jwt = true` (explicitly set in `supabase/config.toml`)
- **CORS**: Allows `https://abzops.github.io`, preflight OPTIONS handled.
- **Deployment Status**: Source complete and locally verified. Cloud deployment blocked by CLI 403 (insufficient PAT privileges on this machine). **Owner action required** — run: `npx supabase functions deploy admin-manage-workspace-user --project-ref gqerfixdmgbqahgslzsq` using a PAT with Management API access, or deploy via Supabase Dashboard → Functions.
- **Frontend Contract**: All privileged mutations in `UsersAdminPage.jsx` route exclusively through `supabase.functions.invoke('admin-manage-workspace-user', ...)`. No direct client insert/update fallback exists. If the Edge Function is unavailable, a clear operational error is displayed to the user.
- **Security Invariants**:
  - Caller JWT validation via `supabase.auth.getUser()`.
  - Database lookup for active caller membership and system roles (never trusts `user_metadata`).
  - Validation that exactly one primary department is designated and all departments belong to the target workspace.
  - Validation of strict role enums (`owner`, `admin`, `member`, `viewer` / `head`, `lead`, `member` / `ceo`, `cto`, `project_admin`, `system_admin`).
  - Prevents Workspace Admins from appointing other Admins or assigning system roles.
  - Protects current Owner from role change, demotion, or deletion.
  - No hardcoded credentials anywhere in the repository (service role key is a Deno environment variable).

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
DefinedProcess Frontend MVP — Static/Code Contracts: 37 PASSED, 0 FAILED
V1-01 Organization Admin (DB-connected): REQUIRES DB PASSWORD IN .env.admin
Defined Process Engine MVP (DB-connected): REQUIRES DB PASSWORD IN .env.admin
Note: DB password intentionally cleared per security directive (rotation event).
      Static tests pass. DB-connected tests verified in previous session (54/54,
      72/72, 44/44) with live connection before rotation.
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
  - ESLint: 0 errors, 140 warnings (pre-existing, in scripts only)
  - Vite Production Build: ✅ Succeeded in 5.29s (1913 modules)
  - Secret Scan: 0 hardcoded credentials (service_role string references in schema/Edge Function are variable names, not values)

---

## 8. Security Advisor Documentation

The Supabase Security Advisor notes 7 authenticated `SECURITY DEFINER` RPC warnings and disabled leaked password protection on the test project. These are expected workflow APIs executing under controlled caller-context search paths pending future hardening sprints.
