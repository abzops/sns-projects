# SNS Projects — Production Hotfix Report: Workspace Members & Identity Rendering

**Date**: August 14, 2026  
**Status**: **HOTFIX SUCCESS**  
**Commit Hash**: `41c341c2dfeafc990870b9f4efa81d764123c297`  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Live Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)  

---

## 1. Exact Browser & Runtime Root Cause

1. **Uncaught Runtime Exception in Avatar Rendering**:
   - For the production workspace owner account, `full_name` is currently `NULL` and `avatar_url` is `NULL` in `public.profiles`.
   - In `Avatar.jsx`, the default parameter `name = ''` only triggered when `name` was `undefined`. When `name={null}` was passed (e.g. from `member.profiles?.full_name || member.invited_email`), `name.trim().split(/\s+/)` attempted to call `.trim()` on `null`, throwing an uncaught `TypeError: Cannot read properties of null (reading 'trim')`.
   - This unhandled runtime exception caused React's component tree in Workspace Settings to crash on render, resulting in a blank area when the Members tab was active.

2. **Foreign Key Ambiguity in PostgREST Embedding**:
   - `public.workspace_members` has two foreign keys pointing to `public.profiles`:
     - `workspace_members.user_id` $\rightarrow$ `profiles.id` (`workspace_members_user_id_fkey`)
     - `workspace_members.invited_by` $\rightarrow$ `profiles.id` (`workspace_members_invited_by_fkey`)
   - Any raw embedding query like `select('..., profile:profiles(...)')` without specifying the explicit constraint name is ambiguous to PostgREST and fails.

3. **Fallback Identity in Users & Roles**:
   - Because `public.profiles` does not have an `email` column and `full_name` was `null`, `UsersAdminPage.jsx` was previously defaulting to the static fallback text `"User"`.

---

## 2. Surgical Fixes Implemented

1. **Crash-Proof `Avatar.jsx`**:
   - Hardened `getInitials(name)` against `null`, `undefined`, non-string types, empty strings, and whitespace.
   - Extracts initials safely using `charAt(0)` and returns `'?'` whenever name information is unavailable.

2. **Explicit Foreign Key Embedding & Defensive Normalization (`useMembers.js`)**:
   - Updated PostgREST select query to explicitly specify the user relation foreign key:
     ```javascript
     profile:profiles!workspace_members_user_id_fkey(
       id,
       full_name,
       avatar_url
     )
     ```
   - Added defensive normalization (`Array.isArray(m.profile) ? m.profile[0] : m.profile`).
   - Maintained secondary fallback to batch profile lookup if schema cache or embedding encounters any network/relational error.

3. **Central Safe Identity Resolution (`src/lib/identity.js`)**:
   - Created central helpers `getMemberDisplayName(member, currentUser)` and `getMemberEmail(member, currentUser)`:
     ```javascript
     export function getMemberDisplayName(member, currentUser = null) {
       if (!member) return 'Member';
       const profile = member.profile || member.profiles;
       const fullName = profile?.full_name?.trim();
       if (fullName) return fullName;
       if (member.invited_email && member.invited_email.trim()) return member.invited_email.trim();
       if (currentUser && member.user_id === currentUser.id && currentUser.email) {
         return currentUser.email.trim();
       }
       return 'Member';
     }
     ```

4. **Workspace Settings Members Tab Resilience (`WorkspaceSettingsPage.jsx`)**:
   - Wrapped members tab in explicit Loading (`Spinner`), Error (`AlertTriangle` with `[ Retry ]` button), and Empty states.
   - Rendered active owner row with authenticated user's email (`abhinand@stacknstock.in`), `You` badge, `OWNER` role badge, and `ACTIVE` status badge.
   - Added clear responsibility navigation link: `"Manage Users & System Roles"`.

5. **Users & System Roles Page (`UsersAdminPage.jsx`)**:
   - Integrated `getMemberDisplayName` and `getMemberEmail` with `currentUser` fallback.
   - Table now displays `abhinand@stacknstock.in`, owner crown icon, workspace role, and system roles toggles.

6. **All Dependent Views Hardened**:
   - `TasksPage.jsx`, `ProjectsPage.jsx`, `TaskDetailPanel.jsx`, `DepartmentsAdminPage.jsx`, `DepartmentWorkspacePage.jsx`, `RaciBadge.jsx`.

---

## 3. Row-Level Security (RLS) & Data Integrity

- **RLS Preserved**: **NO RLS changes were made or required.** All existing security policies on `workspace_members`, `profiles`, and `workspaces` remain strictly active and unaltered.
- **Baseline Data**: All 6 Projects and 26 Tasks remain 100% intact.

---

## 4. Verification & Test Results

| Test Suite | Result | Details |
| :--- | :--- | :--- |
| **Hotfix Verification** (`test-member-rendering-hotfix.mjs`) | **15/15 PASSED** | Unit tests for identity fallback, 2 FKs confirmed in PG, production owner row verified |
| **Release 1.1 Security** (`test-r1_1-security.mjs`) | **20/20 PASSED** | Security hardening, RLS, authorization functions intact |
| **Release 3 Go-Live** (`test-r3-go-live.mjs`) | **25/25 PASSED** | Notification engine, hierarchy invariants, realtime, baseline intact |
| **Linter** (`npm run lint`) | **0 Errors** | Clean |
| **Production Build** (`npm run build`) | **0 Errors** | Bundle compiled in 843ms |

---

## 5. Deployment Verification

- **Repository**: [https://github.com/abzops/sns-projects.git](https://github.com/abzops/sns-projects.git)
- **Branch**: `main`
- **Commit**: `41c341c`
- **Live Settings Members Page**: [https://abzops.github.io/sns-projects/workspace/dbcaddf1-cf02-4bad-8af1-974301cdfbea/settings](https://abzops.github.io/sns-projects/workspace/dbcaddf1-cf02-4bad-8af1-974301cdfbea/settings)
- **Live Users & Roles Page**: [https://abzops.github.io/sns-projects/workspace/dbcaddf1-cf02-4bad-8af1-974301cdfbea/admin/users](https://abzops.github.io/sns-projects/workspace/dbcaddf1-cf02-4bad-8af1-974301cdfbea/admin/users)
