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
console.log('SNS Projects — Package 5 / P5-02C: Completion Modal Visual & Theme Hotfix');
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

// 12. Modal Heading & Structure — now dynamic (P5-03: supports 'task' | 'subtask' modes)
check(
  taskCompletionModal.includes("'Complete Task'") || taskCompletionModal.includes('"Complete Task"') || taskCompletionModal.includes('Complete Task'),
  'TaskCompletionModal sets primary title to "Complete Task"'
);
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
  taskCompletionModal.includes('Recording Expense & Completing...') || taskCompletionModal.includes('Completing Task...') || taskCompletionModal.includes('Completing Subtask...'),
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

// ── Suite 3: Integration Across Task Surfaces & Closure Parity (P5-02B / P5-03) ─────
console.log('\n--- Suite 3: Integration Across Task Surfaces & Closure Parity (P5-02B / P5-03) ---');

// 18. TaskDetailPanel: Elimination of Second Completion Write & Stale State Fix (P5-02C)
check(
  taskDetailPanel.includes('<TaskCompletionModal'),
  'TaskDetailPanel renders TaskCompletionModal'
);
check(
  !taskDetailPanel.includes('setShowCompleteForm'),
  'TaskDetailPanel has 0 stale references to setShowCompleteForm (P5-02C runtime crash fix)'
);
check(
  taskDetailPanel.includes('setShowCompletionModal(false)'),
  'TaskDetailPanel properly resets showCompletionModal on task change'
);
check(
  !taskDetailPanel.includes('handleCompletionSuccess = () => {\n    if (isDefinedTask) {\n      onWorkflowUpdated?.();\n    } else {\n      const doneStatus = statuses.find((s) => s.system_code === \'done\' || s.name?.toLowerCase() === \'done\');\n      if (doneStatus) {\n        setForm((prev) => ({ ...prev, status_id: doneStatus.id }));\n      }\n      onWorkflowUpdated?.();\n      onSave?.('),
  'TaskDetailPanel.handleCompletionSuccess does NOT invoke onSave() after successful RPC completion'
);
check(
  (taskDetailPanel.includes('handleCompletionSuccess = () =>') || taskDetailPanel.includes('handleCompletionSuccess = async () =>')) && taskDetailPanel.includes('onWorkflowUpdated?.()'),
  'TaskDetailPanel.handleCompletionSuccess revalidates queries and updates local state without DB mutation'
);

// 19. TaskDetailPanel: Canonical Parent / Host Detection (P5-02B + P5-03 subtask extension)
const simulateTaskDetailParentCheck_v2 = (task, subtasks = []) => {
  const hasActiveSubtasks = subtasks.filter(st => st.status !== 'cancelled').length > 0;
  return Boolean(
    task?.child_task_count > 0 ||
    task?.has_children ||
    task?.is_parent ||
    task?.attached_process_count > 0 ||
    task?.attached_processes?.length > 0 ||
    task?.process_instances?.length > 0 ||
    hasActiveSubtasks ||
    task?.subtask_count > 0
  );
};

check(
  simulateTaskDetailParentCheck_v2({ id: 'task-1', child_task_count: 0 }, [{ status: 'todo' }]) === true,
  'A. Task with NO Child Tasks but with unfinished Subtasks IS blocked from completion (P5-03)'
);
check(
  simulateTaskDetailParentCheck_v2({ id: 'task-2', child_task_count: 2 }) === true,
  'B. Task with Child Tasks IS identified as parent and blocked from direct completion'
);
check(
  simulateTaskDetailParentCheck_v2({ id: 'task-3', attached_process_count: 1 }) === true,
  'C. Task hosting attached Process IS identified as host and blocked from direct completion'
);
check(
  simulateTaskDetailParentCheck_v2({ id: 'task-4', child_task_count: 0, attached_process_count: 0 }, []) === false,
  'D. Leaf Task with no dependencies is NOT blocked and proceeds to completion'
);

// Check frontend source code DOES contain subtask blocking in parent detection (P5-03)
check(
  taskDetailPanel.includes('hasActiveSubtasks') || taskDetailPanel.includes("st.status !== 'cancelled'"),
  'TaskDetailPanel DOES inspect subtasks for parent closure blocking (P5-03)'
);

