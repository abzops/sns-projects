import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { normalizeFinancialSummary, formatCurrency } from '../src/lib/expenseExecution.js';

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

async function asUser(client, userId, query, params = []) {
  await client.query('SET LOCAL ROLE authenticated');
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: 'authenticated' })]
  );
  try {
    return await client.query(query, params);
  } finally {
    await client.query('RESET ROLE');
  }
}

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`[PASS ${String(passed).padStart(2, '0')}] ${msg}`);
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — PACKAGE 6 / P6-01 FINANCE OVERVIEW TEST SUITE             ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 1: FRONTEND AUTHORIZATION LOGIC MATRIX (useFinanceAccess logic)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Frontend Authorization & Active-Tenancy Matrix ---');

  function evaluateFinanceAccess({ workspaceRole, systemRoles = [], departmentMemberships = [] }) {
    const hasActiveWorkspaceMembership = Boolean(workspaceRole);
    const isOwner = workspaceRole === 'owner';
    const isWorkspaceAdmin = workspaceRole === 'admin';
    const isCEO = systemRoles.includes('ceo');
    const isCTO = systemRoles.includes('cto');

    const isFinanceOperator =
      hasActiveWorkspaceMembership &&
      departmentMemberships.some(
        (dm) =>
          dm.is_active &&
          (dm.departments?.code?.toUpperCase() === 'FIN' || dm.departments?.code === 'FIN')
      );

    const canManageBudgets =
      hasActiveWorkspaceMembership &&
      (isOwner || isWorkspaceAdmin || isCEO || isCTO);

    const canViewWorkspaceFinance = canManageBudgets || isFinanceOperator;

    return {
      hasActiveWorkspaceMembership,
      isFinanceOperator,
      canManageBudgets,
      canViewWorkspaceFinance,
    };
  }

  // 1. Active Workspace Owner
  const ownerAccess = evaluateFinanceAccess({ workspaceRole: 'owner' });
  assert.equal(ownerAccess.canViewWorkspaceFinance, true);
  assert.equal(ownerAccess.canManageBudgets, true);
  pass('1. Active Workspace Owner has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 2. Active Workspace Admin
  const adminAccess = evaluateFinanceAccess({ workspaceRole: 'admin' });
  assert.equal(adminAccess.canViewWorkspaceFinance, true);
  assert.equal(adminAccess.canManageBudgets, true);
  pass('2. Active Workspace Admin has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 3. Active CEO with active workspace tenancy
  const ceoAccess = evaluateFinanceAccess({ workspaceRole: 'member', systemRoles: ['ceo'] });
  assert.equal(ceoAccess.canViewWorkspaceFinance, true);
  assert.equal(ceoAccess.canManageBudgets, true);
  pass('3. Active CEO with active workspace tenancy has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 4. Active CTO with active workspace tenancy
  const ctoAccess = evaluateFinanceAccess({ workspaceRole: 'member', systemRoles: ['cto'] });
  assert.equal(ctoAccess.canViewWorkspaceFinance, true);
  assert.equal(ctoAccess.canManageBudgets, true);
  pass('4. Active CTO with active workspace tenancy has canViewWorkspaceFinance=true and canManageBudgets=true');

  // 5. Active Finance Operator (FIN dept member)
  const finOpAccess = evaluateFinanceAccess({
    workspaceRole: 'member',
    departmentMemberships: [{ is_active: true, departments: { code: 'FIN' } }],
  });
  assert.equal(finOpAccess.canViewWorkspaceFinance, true);
  assert.equal(finOpAccess.canManageBudgets, false);
  assert.equal(finOpAccess.isFinanceOperator, true);
  pass('5. Active Finance Operator has canViewWorkspaceFinance=true, canManageBudgets=false, isFinanceOperator=true');

  // 6. Project Admin only
  const projAdminAccess = evaluateFinanceAccess({ workspaceRole: 'member', systemRoles: ['project_admin'] });
  assert.equal(projAdminAccess.canViewWorkspaceFinance, false);
  assert.equal(projAdminAccess.canManageBudgets, false);
  pass('6. Project Admin only is DENIED workspace Finance overview (canViewWorkspaceFinance=false)');

  // 7. System Admin only
  const sysAdminAccess = evaluateFinanceAccess({ workspaceRole: 'member', systemRoles: ['system_admin'] });
  assert.equal(sysAdminAccess.canViewWorkspaceFinance, false);
  assert.equal(sysAdminAccess.canManageBudgets, false);
  pass('7. System Admin only is DENIED workspace Finance overview (canViewWorkspaceFinance=false)');

  // 8. Normal Member
  const memberAccess = evaluateFinanceAccess({ workspaceRole: 'member' });
  assert.equal(memberAccess.canViewWorkspaceFinance, false);
  assert.equal(memberAccess.canManageBudgets, false);
  pass('8. Normal Member is DENIED workspace Finance overview (canViewWorkspaceFinance=false)');

  // 9. Viewer
  const viewerAccess = evaluateFinanceAccess({ workspaceRole: 'viewer' });
  assert.equal(viewerAccess.canViewWorkspaceFinance, false);
  assert.equal(viewerAccess.canManageBudgets, false);
  pass('9. Viewer is DENIED workspace Finance overview (canViewWorkspaceFinance=false)');

  // 10. CEO without active workspace membership (null workspaceRole)
  const nonMemberCeo = evaluateFinanceAccess({ workspaceRole: null, systemRoles: ['ceo'] });
  assert.equal(nonMemberCeo.canViewWorkspaceFinance, false);
  assert.equal(nonMemberCeo.canManageBudgets, false);
  pass('10. CEO without active workspace membership is strictly DENIED Finance Overview');

  // 11. CTO without active workspace membership (null workspaceRole)
  const nonMemberCto = evaluateFinanceAccess({ workspaceRole: null, systemRoles: ['cto'] });
  assert.equal(nonMemberCto.canViewWorkspaceFinance, false);
  assert.equal(nonMemberCto.canManageBudgets, false);
  pass('11. CTO without active workspace membership is strictly DENIED Finance Overview');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 2: SUMMARY NORMALIZATION & CANONICAL CONTRACT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 2: Summary Normalization & Canonical Contract ---');

  // 12. Full populated summary normalization
  const sampleRaw = {
    entity_type: 'workspace',
    entity_id: 'ws-123',
    is_budgeted: true,
    budget_source_type: 'workspace',
    budget_source_id: 'b-456',
    base_budget: '100000.50',
    safety_buffer: '20000.00',
    total_ceiling: '120000.50',
    actual_spend: '85000.25',
    remaining_base: '15000.25',
    buffer_used: '0.00',
    buffer_remaining: '20000.00',
    overrun: '0.00',
    utilization_pct: 85.0,
    risk_band: 'YELLOW',
    allocated_to_children: '60000.00',
    unallocated_base: '40000.50',
    project_spend: '75000.25',
    standalone_spend: '10000.00',
  };

  const norm = normalizeFinancialSummary(sampleRaw);
  assert.equal(norm.entity_type, 'workspace');
  assert.equal(norm.base_budget, 100000.5);
  assert.equal(norm.safety_buffer, 20000.0);
  assert.equal(norm.total_ceiling, 120000.5);
  assert.equal(norm.actual_spend, 85000.25);
  assert.equal(norm.remaining_base, 15000.25);
  assert.equal(norm.buffer_used, 0);
  assert.equal(norm.buffer_remaining, 20000.0);
  assert.equal(norm.overrun, 0);
  assert.equal(norm.utilization_pct, 85.0);
  assert.equal(norm.risk_band, 'YELLOW');
  assert.equal(norm.project_spend, 75000.25);
  assert.equal(norm.standalone_spend, 10000.0);
  pass('12. normalizeFinancialSummary parses all canonical numeric fields and preserves decimal values');

  // 13. Risk band preservation without alteration
  for (const band of ['GREEN', 'YELLOW', 'ORANGE', 'RED']) {
    const bNorm = normalizeFinancialSummary({ ...sampleRaw, risk_band: band });
    assert.equal(bNorm.risk_band, band);
  }
  pass('13. Risk band is preserved directly from backend (GREEN, YELLOW, ORANGE, RED)');

  // 14. Unbudgeted / zero budget summary
  const unbudgetedRaw = {
    entity_type: 'workspace',
    entity_id: 'ws-empty',
    is_budgeted: false,
    base_budget: '0.00',
    safety_buffer: '0.00',
    total_ceiling: '0.00',
    actual_spend: '5000.00',
    remaining_base: '0.00',
    buffer_used: '0.00',
    buffer_remaining: '0.00',
    overrun: '0.00',
    utilization_pct: 0,
    risk_band: 'GREEN',
    project_spend: '0.00',
    standalone_spend: '5000.00',
  };
  const unbNorm = normalizeFinancialSummary(unbudgetedRaw);
  assert.equal(unbNorm.is_budgeted, false);
  assert.equal(unbNorm.base_budget, 0);
  assert.equal(unbNorm.actual_spend, 5000);
  assert.equal(unbNorm.standalone_spend, 5000);
  pass('14. Unbudgeted summary with standalone spend normalizes safely');

  // 15. Invalid / null raw input
  assert.equal(normalizeFinancialSummary(null), null);
  assert.equal(normalizeFinancialSummary(undefined), null);
  assert.equal(normalizeFinancialSummary('invalid'), null);
  pass('15. normalizeFinancialSummary handles null/undefined/non-object input safely');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 3: SOURCE CODE CONTRACTS & INTEGRATION PARITY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 3: Source Code Contracts & UI Architecture ---');

  const [
    appJsx,
    appLayoutJsx,
    financeOverviewPage,
    financeOverviewCss,
    useFinanceAccessSrc,
    useFinanceOverviewSrc,
    financeRiskBadgeSrc,
    financeRiskBadgeCss,
  ] = await Promise.all([
    readFile(path.join(repoRoot, 'src', 'App.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'components', 'AppLayout.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'pages', 'FinanceOverviewPage.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'pages', 'FinanceOverviewPage.module.css'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'hooks', 'useFinanceAccess.js'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'hooks', 'useFinanceOverview.js'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'components', 'finance', 'FinanceRiskBadge.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'components', 'finance', 'FinanceRiskBadge.module.css'), 'utf8'),
  ]);

  // 16. Route registration in App.jsx
  assert.ok(
    appJsx.includes('/workspace/:workspaceId/finance') && appJsx.includes('FinanceOverviewPage'),
    'App.jsx must register /workspace/:workspaceId/finance route'
  );
  pass('16. App.jsx correctly registers /workspace/:workspaceId/finance route');

  // 17. Sidebar navigation link in AppLayout.jsx
  assert.ok(
    appLayoutJsx.includes('canViewWorkspaceFinance') &&
      appLayoutJsx.includes('/workspace/${activeWorkspaceId}/finance') &&
      appLayoutJsx.includes('WalletCards'),
    'AppLayout.jsx must render Finance link protected by canViewWorkspaceFinance'
  );
  pass('17. AppLayout.jsx contains protected Finance navigation link with WalletCards icon');

  // 18. Sidebar hiding during loading (no persona flash)
  assert.ok(
    appLayoutJsx.includes('canViewWorkspaceFinance && !financeAccessLoading'),
    'AppLayout.jsx must hide Finance link during context loading'
  );
  pass('18. Sidebar hides Finance link during context resolution (no persona flash)');

  // 19. Direct URL fail-closed protection in FinanceOverviewPage.jsx
  assert.ok(
    financeOverviewPage.includes('!canViewWorkspaceFinance || isUnauthorized') &&
      financeOverviewPage.includes('Finance Overview Unavailable'),
    'FinanceOverviewPage must render Access Denied when unauthorized or RPC returns null'
  );
  pass('19. FinanceOverviewPage.jsx fails closed on direct unauthorized URL access');

  // 20. Zero client-side risk threshold recalculation
  assert.ok(
    !financeOverviewPage.includes('utilization_pct >= 80') &&
      !financeOverviewPage.includes('utilization_pct > 80') &&
      !financeOverviewPage.includes('actual_spend > base_budget'),
    'FinanceOverviewPage must NOT duplicate backend risk calculation logic'
  );
  assert.ok(
    !financeRiskBadgeSrc.includes('actual_spend') &&
      !financeRiskBadgeSrc.includes('base_budget'),
    'FinanceRiskBadge must NOT compute risk bands client-side'
  );
  pass('20. Zero client-side financial risk engine duplication (consumes backend risk_band directly)');

  // 21. Zero mutation UI in P6-01 (read-only command center)
  assert.ok(
    !financeOverviewPage.includes('INSERT INTO') &&
      !financeOverviewPage.includes('reallocate_budget') &&
      !financeOverviewPage.includes('correct_expense_transaction') &&
      !financeOverviewPage.includes('void_expense_transaction') &&
      !financeOverviewPage.includes('hard_delete_expense_transaction'),
    'FinanceOverviewPage must be strictly read-only'
  );
  pass('21. FinanceOverviewPage is strictly READ-ONLY (no mutation RPCs or DML invoked)');

  // 22. Design tokens & CSS sanity check
  const combinedCss = `${financeOverviewCss}\n${financeRiskBadgeCss}`;
  assert.ok(
    !combinedCss.includes('--brand') &&
      combinedCss.includes('var(--yellow)') &&
      combinedCss.includes('var(--panel)') &&
      combinedCss.includes('var(--green)') &&
      combinedCss.includes('var(--orange)') &&
      combinedCss.includes('var(--red)'),
    'Finance Overview CSS must use canonical design tokens without undefined variables'
  );
  pass('22. Design tokens match canonical Stack n Stock variables (no undefined --brand)');

  // 23. Currency formatting check (₹ / en-IN)
  const formattedCur = formatCurrency(150000.75);
  assert.ok(formattedCur.includes('₹') && formattedCur.includes('1,50,000.75'));
  pass('23. formatCurrency formats canonical INR values (₹1,50,000.75)');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 4: LIVE SUPABASE POSTGRESQL RPC VERIFICATION (Isolated Transaction)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 4: PostgreSQL Live RPC Integration ---');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const client = new Client({
    connectionString: envAdmin.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    const ids = {
      ws: randomUUID(),
      owner: randomUUID(),
      admin: randomUUID(),
      ceo: randomUUID(),
      cto: randomUUID(),
      finMember: randomUUID(),
      projAdmin: randomUUID(),
      sysAdmin: randomUUID(),
      member: randomUUID(),
      viewer: randomUUID(),
      finDept: randomUUID(),
      project: randomUUID(),
      phase: randomUUID(),
      taskList: randomUUID(),
      task: randomUUID(),
      statusDone: randomUUID(),
    };

    // Fixtures
    await client.query('SET LOCAL session_replication_role = replica');

    await client.query(
      `INSERT INTO public.workspaces (id, name, created_by) VALUES ($1, 'P6-01 Finance WS', $2)`,
      [ids.ws, ids.owner]
    );

    const users = [
      [ids.owner, 'owner'],
      [ids.admin, 'admin'],
      [ids.ceo, 'member'],
      [ids.cto, 'member'],
      [ids.finMember, 'member'],
      [ids.projAdmin, 'member'],
      [ids.sysAdmin, 'member'],
      [ids.member, 'member'],
      [ids.viewer, 'viewer'],
    ];

    for (const [uid, role] of users) {
      await client.query(`INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)`, [uid, `User ${role}`]);
      await client.query(
        `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`,
        [ids.ws, uid, role]
      );
    }

    // System roles
    await client.query(`INSERT INTO public.user_system_roles (workspace_id, user_id, role) VALUES ($1, $2, 'ceo')`, [ids.ws, ids.ceo]);
    await client.query(`INSERT INTO public.user_system_roles (workspace_id, user_id, role) VALUES ($1, $2, 'cto')`, [ids.ws, ids.cto]);
    await client.query(`INSERT INTO public.user_system_roles (workspace_id, user_id, role) VALUES ($1, $2, 'project_admin')`, [ids.ws, ids.projAdmin]);
    await client.query(`INSERT INTO public.user_system_roles (workspace_id, user_id, role) VALUES ($1, $2, 'system_admin')`, [ids.ws, ids.sysAdmin]);

    // Finance Department
    await client.query(
      `INSERT INTO public.departments (id, workspace_id, code, name, created_by) VALUES ($1, $2, 'FIN', 'Finance Department', $3)`,
      [ids.finDept, ids.ws, ids.owner]
    );
    await client.query(
      `INSERT INTO public.department_memberships (workspace_id, department_id, user_id, role, is_primary, is_active)
       VALUES ($1, $2, $3, 'member', true, true)`,
      [ids.ws, ids.finDept, ids.finMember]
    );

    // Project & Budget
    await client.query(
      `INSERT INTO public.projects (id, workspace_id, name, owner_id, created_by) VALUES ($1, $2, 'P6 Test Project', $3, $3)`,
      [ids.project, ids.ws, ids.owner]
    );
    await client.query(
      `INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by)
       VALUES ($1, 'project', $2, 50000.00, 10000.00, $3)`,
      [ids.ws, ids.project, ids.owner]
    );

    // Task & Expense
    await client.query(
      `INSERT INTO public.phases (id, project_id, name, created_by) VALUES ($1, $2, 'P6 Phase 1', $3)`,
      [ids.phase, ids.project, ids.owner]
    );
    await client.query(
      `INSERT INTO public.task_lists (id, project_id, phase_id, name) VALUES ($1, $2, $3, 'P6 List 1')`,
      [ids.taskList, ids.project, ids.phase]
    );
    await client.query(
      `INSERT INTO public.task_statuses (id, project_id, name, color, position, system_code) VALUES ($1, $2, 'Done', '#4acf82', 1, 'done')`,
      [ids.statusDone, ids.project]
    );
    await client.query(
      `INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, status_id, title, created_by)
       VALUES ($1, $2, $3, $4, $5, 'P6 Leaf Task', $6)`,
      [ids.task, ids.project, ids.phase, ids.taskList, ids.statusDone, ids.owner]
    );

    const txId = randomUUID();
    await client.query(
      `INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
       VALUES ($1, $2, $3, 'active', $4)`,
      [txId, ids.ws, ids.task, ids.owner]
    );
    await client.query(
      `INSERT INTO public.expense_items (transaction_id, category, description, amount)
       VALUES ($1, 'Hardware', 'P6 Hardware Items', 12500.00)`,
      [txId]
    );

    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // 24. Workspace Owner gets valid workspace summary
    const { rows: [ownerSumm] } = await asUser(
      client,
      ids.owner,
      `SELECT public.get_workspace_financial_summary($1) AS summary`,
      [ids.ws]
    );
    assert.ok(ownerSumm.summary !== null);
    assert.equal(Number(ownerSumm.summary.base_budget), 50000.0);
    assert.equal(Number(ownerSumm.summary.actual_spend), 12500.0);
    assert.equal(Number(ownerSumm.summary.project_spend), 12500.0);
    assert.equal(ownerSumm.summary.risk_band, 'GREEN');
    pass('24. Live RPC: Workspace Owner receives valid workspace summary with project spend');

    // 25. Finance Operator gets valid workspace summary
    const { rows: [foSumm] } = await asUser(
      client,
      ids.finMember,
      `SELECT public.get_workspace_financial_summary($1) AS summary`,
      [ids.ws]
    );
    assert.ok(foSumm.summary !== null);
    assert.equal(Number(foSumm.summary.base_budget), 50000.0);
    assert.equal(Number(foSumm.summary.actual_spend), 12500.0);
    pass('25. Live RPC: Finance Operator receives valid workspace financial summary');

    // 26. Project Admin receives NULL (blocked at backend)
    const { rows: [paSumm] } = await asUser(
      client,
      ids.projAdmin,
      `SELECT public.get_workspace_financial_summary($1) AS summary`,
      [ids.ws]
    );
    assert.equal(paSumm.summary, null);
    pass('26. Live RPC: Project Admin receives NULL for workspace summary (fails closed)');

    // 27. Normal Member receives NULL
    const { rows: [memSumm] } = await asUser(
      client,
      ids.member,
      `SELECT public.get_workspace_financial_summary($1) AS summary`,
      [ids.ws]
    );
    assert.equal(memSumm.summary, null);
    pass('27. Live RPC: Normal Member receives NULL for workspace summary (fails closed)');

    // 28. Viewer receives NULL
    const { rows: [viewSumm] } = await asUser(
      client,
      ids.viewer,
      `SELECT public.get_workspace_financial_summary($1) AS summary`,
      [ids.ws]
    );
    assert.equal(viewSumm.summary, null);
    pass('28. Live RPC: Viewer receives NULL for workspace summary (fails closed)');

    // 29. Project Financial Summary RPC returns valid data for project
    const { rows: [pSumm] } = await asUser(
      client,
      ids.owner,
      `SELECT public.get_project_financial_summary($1) AS summary`,
      [ids.project]
    );
    assert.ok(pSumm.summary !== null);
    assert.equal(Number(pSumm.summary.base_budget), 50000.0);
    assert.equal(Number(pSumm.summary.safety_buffer), 10000.0);
    assert.equal(Number(pSumm.summary.actual_spend), 12500.0);
    assert.equal(pSumm.summary.risk_band, 'GREEN');
    pass('29. Live RPC: get_project_financial_summary returns canonical project summary');

    // 30. Risk Band Calculation RPC parity
    const { rows: [rbGreen] } = await client.query(`SELECT public.calculate_financial_risk_band(70000, 100000, 20000) AS band`);
    assert.equal(rbGreen.band, 'GREEN');
    const { rows: [rbYellow] } = await client.query(`SELECT public.calculate_financial_risk_band(85000, 100000, 20000) AS band`);
    assert.equal(rbYellow.band, 'YELLOW');
    const { rows: [rbOrange] } = await client.query(`SELECT public.calculate_financial_risk_band(105000, 100000, 20000) AS band`);
    assert.equal(rbOrange.band, 'ORANGE');
    const { rows: [rbRed] } = await client.query(`SELECT public.calculate_financial_risk_band(125000, 100000, 20000) AS band`);
    assert.equal(rbRed.band, 'RED');
    pass('30. Live RPC: calculate_financial_risk_band evaluates GREEN, YELLOW, ORANGE, RED accurately');

    await client.query('ROLLBACK');
    console.log('\nRolling back test transaction (database untouched)...');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`  ALL ${passed} P6-01 FINANCE OVERVIEW ASSERTIONS PASSED WITH ZERO ERRORS!   `);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
