# P5-03: Subtask Completion, Expense Capture & Parent Closure Convergence

## 1. Specification & Objectives

P5-03 defines the canonical completion lifecycle, expense capture, and parent closure convergence for `public.subtasks` within SNS Projects ERP.

### Core Architectural Invariants:
1. **Subtask Boundary Invariant**: `public.subtasks` remain lightweight nested execution items. They do NOT become `public.tasks` rows, do NOT own budgets, and cannot be subdivided further.
2. **Three-Component Closure Model**: A Task's completion dependencies consist of:
   - Ordinary Child Tasks (`tasks.parent_task_id = task.id`)
   - Attached Process Instances (`process_instances.placement_type = 'task' AND parent_task_id = task.id`)
   - Active Subtasks (`subtasks.task_id = task.id AND status NOT IN ('done', 'cancelled')`)
3. **Atomic Completion & Expense Invariant**: Subtasks are completed exclusively through `complete_subtask_with_expense(p_subtask_id, p_expense_payload, p_notes)` with optional single-total or itemized expense capture.
4. **Source Traceability & Zero Double Counting**: Subtask expenses record `task_id = parent Task ID` and `subtask_id = Subtask ID` with `cycle_number = NULL`. Finance actual spend queries naturally aggregate subtask expenses under the parent Task without query modifications or double counting.
5. **Direct DML Status Guards**: Direct browser updates to `status = 'done'` on `public.subtasks` are blocked server-side by `trg_subtasks_guard_status`.
6. **Parent-Subtask Bidirectional Sync**:
   - When all subtasks, child tasks, and attached processes reach terminal states, the parent task auto-completes to `Done`.
   - When a subtask is reopened (`status = 'todo'`), or when a new active subtask is inserted beneath a `Done` task, the parent task automatically transitions to `In Progress`.
7. **Deletion Safety**: Deleting a subtask with associated expense transactions is prohibited (`ON DELETE RESTRICT`).

---

## 2. Database Schema & RPC Architecture

### 2.1 Schema Extensions
- `public.expense_transactions.subtask_id`: `uuid REFERENCES public.subtasks(id) ON DELETE RESTRICT`
- `public.expense_audit_logs.subtask_id`: `uuid`
- Partial Index: `idx_expense_transactions_subtask` on `expense_transactions(subtask_id) WHERE subtask_id IS NOT NULL`
- Invariant Trigger: `trg_expense_transactions_validate_subtask` enforcing `subtask.task_id = expense_transactions.task_id`

### 2.2 Server-side Functions & Triggers
- `private.resolve_project_in_progress_status(p_project_id uuid)`: Resolves project's canonical `in_progress` status.
- `private.get_task_closure_state(p_task_id uuid)`: Computes composite closure state across child tasks, process instances, and active subtasks.
- `private.trg_fn_guard_subtask_status_transition()`: Blocks direct Data API transitions to `'done'` without internal bypass setting.
- `private.trg_fn_subtask_parent_sync()`: Trigger on `public.subtasks` managing auto-completion and automatic reopening of parent tasks.
- `private.complete_subtask_with_expense_internal(p_subtask_id, p_expense_payload, p_notes)`: `SECURITY DEFINER` atomic completion engine with OV1 tenant & capability validation, expense persistence, audit logging, and closure reevaluation.
- `public.complete_subtask_with_expense(p_subtask_id, p_expense_payload, p_notes)`: `SECURITY INVOKER` public wrapper.

---

## 3. Frontend Integration

1. **`TaskCompletionModal.jsx`**:
   - Generalized to support `entityKind: 'task' | 'process_step' | 'subtask'`.
   - Renders "Complete Subtask" header, subtask title badge, parent task reference, expense form modes, and subtask-specific CTA labels.
2. **`TaskDetailPanel.jsx`**:
   - Guards parent task direct completion when active subtasks exist.
   - Clicking an incomplete subtask checkbox opens `TaskCompletionModal` in subtask mode.
   - Clicking a completed subtask checkbox reopens it (`status = 'todo'`), triggering parent state synchronization.
   - Subtask delete displays an informative error if foreign key constraints block deletion.
