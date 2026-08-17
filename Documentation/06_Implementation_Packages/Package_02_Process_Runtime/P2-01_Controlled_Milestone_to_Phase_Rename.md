# Package 2 / P2-01: Controlled Milestone → Phase Physical Rename

**Package**: [Package 02 — Process Runtime & Execution](../../README.md)  
**Task ID**: P2-01  
**Status**: `VERIFIED`  
**Target Supabase Project**: `gqerfixdmgbqahgslzsq`  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Authoritative Migration**: `20260817115837_p2_01_controlled_milestone_phase_rename.sql`  
**Preceding Deliverables**: [P1-02E](../../06_Implementation_Packages/Package_01_Core_Foundation/P1-02E_Legacy_Version_Trigger_Security_Closure.md)

---

## 1. Executive Summary & Status

P2-01 executes the controlled physical architectural rename across the active database, backend RPCs, and frontend application layers:
**MILESTONE → PHASE**

This is an architectural rename establishing the canonical SNS Projects hierarchy:
```
Workspace
 └── Project
      └── Phase
           └── Task List
                └── Task
                     └── Subtask / Child Task
```

All milestone terminology has been eliminated from active production architecture:
1. **Physical Table Rename**: `public.milestones` physically renamed to `public.phases`.
2. **Column Drops & Normalization**:
   - `tasks.milestone_id` dropped; `tasks.phase_id` canonical.
   - `task_lists.milestone_id` dropped; `task_lists.phase_id` canonical.
   - `process_instances.phase_id` canonical.
3. **Composite Hierarchy Model**:
   - `phases_id_project_unique (id, project_id)` on `public.phases`
   - `task_lists_id_phase_project_unique (id, phase_id, project_id)` on `public.task_lists`
   - `fk_task_lists_phase (phase_id, project_id) REFERENCES public.phases(id, project_id) ON DELETE RESTRICT`
   - `fk_tasks_phase (phase_id, project_id) REFERENCES public.phases(id, project_id) ON DELETE RESTRICT`
   - `fk_tasks_task_list (task_list_id, phase_id, project_id) REFERENCES public.task_lists(id, phase_id, project_id) ON DELETE RESTRICT`
   - `process_instances_phase_id_fkey (phase_id) REFERENCES public.phases(id) ON DELETE SET NULL`
4. **Zero Dual Sync Overhead**:
   - `trg_task_lists_sync_milestone_phase` dropped.
   - `trg_tasks_sync_milestone_phase` dropped.
   - `chk_task_lists_phase_milestone_sync` dropped.
   - `chk_tasks_phase_milestone_sync` dropped.
   - `sync_milestone_phase_id()` dropped.
   - `public.phases` compatibility view dropped.
5. **Zero-Milestone Provenance CHECKs**:
   - `tasks_hierarchy_check` updated with 0 `milestone_id` references.
   - `chk_tasks_defined_provenance_coherence` updated with 0 `milestone_id` references across Class A, Class B, Class C1, and Class C2.
6. **Frontend Phase-Only Refactor**:
   - Created [`usePhases.js`](../../../src/hooks/usePhases.js) and deleted legacy `useMilestones.js`.
   - Updated [`useTaskLists.js`](../../../src/hooks/useTaskLists.js), [`useTasks.js`](../../../src/hooks/useTasks.js), [`useProcessInstance.js`](../../../src/hooks/useProcessInstance.js), [`useDefinedProcesses.js`](../../../src/hooks/useDefinedProcesses.js).
   - Updated UI components ([`StartProcessModal.jsx`](../../../src/components/StartProcessModal.jsx), [`TaskCard.jsx`](../../../src/components/TaskCard.jsx), [`TaskRow.jsx`](../../../src/components/TaskRow.jsx), [`TaskDetailPanel.jsx`](../../../src/components/TaskDetailPanel.jsx), [`TasksPage.jsx`](../../../src/pages/TasksPage.jsx), [`TasksPage.module.css`](../../../src/pages/TasksPage.module.css), [`ProjectsPage.jsx`](../../../src/pages/ProjectsPage.jsx), [`DashboardPage.jsx`](../../../src/pages/DashboardPage.jsx), [`MyWorkPage.jsx`](../../../src/pages/MyWorkPage.jsx), [`ProcessInstancePage.jsx`](../../../src/pages/ProcessInstancePage.jsx)).
   - Active frontend code contains **0 milestone references**.

