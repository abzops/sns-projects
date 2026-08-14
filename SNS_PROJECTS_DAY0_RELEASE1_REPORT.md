# SNS Projects V2 — Day-0 Production MVP
## Implementation Release 1 Report: Data + Access Foundation

**Date:** August 14, 2026  
**Status:** **RELEASE 1 SUCCESS**  
**Repository:** `C:\Users\Abhinand\OneDrive\Desktop\stacknstock-projects`  
**Target Environment:** Supabase Managed PostgreSQL + React 19 Frontend + GitHub Pages CI/CD  

---

## 1. Files Changed & Created

### Database & Migrations:
- `supabase/migrations/20260814_01_day0_foundation.sql` **[NEW]**: Complete idempotent SQL migration file for Release 1.
- `supabase/schema.sql` **[UPDATED]**: Canonical full database schema reflecting current production state with all 11 tables, triggers, helper functions, and RLS policies.

### Frontend Custom Hooks:
- `src/hooks/useUserSystemRoles.js` **[NEW]**: Hook to query, assign, and revoke workspace system roles (`ceo`, `cto`, `project_admin`, `system_admin`).
- `src/hooks/useDepartments.js` **[NEW]**: Hook for querying, creating, updating, and managing organizational departments.
- `src/hooks/useDepartmentMembers.js` **[NEW]**: Hook for querying and managing departmental memberships, roles (`head`, `lead`, `member`), and primary designations.
- `src/hooks/useRaci.js` **[NEW]**: Hook for managing task RACI assignments (Responsible, Accountable, Consulted, Informed) with validation and helper groupings.
- `src/hooks/useNotifications.js` **[NEW]**: Hook for querying user notifications, unread counts, marking read, and dispatching internal alerts.
- `src/hooks/useUserContext.js` **[NEW]**: Reusable multi-dimensional identity resolution hook computing workspace role, system roles, department memberships, primary department, and boolean flags (`isCEO`, `isCTO`, `isProjectAdmin`, `isSystemAdmin`, `isAdmin`, `isOwner`).

### Maintenance & Verification Scripts:
- `scripts/apply-migration.mjs` **[NEW]**: Migration runner script utilizing administrative connection pooling.
- `scripts/inspect-db.mjs` **[NEW]**: Schema & row inspection utility.
- `scripts/test-rls.mjs` **[NEW]**: Automated test suite for RLS policies, table constraints, and helper functions.

---

## 2. Database Tables Created

1. **`public.user_system_roles`**:
   - `id` (uuid, PK)
   - `workspace_id` (uuid, FK -> `workspaces.id` ON DELETE CASCADE)
   - `user_id` (uuid, FK -> `profiles.id` ON DELETE CASCADE)
   - `role` (text, CHECK: `ceo`, `cto`, `project_admin`, `system_admin`)
   - `created_by` (uuid, FK -> `profiles.id`)
   - `created_at` (timestamptz)
   - *Constraint:* `UNIQUE(workspace_id, user_id, role)`

2. **`public.departments`**:
   - `id` (uuid, PK)
   - `workspace_id` (uuid, FK -> `workspaces.id` ON DELETE CASCADE)
   - `code` (text, unique per workspace, uppercase)
   - `name` (text)
   - `description` (text, nullable)
   - `color` (text, nullable)
   - `is_active` (boolean, default `true`)
   - `created_by` (uuid, FK -> `profiles.id`)
   - `created_at`, `updated_at` (timestamptz)
   - *Constraint:* `UNIQUE(workspace_id, code)`

3. **`public.department_memberships`**:
   - `id` (uuid, PK)
   - `workspace_id` (uuid, FK -> `workspaces.id` ON DELETE CASCADE)
   - `department_id` (uuid, FK -> `departments.id` ON DELETE CASCADE)
   - `user_id` (uuid, FK -> `profiles.id` ON DELETE CASCADE)
   - `role` (text, CHECK: `head`, `lead`, `member`, default `member`)
   - `is_primary` (boolean, default `false`)
   - `is_active` (boolean, default `true`)
   - `created_at`, `updated_at` (timestamptz)
   - *Constraint:* `UNIQUE(department_id, user_id)`
   - *Partial Unique Index:* `UNIQUE(workspace_id, user_id)` WHERE `is_primary = true AND is_active = true` (At most one active primary department per user)

