# P5-02, P5-02A, P5-02B & P5-02C: Expense Execution Frontend & Completion Modals

**Package**: Package 05 — Expense Execution Integration  
**Status**: `COMPLETE / VERIFIED / FROZEN`  
**Target Milestone**: Operational V1 + Expense Runtime Convergence  
**Canonical Repository**: `abzops/sns-projects`  
**Production URL**: `https://abzops.github.io/sns-projects/`  
**Associated Backend Migrations**: `20260819131603` (P5-01), `20260819151608` (P5-01A), `20260819154319` (P5-01B), `20260819190058` (P5-01C), `20260819214046` (P5-02A)  

---

## 1. Overview

**P5-02, P5-02A, P5-02B & P5-02C** integrate the work completion user experience across all SNS Projects operational surfaces with the atomic, transactional PostgreSQL expense runtime established in P5-01.

Eligible users completing an ordinary task, a child task, or an active Defined Process Responsible step are presented with a unified, accessible completion modal (`TaskCompletionModal`). Users can complete their work without direct expenses or record single/split operational expenses atomically with task completion.

---

## 2. Key Architecture & Components

### 2.1 Central Execution & Validation Engine (`src/lib/expenseExecution.js`)
- **`getLocalDateString(date)`**: Returns `YYYY-MM-DD` using the browser's local calendar date (avoids UTC timezone shift around midnight).
- **`formatCurrency(amount)`**: Formats numeric amounts using Indian Rupee standards (`₹1,500.00`, `₹5,000.00`).
- **`parseExpenseAmount(value)`**: Sanitizes input strings into positive numbers with up to 2 decimal places. Rejects non-numeric strings, zero (`0`), and negative values (`< 0`).
- **`validateExpenseForm(form)`**: Normalizes form data for PostgreSQL:
  - *Complete without Expense*: returns `payload = null`.
  - *Single Total Mode*: validates positive amount, optional category and description, returns single payload object.
  - *Itemized / Split Mode*: validates 1+ line items with positive amounts, calculates derived total, returns normalized items array with 1-based sequential line numbers.
- **`completeTaskWithExpense(taskId, payload, notes)`**: Invokes `public.complete_task_with_expense`.
- **`completeResponsibleStepWithExpense(taskId, cycleNumber, notes, payload)`**: Invokes `public.complete_responsible_step_with_expense`.

### 2.2 Reusable Modal (`src/components/TaskCompletionModal.jsx`)
- **Primary Heading**: `Complete Task`
- **Context Header**: Displays task title badge and rework cycle number for Defined Process steps.
- **Two Choice Cards**:
  - `Complete without Expense`: Zero-expense completion.
  - `Add Expense & Complete`: Operational expense capture.
- **Expense Controls**:
  - Expense Date picker (defaults to local date `YYYY-MM-DD` via `getLocalDateString()`, editable).
  - Mode toggle: Single Total vs. Itemized / Split.
  - Add Line & Remove Line controls for itemized expenses.
  - Derived, non-editable Total calculated display.
  - Optional Completion Notes textarea.
- **Submitting & Idempotency Protection**:
  - Buttons and inputs disabled during submission.
  - Clear progress status (`Recording Expense & Completing...` / `Completing Task...`).
  - Double submissions strictly prevented.
- **Error Handling**:
  - On RPC failure, modal remains open with all entered form state intact.
  - Error banner displays human-readable failure reason from PostgreSQL.
- **Normalized Feedback**:
  - Correctly distinguishes between steps that completed vs. steps that advanced to `in_review` / `awaiting_approval` or `awaiting_consultation`.

### 2.3 Surface Integrations

| Surface | Completion Trigger | Modal Behavior |
| :--- | :--- | :--- |
| **`TaskDetailPanel.jsx`** | Status dropdown changed to `Done` OR `Complete Task` button clicked | Opens `TaskCompletionModal` for leaf tasks; blocks parent tasks with open dependencies. |
| **`TaskDetailPanel.jsx`** (Defined Step) | `Complete My Part` button clicked | Opens `TaskCompletionModal` passing current cycle number. |
| **`ProcessInstancePage.jsx`** | `Complete My Part` button clicked | Opens `TaskCompletionModal` for active Responsible step. |
| **`TasksPage.jsx`** (Kanban Board) | Task dragged to `Done` column | Intercepts drag-to-done and opens `TaskCompletionModal`; restores board if cancelled. |
| **`TasksPage.jsx`** (Task Card Menu) | `Move to... Done` selected | Intercepts move and opens `TaskCompletionModal`. |
| **`MyWorkPage.jsx`** | Task opened in `TaskDetailPanel` | Unified completion with `onWorkflowUpdated` cache refresh (zero duplicate generic UPDATEs). |
| **`DepartmentWorkspacePage.jsx`** | Task opened in `TaskDetailPanel` | Unified completion with `onWorkflowUpdated` cache refresh. |

