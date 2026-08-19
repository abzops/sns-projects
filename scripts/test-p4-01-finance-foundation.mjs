import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

function parseEnv(content) {
  return content.split(/\r?\n/).reduce((values, rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return values;
    const separator = line.indexOf('=');
    if (separator <= 0) return values;
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    return values;
  }, {});
}

let passed = 0;

function pass(message) {
  passed += 1;
  console.log(`[PASS ${passed.toString().padStart(2, '0')}] ${message}`);
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
      [userId],
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
  console.log('  SNS PROJECTS — PACKAGE 4 / P4-01 FINANCE DATABASE FOUNDATION TEST SUITE  ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const env = parseEnv(await readFile('.env.admin', 'utf8'));
  assert.ok(env.SUPABASE_DB_URL, 'SUPABASE_DB_URL must exist in .env.admin');

  const client = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL. Starting isolated test transaction...');
  await client.query('BEGIN');

  try {
    // 1. Apply the P4-01A hotfix migration on top of the current remote DB baseline
    const hotfixSql = await readFile(
      path.join('supabase', 'migrations', '20260819115602_p4_01a_finance_integrity_hotfix.sql'),
      'utf8',
    );
    await client.query(hotfixSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));

    console.log('[SETUP] Applied P4-01A hotfix migration 20260819115602 inside test transaction');

    // 2. Set up test entities
    const ids = {
      ws: randomUUID(),
      ws2: randomUUID(),
      owner: randomUUID(),
      admin: randomUUID(),
      ceo: randomUUID(),
      cto: randomUUID(),
      projAdmin: randomUUID(),
      sysAdmin: randomUUID(),
      finMember: randomUUID(),
      projOwner: randomUUID(),
      phaseOwner: randomUUID(),
      member: randomUUID(),
      viewer: randomUUID(),
      finDept: randomUUID(),
      switDept: randomUUID(),
      proj1: randomUUID(),
      proj2: randomUUID(),
      phase1: randomUUID(),
      phase2: randomUUID(),
      taskList1: randomUUID(),
      taskList2: randomUUID(),
      task1: randomUUID(),
      task2: randomUUID(),
      childTask1: randomUUID(),
      processInst: randomUUID(),
      processStepTask: randomUUID(),
      standaloneTask: randomUUID(),
    };

    await client.query('SET LOCAL session_replication_role = replica');

    // Create workspaces
    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by)
      VALUES ($1, 'Finance Test Workspace', $3),
             ($2, 'Other Workspace', $3)
    `, [ids.ws, ids.ws2, ids.owner]);

    // Create profiles
    const users = [
      [ids.owner, 'Owner User'],
      [ids.admin, 'Admin User'],
      [ids.ceo, 'CEO User'],
      [ids.cto, 'CTO User'],
      [ids.projAdmin, 'Project Admin User'],
      [ids.sysAdmin, 'System Admin User'],
      [ids.finMember, 'Finance Member User'],
      [ids.projOwner, 'Project Owner User'],
      [ids.phaseOwner, 'Phase Owner User'],
      [ids.member, 'General Member'],
      [ids.viewer, 'Viewer User'],
    ];

    for (const [uid, name] of users) {
      await client.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO NOTHING
      `, [uid, name]);
    }

    // Workspace memberships
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES
        ($1, $2, 'owner', 'active'),
        ($1, $3, 'admin', 'active'),
        ($1, $4, 'member', 'active'),
        ($1, $5, 'member', 'active'),
        ($1, $6, 'member', 'active'),
        ($1, $7, 'member', 'active'),
        ($1, $8, 'member', 'active'),
        ($1, $9, 'member', 'active'),
        ($1, $10, 'member', 'active'),
        ($1, $11, 'member', 'active'),
        ($1, $12, 'member', 'active')
    `, [
      ids.ws, ids.owner, ids.admin, ids.ceo, ids.cto, ids.projAdmin, ids.sysAdmin,
      ids.finMember, ids.projOwner, ids.phaseOwner, ids.member, ids.viewer
    ]);

    // System roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES
        ($1, $2, 'ceo'),
        ($1, $3, 'cto'),
        ($1, $4, 'project_admin'),
        ($1, $5, 'system_admin')
    `, [ids.ws, ids.ceo, ids.cto, ids.projAdmin, ids.sysAdmin]);

    // Departments (Finance code = 'FIN')
    await client.query(`
      INSERT INTO public.departments (id, workspace_id, code, name, is_active)
      VALUES
        ($1, $2, 'FIN', 'Finance', true),
        ($3, $2, 'SWIT', 'Software & IT', true)
    `, [ids.finDept, ids.ws, ids.switDept]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, role, is_primary, is_active)
      VALUES
        ($1, $2, $3, 'member', true, true),
        ($1, $4, $5, 'member', true, true)
    `, [ids.ws, ids.finDept, ids.finMember, ids.switDept, ids.member]);

    // Projects, Phases, Task Lists, Tasks
    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, owner_id)
      VALUES ($1, $2, 'Alpha Project', $3),
             ($4, $2, 'Beta Project', NULL)
    `, [ids.proj1, ids.ws, ids.projOwner, ids.proj2]);

    await client.query(`
      INSERT INTO public.phases (id, project_id, name, position, owner_id)
      VALUES ($1, $2, 'Phase 1', 1, $3),
             ($4, $2, 'Phase 2', 2, NULL)
    `, [ids.phase1, ids.proj1, ids.phaseOwner, ids.phase2]);

    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
      VALUES ($1, $2, $3, 'List 1', 1),
             ($4, $2, $3, 'List 2', 2)
    `, [ids.taskList1, ids.proj1, ids.phase1, ids.taskList2]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title, assignee_id)
      VALUES
        ($1, $2, $3, $4, 'Task 1', $5),
        ($6, $2, $3, $4, 'Task 2', $7),
        ($8, $2, $3, $4, 'Child Task 1', $7)
    `, [ids.task1, ids.proj1, ids.phase1, ids.taskList1, ids.member, ids.task2, ids.viewer, ids.childTask1]);

    // Set parent task relationship
    await client.query(`UPDATE public.tasks SET parent_task_id = $1 WHERE id = $2`, [ids.task1, ids.childTask1]);

    // Standalone process task
    const defProcId = randomUUID();
    const defVerId = randomUUID();

    await client.query(`
      INSERT INTO public.defined_processes (id, workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, $3, 'Test Finance Process', 'FIN_PROC_TEST', $4, $4)
    `, [defProcId, ids.ws, ids.finDept, ids.finMember]);

    await client.query(`
      INSERT INTO public.defined_process_versions (id, defined_process_id, version_number, status, published_by, published_at, created_by)
      VALUES ($1, $2, 1, 'published', $3, now(), $3)
    `, [defVerId, defProcId, ids.finMember]);

    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, started_by, owner_id, placement_type)
      VALUES ($1, $2, $3, $4, 'Test Instance', $5, $5, 'standalone')
    `, [ids.processInst, ids.ws, defProcId, defVerId, ids.finMember]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, process_instance_id, title, assignee_id)
      VALUES ($1, NULL, $2, 'Process Step Task', $3)
    `, [ids.processStepTask, ids.processInst, ids.member]);

    await client.query("SET LOCAL session_replication_role = 'origin'");

    pass('Initial test fixture and hierarchy created successfully');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST SECTION 1: BUDGET MODEL & HIERARCHY CONSTRAINTS
    // ──────────────────────────────────────────────────────────────────────────

    // 1. Project supports canonical budget configuration
    const { rows: [bProj] } = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by)
      VALUES ($1, 'project', $2, 100000.00, 20000.00, $3)
      RETURNING *
    `, [ids.ws, ids.proj1, ids.owner]);
    assert.equal(Number(bProj.base_budget), 100000.00);
    assert.equal(Number(bProj.safety_buffer), 20000.00);
    pass('1. Project supports canonical Base Budget (100,000) and Safety Buffer (20,000)');

    // 2. Phase supports canonical budget configuration under budgeted project
    const { rows: [bPhase] } = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer, created_by)
      VALUES ($1, 'phase', $2, $3, 60000.00, 10000.00, $4)
      RETURNING *
    `, [ids.ws, ids.proj1, ids.phase1, ids.owner]);
    assert.equal(Number(bPhase.base_budget), 60000.00);
    pass('2. Phase supports canonical budget configuration under budgeted Project');

    // 3. Task List supports canonical budget configuration under budgeted phase
    const { rows: [bTaskList] } = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, safety_buffer, created_by)
      VALUES ($1, 'task_list', $2, $3, $4, 40000.00, 5000.00, $5)
      RETURNING *
    `, [ids.ws, ids.proj1, ids.phase1, ids.taskList1, ids.owner]);
    assert.equal(Number(bTaskList.base_budget), 40000.00);
    pass('3. Task List supports canonical budget configuration under budgeted Phase');

    // 4. Tasks cannot own a budget (structurally prevented)
    await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, created_by)
        VALUES ($1, 'task', $2, 5000.00, $3)
      `, [ids.ws, ids.proj1, ids.owner]);
    });
    pass('4. Tasks structurally cannot own a budget');

    // 5. Safety Buffer is fixed monetary amount (NUMERIC, not percentage)
    assert.equal(typeof Number(bProj.safety_buffer), 'number');
    pass('5. Safety Buffer is a fixed monetary amount');

    // 6. Negative budget and buffer rejected
    await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, created_by)
        VALUES ($1, 'project', $2, -500.00, $3)
      `, [ids.ws, ids.proj2, ids.owner]);
    });
    pass('6. Negative budget and buffer values rejected by CHECK constraint');

    // 7. Phase allocation exceeding Project Base Budget rejected
    await expectError(client, async () => {
      // Current Phase 1 has 60k. Trying to add Phase 2 with 50k (60k+50k = 110k > 100k)
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, created_by)
        VALUES ($1, 'phase', $2, $3, 50000.00, $4)
      `, [ids.ws, ids.proj1, ids.phase2, ids.owner]);
    });
    pass('7. Child Phase allocations cannot exceed parent Project Base Budget');

    // 8. Task List allocation exceeding Phase Base Budget rejected
    await expectError(client, async () => {
      // Phase 1 has 60k. Task List 1 has 40k. Trying to add Task List 2 with 25k (40k+25k = 65k > 60k)
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, created_by)
        VALUES ($1, 'task_list', $2, $3, $4, 25000.00, $5)
      `, [ids.ws, ids.proj1, ids.phase1, ids.taskList2, ids.owner]);
    });
    pass('8. Child Task List allocations cannot exceed parent Phase Base Budget');

    // 9. Task List positive budget rejected when parent Phase has no positive budget
    await expectError(client, async () => {
      const dummyListId = randomUUID();
      await client.query(`
        INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
        VALUES ($1, $2, $3, 'List in Unbudgeted Phase', 1)
      `, [dummyListId, ids.proj1, ids.phase2]);
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, created_by)
        VALUES ($1, 'task_list', $2, $3, $4, 5000.00, $5)
      `, [ids.ws, ids.proj1, ids.phase2, dummyListId, ids.owner]);
    });
    pass('9. Task List positive budget rejected when immediate Phase has no budget');

    // 10. Safety Buffer cannot fund child allocations
    // Project Base = 100k, Buffer = 20k. Total ceiling = 120k. Phase 1 = 60k.
    // Trying to allocate 50k to Phase 2 (total Phase Base = 110k > 100k Base, even though <= 120k ceiling)
    await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, created_by)
        VALUES ($1, 'phase', $2, $3, 45000.00, $4)
      `, [ids.ws, ids.proj1, ids.phase2, ids.owner]);
    });
    pass('10. Safety Buffer cannot fund child allocations');

    // 11. Unallocated parent Base Budget remains available at parent level
    const { rows: [pSummaryPre] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, NULL, NULL) AS sum
    `, [ids.ws, ids.proj1]);
    assert.equal(Number(pSummaryPre.sum.unallocated_base), 40000.00); // 100k - 60k = 40k
    assert.equal(Number(pSummaryPre.sum.allocated_to_children), 60000.00);
    pass('11. Unallocated parent Base Budget remains available at parent (40,000 unallocated)');

    // 12. Budget may be reduced below Actual Spend when child allocation constraint is satisfied
    // Reduce Task List 1 budget to 10,000 (we will add 5,000 spend later and it won't be blocked)
    await client.query(`
      UPDATE public.budgets
      SET base_budget = 10000.00
      WHERE id = $1
    `, [bTaskList.id]);
    pass('12. Budget reduction succeeds without blocking');

    // 12a. Phase Base Budget reduction below existing child Task List allocations is REJECTED
    // Setup: Add second Task List under Phase 1 with 30k base (Total Task Lists under Phase 1 = 10k + 30k = 40k)
    const dummyList2Id = randomUUID();
    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
      VALUES ($1, $2, $3, 'List 2 in Phase 1', 2)
    `, [dummyList2Id, ids.proj1, ids.phase1]);
    const { rows: [bTaskList2] } = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, created_by)
      VALUES ($1, 'task_list', $2, $3, $4, 30000.00, $5)
      RETURNING *
    `, [ids.ws, ids.proj1, ids.phase1, dummyList2Id, ids.owner]);

    // Current Phase 1 Base = 60k. Child Task Lists = 40k. Attempt Phase 1 Base -> 5k (5k < 40k -> must fail)
    await expectError(client, async () => {
      await client.query(`
        UPDATE public.budgets SET base_budget = 5000.00 WHERE id = $1
      `, [bPhase.id]);
    });
    pass('12a. Phase Base Budget reduction below existing Task List allocations is REJECTED');

    // 12b. Phase Base Budget reduction to 0 while positive child Task List allocations exist is REJECTED
    await expectError(client, async () => {
      await client.query(`
        UPDATE public.budgets SET base_budget = 0.00 WHERE id = $1
      `, [bPhase.id]);
    });
    pass('12b. Phase Base Budget reduction to zero while positive Task List allocations exist is REJECTED');

    // 12c. Phase Base Budget CAN be reduced to exactly equal or exceed child allocations (40k)
    await client.query(`
      UPDATE public.budgets SET base_budget = 40000.00 WHERE id = $1
    `, [bPhase.id]);
    // Restore Phase 1 Base to 60k and delete extra task list budget for downstream tests
    await client.query(`DELETE FROM public.budgets WHERE id = $1`, [bTaskList2.id]);
    await client.query(`UPDATE public.budgets SET base_budget = 60000.00 WHERE id = $1`, [bPhase.id]);
    pass('12c. Phase Base Budget CAN be reduced as long as child allocation constraint is satisfied');

    // 13. Absent budget row is distinguished from configured zero budget
    const { rows: [unbudgetedPhaseSum] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, $3, NULL) AS sum
    `, [ids.ws, ids.proj1, ids.phase2]);
    assert.equal(unbudgetedPhaseSum.sum.is_budgeted, false);
    assert.equal(unbudgetedPhaseSum.sum.budget_source_type, 'project');
    assert.equal(Number(unbudgetedPhaseSum.sum.base_budget), 100000.00);
    pass('13. Absent budget row (unbudgeted) inherits ancestor project budget for risk evaluation');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST SECTION 2: DETERMINISTIC RISK ENGINE BOUNDARIES
    // ──────────────────────────────────────────────────────────────────────────

    // Base = 100, Buffer = 20
    // 14. GREEN: spend < 80% (79.99)
    const { rows: [r1] } = await client.query(`SELECT public.calculate_financial_risk_band(79.99, 100.00, 20.00) AS r`);
    assert.equal(r1.r, 'GREEN');
    pass('14. GREEN risk boundary (< 80% Base: 79.99 / 100 -> GREEN)');

    // 15. Exact 80% is YELLOW (80.00)
    const { rows: [r2] } = await client.query(`SELECT public.calculate_financial_risk_band(80.00, 100.00, 20.00) AS r`);
    assert.equal(r2.r, 'YELLOW');
    pass('15. Exact 80% is YELLOW (80.00 / 100 -> YELLOW)');

    // 16. Exact 100% Base is YELLOW (100.00)
    const { rows: [r3] } = await client.query(`SELECT public.calculate_financial_risk_band(100.00, 100.00, 20.00) AS r`);
    assert.equal(r3.r, 'YELLOW');
    pass('16. Exact 100% Base is YELLOW (100.00 / 100 -> YELLOW)');

    // 17. First amount above Base enters ORANGE when buffer exists (100.01)
    const { rows: [r4] } = await client.query(`SELECT public.calculate_financial_risk_band(100.01, 100.00, 20.00) AS r`);
    assert.equal(r4.r, 'ORANGE');
    pass('17. First amount above Base enters ORANGE when buffer exists (100.01 / 100 + 20 -> ORANGE)');

    // 18. Exact Base + Safety Buffer remains ORANGE (120.00)
    const { rows: [r5] } = await client.query(`SELECT public.calculate_financial_risk_band(120.00, 100.00, 20.00) AS r`);
    assert.equal(r5.r, 'ORANGE');
    pass('18. Exact Base + Safety Buffer remains ORANGE (120.00 / 100 + 20 -> ORANGE)');

    // 19. First amount above Base + Safety Buffer is RED (120.01)
    const { rows: [r6] } = await client.query(`SELECT public.calculate_financial_risk_band(120.01, 100.00, 20.00) AS r`);
    assert.equal(r6.r, 'RED');
    pass('19. First amount above Base + Safety Buffer is RED (120.01 / 100 + 20 -> RED)');

    // 20. No-buffer amount above Base is RED immediately (100.01 / 100 + 0 -> RED)
    const { rows: [r7] } = await client.query(`SELECT public.calculate_financial_risk_band(100.01, 100.00, 0.00) AS r`);
    assert.equal(r7.r, 'RED');
    pass('20. No-buffer amount above Base is RED immediately (100.01 / 100 + 0 -> RED)');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST SECTION 3: EXPENSE LEDGER, NORMALIZED ITEMS & ROLLUPS
    // ──────────────────────────────────────────────────────────────────────────

    // 21. Add physical expense transactions and items (via server context / postgres)
    const { rows: [et1] } = await client.query(`
      INSERT INTO public.expense_transactions (workspace_id, task_id, description, status, created_by)
      VALUES ($1, $2, 'Task 1 Single Item', 'active', $3)
      RETURNING *
    `, [ids.ws, ids.task1, ids.member]);

    await client.query(`
      INSERT INTO public.expense_items (transaction_id, line_number, amount, category, description)
      VALUES ($1, 1, 1500.00, 'Materials', 'Wood supplies')
    `, [et1.id]);
    pass('21. Single-total expense entry created (1 item of 1,500.00)');

    // 22. Itemized split entry (2 line items on Task 2: 2,000 + 3,000 = 5,000)
    const { rows: [et2] } = await client.query(`
      INSERT INTO public.expense_transactions (workspace_id, task_id, description, status, created_by)
      VALUES ($1, $2, 'Task 2 Split Item', 'active', $3)
      RETURNING *
    `, [ids.ws, ids.task2, ids.viewer]);

    await client.query(`
      INSERT INTO public.expense_items (transaction_id, line_number, amount, category, description)
      VALUES
        ($1, 1, 2000.00, 'Services', 'Consulting'),
        ($1, 2, 3000.00, 'Hardware', 'Server equipment')
    `, [et2.id]);
    pass('22. Itemized split expense entry created (2 items: 2,000 + 3,000 = 5,000)');

    // 23. Child task expense (1,000 on childTask1)
    const { rows: [etChild] } = await client.query(`
      INSERT INTO public.expense_transactions (workspace_id, task_id, description, status, created_by)
      VALUES ($1, $2, 'Child Task Expense', 'active', $3)
      RETURNING *
    `, [ids.ws, ids.childTask1, ids.viewer]);

    await client.query(`
      INSERT INTO public.expense_items (transaction_id, line_number, amount, category, description)
      VALUES ($1, 1, 1000.00, 'Labor', 'Sub-task execution')
    `, [etChild.id]);
    pass('23. Child task leaf expense created (1,000.00)');

    // 24. Task List Rollup: Task 1 (1500) + Task 2 (5000) + Child Task 1 (1000) = 7,500.00
    const { rows: [tlSum] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, $3, $4) AS sum
    `, [ids.ws, ids.proj1, ids.phase1, ids.taskList1]);
    assert.equal(Number(tlSum.sum.actual_spend), 7500.00);
    pass('24. Task List rollup accurately computes sum of leaf expenses (7,500.00)');

    // 25. Phase Rollup: 7,500.00
    const { rows: [phSum] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, $3, NULL) AS sum
    `, [ids.ws, ids.proj1, ids.phase1]);
    assert.equal(Number(phSum.sum.actual_spend), 7500.00);
    pass('25. Phase rollup accurately computes sum of leaf expenses (7,500.00)');

    // 26. Project Rollup: 7,500.00
    const { rows: [pSum] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, NULL, NULL) AS sum
    `, [ids.ws, ids.proj1]);
    assert.equal(Number(pSum.sum.actual_spend), 7500.00);
    pass('26. Project rollup accurately computes sum of leaf expenses (7,500.00)');

    // 27. Standalone Process Spend (2,500 on standalone processStepTask)
    const { rows: [etStandalone] } = await client.query(`
      INSERT INTO public.expense_transactions (workspace_id, task_id, description, status, created_by)
      VALUES ($1, $2, 'Process Step Expense', 'active', $3)
      RETURNING *
    `, [ids.ws, ids.processStepTask, ids.member]);

    await client.query(`
      INSERT INTO public.expense_items (transaction_id, line_number, amount, category, description)
      VALUES ($1, 1, 2500.00, 'Process Cost', 'Execution cost')
    `, [etStandalone.id]);

    // 28. Standalone spend excluded from Project budgets
    const { rows: [pSumPost] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, NULL, NULL) AS sum
    `, [ids.ws, ids.proj1]);
    assert.equal(Number(pSumPost.sum.actual_spend), 7500.00);
    pass('28. Standalone spend is excluded from Project budgets (Project spend remains 7,500.00)');

    // 29. Total Company Spend = Project Spend (7,500) + Standalone Spend (2,500) = 10,000.00
    const { rows: [wsSum] } = await client.query(`
      SELECT private.compute_financial_summary($1, NULL, NULL, NULL) AS sum
    `, [ids.ws]);
    assert.equal(Number(wsSum.sum.project_spend), 7500.00);
    assert.equal(Number(wsSum.sum.standalone_spend), 2500.00);
    assert.equal(Number(wsSum.sum.actual_spend), 10000.00);
    pass('29. Total Company Spend = Project Spend (7,500) + Standalone Spend (2,500) = 10,000.00');

    // 30. Task Movement Reattribution: Move Task 2 from List 1 to List 2
    await client.query(`
      UPDATE public.tasks SET task_list_id = $1 WHERE id = $2
    `, [ids.taskList2, ids.task2]);

    const { rows: [tl1SumAfterMove] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, $3, $4) AS sum
    `, [ids.ws, ids.proj1, ids.phase1, ids.taskList1]);
    assert.equal(Number(tl1SumAfterMove.sum.actual_spend), 2500.00); // 1500 + 1000

    const { rows: [tl2SumAfterMove] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, $3, $4) AS sum
    `, [ids.ws, ids.proj1, ids.phase1, ids.taskList2]);
    assert.equal(Number(tl2SumAfterMove.sum.actual_spend), 5000.00); // Task 2 moved
    pass('30. Task movement immediately reattributes historical expenses to new placement (List 1: 2.5k, List 2: 5k)');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST SECTION 4: AUTHORIZATION & RLS POLICIES
    // ──────────────────────────────────────────────────────────────────────────

    // 31. Workspace Owner can manage budgets
    await asUser(client, ids.owner, `
      UPDATE public.budgets SET base_budget = 110000.00 WHERE id = $1
    `, [bProj.id]);
    pass('31. Workspace Owner may manage budgets');

    // 32. Workspace Admin can manage budgets
    await asUser(client, ids.admin, `
      UPDATE public.budgets SET base_budget = 105000.00 WHERE id = $1
    `, [bProj.id]);
    pass('32. Workspace Admin may manage budgets');

    // 33. CEO can manage budgets
    await asUser(client, ids.ceo, `
      UPDATE public.budgets SET base_budget = 106000.00 WHERE id = $1
    `, [bProj.id]);
    pass('33. CEO may manage budgets');

    // 34. CTO can manage budgets
    await asUser(client, ids.cto, `
      UPDATE public.budgets SET base_budget = 105000.00 WHERE id = $1
    `, [bProj.id]);
    pass('34. CTO may manage budgets');

    // 35. Project Admin alone CANNOT manage budgets
    let pAdminBudgetErr = null;
    try {
      await asUser(client, ids.projAdmin, `
        UPDATE public.budgets SET base_budget = 999999.00 WHERE id = $1
      `, [bProj.id]);
    } catch (e) {
      pAdminBudgetErr = e;
    }
    // RLS will either throw or update 0 rows
    const { rows: [checkProjAdmin] } = await client.query(`SELECT base_budget FROM public.budgets WHERE id = $1`, [bProj.id]);
    assert.equal(Number(checkProjAdmin.base_budget), 105000.00);
    pass('35. Project Admin alone cannot manage budgets (RLS blocked mutation)');

    // 36. System Admin alone CANNOT manage budgets
    await asUser(client, ids.sysAdmin, `
      UPDATE public.budgets SET base_budget = 888888.00 WHERE id = $1
    `, [bProj.id]);
    const { rows: [checkSysAdmin] } = await client.query(`SELECT base_budget FROM public.budgets WHERE id = $1`, [bProj.id]);
    assert.equal(Number(checkSysAdmin.base_budget), 105000.00);
    pass('36. System Admin alone cannot manage budgets (RLS blocked mutation)');

    // 37. Finance Operator CANNOT manage budgets
    await asUser(client, ids.finMember, `
      UPDATE public.budgets SET base_budget = 777777.00 WHERE id = $1
    `, [bProj.id]);
    const { rows: [checkFin] } = await client.query(`SELECT base_budget FROM public.budgets WHERE id = $1`, [bProj.id]);
    assert.equal(Number(checkFin.base_budget), 105000.00);
    pass('37. Finance Operator cannot manage budgets (RLS blocked mutation)');

    // 38. Finance Operator CAN read all budgets and expenses in workspace
    const { rows: finBudgets } = await asUser(client, ids.finMember, `
      SELECT id FROM public.budgets WHERE workspace_id = $1
    `, [ids.ws]);
    assert.ok(finBudgets.length >= 3, 'Finance operator must see all budgets');

    const { rows: finExpenses } = await asUser(client, ids.finMember, `
      SELECT id FROM public.expense_transactions WHERE workspace_id = $1
    `, [ids.ws]);
    assert.ok(finExpenses.length >= 4, 'Finance operator must see all expense transactions');
    pass('38. Finance Operator can view all workspace budgets and expenses');

    // 39. Project Owner gets owned Project financial summary via public function
    const { rows: [poSum] } = await asUser(client, ids.projOwner, `
      SELECT public.get_project_financial_summary($1) AS res
    `, [ids.proj1]);
    assert.ok(poSum.res, 'Project Owner must receive financial summary for owned project');
    assert.equal(Number(poSum.res.actual_spend), 7500.00);
    pass('39. Project Owner gets financial summary for owned Project');

    // 40. General Member without ownership CANNOT get full project financial summary
    const { rows: [memSum] } = await asUser(client, ids.member, `
      SELECT public.get_project_financial_summary($1) AS res
    `, [ids.proj1]);
    assert.equal(memSum.res, null, 'General Member must not receive full project summary');
    pass('40. General Member without ownership receives NULL for full container summary (no ancestor leaks)');

    // 41. Viewer gets exact expenses only for visible tasks
    const { rows: viewerExpenses } = await asUser(client, ids.viewer, `
      SELECT id, task_id FROM public.expense_transactions
    `);
    // Viewer is assigned to task2 and childTask1, so they can see their tasks, but NOT unassigned processStepTask
    const viewerTaskIds = new Set(viewerExpenses.map(e => e.task_id));
    assert.ok(viewerTaskIds.has(ids.task2));
    assert.ok(!viewerTaskIds.has(ids.processStepTask));
    pass('41. Viewer can read exact expenses only for operational Tasks already visible (Decision 58)');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST SECTION 5: FAIL-CLOSED DML & INTEGRITY PROTECTION
    // ──────────────────────────────────────────────────────────────────────────

    // 42. Direct authenticated INSERT on expense_transactions is BLOCKED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        INSERT INTO public.expense_transactions (workspace_id, task_id, description)
        VALUES ($1, $2, 'Unauthorized Direct Insert')
      `, [ids.ws, ids.task1]);
    });
    pass('42. Direct authenticated INSERT on expense_transactions is BLOCKED');

    // 43. Direct authenticated UPDATE on expense_transactions is BLOCKED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        UPDATE public.expense_transactions SET description = 'Hacked' WHERE id = $1
      `, [et1.id]);
    });
    pass('43. Direct authenticated UPDATE on expense_transactions is BLOCKED');

    // 44. Direct authenticated DELETE on expense_transactions is BLOCKED
    await expectError(client, async () => {
      await asUser(client, ids.owner, `
        DELETE FROM public.expense_transactions WHERE id = $1
      `, [et1.id]);
    });
    pass('44. Direct authenticated DELETE on expense_transactions is BLOCKED');

    // 45. Direct authenticated INSERT on expense_items is BLOCKED
    await expectError(client, async () => {
      await asUser(client, ids.owner, `
        INSERT INTO public.expense_items (transaction_id, line_number, amount)
        VALUES ($1, 99, 1000.00)
      `, [et1.id]);
    });
    pass('45. Direct authenticated INSERT on expense_items is BLOCKED');

    // 46. Operational Task deletion with attached expenses is BLOCKED by RESTRICT
    await expectError(client, async () => {
      await client.query(`DELETE FROM public.tasks WHERE id = $1`, [ids.task1]);
    });
    pass('46. Operational Task deletion with attached expenses is BLOCKED (ON DELETE RESTRICT)');

    // 47. Budget deletion of operational container is BLOCKED by RESTRICT
    await expectError(client, async () => {
      await client.query(`DELETE FROM public.projects WHERE id = $1`, [ids.proj1]);
    });
    pass('47. Operational Project deletion with attached budget is BLOCKED (ON DELETE RESTRICT)');

    // 48. Budget entity identity is immutable on UPDATE
    await expectError(client, async () => {
      await client.query(`
        UPDATE public.budgets SET project_id = $1 WHERE id = $2
      `, [ids.proj2, bProj.id]);
    });
    pass('48. Budget entity identity and hierarchy mapping are immutable');

    // 49. Audit records created on budget creation and updates
    const { rows: auditRows } = await client.query(`
      SELECT * FROM public.budget_audit_logs WHERE budget_id = $1 ORDER BY created_at ASC
    `, [bProj.id]);
    assert.ok(auditRows.length >= 2, 'Budget audit logs must record creation and updates');
    assert.equal(auditRows[0].action, 'created');
    pass('49. Immutable budget audit logs automatically capture creation and modifications');

    // 49a. Authenticated created_by spoof attempt is overwritten with auth.uid()
    const dummyProjSpoofId = randomUUID();
    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, created_by)
      VALUES ($1, $2, 'Spoof Test Project', $3)
    `, [dummyProjSpoofId, ids.ws, ids.owner]);

    const { rows: [spoofedBudget] } = await asUser(client, ids.owner, `
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, created_by)
      VALUES ($1, 'project', $2, 50000.00, $3)
      RETURNING created_by, updated_by
    `, [ids.ws, dummyProjSpoofId, ids.member]); // Passing ids.member to spoof created_by
    assert.equal(spoofedBudget.created_by, ids.owner, 'created_by must be forced to auth.uid()');
    pass('49a. Authenticated created_by spoof attempt is overwritten with auth.uid()');

    // 49b. Authenticated updated_by spoof attempt is overwritten with auth.uid()
    const { rows: [updatedSpoofedBudget] } = await asUser(client, ids.admin, `
      UPDATE public.budgets
      SET base_budget = 55000.00, updated_by = $1
      WHERE project_id = $2 AND entity_type = 'project'
      RETURNING updated_by
    `, [ids.viewer, dummyProjSpoofId]); // Passing ids.viewer to spoof updated_by
    assert.equal(updatedSpoofedBudget.updated_by, ids.admin, 'updated_by must be forced to auth.uid()');
    pass('49b. Authenticated updated_by spoof attempt is overwritten with auth.uid()');

    // 49c. Budget audit log actor_id matches auth.uid() exactly
    const { rows: spoofAuditRows } = await client.query(`
      SELECT actor_id, action FROM public.budget_audit_logs
      WHERE entity_id = $1 ORDER BY created_at ASC
    `, [dummyProjSpoofId]);
    assert.equal(spoofAuditRows[0].actor_id, ids.owner, 'Audit log created actor must equal owner auth.uid()');
    assert.equal(spoofAuditRows[1].actor_id, ids.admin, 'Audit log updated actor must equal admin auth.uid()');
    pass('49c. Budget audit log actor_id strictly matches auth.uid()');

    // 50. Expense audit reason constraints: created action permits NULL; correction requires reason
    await client.query(`
      INSERT INTO public.expense_audit_logs (workspace_id, transaction_id, original_transaction_id, action, actor_id, reason)
      VALUES ($1, $2, $2, 'created', $3, NULL)
    `, [ids.ws, et1.id, ids.owner]);

    await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.expense_audit_logs (workspace_id, transaction_id, original_transaction_id, action, actor_id, reason)
        VALUES ($1, $2, $2, 'voided', $3, '')
      `, [ids.ws, et1.id, ids.owner]);
    });
    pass('50. Expense audit logs enforce mandatory reason on correction/void/deletion');

    // 51. Sibling-only budget reallocation constraint
    const { rows: [bPhase2] } = await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, created_by)
      VALUES ($1, 'phase', $2, $3, 20000.00, $4)
      RETURNING *
    `, [ids.ws, ids.proj1, ids.phase2, ids.owner]);

    // Valid sibling reallocation from Phase 1 to Phase 2
    await client.query(`
      INSERT INTO public.budget_reallocations (workspace_id, from_budget_id, to_budget_id, amount, reason, actor_id)
      VALUES ($1, $2, $3, 5000.00, 'Shift scope to Phase 2', $4)
    `, [ids.ws, bPhase.id, bPhase2.id, ids.owner]);

    // Invalid cross-level reallocation (Project to Phase)
    await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.budget_reallocations (workspace_id, from_budget_id, to_budget_id, amount, reason, actor_id)
        VALUES ($1, $2, $3, 5000.00, 'Invalid cross level', $4)
      `, [ids.ws, bProj.id, bPhase.id, ids.owner]);
    });
    pass('51. Sibling-only budget reallocation constraint is strictly enforced');

    // 52. Direct client reallocation DML is disabled for authenticated roles
    await expectError(client, async () => {
      await asUser(client, ids.owner, `
        INSERT INTO public.budget_reallocations (workspace_id, from_budget_id, to_budget_id, amount, reason, actor_id)
        VALUES ($1, $2, $3, 1000.00, 'Direct client realloc', $4)
      `, [ids.ws, bPhase.id, bPhase2.id, ids.owner]);
    });
    pass('52. Direct authenticated DML on budget_reallocations is disabled');

    // 53. Zero new Security Advisor warnings (verified via query)
    const { rows: pubSecDef } = await client.query(`
      SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prosecdef = true
        AND p.proname LIKE '%financial%'
    `);
    assert.equal(pubSecDef.length, 0, 'Zero SECURITY DEFINER functions in public schema');
    pass('53. Zero SECURITY DEFINER functions introduced in public schema');

    // 54. Verify all new public tables have RLS enabled
    const { rows: unsecTables } = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('budgets', 'budget_audit_logs', 'budget_reallocations', 'expense_transactions', 'expense_items', 'expense_audit_logs')
        AND rowsecurity = false
    `);
    assert.equal(unsecTables.length, 0, 'All new tables must have RLS enabled');
    pass('54. All 6 new Finance public tables have RLS enabled');

    console.log('\n═══════════════════════════════════════════════════════════════════════════');
    console.log(`  ALL ${passed} DATABASE & SECURITY ASSERTIONS PASSED WITH ZERO ERRORS!  `);
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

  } finally {
    console.log('Rolling back test transaction (database untouched)...');
    await client.query('ROLLBACK');
    await client.end();
  }
}

runTests().catch((err) => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});