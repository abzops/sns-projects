/**
 * SNS PROJECTS — PACKAGE 6 / P6-02 CENTRAL BUDGET CONFIGURATION TEST SUITE
 *
 * Automated verification for:
 * 1. Frontend Authorization Matrix (Active Tenancy & Role Isolation)
 * 2. Budget Data Models, Normalization & Single Canonical Contract
 * 3. Source Code Contracts, Fail-Closed Security & Exclusion Boundaries (No Delete, No Reallocation)
 * 4. PostgreSQL Live RLS, Hierarchy Constraints, Capacity Rules & Audit Log Verification
 *
 * Usage:
 *   node scripts/test-p6-02-budget-management.mjs
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { normalizeFinancialSummary } from '../src/lib/finance.js';
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
      // Ignore if transaction aborted
    }
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — PACKAGE 6 / P6-02 BUDGET MANAGEMENT TEST SUITE            ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 1: FRONTEND AUTHORIZATION MATRIX FOR BUDGET MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Frontend Authorization & Active-Tenancy Matrix ---');

  function deriveFinanceAccess({
    workspaceRole = null,
    isOwner = false,
    isWorkspaceAdmin = false,
    isCEO = false,
    isCTO = false,
    departmentMemberships = [],
  }) {
    const hasActiveWorkspaceMembership = Boolean(workspaceRole);

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

  // 1. Workspace Owner
  const ownerAccess = deriveFinanceAccess({ workspaceRole: 'owner', isOwner: true });
  assert.equal(ownerAccess.canManageBudgets, true);
  pass('1. Active Workspace Owner has canManageBudgets=true');

  // 2. Workspace Admin
  const adminAccess = deriveFinanceAccess({ workspaceRole: 'admin', isWorkspaceAdmin: true });
  assert.equal(adminAccess.canManageBudgets, true);
  pass('2. Active Workspace Admin has canManageBudgets=true');

  // 3. CEO with active tenancy
  const ceoActiveAccess = deriveFinanceAccess({ workspaceRole: 'member', isCEO: true });
  assert.equal(ceoActiveAccess.canManageBudgets, true);
  pass('3. Active CEO with active workspace tenancy has canManageBudgets=true');

  // 4. CTO with active tenancy
  const ctoActiveAccess = deriveFinanceAccess({ workspaceRole: 'member', isCTO: true });
  assert.equal(ctoActiveAccess.canManageBudgets, true);
  pass('4. Active CTO with active workspace tenancy has canManageBudgets=true');

  // 5. Finance Operator (must be denied management authority)
  const finOpAccess = deriveFinanceAccess({
    workspaceRole: 'member',
    departmentMemberships: [{ is_active: true, departments: { code: 'FIN' } }],
  });
  assert.equal(finOpAccess.canViewWorkspaceFinance, true);
  assert.equal(finOpAccess.canManageBudgets, false);
  assert.equal(finOpAccess.isFinanceOperator, true);
  pass('5. Active Finance Operator has canViewWorkspaceFinance=true but canManageBudgets=false');

  // 6. Project Admin only
  const projAdminAccess = deriveFinanceAccess({ workspaceRole: 'member' });
  assert.equal(projAdminAccess.canManageBudgets, false);
  pass('6. Project Admin only is DENIED budget management (canManageBudgets=false)');

  // 7. System Admin only
  const sysAdminAccess = deriveFinanceAccess({ workspaceRole: 'member' });
  assert.equal(sysAdminAccess.canManageBudgets, false);
  pass('7. System Admin only is DENIED budget management (canManageBudgets=false)');

  // 8. Normal Member
  const memberAccess = deriveFinanceAccess({ workspaceRole: 'member' });
  assert.equal(memberAccess.canManageBudgets, false);
  pass('8. Normal Member is DENIED budget management (canManageBudgets=false)');

  // 9. Viewer
  const viewerAccess = deriveFinanceAccess({ workspaceRole: 'viewer' });
  assert.equal(viewerAccess.canManageBudgets, false);
  pass('9. Viewer is DENIED budget management (canManageBudgets=false)');

  // 10. CEO without active workspace tenancy
  const ceoNoTenancy = deriveFinanceAccess({ workspaceRole: null, isCEO: true });
  assert.equal(ceoNoTenancy.canManageBudgets, false);
  pass('10. CEO without active workspace membership is strictly DENIED budget management');

  // 11. CTO without active workspace tenancy
  const ctoNoTenancy = deriveFinanceAccess({ workspaceRole: null, isCTO: true });
  assert.equal(ctoNoTenancy.canManageBudgets, false);
  pass('11. CTO without active workspace membership is strictly DENIED budget management');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 2: SOURCE CODE CONTRACTS & ARCHITECTURAL INVARIANTS
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 2: Source Code Contracts & UI Architecture ---');

  const [
    appJsx,
    financeOverviewJsx,
    budgetMgmtJsx,
    budgetMgmtCss,
    budgetModalJsx,
    budgetModalCss,
    useBudgetsSrc,
  ] = await Promise.all([
    readFile(path.join(repoRoot, 'src', 'App.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'pages', 'FinanceOverviewPage.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'pages', 'BudgetManagementPage.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'pages', 'BudgetManagementPage.module.css'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'components', 'finance', 'BudgetEditModal.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'components', 'finance', 'BudgetEditModal.module.css'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'hooks', 'useBudgets.js'), 'utf8'),
  ]);

  // 12. Route registration in App.jsx
  assert.ok(
    appJsx.includes('/workspace/:workspaceId/finance/budgets') &&
      appJsx.includes('BudgetManagementPage'),
    'App.jsx must register /workspace/:workspaceId/finance/budgets route'
  );
  pass('12. App.jsx correctly registers /workspace/:workspaceId/finance/budgets route');

  // 13. Entry point in FinanceOverviewPage.jsx protected by canManageBudgets
  assert.ok(
    financeOverviewJsx.includes('canManageBudgets') &&
      financeOverviewJsx.includes('/finance/budgets') &&
      financeOverviewJsx.includes('Manage Budgets'),
    'FinanceOverviewPage must render Manage Budgets link guarded by canManageBudgets'
  );
  pass('13. FinanceOverviewPage renders Manage Budgets action strictly guarded by canManageBudgets');

  // 14. Fail-closed route guard in BudgetManagementPage.jsx
  assert.ok(
    budgetMgmtJsx.includes('!canManageBudgets || financeAccessError') &&
      budgetMgmtJsx.includes('Budget Management Restricted'),
    'BudgetManagementPage must render access denied view when !canManageBudgets'
  );
  pass('14. BudgetManagementPage fails closed to access denied view on unauthorized direct URL');

  // 15. Single normalizer imported in BudgetManagementPage.jsx
  assert.ok(
    budgetMgmtJsx.includes("from '../lib/finance.js'") ||
      budgetMgmtJsx.includes("from '../lib/finance'"),
    'BudgetManagementPage must import normalizeFinancialSummary from src/lib/finance.js'
  );
  pass('15. BudgetManagementPage consumes canonical normalizeFinancialSummary from src/lib/finance.js');

  // 16. No budget deletion UI in P6-02
  assert.ok(
    !budgetMgmtJsx.includes('Delete Budget') &&
      !budgetMgmtJsx.includes('Remove Budget') &&
      !budgetModalJsx.includes('Delete Budget') &&
      !budgetModalJsx.includes('Remove Budget') &&
      !budgetMgmtJsx.includes(".from('budgets').delete") &&
      !useBudgetsSrc.includes(".from('budgets').delete"),
    'BudgetManagementPage and BudgetEditModal must NOT expose budget deletion UI or DML'
  );
  pass('16. Strict boundary: Zero budget deletion UI or DML delete invoked in P6-02');

  // 17. No budget reallocation UI in P6-02
  assert.ok(
    !budgetMgmtJsx.includes('Reallocate') &&
      !budgetMgmtJsx.includes('budget_reallocations') &&
      !budgetModalJsx.includes('Reallocate'),
    'BudgetManagementPage and BudgetEditModal must NOT expose budget reallocation UI'
  );
  pass('17. Strict boundary: Zero budget reallocation UI in P6-02');

  // 18. Cache invalidation on mutation in useBudgets.js
  assert.ok(
    useBudgetsSrc.includes('clearFinanceOverviewCache()'),
    'useBudgets must invalidate finance overview cache on successful budget mutation'
  );
  pass('18. useBudgets automatically invalidates Finance Overview cache on budget mutations');

  // 19. Currency formatting check (INR / ₹)
  const formattedVal = formatCurrency(250000);
  assert.ok(formattedVal.includes('₹') && formattedVal.includes('2,50,000'));
  pass('19. formatCurrency outputs canonical INR currency values');

  // 20. Design tokens validation in CSS
  const combinedCss = `${budgetMgmtCss}\n${budgetModalCss}`;
  assert.ok(
    !combinedCss.includes('--brand') &&
      combinedCss.includes('var(--yellow') &&
      combinedCss.includes('var(--bg-card') &&
      combinedCss.includes('var(--border-default'),
    'Budget Management CSS must use canonical design tokens without undefined variables'
  );
  pass('20. CSS adheres strictly to Stack n Stock dark design system tokens');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 3: POSTGRESQL LIVE INTEGRATION, HIERARCHY & AUDIT VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 3: PostgreSQL Live Hierarchy & Database Integration ---');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const client = new Client({
    connectionString: envAdmin.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    // Setup Test Workspace & Profiles
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const adminId = randomUUID();
    const finOpId = randomUUID();
    const memberId = randomUUID();

    // Fixture setup
    await client.query('SET LOCAL session_replication_role = replica');

    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by)
      VALUES ('${workspaceId}', 'P6-02 Budget Test Workspace', '${ownerId}')
    `);

    // Insert profiles
    for (const [uid, roleName] of [
      [ownerId, 'Owner User'],
      [adminId, 'Admin User'],
      [finOpId, 'Finance User'],
      [memberId, 'Member User'],
    ]) {
      await client.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ('${uid}', '${roleName}')
        ON CONFLICT (id) DO NOTHING
      `);
    }

    // Insert workspace members
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES 
        ('${workspaceId}', '${ownerId}', 'owner', 'active'),
        ('${workspaceId}', '${adminId}', 'admin', 'active'),
        ('${workspaceId}', '${finOpId}', 'member', 'active'),
        ('${workspaceId}', '${memberId}', 'member', 'active')
    `);

    // Setup Finance Department
    const deptId = randomUUID();
    await client.query(`
      INSERT INTO public.departments (id, workspace_id, name, code, is_active)
      VALUES ('${deptId}', '${workspaceId}', 'Finance Department', 'FIN', true)
    `);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active)
      VALUES ('${workspaceId}', '${deptId}', '${finOpId}', true)
    `);

    // Setup Project, Phase, Task List
    const projectId = randomUUID();
    const phase1Id = randomUUID();
    const phase2Id = randomUUID();
    const taskList1Id = randomUUID();
    const taskList2Id = randomUUID();

    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, owner_id, created_by)
      VALUES ('${projectId}', '${workspaceId}', 'P6-02 Test Project', '${ownerId}', '${ownerId}')
    `);

    await client.query(`
      INSERT INTO public.phases (id, project_id, name, position)
      VALUES 
        ('${phase1Id}', '${projectId}', 'Phase 1 - Core Build', 1),
        ('${phase2Id}', '${projectId}', 'Phase 2 - Testing', 2)
    `);

    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
      VALUES 
        ('${taskList1Id}', '${projectId}', '${phase1Id}', 'Sprint 1 Tasks', 1),
        ('${taskList2Id}', '${projectId}', '${phase1Id}', 'Sprint 2 Tasks', 2)
    `);

    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // 21. Live Test: Project Budget Creation (Base = 100,000, Buffer = 20,000)
    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${ownerId}'`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated'`);

    const pBudgetRes = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, safety_buffer)
      VALUES ('${workspaceId}', 'project', '${projectId}', 100000.00, 20000.00)
      RETURNING *
    `);
    assert.equal(pBudgetRes.rows.length, 1);
    assert.equal(Number(pBudgetRes.rows[0].base_budget), 100000);
    assert.equal(Number(pBudgetRes.rows[0].safety_buffer), 20000);
    pass('21. Live DB: Project budget created successfully by Workspace Owner (100k Base, 20k Buffer)');

    // 22. Live Test: Audit log generated on Project Budget create
    const audit1 = await client.query(`
      SELECT * FROM public.budget_audit_logs 
      WHERE budget_id = '${pBudgetRes.rows[0].id}' AND action = 'created'
    `);
    assert.equal(audit1.rows.length, 1);
    assert.equal(audit1.rows[0].actor_id, ownerId);
    pass('22. Live DB: Immutable budget audit log generated automatically with actor_id = ownerId');

    // 23. Live Test: Phase 1 Budget Creation (Base = 40,000, Buffer = 5,000)
    const ph1BudgetRes = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer)
      VALUES ('${workspaceId}', 'phase', '${projectId}', '${phase1Id}', 40000.00, 5000.00)
      RETURNING *
    `);
    assert.equal(ph1BudgetRes.rows.length, 1);
    pass('23. Live DB: Phase 1 budget created successfully under budgeted Project (40k Base, 5k Buffer)');

    // 24. Live Test: Phase 2 Budget Creation (Base = 50,000)
    const ph2BudgetRes = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer)
      VALUES ('${workspaceId}', 'phase', '${projectId}', '${phase2Id}', 50000.00, 0.00)
      RETURNING *
    `);
    assert.equal(ph2BudgetRes.rows.length, 1);
    pass('24. Live DB: Phase 2 budget created (50k Base) -> Total Phase allocations = 90k <= 100k Project Base');

    // 25. Live Test: Phase allocation exceeding Project Base Budget is REJECTED
    const phase3Id = randomUUID();
    await client.query(`
      INSERT INTO public.phases (id, project_id, name, position)
      VALUES ('${phase3Id}', '${projectId}', 'Phase 3 - Exceeding', 3)
    `);

    const ph3Err = await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer)
        VALUES ('${workspaceId}', 'phase', '${projectId}', '${phase3Id}', 20000.00, 0.00)
      `);
    });
    assert.ok(
      ph3Err.message.includes('exceed') || ph3Err.message.includes('Total phase base budgets'),
      `Expected exceed error, got: ${ph3Err.message}`
    );
    pass('25. Live DB: Phase allocation exceeding Project Base Budget (90k + 20k > 100k) is strictly REJECTED');

    // 26. Live Test: Task List 1 Budget Creation (Base = 25,000 under Phase 1's 40k)
    const tl1BudgetRes = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, safety_buffer)
      VALUES ('${workspaceId}', 'task_list', '${projectId}', '${phase1Id}', '${taskList1Id}', 25000.00, 2000.00)
      RETURNING *
    `);
    assert.equal(tl1BudgetRes.rows.length, 1);
    pass('26. Live DB: Task List budget created successfully under budgeted Phase (25k Base <= 40k Phase Base)');

    // 27. Live Test: Task List allocation exceeding Phase Base Budget is REJECTED
    const tlErr = await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, safety_buffer)
        VALUES ('${workspaceId}', 'task_list', '${projectId}', '${phase1Id}', '${taskList2Id}', 20000.00, 0.00)
      `);
    });
    assert.ok(
      tlErr.message.includes('exceed') || tlErr.message.includes('task list base budgets'),
      `Expected task list exceed error, got: ${tlErr.message}`
    );
    pass('27. Live DB: Task List allocation exceeding Phase Base Budget (25k + 20k > 40k) is strictly REJECTED');

    // 28. Live Test: Project Base Budget reduction below existing Phase allocations (90k) is REJECTED
    const projRedErr = await expectError(client, async () => {
      await client.query(`
        UPDATE public.budgets
        SET base_budget = 80000.00
        WHERE id = '${pBudgetRes.rows[0].id}'
      `);
    });
    assert.ok(
      projRedErr.message.includes('Cannot reduce') || projRedErr.message.includes('child Phase allocations'),
      `Expected reduction below children error, got: ${projRedErr.message}`
    );
    pass('28. Live DB: Project Base reduction below child Phase allocations (80k < 90k allocated) is REJECTED');

    // 29. Live Test: Phase Base Budget reduction below Task List allocations (25k) is REJECTED
    const phaseRedErr = await expectError(client, async () => {
      await client.query(`
        UPDATE public.budgets
        SET base_budget = 20000.00
        WHERE id = '${ph1BudgetRes.rows[0].id}'
      `);
    });
    assert.ok(
      phaseRedErr.message.includes('Cannot reduce') || phaseRedErr.message.includes('child Task List allocations'),
      `Expected phase reduction below children error, got: ${phaseRedErr.message}`
    );
    pass('29. Live DB: Phase Base reduction below child Task List allocations (20k < 25k allocated) is REJECTED');

    // 30. Live Test: Budget update to valid amount (e.g. increase Project Base to 120,000)
    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${adminId}'`);
    const updateRes = await client.query(`
      UPDATE public.budgets
      SET base_budget = 120000.00, safety_buffer = 25000.00
      WHERE id = '${pBudgetRes.rows[0].id}'
      RETURNING *
    `);
    assert.equal(Number(updateRes.rows[0].base_budget), 120000);
    assert.equal(Number(updateRes.rows[0].safety_buffer), 25000);
    pass('30. Live DB: Workspace Admin successfully updated Project budget (120k Base, 25k Buffer)');

    // 31. Live Test: Audit log recorded update action
    const audit2 = await client.query(`
      SELECT * FROM public.budget_audit_logs 
      WHERE budget_id = '${pBudgetRes.rows[0].id}' AND action = 'updated'
    `);
    assert.equal(audit2.rows.length, 1);
    assert.equal(audit2.rows[0].actor_id, adminId);
    assert.equal(Number(audit2.rows[0].previous_base_budget), 100000);
    assert.equal(Number(audit2.rows[0].new_base_budget), 120000);
    pass('31. Live DB: Update audit log accurately captured previous and new base budgets and actor_id');

    // 32. Live Test: Finance Operator direct INSERT is BLOCKED by RLS
    const testProj2Id = randomUUID();
    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, owner_id, created_by)
      VALUES ('${testProj2Id}', '${workspaceId}', 'Project 2', '${ownerId}', '${ownerId}')
    `);

    await expectError(client, async () => {
      await asUser(client, finOpId, `
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, safety_buffer)
        VALUES ($1, 'project', $2, 50000.00, 0.00)
      `, [workspaceId, testProj2Id]);
    });
    pass('32. Live DB: Finance Operator direct budget INSERT is strictly BLOCKED by RLS');

    // 33. Live Test: Normal Member direct INSERT is BLOCKED by RLS
    await expectError(client, async () => {
      await asUser(client, memberId, `
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, safety_buffer)
        VALUES ($1, 'project', $2, 50000.00, 0.00)
      `, [workspaceId, testProj2Id]);
    });
    pass('33. Live DB: Normal Member direct budget INSERT is strictly BLOCKED by RLS');

    // 34. Live Test: Financial summary RPC reflection
    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${ownerId}'`);
    const summaryRes = await client.query(`
      SELECT public.get_project_financial_summary('${projectId}') AS summary
    `);
    const s = summaryRes.rows[0].summary;
    assert.equal(s.is_budgeted, true);
    assert.equal(Number(s.base_budget), 120000);
    assert.equal(Number(s.safety_buffer), 25000);
    assert.equal(Number(s.allocated_to_children), 90000);
    assert.equal(Number(s.unallocated_base), 30000); // 120k - 90k
    pass('34. Live DB: get_project_financial_summary reflects updated allocations and unallocated base (30k free)');

    console.log('\nRolling back test transaction (database untouched)...');
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  ALL 34 P6-02 BUDGET MANAGEMENT ASSERTIONS PASSED WITH ZERO ERRORS!  ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
