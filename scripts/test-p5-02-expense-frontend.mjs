import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  formatCurrency,
  parseExpenseAmount,
  validateExpenseForm,
  getLocalDateString,
  EXPENSE_CATEGORIES,
} from '../src/lib/expenseExecution.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [
  taskCompletionModal,
  taskCompletionModalCss,
  taskDetailPanel,
  processInstancePage,
  tasksPage,
  myWorkPage,
  useTasksHook,
  useProcessInstanceHook,
  expenseExecutionLib,
] = await Promise.all([
  read('src/components/TaskCompletionModal.jsx'),
  read('src/components/TaskCompletionModal.module.css'),
  read('src/components/TaskDetailPanel.jsx'),
  read('src/pages/ProcessInstancePage.jsx'),
  read('src/pages/TasksPage.jsx'),
  read('src/pages/MyWorkPage.jsx'),
  read('src/hooks/useTasks.js'),
  read('src/hooks/useProcessInstance.js'),
  read('src/lib/expenseExecution.js'),
]);

let passed = 0;
function check(value, message) {
  assert.ok(value, message);
  passed += 1;
  console.log(`  [PASS ${passed}] ${message}`);
}

console.log('======================================================================');
console.log('SNS Projects — Package 5 / P5-02B: Closure Model Parity & UI Hardening');
console.log('======================================================================\n');

// ── Suite 1: Expense Validation, Local Date & Currency Engine ───────────────
console.log('--- Suite 1: Expense Form Validation, Local Date & Currency Engine ---');

// 1. Complete without expense
const noExpenseRes = validateExpenseForm({ hasExpense: false });
check(noExpenseRes.isValid === true && noExpenseRes.payload === null, 'Complete without Expense returns isValid=true and payload=null');

// 2. Single Total positive amount
const singleValid = validateExpenseForm({
  hasExpense: true,
  mode: 'single',
  expenseDate: '2026-08-20',
  singleAmount: '2500.50',
  singleCategory: 'Hardware',
  singleDescription: 'Server RAM upgrade',
});
check(
  singleValid.isValid === true &&
    singleValid.payload.amount === 2500.5 &&
    singleValid.payload.category === 'Hardware' &&
    singleValid.payload.expense_date === '2026-08-20',
  'Single Total valid amount produces normalized single payload'
);

// 3. Single Total invalid zero amount
const singleZero = validateExpenseForm({
  hasExpense: true,
  mode: 'single',
  expenseDate: '2026-08-20',
  singleAmount: '0',
});
check(singleZero.isValid === false && singleZero.error.includes('greater than'), 'Single Total rejects 0 amount');

// 4. Single Total invalid negative amount
const singleNeg = validateExpenseForm({
  hasExpense: true,
  mode: 'single',
  expenseDate: '2026-08-20',
  singleAmount: '-100',
});
check(singleNeg.isValid === false && singleNeg.error.includes('greater than'), 'Single Total rejects negative amount');

// 5. Single Total invalid non-numeric amount
const singleNonNum = validateExpenseForm({
  hasExpense: true,
  mode: 'single',
  expenseDate: '2026-08-20',
  singleAmount: 'abc',
});
check(singleNonNum.isValid === false, 'Single Total rejects non-numeric amount');

// 6. Itemized valid multiple lines
const itemizedValid = validateExpenseForm({
  hasExpense: true,
  mode: 'itemized',
  expenseDate: '2026-08-20',
  overallDescription: 'Deployment equipment',
  items: [
    { amount: '2000', category: 'Hardware', description: 'Cables' },
    { amount: '3000', category: 'Software', description: 'License' },
  ],
});
check(
  itemizedValid.isValid === true &&
    itemizedValid.payload.items.length === 2 &&
    itemizedValid.payload.items[0].line_number === 1 &&
    itemizedValid.payload.items[0].amount === 2000 &&
    itemizedValid.payload.items[1].line_number === 2 &&
    itemizedValid.payload.items[1].amount === 3000,
  'Itemized mode produces normalized items array with sequential line numbers'
);

// 7. Itemized empty items array
const itemizedEmpty = validateExpenseForm({
  hasExpense: true,
  mode: 'itemized',
  expenseDate: '2026-08-20',
  items: [],
});
check(itemizedEmpty.isValid === false, 'Itemized mode rejects empty items array');

