# SNS Projects V2 — Day-0 Release 2.5: Hierarchy Alignment Completion Report

**Date**: August 14, 2026  
**Status**: **COMPLETE & VERIFIED**  
**Environment**: Production MVP (Supabase PostgreSQL + React SPA)  

---

## 1. Executive Summary

Release 2.5 ("Hierarchy Alignment") successfully implements and enforces the mandatory 5-level project structure across the SNS Projects architecture:

$$\text{Project} \longrightarrow \text{Milestone} \longrightarrow \text{Task List} \longrightarrow \text{Task} \longrightarrow \text{Subtask}$$

All mathematical database invariants, composite foreign key constraints, safe delete RESTRICT semantics, deterministic progress formulas, and atomic RACI assignments have been implemented in place, applied to the live database, and verified with a **32-point test suite (32/32 PASSED)** alongside zero regression in security and data contracts.

---

## 2. Invariants & Architecture Enforcement

### A. Database-Level Hierarchy Consistency (Composite Foreign Keys)
1. **Milestones**:
   - `public.milestones` table with `UNIQUE (id, project_id)`.
2. **Task Lists**:
   - `public.task_lists` table with composite foreign key:
     `CONSTRAINT fk_task_lists_milestone FOREIGN KEY (milestone_id, project_id) REFERENCES public.milestones(id, project_id) ON DELETE RESTRICT`
   - `UNIQUE (id, milestone_id, project_id)`.
3. **Tasks**:
   - `public.tasks` table with composite foreign key:
     `CONSTRAINT fk_tasks_task_list FOREIGN KEY (task_list_id, milestone_id, project_id) REFERENCES public.task_lists(id, milestone_id, project_id) ON DELETE RESTRICT`
   - CHECK constraint:
     `CONSTRAINT tasks_hierarchy_check CHECK ((milestone_id IS NULL AND task_list_id IS NULL) OR (milestone_id IS NOT NULL AND task_list_id IS NOT NULL))`
4. **Subtasks**:
   - `public.subtasks` table with foreign key:
     `FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE`
   - Status CHECK constraint:
     `status IN ('todo', 'in_progress', 'done', 'cancelled')`

### B. Safe Delete Semantics
- **Deleting a Milestone with child Task Lists or Tasks**: **RESTRICT** (PostgreSQL engine rejects delete).
- **Deleting a Task List with child Tasks**: **RESTRICT** (PostgreSQL engine rejects delete).
- **Deleting a Task**: **CASCADE** (automatically deletes child subtasks and RACI assignments).

### C. Deterministic Progress Formulas (Frozen)
- **Eligible Tasks**: `task_statuses.system_code != 'cancelled'`
- **Completed Tasks**: `task_statuses.system_code = 'done'`
- **Task List Progress**: $\frac{\text{Completed Eligible Tasks}}{\text{Total Eligible Tasks}} \times 100\%$ (0% if total is 0)
- **Milestone Progress**: $\frac{\text{Completed Eligible Descendant Tasks}}{\text{Total Eligible Descendant Tasks}} \times 100\%$ (0% if total is 0)
- **Project Progress**: $\frac{\text{Completed Eligible Project Tasks}}{\text{Total Eligible Project Tasks}} \times 100\%$ (0% if total is 0)
- **Subtasks Rule**: Subtasks **NEVER** affect Task List, Milestone, or Project completion percentages. Subtasks compute internal completion inside their parent Task ($\frac{\text{Done Subtasks}}{\text{Non-cancelled Subtasks}} \times 100\%$).

### D. RLS & Authorization Governance
- `viewer`: Strictly **READ ONLY** across `milestones`, `task_lists`, `tasks`, and `subtasks`.
- Mutate/Write (`INSERT`, `UPDATE`, `DELETE`): Workspace `owner`, `admin`, `member`, or system role `system_admin` / `project_admin`.
- Row-level security is active and verified across all tables.

### E. Mandatory RACI Atomic Task Creation
- Creation of new tasks requires $\ge 1$ Responsible (R) user and exactly 1 Accountable (A) user.
- If task insertion succeeds but RACI matrix insertion fails, the system executes an automated compensating rollback (`DELETE FROM tasks WHERE id = newTask.id`) and throws an error.

### F. Legacy Task Compatibility
- All 26 pre-existing legacy tasks have `milestone_id = NULL` and `task_list_id = NULL`.
- Displayed prominently in the UI in a dedicated **"Uncategorized Tasks"** section without data loss.

---

## 3. Database Schema Changes Applied

- Migration File: `supabase/migrations/20260814_03_hierarchy_alignment.sql`
- Applied to Production: `db.gqerfixdmgbqahgslzsq.supabase.co:5432`
- Canonical Schema Updated: `supabase/schema.sql`