3. **`TasksPage.jsx`**:
   - Intercepts Kanban drag-to-done and status dropdown actions for tasks with active subtasks, showing canonical guidance: *"This task completes automatically when all subtasks, child tasks and attached processes are complete."*

---

## 4. P5-03C: Live State Synchronization & Expense Contract Hardening

P5-03C resolves two post-implementation production defects without database schema changes:

1. **Local Subtask State Refresh**: `useSubtasks` exposes `refetch: refetchSubtasks`. On subtask completion, toggle/reopen, creation, and deletion, `refetchSubtasks()` is awaited so the subtask row, checkbox, and progress counter (e.g. `0/1 → 1/1`) update immediately without page reload.
2. **Parent Task Live Synchronization**: `TasksPage`, `MyWorkPage`, and `DepartmentWorkspacePage` maintain `selectedTask` in component state. A `useEffect` now synchronizes `selectedTask` to the refreshed canonical task object whenever the tasks collection revalidates, reflecting auto-completed `Done` parent status while the panel remains open.
3. **Defensive Response Contract Guard**: `TaskCompletionModal` validates that when `hasExpense = true`, the RPC response includes a non-null `transaction_id`. If missing, a contract error halts and the success confirmation is not displayed.
4. **`onSubtasksChange` Propagation**: `MyWorkPage` and `DepartmentWorkspacePage` pass `onSubtasksChange` to `TaskDetailPanel`, triggering silent background task revalidation on subtask lifecycle events.

Frontend baseline: `47d17ced49487bdc428d72b6dd6dd7aa95e407e8` — commit `fix(p5-03c): sync subtask completion state and verify expense payload`.

---

## 5. Accepted Final Behavioral Model

The following behaviors are certified as correct and verified in production:

- `public.subtasks` are Task execution dependencies — nested inside Tasks, NOT structural hierarchy rows, and cannot be subdivided further.
- Tasks with active Subtasks cannot be manually completed (blocked by server-side guard).
- Subtask completion supports: Complete without Expense, Single Total Expense, and Itemized / Split Expense.
- Subtask expense records: parent `task_id` + exact `subtask_id`.
- Subtask expenses roll upward through existing Task financial rollups with zero double counting.
- Final dependency auto-completes parent Task to Done.
- Reopening or adding an active Subtask under a Done Task automatically reopens parent to In Progress.
- Prior expenses remain after reopen; parent auto-completion creates no direct parent expense.
- Direct browser Subtask status bypass to `done` is blocked server-side by `trg_subtasks_guard_status`.
- Viewer role remains strictly read-only.
- Live UI refresh immediately reflects Subtask and parent Task status changes without page reload.

---

## 6. Verification & Certification

- **P5-03 Automated PostgreSQL Test Suite** (`scripts/test-p5-03-subtask-completion.mjs`): **37/37 PASSED** (P5-03C adds assertions 35 and 36: Single Total ₹123.45 and Itemized ₹350.00 exact database verification).
- **P5-02 Frontend Test Suite** (`scripts/test-p5-02-expense-frontend.mjs`): **77/77 PASSED** (P5-03C adds Suite 6: live state sync, contract hardening, and runtime payload construction assertions).
- **P5-01 Expense Runtime Suite** (`scripts/test-p5-01-expense-execution.mjs`): 39/39 PASSED.
- **P4-01 Finance Foundation Suite** (`scripts/test-p4-01-finance-foundation.mjs`): 60/60 PASSED.
- **P2-03 Parent Completion Suite** (`scripts/test-p2-03-parent-completion.mjs`): 17/17 PASSED.
- **Doc Links**: 265 relative links verified — 0 errors.
- **Lint**: 20 warnings, 0 errors (oxlint).
- **Build**: Vite production build successful.
- **GitHub Pages Deployment**: Run `32354208339` — SUCCESS.
- **Manual Production Acceptance**: **PASSED**.

> [!IMPORTANT]
> **P5-03 STATUS: VERIFIED** — P5-03, P5-03A, P5-03B, P5-03C all VERIFIED. Package 5 = **COMPLETE / VERIFIED / FROZEN**.

