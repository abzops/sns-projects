# SNS Projects — DP-1-D.1 Implementation Report
## Authorization Integrity & Process Version FK Index Hotfix

---

### Executive Summary

The **DP-1-D.1** release resolves two narrow regressions identified after the DP-1-D deployment:
1. **Authorization Matrix Restoration:** Restored full canonical `project_admin` system role authority across custom Task Lists, Tasks, and RACI assignments, and corrected `task_lists_delete_member` so ordinary workspace members cannot delete Task Lists (restricted strictly to workspace `owner`, `admin`, or system roles `project_admin`, `system_admin`).
2. **FK Covering Index:** Created the correctly ordered covering index `idx_task_lists_process_version_fk` on `public.task_lists (defined_process_version_id, defined_process_id)` satisfying the foreign key constraint `fk_task_lists_process_version`, removing the unindexed foreign key warning from Supabase Performance Advisor.

All core DP-1-D guarantees, mutation guards, trusted context checks, Kanban drag-and-drop invariants, and notification suppression for Defined Tasks remain 100% active and verified.

---

### Exact Regressions & Resolution

#### 1. RLS Authorization Matrix

| Object & Action | Pre-DP1-D Expected | Wrong DP-1-D Live | Corrected DP-1-D.1 | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **Task List INSERT (custom)** | owner, admin, member, project_admin, system_admin | owner, admin, member, system_admin (`project_admin` missing) | owner, admin, member, project_admin, system_admin | **PASS** |
| **Task List DELETE (custom)** | owner, admin, project_admin, system_admin (`member` excluded) | owner, admin, member, system_admin (`member` incorrectly permitted, `project_admin` missing) | owner, admin, project_admin, system_admin (`member` denied) | **PASS** |
| **Task INSERT (custom)** | owner, admin, member, project_admin, system_admin | owner, admin, member, system_admin (`project_admin` missing) | owner, admin, member, project_admin, system_admin | **PASS** |
| **Task DELETE (custom)** | owner, admin, member, project_admin, system_admin | owner, admin, member, system_admin (`project_admin` missing) | owner, admin, member, project_admin, system_admin | **PASS** |
| **Task RACI INSERT (custom)** | owner, admin, member, project_admin, system_admin | owner, admin, member, system_admin (`project_admin` missing) | owner, admin, member, project_admin, system_admin | **PASS** |
| **Task RACI UPDATE (custom)** | owner, admin, member, project_admin, system_admin | owner, admin, member, system_admin (`project_admin` missing) | owner, admin, member, project_admin, system_admin | **PASS** |
| **Task RACI DELETE (custom)** | owner, admin, member, project_admin, system_admin | owner, admin, member, system_admin (`project_admin` missing) | owner, admin, member, project_admin, system_admin | **PASS** |
| **Executive Roles (CEO/CTO)** | No automatic task mutation authority | No automatic task mutation authority | No automatic task mutation authority | **PASS** |
| **Defined Task Mutations** | Direct browser CRUD blocked | Direct browser CRUD blocked | Direct browser CRUD blocked | **PASS** |

#### 2. Foreign Key Covering Index

- **Constraint:** `fk_task_lists_process_version` on `public.task_lists (defined_process_version_id, defined_process_id) REFERENCES public.defined_process_versions(id, defined_process_id) ON DELETE RESTRICT`.
- **Issue:** Prior index `idx_task_lists_defined_process` used reverse column order `(defined_process_id, defined_process_version_id)` and a partial `WHERE task_list_type = 'defined'` predicate.
- **Resolution:** Added `idx_task_lists_process_version_fk` on `public.task_lists (defined_process_version_id, defined_process_id)`.
- **Advisor Status:** Performance Advisor no longer reports `fk_task_lists_process_version` as unindexed.

---

### Migration & Deployment Ledger

- **Migration Applied:** `supabase/migrations/20260815122056_dp1d_authorization_integrity_hotfix.sql`
- **CLI Command:** `npx supabase db push` (direct CLI execution, 0 wrapper scripts)
- **Ledger Verification:** 11 local migrations == 11 remote migrations (0 pending)
  1. `20260814175623_day0_foundation.sql`
  2. `20260814175627_security_hardening.sql`
  3. `20260814175631_hierarchy_alignment.sql`
  4. `20260814175635_day0_notifications_go_live.sql`
  5. `20260814175639_reorder_kanban_tasks.sql`
  6. `20260814175643_enforce_deterministic_kanban_ordering.sql`
  7. `20260814184458_defined_process_catalog_foundation.sql`
  8. `20260814190245_defined_process_step_foundation.sql`
  9. `20260814192410_working_calendar_foundation.sql`
  10. `20260814194804_defined_process_runtime_provenance.sql`
  11. `20260815122056_dp1d_authorization_integrity_hotfix.sql`

---

### Test Suites & Regression Verification

- **DP-1-D.1 Dedicated Suite:** 60/60 PASSED (`scripts/test-defined-process-dp1d1.mjs`)
- **DP-1-D Permanent Suite:** 69/69 PASSED (`scripts/test-defined-process-dp1d.mjs`)
- **DP-1-A (Catalog Foundation):** 26/26 PASSED
- **DP-1-B (DAG Steps & Dependencies):** 53/53 PASSED
- **DP-1-C (Working Calendars & Holidays):** 50/50 PASSED
- **Kanban DnD Contracts:** 18/18 PASSED
- **Structured Production Data:** 20/20 PASSED
- **Task Experience Hotfix:** 13/13 PASSED
- **Kanban Board Hydration:** 15/15 PASSED
- **Task List Hierarchy Hotfix:** 17/17 PASSED
- **Navigation & Loading UX:** 32/32 PASSED
- **Code Quality:** `npm run lint` (0 errors), `npm run build` (success in 6.78s), `secret-scan` (clean)
- **Security Advisor:** 0 new findings
- **Performance Advisor:** `fk_task_lists_process_version` unindexed finding removed

---

### Production Invariants Preserved

- **Projects:** 3
- **Milestones:** 6
- **Task Lists:** 12 (12 custom, 0 defined)
- **Tasks:** 24 (24 custom, 0 defined)
- **Subtasks:** 48
- **RACI Assignments:** 72
- **Duplicate Kanban Positions:** 0
