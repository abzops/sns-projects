# P5-02: Expense Execution Frontend & Completion Modals

**Package**: Package 05 — Expense Execution Integration  
**Status**: `IMPLEMENTED / MANUAL ACCEPTANCE PENDING`  
**Target Milestone**: Operational V1 + Expense Runtime Convergence  
**Canonical Repository**: `abzops/sns-projects`  
**Production URL**: `https://abzops.github.io/sns-projects/`  
**Associated Backend Migrations**: `20260819131603` (P5-01), `20260819151608` (P5-01A), `20260819154319` (P5-01B), `20260819190058` (P5-01C)  

---

## 1. Overview

**P5-02** integrates the work completion user experience across all SNS Projects operational surfaces with the atomic, transactional PostgreSQL expense runtime established in P5-01.

Eligible users completing an ordinary task, a child task, or an active Defined Process Responsible step are presented with a unified, accessible completion modal (`TaskCompletionModal`). Users can complete their work without direct expenses or record single/split operational expenses atomically with task completion.

---

## 2. Key Architecture & Components

### 2.1 Central Execution & Validation Engine (`src/lib/expenseExecution.js`)
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
  - Expense Date picker (defaults to today's date `YYYY-MM-DD`, editable).
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

### 2.3 Surface Integrations

| Surface | Completion Trigger | Modal Behavior |
| :--- | :--- | :--- |
| **`TaskDetailPanel.jsx`** | Status dropdown changed to `Done` OR `Complete Task` button clicked | Opens `TaskCompletionModal` for leaf tasks; blocks parent tasks with open dependencies. |
| **`TaskDetailPanel.jsx`** (Defined Step) | `Complete My Part` button clicked | Opens `TaskCompletionModal` passing current cycle number. |
| **`ProcessInstancePage.jsx`** | `Complete My Part` button clicked | Opens `TaskCompletionModal` for active Responsible step. |
| **`TasksPage.jsx`** (Kanban Board) | Task dragged to `Done` column | Intercepts drag-to-done and opens `TaskCompletionModal`; restores board if cancelled. |
| **`TasksPage.jsx`** (Task Card Menu) | `Move to... Done` selected | Intercepts move and opens `TaskCompletionModal`. |
| **`MyWorkPage.jsx`** | Task opened in `TaskDetailPanel` | Unified completion with `onWorkflowUpdated` cache refresh. |
| **`DepartmentWorkspacePage.jsx`** | Task opened in `TaskDetailPanel` | Unified completion with `onWorkflowUpdated` cache refresh. |

---

## 3. Invariants & Rules Enforced

1. **Zero Direct Frontend DML**: No direct `insert()`, `update()`, or `delete()` on `public.expense_transactions` or `public.expense_items`. All mutations route through authoritative P5 PostgreSQL RPCs.
2. **Parent Task Invariant**: Parent tasks with child tasks or attached processes cannot capture direct expenses and auto-complete via canonical P2-03 trigger `trg_tasks_parent_completion_reevaluate`.
3. **Accountable Approval Isolation**: Accountable approval in Defined Processes does not open an expense modal (expenses are strictly captured during Responsible work execution).
4. **Rework Cycle Support**: Rejection and rework cycles allow new expenses to be recorded under the incremented `current_cycle_number`.
5. **Read-Only / Viewer Safety**: Viewers cannot trigger completion or access enabled mutation buttons (`readOnly` and `canMutateOperationalData` guards enforced).
6. **Responsive Layout**: Full responsive CSS module supporting desktop (1440px), tablet (1024px, 768px), and mobile (390px) viewports.

---

## 4. Verification & Test Evidence

- **Automated Frontend Test Suite**: `scripts/test-p5-02-expense-frontend.mjs` (41/41 assertions PASSED).
- **CSS Module Contract Audit**: `scripts/verify-css-module-contracts.mjs` (49 modules, 1915 static references PASSED).
- **Documentation Link Integrity**: `scripts/verify-doc-links.mjs` (255/255 links verified).

---

## 5. Manual Production Acceptance Checklist

The following scenarios are prepared for production verification upon deployment:

1. [ ] **Ordinary Task -> Complete without Expense**: Status transitions to Done, RPC called with null payload, task completed.
2. [ ] **Ordinary Task -> Single Expense**: Status transitions to Done, expense recorded with amount, category, date.
3. [ ] **Ordinary Task -> Itemized Expense**: Multiple line items recorded, total accurately calculated and displayed.
4. [ ] **Validation Error Retention**: Invalid amount keeps modal open and preserves entered values.
5. [ ] **Parent Task Safety**: Parent task with open children receives no direct expense modal.
6. [ ] **Process Step -> Complete without Expense**: Responsible contribution recorded, DAG advances.
7. [ ] **Process Step -> Add Expense & Complete**: Responsible expense recorded under cycle 1, DAG advances.
8. [ ] **Approval-Required Step**: Responsible submits expense -> task moves to review -> Accountable approves without expense prompt.
9. [ ] **Rejection & Rework Cycle**: Accountable rejects -> Responsible completes rework with cycle 2 expense -> both expenses preserved.
10. [ ] **Viewer Experience**: Read-only user sees no active completion button.
11. [ ] **Double Click Protection**: Fast double clicks execute exactly one RPC call.
12. [ ] **Responsive UX**: Verified on Desktop (1440px), Tablet (768px), and Mobile (390px).