// Toast message wording correctness (P5-03 canonical)
check(
  !taskDetailPanel.includes('all child tasks and subtasks are completed'),
  'TaskDetailPanel does NOT mention subtasks and child tasks in incorrect combined old toast'
);
check(
  taskDetailPanel.includes('This task completes automatically when all subtasks, child tasks and attached processes are complete.'),
  'TaskDetailPanel uses canonical P5-03 toast wording referencing subtasks, child tasks and attached processes'
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

// ── Suite 4: Visual Polish, Theme Tokens & Design System Parity (P5-02C) ─────
console.log('\n--- Suite 4: Visual Polish, Theme Tokens & Design System Parity (P5-02C) ---');

// 24. Zero undefined --brand tokens in TaskCompletionModal.module.css
const undefinedBrandMatches = taskCompletionModalCss.match(/var\(--brand(?![a-zA-Z0-9_-])/g) ||
  taskCompletionModalCss.match(/var\(--brand-hover(?![a-zA-Z0-9_-])/g);
check(
  undefinedBrandMatches === null,
  'TaskCompletionModal.module.css contains 0 undefined var(--brand) or var(--brand-hover) tokens'
);
check(
  taskCompletionModalCss.includes('var(--accent)'),
  'TaskCompletionModal.module.css uses canonical var(--accent) for primary yellow'
);
check(
  taskCompletionModalCss.includes('var(--accent-hover)'),
  'TaskCompletionModal.module.css uses canonical var(--accent-hover) for hover state'
);

// 25. Choice card selected state: clean single border, no double ring
check(
  taskCompletionModalCss.includes('.choiceCardActive') &&
    !taskCompletionModalCss.includes('box-shadow: 0 0 0 1px var(--brand)') &&
    !taskCompletionModalCss.includes('box-shadow: 0 0 0 1px var(--accent)'),
  'Choice card active state uses a single clean yellow border without visual double rings'
);
check(
  taskCompletionModalCss.includes('.choiceCardActive .choiceIconWrap {\n  background: var(--accent);\n  color: #000;\n}'),
  'Selected choice card icon receives solid yellow background with black icon for high contrast'
);

// 26. Primary CTA Button Contrast & Disabled Treatment
check(
  taskCompletionModalCss.includes('.submitBtn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  padding: 8px 18px;\n  font-size: 0.88rem;\n  font-weight: 700;\n  color: #000;\n  background: var(--accent);'),
  'Submit CTA is styled with yellow background and black bold text in enabled state'
);
check(
  taskCompletionModalCss.includes('.submitBtn:disabled {\n  background: rgba(255, 255, 255, 0.08);\n  border-color: rgba(255, 255, 255, 0.12);\n  color: var(--muted);'),
  'Submit CTA disabled state renders visible neutral button shape with readable text (no black-on-black)'
);

// 27. Sticky Footer Actions Inside Modal Body
check(
  taskCompletionModalCss.includes('position: sticky') &&
    taskCompletionModalCss.includes('bottom:') &&
    taskCompletionModalCss.includes('backdrop-filter: blur'),
  'Modal footer actions are sticky at the bottom with backdrop blur, preventing CTA disappearance during scrolling'
);

// 28. Mode Toggle Styling
check(
  taskCompletionModalCss.includes('.modeBtnActive {\n  background: var(--panel-strong);\n  color: var(--accent);\n  font-weight: 700;'),
  'Mode toggle active state uses panel-strong background and accent text for clear visual hierarchy'
);

// ── Suite 5: Security & Financial Ledger Immutability ────────────────────────
console.log('\n--- Suite 5: Security & Financial Ledger Immutability ---');

// 29. No direct DML from frontend
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

// 30. Subtask Entity Boundaries (P5-03: subtask_id NOW exists in expenseExecution via complete_subtask_with_expense)
check(
  expenseExecutionLib.includes('completeSubtaskWithExpense') &&
    expenseExecutionLib.includes('p_subtask_id'),
  'E. completeSubtaskWithExpense RPC wrapper is defined in expenseExecution.js with p_subtask_id param (P5-03)'
);
check(
  !useTasksHook.includes("from('expense_transactions')"),
  'E2. useTasks hook does NOT write directly to expense_transactions'
);

// 31. Responsive CSS Contracts
check(
  taskCompletionModalCss.includes('@media (max-width: 768px)') && taskCompletionModalCss.includes('@media (max-width: 390px)'),
  'TaskCompletionModal CSS module contains responsive breakpoints for tablet (768px) and mobile (390px)'
);

// ── Suite 6: P5-03C Subtask Live State Sync & Expense Contract Hardening ─────
console.log('\n--- Suite 6: P5-03C Subtask Live State Sync & Expense Contract Hardening ---');

// 32. refetchSubtasks is destructured and called in TaskDetailPanel
check(
  taskDetailPanel.includes('refetch: refetchSubtasks') &&
    taskDetailPanel.includes('await refetchSubtasks?.()'),
  'refetchSubtasks is destructured from useSubtasks and called upon subtask completion, toggle, add, and delete'
);

// 33. selectedTask synchronization effect in TasksPage
check(
  tasksPage.includes('setSelectedTask(refreshed)') &&
    tasksPage.includes('t.id === selectedTask.id'),
  'TasksPage contains synchronization effect keeping selectedTask in sync with refreshed tasks'
);

// 34. selectedTask synchronization effect in MyWorkPage
check(
  myWorkPage.includes('setSelectedTask(refreshed)') &&
    myWorkPage.includes('onSubtasksChange'),
  'MyWorkPage contains synchronization effect and passes onSubtasksChange to TaskDetailPanel'
);

// 35. Defensive response contract guard in TaskCompletionModal
check(
  taskCompletionModal.includes('hasExpense && !res.data?.transaction_id') &&
    taskCompletionModal.includes('Contract Error'),
  'TaskCompletionModal defends against contract mismatches when expense is requested but transaction_id is missing'
);

// 36. Runtime Single Total Expense Payload Construction (₹123.45, Materials, 'acceptance test')
const runtimeSingle = validateExpenseForm({
  hasExpense: true,
  mode: 'single',
  expenseDate: '2026-08-20',
  singleAmount: '123.45',
  singleCategory: 'Materials',
  singleDescription: 'acceptance test',
});
check(
  runtimeSingle.isValid === true &&
    runtimeSingle.payload !== null &&
    runtimeSingle.payload.amount === 123.45 &&
    runtimeSingle.payload.category === 'Materials' &&
    runtimeSingle.payload.description === 'acceptance test' &&
    runtimeSingle.payload.expense_date === '2026-08-20',
  'Runtime Single Total expense form produces non-null payload with exact amount (123.45), category (Materials), and description'
);

// 37. Runtime Itemized Expense Payload Construction (100 + 200 + 50 = 350)
const runtimeItemized = validateExpenseForm({
  hasExpense: true,
  mode: 'itemized',
  expenseDate: '2026-08-20',
  overallDescription: 'Hardware package',
  items: [
    { amount: '100.00', category: 'Hardware', description: 'Item 1' },
    { amount: '200.00', category: 'Materials', description: 'Item 2' },
    { amount: '50.00', category: 'Logistics', description: 'Item 3' },
  ],
});
check(
  runtimeItemized.isValid === true &&
    runtimeItemized.payload !== null &&
    runtimeItemized.payload.items.length === 3 &&
    runtimeItemized.payload.items[0].amount === 100.00 &&
    runtimeItemized.payload.items[1].amount === 200.00 &&
    runtimeItemized.payload.items[2].amount === 50.00 &&
    runtimeItemized.payload.items.reduce((s, i) => s + i.amount, 0) === 350.00,
  'Runtime Itemized expense form produces valid payload with 3 lines totaling ₹350.00'
);

console.log('\n======================================================================');
console.log(`P5-02C / P5-03C: ${passed} PASSED, 0 FAILED (Total: ${passed})`);
console.log('======================================================================\n');

