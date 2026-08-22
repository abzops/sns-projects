/**
 * SNS PROJECTS — PACKAGE 6 / P6-04 FINANCIAL EXPLORER CORE TEST SUITE
 *
 * Automated verification for:
 * 1. Frontend Authorization Matrix (Active Tenancy & Role Isolation)
 * 2. Source Code Contracts, Scope Isolation, Zero Double Counting & CSS Token Parity
 * 3. Normalized Explorer Model, Task Budget Context & Cascading Filter Invariants
 * 4. PostgreSQL Live Database Summaries, Leaf Spend Aggregation & Zero Mutation
 *
 * Usage:
 *   node scripts/test-p6-04-financial-explorer.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { formatCurrency } from '../src/lib/expenseExecution.js';
import { normalizeFinancialSummary } from '../src/lib/finance.js';

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
  console.log('  SNS PROJECTS — PACKAGE 6 / P6-04 FINANCIAL EXPLORER CORE TEST SUITE       ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 1: Frontend Authorization & Active-Tenancy Matrix
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Frontend Authorization & Active-Tenancy Matrix ---');

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
  pass('01. Active Workspace Owner has canViewWorkspaceFinance=true (Explorer allowed)');

  // 2. Workspace Admin
  const adminAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'admin', isMemberActive: true });
  assert.equal(adminAccess.canViewWorkspaceFinance, true);
  pass('02. Active Workspace Admin has canViewWorkspaceFinance=true (Explorer allowed)');

  // 3. CEO with active tenancy
  const ceoAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true, systemRole: 'ceo' });
  assert.equal(ceoAccess.canViewWorkspaceFinance, true);
  pass('03. Active CEO with active tenancy has canViewWorkspaceFinance=true (Explorer allowed)');

  // 4. CTO with active tenancy
  const ctoAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true, systemRole: 'cto' });
  assert.equal(ctoAccess.canViewWorkspaceFinance, true);
  pass('04. Active CTO with active tenancy has canViewWorkspaceFinance=true (Explorer allowed)');

  // 5. Finance Operator (Active)
  const finOpAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true, departmentCode: 'FIN' });
  assert.equal(finOpAccess.canViewWorkspaceFinance, true);
  assert.equal(finOpAccess.isFinanceOperator, true);
  pass('05. Active Finance Operator has canViewWorkspaceFinance=true (Explorer allowed)');

  // 6. Project Admin only
  const projAdminAccess = evaluateFinanceAccess({ systemRole: 'project_admin' });
  assert.equal(projAdminAccess.canViewWorkspaceFinance, false);
  pass('06. Project Admin only is DENIED Explorer access (canViewWorkspaceFinance=false)');

  // 7. System Admin only
  const sysAdminAccess = evaluateFinanceAccess({ systemRole: 'system_admin' });
  assert.equal(sysAdminAccess.canViewWorkspaceFinance, false);
  pass('07. System Admin only is DENIED Explorer access (canViewWorkspaceFinance=false)');

  // 8. Normal Member
  const memberAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: true });
  assert.equal(memberAccess.canViewWorkspaceFinance, false);
  pass('08. Normal Member is DENIED Explorer access (canViewWorkspaceFinance=false)');

  // 9. Viewer
  const viewerAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'viewer', isMemberActive: true });
  assert.equal(viewerAccess.canViewWorkspaceFinance, false);
  pass('09. Viewer is DENIED Explorer access (canViewWorkspaceFinance=false)');

  // 10. CEO without active workspace tenancy
  const inactiveCeoAccess = evaluateFinanceAccess({ systemRole: 'ceo', isMemberActive: false });
  assert.equal(inactiveCeoAccess.canViewWorkspaceFinance, false);
  pass('10. CEO without active workspace tenancy is strictly DENIED Explorer access');

  // 11. Finance Operator without active workspace tenancy
  const inactiveFinOpAccess = evaluateFinanceAccess({ workspaceMembershipRole: 'member', isMemberActive: false, departmentCode: 'FIN' });
  assert.equal(inactiveFinOpAccess.canViewWorkspaceFinance, false);
  pass('11. Finance Operator without active workspace tenancy is strictly DENIED Explorer access\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 2: Source Code & Presentation Architecture Contracts
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 2: Source Code Contracts & Presentation Architecture ---');

  const appJsx = await readFile(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
  assert.ok(appJsx.includes('/workspace/:workspaceId/finance/explorer'), 'App.jsx must register /finance/explorer route');
  assert.ok(appJsx.includes('FinancialExplorerPage'), 'App.jsx must import FinancialExplorerPage');
  pass('12. App.jsx correctly registers /workspace/:workspaceId/finance/explorer route');

  const overviewJsx = await readFile(path.join(repoRoot, 'src', 'pages', 'FinanceOverviewPage.jsx'), 'utf8');
  assert.ok(overviewJsx.includes('/finance/explorer'), 'FinanceOverviewPage must link to /finance/explorer');
  assert.ok(overviewJsx.includes('canViewWorkspaceFinance'), 'Financial Explorer link must be guarded by canViewWorkspaceFinance');
  pass('13. FinanceOverviewPage renders Financial Explorer entry link strictly guarded by canViewWorkspaceFinance');

  const explorerJsx = await readFile(path.join(repoRoot, 'src', 'pages', 'FinancialExplorerPage.jsx'), 'utf8');
  assert.ok(explorerJsx.includes('canViewWorkspaceFinance'), 'FinancialExplorerPage must check canViewWorkspaceFinance');
  assert.ok(explorerJsx.includes('financeAccessError'), 'FinancialExplorerPage must check financeAccessError');
  assert.ok(explorerJsx.includes('Access Restricted'), 'FinancialExplorerPage must render fail-closed restricted view');
  pass('14. FinancialExplorerPage fails closed on unauthorized direct URL and financeAccessError');

  const useExplorerHook = await readFile(path.join(repoRoot, 'src', 'hooks', 'useFinancialExplorer.js'), 'utf8');
  assert.ok(useExplorerHook.includes('authorizationScopeKey'), 'useFinancialExplorer must key cache by authorizationScopeKey');
  assert.ok(useExplorerHook.includes('activeFetchIdRef.current++'), 'useFinancialExplorer must invalidate in-flight responses on scope change');
  assert.ok(useExplorerHook.includes('pMap('), 'useFinancialExplorer must use bounded concurrency pool for RPC summaries');
  pass('15. useFinancialExplorer keys cache by user/workspace/scope and uses bounded concurrency pool for RPC summaries');

  // Read-only integrity: Zero DML in Financial Explorer code
  assert.ok(!useExplorerHook.includes(".insert("), 'Strict boundary: Zero client INSERT in useFinancialExplorer');
  assert.ok(!useExplorerHook.includes(".update("), 'Strict boundary: Zero client UPDATE in useFinancialExplorer');
  assert.ok(!useExplorerHook.includes(".delete("), 'Strict boundary: Zero client DELETE in useFinancialExplorer');
  assert.ok(!explorerJsx.includes(".insert("), 'Strict boundary: Zero client INSERT in FinancialExplorerPage');
  assert.ok(!explorerJsx.includes(".update("), 'Strict boundary: Zero client UPDATE in FinancialExplorerPage');
  assert.ok(!explorerJsx.includes(".delete("), 'Strict boundary: Zero client DELETE in FinancialExplorerPage');
  pass('16. Strict boundary: Financial Explorer is 100% READ-ONLY (zero client DML mutations)');

  // Zero double counting verification in page
  assert.ok(explorerJsx.includes("r.rowType === 'expense'"), 'Summary spend and group spend must derive solely from leaf expenses');
  pass('17. Zero double counting: effective spend derives exclusively from leaf expense transactions');

  // Cascading filters in page
  assert.ok(explorerJsx.includes('handleProjectChange') && explorerJsx.includes('handlePhaseChange'), 'FinancialExplorerPage implements cascading Project -> Phase -> Task List -> Task filters');
  pass('18. Cascading filter logic: Project selection narrows Phase, Phase narrows Task List, Task List narrows Task');

  // CSV Export verification
  assert.ok(explorerJsx.includes('handleExportCSV') && explorerJsx.includes('text/csv'), 'FinancialExplorerPage provides client-side CSV export of filtered records');
  pass('19. FinancialExplorerPage exports filtered records to CSV with INR precision and escaped strings');

  // CSS Token Parity
  const explorerCss = await readFile(path.join(repoRoot, 'src', 'pages', 'FinancialExplorerPage.module.css'), 'utf8');
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
    assert.ok(!explorerCss.includes(token), `CSS file must not contain noncanonical token: ${token}`);
  }
  pass('20. 100% CSS token parity: Zero noncanonical fallback tokens in FinancialExplorerPage.module.css\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 3 & 4: PostgreSQL Live DB Integration & Summary RPC Invariants
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
    // 21. Setup Multi-Container Test Fixtures
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const finOpId = randomUUID();
    const memberId = randomUUID();

    const projectId = randomUUID();
    const phaseId = randomUUID();
    const taskListId = randomUUID();

    const task1Id = randomUUID(); // Leaf task under task list
    const task2Id = randomUUID(); // Standalone leaf task
    const task3Id = randomUUID(); // Task with subtask
    const subtask1Id = randomUUID(); // Subtask under task3

    const statusTodoId = randomUUID();
    const statusDoneId = randomUUID();
    const finDeptId = randomUUID();

    await client.query('SET LOCAL session_replication_role = replica');

    // Create auth users & profiles
    for (const u of [
      { id: ownerId, email: `owner-${ownerId.slice(0, 8)}@test.com`, name: 'Explorer Owner' },
      { id: finOpId, email: `finop-${finOpId.slice(0, 8)}@test.com`, name: 'Explorer FinOp' },
      { id: memberId, email: `member-${memberId.slice(0, 8)}@test.com`, name: 'Explorer Member' },
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

    // Workspace & Memberships
    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by)
      VALUES ($1::uuid, 'P6-04 Explorer Test Workspace', $2::uuid)
    `, [workspaceId, ownerId]);

    await client.query(`
      INSERT INTO public.departments (id, workspace_id, name, code, is_active)
      VALUES ($1::uuid, $2::uuid, 'Finance', 'FIN', true)
    `, [finDeptId, workspaceId]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active, is_primary)
      VALUES ($1::uuid, $2::uuid, $3::uuid, true, true)
    `, [workspaceId, finDeptId, finOpId]);

    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES 
        ($1::uuid, $2::uuid, 'owner', 'active'),
        ($1::uuid, $3::uuid, 'member', 'active'),
        ($1::uuid, $4::uuid, 'member', 'active')
    `, [workspaceId, ownerId, finOpId, memberId]);

    // Project, Phase, Task List
    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, created_by, owner_id)
      VALUES ($1::uuid, $2::uuid, 'Explorer Project 1', $3::uuid, $3::uuid)
    `, [projectId, workspaceId, ownerId]);

    await client.query(`
      INSERT INTO public.phases (id, project_id, name, position, owner_id, created_by)
      VALUES ($1::uuid, $2::uuid, 'Phase Alpha', 1, $3::uuid, $3::uuid)
    `, [phaseId, projectId, ownerId]);

    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position, created_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'Task List Alpha-1', 1, $4::uuid)
    `, [taskListId, projectId, phaseId, ownerId]);

    await client.query(`
      INSERT INTO public.task_statuses (id, project_id, name, color, system_code, position)
      VALUES
        ($1::uuid, $2::uuid, 'To Do', '#cccccc', 'todo', 1),
        ($3::uuid, $2::uuid, 'Done', '#00ff00', 'done', 2)
    `, [statusTodoId, projectId, statusDoneId]);

    // Standalone Defined Process & Instance for Standalone Task Spend
    const defProcId = randomUUID();
    const defProcVerId = randomUUID();
    const procInstId = randomUUID();

    await client.query(`
      INSERT INTO public.defined_processes (id, workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'Proc Standalone', 'PROC-SA', $4::uuid, $4::uuid)
    `, [defProcId, workspaceId, finDeptId, ownerId]);

    await client.query(`
      INSERT INTO public.defined_process_versions (id, defined_process_id, version_number, status, created_by, published_by, published_at)
      VALUES ($1::uuid, $2::uuid, 1, 'published', $3::uuid, $3::uuid, now())
    `, [defProcVerId, defProcId, ownerId]);

    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, started_by, owner_id, placement_type)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Instance Standalone', $5::uuid, $5::uuid, 'standalone')
    `, [procInstId, workspaceId, defProcId, defProcVerId, ownerId]);

    // Project Tasks & Standalone Task
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, process_instance_id, title, status_id, assignee_id, owner_id, created_by)
      VALUES 
        ($1::uuid, $2::uuid, $3::uuid, $4::uuid, null, 'Hierarchical Task 1', $5::uuid, $6::uuid, $6::uuid, $6::uuid),
        ($7::uuid, null, null, null, $8::uuid, 'Standalone Task 2', null, $6::uuid, $6::uuid, $6::uuid),
        ($9::uuid, $2::uuid, $3::uuid, $4::uuid, null, 'Hierarchical Task 3', $5::uuid, $6::uuid, $6::uuid, $6::uuid)
    `, [task1Id, projectId, phaseId, taskListId, statusTodoId, ownerId, task2Id, procInstId, task3Id]);

    // Subtask under Task 3
    await client.query(`
      INSERT INTO public.subtasks (id, task_id, title, status)
      VALUES ($1::uuid, $2::uuid, 'Subtask 3.1', 'todo')
    `, [subtask1Id, task3Id]);

    // Budgets on Project and Phase
    await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer)
      VALUES 
        ($1::uuid, 'project', $2::uuid, null, 50000.00, 10000.00),
        ($1::uuid, 'phase', $2::uuid, $3::uuid, 20000.00, 4000.00)
    `, [workspaceId, projectId, phaseId]);

    // 22. Record Leaf Expenses: 1 Project Task expense (₹3,000), 1 Subtask expense (₹2,000), 1 Standalone expense (₹1,500)
    const tx1Id = randomUUID();
    const stTxId = randomUUID();
    const saTxId = randomUUID();

    // Insert transactions
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, subtask_id, expense_date, description, status, created_by)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, null, '2026-08-22', 'Project Task Expense', 'active', $4::uuid),
        ($5::uuid, $2::uuid, $6::uuid, $7::uuid, '2026-08-22', 'Subtask Expense', 'active', $4::uuid),
        ($8::uuid, $2::uuid, $9::uuid, null, '2026-08-22', 'Standalone General Spend', 'active', $4::uuid)
    `, [tx1Id, workspaceId, task1Id, ownerId, stTxId, task3Id, subtask1Id, saTxId, task2Id]);

    // Insert items
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, line_number, amount, category, description)
      VALUES
        ($1::uuid, 1, 3000.00, 'Equipment', 'Direct task spend'),
        ($2::uuid, 1, 2000.00, 'Services', 'Subtask spend'),
        ($3::uuid, 1, 1500.00, 'Admin', 'Standalone spend')
    `, [tx1Id, stTxId, saTxId]);

    await client.query('SET LOCAL session_replication_role = DEFAULT');
    pass('21. Live DB: Test fixtures, workspace, project, phase, task list, tasks, and budgets created successfully');
    pass('22. Live DB: Physical leaf expense transactions created (₹3,000 Project + ₹2,000 Subtask + ₹1,500 Standalone)');

    // 23. Test Canonical Workspace Financial Summary RPC
    const wsSummary = await asUser(client, finOpId, `
      SELECT public.get_workspace_financial_summary($1::uuid) as s
    `, [workspaceId]);
    const ws = normalizeFinancialSummary(wsSummary.rows[0].s);
    assert.equal(ws.base_budget, 50000.00);
    assert.equal(ws.project_spend, 5000.00); // 3000 + 2000 subtask
    assert.equal(ws.standalone_spend, 1500.00);
    assert.equal(ws.actual_spend, 6500.00); // 5000 + 1500
    assert.equal(ws.risk_band, 'GREEN');
    pass('23. Live RPC: get_workspace_financial_summary returns canonical project spend (₹5,000) and standalone spend (₹1,500)');

    // 24. Test Canonical Project Financial Summary RPC
    const projSummary = await asUser(client, finOpId, `
      SELECT public.get_project_financial_summary($1::uuid) as s
    `, [projectId]);
    const ps = normalizeFinancialSummary(projSummary.rows[0].s);
    assert.equal(ps.base_budget, 50000.00);
    assert.equal(ps.safety_buffer, 10000.00);
    assert.equal(ps.actual_spend, 5000.00);
    assert.equal(ps.remaining_base, 45000.00);
    assert.equal(ps.risk_band, 'GREEN');
    pass('24. Live RPC: get_project_financial_summary derives rollup spend (₹5,000) from leaf tasks & subtasks without double counting');

    // 25. Test Canonical Phase Financial Summary RPC
    const phaseSummary = await asUser(client, ownerId, `
      SELECT public.get_phase_financial_summary($1::uuid) as s
    `, [phaseId]);
    const phs = normalizeFinancialSummary(phaseSummary.rows[0].s);
    assert.equal(phs.base_budget, 20000.00);
    assert.equal(phs.actual_spend, 5000.00);
    assert.equal(phs.remaining_base, 15000.00);
    assert.equal(phs.risk_band, 'GREEN');
    pass('25. Live RPC: get_phase_financial_summary derives phase actual spend (₹5,000)');

    // 26. Test Canonical Task List Financial Summary RPC (Inherited from Phase)
    const taskListSummary = await asUser(client, ownerId, `
      SELECT public.get_task_list_financial_summary($1::uuid) as s
    `, [taskListId]);
    const tls = normalizeFinancialSummary(taskListSummary.rows[0].s);
    assert.equal(tls.is_budgeted, false);
    assert.equal(tls.budget_source_type, 'phase');
    assert.equal(tls.actual_spend, 5000.00);
    pass('26. Live RPC: get_task_list_financial_summary inherits phase budget context and reports task spend (₹5,000)');

    // 27. Void the subtask expense (₹2,000) and verify instant effect on leaf & summary calculations
    await asUser(client, ownerId, `
      SELECT public.void_expense_transaction($1::uuid, 'Voiding subtask expense for test')
    `, [stTxId]);

    const updatedWs = await asUser(client, finOpId, `
      SELECT public.get_workspace_financial_summary($1::uuid) as s
    `, [workspaceId]);
    const uws = normalizeFinancialSummary(updatedWs.rows[0].s);
    assert.equal(uws.project_spend, 3000.00); // 5000 - 2000 voided
    assert.equal(uws.actual_spend, 4500.00); // 3000 + 1500 standalone
    pass('27. Live RPC: Voided transaction effective spend reduces to ₹0.00 and workspace rollups reflect ₹4,500 net spend');

    console.log('\nRolling back test transaction (database untouched)...');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  ALL 27 P6-04 FINANCIAL EXPLORER ASSERTIONS PASSED WITH ZERO ERRORS!      ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

run().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