---

## 2. DDL & Migration Architecture

### 2.1 Explicit Non-Cascading Safe Drop Order
1. Dropped dual sync triggers & check constraints:
   - `trg_task_lists_sync_milestone_phase` on `task_lists`
   - `trg_tasks_sync_milestone_phase` on `tasks`
   - `chk_task_lists_phase_milestone_sync` on `task_lists`
   - `chk_tasks_phase_milestone_sync` on `tasks`
   - `sync_milestone_phase_id()`
2. Dropped compatibility view `public.phases`.
3. Dropped legacy foreign keys:
   - `fk_tasks_milestone` on `tasks`
   - `fk_task_lists_milestone` on `task_lists`
   - `tasks_milestone_id_fkey` on `tasks`
   - `task_lists_milestone_id_fkey` on `task_lists`
   - `tasks_phase_id_fkey` on `tasks`
   - `task_lists_phase_id_fkey` on `task_lists`
   - `fk_tasks_task_list` on `tasks`
   - `process_instances_phase_id_fkey` on `process_instances`
4. Dropped legacy composite unique constraints & indexes:
   - `task_lists_id_milestone_project_unique` on `task_lists`
   - `idx_task_lists_milestone_pos` on `task_lists`
   - `idx_task_lists_milestone_proj` on `task_lists`
   - `idx_tasks_milestone_proj` on `tasks`
5. Dropped legacy columns:
   - `ALTER TABLE public.tasks DROP COLUMN IF EXISTS milestone_id;`
   - `ALTER TABLE public.task_lists DROP COLUMN IF EXISTS milestone_id;`
6. Physical table rename & primary key rename:
   - `ALTER TABLE public.milestones RENAME TO phases;`
   - `ALTER TABLE public.phases RENAME CONSTRAINT milestones_pkey TO phases_pkey;`
   - `ALTER TABLE public.phases RENAME CONSTRAINT milestones_project_id_fkey TO phases_project_id_fkey;`
   - `ALTER TABLE public.phases RENAME CONSTRAINT milestones_owner_id_fkey TO phases_owner_id_fkey;`
   - `ALTER TABLE public.phases RENAME CONSTRAINT milestones_created_by_fkey TO phases_created_by_fkey;`
   - `ALTER TABLE public.phases RENAME CONSTRAINT milestones_id_project_unique TO phases_id_project_unique;`
   - `ALTER INDEX IF EXISTS public.idx_milestones_project_pos RENAME TO idx_phases_project_pos;`
   - `ALTER INDEX IF EXISTS public.idx_milestones_status RENAME TO idx_phases_status;`
   - `ALTER INDEX IF EXISTS public.idx_milestones_owner RENAME TO idx_phases_owner;`
7. Recreated composite unique constraints:
   - `ALTER TABLE public.task_lists ADD CONSTRAINT task_lists_id_phase_project_unique UNIQUE (id, phase_id, project_id);`
8. Recreated composite RESTRICT foreign keys:
   - `fk_task_lists_phase`: `FOREIGN KEY (phase_id, project_id) REFERENCES public.phases(id, project_id) ON DELETE RESTRICT`
   - `fk_tasks_phase`: `FOREIGN KEY (phase_id, project_id) REFERENCES public.phases(id, project_id) ON DELETE RESTRICT`
   - `fk_tasks_task_list`: `FOREIGN KEY (task_list_id, phase_id, project_id) REFERENCES public.task_lists(id, phase_id, project_id) ON DELETE RESTRICT`
   - `process_instances_phase_id_fkey`: `FOREIGN KEY (phase_id) REFERENCES public.phases(id) ON DELETE SET NULL`
