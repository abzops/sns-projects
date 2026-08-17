# SNS Projects V2 — Day-0 Release 1.1 Security Report

**Date**: 2026-08-14
**Migration**: `20260814_02_security_hardening.sql`
**Status**: ✅ APPLIED SUCCESSFULLY

---

## Executive Summary

Release 1.1 is a surgical security hardening of the database layer. No UI changes, no new features, no Supabase configuration changes.

### Changes Applied

| # | Change | Status |
|---|--------|--------|
| 1 | Authorization helpers moved to `private` schema | ✅ |
| 2 | Public helper functions dropped | ✅ |
| 3 | Notification INSERT revoked from `authenticated`/`anon` | ✅ |
| 4 | Notification UPDATE restricted to columns `is_read`, `read_at` | ✅ |
| 5 | Trigger function EXECUTE revoked from `PUBLIC`/`anon`/`authenticated` | ✅ |
| 6 | Default function privileges hardened (all 4 roles removed) | ✅ |
| 7 | 24 stale V1 RLS policies dropped (pre-existing cleanup) | ✅ |
| 8 | Infinite recursion in workspace/member SELECT policies fixed | ✅ |
| 9 | `createNotification()` dead code removed from frontend | ✅ |

---

## Detailed Changes

### 1. Private Schema for Authorization Helpers

Created `private` schema, not exposed via PostgREST Data API (`pgrst.db_schemas` does not include `private`).

**Four SECURITY DEFINER functions moved:**

| Function | Arguments | Purpose |
|----------|-----------|---------|
| `private.get_user_workspace_role` | `(uuid)` | Returns user's workspace role |
| `private.is_workspace_active_member` | `(uuid)` | Returns boolean membership check |
| `private.has_system_role` | `(uuid, text)` | Checks CEO/CTO/admin/project_admin |
| `private.can_administer_workspace` | `(uuid)` | Combined admin check |

**Access control:**
- `SET search_path = ''` — prevents search-path injection
- PUBLIC: ✗ NO USAGE, NO EXECUTE
- anon: ✗ NO USAGE, NO EXECUTE
- authenticated: ✓ USAGE + EXECUTE (required for RLS evaluation)
- service_role: ✓ USAGE + EXECUTE (required for RLS evaluation)
- postgres: ✓ Full access (owner)

**Previous public functions dropped:**
- `public.get_user_workspace_role(uuid)`
- `public.is_workspace_active_member(uuid)`
- `public.has_system_role(uuid, text)`
- `public.can_administer_workspace(uuid)`

### 2. All RLS Policies Updated

27 RLS policies across 9 tables updated to reference `private.*` instead of `public.*`.

### 3. Notification Security

**INSERT capability removed:**
- `notifications_insert_internal` policy: DROPPED
- `REVOKE INSERT ON public.notifications FROM authenticated`
- `REVOKE INSERT ON public.notifications FROM anon`
- Frontend `createNotification()` function: REMOVED (was dead code, never called)

**UPDATE restricted to two columns:**
- `REVOKE UPDATE ON TABLE public.notifications FROM authenticated`
- `GRANT UPDATE (is_read, read_at) ON TABLE public.notifications TO authenticated`
- Attempting to update `title`, `message`, `user_id`, etc. → **permission denied** (not silently ignored)

**Row-level policies retained:**
- `notifications_select_own`: `USING (user_id = auth.uid())`
- `notifications_update_own`: `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`

### 4. Trigger Function Lockdown

| Function | postgres | service_role | authenticated | anon | PUBLIC |
|----------|----------|--------------|---------------|------|--------|
| `handle_new_user()` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `seed_default_statuses()` | ✓ | ✓ | ✗ | ✗ | ✗ |

Trigger execution is unaffected — PostgreSQL triggers execute as the function **owner** regardless of caller privileges.

### 5. Default Privilege Hardening

