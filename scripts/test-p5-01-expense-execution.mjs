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
  console.log('  SNS PROJECTS — PACKAGE 5 / P5-01, P5-01A & P5-01B EXPENSE TEST SUITE      ');
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
    // 1. Apply P5-01, P5-01A, and P5-01B migrations inside isolated test transaction
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

    const p5HotfixBSql = await readFile(
      path.join('supabase', 'migrations', '20260819154319_p5_01b_operational_scope_authorization_closure.sql'),
      'utf8',
    );
    await client.query(p5HotfixBSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-01B hotfix migration 20260819154319');

    const p5HotfixCSql = await readFile(
      path.join('supabase', 'migrations', '20260819190058_p5_01c_parent_completion_ownership_closure.sql'),
      'utf8',
    );
    await client.query(p5HotfixCSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-01C closure migration 20260819190058');

    const p5_02aSql = await readFile(
      path.join('supabase', 'migrations', '20260819214046_p5_02a_parent_direct_completion_guard.sql'),
      'utf8',
    );
    await client.query(p5_02aSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-02A migration 20260819214046');

    const p5_03Sql = await readFile(
      path.join('supabase', 'migrations', '20260820072145_p5_03_subtask_completion_expense_parent_closure.sql'),
      'utf8',
    );
    await client.query(p5_03Sql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-03 migration 20260820072145');

    const p5_03aSql = await readFile(
      path.join('supabase', 'migrations', '20260820073423_p5_03a_drop_ambiguous_expense_overload.sql'),
      'utf8',
    );
    await client.query(p5_03aSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P5-03A hotfix migration 20260820073423');

    const p4_01bSql = await readFile(
      path.join('supabase', 'migrations', '20260820174313_p4_01b_finance_active_tenancy_authorization_closure.sql'),
      'utf8',
    );
    await client.query(p4_01bSql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
    console.log('[SETUP] Applied P4-01B migration 20260820174313');

    // 2. Set up test entities

    const ids = {
      ws: randomUUID(),
      ws2: randomUUID(),
      owner: randomUUID(),
      admin: randomUUID(),
      pureOwner: randomUUID(),
      pureAdmin: randomUUID(),
      ceo: randomUUID(),
      cto: randomUUID(),
      projAdmin: randomUUID(),
      finMember: randomUUID(),
      projOwner: randomUUID(),
      member: randomUUID(),
      unrelatedMember: randomUUID(),
      viewer: randomUUID(),
      viewerProjAdmin: randomUUID(),
      viewerSysAdmin: randomUUID(),
      viewerCEO: randomUUID(),
      suspendedCreator: randomUUID(),
      removedCreator: randomUUID(),
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
      pureOwnerTask: randomUUID(),
      pureAdminRaciTask: randomUUID(),
      unrelatedTask: randomUUID(),
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
      hostTaskWithProc: randomUUID(),
      procAttachedToTask: randomUUID(),
      stepTaskAttached: randomUUID(),
    };

    await client.query('SET LOCAL session_replication_role = replica');

    // Profiles
    const profiles = [
      [ids.owner, 'Workspace Owner (With CEO)'],
      [ids.admin, 'Workspace Admin (With CTO)'],
      [ids.pureOwner, 'Pure Workspace Owner (No System Role)'],
      [ids.pureAdmin, 'Pure Workspace Admin (No System Role)'],
      [ids.ceo, 'Executive CEO'],
      [ids.cto, 'Executive CTO'],
      [ids.projAdmin, 'Project Admin User'],
      [ids.finMember, 'Finance Operator'],
      [ids.projOwner, 'Project Owner User'],
      [ids.member, 'General Member User'],
      [ids.unrelatedMember, 'Unrelated Member User'],
      [ids.viewer, 'Viewer User'],
      [ids.viewerProjAdmin, 'Viewer With Project Admin'],
      [ids.viewerSysAdmin, 'Viewer With System Admin'],
      [ids.viewerCEO, 'Viewer With CEO Only'],
      [ids.suspendedCreator, 'Suspended Creator User'],
      [ids.removedCreator, 'Removed Creator User'],
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
             ($3, 'P5 Other Workspace', $4)
    `, [ids.ws, ids.suspendedCreator, ids.ws2, ids.removedCreator]);

    // Workspace Memberships
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES ($1, $2, 'owner', 'active'),
             ($1, $3, 'admin', 'active'),
             ($1, $4, 'owner', 'active'),
             ($1, $5, 'admin', 'active'),
             ($1, $6, 'member', 'active'),
             ($1, $7, 'member', 'active'),
             ($1, $8, 'member', 'active'),
             ($1, $9, 'member', 'active'),
             ($1, $10, 'member', 'active'),
             ($1, $11, 'member', 'active'),
             ($1, $12, 'viewer', 'active'),
             ($1, $13, 'viewer', 'active'),
             ($1, $14, 'viewer', 'active'),
             ($1, $15, 'viewer', 'active'),
             ($1, $16, 'owner', 'pending'),
             ($17, $18, 'member', 'active')
    `, [
      ids.ws, ids.owner, ids.admin, ids.pureOwner, ids.pureAdmin, ids.ceo, ids.cto, ids.projAdmin,
      ids.finMember, ids.projOwner, ids.member, ids.viewer, ids.viewerProjAdmin, ids.viewerSysAdmin, ids.viewerCEO,
      ids.suspendedCreator, ids.ws2, ids.unrelatedMember
    ]);
    // Note: ids.removedCreator created ws2 but has NO row in public.workspace_members for ws2.

    // User System Roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES ($1, $2, 'ceo'),
             ($1, $3, 'cto'),
             ($1, $4, 'project_admin'),
             ($1, $5, 'project_admin'),
             ($1, $6, 'system_admin'),
             ($1, $7, 'ceo')
    `, [ids.ws, ids.ceo, ids.cto, ids.projAdmin, ids.viewerProjAdmin, ids.viewerSysAdmin, ids.viewerCEO]);

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
             ($13, $2, $3, $4, 'Pure Owner Assigned Task', $5, $14, $14, $7),
             ($15, $2, $3, $4, 'Pure Admin RACI Task', $5, NULL, $6, $7),
             ($16, $2, $3, $4, 'Unrelated Task for Pure Owner/Admin', $5, $6, $6, $7),
             ($17, $2, $3, $4, 'Parent Task with Children', $5, $6, $6, $7),
             ($18, $2, $3, $4, 'Child Task 1', $5, $6, $6, $7),
             ($19, $2, $3, $4, 'Child Task 2', $5, $6, $6, $7)
    `, [
      ids.leafTask1, ids.proj1, ids.phase1, ids.list1, ids.statusTodo, ids.member, ids.owner,
      ids.leafTask2, ids.leafTask3, ids.leafTask4, ids.viewerTask, ids.viewer,
      ids.pureOwnerTask, ids.pureOwner, ids.pureAdminRaciTask, ids.unrelatedTask,
      ids.parentTask, ids.childTask1, ids.childTask2
    ]);

    // Parent-Child hierarchy linking
    await client.query(`
      UPDATE public.tasks SET parent_task_id = $1 WHERE id IN ($2, $3)
    `, [ids.parentTask, ids.childTask1, ids.childTask2]);

    // RACI assignments
    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ($1, 'R', $2), ($1, 'A', $3),
             ($4, 'R', $5), ($4, 'A', $3),
             ($6, 'R', $7), ($6, 'A', $3)
    `, [
      ids.leafTask4, ids.member, ids.admin,
      ids.viewerTask, ids.viewer,
      ids.pureAdminRaciTask, ids.pureAdmin
    ]);

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

    // Host Task with Process Instance attached to Task
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title, status_id, assignee_id, owner_id, created_by)
      VALUES ($1, $2, $3, $4, 'Host Task with Process Attached', $5, $6, $6, $7)
    `, [ids.hostTaskWithProc, ids.proj1, ids.phase1, ids.list1, ids.statusTodo, ids.member, ids.owner]);

    await client.query(`
      INSERT INTO public.process_instances (id, workspace_id, defined_process_id, defined_process_version_id, instance_name, placement_type, project_id, phase_id, task_list_id, parent_task_id, started_by, owner_id, status)
      VALUES ($1, $2, $3, $4, 'Task Attached Process', 'task', $5, $6, $7, $8, $9, $9, 'running')
    `, [ids.procAttachedToTask, ids.ws, ids.defProc, ids.procVer, ids.proj1, ids.phase1, ids.list1, ids.hostTaskWithProc, ids.owner]);

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, parent_task_id, process_instance_id, process_step_id, defined_process_version_id, title, workflow_state, current_cycle_number, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Attached Step 1 Task', 'ready', 1, $9)
    `, [ids.stepTaskAttached, ids.proj1, ids.phase1, ids.list1, ids.hostTaskWithProc, ids.procAttachedToTask, ids.step1, ids.procVer, ids.owner]);

    await client.query('SET LOCAL session_replication_role = DEFAULT');
    pass('Initial P5 test fixtures and entities created successfully');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 0: P5-01B SERVER CAPABILITY HELPER MATRIX vs FRONTEND CONTRACT
    // ──────────────────────────────────────────────────────────────────────────

    // Helper evaluation:
    const checkCapability = async (uId, wsId = ids.ws) => {
      const { rows } = await client.query(
        `SELECT private.can_mutate_operational_workspace($1, $2) AS can_mutate`,
        [wsId, uId]
      );
      return rows[0].can_mutate;
    };

    assert.equal(await checkCapability(ids.pureOwner), true, 'Active Workspace Owner -> true');
    assert.equal(await checkCapability(ids.pureAdmin), true, 'Active Workspace Admin -> true');
    assert.equal(await checkCapability(ids.member), true, 'Active Workspace Member -> true');
    assert.equal(await checkCapability(ids.viewer), false, 'Active Workspace Viewer (no system role) -> false');
    assert.equal(await checkCapability(ids.viewerProjAdmin), true, 'Active Viewer + project_admin -> true');
    assert.equal(await checkCapability(ids.viewerSysAdmin), true, 'Active Viewer + system_admin -> true');
    assert.equal(await checkCapability(ids.viewerCEO), false, 'Active Viewer + CEO only (no project/sys admin) -> false');
    assert.equal(await checkCapability(ids.suspendedCreator), false, 'Suspended Workspace Creator -> false (No creator bypass)');
    assert.equal(await checkCapability(ids.removedCreator, ids.ws2), false, 'Removed Workspace Creator -> false (No creator bypass)');
    pass('0. Server capability helper matches frontend canMutateOperationalData matrix 100%');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 1: P5-01B EXACT-SCOPE TASK AUTHORIZATION & INVOLVEMENT ENFORCEMENT
    // ──────────────────────────────────────────────────────────────────────────

    // 1a. Pure Workspace Owner cannot complete unrelated Task (UUID guessing fails)
    await expectError(client, async () => {
      await asUser(client, ids.pureOwner, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.unrelatedTask, JSON.stringify({ amount: 100.00 })]);
    }, 'Caller is not authorized to complete task');

    // 1b. Pure Workspace Admin cannot complete unrelated Task
    await expectError(client, async () => {
      await asUser(client, ids.pureAdmin, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.unrelatedTask, JSON.stringify({ amount: 100.00 })]);
    }, 'Caller is not authorized to complete task');

    // Verify task row and expense count untouched on failed attempts
    const { rows: [uTaskRow] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.unrelatedTask]);
    assert.equal(uTaskRow.status_id, ids.statusTodo);
    const { rows: uExpCount } = await client.query(`SELECT count(*) FROM public.expense_transactions WHERE task_id = $1`, [ids.unrelatedTask]);
    assert.equal(Number(uExpCount[0].count), 0, 'No expense persisted on failed authorization');
    pass('1. No-system-role Workspace Owner and Admin CANNOT complete unrelated tasks (fails closed)');

    // 1c. Pure Workspace Owner CAN complete task when legitimately assigned
    const resPureOwner = await asUser(client, ids.pureOwner, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.pureOwnerTask, JSON.stringify({ amount: 250.00, category: 'Hardware' })]);
    assert.equal(resPureOwner.rows[0].res.success, true);
    assert.equal(resPureOwner.rows[0].res.status, 'done');
    pass('1c. Workspace Owner CAN complete when legitimately assigned as Assignee');

    // 1d. Pure Workspace Admin CAN complete task when assigned as RACI R
    const resPureAdmin = await asUser(client, ids.pureAdmin, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.pureAdminRaciTask, JSON.stringify({ amount: 350.00, category: 'Hardware' })]);
    assert.equal(resPureAdmin.rows[0].res.success, true);
    assert.equal(resPureAdmin.rows[0].res.status, 'done');
    pass('1d. Workspace Admin CAN complete when legitimately assigned as RACI R');

    // 1e. Project Owner CAN complete task in owned project
    const resProjOwner = await asUser(client, ids.projOwner, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.unrelatedTask, JSON.stringify({ amount: 450.00, category: 'Hardware' })]);
    assert.equal(resProjOwner.rows[0].res.success, true);
    assert.equal(resProjOwner.rows[0].res.status, 'done');
    pass('1e. Project Owner CAN complete tasks within owned project');

    // 1f. Suspended creator CANNOT complete task
    await expectError(client, async () => {
      await asUser(client, ids.suspendedCreator, `
        SELECT public.complete_task_with_expense($1) AS res
      `, [ids.leafTask1]);
    }, 'Caller does not have mutation capability');
    pass('1f. Suspended workspace creator CANNOT complete tasks');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 2: VIEWER READ-ONLY SERVER-SIDE ENFORCEMENT
    // ──────────────────────────────────────────────────────────────────────────

    // 2a. Viewer as direct assignee cannot complete ordinary Task
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_task_with_expense($1) AS res
      `, [ids.viewerTask]);
    }, 'Caller does not have mutation capability');
    pass('2a. Viewer as direct assignee CANNOT complete ordinary Task (fails closed)');

    // 2b. Viewer with RACI R cannot complete ordinary Task with expense
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
    pass('2b. Viewer with RACI R CANNOT attach expense or mutate task');

    // 2c. Set up Viewer on Process Step Task and verify all process mutation RPCs fail closed
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

    // 2c-1. Viewer cannot complete responsible step with expense
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_responsible_step_with_expense($1, 1, 'Viewer work', $2::jsonb) AS res
      `, [ids.viewerStepTask, JSON.stringify({ amount: 100.00 })]);
    }, 'Caller does not have mutation capability');
    pass('2c-1. Viewer CANNOT execute complete_responsible_step_with_expense');

    // 2c-2. Viewer cannot call complete_responsible_part
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.complete_responsible_part($1, 1, 'Viewer work') AS res
      `, [ids.viewerStepTask]);
    }, 'Caller does not have mutation capability');
    pass('2c-2. Viewer CANNOT execute canonical complete_responsible_part');

    // 2c-3. Viewer cannot call submit_task_evidence
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.submit_task_evidence($1, NULL, 'text', '{"doc": "v"}'::jsonb) AS res
      `, [ids.viewerStepTask]);
    }, 'Caller does not have mutation capability');
    pass('2c-3. Viewer CANNOT execute submit_task_evidence');

    // 2c-4. Viewer cannot call submit_task_consultation
    await expectError(client, async () => {
      await asUser(client, ids.viewer, `
        SELECT public.submit_task_consultation($1, 'Viewer opinion') AS res
      `, [ids.viewerStepTask]);
    }, 'Caller does not have mutation capability');
    pass('2c-4. Viewer CANNOT execute submit_task_consultation');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 3: ORDINARY TASK COMPLETION + EXPENSE RUNTIME
    // ──────────────────────────────────────────────────────────────────────────

    // 3. Ordinary leaf Task completes without expense for authorized Member
    const res1 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1) AS res
    `, [ids.leafTask1]);
    assert.equal(res1.rows[0].res.success, true);
    assert.equal(res1.rows[0].res.status, 'done');
    assert.equal(res1.rows[0].res.transaction_id, null);

    const { rows: [t1] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.leafTask1]);
    assert.equal(t1.status_id, ids.statusDone);
    pass('3. Ordinary leaf Task completes without expense for authorized Member');

    // 4. Ordinary leaf Task completes atomically with single total expense (Mode A)
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
    pass('4. Ordinary leaf Task completes atomically with single total expense (Mode A)');

    // 5. Ordinary leaf Task completes atomically with itemized split expenses (Mode B)
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
    pass('5. Ordinary leaf Task completes atomically with itemized split expenses (Mode B)');

    // 6. Parent Task / Host Task direct completion is strictly REJECTED (P5-02A fail-closed guard)
    // 6a. Parent with child tasks WITHOUT expense is REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1) AS res
      `, [ids.parentTask]);
    }, 'Parent tasks with child dependencies cannot be directly completed');
    pass('6a. Parent Task direct completion WITHOUT expense is strictly REJECTED (P5-02A)');

    // 6b. Parent with child tasks WITH expense is REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.parentTask, JSON.stringify({ amount: 5000.00, category: 'Hardware' })]);
    }, 'Parent tasks with child dependencies cannot be directly completed');
    pass('6b. Parent Task direct completion WITH expense is strictly REJECTED (P5-02A)');

    // 6c. Host task with attached running process WITHOUT expense is REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1) AS res
      `, [ids.hostTaskWithProc]);
    }, 'Parent tasks with child dependencies cannot be directly completed');
    pass('6c. Host Task with attached running Process WITHOUT expense is strictly REJECTED (P5-02A)');

    // 6d. Host task with attached running process WITH expense is REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
      `, [ids.hostTaskWithProc, JSON.stringify({ amount: 3000.00, category: 'Services' })]);
    }, 'Parent tasks with child dependencies cannot be directly completed');
    pass('6d. Host Task with attached running Process WITH expense is strictly REJECTED (P5-02A)');

    // 7. Parent Task auto-completion: P5-01C Exactly-Once & Expense-Free Trigger Verification
    // Step 1: Complete Child 1 via complete_task_with_expense
    const resChild1 = await asUser(client, ids.member, `SELECT public.complete_task_with_expense($1) AS res`, [ids.childTask1]);
    assert.equal(resChild1.rows[0].res.success, true);
    assert.equal(resChild1.rows[0].res.status, 'done');

    // Step 2: Parent remains incomplete and has 0 audit events
    const { rows: [pTaskMid] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.parentTask]);
    assert.equal(pTaskMid.status_id, ids.statusTodo, 'Parent must remain incomplete after completing only Child 1');
    const { rows: pAuditMid } = await client.query(
      `SELECT count(*)::int AS count FROM public.process_audit_events WHERE task_id = $1 AND event_type = 'PARENT_TASK_AUTO_COMPLETED'`,
      [ids.parentTask]
    );
    assert.equal(pAuditMid[0].count, 0, 'No parent auto-completion audit event before all children complete');

    // Step 3: Complete Child 2 using complete_task_with_expense (with child expense)
    const resChild2 = await asUser(client, ids.member, `
      SELECT public.complete_task_with_expense($1, $2::jsonb) AS res
    `, [ids.childTask2, JSON.stringify({ amount: 1500.00, category: 'Hardware', description: 'Child 2 materials' })]);
    assert.equal(resChild2.rows[0].res.success, true);
    assert.equal(resChild2.rows[0].res.status, 'done');

    // Step 4: Parent becomes Done through existing P2-03 trigger architecture
    const { rows: [pTaskAfter] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.parentTask]);
    assert.equal(pTaskAfter.status_id, ids.statusDone, 'Parent must be auto-completed to Done by canonical P2-03 trigger');

    // Step 5: Parent has ZERO direct expense transactions
    const { rows: pExpRows } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.parentTask]);
    assert.equal(pExpRows.length, 0, 'Parent auto-completion must NOT create expense transactions');

    // Step 6: Parent-completion audit/event is created exactly once
    const { rows: pAuditAfter } = await client.query(
      `SELECT count(*)::int AS count FROM public.process_audit_events WHERE task_id = $1 AND event_type = 'PARENT_TASK_AUTO_COMPLETED'`,
      [ids.parentTask]
    );
    assert.equal(pAuditAfter[0].count, 1, 'Parent completion audit event must be created exactly once');

    // Step 7: Parent-completion notification/side effect is not duplicated
    const { rows: pNotifs } = await client.query(
      `SELECT count(*)::int AS count FROM public.notifications WHERE message LIKE '%Parent Task with Children%'`
    );
    const notifCountBeforeRetry = pNotifs[0].count;

    // Step 8: Retry already-completed Child 2
    const resChild2Retry = await asUser(client, ids.member, `SELECT public.complete_task_with_expense($1) AS res`, [ids.childTask2]);
    assert.equal(resChild2Retry.rows[0].res.success, true);
    assert.equal(resChild2Retry.rows[0].res.is_retry, true);

    // Step 9: Parent remains Done
    const { rows: [pTaskAfterRetry] } = await client.query(`SELECT status_id FROM public.tasks WHERE id = $1`, [ids.parentTask]);
    assert.equal(pTaskAfterRetry.status_id, ids.statusDone, 'Parent must remain Done on child retry');

    // Step 10: No second parent completion event appears (idempotency preserved)
    const { rows: pAuditAfterRetry } = await client.query(
      `SELECT count(*)::int AS count FROM public.process_audit_events WHERE task_id = $1 AND event_type = 'PARENT_TASK_AUTO_COMPLETED'`,
      [ids.parentTask]
    );
    assert.equal(pAuditAfterRetry[0].count, 1, 'No second parent completion audit event on retry');

    const { rows: pNotifsAfterRetry } = await client.query(
      `SELECT count(*)::int AS count FROM public.notifications WHERE message LIKE '%Parent Task with Children%'`
    );
    assert.equal(pNotifsAfterRetry[0].count, notifCountBeforeRetry, 'No duplicate notification on retry');

    pass('7. Parent auto-completion exactly-once trigger closure proven (10/10 scenario assertions)');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 4: DEFINED PROCESS RUNTIME & NOTIFICATION INTEGRATION
    // ──────────────────────────────────────────────────────────────────────────

    // 8. Defined Process Step Cycle 1 records expense with cycle provenance
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
    pass('8. Defined Process Step Cycle 1 records expense with cycle provenance');

    // 9. Accountable approval advances step without duplicate expense
    await asUser(client, ids.admin, `
      SELECT public.approve_process_task($1) AS res
    `, [ids.stepTask1]);

    const { rows: [step1Approved] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1`, [ids.stepTask1]);
    assert.equal(step1Approved.workflow_state, 'completed');

    const { rows: step1Approvals } = await client.query(`SELECT * FROM public.expense_transactions WHERE task_id = $1`, [ids.stepTask1]);
    assert.equal(step1Approvals.length, 1, 'Accountable approval must NOT create a duplicate expense transaction');
    pass('9. Accountable approval advances step without creating duplicate expense');

    // 10. Notification Compatibility: submit_task_consultation inserts process_consultation_response notification
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
    pass('10. submit_task_consultation emits process_consultation_response notification cleanly');

    // 11. Rejection / Rework cycle setup:
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
    pass('11. Rejection into rework preserves Cycle 1 expense transaction');

    // 12. Cycle 2 completion with 500.00 additional rework expense
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
    pass('12. Cycle 2 rework expenses accumulate cumulatively into Task Actual Spend (1,500.00)');

    // 13. Process-Cycle Database Unique Index prevents concurrent double expense insertion
    await expectError(client, async () => {
      await client.query(`
        INSERT INTO public.expense_transactions (workspace_id, task_id, cycle_number, status, created_by)
        VALUES ($1, $2, 1, 'active', $3)
      `, [ids.ws, reworkStepTaskId, ids.member]);
    }, 'uq_expense_transactions_task_cycle_active');
    pass('13. Partial unique index uq_expense_transactions_task_cycle_active blocks duplicate active cycle expense');

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 5: AUDIT, CORRECTION, VOID & HARD-DELETE
    // ──────────────────────────────────────────────────────────────────────────

    // 14. Direct authenticated INSERT on expense_transactions is BLOCKED
    await expectError(client, async () => {
      await asUser(client, ids.member, `
        INSERT INTO public.expense_transactions (workspace_id, task_id, status, created_by)
        VALUES ($1, $2, 'active', $3)
      `, [ids.ws, ids.leafTask4, ids.member]);
    }, 'permission denied for table expense_transactions');
    pass('14. Direct authenticated INSERT on expense_transactions is BLOCKED');

    // 15. Expense Correction authorized for Finance Operator
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
    pass('15. Expense Correction authorized for Finance Operator');

    // 16. Expense Correction DENIED for unapproved roles (Project Admin)
    await expectError(client, async () => {
      await asUser(client, ids.projAdmin, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, 'Unauthorized correction') AS res
      `, [tx2Id, JSON.stringify({ amount: 100.00 })]);
    }, 'not authorized to correct expenses');
    pass('16. Expense Correction DENIED for unapproved roles (Project Admin)');

    // 17. Expense Correction requires mandatory non-empty reason
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, '   ') AS res
      `, [tx2Id, JSON.stringify({ amount: 100.00 })]);
    }, 'Correction reason is required');
    pass('17. Expense Correction requires mandatory non-empty reason');

    // 18. Expense Void authorized for Finance Operator
    const resVoid = await asUser(client, ids.finMember, `
      SELECT public.void_expense_transaction($1, 'Duplicate procurement cancelled') AS res
    `, [tx3Id]);
    assert.equal(resVoid.rows[0].res.success, true);
    assert.equal(resVoid.rows[0].res.status, 'voided');

    const { rows: [t3Void] } = await client.query(`SELECT status FROM public.expense_transactions WHERE id = $1`, [tx3Id]);
    assert.equal(t3Void.status, 'voided');
    pass('18. Expense Void authorized for Finance Operator');

    // 19. Correction of voided transaction is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.correct_expense_transaction($1, $2::jsonb, 'Attempt edit voided') AS res
      `, [tx3Id, JSON.stringify({ amount: 100.00 })]);
    }, 'Cannot correct a voided');
    pass('19. Correction of voided transaction is strictly REJECTED');

    // 20. Repeat Void is strictly REJECTED
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.void_expense_transaction($1, 'Repeat void') AS res
      `, [tx3Id]);
    }, 'already voided');
    pass('20. Repeat Void is strictly REJECTED');

    // 21. Admin Hard-Delete physically removes transaction and items
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
    pass('21. Admin Hard-Delete physically removes transaction and items');

    // 22. Finance Operator alone CANNOT hard-delete (Admin/Executive only)
    await expectError(client, async () => {
      await asUser(client, ids.finMember, `
        SELECT public.hard_delete_expense_transaction($1, 'Finance delete attempt') AS res
      `, [tx2Id]);
    }, 'may hard-delete expenses');
    pass('22. Finance Operator alone is DENIED hard-delete authority');

    // 23. Tombstone preserves original transaction UUID and complete immutable snapshot
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
    pass('23. Hard-delete tombstone permanently preserves original transaction UUID and snapshot');

    // 24. Notification constraint drift guard: all 20 emitted types verified accepted
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
    pass('24. Notification constraint drift guard: all 20 emitted types verified accepted');

    // 25. Zero new Security Advisor warnings (verified via query)
    const { rows: pubSecDef } = await client.query(`
      SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prosecdef = true
        AND p.proname IN ('complete_task_with_expense', 'complete_responsible_step_with_expense', 'correct_expense_transaction', 'void_expense_transaction', 'hard_delete_expense_transaction')
    `);
    assert.equal(pubSecDef.length, 0, 'Zero new SECURITY DEFINER functions in public schema');
    pass('25. Zero new SECURITY DEFINER functions introduced in public schema');

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
