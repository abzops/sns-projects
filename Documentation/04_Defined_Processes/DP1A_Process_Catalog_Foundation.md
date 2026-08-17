# SNS Projects — DP-1-A Process Catalog & Version Foundation Report

**Date:** August 15, 2026  
**Status:** Complete, Live in Production & Regression-Verified  
**Migration File:** `supabase/migrations/20260814184458_defined_process_catalog_foundation.sql`  
**Migration Version:** `20260814184458`  
**Supabase CLI Version:** `2.114.0`  
**Target Workspace:** `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects)  
**Database Host:** `db.gqerfixdmgbqahgslzsq.supabase.co`  

---

## 1. Executive Summary

The DP-1-A release successfully establishes the foundational catalog and immutable versioning infrastructure for the SNS Projects Defined Process Engine.

### Core Achievements:
1. **Catalog Table Created:** `public.defined_processes` deployed with workspace/department multi-tenancy, strict source provenance checking (`manual` vs `custom_conversion`), and approval state tracking.
2. **Version Table Created:** `public.defined_process_versions` deployed with immutable version numbering, single-published partial unique indexing, and future composite provenance key support `(id, defined_process_id)`.
3. **Database-Enforced Multi-Tenancy:** Added non-destructive composite uniqueness `uq_departments_id_workspace` on `public.departments(id, workspace_id)` to support composite foreign key `(department_id, workspace_id)` on `defined_processes`, preventing cross-workspace department references at the Postgres engine level.
4. **Least-Privilege RLS & Permissions:** Direct browser `INSERT`, `UPDATE`, and `DELETE` privileges are strictly revoked from `anon` and `authenticated`. `SELECT` permission is granted to `authenticated` users who are verified active members of the owning workspace via `private.is_workspace_active_member()`.
5. **Zero Data Regression:** Zero fake/test rows seeded in production (both new tables have count `0`). All 24 business tasks, 48 subtasks, 72 RACI, 12 task lists, 6 milestones, and 3 projects remain 100% intact.

---

## 2. Migration & Preflight Ledger

### Preflight Gate:
- Migration list: 6 local == 6 remote (0 local-only, 0 remote-only)
- `db push --dry-run`: Remote database is up to date
- Baseline data counts: 3 Projects, 6 Milestones, 12 Task Lists, 24 Tasks, 48 Subtasks, 72 RACI, 0 duplicate position groups

### Post-Deployment Migration List:
```json
{
  "migrations": [
    { "local": "20260814175623", "remote": "20260814175623", "time": "2026-08-14 17:56:23" },
    { "local": "20260814175627", "remote": "20260814175627", "time": "2026-08-14 17:56:27" },
    { "local": "20260814175631", "remote": "20260814175631", "time": "2026-08-14 17:56:31" },
    { "local": "20260814175635", "remote": "20260814175635", "time": "2026-08-14 17:56:35" },
    { "local": "20260814175639", "remote": "20260814175639", "time": "2026-08-14 17:56:39" },
    { "local": "20260814175643", "remote": "20260814175643", "time": "2026-08-14 17:56:43" },
    { "local": "20260814184458", "remote": "20260814184458", "time": "2026-08-14 18:44:58" }
  ],
  "message": "Migrations listed"
}
```
*Total:* **7 local == 7 remote, 0 pending, 0 orphaned.**

---

## 3. Detailed Schema Specification

### A. Supporting Constraint on `public.departments`
```sql
ALTER TABLE public.departments
  ADD CONSTRAINT uq_departments_id_workspace UNIQUE (id, workspace_id);
