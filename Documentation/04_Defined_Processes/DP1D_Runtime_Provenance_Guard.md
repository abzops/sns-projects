# SNS Projects — Defined Process Engine DP-1-D Implementation Report
## Runtime Provenance, Workflow State & Mutation Guard Protection

---

### Executive Summary

The **DP-1-D** release connects the Defined Process Engine foundation (catalog, versioning, DAG steps, template RACI, evidence definitions, and working calendars) directly to the **live runtime execution objects**:
- **`public.task_lists`** = Live Defined Process instances
- **`public.tasks`** = Live Defined Process Step execution objects

All existing 12 Task Lists and 24 Tasks remain **100% untouched** custom execution objects (`task_list_type = 'custom'`, `process_step_id IS NULL`), while robust database-level constraints, composite foreign keys, `SECURITY INVOKER` mutation guards, and RLS policies guarantee strict isolation, tamper protection, and deterministic Kanban workflow behavior.

---

### Architecture & Security Details

#### 1. Task List Provenance & Lifecycle
- Added columns: `task_list_type`, `defined_process_id`, `defined_process_version_id`, `process_state`, `started_by`, `started_at`, `completed_at`, `cancelled_by`, `cancelled_at`, `cancellation_reason`.
- Composite Foreign Key `(defined_process_version_id, defined_process_id) REFERENCES public.defined_process_versions(id, defined_process_id) ON DELETE RESTRICT` guarantees exact process/version coherence.
- Unique key `(id, defined_process_version_id)` guarantees runtime tasks bind to their parent list's exact version.
- Structural CHECK `chk_task_lists_provenance_coherence` enforces strict field requirements across `custom`, `defined (active)`, `defined (completed)`, and `defined (cancelled)` lifecycles.

#### 2. Task Provenance & Workflow State
- Added columns: `defined_process_version_id`, `process_step_id`, `workflow_state`, `current_cycle_number`, `ready_at`, `activated_at`, `workflow_completed_at`, `overdue_cycle_notified`.
- Composite FK `(process_step_id, defined_process_version_id) REFERENCES public.defined_process_steps(id, version_id) ON DELETE RESTRICT`.
- Composite FK `(task_list_id, defined_process_version_id) REFERENCES public.task_lists(id, defined_process_version_id) ON DELETE RESTRICT` guarantees that a Defined Task's version strictly equals its parent Task List's version.
- Partial Unique Index `uq_tasks_task_list_process_step` on `(task_list_id, process_step_id) WHERE process_step_id IS NOT NULL` enforces exactly one runtime task per process step in each process instance.
- Structural CHECK `chk_tasks_defined_provenance_coherence` requires defined tasks to have `current_cycle_number >= 1`, non-null workflow metadata, and `assignee_id IS NULL` (as RACI is the canonical responsibility model).

#### 3. Mutation Guards (SECURITY INVOKER)
- Triggers `trg_tasks_guard_defined_mutation` and `trg_task_lists_guard_defined_mutation` execute `private.trg_fn_guard_defined_task_mutation()` and `private.trg_fn_guard_defined_task_list_mutation()`.
- Trusted execution requires **BOTH** `current_user = 'postgres'` **AND** transaction-local marker `current_setting('sns.process_engine_write', true) = 'on'`.
- Authenticated users cannot bypass the guard by setting `sns.process_engine_write = 'on'` because `current_user` evaluates to `'authenticated'`.
- Safe metadata edits (title, description, priority, position on Custom tasks; description, priority, position on Defined tasks; name, description, position on Defined task lists) remain allowed.

#### 4. Kanban Reorder & Notification Hardening
- `reorder_kanban_tasks` (`SECURITY INVOKER`, 4-arg signature) rejects cross-status drag-and-drop for Defined Process tasks with explicit error: `Defined Process task status is controlled by the process workflow.`.
- Same-column reordering and mixed Custom/Defined column reordering continue to execute seamlessly.
- Notification trigger `private.trg_fn_task_status_changed()` suppresses generic status notifications when `NEW.process_step_id IS NOT NULL`.

---

### Verification Summary

- **Migration Applied:** `20260814194804_defined_process_runtime_provenance.sql` applied cleanly via official `npx supabase db push`.
- **Migration Ledger:** 10 local migrations == 10 remote migrations (0 pending).
- **DP-1-D Verification Suite:** 61/61 test assertions PASSED (`scripts/test-defined-process-dp1d.mjs`).
- **Regression Suites:**
  - DP-1-A (Process Catalog Foundation): 26/26 PASSED
  - DP-1-B (DAG Steps & Dependencies): 53/53 PASSED
  - DP-1-C (Working Calendars & Holidays): 50/50 PASSED
  - Kanban DnD Contracts & Isolation: 18/18 PASSED
  - Structured Production Dataset: 20/20 PASSED
  - Task Experience & Zero-Flicker: 13/13 PASSED
  - Kanban Board Hydration: 15/15 PASSED
  - Task List Hierarchy Hotfix: 17/17 PASSED
  - Navigation & Loading UX: 32/32 PASSED
- **Security Advisor:** 0 new security findings (all functions and private schema access verified).
- **Performance Advisor:** 0 new unindexed foreign key issues (all new FKs indexed).
- **Production Data Invariants:**
  - 3 Projects
  - 6 Milestones
  - 12 Task Lists (all 12 custom)
  - 24 Tasks (all 24 custom, `process_step_id IS NULL`)
  - 48 Subtasks
  - 72 RACI assignments
  - 0 duplicate Kanban positions
