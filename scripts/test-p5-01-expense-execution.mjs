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
  console.log('  SNS PROJECTS — PACKAGE 5 / P5-01 & P5-01A EXPENSE EXECUTION TEST SUITE   ');
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
    // 1. Apply P5-01 and P5-01A migrations inside the isolated test transaction
    const p5MigrationSql = await readFile(
      path.join('supabase', 'migrations', '20260819131603_p5_01_expense_execution_runtime.sql'),
      'utf8',
    );
    await client.query(p5MigrationSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-01 migration 20260819131603');

    const p5HotfixSql = await readFile(
      path.join('supabase', 'migrations', '20260819151608_p5_01a_expense_runtime_security_parity_hotfix.sql'),
      'utf8',
    );
    await client.query(p5HotfixSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-01A hotfix migration 20260819151608');

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
      viewerTask: randomUUID(),
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
      consultProcInst: randomUUID(),
      consultStepTask: randomUUID(),
      viewerStepTask: randomUUID(),
      viewerProcInst: randomUUID(),
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

    // Workspace Memberships
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES ($1, $2, 'owner', 'active'),
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

    // User System Roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES ($1, $2, 'ceo'),
             ($1, $3, 'cto'),
             ($1, $4, 'project_admin')
    `, [ids.ws, ids.ceo, ids.cto, ids.projAdmin]);

    // Finance Department
    await client.query(`
      INSERT INTO public.departments (id, workspace_id, name, code)
      VALUES ($1, $2, 'Finance Operations', 'FIN')
    `, [ids.finDept, ids.ws]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active)
      VALUES ($1, $2, $3, true)
    `, [ids.ws, ids.finDept, ids.finMember]);

    // Project & Budget
    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, owner_id)
      VALUES ($1, $2, 'P5 Execution Engine Project', $3)
    `, [ids.proj1, ids.ws, ids.projOwner]);

    await client.query(`
      INSERT INTO public.budgets (workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by)
      VALUES ($1, 'project', $2, 100000.00, 20000.00, $3)
    `, [ids.ws, ids.proj1, ids.owner]);

    // Phase & Task Lists
    await client.query(`
      INSERT INTO public.phases (id, project_id, name)
      VALUES ($1, $2, 'Phase 1 Execution')
    `, [ids.phase1, ids.proj1]);

    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
      VALUES ($1, $2, $3, 'List 1 Hardware', 1),
             ($4, $2, $3, 'List 2 Software', 2)
    `, [ids.list1, ids.proj1, ids.phase1, ids.list2]);

    // Task Statuses
    await client.query(`
      INSERT INTO public.task_statuses (id, project_id, name, color, system_code, position)
      VALUES ($1, $2, 'To Do', '#cccccc', 'todo', 1),
             ($3, $2, 'Done', '#00ff00', 'done', 2)
    `, [ids.statusTodo, ids.proj1, ids.statusDone]);

    // Ordinary Tasks
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title, status_id, assignee_id, owner_id, created_by)
      VALUES ($1, $2, $3, $4, 'Leaf Task 1 (No Expense)', $5, $6, $6, $7),
             ($8, $2, $3, $4, 'Leaf Task 2 (Mode A Total)', $5, $6, $6, $7),
             ($9, $2, $3, $4, 'Leaf Task 3 (Mode B Split)', $5, $6, $6, $7),
             ($10, $2, $3, $4, 'Leaf Task 4 (RACI Task)', $5, NULL, $6, $7),
             ($11, $2, $3, $4, 'Viewer Assigned Task', $5, $12, $12, $7),
             ($13, $2, $3, $4, 'Parent Task with Children', $5, $6, $6, $7),
             ($14, $2, $3, $4, 'Child Task 1', $5, $6, $6, $7),
             ($15, $2, $3, $4, 'Child Task 2', $5, $6, $6, $7)
    `, [
      ids.leafTask1, ids.proj1, ids.phase1, ids.list1, ids.statusTodo, ids.member, ids.owner,
      ids.leafTask2, ids.leafTask3, ids.leafTask4, ids.viewerTask, ids.viewer, ids.parentTask,
      ids.childTask1, ids.childTask2
    ]);

    // Parent-Child hierarchy linking
    await client.query(`
      UPDATE public.tasks SET parent_task_id = $1 WHERE id IN ($2, $3)
    `, [ids.parentTask, ids.childTask1, ids.childTask2]);

    // RACI assignment for Task 4
    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2), ($1, 'A', $3)
    `, [ids.leafTask4, ids.member, ids.admin]);

    // RACI assignment for Viewer Task (Viewer is R and Assignee)
    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2), ($1, 'A', $3)
    `, [ids.viewerTask, ids.viewer, ids.admin]);

    // Projectless task for boundary testing
    await client.query(`
      INSERT INTO public.tasks (id, title, status_id, created_by)
      VALUES ($1, 'Projectless Floating Task', $2, $3)
    `, [ids.projectlessTask, ids.statusTodo, ids.owner]);

    // Defined Process Version & Steps
    await client.query(`
      INSERT INTO public.defined_processes (id, workspace_id, department_id, process_owner_id, name, code, created_by)
      VALUES ($1, $2, $3, $4, 'Server Procurement DAG', 'PROC-SRV', $4)
    `, [ids.defProc, ids.ws, ids.finDept, ids.owner]);

    await client.query(`
      INSERT INTO public.defined_process_versions (id, defined_process_id, version_number, status, created_by, published_by, published_at)
      VALUES ($1, $2, 1, 'published', $3, $3, now())
    `, [ids.procVer, ids.defProc, ids.owner]);

    await client.query(`
      INSERT INTO public.defined_process_steps (id, version_id, step_code, title, sequence_order, expected_duration_days, approval_required, consultation_required, evidence_required)
      VALUES ($1, $2, 'STEP-1', 'Assemble Hardware', 1, 3, true, false, false),
             ($3, $2, 'STEP-2', 'OS Configuration', 2, 2, false, false, false)
    `, [ids.step1, ids.procVer, ids.step2]);

    // Process Instance attached to List 1
    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, placement_type, project_id, phase_id, task_list_id, started_by, owner_id, status)
      VALUES ($1, $2, $3, $4, 'Production Cluster 1', 'task_list', $5, $6, $7, $8, $8, 'running')
    `, [ids.procInst, ids.ws, ids.defProc, ids.procVer, ids.proj1, ids.phase1, ids.list1, ids.owner]);

    // Step Tasks for Instance
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, process_instance_id, process_step_id, defined_process_version_id, title, workflow_state, current_cycle_number, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Step 1 Task', 'ready', 1, $8),
             ($9, $2, $3, $4, $5, $10, $7, 'Step 2 Task', 'waiting', 1, $8)
    `, [ids.stepTask1, ids.proj1, ids.phase1, ids.list1, ids.procInst, ids.step1, ids.procVer, ids.owner, ids.stepTask2, ids.step2]);

    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2), ($1, 'A', $3),
             ($4, 'R', $2), ($4, 'A', $3)
    `, [ids.stepTask1, ids.member, ids.admin, ids.stepTask2]);

    await client.query('SET LOCAL session_replication_role = DEFAULT');
    pass('Initial P5 test fixtures and entities created successfully');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 1: VIEWER READ-ONLY SERVER-SIDE ENFORCEMENT
    // ──────────────────────────────────────────────────────────────────────────

    // 1. Viewer as direct assignee cannot complete ordinary Task
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_task_with_expense($1) AS res
      `, [ids.viewerTask]);
    }, 'Caller does not have mutation capability');
    pass('1. Viewer as direct assignee CANNOT complete ordinary Task (fails closed)');

    // 2. Viewer with RACI R cannot complete ordinary Task with expense
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.viewerTask, JSON.stringify({ amount: 500.00, category: 'Hardware' })]);
    }, 'Caller does not have mutation capability');

    // Verify task row and expense table remained completely untouched
    const { rows: [vTaskRow] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.viewerTask]);
    assert.equal(vTaskRow.status_id, ids.statusTodo, 'Task status must remain Todo');
    const { rows: vExpCount } = await client.query(`SELECT count(*) FROM public.expense_transactions WHERE task_id = $1`, [ids.viewerTask]);
    assert.equal(Number(vExpCount[0].count), 0, 'Zero expense transactions created');
    pass('2. Viewer with RACI R CANNOT attach expense or mutate task');

    // 3. Set up Viewer on Process Step Task and verify all process mutation RPCs fail closed
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, placement_type, project_id, phase_id, task_list_id, started_by, owner_id, status)
      VALUES ($1, $2, $3, $4, 'Viewer Process Instance', 'task_list', $5, $6, $7, $8, $8, 'running')
    `, [ids.viewerProcInst, ids.ws, ids.defProc, ids.procVer, ids.proj1, ids.phase1, ids.list1, ids.owner]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, process_instance_id, process_step_id, defined_process_version_id, title, workflow_state, current_cycle_number, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Viewer Step Task', 'ready', 1, $8)
    `, [ids.viewerStepTask, ids.proj1, ids.phase1, ids.list1, ids.viewerProcInst, ids.step1, ids.procVer, ids.owner]);

    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2), ($1, 'A', $2), ($1, 'C', $2)
    `, [ids.viewerStepTask, ids.viewer]);
    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // 3a. Viewer cannot complete responsible step with expense
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_responsible_step_with_expense($1, 1, 'Viewer work', $2::jsonb) AS res
      `, [ids.viewerStepTask, JSON.stringify({ amount: 100.00 })]);
    }, 'Caller does not have mutation capability');
    pass('3a. Viewer CANNOT execute complete_responsible_step_with_expense');

    // 3b. Viewer cannot call complete_responsible_part
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_responsible_part($1, 1, 'Viewer work') AS res
      `, [ids.viewerStepTask]);
    }, 'Caller does not have mutation capability');
    pass('3b. Viewer CANNOT execute canonical complete_responsible_part');

    // 3c. Viewer cannot call submit_task_evidence
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.submit_task_evidence($1, NULL, 'text', '{"doc": "v"}'::jsonb) AS res
      `, [ids.viewerStepTask]);
    }, 'Caller does not have mutation capability');
    pass('3c. Viewer CANNOT execute submit_task_evidence');

    // 3d. Viewer cannot call submit_task_consultation
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.submit_task_consultation($1, 'Viewer opinion') AS res
      `, [ids.viewerStepTask]);
    }, 'Caller does not have mutation capability');
    pass('3d. Viewer CANNOT execute submit_task_consultation');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 2: ORDINARY TASK COMPLETION + EXPENSE RUNTIME
    // ──────────────────────────────────────────────────────────────────────────

    // 4. Ordinary leaf Task completes without expense
    const res1 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1) AS res
    `, [ids.leafTask1]);
    assert.equal(res1.rows[0].res.success, true);
    assert.equal(res1.rows[0].res.status, 'done');
    assert.equal(res1.rows[0].res.transaction_id, null);

    const { rows: [t1] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.leafTask1]);
    assert.equal(t1.status_id, ids.statusDone);
    pass('4. Ordinary leaf Task completes without expense for authorized Member');

    // 5. Ordinary leaf Task completes atomically with single total expense (Mode A)
    const res2 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.leafTask2, JSON.stringify({
      amount: 1500.00,
      category: 'Hardware',
      vendor: 'Dell',
      description: 'Test Server Purchase',
      expense_date: '2026-08-19'
    })]);
    assert.equal(res2.rows[0].res.success, true);
    const tx2Id = res2.rows[0].res.transaction_id;
    assert.ok(tx2Id, 'Transaction ID must be returned');

    const { rows: [t2Tx] } = await client.query(`SELECT * FROM public.expense_transactions WHERE id = $1`, [tx2Id]);
    assert.equal(t2Tx.task_id, ids.leafTask2);
    assert.equal(t2Tx.workspace_id, ids.ws);
    assert.equal(t2Tx.status, 'active');

    const { rows: t2Items } = await client.query(`SELECT * FROM public.expense_items WHERE transaction_id = $1`, [tx2Id]);
    assert.equal(t2Items.length, 1);
    assert.equal(Number(t2Items[0].amount), 1500.00);
    assert.equal(t2Items[0].category, 'Hardware');

    const { rows: [t2Audit] } = await client.query(`SELECT * FROM public.expense_audit_logs WHERE transaction_id = $1`, [tx2Id]);
    assert.equal(t2Audit.action, 'created');
    assert.equal(t2Audit.original_transaction_id, tx2Id);
    assert.equal(t2Audit.actor_id, ids.member);
    pass('5. Ordinary leaf Task completes atomically with single total expense (Mode A)');

    // 6. Ordinary leaf Task completes atomically with itemized split expenses (Mode B)
    const res3 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.leafTask3, JSON.stringify({
      expense_date: '2026-08-19',
      description: 'Split Deployment Costs',
      items: [
        { amount: 2000.00, category: 'Hardware', description: 'Rack Mount' },
        { amount: 3000.00, category: 'Software', description: 'Enterprise License' }
      ]
    })]);
    const tx3Id = res3.rows[0].res.transaction_id;
    const { rows: t3Items } = await client.query(`SELECT * FROM public.expense_items WHERE transaction_id = $1 ORDER BY line_number`, [tx3Id]);
    assert.equal(t3Items.length, 2);
    assert.equal(Number(t3Items[0].amount), 2000.00);
    assert.equal(Number(t3Items[1].amount), 3000.00);
    pass('6. Ordinary leaf Task completes atomically with itemized split expenses (Mode B)');

    // 7. Parent Task direct expense capture is strictly REJECTED (Decision 17)
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.parentTask, JSON.stringify({ amount: 5000.00, category: 'Hardware' })]);
    }, 'Parent tasks with child dependencies cannot capture direct expenses');
    pass('7. Parent Task direct expense capture is strictly REJECTED (Decision 17)');

    // 8. Parent Task auto-completion preserves zero direct expense rows
    await asUser(client, ids.member, `SELECT public.complete_task_with_expense($1) AS res`, [ids.childTask1]);
    await asUser(client, ids.member, `SELECT public.complete_task_with_expense($1) AS res`, [ids.childTask2]);

    const { rows: [pTaskAfter] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.parentTask]);
    assert.equal(pTaskAfter.status_id, ids.statusDone, 'Parent must be auto-completed by trigger');

    const { rows: pExpRows } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.parentTask]);
    assert.equal(pExpRows.length, 0, 'Parent auto-completion must NOT create expense transactions');
    pass('8. Parent automatic completion creates zero direct expense transactions');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 3: DEFINED PROCESS RUNTIME & NOTIFICATION INTEGRATION
    // ──────────────────────────────────────────────────────────────────────────

    // 9. Defined Process Step Cycle 1 records expense with cycle provenance
    const resStep1 = await asUser(client, ids.member, `
      SELECT public.complete_responsible_step_with_expense($1, 1, 'Completed Step 1 HW', $2::jsonb) AS res
    `, [ids.stepTask1, JSON.stringify({
      amount: 4000.00,
      category: 'Hardware',
      description: 'Server Components',
      expense_date: '2026-08-19'
    })]);
    assert.equal(resStep1.rows[0].res.success, true);
    assert.equal(resStep1.rows[0].res.status, 'in_review');
    const stepTxId = resStep1.rows[0].res.transaction_id;

    const { rows: [stepTx] } = await client.query(`SELECT cycle_number, status FROM public.expense_transactions WHERE id = $1`, [stepTxId]);
    assert.equal(stepTx.cycle_number, 1);
    assert.equal(stepTx.status, 'active');

    const { rows: [stepTaskAfter] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1`, [ids.stepTask1]);
    assert.equal(stepTaskAfter.workflow_state, 'awaiting_approval');
    pass('9. Defined Process Step Cycle 1 records expense with cycle provenance');

    // 10. Accountable approval advances step without duplicate expense
    await asUser(client, ids.admin, `
      SELECT public.approve_process_task($1) AS res
    `, [ids.stepTask1]);

    const { rows: [step1Approved] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1`, [ids.stepTask1]);
    assert.equal(step1Approved.workflow_state, 'completed');

    const { rows: step1Approvals } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.stepTask1]);
    assert.equal(step1Approvals.length, 1, 'Accountable approval must NOT create a duplicate expense transaction');
    pass('10. Accountable approval advances step without creating duplicate expense');

    // 11. Notification Compatibility: submit_task_consultation inserts process_consultation_response notification
    const consultStepId = randomUUID();
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`
      INSERT INTO public.defined_process_steps (id, version_id, step_code, title, sequence_order, expected_duration_days, approval_required, consultation_required, evidence_required)
      VALUES ($1, $2, 'STEP-CONSULT', 'Consultation Step', 3, 2, false, true, false)
    `, [consultStepId, ids.procVer]);

    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, placement_type, project_id, phase_id, task_list_id, started_by, owner_id, status)
      VALUES ($1, $2, $3, $4, 'Consultation Instance', 'task_list', $5, $6, $7, $8, $8, 'running')
    `, [ids.consultProcInst, ids.ws, ids.defProc, ids.procVer, ids.proj1, ids.phase1, ids.list1, ids.owner]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, process_instance_id, process_step_id, defined_process_version_id, title, workflow_state, current_cycle_number, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Consultation Step Task', 'ready', 1, $8)
    `, [ids.consultStepTask, ids.proj1, ids.phase1, ids.list1, ids.consultProcInst, consultStepId, ids.procVer, ids.owner]);

    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id, response_required)
      VALUES ($1, 'R', $2, false), ($1, 'A', $3, false), ($1, 'C', $4, true)
    `, [ids.consultStepTask, ids.member, ids.admin, ids.projOwner]);
    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // Submit consultation response as C user
    const resConsult = await asUser(client, ids.projOwner, `
      SELECT public.submit_task_consultation($1, 'Approved by Project Owner in consultation') AS res
    `, [ids.consultStepTask]);
    assert.equal(resConsult.rows[0].res.success, true);

    // Verify notification row was successfully inserted with type 'process_consultation_response'
    const { rows: notifRows } = await client.query(`
      SELECT type, title, recipient_id, workspace_id FROM (
        SELECT type, title, user_id as recipient_id, workspace_id FROM public.notifications
        WHERE task_id = $1 AND type = 'process_consultation_response'
      ) sub
    `, [ids.consultStepTask]);
    assert.ok(notifRows.length > 0, 'process_consultation_response notification must be recorded');
    assert.equal(notifRows[0].type, 'process_consultation_response');
    assert.equal(notifRows[0].recipient_id, ids.member);
    pass('11. submit_task_consultation emits process_consultation_response notification cleanly');

    // 12. Rejection / Rework cycle setup:
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
    const { rows: [c1Tx] } = await client.query(`SELECT status, cycle_number FROM public.expense_transactions WHERE id = $1`, [reworkC1TxId]);
    assert.equal(c1Tx.status, 'active');
    assert.equal(c1Tx.cycle_number, 1);
    pass('12. Rejection into rework preserves Cycle 1 expense transaction');

    // 13. Cycle 2 completion with 500.00 additional rework expense
    const resReworkC2 = await asUser(client, ids.member, `
      SELECT public.complete_responsible_step_with_expense($1, 2, 'Cycle 2 Rework Work', $2::jsonb) AS res
    `, [reworkStepTaskId, JSON.stringify({ amount: 500.00, category: 'Hardware' })]);
    const reworkC2TxId = resReworkC2.rows[0].res.transaction_id;

    const { rows: [c2Tx] } = await client.query(`SELECT cycle_number, status FROM public.expense_transactions WHERE id = $1`, [reworkC2TxId]);
    assert.equal(c2Tx.cycle_number, 2);
    assert.equal(c2Tx.status, 'active');

    // Rollup check: Both Cycle 1 ($1000) and Cycle 2 ($500) accumulate
    const { rows: [taskSpend] } = await client.query(`
      SELECT COALESCE(SUM(ei.amount), 0.00) AS total_spend
      FROM public.expense_transactions et
      JOIN public.expense_items ei ON ei.transaction_id = et.id
      WHERE et.task_id = $1 AND et.status IN ('active', 'corrected')
    `, [reworkStepTaskId]);
    assert.equal(Number(taskSpend.total_spend), 1500.00);
    pass('13. Cycle 2 rework expenses accumulate cumulatively into Task Actual Spend (1,500.00)');

    // 14. Process-Cycle Database Unique Index prevents concurrent double expense insertion
    await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.expense_transactions (workspace_id, task_id, cycle_number, status, created_by)
        VALUES ($1, $2, 1, 'active', $3)
      `, [ids.ws, reworkStepTaskId, ids.member]);
    }, 'uq_expense_transactions_task_cycle_active');
    pass('14. Partial unique index uq_expense_transactions_task_cycle_active blocks duplicate active cycle expense');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 4: AUDIT, CORRECTION, VOID & HARD-DELETE
    // ──────────────────────────────────────────────────────────────────────────

    // 15. Direct authenticated INSERT on expense_transactions is BLOCKED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        INSERT INTO public.expense_transactions (workspace_id, task_id, status, created_by)
        VALUES ($1, $2, 'active', $3)
      `, [ids.ws, ids.leafTask4, ids.member]);
    }, 'permission denied for table expense_transactions');
    pass('15. Direct authenticated INSERT on expense_transactions is BLOCKED');

    // 16. Expense Correction authorized for Finance Operator
    const resCorr = await asUser(client, ids.finMember, `
      SELECT public.correct_expense_transaction($1, $2::jsonb, 'Vendor discount applied') AS res
    `, [tx2Id, JSON.stringify({
      expense_date: '2026-08-19',
      description: 'Corrected Server Purchase',
      items: [{ amount: 1800.00, category: 'Hardware', description: 'Upgraded Server Specs' }]
    })]);
    assert.equal(resCorr.rows[0].res.success, true);
    assert.equal(resCorr.rows[0].res.status, 'corrected');
    assert.equal(Number(resCorr.rows[0].res.new_total_amount), 1800.00);
    pass('16. Expense Correction authorized for Finance Operator');

    // 17. Expense Correction DENIED for unapproved roles (Project Admin)
    await expectError(client, async () => {
      await asUser(client, ids.projAdmin, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, 'Unauthorized correction') AS res
      `, [tx2Id, JSON.stringify({ amount: 100.00 })]);
    }, 'not authorized to correct expenses');
    pass('17. Expense Correction DENIED for unapproved roles (Project Admin)');

    // 18. Expense Correction requires mandatory non-empty reason
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, '   ') AS res
      `, [tx2Id, JSON.stringify({ amount: 100.00 })]);
    }, 'Correction reason is required');
    pass('18. Expense Correction requires mandatory non-empty reason');

    // 19. Expense Void authorized for Finance Operator
    const resVoid = await asUser(client, ids.finMember, `
      SELECT public.void_expense_transaction($1, 'Duplicate procurement cancelled') AS res
    `, [tx3Id]);
    assert.equal(resVoid.rows[0].res.success, true);
    assert.equal(resVoid.rows[0].res.status, 'voided');

    const { rows: [t3Void] } = await client.query(`SELECT status FROM public.expense_transactions WHERE id = $1`, [tx3Id]);
    assert.equal(t3Void.status, 'voided');
    pass('19. Expense Void authorized for Finance Operator');

    // 20. Correction of voided transaction is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, 'Attempt edit voided') AS res
      `, [tx3Id, JSON.stringify({ amount: 100.00 })]);
    }, 'Cannot correct a voided');
    pass('20. Correction of voided transaction is strictly REJECTED');

    // 21. Repeat Void is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.void_expense_transaction($1, 'Repeat void') AS res
      `, [tx3Id]);
    }, 'already voided');
    pass('21. Repeat Void is strictly REJECTED');

    // 22. Admin Hard-Delete physically removes transaction and items
    const tempTxRes = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.leafTask4, JSON.stringify({ amount: 999.00, category: 'Hardware' })]);
    const tempTxId = tempTxRes.rows[0].res.transaction_id;

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
    }, 'may hard-delete expenses');
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

    // 25. Notification constraint drift guard: all emitted types must be accepted
    const emittedTypes = [
      'task_assigned', 'task_accountable', 'task_consulted', 'task_informed',
      'raci_changed', 'task_status_changed', 'subtask_assigned', 'project_status_changed',
      'system', 'process_task_ready', 'process_task_completed', 'consultation_required',
      'process_consultation_response', 'approval_required', 'task_rework_required',
      'rework_required', 'process_rework_requested', 'process_task_rejected',
      'process_task_review_needed', 'process_completed'
    ];

    const { rows: [typeCheckConstraint] } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'notifications_type_check'
    `);

    for (const t of emittedTypes) {
      assert.ok(
        typeCheckConstraint.def.includes(`'${t}'`),
        `notifications_type_check must accept emitted type: "${t}"`
      );
    }
    pass('25. Notification constraint drift guard: all 20 emitted types verified accepted');

    // 26. Zero new Security Advisor warnings (verified via query)
    const { rows: pubSecDef } = await client.query(`
      SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prosecdef = true
        AND p.proname IN ('complete_task_with_expense', 'complete_responsible_step_with_expense', 'correct_expense_transaction', 'void_expense_transaction', 'hard_delete_expense_transaction')
    `);
    assert.equal(pubSecDef.length, 0, 'Zero new SECURITY DEFINER functions in public schema');
    pass('26. Zero new SECURITY DEFINER functions introduced in public schema');

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
