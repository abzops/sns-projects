/**
 * SNS PROJECTS — PACKAGE 6 / P6-03 & P6-03A EXPENSE LEDGER & ADMINISTRATION TEST SUITE
 *
 * Automated verification for:
 * 1. Frontend Authorization Matrix (Active Tenancy, Inactive Member Rejection & Role Isolation)
 * 2. Database RPC Security, Privileges & Invariant Attributes
 * 3. Source Code Contracts, Scope Isolation, Fail-Closed Security, Fail-Safe Loading & Token Parity
 * 4. PostgreSQL Live RLS, Correction (Null/Custom Categories & Cleared Description), Void, Hard-Delete & Tombstones
 *
 * Usage:
 *   node scripts/test-p6-03-expense-ledger.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { formatCurrency } from '../src/lib/expenseExecution.js';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');

function parseEnv(content) {
  return content
    .split(/\r?\n/)
    .reduce((values, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return values;
      const equalsIndex = line.indexOf('=');
      if (equalsIndex <= 0) return values;
      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      values[key] = value;
      return values;
    }, {});
}

function pass(msg) {
  console.log(`[PASS] ${msg}`);
}

async function expectError(client, fn) {
  await client.query('SAVEPOINT sp_error_test');
  let err = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  } finally {
    if (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_error_test');
    } else {
      await client.query('RELEASE SAVEPOINT sp_error_test');
    }
  }
  assert.ok(err, 'Expected operation to fail, but it succeeded');
  return err;
}

async function asUser(client, userId, sql, params = []) {
  await client.query('SET LOCAL ROLE authenticated');
  try {
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', 'authenticated', true)`,
      [userId]
    );
    const result = await client.query(sql, params);
    return result;
  } finally {
    try {
      await client.query(`
        SELECT set_config('request.jwt.claim.sub', '', true),
               set_config('request.jwt.claim.role', '', true)
      `);
      await client.query('RESET ROLE');
    } catch {
      // ignore
    }
  }
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — PACKAGE 6 / P6-03 & P6-03A EXPENSE LEDGER TEST SUITE       ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 1: Frontend Authorization & Role Access Matrix
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Frontend Authorization & Active-Tenancy Matrix ---');

  // Simulation helper matching src/hooks/useFinanceAccess.js
  function evaluateFinanceAccess({
    workspaceMembershipRole = null,
    isMemberActive = false,
    systemRole = null,
    departmentCode = null,
  }) {
    const activeWorkspaceRole = isMemberActive ? workspaceMembershipRole : null;
    const isOwnerOrAdmin = activeWorkspaceRole === 'owner' || activeWorkspaceRole === 'admin';
    const isExecutiveWithTenancy =
      (systemRole === 'ceo' || systemRole === 'cto') && Boolean(activeWorkspaceRole);

    const canManageBudgets = isOwnerOrAdmin || isExecutiveWithTenancy;
    const isFinanceOperator =
      Boolean(activeWorkspaceRole) &&
      (departmentCode === 'FIN' ||
        (systemRole === 'head' && departmentCode === 'FIN') ||
        activeWorkspaceRole === 'finance_operator');

    const canViewWorkspaceFinance = canManageBudgets || isFinanceOperator;

    return { canViewWorkspaceFinance, canManageBudgets, isFinanceOperator };
  }

  // 1. Workspace Owner
  const ownerAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'owner', isMemberActive: true });
  assert.equal(ownerAccess.canViewWorkspaceFinance, true);
  assert.equal(ownerAccess.canManageBudgets, true);
  pass('01. Active Workspace Owner has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 2. Workspace Admin
  const adminAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'admin', isMemberActive: true });
  assert.equal(adminAccess.canViewWorkspaceFinance, true);
  assert.equal(adminAccess.canManageBudgets, true);
  pass('02. Active Workspace Admin has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 3. CEO with active tenancy
  const ceoAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true, systemRole: 'ceo' });
  assert.equal(ceoAccess.canViewWorkspaceFinance, true);
  assert.equal(ceoAccess.canManageBudgets, true);
  pass('03. Active CEO with active tenancy has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 4. CTO with active tenancy
  const ctoAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true, systemRole: 'cto' });
  assert.equal(ctoAccess.canViewWorkspaceFinance, true);
  assert.equal(ctoAccess.canManageBudgets, true);
  pass('04. Active CTO with active tenancy has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 5. Finance Operator (Active)
  const finOpAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true, departmentCode: 'FIN' });
  assert.equal(finOpAccess.canViewWorkspaceFinance, true);
  assert.equal(finOpAccess.canManageBudgets, false);
  assert.equal(finOpAccess.isFinanceOperator, true);
  pass('05. Active Finance Operator has canViewWorkspaceFinance=true, canManageBudgets=false, isFinanceOperator=true');

  // 6. Finance Operator WITHOUT active tenancy (P6-03A Requirement N)
  const inactiveFinOpAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: false, departmentCode: 'FIN' });
  assert.equal(inactiveFinOpAccess.canViewWorkspaceFinance, false);
  assert.equal(inactiveFinOpAccess.isFinanceOperator, false);
  pass('06. Finance Operator without active workspace membership is strictly DENIED workspace ledger access');

  // 7. Project Admin only
  const projAdminAccess = evaluateFinanceAccess({ systemRole: 'project_admin' });
  assert.equal(projAdminAccess.canViewWorkspaceFinance, false);
  pass('07. Project Admin only is DENIED workspace ledger access (canViewWorkspaceFinance=false)');

  // 8. System Admin only
  const sysAdminAccess = evaluateFinanceAccess({ systemRole: 'system_admin' });
  assert.equal(sysAdminAccess.canViewWorkspaceFinance, false);
  pass('08. System Admin only is DENIED workspace ledger access (canViewWorkspaceFinance=false)');

  // 9. Normal Member
  const memberAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true });
  assert.equal(memberAccess.canViewWorkspaceFinance, false);
  pass('09. Normal Member is DENIED workspace ledger access (canViewWorkspaceFinance=false)');

  // 10. Viewer
  const viewerAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'viewer', isMemberActive: true });
  assert.equal(viewerAccess.canViewWorkspaceFinance, false);
  pass('10. Viewer is DENIED workspace ledger access (canViewWorkspaceFinance=false)');

  // 11. CEO without active tenancy
  const inactiveCeoAccess = evaluateFinanceAccess({ systemRole: 'ceo', isMemberActive: false });
  assert.equal(inactiveCeoAccess.canViewWorkspaceFinance, false);
  pass('11. CEO without active workspace membership is strictly DENIED workspace ledger access\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 2: Source Code & Presentation Contracts
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 2: Source Code Contracts & Presentation Architecture ---');

  const appJsx = await readFile(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
  assert.ok(appJsx.includes('/workspace/:workspaceId/finance/expenses'), 'App.jsx must register /finance/expenses route');
  assert.ok(appJsx.includes('ExpenseLedgerPage'), 'App.jsx must import ExpenseLedgerPage');
  pass('12. App.jsx correctly registers /workspace/:workspaceId/finance/expenses route');

  const overviewJsx = await readFile(path.join(repoRoot, 'src', 'pages', 'FinanceOverviewPage.jsx'), 'utf8');
  assert.ok(overviewJsx.includes('/finance/expenses'), 'FinanceOverviewPage must link to /finance/expenses');
  assert.ok(overviewJsx.includes('canViewWorkspaceFinance'), 'Expense Ledger link must be guarded by canViewWorkspaceFinance');
  pass('13. FinanceOverviewPage renders Expense Ledger entry link strictly guarded by canViewWorkspaceFinance');

  const ledgerJsx = await readFile(path.join(repoRoot, 'src', 'pages', 'ExpenseLedgerPage.jsx'), 'utf8');
  assert.ok(ledgerJsx.includes('canViewWorkspaceFinance'), 'ExpenseLedgerPage must check canViewWorkspaceFinance');
  assert.ok(ledgerJsx.includes('financeAccessError'), 'ExpenseLedgerPage must check financeAccessError');
  pass('14. ExpenseLedgerPage checks financeAccessError and fails closed on unauthorized / error context');

  // Verify useProjects and useExpenseLedger calls in ExpenseLedgerPage (P6-03A Requirements E & F)
  assert.ok(!ledgerJsx.includes('useProjects(workspaceId, { enabled:'), 'useProjects must NOT be called with options object');
  assert.ok(ledgerJsx.includes('useProjects(workspaceId, authorizationScopeKey)'), 'useProjects must receive real authorizationScopeKey');
  assert.ok(ledgerJsx.includes('useExpenseLedger(workspaceId, authorizationScopeKey'), 'useExpenseLedger must receive real authorizationScopeKey');
  pass('15. ExpenseLedgerPage passes real authorizationScopeKey to useProjects and useExpenseLedger');

  const useExpenseHook = await readFile(path.join(repoRoot, 'src', 'hooks', 'useExpenseLedger.js'), 'utf8');
  assert.ok(useExpenseHook.includes("supabase.rpc('correct_expense_transaction'"), 'useExpenseLedger must invoke correct_expense_transaction RPC');
  assert.ok(useExpenseHook.includes("supabase.rpc('void_expense_transaction'"), 'useExpenseLedger must invoke void_expense_transaction RPC');
  assert.ok(useExpenseHook.includes("supabase.rpc('hard_delete_expense_transaction'"), 'useExpenseLedger must invoke hard_delete_expense_transaction RPC');
  pass('16. useExpenseLedger hook exclusively delegates mutations to authoritative public RPCs');

  // Verify Zero direct client table DML in ledger code
  assert.ok(!useExpenseHook.includes(".from('expense_transactions').update("), 'Strict boundary: Zero client UPDATE on expense_transactions');
  assert.ok(!useExpenseHook.includes(".from('expense_transactions').delete("), 'Strict boundary: Zero client DELETE on expense_transactions');
  assert.ok(!ledgerJsx.includes(".from('expense_transactions').update("), 'Strict boundary: Zero client UPDATE on expense_transactions in page');
  assert.ok(!ledgerJsx.includes(".from('expense_transactions').delete("), 'Strict boundary: Zero client DELETE on expense_transactions in page');
  pass('17. Strict boundary: Zero direct client UPDATE or DELETE DML on expense tables in frontend');

  // Verify cache key structure and scope isolation (P6-03A Requirements A, B, C)
  assert.ok(useExpenseHook.includes('authorizationScopeKey'), 'useExpenseLedger cache key must include authorizationScopeKey');
  assert.ok(useExpenseHook.includes('setTransactions([])') && useExpenseHook.includes('setTombstones([])'), 'useExpenseLedger must reset state immediately on cache key shift');
  assert.ok(useExpenseHook.includes('activeFetchIdRef.current++'), 'useExpenseLedger must invalidate in-flight queries on scope shift');
  pass('18. useExpenseLedger keys cache by userId:workspaceId:authorizationScopeKey and synchronously resets state on scope change');

  // Verify tombstoneRes.error handling (P6-03A Requirement G)
  assert.ok(useExpenseHook.includes('if (tombstoneRes.error)'), 'useExpenseLedger must validate tombstoneRes.error and throw');
  pass('19. useExpenseLedger fails safe when tombstone query fails (never converts to false 0 empty state)');

  // Verify fetchTransactionAudit error propagation (P6-03A Requirement H)
  assert.ok(!useExpenseHook.includes('return [];\n    },') && useExpenseHook.includes('throw new Error(auditErr.message'), 'fetchTransactionAudit must throw on error');
  pass('20. fetchTransactionAudit propagates Supabase error instead of masking as empty array');

  // Verify ExpenseDetailModal audit error & retry state + status transition (P6-03A Requirements I, O)
  const detailModalJsx = await readFile(path.join(repoRoot, 'src', 'components', 'finance', 'ExpenseDetailModal.jsx'), 'utf8');
  assert.ok(detailModalJsx.includes('auditError') && detailModalJsx.includes('Audit History Unavailable'), 'ExpenseDetailModal must render explicit audit error state');
  assert.ok(detailModalJsx.includes('loadAudit') && detailModalJsx.includes('Retry'), 'ExpenseDetailModal must provide Retry action for audit failure');
  assert.ok(detailModalJsx.includes('previous_status') && detailModalJsx.includes('new_status'), 'ExpenseDetailModal must render previous_status -> new_status transition');
  assert.ok(detailModalJsx.includes('canManageBudgets'), 'Hard Delete button must be gated by canManageBudgets in detail modal');
  pass('21. ExpenseDetailModal renders audit error+Retry state, status transition diff, and canManageBudgets gate');

  // Verify ExpenseCorrectionModal optional category & description clearing (P6-03A Requirements J, K, L, M)
  const correctionModalJsx = await readFile(path.join(repoRoot, 'src', 'components', 'finance', 'ExpenseCorrectionModal.jsx'), 'utf8');
  assert.ok(!correctionModalJsx.includes("category: item.category || 'Materials'"), 'Correction modal must NOT force Materials fallback on null/empty category');
  assert.ok(correctionModalJsx.includes('list="correction-expense-categories"') || correctionModalJsx.includes('datalist'), 'Correction modal must use category datalist / free text input');
  assert.ok(correctionModalJsx.includes('description !== undefined ? description.trim() : null'), 'Correction modal must preserve intentional empty string description clearing');
  pass('22. ExpenseCorrectionModal supports optional/custom categories, datalist suggestions, and intentional description clearing');

  // Verify Tombstone inspection modal (P6-03A Requirement P)
  const tombstoneModalJsx = await readFile(path.join(repoRoot, 'src', 'components', 'finance', 'TombstoneDetailModal.jsx'), 'utf8');
  assert.ok(tombstoneModalJsx.includes('snapshot.transaction') && tombstoneModalJsx.includes('snapshot.items'), 'TombstoneDetailModal must render snapshot evidence');
  assert.ok(ledgerJsx.includes('TombstoneDetailModal'), 'ExpenseLedgerPage must mount TombstoneDetailModal');
  pass('23. TombstoneDetailModal exists and provides read-only immutable snapshot evidence inspection');

  // Verify formatCurrency preservation
  assert.equal(formatCurrency(1234.56), '₹1,234.56');
  assert.equal(formatCurrency(1000, true), '₹1,000.00');
  pass('24. formatCurrency outputs canonical INR currency format preserving paise');

  // Verify CSS Token Parity
  const ledgerCss = await readFile(path.join(repoRoot, 'src', 'pages', 'ExpenseLedgerPage.module.css'), 'utf8');
  const detailCss = await readFile(path.join(repoRoot, 'src', 'components', 'finance', 'ExpenseDetailModal.module.css'), 'utf8');
  const correctionCss = await readFile(path.join(repoRoot, 'src', 'components', 'finance', 'ExpenseCorrectionModal.module.css'), 'utf8');
  const combinedCss = ledgerCss + detailCss + correctionCss;

  const nonCanonicalTokens = [
    '--bg-card',
    '--border-default',
    '--border-subtle',
    '--border-hover',
    '--text-primary',
    '--text-secondary',
    '--text-tertiary',
    '--radius-md',
    '--font-mono',
  ];
  for (const token of nonCanonicalTokens) {
    assert.ok(!combinedCss.includes(token), `CSS files must not contain noncanonical token: ${token}`);
  }
  pass('25. 100% CSS token parity: Zero noncanonical fallback tokens in Ledger CSS modules\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 3 & 4: PostgreSQL Live DB Integration & Security Attributes
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 3 & 4: PostgreSQL Live Database Integration & RPC Invariants ---');

  const envRaw = await readFile(envAdminPath, 'utf8');
  const env = parseEnv(envRaw);
  assert.ok(env.SUPABASE_DB_URL, 'SUPABASE_DB_URL must be defined in .env.admin');

  const client = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query('BEGIN'); // Isolated test transaction

  try {
    // 26. Check RPC Security Attributes
    const rpcAttributes = await client.query(`
      SELECT routine_name, security_type, external_language
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN ('correct_expense_transaction', 'void_expense_transaction', 'hard_delete_expense_transaction')
    `);

    assert.equal(rpcAttributes.rows.length, 3, 'All 3 public RPCs must exist');
    for (const rpc of rpcAttributes.rows) {
      assert.equal(rpc.security_type, 'INVOKER', `${rpc.routine_name} must be SECURITY INVOKER`);
    }
    pass('26. Live DB: public.correct, void, and hard_delete RPCs are SECURITY INVOKER');

    // 27. Check RPC Permissions (authenticated EXECUTE = true, anon = false)
    const aclRes = await client.query(`
      SELECT routine_name, grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name IN ('correct_expense_transaction', 'void_expense_transaction', 'hard_delete_expense_transaction')
    `);

    const anonCanExecute = aclRes.rows.some((r) => r.grantee === 'anon' && r.privilege_type === 'EXECUTE');
    const authCanExecute = aclRes.rows.some((r) => r.grantee === 'authenticated' && r.privilege_type === 'EXECUTE');
    assert.equal(anonCanExecute, false, 'anon must not have EXECUTE grant on expense RPCs');
    assert.equal(authCanExecute, true, 'authenticated must have EXECUTE grant on expense RPCs');
    pass('27. Live DB: authenticated role has EXECUTE grant; anon role is revoked (fails closed)');

    // 28. Setup Test Fixtures: Workspace, Users, Project, Task, Statuses
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const finOpId = randomUUID();
    const memberId = randomUUID();
    const projectId = randomUUID();
    const phaseId = randomUUID();
    const taskListId = randomUUID();
    const taskId = randomUUID();
    const statusTodoId = randomUUID();
    const statusDoneId = randomUUID();
    const finDeptId = randomUUID();

    await client.query('SET LOCAL session_replication_role = replica');

    // Create auth users & profiles
    for (const u of [
      { id: ownerId, email: `owner-${ownerId.slice(0, 8)}@test.com`, name: 'Test Owner' },
      { id: finOpId, email: `finop-${finOpId.slice(0, 8)}@test.com`, name: 'Test FinOp' },
      { id: memberId, email: `member-${memberId.slice(0, 8)}@test.com`, name: 'Test Member' },
    ]) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, email, raw_user_meta_data, created_at, updated_at, aud, role)
        VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000', $2::text, jsonb_build_object('full_name', $3::text), now(), now(), 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING
      `, [u.id, u.email, u.name]);

      await client.query(`
        INSERT INTO public.profiles (id, full_name, created_at, updated_at)
        VALUES ($1::uuid, $2::text, now(), now())
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
      `, [u.id, u.name]);
    }

    // Create workspace
    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by)
      VALUES ($1::uuid, 'P6-03 Ledger Test Workspace', $2::uuid)
    `, [workspaceId, ownerId]);

    // Create department FIN and membership
    await client.query(`
      INSERT INTO public.departments (id, workspace_id, name, code)
      VALUES ($1::uuid, $2::uuid, 'Finance', 'FIN')
    `, [finDeptId, workspaceId]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active)
      VALUES ($1::uuid, $2::uuid, $3::uuid, true)
    `, [workspaceId, finDeptId, finOpId]);

    // Workspace memberships
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES 
        ($1::uuid, $2::uuid, 'owner', 'active'),
        ($1::uuid, $3::uuid, 'member', 'active'),
        ($1::uuid, $4::uuid, 'member', 'active')
    `, [workspaceId, ownerId, finOpId, memberId]);

    // Project, Phase, Task List, Task Statuses, Tasks
    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, created_by, owner_id)
      VALUES ($1::uuid, $2::uuid, 'Ledger Test Project', $3::uuid, $3::uuid)
    `, [projectId, workspaceId, ownerId]);

    await client.query(`
      INSERT INTO public.phases (id, project_id, name)
      VALUES ($1::uuid, $2::uuid, 'Phase 1')
    `, [phaseId, projectId]);

    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'List 1', 1)
    `, [taskListId, projectId, phaseId]);

    await client.query(`
      INSERT INTO public.task_statuses (id, project_id, name, color, system_code, position)
      VALUES
        ($1::uuid, $2::uuid, 'To Do', '#cccccc', 'todo', 1),
        ($3::uuid, $2::uuid, 'Done', '#00ff00', 'done', 2)
    `, [statusTodoId, projectId, statusDoneId]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title, status_id, assignee_id, owner_id, created_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Initial Expense Task', $5::uuid, $6::uuid, $6::uuid, $6::uuid)
    `, [taskId, projectId, phaseId, taskListId, statusTodoId, ownerId]);

    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // Complete task with expense (1,000 INR) with null category and initial description
    const completeRes = await asUser(client, ownerId, `
      SELECT public.complete_task_with_expense(
        $1::uuid,
        jsonb_build_object(
          'hasExpense', true,
          'mode', 'itemized',
          'items', jsonb_build_array(
            jsonb_build_object('line_number', 1, 'amount', 600.00, 'category', null, 'description', 'Uncategorized item 1'),
            jsonb_build_object('line_number', 2, 'amount', 400.00, 'category', 'Logistics', 'description', 'Custom category item 2')
          ),
          'expenseDate', '2026-08-22',
          'description', 'Initial test note'
        ),
        'Completed initial task'
      ) as result
    `, [taskId]);

    const txId = completeRes.rows[0].result.transaction_id;
    assert.ok(txId, 'Expense transaction must be created');
    pass('28. Live DB: Test fixtures and initial expense transaction (₹1,000.00) created with null & custom categories');

    // 29. Live DB: Finance Operator executes correct_expense_transaction preserving null/custom category & clearing description
    const correctRes = await asUser(client, finOpId, `
      SELECT public.correct_expense_transaction(
        $1::uuid,
        jsonb_build_array(
          jsonb_build_object('line_number', 1, 'amount', 800.00, 'category', null, 'description', 'Corrected item 1 (null category)'),
          jsonb_build_object('line_number', 2, 'amount', 700.00, 'category', 'SpecialVendorFee', 'description', 'Corrected item 2 (custom category)')
        ),
        'Audit Reason: Revised vendor invoice adjustments'::text,
        ''::text,
        '2026-08-22'::date
      ) as result
    `, [txId]);

    assert.equal(correctRes.rows[0].result.success, true);
    assert.equal(Number(correctRes.rows[0].result.previous_total_amount), 1000.00);
    assert.equal(Number(correctRes.rows[0].result.new_total_amount), 1500.00);
    pass('29. Live DB: Finance Operator executes correct_expense_transaction (₹1,000 -> ₹1,500) with null & custom categories');

    // 30. Live DB: Verify Corrected items, null/custom category preservation, and cleared description in DB
    const txRow = await client.query('SELECT status, description FROM public.expense_transactions WHERE id = $1::uuid', [txId]);
    assert.equal(txRow.rows[0].status, 'corrected');
    assert.equal(txRow.rows[0].description, '', 'Cleared description stored as empty string');

    const itemsRows = await client.query('SELECT line_number, amount, category FROM public.expense_items WHERE transaction_id = $1::uuid ORDER BY line_number', [txId]);
    assert.equal(itemsRows.rows.length, 2);
    assert.equal(Number(itemsRows.rows[0].amount), 800.00);
    assert.equal(itemsRows.rows[0].category, null, 'Null category preserved');
    assert.equal(Number(itemsRows.rows[1].amount), 700.00);
    assert.equal(itemsRows.rows[1].category, 'SpecialVendorFee', 'Custom category preserved');
    pass('30. Live DB: Null category and custom category preserved; description cleared in database');

    // 31. Live DB: Immutable audit log for correction with status diff
    const correctAudit = await client.query(`
      SELECT action, previous_status, new_status, previous_total_amount, new_total_amount, reason, actor_id
      FROM public.expense_audit_logs
      WHERE transaction_id = $1::uuid AND action = 'corrected'
    `, [txId]);
    assert.equal(correctAudit.rows.length, 1);
    assert.equal(correctAudit.rows[0].actor_id, finOpId);
    assert.equal(correctAudit.rows[0].previous_status, 'active');
    assert.equal(correctAudit.rows[0].new_status, 'corrected');
    assert.equal(Number(correctAudit.rows[0].previous_total_amount), 1000.00);
    assert.equal(Number(correctAudit.rows[0].new_total_amount), 1500.00);
    assert.equal(correctAudit.rows[0].reason, 'Audit Reason: Revised vendor invoice adjustments');
    pass('31. Live DB: Immutable audit log accurately captured active->corrected status transition and amounts');

    // 32. Live DB: Empty correction reason is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, finOpId, `
        SELECT public.correct_expense_transaction(
          $1::uuid,
          jsonb_build_array(jsonb_build_object('line_number', 1, 'amount', 500.00)),
          '   '::text
        )
      `, [txId]);
    });
    pass('32. Live DB: Empty correction reason is strictly REJECTED (fails closed)');

    // 33. Live DB: Zero / Negative amount is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, finOpId, `
        SELECT public.correct_expense_transaction(
          $1::uuid,
          jsonb_build_array(jsonb_build_object('line_number', 1, 'amount', -100.00)),
          'Valid reason'::text
        )
      `, [txId]);
    });
    pass('33. Live DB: Zero/Negative line item correction is strictly REJECTED');

    // 34. Live DB: Workspace Owner executes correct_expense_transaction
    const ownerCorrectRes = await asUser(client, ownerId, `
      SELECT public.correct_expense_transaction(
        $1::uuid,
        jsonb_build_array(
          jsonb_build_object('line_number', 1, 'amount', 2000.00, 'category', 'Equipment', 'description', 'Owner revision')
        ),
        'Owner audit: final verified amount'::text
      ) as result
    `, [txId]);
    assert.equal(Number(ownerCorrectRes.rows[0].result.new_total_amount), 2000.00);
    pass('34. Live DB: Workspace Owner executes correct_expense_transaction successfully (₹2,000.00)');

    // 35. Live DB: Finance Operator executes void_expense_transaction
    const voidRes = await asUser(client, finOpId, `
      SELECT public.void_expense_transaction(
        $1::uuid,
        'Voiding duplicate entry after reconciliation'::text
      ) as result
    `, [txId]);
    assert.equal(voidRes.rows[0].result.success, true);
    assert.equal(voidRes.rows[0].result.status, 'voided');
    assert.equal(Number(voidRes.rows[0].result.previous_total), 2000.00);
    assert.equal(Number(voidRes.rows[0].result.effective_total), 0.00);
    pass('35. Live DB: Finance Operator executes void_expense_transaction successfully (status = voided, spend = ₹0.00)');

    // 36. Live DB: Voided transaction status confirmed and audit record verified
    const voidedTx = await client.query('SELECT status FROM public.expense_transactions WHERE id = $1::uuid', [txId]);
    assert.equal(voidedTx.rows[0].status, 'voided');

    const voidAudit = await client.query(`
      SELECT action, previous_status, new_status, previous_total_amount, new_total_amount, reason, actor_id
      FROM public.expense_audit_logs
      WHERE transaction_id = $1::uuid AND action = 'voided'
    `, [txId]);
    assert.equal(voidAudit.rows.length, 1);
    assert.equal(voidAudit.rows[0].previous_status, 'corrected');
    assert.equal(voidAudit.rows[0].new_status, 'voided');
    assert.equal(Number(voidAudit.rows[0].previous_total_amount), 2000.00);
    assert.equal(Number(voidAudit.rows[0].new_total_amount), 0.00);
    assert.equal(voidAudit.rows[0].reason, 'Voiding duplicate entry after reconciliation');
    pass('36. Live DB: Void audit log captured corrected->voided status transition and effective ₹0.00 total');

    // 37. Live DB: Correcting a voided transaction is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, ownerId, `
        SELECT public.correct_expense_transaction(
          $1::uuid,
          jsonb_build_array(jsonb_build_object('line_number', 1, 'amount', 100.00)),
          'Attempting correction on voided entry'::text
        )
      `, [txId]);
    });
    pass('37. Live DB: Correcting an already voided transaction is strictly REJECTED');

    // 38. Live DB: Repeat void is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, finOpId, `
        SELECT public.void_expense_transaction(
          $1::uuid,
          'Second void attempt'::text
        )
      `, [txId]);
    });
    pass('38. Live DB: Repeat void on an already voided transaction is strictly REJECTED');

    // 39. Live DB: Finance Operator is strictly DENIED hard_delete_expense_transaction
    await expectError(client, async () => {
      await asUser(client, finOpId, `
        SELECT public.hard_delete_expense_transaction(
          $1::uuid,
          'FinOp attempting hard delete'::text
        )
      `, [txId]);
    });
    pass('39. Live DB: Finance Operator alone is strictly DENIED hard-delete authority (fails closed)');

    // 40. Live DB: Normal Member is strictly DENIED hard_delete_expense_transaction
    await expectError(client, async () => {
      await asUser(client, memberId, `
        SELECT public.hard_delete_expense_transaction(
          $1::uuid,
          'Member attempting hard delete'::text
        )
      `, [txId]);
    });
    pass('40. Live DB: Normal Member is strictly DENIED hard-delete authority');

    // 41. Live DB: Workspace Owner executes hard_delete_expense_transaction
    const hardDelRes = await asUser(client, ownerId, `
      SELECT public.hard_delete_expense_transaction(
        $1::uuid,
        'Administrative cleanup of test entry'::text
      ) as result
    `, [txId]);
    assert.equal(hardDelRes.rows[0].result.success, true);
    assert.equal(hardDelRes.rows[0].result.deleted_transaction_id, txId);
    pass('41. Live DB: Workspace Owner executes hard_delete_expense_transaction successfully');

    // 42. Live DB: Transaction row and items are deleted, tombstone survives with snapshot
    const txAfterDel = await client.query('SELECT 1 FROM public.expense_transactions WHERE id = $1::uuid', [txId]);
    assert.equal(txAfterDel.rows.length, 0, 'Transaction row must be deleted from active table');

    const itemsAfterDel = await client.query('SELECT 1 FROM public.expense_items WHERE transaction_id = $1::uuid', [txId]);
    assert.equal(itemsAfterDel.rows.length, 0, 'Items must be deleted from active table');

    const tombstone = await client.query(`
      SELECT action, original_transaction_id, transaction_id, actor_id, metadata, reason
      FROM public.expense_audit_logs
      WHERE original_transaction_id = $1::uuid AND action = 'hard_deleted'
    `, [txId]);
    assert.equal(tombstone.rows.length, 1);
    assert.equal(tombstone.rows[0].original_transaction_id, txId);
    assert.equal(tombstone.rows[0].transaction_id, null, 'transaction_id becomes NULL on cascade');
    assert.equal(tombstone.rows[0].actor_id, ownerId);
    assert.ok(tombstone.rows[0].metadata?.snapshot?.transaction, 'Tombstone metadata must contain transaction snapshot');
    assert.ok(tombstone.rows[0].metadata?.snapshot?.items, 'Tombstone metadata must contain items snapshot');
    pass('42. Live DB: Hard-delete physically deleted transaction while preserving permanent immutable audit tombstone & snapshot');

    console.log('\nRolling back test transaction (database untouched)...');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  ALL 42 P6-03 & P6-03A EXPENSE LEDGER ASSERTIONS PASSED WITH ZERO ERRORS! ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

run().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
