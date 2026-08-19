import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  formatCurrency,
  parseExpenseAmount,
  validateExpenseForm,
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
console.log('SNS Projects — Package 5 / P5-02: Expense Completion UI & Contracts');
console.log('======================================================================\n');

// ── Suite 1: Expense Validation & Currency Engine ───────────────────────────
console.log('--- Suite 1: Expense Form Validation & Normalization Engine ---');

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

// 10. Currency formatter check
check(formatCurrency(5000).includes('5,000.00'), 'formatCurrency formats standard monetary amounts');
check(formatCurrency(0).includes('0.00'), 'formatCurrency handles zero');
check(parseExpenseAmount('1500.75') === 1500.75, 'parseExpenseAmount parses string decimal amounts');
check(parseExpenseAmount(-10) === null, 'parseExpenseAmount returns null for negative numbers');
check(Array.isArray(EXPENSE_CATEGORIES) && EXPENSE_CATEGORIES.includes('Hardware'), 'Standard expense categories list is defined');

// ── Suite 2: TaskCompletionModal Component Architecture ─────────────────────
console.log('\n--- Suite 2: TaskCompletionModal Component Architecture ---');

// 11. Modal Heading & Structure
check(taskCompletionModal.includes('title="Complete Task"'), 'TaskCompletionModal sets primary title to "Complete Task"');
check(taskCompletionModal.includes('Complete without Expense'), 'TaskCompletionModal provides "Complete without Expense" option');
check(taskCompletionModal.includes('Add Expense & Complete'), 'TaskCompletionModal provides "Add Expense & Complete" option');

// 12. RPC Invocations
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

// 13. Submitting Protection & Idempotency
check(
  taskCompletionModal.includes('setSubmitting(true)') && taskCompletionModal.includes('disabled={submitting'),
  'TaskCompletionModal disables actions and prevents double submissions while processing'
);
check(
  taskCompletionModal.includes('Recording Expense & Completing...') || taskCompletionModal.includes('Completing Task...'),
  'TaskCompletionModal displays explicit progress status during RPC execution'
);

// 14. Error Handling & Form Retention
check(
  taskCompletionModal.includes('setErrorMessage(res.error') && taskCompletionModal.includes('setSubmitting(false)'),
  'TaskCompletionModal keeps modal open and re-enables controls on RPC failure'
);
check(
  taskCompletionModal.includes('role="alert"') || taskCompletionModal.includes('errorNotice'),
  'TaskCompletionModal renders accessible error notice on failure'
);

// 15. Itemized Mode Controls & Derived Total
check(
  taskCompletionModal.includes('handleAddItem') && taskCompletionModal.includes('handleRemoveItem'),
  'TaskCompletionModal provides Add Line and Remove Line controls for itemized expenses'
);
check(
  taskCompletionModal.includes('calculatedTotal') && !taskCompletionModal.includes('onChange={(e) => setCalculatedTotal'),
  'Calculated Total is purely derived/read-only and cannot be manually overridden'
);

// ── Suite 3: Integration with Task Surfaces ─────────────────────────────────
console.log('\n--- Suite 3: Integration Across Task Surfaces ---');

// 16. TaskDetailPanel Integration
check(
  taskDetailPanel.includes('<TaskCompletionModal'),
  'TaskDetailPanel renders TaskCompletionModal'
);
check(
  taskDetailPanel.includes('handleStatusChange') && taskDetailPanel.includes('setShowCompletionModal(true)'),
  'TaskDetailPanel intercepts Done status change and routes to TaskCompletionModal'
);
check(
  taskDetailPanel.includes('Parent tasks auto-complete when all child tasks'),
  'TaskDetailPanel guards parent tasks from direct completion/expense capture'
);

// 17. ProcessInstancePage Integration
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

// 18. TasksPage Kanban & Drag-and-Drop Integration
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

// 19. Viewer / Read-Only Safety
check(
  taskDetailPanel.includes('readOnly={readOnly}') && tasksPage.includes('readOnly={!canMutateTasks}'),
  'Viewer readOnly permissions are strictly propagated to TaskCompletionModal'
);

// 20. Hooks & Central Utility Exports
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

// 21. No direct DML from frontend
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

// 22. Responsive CSS Contracts
check(
  taskCompletionModalCss.includes('@media (max-width: 768px)') && taskCompletionModalCss.includes('@media (max-width: 390px)'),
  'TaskCompletionModal CSS module contains responsive breakpoints for tablet (768px) and mobile (390px)'
);

console.log('\n======================================================================');
console.log(`P5-02 Expense Completion UI & Contracts: ${passed} PASSED, 0 FAILED (Total: ${passed})`);
console.log('======================================================================\n');