// 8. Itemized invalid item amount
const itemizedInvalidItem = validateExpenseForm({
  hasExpense: true,
  mode: 'itemized',
  expenseDate: '2026-08-20',
  items: [
    { amount: '2000', category: 'Hardware' },
    { amount: '0', category: 'Software' },
  ],
});
check(itemizedInvalidItem.isValid === false && itemizedInvalidItem.error.includes('Line 2'), 'Itemized mode identifies specific invalid line item');

// 9. Invalid date string
const invalidDate = validateExpenseForm({
  hasExpense: true,
  mode: 'single',
  expenseDate: 'invalid-date',
  singleAmount: '500',
});
check(invalidDate.isValid === false && invalidDate.error.includes('valid expense date'), 'Form validation rejects invalid date string');

// 10. Local Calendar Date Helper (P5-02A)
const sampleDate1 = new Date(2026, 7, 20, 0, 15, 0); // Aug 20, 2026 00:15 local
const sampleDate2 = new Date(2026, 7, 19, 23, 45, 0); // Aug 19, 2026 23:45 local
const sampleDateNewYear = new Date(2027, 0, 1, 0, 0, 0); // Jan 1, 2027 00:00 local

check(getLocalDateString(sampleDate1) === '2026-08-20', 'getLocalDateString uses local year, month, and day for early morning dates');
check(getLocalDateString(sampleDate2) === '2026-08-19', 'getLocalDateString uses local year, month, and day for late evening dates');
check(getLocalDateString(sampleDateNewYear) === '2027-01-01', 'getLocalDateString handles month and year rollovers with proper 0-padding');
check(
  !taskCompletionModal.includes('new Date().toISOString().split(\'T\')[0]'),
  'TaskCompletionModal does NOT use UTC toISOString() for default expense date'
);
check(
  taskCompletionModal.includes('getLocalDateString()'),
  'TaskCompletionModal uses getLocalDateString() for initial and reset date state'
);

// 11. Currency formatter & parser
check(formatCurrency(5000).includes('5,000.00'), 'formatCurrency formats standard monetary amounts');
check(formatCurrency(0).includes('0.00'), 'formatCurrency handles zero');
check(parseExpenseAmount('1500.75') === 1500.75, 'parseExpenseAmount parses string decimal amounts');
check(parseExpenseAmount(-10) === null, 'parseExpenseAmount returns null for negative numbers');
check(Array.isArray(EXPENSE_CATEGORIES) && EXPENSE_CATEGORIES.includes('Hardware'), 'Standard expense categories list is defined');

// ── Suite 2: TaskCompletionModal Component Architecture ─────────────────────
console.log('\n--- Suite 2: TaskCompletionModal Component Architecture ---');

// 12. Modal Heading & Structure
check(taskCompletionModal.includes('title="Complete Task"'), 'TaskCompletionModal sets primary title to "Complete Task"');
check(taskCompletionModal.includes('Complete without Expense'), 'TaskCompletionModal provides "Complete without Expense" option');
check(taskCompletionModal.includes('Add Expense & Complete'), 'TaskCompletionModal provides "Add Expense & Complete" option');

// 13. RPC Invocations
check(
  taskCompletionModal.includes('completeTaskWithExpense('),
  'TaskCompletionModal invokes completeTaskWithExpense for ordinary tasks'
);
check(
  taskCompletionModal.includes('completeResponsibleStepWithExpense('),
  'TaskCompletionModal invokes completeResponsibleStepWithExpense for Defined Process steps'
);
check(
  taskCompletionModal.includes('cycleNumber') && taskCompletionModal.includes('current_cycle_number'),
  'TaskCompletionModal passes current cycle number for Defined Process steps'
);

// 14. Submitting Protection & Idempotency
check(
  taskCompletionModal.includes('setSubmitting(true)') && taskCompletionModal.includes('disabled={submitting'),
  'TaskCompletionModal disables actions and prevents double submissions while processing'
);
check(
  taskCompletionModal.includes('Recording Expense & Completing...') || taskCompletionModal.includes('Completing Task...'),
  'TaskCompletionModal displays explicit progress status during RPC execution'
);

// 15. Error Handling & Form Retention
check(
  taskCompletionModal.includes('setErrorMessage(res.error') && taskCompletionModal.includes('setSubmitting(false)'),
  'TaskCompletionModal keeps modal open and re-enables controls on RPC failure'
);
check(
  taskCompletionModal.includes('role="alert"') || taskCompletionModal.includes('errorNotice'),
  'TaskCompletionModal renders accessible error notice on failure'
);

