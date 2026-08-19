import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

function parseEnv(content) {
  return content.split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return acc;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length > 0) {
      acc[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
    return acc;
  }, {});
}

let passed = 0;
function pass(msg) {
  passed += 1;
  console.log(`[PASS ${String(passed).padStart(2, '0')}] ${msg}`);
}

async function expectError(client, fn, expectedMsgSubstr = null) {
  await client.query('SAVEPOINT sp_err');
  try {
    await fn();
    assert.fail('Expected operation to fail, but it succeeded');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_err');
    if (expectedMsgSubstr) {
      assert.ok(
        err.message.includes(expectedMsgSubstr),
        `Expected error message to contain "${expectedMsgSubstr}", got: "${err.message}"`
      );
    }
  }
}

async function asUser(client, userId, sql, params = []) {
  await client.query('SET LOCAL ROLE authenticated');
  let result;
  try {
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', 'authenticated', true)`,
      [userId],
    );
    result = await client.query(sql, params);
  } catch (error) {
    try {
      await client.query('RESET ROLE');
    } catch {
      // ignore
    }
    throw error;
  }
  await client.query('RESET ROLE');
  return result;
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — PACKAGE 5 / P5-01 EXPENSE EXECUTION & AUDIT TEST SUITE   ');
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
    // 1. Apply the P5-01 migration inside the isolated test transaction
    const p5MigrationSql = await readFile(
      path.join('supabase', 'migrations', '20260819131603_p5_01_expense_execution_runtime.sql'),
      'utf8',
    );
    await client.query(p5MigrationSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-01 migration 20260819131603 inside test transaction');

    // 2. Set up test entities
    const ids = {
      ws: randomUUID(),
      ws2: randomUUID(),
      owner: randomUUID(),
      admin: randomUUID(),
      ceo: randomUUID(),
      cto: randomUUID(),
      projAdmin: randomUUID(),
      finMember: randomUUID(),
      projOwner: randomUUID(),
      member: randomUUID(),
      unrelatedMember: randomUUID(),
      viewer: randomUUID(),
      finDept: randomUUID(),
      proj1: randomUUID(),
      phase1: randomUUID(),
      list1: randomUUID(),
      list2: randomUUID(),
      statusTodo: randomUUID(),
      statusDone: randomUUID(),
      leafTask1: randomUUID(),
      leafTask2: randomUUID(),
      leafTask3: randomUUID(),
      leafTask4: randomUUID(),
      parentTask: randomUUID(),
      childTask1: randomUUID(),
      childTask2: randomUUID(),
      projectlessTask: randomUUID(),
      defProc: randomUUID(),
      procVer: randomUUID(),
      step1: randomUUID(),
      step2: randomUUID(),
      stepEvidenceDef: randomUUID(),
      procInst: randomUUID(),
      stepTask1: randomUUID(),
      stepTask2: randomUUID(),
    };

    await client.query('SET LOCAL session_replication_role = replica');

    // Profiles
    const profiles = [
      [ids.owner, 'Workspace Owner'],
      [ids.admin, 'Workspace Admin'],
      [ids.ceo, 'Executive CEO'],
      [ids.cto, 'Executive CTO'],
      [ids.projAdmin, 'Project Admin User'],
      [ids.finMember, 'Finance Operator'],
      [ids.projOwner, 'Project Owner User'],
      [ids.member, 'General Member User'],
      [ids.unrelatedMember, 'Unrelated Member User'],
      [ids.viewer, 'Viewer User'],
    ];

    for (const [pId, name] of profiles) {
      await client.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO NOTHING
      `, [pId, name]);
    }

    // Workspaces
    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by)
      VALUES ($1, 'P5 Primary Workspace', $2),
             ($3, 'P5 Other Workspace', $2)
    `, [ids.ws, ids.owner, ids.ws2]);

    // Memberships
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
        ($1, $10, 'viewer', 'active'),
        ($11, $12, 'member', 'active')
    `, [
      ids.ws, ids.owner, ids.admin, ids.ceo, ids.cto, ids.projAdmin,
      ids.finMember, ids.projOwner, ids.member, ids.viewer,
      ids.ws2, ids.unrelatedMember
    ]);

    // System roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES ($1, $2, 'ceo'),
             ($1, $3, 'cto'),
             ($1, $4, 'project_admin')
    `, [ids.ws, ids.ceo, ids.cto, ids.projAdmin]);

    // Finance Department (FIN)
    await client.query(`
      INSERT INTO public.departments (id, workspace_id, code, name, is_active)
      VALUES ($1, $2, 'FIN', 'Finance', true)
    `, [ids.finDept, ids.ws]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, role, is_primary, is_active)
      VALUES ($1, $2, $3, 'member', true, true)
    `, [ids.ws, ids.finDept, ids.finMember]);

    // Project, Phase, Task Lists
    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, owner_id, created_by)
      VALUES ($1, $2, 'P5 Execution Project', $3, $4)
    `, [ids.proj1, ids.ws, ids.projOwner, ids.owner]);

    await client.query(`
      INSERT INTO public.phases (id, project_id, name, position, owner_id)
      VALUES ($1, $2, 'P5 Phase 1', 1, $3)
    `, [ids.phase1, ids.proj1, ids.projOwner]);

    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
      VALUES ($1, $2, $3, 'P5 List 1', 1),
             ($4, $2, $3, 'P5 List 2', 2)
    `, [ids.list1, ids.proj1, ids.phase1, ids.list2]);

    // Task Statuses
    await client.query(`
      INSERT INTO public.task_statuses (id, project_id, name, color, position, system_code)
      VALUES ($1, $2, 'Todo', '#6B7280', 1, 'todo'),
             ($3, $2, 'Done', '#10B981', 2, 'done')
    `, [ids.statusTodo, ids.proj1, ids.statusDone]);

    // Budgets on Project & Phase
    await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by)
      VALUES ($1, 'project', $2, 100000.00, 20000.00, $3)
    `, [ids.ws, ids.proj1, ids.owner]);

    await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer, created_by)
      VALUES ($1, 'phase', $2, $3, 60000.00, 10000.00, $4)
    `, [ids.ws, ids.proj1, ids.phase1, ids.owner]);

    // Ordinary Tasks
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, status_id, title, assignee_id, owner_id, created_by)
      VALUES ($1, $2, $3, $4, $5, 'Ordinary Leaf Task 1', $6, $6, $7),
             ($8, $2, $3, $4, $5, 'Ordinary Leaf Task 2', $6, $6, $7),
             ($9, $2, $3, $4, $5, 'Ordinary Leaf Task 3', $6, $6, $7),
             ($10, $2, $3, $4, $5, 'Ordinary Leaf Task 4', $6, $6, $7)
    `, [ids.leafTask1, ids.proj1, ids.phase1, ids.list1, ids.statusTodo, ids.member, ids.owner,
        ids.leafTask2, ids.leafTask3, ids.leafTask4]);

    // Parent Task with 2 Children
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, status_id, title, assignee_id, created_by)
      VALUES ($1, $2, $3, $4, $5, 'Parent Task', $6, $7)
    `, [ids.parentTask, ids.proj1, ids.phase1, ids.list1, ids.statusTodo, ids.member, ids.owner]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, status_id, parent_task_id, title, assignee_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'Child Task 1', $7, $8),
             ($9, $2, $3, $4, $5, $6, 'Child Task 2', $7, $8)
    `, [ids.childTask1, ids.proj1, ids.phase1, ids.list1, ids.statusTodo, ids.parentTask, ids.member, ids.owner,
        ids.childTask2]);

    // Projectless Task
    await client.query(`
      INSERT INTO public.tasks (id, title, assignee_id, created_by)
      VALUES ($1, 'Projectless Task', $2, $3)
    `, [ids.projectlessTask, ids.member, ids.owner]);

    // RACI assignment for member on leaf tasks
    for (const tId of [ids.leafTask1, ids.leafTask2, ids.leafTask3, ids.leafTask4, ids.childTask1, ids.childTask2]) {
      await client.query(`
        INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
        VALUES ($1, 'R', $2)
        ON CONFLICT DO NOTHING
      `, [tId, ids.member]);
    }

    // Defined Process Setup
    await client.query(`
      INSERT INTO public.defined_processes (id, workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, $3, 'P5 Deployment Process', 'P5-DEP', $4, $4)
    `, [ids.defProc, ids.ws, ids.finDept, ids.owner]);

    await client.query(`
      INSERT INTO public.defined_process_versions (id, defined_process_id, version_number, status, published_by, published_at, created_by)
      VALUES ($1, $2, 1, 'published', $3, now(), $3)
    `, [ids.procVer, ids.defProc, ids.owner]);

    await client.query(`
      INSERT INTO public.defined_process_steps (id, version_id, step_code, title, sequence_order, expected_duration_days, approval_required, consultation_required)
      VALUES ($1, $2, 'STEP-1', 'Step 1 - Hardware Config', 1, 1, true, false),
             ($3, $2, 'STEP-2', 'Step 2 - Final Deployment', 2, 1, false, false)
    `, [ids.step1, ids.procVer, ids.step2]);

    await client.query(`
      INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
      VALUES ($1, $2, $3)
    `, [ids.procVer, ids.step2, ids.step1]);

    // Step 1 RACI: Responsible = member, Accountable = admin
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, actor_type, user_id)
      VALUES ($1, 'R', 'user', $2),
             ($1, 'A', 'user', $3),
             ($4, 'R', 'user', $2)
    `, [ids.step1, ids.member, ids.admin, ids.step2]);

    // Process Instance attached to Project 1 / Phase 1 / List 1
    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, placement_type, project_id, phase_id, task_list_id, started_by, owner_id, status)
      VALUES ($1, $2, $3, $4, 'P5 Hardware Instance', 'task_list', $5, $6, $7, $8, $8, 'running')
    `, [ids.procInst, ids.ws, ids.defProc, ids.procVer, ids.proj1, ids.phase1, ids.list1, ids.owner]);

    // Materialized Step Tasks
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, process_instance_id, process_step_id, defined_process_version_id, title, workflow_state, current_cycle_number, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Step 1 Task', 'ready', 1, $8),
             ($9, $2, $3, $4, $5, $10, $7, 'Step 2 Task', 'waiting', 1, $8)
    `, [ids.stepTask1, ids.proj1, ids.phase1, ids.list1, ids.procInst, ids.step1, ids.procVer, ids.owner,
        ids.stepTask2, ids.step2]);

    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2), ($1, 'A', $3), ($4, 'R', $2)
    `, [ids.stepTask1, ids.member, ids.admin, ids.stepTask2]);

    // Reset session_replication_role
    await client.query("SET LOCAL session_replication_role = 'origin'");

    pass('Initial P5 test fixtures and entities created successfully');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 1: ORDINARY TASK COMPLETION + ATOMIC EXPENSE CAPTURE
    // ──────────────────────────────────────────────────────────────────────────

    // 1. Ordinary leaf Task completes WITHOUT expense
    const res1 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1) AS res
    `, [ids.leafTask1]);
    assert.equal(res1.rows[0].res.status, 'done');
    assert.equal(res1.rows[0].res.transaction_id, null);
    const { rows: [t1] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.leafTask1]);
    assert.equal(t1.status_id, ids.statusDone);
    pass('1. Ordinary leaf Task completes without expense');

    // 2. Ordinary leaf Task completes atomically with SINGLE total expense (Mode A)
    const res2 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb, 'Setup completed with hardware purchase') AS res
    `, [ids.leafTask2, JSON.stringify({ amount: 1500.00, category: 'Hardware', description: 'Network switch' })]);
    assert.equal(res2.rows[0].res.status, 'done');
    assert.ok(res2.rows[0].res.transaction_id, 'Must return generated transaction ID');
    assert.equal(Number(res2.rows[0].res.total_expense), 1500.00);

    const tx2Id = res2.rows[0].res.transaction_id;
    const { rows: tx2Rows } = await client.query(`SELECT * FROM public.expense_transactions WHERE id = $1`, [tx2Id]);
    assert.equal(tx2Rows.length, 1);
    assert.equal(tx2Rows[0].status, 'active');
    assert.equal(tx2Rows[0].created_by, ids.member);

    const { rows: item2Rows } = await client.query(`SELECT * FROM public.expense_items WHERE transaction_id = $1`, [tx2Id]);
    assert.equal(item2Rows.length, 1);
    assert.equal(Number(item2Rows[0].amount), 1500.00);
    assert.equal(item2Rows[0].category, 'Hardware');
    pass('2. Ordinary leaf Task completes atomically with single total expense (Mode A)');

    // 3. Ordinary leaf Task completes atomically with ITEMIZED split expenses (Mode B)
    const res3 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.leafTask3, JSON.stringify({
      expense_date: '2026-08-18',
      description: 'Split supplies and labor',
      items: [
        { amount: 2000.00, category: 'Equipment', description: 'Cabling' },
        { amount: 3000.00, category: 'Contractor', description: 'Installation labor' }
      ]
    })]);
    assert.equal(res3.rows[0].res.status, 'done');
    assert.equal(Number(res3.rows[0].res.total_expense), 5000.00);
    const tx3Id = res3.rows[0].res.transaction_id;

    const { rows: item3Rows } = await client.query(`SELECT * FROM public.expense_items WHERE transaction_id = $1 ORDER BY line_number`, [tx3Id]);
    assert.equal(item3Rows.length, 2);
    assert.equal(Number(item3Rows[0].amount), 2000.00);
    assert.equal(Number(item3Rows[1].amount), 3000.00);
    pass('3. Ordinary leaf Task completes atomically with itemized split expenses (Mode B)');

    // 4. Parent Task direct expense capture is REJECTED (Decision 17)
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.parentTask, JSON.stringify({ amount: 1000.00 })]);
    }, 'Parent tasks with child dependencies cannot capture direct expenses');
    pass('4. Parent Task direct expense capture is strictly REJECTED (Decision 17)');

    // 5. Parent automatic completion creates ZERO expense transactions
    // Complete Child Task 1 (with 500.00 expense)
    await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.childTask1, JSON.stringify({ amount: 500.00 })]);
    // Complete Child Task 2 (without expense) -> parent automatically completes!
    await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1) AS res
    `, [ids.childTask2]);

    const { rows: [pTaskStatus] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.parentTask]);
    assert.equal(pTaskStatus.status_id, ids.statusDone, 'Parent task must auto-complete to Done');

    const { rows: parentTxRows } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.parentTask]);
    assert.equal(parentTxRows.length, 0, 'Parent task must have ZERO direct expense transactions');
    pass('5. Parent automatic completion creates zero direct expense transactions');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 2: DEFINED PROCESS EXECUTION & REWORK CUMULATIVE EXPENSES
    // ──────────────────────────────────────────────────────────────────────────

    // 6. Defined Process Step Cycle 1 expense capture
    const resStep1 = await asUser(client, ids.member, `
      SELECT public.complete_responsible_step_with_expense($1, 1, 'Completed initial configuration', $2::jsonb) AS res
    `, [ids.stepTask1, JSON.stringify({ amount: 1000.00, category: 'Setup' })]);
    assert.equal(resStep1.rows[0].res.status, 'in_review', 'Approval required step moves to in_review');
    assert.ok(resStep1.rows[0].res.transaction_id);
    assert.equal(Number(resStep1.rows[0].res.total_expense), 1000.00);

    const step1TxId = resStep1.rows[0].res.transaction_id;
    const { rows: [step1Tx] } = await client.query(`SELECT * FROM public.expense_transactions WHERE id = $1`, [step1TxId]);
    assert.equal(step1Tx.cycle_number, 1, 'Cycle number 1 recorded on expense transaction');
    pass('6. Defined Process Step Cycle 1 records expense with cycle provenance');

    // 7. Approval-required Step records expense ONCE; Accountable approval creates ZERO duplicate expenses
    await asUser(client, ids.admin, `
      SELECT public.approve_process_task($1) AS res
    `, [ids.stepTask1]);

    const { rows: step1Approvals } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.stepTask1]);
    assert.equal(step1Approvals.length, 1, 'Accountable approval must NOT create a duplicate expense transaction');
    pass('7. Accountable approval advances step without creating duplicate expense');

    // 8. Rejection / Rework cycle setup:
    // Create new process instance & step task for rework scenario
    const reworkProcInstId = randomUUID();
    const reworkStepTaskId = randomUUID();
    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, placement_type, project_id, phase_id, task_list_id, started_by, owner_id, status)
      VALUES ($1, $2, $3, $4, 'P5 Rework Instance', 'task_list', $5, $6, $7, $8, $8, 'running')
    `, [reworkProcInstId, ids.ws, ids.defProc, ids.procVer, ids.proj1, ids.phase1, ids.list1, ids.owner]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, process_instance_id, process_step_id, defined_process_version_id, title, workflow_state, current_cycle_number, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Rework Test Step Task', 'ready', 1, $8)
    `, [reworkStepTaskId, ids.proj1, ids.phase1, ids.list1, reworkProcInstId, ids.step1, ids.procVer, ids.owner]);

    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2), ($1, 'A', $3)
    `, [reworkStepTaskId, ids.member, ids.admin]);

    // Cycle 1 completion with 1,000.00 expense
    const resReworkC1 = await asUser(client, ids.member, `
      SELECT public.complete_responsible_step_with_expense($1, 1, 'Cycle 1 Work', $2::jsonb) AS res
    `, [reworkStepTaskId, JSON.stringify({ amount: 1000.00, category: 'Hardware' })]);
    const reworkC1TxId = resReworkC1.rows[0].res.transaction_id;

    // Accountable rejects Step into rework (Cycle 2)
    await asUser(client, ids.admin, `
      SELECT public.reject_process_task($1::uuid, 'Configuration needs adjustment'::text, NULL::date) AS res
    `, [reworkStepTaskId]);

    const { rows: [reworkTaskC2] } = await client.query(`SELECT workflow_state, current_cycle_number FROM public.tasks WHERE id = $1`, [reworkStepTaskId]);
    assert.equal(reworkTaskC2.workflow_state, 'ready');
    assert.equal(reworkTaskC2.current_cycle_number, 2);

    // Cycle 1 transaction remains active
    const { rows: [c1TxCheck] } = await client.query(`SELECT status FROM public.expense_transactions WHERE id = $1`, [reworkC1TxId]);
    assert.equal(c1TxCheck.status, 'active', 'Cycle 1 expense remains active during rework');
    pass('8. Rejection into rework preserves Cycle 1 expense transaction');

    // 9. Cycle 2 rework completion adds 500.00 -> Task Actual Spend accumulates cumulatively to 1,500.00 (Decision 61)
    const resReworkC2 = await asUser(client, ids.member, `
      SELECT public.complete_responsible_step_with_expense($1, 2, 'Cycle 2 Work complete', $2::jsonb) AS res
    `, [reworkStepTaskId, JSON.stringify({ amount: 500.00, category: 'Rework Parts' })]);
    const reworkC2TxId = resReworkC2.rows[0].res.transaction_id;

    const { rows: [c2TxCheck] } = await client.query(`SELECT cycle_number FROM public.expense_transactions WHERE id = $1`, [reworkC2TxId]);
    assert.equal(c2TxCheck.cycle_number, 2);

    // Check Task total accumulated spend
    const { rows: [reworkSpend] } = await client.query(`
      SELECT COALESCE(SUM(ei.amount), 0.00) AS total_spend
      FROM public.expense_transactions et
      JOIN public.expense_items ei ON ei.transaction_id = et.id
      WHERE et.task_id = $1 AND et.status IN ('active', 'corrected')
    `, [reworkStepTaskId]);
    assert.equal(Number(reworkSpend.total_spend), 1500.00, 'Cumulative rework spend must be 1,000 + 500 = 1,500.00');
    pass('9. Cycle 2 rework expenses accumulate cumulatively into Task Actual Spend (1,500.00)');

    // 10. Standalone Process Instance expense rolls to Standalone Spend
    const standaloneProcInstId = randomUUID();
    const standaloneStepTaskId = randomUUID();
    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, placement_type, started_by, owner_id, status)
      VALUES ($1, $2, $3, $4, 'Standalone P5 Instance', 'standalone', $5, $5, 'running')
    `, [standaloneProcInstId, ids.ws, ids.defProc, ids.procVer, ids.owner]);

    await client.query(`
      INSERT INTO public.tasks (id, process_instance_id, process_step_id, defined_process_version_id, title, workflow_state, current_cycle_number, created_by)
      VALUES ($1, $2, $3, $4, 'Standalone Step 2 Task', 'ready', 1, $5)
    `, [standaloneStepTaskId, standaloneProcInstId, ids.step2, ids.procVer, ids.owner]);

    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2)
    `, [standaloneStepTaskId, ids.member]);

    await asUser(client, ids.member, `
      SELECT public.complete_responsible_step_with_expense($1, 1, 'Standalone execution', $2::jsonb) AS res
    `, [standaloneStepTaskId, JSON.stringify({ amount: 2500.00, category: 'Standalone Cloud' })]);

    const { rows: [wsSummary] } = await client.query(`
      SELECT private.compute_financial_summary($1, NULL, NULL, NULL) AS sum
    `, [ids.ws]);
    assert.equal(Number(wsSummary.sum.standalone_spend), 2500.00);
    pass('10. Standalone Process expenses roll cleanly to Standalone Spend (2,500.00)');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 3: ATOMIC ROLLBACK VERIFICATION (FAIL BOTH DIRECTIONS)
    // ──────────────────────────────────────────────────────────────────────────

    // 11. Atomic Failure Case A: Valid task completion attempt + INVALID expense payload (amount <= 0)
    // Result: NO task status change, NO expense transaction recorded
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.leafTask4, JSON.stringify({ amount: -500.00 })]);
    }, 'Expense amount must be a positive number');

    const { rows: [t4Check] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.leafTask4]);
    assert.equal(t4Check.status_id, ids.statusTodo, 'Task must remain in Todo status on expense failure');
    const { rows: t4TxCheck } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.leafTask4]);
    assert.equal(t4TxCheck.length, 0, 'Zero expense transactions must be recorded on failure');
    pass('11. Atomic Rollback Case A: Invalid expense payload rolls back task completion');

    // 12. Atomic Failure Case B: Valid expense payload + INVALID task operational rule (e.g. not authorized / not assigned R)
    // Result: NO expense recorded, NO task mutation
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.leafTask4, JSON.stringify({ amount: 750.00 })]);
    }, 'Caller is not authorized to complete task');

    const { rows: [t4CheckB] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.leafTask4]);
    assert.equal(t4CheckB.status_id, ids.statusTodo);
    const { rows: t4TxCheckB } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.leafTask4]);
    assert.equal(t4TxCheckB.length, 0);
    pass('12. Atomic Rollback Case B: Blocked task operational completion rolls back expense');

    // 13. Direct browser DML on expense tables remains BLOCKED
    await expectError(client, async () => {
      await asUser(client, ids.owner, `
        INSERT INTO public.expense_transactions (workspace_id, task_id, created_by)
        VALUES ($1, $2, $3)
      `, [ids.ws, ids.leafTask4, ids.owner]);
    });
    pass('13. Direct authenticated INSERT on expense_transactions is BLOCKED');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 4: CONTROLLED CORRECTION, VOID & ADMIN HARD-DELETE
    // ──────────────────────────────────────────────────────────────────────────

    // 14. Expense Correction authorized for Finance Operator
    // Correct tx2 (originally 1,500.00) to 1,800.00
    const resCorr = await asUser(client, ids.finMember, `
      SELECT public.correct_expense_transaction($1, $2::jsonb, 'Adjusted for shipping costs') AS res
    `, [tx2Id, JSON.stringify([
      { amount: 1500.00, category: 'Hardware', description: 'Network switch' },
      { amount: 300.00, category: 'Shipping', description: 'Express delivery' }
    ])]);
    assert.equal(resCorr.rows[0].res.status, 'corrected');
    assert.equal(Number(resCorr.rows[0].res.previous_total), 1500.00);
    assert.equal(Number(resCorr.rows[0].res.new_total), 1800.00);

    const { rows: [corrTx] } = await client.query(`SELECT status, updated_by FROM public.expense_transactions WHERE id = $1`, [tx2Id]);
    assert.equal(corrTx.status, 'corrected');
    assert.equal(corrTx.updated_by, ids.finMember);
    pass('14. Expense Correction authorized for Finance Operator');

    // 15. Expense Correction DENIED for unauthorized users (Project Admin without Finance role)
    await expectError(client, async () => {
      await asUser(client, ids.projAdmin, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, 'Unauthorized correction') AS res
      `, [tx2Id, JSON.stringify([{ amount: 1000.00 }])]);
    }, 'Caller is not authorized to correct expenses');
    pass('15. Expense Correction DENIED for unapproved roles (Project Admin)');

    // 16. Expense Correction requires non-empty reason
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, '') AS res
      `, [tx2Id, JSON.stringify([{ amount: 1000.00 }])]);
    }, 'Correction reason is required');
    pass('16. Expense Correction requires mandatory non-empty reason');

    // 17. Correction updates rollups immediately
    const { rows: [summaryAfterCorr] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, NULL, NULL) AS sum
    `, [ids.ws, ids.proj1]);
    // Project actual spend includes tx2 (1800) + tx3 (5000) + child1 (500) + step1 (1000) + rework(1500) = 9800.00
    assert.equal(Number(summaryAfterCorr.sum.actual_spend), 9800.00);
    pass('17. Correction updates project rollup immediately (1,800.00 reflected)');

    // 18. Expense Void authorized for Finance Operator
    // Void tx3 (originally 5,000.00)
    const resVoid = await asUser(client, ids.finMember, `
      SELECT public.void_expense_transaction($1, 'Invoice cancelled by vendor') AS res
    `, [tx3Id]);
    assert.equal(resVoid.rows[0].res.status, 'voided');
    assert.equal(Number(resVoid.rows[0].res.previous_total), 5000.00);
    assert.equal(Number(resVoid.rows[0].res.effective_total), 0.00);

    const { rows: [voidTx] } = await client.query(`SELECT status FROM public.expense_transactions WHERE id = $1`, [tx3Id]);
    assert.equal(voidTx.status, 'voided');
    pass('18. Expense Void authorized for Finance Operator');

    // 19. Void zeroes contribution in rollups immediately
    const { rows: [summaryAfterVoid] } = await client.query(`
      SELECT private.compute_financial_summary($1, $2, NULL, NULL) AS sum
    `, [ids.ws, ids.proj1]);
    // Project spend drops from 9800 - 5000 = 4800.00
    assert.equal(Number(summaryAfterVoid.sum.actual_spend), 4800.00);
    pass('19. Voided transaction immediately contributes 0.00 to rollups (spend dropped to 4,800.00)');

    // 20. Correction of VOIDED transaction is REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, 'Try to unvoid') AS res
      `, [tx3Id, JSON.stringify([{ amount: 1000.00 }])]);
    }, 'Cannot correct a voided expense transaction');
    pass('20. Correction of voided transaction is strictly REJECTED');

    // 21. Repeat Void of already voided transaction is REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.void_expense_transaction($1, 'Second void attempt') AS res
      `, [tx3Id]);
    }, 'Expense transaction is already voided');
    pass('21. Repeat Void is strictly REJECTED');

    // 22. Admin Hard-Delete authorized for Workspace Owner / Admin / CEO / CTO
    // Create temporary expense transaction to hard delete
    const resTemp = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.leafTask4, JSON.stringify({ amount: 999.00, category: 'Temp' })]);
    const tempTxId = resTemp.rows[0].res.transaction_id;

    // Hard-delete by CEO
    const resDel = await asUser(client, ids.ceo, `
      SELECT public.hard_delete_expense_transaction($1, 'Fraudulent test entry removed') AS res
    `, [tempTxId]);
    assert.equal(resDel.rows[0].res.deleted_transaction_id, tempTxId);

    const { rows: delTxCheck } = await client.query(`SELECT * FROM public.expense_transactions WHERE id = $1`, [tempTxId]);
    assert.equal(delTxCheck.length, 0, 'Transaction must be physically deleted');

    const { rows: delItemCheck } = await client.query(`SELECT * FROM public.expense_items WHERE transaction_id = $1`, [tempTxId]);
    assert.equal(delItemCheck.length, 0, 'Items must be physically deleted');
    pass('22. Admin Hard-Delete physically removes transaction and items');

    // 23. Finance Operator alone CANNOT hard-delete (Admin/Executive only)
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.hard_delete_expense_transaction($1, 'Finance delete attempt') AS res
      `, [tx2Id]);
    }, 'Only Workspace Owner, Workspace Admin, CEO, or CTO may hard-delete expenses');
    pass('23. Finance Operator alone is DENIED hard-delete authority');

    // 24. Tombstone preserves original transaction UUID and complete immutable snapshot
    const { rows: tombstoneRows } = await client.query(`
      SELECT * FROM public.expense_audit_logs
      WHERE original_transaction_id = $1 AND action = 'hard_deleted'
    `, [tempTxId]);
    assert.equal(tombstoneRows.length, 1);
    assert.equal(tombstoneRows[0].original_transaction_id, tempTxId);
    assert.equal(tombstoneRows[0].actor_id, ids.ceo);
    assert.equal(tombstoneRows[0].reason, 'Fraudulent test entry removed');
    assert.ok(tombstoneRows[0].metadata?.snapshot?.items, 'Tombstone metadata must contain complete snapshot of items');
    assert.equal(Number(tombstoneRows[0].previous_total_amount), 999.00);
    pass('24. Hard-delete tombstone permanently preserves original transaction UUID and snapshot');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 5: SECURITY, RETRY & INTEGRITY CLOSURES
    // ──────────────────────────────────────────────────────────────────────────

    // 25. Audit actor strictly equals auth.uid() across all APIs
    const { rows: corrAudit } = await client.query(`
      SELECT actor_id FROM public.expense_audit_logs WHERE transaction_id = $1 AND action = 'corrected'
    `, [tx2Id]);
    assert.equal(corrAudit[0].actor_id, ids.finMember);
    pass('25. Audit actor unconditionally matches authenticated caller identity');

    // 26. Ordinary completion actor without exact Task authorization rejected
    await expectError(client, async () => {
      await asUser(client, ids.unrelatedMember, `
        SELECT public.complete_task_with_expense($1) AS res
      `, [ids.leafTask4]);
    });
    pass('26. Completion by user without task authorization is REJECTED');

    // 27. Projectless ordinary task Finance capture rejected
    await expectError(client, async () => {
      await asUser(client, ids.owner, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.projectlessTask, JSON.stringify({ amount: 100.00 })]);
    }, 'Ordinary task completion with finance requires a valid project_id');
    pass('27. Projectless ordinary task Finance capture is REJECTED');

    // 28. Duplicate ordinary completion RPC creates no second expense
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.leafTask2, JSON.stringify({ amount: 500.00 })]);
    }, 'Cannot record expense on an already completed task');
    pass('28. Duplicate ordinary completion RPC rejects second expense');

    // 29. Duplicate Process cycle RPC creates no second expense
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_responsible_step_with_expense($1, 1, 'Replay', $2::jsonb) AS res
      `, [ids.stepTask1, JSON.stringify({ amount: 500.00 })]);
    }, 'Task is not in an actionable state');
    pass('29. Duplicate Process step cycle RPC creates zero duplicate expense');

    // 30. Correction audit preserves old + new line-item snapshots
    const { rows: [corrLog] } = await client.query(`
      SELECT metadata FROM public.expense_audit_logs WHERE transaction_id = $1 AND action = 'corrected'
    `, [tx2Id]);
    assert.ok(corrLog.metadata?.old_items, 'Must contain old_items snapshot');
    assert.ok(corrLog.metadata?.new_items, 'Must contain new_items snapshot');
    pass('30. Correction audit captures complete old and new line-item snapshots');

    // 31. Zero new Security Advisor warnings (verified via query)
    const { rows: pubSecDef } = await client.query(`
      SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prosecdef = true
        AND p.proname IN ('complete_task_with_expense', 'complete_responsible_step_with_expense', 'correct_expense_transaction', 'void_expense_transaction', 'hard_delete_expense_transaction')
    `);
    assert.equal(pubSecDef.length, 0, 'Zero new SECURITY DEFINER functions in public schema');
    pass('31. Zero new SECURITY DEFINER functions introduced in public schema');

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