```

### B. Table: `public.defined_processes`
```sql
CREATE TABLE IF NOT EXISTS public.defined_processes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  department_id             uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  name                      text NOT NULL,
  code                      text NOT NULL,
  description               text,
  process_owner_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_type               text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'custom_conversion')),
  source_task_list_id       uuid REFERENCES public.task_lists(id) ON DELETE RESTRICT,
  approval_state            text NOT NULL DEFAULT 'not_required' CHECK (approval_state IN ('not_required', 'pending_approval', 'approved', 'rejected')),
  submitted_for_approval_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_for_approval_at timestamptz,
  approval_decided_by       uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approval_decided_at       timestamptz,
  approval_notes            text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_by                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_defined_processes_workspace_code UNIQUE (workspace_id, code),
  CONSTRAINT uq_defined_processes_workspace_name UNIQUE (workspace_id, name),
  CONSTRAINT fk_defined_processes_dept_workspace FOREIGN KEY (department_id, workspace_id)
    REFERENCES public.departments(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT chk_defined_processes_source_provenance CHECK (
    (source_type = 'manual' AND source_task_list_id IS NULL AND approval_state = 'not_required')
    OR
    (source_type = 'custom_conversion' AND source_task_list_id IS NOT NULL AND approval_state <> 'not_required')
  )
);
```

### C. Table: `public.defined_process_versions`
```sql
CREATE TABLE IF NOT EXISTS public.defined_process_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defined_process_id uuid NOT NULL REFERENCES public.defined_processes(id) ON DELETE CASCADE,
  version_number     integer NOT NULL CHECK (version_number >= 1),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  change_summary     text,
  published_by       uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at       timestamptz,
  created_by         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_defined_process_versions_process_version UNIQUE (defined_process_id, version_number),
  CONSTRAINT uq_defined_process_versions_id_process UNIQUE (id, defined_process_id),
  CONSTRAINT chk_defined_process_versions_publication CHECK (
    (status = 'draft' AND published_by IS NULL AND published_at IS NULL)
    OR
    (status IN ('published', 'archived') AND published_by IS NOT NULL AND published_at IS NOT NULL)
  )
);
```

### D. Indexes
1. `idx_defined_processes_ws_dept_active` on `defined_processes (workspace_id, department_id, is_active)`
2. `idx_defined_processes_owner` on `defined_processes (process_owner_id)`
3. `idx_defined_processes_source_task_list` on `defined_processes (source_task_list_id) WHERE source_task_list_id IS NOT NULL`
4. `uq_defined_process_versions_single_published` on `defined_process_versions (defined_process_id) WHERE status = 'published'` (Partial Unique)
5. `idx_defined_process_versions_process_status` on `defined_process_versions (defined_process_id, status)`

### E. Row-Level Security & Grants
- `REVOKE ALL ON TABLE public.defined_processes FROM PUBLIC, anon, authenticated;`
- `GRANT SELECT ON TABLE public.defined_processes TO authenticated;`
- `REVOKE ALL ON TABLE public.defined_process_versions FROM PUBLIC, anon, authenticated;`
- `GRANT SELECT ON TABLE public.defined_process_versions TO authenticated;`
- Policies:
  - `defined_processes_select_member`: `(SELECT private.is_workspace_active_member(defined_processes.workspace_id))`
  - `defined_process_versions_select_member`: `EXISTS (SELECT 1 FROM public.defined_processes dp WHERE dp.id = defined_process_versions.defined_process_id AND private.is_workspace_active_member(dp.workspace_id))`

---

## 4. Verification & Validation Summary

### A. Local Clean Replay
- All 7 canonical migrations replayed cleanly in sequence from scratch in an isolated transactional sandbox with **0 errors**.

### B. DP-1-A Verification Suite (`scripts/test-defined-process-dp1a.mjs`)
- **Result:** **26 / 26 PASSED**
  - Table existence & schema types
  - RLS enablement on both tables
  - Zero anon grants / SELECT-only authenticated grants
  - Unique workspace code & name constraints
  - Source provenance CHECK logic
  - Owning department composite FK integrity
  - Version number >= 1 check
  - Version status CHECK (draft, published, archived)
  - Single-published partial unique index
  - Publication field coherence CHECK
  - Production row count = 0 on both tables
  - Production baseline data preservation (24 tasks, 12 task lists, 72 RACI, 0 duplicate positions)

### C. Full Regression Suite
| Test Suite | Command | Result |
| :--- | :--- | :---: |
| Kanban DnD Contracts & Isolation | `node scripts/test-kanban-dnd-contracts.mjs` | **18 / 18 PASS** |
| Structured Production Dataset | `node scripts/test-structured-production-data.mjs` | **20 / 20 PASS** |
| Task Experience & Decongestion | `node scripts/test-task-experience-hotfix.mjs` | **13 / 13 PASS** |
| Kanban Board Hydration | `node scripts/test-kanban-board-hydration.mjs` | **15 / 15 PASS** |
| Task List Hierarchy & Lifecycle | `node scripts/test-tasklist-hierarchy-hotfix.mjs` | **17 / 17 PASS** |
| Navigation & Loading UX | `node scripts/test-navigation-loading-ux.mjs` | **32 / 32 PASS** |
| Code Quality / Linter | `npm run lint` | **0 errors** |
| Vite Production Build | `npm run build` | **0 errors** |
| Security Advisor Audit | `node scripts/security-advisor.mjs` | **16/16 RLS enabled, 0 new warnings** |

---

## 5. Production Dataset Invariant Comparison

| Metric | Pre-DP1 Baseline | Post-DP1-A Live State | Status |
| :--- | :---: | :---: | :---: |
| **Projects** | 3 | 3 | Identical |
| **Milestones** | 6 | 6 | Identical |
| **Task Lists** | 12 | 12 | Identical |
| **Tasks** | 24 | 24 | Identical |
| **Subtasks** | 48 | 48 | Identical |
| **RACI Assignments** | 72 | 72 | Identical |
| **Duplicate Kanban Positions** | 0 | 0 | Clean |
| **Defined Processes** | 0 | 0 | Unseeded / Clean |
| **Defined Process Versions** | 0 | 0 | Unseeded / Clean |
| **reorder_kanban_tasks** | 4-arg, INVOKER | 4-arg, INVOKER | Identical |

---

## 6. Supabase Advisor Status
- **Tables Without RLS:** 0 (All 16 public tables protected by RLS).
- **Private Schema Protection:** `private` schema unexposed via PostgREST Data API.
- **Function ACLs:** Default execution revoked; `reorder_kanban_tasks` callable only by `authenticated`.
- **Known Project Warning:** Leaked Password Protection Disabled (pre-existing Auth project-level configuration, unrelated to DP-1-A).
- **New DP-1-A Warnings:** **0**

---

## 7. Gate Readiness for DP-1-B
- **DP-1-A Status:** **COMPLETE & VERIFIED**
- **DP-1-B Readiness:** **READY**