9. Rebuilt indexes:
   - `idx_task_lists_phase_pos ON public.task_lists(phase_id, position)`
   - `idx_task_lists_phase_proj ON public.task_lists(phase_id, project_id)`
   - `idx_tasks_phase_proj ON public.tasks(phase_id, project_id)`
   - `idx_tasks_hierarchy_covering ON public.tasks(project_id, phase_id, task_list_id)`
10. Recreated `tasks_hierarchy_check` and `chk_tasks_defined_provenance_coherence`.
11. Renamed RLS policies on `public.phases`:
    - `milestones_select_member` $\to$ `phases_select_member`
    - `milestones_insert_member` $\to$ `phases_insert_member`
    - `milestones_update_member` $\to$ `phases_update_member`
    - `milestones_delete_member` $\to$ `phases_delete_member`
12. Explicit Table Grants on `public.phases`:
    - `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phases TO authenticated;`
    - `GRANT ALL ON TABLE public.phases TO service_role, postgres;`
    - `REVOKE ALL ON TABLE public.phases FROM anon, PUBLIC;`

---

## 3. RPC & Function Upgrades

1. **`public.start_defined_process`**:
   - Signature: `public.start_defined_process(p_version_id uuid, p_project_id uuid, p_phase_id uuid, p_instance_name text, p_raci_overrides jsonb DEFAULT NULL::jsonb)`
   - PostgREST parameter mapping: uses `p_phase_id`
   - `SECURITY DEFINER` with fixed `SET search_path = ''`
2. **`private.start_process_instance_internal`**:
   - Queries `public.phases`
   - Validates `phase.project_id = p_project_id`
   - Sets `phase_id` on materialized tasks and `process_instances`
3. **`public.reorder_kanban_tasks`**:
   - Inspects `tasks.phase_id`
4. **Trigger Functions**:
   - `private.trg_fn_guard_defined_task_list_mutation()`: guards `phase_id`
   - `private.trg_fn_guard_defined_task_mutation()`: guards `phase_id`
   - `private.trg_fn_raci_assigned()`: joins `public.phases ph ON ph.id = t.phase_id`
   - `private.trg_fn_subtask_assigned()`: joins `public.phases ph ON ph.id = t.phase_id`
   - `private.trg_fn_task_status_changed()`: joins `public.phases ph ON ph.id = t.phase_id`

---

## 4. Verification & Test Results

| Test Suite | Purpose | Status | Result |
| :--- | :--- | :---: | :---: |
| `scripts/rebuild-local-db-from-migrations.mjs` | Clean 25-Migration Local Rebuild | `PASS` | 25/25 Applied, 0 errors |
| `scripts/test-p1-02a-process-lifecycle.mjs` | Real PostgreSQL E2E Lifecycle Matrix | `PASS` | 34/34 Passed |
| `scripts/test-p1-02-process-runtime.mjs` | Placement-Aware Runtime Contracts | `PASS` | 45/45 Passed |
| `scripts/test-p1-01-foundation.mjs` | Core Foundation Invariants | `PASS` | 45/45 Passed |
| `scripts/verify-p2-01-phase-rename.mjs` | P2-01 Dedicated Database Parity Verifier | `PASS` | 30/30 Passed |
| `scripts/verify-zero-legacy-milestones.mjs` | Zero-Legacy Semantic Audit | `PASS` | 8/8 Passed (0 active violations) |
| `npm run lint` | Oxlint Static Code Analysis | `PASS` | 0 Errors |
| `npm run build` | Production Vite Bundle Verification | `PASS` | 0 Errors |
| `scripts/verify-doc-links.mjs` | Documentation Link Portability | `PASS` | 174 Links Passed |
