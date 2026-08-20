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

## 4. Verification & Certification

- **P5-03 Automated PostgreSQL Test Suite** (`scripts/test-p5-03-subtask-completion.mjs`): 31/31 PASSED.
- **P5-02 Frontend Test Suite** (`scripts/test-p5-02-expense-frontend.mjs`): 71/71 PASSED.
- **P5-01 Expense Runtime Suite** (`scripts/test-p5-01-expense-execution.mjs`): 39/39 PASSED.
- **P4-01 Finance Foundation Suite** (`scripts/test-p4-01-finance-foundation.mjs`): 60/60 PASSED.
- **P2-03 Parent Completion Suite** (`scripts/test-p2-03-parent-completion.mjs`): 17/17 PASSED.
- **Security Advisor**: Exactly 6 baseline warnings maintained. Zero new `SECURITY DEFINER` in `public` schema.