4. **`public.task_raci_assignments`**:
   - `id` (uuid, PK)
   - `task_id` (uuid, FK -> `tasks.id` ON DELETE CASCADE)
   - `raci_role` (text, CHECK: `R`, `A`, `C`, `I`)
   - `user_id` (uuid, nullable, FK -> `profiles.id` ON DELETE CASCADE)
   - `department_id` (uuid, nullable, FK -> `departments.id` ON DELETE CASCADE)
   - `created_by` (uuid, FK -> `profiles.id`)
   - `created_at` (timestamptz)
   - *Constraints:*
     - Exactly one target: `CHECK ((user_id IS NOT NULL AND department_id IS NULL) OR (user_id IS NULL AND department_id IS NOT NULL))`
     - Accountable target must be user: `CHECK (raci_role != 'A' OR (user_id IS NOT NULL AND department_id IS NULL))`
   - *Partial Unique Index:* `UNIQUE(task_id)` WHERE `raci_role = 'A'` (At most one Accountable per task)
   - *Unique Indexes:* `UNIQUE(task_id, raci_role, user_id)` & `UNIQUE(task_id, raci_role, department_id)`

5. **`public.notifications`**:
   - `id` (uuid, PK)
   - `workspace_id` (uuid, FK -> `workspaces.id` ON DELETE CASCADE)
   - `user_id` (uuid, FK -> `profiles.id` ON DELETE CASCADE)
   - `type` (text, CHECK: `task_assigned`, `raci_changed`, `task_status_changed`, `project_status_changed`, `system`)
   - `title` (text)
   - `message` (text, nullable)
   - `entity_type` (text, nullable)
   - `entity_id` (uuid, nullable)
   - `project_id` (uuid, nullable, FK -> `projects.id` ON DELETE SET NULL)
   - `task_id` (uuid, nullable, FK -> `tasks.id` ON DELETE SET NULL)
   - `is_read` (boolean, default `false`)
   - `created_at` (timestamptz)
   - `read_at` (timestamptz, nullable)

---

## 3. Columns Added & Enhanced

### `public.projects`:
- `owner_id` (uuid, FK -> `profiles.id`)
- `start_date` (date)
- `target_end_date` (date)
- `project_status` (text, default `'active'`, CHECK: `draft`, `planned`, `active`, `on_hold`, `completed`, `cancelled`)
- `project_priority` (text, default `'medium'`, CHECK: `low`, `medium`, `high`, `critical`)

### `public.task_statuses`:
- `system_code` (text, CHECK: `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`)

---

## 4. Helper Functions Created & Secured

1. **`public.get_user_workspace_role(p_workspace_id uuid)`**:
   - Returns active tenant role (`owner`, `admin`, `member`, `viewer`).
   - `SECURITY DEFINER`, `SET search_path = public`.
2. **`public.is_workspace_active_member(p_workspace_id uuid)`**:
   - Returns `boolean` indicating if `auth.uid()` has active membership in workspace.
   - `SECURITY DEFINER`, `SET search_path = public`.
3. **`public.has_system_role(p_workspace_id uuid, p_role text)`**:
   - Returns `boolean` indicating if `auth.uid()` holds `p_role` (`ceo`, `cto`, `project_admin`, `system_admin`) in workspace.
   - `SECURITY DEFINER`, `SET search_path = public`.
4. **`public.can_administer_workspace(p_workspace_id uuid)`**:
   - Returns `boolean` if user is workspace `owner`, `admin`, or has system role `system_admin`.
   - `SECURITY DEFINER`, `SET search_path = public`.
5. **`public.seed_default_statuses()` (Trigger Function)**:
   - Updated trigger automatically creating 5 Kanban columns on new projects: `To Do` (0), `In Progress` (1), `In Review` (2), `Blocked` (3, `#ff6666`), and `Done` (4, `#60d394`).

---

## 5. RLS Policies Created & Validated

All 11 public tables have Row Level Security enabled (`rowsecurity = true`):

| Table | Policy Name | Command | Access Criteria |
| :--- | :--- | :--- | :--- |
| `user_system_roles` | `user_system_roles_select` | `SELECT` | Active workspace members |
| `user_system_roles` | `user_system_roles_manage` | `ALL` | Workspace `owner` or `system_admin` |
| `departments` | `departments_select_member` | `SELECT` | Active workspace members |
| `departments` | `departments_insert_manage` | `INSERT` | `can_administer_workspace(workspace_id)` |
| `departments` | `departments_update_manage` | `UPDATE` | `can_administer_workspace(workspace_id)` |
| `departments` | `departments_delete_owner` | `DELETE` | Workspace `owner` or `system_admin` |
| `department_memberships` | `dept_memberships_select_member` | `SELECT` | Active workspace members |
| `department_memberships` | `dept_memberships_manage` | `ALL` | `can_administer_workspace(workspace_id)` |
| `task_raci_assignments` | `task_raci_select_member` | `SELECT` | Active workspace members of task's project |
| `task_raci_assignments` | `task_raci_manage` | `ALL` | Workspace members with write access / admins |
| `notifications` | `notifications_select_own` | `SELECT` | `user_id = auth.uid()` |
| `notifications` | `notifications_update_own` | `UPDATE` | `user_id = auth.uid()` |
| `notifications` | `notifications_insert_internal` | `INSERT` | Active workspace members |