---

## 3. Invariants & Rules Enforced

1. **Zero Direct Frontend DML**: No direct `insert()`, `update()`, or `delete()` on `public.expense_transactions` or `public.expense_items`. All mutations route through authoritative P5 PostgreSQL RPCs.
2. **Single Completion Write**: `complete_task_with_expense` / `complete_responsible_step_with_expense` is the sole completion mutation. No secondary generic task `onSave` or status UPDATE is issued.
3. **Parent Task Invariant (Server & Frontend)**: Parent tasks with child tasks or attached processes cannot capture direct expenses or be directly completed. Direct completion fails closed server-side (`20260819214046`). `public.subtasks` do not participate in Parent Task closure. Parent auto-completion is owned exclusively by canonical P2-03 trigger `trg_tasks_parent_completion_reevaluate`.
4. **Local Date Semantics**: Default expense date is determined using local browser calendar date (`getLocalDateString()`), preventing timezone date shifts near UTC midnight.
5. **Accountable Approval Isolation**: Accountable approval in Defined Processes does not open an expense modal (expenses are strictly captured during Responsible work execution).
6. **Rework Cycle Support**: Rejection and rework cycles allow new expenses to be recorded under the incremented `current_cycle_number`.
7. **Read-Only / Viewer Safety**: Viewers cannot trigger completion or access enabled mutation buttons (`readOnly` and `canMutateOperationalData` guards enforced).
8. **Responsive Layout**: Full responsive CSS module supporting desktop (1440px), tablet (1024px, 768px), and mobile (390px) viewports with sticky bottom action buttons.

---

## 4. Verification & Test Evidence

- **Automated Frontend Test Suite**: `scripts/test-p5-02-expense-frontend.mjs` (71/71 assertions PASSED).
- **Automated Backend & Security Suite**: `scripts/test-p5-01-expense-execution.mjs` (39/39 assertions PASSED).
- **CSS Module Contract Audit**: `scripts/verify-css-module-contracts.mjs` (49 modules, 1913 static references PASSED).
- **Documentation Link Integrity**: `scripts/verify-doc-links.mjs` (260/260 links verified).

---

## 5. Manual Production Acceptance Certification

Manual signed-in production acceptance on `https://abzops.github.io/sns-projects/` PASSED:

1. [x] **Ordinary Task -> Complete without Expense**: Status transitions to Done, single RPC called with null payload, zero trailing task UPDATEs.
2. [x] **Ordinary Task -> Single Expense**: Status transitions to Done, expense recorded with local date, amount, category.
3. [x] **Ordinary Task -> Itemized Expense**: Multiple line items recorded, total accurately calculated and displayed.
4. [x] **Local Date Boundary**: Verified that default expense date matches local calendar date regardless of UTC hour.
5. [x] **Validation Error Retention**: Invalid amount keeps modal open and preserves entered values.
6. [x] **Parent Task Guard**: Parent task with open children or attached process receives no direct completion modal and fails closed if attempted.
7. [x] **Process Step -> Complete without Expense**: Responsible contribution recorded, DAG advances.
8. [x] **Process Step -> Add Expense & Complete**: Responsible expense recorded under cycle 1, DAG advances.
9. [x] **Approval-Required Step**: Responsible submits expense -> task moves to review (feedback states "submitted for review") -> Accountable approves without expense prompt.
10. [x] **Rejection & Rework Cycle**: Accountable rejects -> Responsible completes rework with cycle 2 expense -> both expenses preserved.
11. [x] **Viewer Experience**: Read-only user sees no active completion button.
12. [x] **Double Click Protection**: Fast double clicks execute exactly one RPC call.
13. [x] **Responsive UX**: Verified on Desktop (1440px), Tablet (768px), and Mobile (390px).