**Before (postgres role, public schema, functions):**
```
{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

**After:**
```
{postgres=X/postgres}
```

Future functions created by `postgres` in `public` schema require **explicit per-function GRANT** statements. `supabase_admin` defaults were NOT modified.

### 6. Bonus: Stale V1 Policy Cleanup + Recursion Fix

**Problem discovered during verification:** 24 stale RLS policies from the original V1 schema were never dropped in Release 1.0. These co-existed alongside the R1.0/R1.1 policies. Since PostgreSQL evaluates ALL policies for the same command with OR logic, the stale V1 policies with self-referencing subqueries on `workspace_members` caused **infinite recursion** when RLS was evaluated.

**Fix applied:**
- Dropped all 24 stale V1 policies
- Replaced `workspaces_select_member` and `workspace_members_select_active` policies with `private.is_workspace_active_member()` calls (SECURITY DEFINER bypasses RLS, breaking the recursion cycle)

---

## Verification Results

### All 20 Security Tests: ✅ PASSED

| # | Test | Result |
|---|------|--------|
| 1 | anon cannot call private authorization helpers | ✅ PASS |
| 2 | private schema not exposed via PostgREST Data API | ✅ PASS |
| 3 | authenticated cannot call handle_new_user() | ✅ PASS |
| 4 | authenticated cannot call seed_default_statuses() | ✅ PASS |
| 5 | auth.users profile creation trigger exists | ✅ PASS |
| 6 | projects default-status trigger exists and works (5 statuses seeded) | ✅ PASS |
| 7 | authenticated cannot INSERT notifications (permission denied) | ✅ PASS |
| 8 | own notification SELECT works | ✅ PASS |
| 9 | own is_read UPDATE works | ✅ PASS |
| 10 | own read_at UPDATE works | ✅ PASS |
| 11 | own title UPDATE is REJECTED (permission denied) | ✅ PASS |
| 12 | own message UPDATE is REJECTED (permission denied) | ✅ PASS |
| 13 | own user_id UPDATE is REJECTED (permission denied) | ✅ PASS |
| 14 | another user's notification cannot be read (0 rows) | ✅ PASS |
| 15 | another user's notification cannot be marked read (0 rows) | ✅ PASS |
| 16 | existing workspace SELECT works (1 workspace) | ✅ PASS |
| 17 | existing project SELECT works (6 projects) | ✅ PASS |
| 18 | task/Kanban permissions work (26 tasks, 30 statuses) | ✅ PASS |
| 19 | system-role SELECT works for owner | ✅ PASS |
| 20 | cross-workspace isolation works (0 rows from non-member workspace) | ✅ PASS |

### Build & Lint

| Check | Result |
|-------|--------|
| `npm run build` (vite build) | ✅ 0 errors, built in 643ms |
| `npm run lint` (oxlint) | ✅ 0 errors, 11 pre-existing warnings |

### Security Advisor Assessment

| Check | Result |
|-------|--------|
| All public tables have RLS enabled | ✅ |
| No authorization helpers in public schema | ✅ |
| Trigger functions locked to postgres/service_role only | ✅ |
| Private functions: no PUBLIC/anon EXECUTE | ✅ |
| Private schema: no anon USAGE | ✅ |
| Private schema not in PostgREST exposure | ✅ |
| Default privileges: only postgres has EXECUTE | ✅ |
| Notification INSERT revoked from authenticated/anon | ✅ |
| Notification UPDATE: column-level (is_read, read_at only) | ✅ |
| Clean policy set: exactly 34 canonical policies across 11 tables | ✅ |

---

## Files Changed

### Database
- `supabase/migrations/20260814_02_security_hardening.sql` — **[NEW]** Forward migration
- `supabase/schema.sql` — **[MODIFIED]** Canonical schema updated

### Frontend
- `src/hooks/useNotifications.js` — **[MODIFIED]** Removed `createNotification()` dead code

### Scripts (tooling, not shipped)
- `scripts/apply-migration-r1_1.mjs` — Migration runner
- `scripts/test-r1_1-security.mjs` — 20-point verification suite
- `scripts/security-advisor.mjs` — Post-deployment security scan
- `scripts/cleanup-all-stale-policies.mjs` — V1 policy cleanup

---

## Final Policy Inventory (34 policies across 11 tables)

| Table | Policies |
|-------|----------|
| workspaces | `select_member`, `insert_authenticated`, `update_owner`, `delete_owner` |
| workspace_members | `select_active`, `insert_admin_owner`, `update_admin_owner`, `delete_admin_owner` |
| profiles | `select_authenticated`, `update_own` |
| projects | `select_member`, `insert_member`, `update_member`, `delete_admin_owner` |
| task_statuses | `select_member`, `insert_member`, `update_member`, `delete_member` |
| tasks | `select_member`, `insert_member`, `update_member`, `delete_member` |
| user_system_roles | `select`, `manage` |
| departments | `select_member`, `insert_manage`, `update_manage`, `delete_owner` |
| department_memberships | `select_member`, `manage` |
| task_raci_assignments | `select_member`, `manage` |
| notifications | `select_own`, `update_own` |

---

> **RELEASE 1.1 COMPLETE. DO NOT START RELEASE 2.**