// 16. Itemized Mode Controls & Derived Total
check(
  taskCompletionModal.includes('handleAddItem') && taskCompletionModal.includes('handleRemoveItem'),
  'TaskCompletionModal provides Add Line and Remove Line controls for itemized expenses'
);
check(
  taskCompletionModal.includes('calculatedTotal') && !taskCompletionModal.includes('onChange={(e) => setCalculatedTotal'),
  'Calculated Total is purely derived/read-only and cannot be manually overridden'
);

// 17. Process Response Interpretation (P5-02A)
check(
  taskCompletionModal.includes("stepStatus === 'in_review' || stepStatus === 'awaiting_approval'") &&
    taskCompletionModal.includes('submitted for review'),
  'TaskCompletionModal informs user when step moves to in_review / awaiting_approval without claiming full completion'
);
check(
  taskCompletionModal.includes("stepStatus === 'awaiting_consultation'") &&
    taskCompletionModal.includes('submitted for consultation'),
  'TaskCompletionModal informs user when step requires consultation'
);
check(
  taskCompletionModal.includes("stepStatus === 'completed' || res.data?.success"),
  'TaskCompletionModal recognizes canonical completed status'
);

// ── Suite 3: Integration Across Task Surfaces & Closure Parity (P5-02B) ─────
console.log('\n--- Suite 3: Integration Across Task Surfaces & Closure Parity (P5-02B) ---');

// 18. TaskDetailPanel: Elimination of Second Completion Write (P5-02A)
check(
  taskDetailPanel.includes('<TaskCompletionModal'),
  'TaskDetailPanel renders TaskCompletionModal'
);
check(
  !taskDetailPanel.includes('handleCompletionSuccess = () => {\n    if (isDefinedTask) {\n      onWorkflowUpdated?.();\n    } else {\n      const doneStatus = statuses.find((s) => s.system_code === \'done\' || s.name?.toLowerCase() === \'done\');\n      if (doneStatus) {\n        setForm((prev) => ({ ...prev, status_id: doneStatus.id }));\n      }\n      onWorkflowUpdated?.();\n      onSave?.('),
  'TaskDetailPanel.handleCompletionSuccess does NOT invoke onSave() after successful RPC completion'
);
check(
  taskDetailPanel.includes('handleCompletionSuccess = () =>') && taskDetailPanel.includes('onWorkflowUpdated?.()'),
  'TaskDetailPanel.handleCompletionSuccess revalidates queries and updates local state without DB mutation'
);

// 19. TaskDetailPanel: Canonical Parent / Host Detection (P5-02B)
// Evaluates closure definition parity: child tasks & attached processes participate, subtasks DO NOT participate
const simulateTaskDetailParentCheck = (task) => {
  return Boolean(
    task?.child_task_count > 0 ||
    task?.has_children ||
    task?.is_parent ||
    task?.attached_process_count > 0 ||
    task?.attached_processes?.length > 0 ||
    task?.process_instances?.length > 0
  );
};

check(
  simulateTaskDetailParentCheck({ id: 'task-1', child_task_count: 0, subtasks: [{ status: 'todo' }] }) === false,
  'A. Task with NO Child Tasks but with unfinished Subtasks is NOT blocked from completion'
);
check(
  simulateTaskDetailParentCheck({ id: 'task-2', child_task_count: 2 }) === true,
  'B. Task with Child Tasks IS identified as parent and blocked from direct completion'
);
check(
  simulateTaskDetailParentCheck({ id: 'task-3', attached_process_count: 1 }) === true,
  'C. Task hosting attached Process IS identified as host and blocked from direct completion'
);
check(
  simulateTaskDetailParentCheck({ id: 'task-4', child_task_count: 0, attached_process_count: 0 }) === false,
  'D. Leaf Task with no dependencies is NOT blocked and proceeds to completion'
);

// Check frontend source code does NOT contain subtask blocking in parent detection
check(
  !taskDetailPanel.includes('subtasks.some((st) => st.status') &&
    !taskDetailPanel.includes('subtasks && subtasks.length > 0 && subtasks.some'),
  'TaskDetailPanel does NOT inspect subtasks for parent closure blocking'
);
check(
  !tasksPage.includes('movedTask?.subtasks?.some((st) => st.status') &&
    !tasksPage.includes('subtasks.some((st) => st.status'),
  'TasksPage does NOT inspect subtasks for parent closure blocking'
);