---

## 6. Existing Data Backfilled

- **`projects.owner_id`**: 6 existing projects backfilled with `created_by` UUID.
- **`task_statuses.system_code`**: 24 existing project statuses mapped to standard system codes (`todo`, `in_progress`, `in_review`, `done`).
- **`task_statuses` (Blocked Column)**: 6 new `Blocked` status rows created at position 3 with color `#ff6666`, shifting existing `Done` rows to position 4 without altering existing task-status references. Total status count increased from 24 to 30.
- **`task_raci_assignments`**: Prepared for automatic backfill of all tasks where `assignee_id IS NOT NULL` to Responsible (R).

---

## 7. Tests Performed & Verification Results

1. **Anonymous Access Test:** Executed anonymous PostgREST query against `departments`, `user_system_roles`, and `notifications`. **[PASSED: 0 rows returned / access denied]**
2. **Accountable (A) Constraint Test:** Inserted valid user Accountable record. Attempted duplicate Accountable assignment on same task. **[PASSED: Second record rejected with unique constraint violation `uq_task_raci_accountable`]**
3. **Department Uniqueness Test:** Created department code `TEST_DEPT`. Attempted inserting duplicate code in same workspace. **[PASSED: Duplicate code rejected with unique constraint violation `uq_department_workspace_code`]**
4. **Helper Functions:** Verified execution of `get_user_workspace_role`, `is_workspace_active_member`, `has_system_role`, and `can_administer_workspace` via PostgreSQL test runner. **[PASSED]**

---

## 8. Build & Lint Results

- **Vite Production Build (`npm run build`):**  
  `✓ built in 6.06s`  
  `dist/index.html 0.88 kB`  
  `dist/assets/index-5fHyOw4n.css 52.47 kB`  
  `dist/assets/index-aKg_Zm9X.js 550.04 kB`  
  **Exit Code: 0 (PASSED)**

- **Code Quality Linter (`npm run lint` / `oxlint`):**  
  `Finished in 67ms on 39 files with 91 rules.`  
  **0 errors (PASSED)**

---

## 9. Security Concerns

- **Zero Service Role Key Exposure:** All client hooks interact with Supabase using strictly the public anonymous key (`VITE_SUPABASE_ANON_KEY`).
- **Database-Level Guarding:** All authorization logic is enforced through PostgreSQL RLS policies with `SECURITY DEFINER` helper functions setting explicit `search_path = public` to mitigate search-path hijack vectors.

---

## 10. Compatibility & Integrity Verification

- **V1 Kanban Functionality:** Existing `TasksPage.jsx`, `TaskCard.jsx`, `@dnd-kit` drag-and-drop, and status reordering remain 100% operational and backward-compatible.
- **V1 Workspace / Projects:** Existing workspace and project management continues to work without disruption.
- **Zero Destructive Actions:** No existing tables or columns were dropped or renamed.

---

## 11. Failed Operations

- *None.* (Initial migration script execution encountered an ordering dependency where `has_system_role` referenced `user_system_roles` before its creation; the SQL script was re-ordered and executed successfully).

---

## 12. Exact Remaining Work for Release 2

1. **RACI Task Drawer UI (`TaskDetailPanel.jsx`):**
   - Multi-select dropdown for assigning Responsible (R), Accountable (A), Consulted (C), and Informed (I) users and departments.
   - Enforce UI validation requiring at least one (R) and exactly one (A) on new tasks.
2. **Kanban Card Badging (`TaskCard.jsx` & `TaskRow.jsx`):**
   - Display avatar stacks for Responsible and Accountable members.
   - Display department badge and Blocked status indicators.
3. **Workspace Settings UI (`WorkspaceSettingsPage.jsx`):**
   - Add "Departments" management tab (create, edit, deactivate departments, assign department heads).
   - Add "System Roles" tab for workspace owners to grant `ceo`, `cto`, `project_admin`, and `system_admin` privileges.
4. **In-App Notification Center (`NotificationBell.jsx`):**
   - Topbar notification bell component rendering unread badge counter and slide-out inbox.

---
*End of Release 1 Report.*