```sql
CREATE TABLE public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  start_date date,
  end_date date,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestones_id_project_unique UNIQUE (id, project_id)
);

CREATE TABLE public.task_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_task_lists_milestone FOREIGN KEY (milestone_id, project_id)
    REFERENCES public.milestones(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_lists_project FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT task_lists_id_milestone_project_unique UNIQUE (id, milestone_id, project_id)
);

CREATE TABLE public.subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  start_date date,
  due_date date,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 4. Frontend Application Upgrades

1. **New Custom Hooks**:
   - `src/hooks/useMilestones.js`: Milestone CRUD, descendant task aggregation, progress calculation.
   - `src/hooks/useTaskLists.js`: Task List CRUD, task aggregation, progress calculation.
   - `src/hooks/useSubtasks.js`: Subtask CRUD, status toggle, internal subtask progress.
2. **Upgraded Custom Hooks**:
   - `src/hooks/useTasks.js`: Joined milestone & task_list names, subtask count metrics, cascading hierarchy checks, atomic RACI creation with compensating rollback.
   - `src/hooks/useProjects.js`: Project progress calculation strictly adhering to `system_code != 'cancelled'` and `system_code = 'done'`.
3. **UI Components & Pages**:
   - `src/pages/TasksPage.jsx`:
     - **Hierarchy / Tree View**: Expandable accordions for Milestones → Task Lists → Tasks with independent progress meters, "+ Milestone", "+ Task List", and "Add Task" buttons.
     - **Uncategorized Tasks Section**: Clearly displays legacy tasks without milestones.
     - **Kanban Board & List View**: Cascading Milestone and Task List filters.
     - **Cascading Modals**: Create Milestone, Create Task List, and Create Task modal with cascading dropdowns and mandatory RACI inputs.
   - `src/components/TaskDetailPanel.jsx`:
     - Level 5 Subtasks checklist with completion toggles, assignee selector, due dates, and live progress bar.
     - Level 4 RACI governance matrix with full R/A/C/I editing.
     - Hierarchy breadcrumb badge (`Milestone › Task List` or `Uncategorized`).
   - `src/components/TaskCard.jsx` & `TaskRow.jsx`:
     - Subtasks counter badge (e.g. `2/4 subtasks`).
     - Hierarchy path label (`Milestone / Task List`).
   - `src/pages/MyWorkPage.jsx`:
     - Enriched with hierarchy metadata and subtasks counter.

---

## 5. Verification Test Suite Summary

### A. Release 2.5 Hierarchy Verification (`scripts/test-r2_5-hierarchy.mjs`)
- **Total Tests**: 32
- **Passed**: **32**
- **Failed**: **0**
- Key Checks Verified:
  - ✓ Column definitions on `milestones`, `task_lists`, `subtasks`, `tasks`
  - ✓ `tasks_hierarchy_check` rejects partial hierarchy population
  - ✓ Composite FK `fk_task_lists_milestone` rejects cross-project task lists
  - ✓ Composite FK `fk_tasks_task_list` rejects cross-milestone tasks
  - ✓ `ON DELETE RESTRICT` prevents deleting non-empty milestones & task lists
  - ✓ `ON DELETE CASCADE` deletes subtasks and RACI rows on task delete
  - ✓ Subtasks do not inflate task list / milestone / project progress
  - ✓ RLS policies for SELECT, INSERT, UPDATE, DELETE on all hierarchy tables
  - ✓ Viewer & Anonymous read-only restrictions verified

### B. Security & Data Contract Regressions
- **Release 1.1 Security Suite** (`scripts/test-r1_1-security.mjs`): **20/20 PASSED**
- **Release 2 Data Contracts** (`scripts/test-r2-data-contracts.mjs`): **7/7 PASSED**
- **Supabase Security Advisor** (`scripts/security-advisor.mjs`): **0 UNPROTECTED TABLES, PRIVATE SCHEMA SECURE**
- **Build & Lint**: `npm run lint` (0 errors), `npm run build` (0 errors, production bundle generated)

---

## 6. Baseline Data Verification

| Entity Type | Pre-Migration Count | Post-Migration Count | Status |
| :--- | :--- | :--- | :--- |
| **Projects** | 6 | 6 | 100% Intact |
| **Legacy Tasks** | 26 | 26 | 100% Intact (Uncategorized) |
| **RACI Assignments** | 0 | 0 | 100% Intact |
| **Milestones** | 0 | 0 (New table) | Ready for usage |
| **Task Lists** | 0 | 0 (New table) | Ready for usage |
| **Subtasks** | 0 | 0 (New table) | Ready for usage |

---

## 7. Next Step

Release 2.5 Hierarchy Alignment is complete, verified, and sealed. Application is ready for Release 3 (Production Go-Live / Deployment).