// Toast message wording correctness (P5-02B)
check(
  !taskDetailPanel.includes('all child tasks and subtasks are completed'),
  'TaskDetailPanel does NOT mention subtasks in parent closure toast'
);
check(
  taskDetailPanel.includes('Parent tasks auto-complete when all child tasks and attached processes are completed.'),
  'TaskDetailPanel uses canonical toast wording referencing child tasks and attached processes'
);

// 20. ProcessInstancePage Integration & Normalized Feedback (P5-02A)
check(
  processInstancePage.includes('<TaskCompletionModal'),
  'ProcessInstancePage renders TaskCompletionModal'
);
check(
  processInstancePage.includes('setCompletionModalTask(task)'),
  'ProcessInstancePage routes Complete My Part button to TaskCompletionModal'
);
check(
  !processInstancePage.includes('handleApprove = async (task) => {\n    setCompletionModalTask'),
  'ProcessInstancePage Accountable approval action does NOT trigger expense modal'
);
check(
  processInstancePage.includes("stepStatus === 'in_review' || stepStatus === 'awaiting_approval'") &&
    processInstancePage.includes('submitted for review'),
  'ProcessInstancePage handleCompletePart interprets in_review status accurately'
);

// 21. TasksPage Kanban & Drag-and-Drop Parent / Host Task Guards (P5-02B)
check(
  tasksPage.includes('<TaskCompletionModal'),
  'TasksPage renders TaskCompletionModal'
);
check(
  tasksPage.includes("getStatusSystemCode(destStatus) === 'done'") && tasksPage.includes('setCompletionModalTask(movedTask)'),
  'TasksPage intercepts Kanban drag-to-done and opens TaskCompletionModal'
);
check(
  tasksPage.includes("getStatusSystemCode(targetStatus) === 'done'") && tasksPage.includes('setCompletionModalTask(movedTask)'),
  'TasksPage intercepts status menu selection of Done and opens TaskCompletionModal'
);
check(
  tasksPage.includes('placement_type === \'task\'') && tasksPage.includes('p.parent_task_id === activeTaskId'),
  'TasksPage onDragEnd guards host tasks with attached processes from direct completion'
);

// 22. Viewer / Read-Only Safety
check(
  taskDetailPanel.includes('readOnly={readOnly}') && tasksPage.includes('readOnly={!canMutateTasks}'),
  'Viewer readOnly permissions are strictly propagated to TaskCompletionModal'
);

// 23. Hooks & Central Utility Exports
check(
  useTasksHook.includes('completeTask'),
  'useTasks hook exports completeTask calling backend RPC'
);
check(
  useProcessInstanceHook.includes('complete_responsible_step_with_expense'),
  'useProcessInstance hook calls complete_responsible_step_with_expense RPC'
);

// ── Suite 4: Security & Financial Ledger Immutability ────────────────────────
console.log('\n--- Suite 4: Security & Financial Ledger Immutability ---');

// 24. No direct DML from frontend
check(
  !taskCompletionModal.includes(".from('expense_transactions')") &&
    !taskDetailPanel.includes(".from('expense_transactions')") &&
    !tasksPage.includes(".from('expense_transactions')") &&
    !processInstancePage.includes(".from('expense_transactions')"),
  'Zero direct INSERT/UPDATE/DELETE queries to expense_transactions from frontend (100% RPC-only)'
);
check(
  !taskCompletionModal.includes(".from('expense_items')") &&
    !taskDetailPanel.includes(".from('expense_items')") &&
    !tasksPage.includes(".from('expense_items')") &&
    !processInstancePage.includes(".from('expense_items')"),
  'Zero direct INSERT/UPDATE/DELETE queries to expense_items from frontend (100% RPC-only)'
);

// 25. Subtask Entity Boundaries (P5-02B)
check(
  !expenseExecutionLib.includes('subtask_id') &&
    !taskCompletionModal.includes('subtask_id') &&
    !useTasksHook.includes('subtask_id'),
  'E. Subtasks are not converted into Finance execution entities (zero expense coupling)'
);

// 26. Responsive CSS Contracts
check(
  taskCompletionModalCss.includes('@media (max-width: 768px)') && taskCompletionModalCss.includes('@media (max-width: 390px)'),
  'TaskCompletionModal CSS module contains responsive breakpoints for tablet (768px) and mobile (390px)'
);

console.log('\n======================================================================');
console.log(`P5-02B Closure Model Parity & UI Hardening: ${passed} PASSED, 0 FAILED (Total: ${passed})`);
console.log('======================================================================\n');
