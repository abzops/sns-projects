import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

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

async function getConnectionConfig() {
  let envAdmin = {};
  try {
    const envAdminPath = path.join(repoRoot, '.env.admin');
    const content = await readFile(envAdminPath, 'utf8');
    envAdmin = parseEnv(content);
  } catch (e) {
    // envAdmin is optional if standard env vars are provided
  }

  const connectionString = process.env.DATABASE_URL || envAdmin.SUPABASE_DB_URL;
  if (connectionString) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
    };
  }

  const host = process.env.PGHOST || envAdmin.SUPABASE_DB_HOST || '127.0.0.1';
  const port = Number(process.env.PGPORT || envAdmin.SUPABASE_DB_PORT || '54322'); // default local supabase db port
  const database = process.env.PGDATABASE || envAdmin.SUPABASE_DB_NAME || 'postgres';
  const user = process.env.PGUSER || envAdmin.SUPABASE_DB_USER || 'postgres';
  const password = process.env.PGPASSWORD || envAdmin.SUPABASE_DB_PASSWORD || 'postgres';

  return {
    host,
    port,
    database,
    user,
    password: String(password),
    ssl: false,
  };
}

async function runRealDatabaseLifecycleE2E() {
  console.log('======================================================================');
  console.log('TEST DATABASE MODE: LOCAL SUPABASE (Live PostgreSQL Database Required)');
  console.log('SNS Projects — Package 1 / P1-02A: Real Database Lifecycle E2E Suite');
  console.log('======================================================================\n');

  const config = await getConnectionConfig();
  const client = new Client(config);

  try {
    await client.connect();
    console.log(`Successfully connected to PostgreSQL at ${config.host || 'connection string'}:${config.port || 'default'}\n`);
  } catch (err) {
    console.error(`[FATAL] Unable to connect to real PostgreSQL database: ${err.message}`);
    console.error('[FATAL] Hard requirement: Real PostgreSQL instance must be running. No simulation fallback permitted.');
    process.exit(1);
  }

  try {
    // Begin isolated test transaction
    await client.query('BEGIN;');

    // Test Fixture Setup
    const testId = `test_${Date.now()}`;
    const testEmail = `${testId}@example.com`;
    const testUserId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;

    // 1. Create test auth user and profile
    await client.query(`
      INSERT INTO auth.users (id, email)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING;
    `, [testUserId, testEmail]);

    const { rows: [profile] } = await client.query(`
      INSERT INTO public.profiles (id, full_name)
      VALUES ($1, 'Test User')
      ON CONFLICT (id) DO UPDATE SET full_name = 'Test User'
      RETURNING id;
    `, [testUserId]);

    // 2. Create test workspace and owner membership
    const { rows: [workspace] } = await client.query(`
      INSERT INTO public.workspaces (name, created_by)
      VALUES ('Test WS ' || $1, $2)
      RETURNING id;
    `, [testId, profile.id]);

    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES ($1, $2, 'owner', 'active');
    `, [workspace.id, profile.id]);

    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES ($1, $2, 'system_admin')
      ON CONFLICT DO NOTHING;
    `, [workspace.id, profile.id]);

    // Set authenticated session context
    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${profile.id}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: profile.id, role: 'authenticated' })}';`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);

    // 3. Create test department
    const { rows: [department] } = await client.query(`
      INSERT INTO public.departments (workspace_id, code, name, created_by)
      VALUES ($1, 'TD_' || $2, 'Test Dept ' || $2, $3)
      RETURNING id;
    `, [workspace.id, testId.slice(-6), profile.id]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_primary)
      VALUES ($1, $2, $3, true);
    `, [workspace.id, department.id, profile.id]);

    await client.query(`
      INSERT INTO public.workspace_working_calendars (
        workspace_id,
        timezone,
        created_by,
        monday_working,
        tuesday_working,
        wednesday_working,
        thursday_working,
        friday_working,
        saturday_working,
        sunday_working
      ) VALUES (
        $1, 'UTC', $2, true, true, true, true, true, false, false
      ) ON CONFLICT (workspace_id) DO NOTHING;
    `, [workspace.id, profile.id]);

    // 4. Create published defined process with 3 DAG steps: Step 1 -> Step 2 -> Step 3
    const { rows: [proc] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, 'Test Process ' || $3, 'TP_' || $3, $4, $4)
      RETURNING id;
    `, [workspace.id, department.id, testId, profile.id]);

    const { rows: [version] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, published_at, published_by, created_by)
      VALUES ($1, 1, 'published', now(), $2, $2)
      RETURNING id;
    `, [proc.id, profile.id]);

    const { rows: [step1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, description, sequence_order, expected_duration_days)
      VALUES ($1, 'S1', 'Step 1 Root', 'Root step', 1, 3)
      RETURNING id;
    `, [version.id]);

    const { rows: [step2] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, description, sequence_order, expected_duration_days)
      VALUES ($1, 'S2', 'Step 2 Dependent', 'Dependent step', 2, 5)
      RETURNING id;
    `, [version.id]);

    const { rows: [step3] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, description, sequence_order, expected_duration_days, approval_required)
      VALUES ($1, 'S3', 'Step 3 Final', 'Final approval step', 3, 2, true)
      RETURNING id;
    `, [version.id]);

    // Dependencies: Step 1 -> Step 2, Step 2 -> Step 3
    await client.query(`
      INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
      VALUES ($1, $2, $3), ($1, $4, $2);
    `, [version.id, step2.id, step1.id, step3.id]);

    // RACI for steps
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, actor_type, user_id)
      VALUES
        ($1, 'R', 'user', $4),
        ($1, 'A', 'user', $4),
        ($2, 'R', 'user', $4),
        ($2, 'A', 'user', $4),
        ($3, 'R', 'user', $4),
        ($3, 'A', 'user', $4);
    `, [step1.id, step2.id, step3.id, profile.id]);

    // =======================================================================
    // SUITE 1: STANDALONE PROCESS LIFECYCLE & DAG ADVANCEMENT
    // =======================================================================
    console.log('--- Suite 1: Standalone Process Lifecycle ---');
    const startReqId1 = `11111111-1111-1111-1111-${Date.now().toString().slice(-12)}`;

    const { rows: [startRes1] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Standalone Instance 1',
        p_start_request_id => $2::uuid,
        p_overall_due_date => '2026-12-31'::date,
        p_placement_type => 'standalone'
      ) AS res;
    `, [version.id, startReqId1]);

    const instance1 = startRes1.res;
    assert(instance1.process_instance_id && instance1.placement_type === 'standalone', 'Test 1: Standalone process instance created in DB');
    assert(instance1.task_count === 3, 'Test 2: Exactly 3 step tasks materialized in public.tasks');

    // Verify root step ready, downstream waiting, step due dates NULL
    const { rows: tasks1 } = await client.query(`
      SELECT id, process_step_id, workflow_state, due_date
      FROM public.tasks
      WHERE process_instance_id = $1 AND process_step_id IS NOT NULL
      ORDER BY position ASC;
    `, [instance1.process_instance_id]);

    assert(tasks1[0].workflow_state === 'ready' && tasks1[0].due_date === null, 'Test 3: Root step is ready with due_date = NULL');
    assert(tasks1[1].workflow_state === 'waiting' && tasks1[1].due_date === null, 'Test 4: Downstream step is waiting with due_date = NULL');

    // Complete root step
    await client.query(`SELECT private.complete_task_and_advance($1::uuid, $2::uuid);`, [tasks1[0].id, profile.id]);

    const { rows: tasksAfterStep1 } = await client.query(`
      SELECT id, workflow_state, due_date FROM public.tasks WHERE id = $1;
    `, [tasks1[1].id]);
    assert(tasksAfterStep1[0].workflow_state === 'ready' && tasksAfterStep1[0].due_date === null, 'Test 5: Downstream step 2 activated to ready with due_date = NULL');

    // Complete step 2
    await client.query(`SELECT private.complete_task_and_advance($1::uuid, $2::uuid);`, [tasks1[1].id, profile.id]);

    // Complete step 3
    await client.query(`SELECT private.complete_task_and_advance($1::uuid, $2::uuid);`, [tasks1[2].id, profile.id]);

    // Verify Process Instance is now completed
    const { rows: [completedInst1] } = await client.query(`
      SELECT status, completed_at FROM public.process_instances WHERE id = $1;
    `, [instance1.process_instance_id]);
    assert(completedInst1.status === 'completed' && completedInst1.completed_at !== null, 'Test 6: Process Instance automatically transitioned to status = completed');

    // =======================================================================
    // SUITE 2: TASK LIST PLACEMENT & HOST IMMUTABILITY
    // =======================================================================
    console.log('\n--- Suite 2: Task List Placement & Host Immutability ---');
    const { rows: [project] } = await client.query(`
      INSERT INTO public.projects (workspace_id, name) VALUES ($1, 'Host Project') RETURNING id;
    `, [workspace.id]);

    await client.query(`
      INSERT INTO public.task_statuses (project_id, name, color, system_code, position)
      VALUES 
        ($1, 'To Do', '#94a3b8', 'todo', 1000),
        ($1, 'In Progress', '#3b82f6', 'in_progress', 2000),
        ($1, 'Done', '#22c55e', 'done', 3000);
    `, [project.id]);

    const { rows: [phase] } = await client.query(`
      INSERT INTO public.phases (project_id, name) VALUES ($1, 'Host Phase') RETURNING id;
    `, [project.id]);

    const { rows: [hostTaskList] } = await client.query(`
      INSERT INTO public.task_lists (project_id, phase_id, name, task_list_type, process_state)
      VALUES ($1, $2, 'Host Regular Task List', 'custom', NULL)
      RETURNING id, process_state, completed_at;
    `, [project.id, phase.id]);

    const startReqId2 = `22222222-2222-2222-2222-${Date.now().toString().slice(-12)}`;
    const { rows: [startRes2] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Attached Process in TL',
        p_start_request_id => $2::uuid,
        p_placement_type => 'task_list',
        p_project_id => $3,
        p_phase_id => $4,
        p_task_list_id => $5
      ) AS res;
    `, [version.id, startReqId2, project.id, phase.id, hostTaskList.id]);

    const instance2 = startRes2.res;

    // Complete all steps in instance 2
    const { rows: tasks2 } = await client.query(`
      SELECT id FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;
    `, [instance2.process_instance_id]);

    for (const t of tasks2) {
      await client.query(`SELECT private.complete_task_and_advance($1::uuid, $2::uuid);`, [t.id, profile.id]);
    }

    // Verify host task list was NOT mutated
    const { rows: [hostTaskListAfter] } = await client.query(`
      SELECT process_state, completed_at FROM public.task_lists WHERE id = $1;
    `, [hostTaskList.id]);
    assert(hostTaskListAfter.process_state === hostTaskList.process_state && hostTaskListAfter.completed_at === hostTaskList.completed_at, 'Test 7: Host Task List is 100% immutable upon Process Instance completion');

    // =======================================================================
    // SUITE 3: MULTIPLE INSTANCE ISOLATION IN SHARED TASK LIST
    // =======================================================================
    console.log('\n--- Suite 3: Multiple Process Instance Isolation ---');
    const startReqA = `33333333-3333-3333-3333-${Date.now().toString().slice(-12)}`;
    const startReqB = `44444444-4444-4444-4444-${Date.now().toString().slice(-12)}`;

    const { rows: [resA] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Instance A',
        p_start_request_id => $2::uuid,
        p_placement_type => 'task_list',
        p_project_id => $3,
        p_phase_id => $4,
        p_task_list_id => $5
      ) AS res;
    `, [version.id, startReqA, project.id, phase.id, hostTaskList.id]);

    const { rows: [resB] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Instance B',
        p_start_request_id => $2::uuid,
        p_placement_type => 'task_list',
        p_project_id => $3,
        p_phase_id => $4,
        p_task_list_id => $5
      ) AS res;
    `, [version.id, startReqB, project.id, phase.id, hostTaskList.id]);

    const { rows: tasksA } = await client.query(`SELECT id, workflow_state FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [resA.res.process_instance_id]);
    const { rows: tasksB } = await client.query(`SELECT id, workflow_state FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [resB.res.process_instance_id]);

    // Complete Step 1 of Instance A
    await client.query(`SELECT private.complete_task_and_advance($1::uuid, $2::uuid);`, [tasksA[0].id, profile.id]);

    const { rows: [taskA2] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1;`, [tasksA[1].id]);
    const { rows: [taskB1] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1;`, [tasksB[0].id]);
    const { rows: [taskB2] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1;`, [tasksB[1].id]);

    assert(taskA2.workflow_state === 'ready', 'Test 8: Step 2 of Instance A activated to ready');
    assert(taskB1.workflow_state === 'ready' && taskB2.workflow_state === 'waiting', 'Test 9: Instance B steps remained completely untouched');

    // =======================================================================
    // SUITE 4: SERVER-ENFORCED IDEMPOTENCY
    // =======================================================================
    console.log('\n--- Suite 4: Server-Enforced Idempotency ---');
    const idempotencyKey = `55555555-5555-5555-5555-${Date.now().toString().slice(-12)}`;

    // First call
    const { rows: [idem1] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Idempotency Instance',
        p_start_request_id => $2::uuid,
        p_placement_type => 'standalone'
      ) AS res;
    `, [version.id, idempotencyKey]);
    assert(idem1.res.is_replay === false, 'Test 10: First start returns is_replay = false');

    // Exact replay
    const { rows: [idem2] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Idempotency Instance',
        p_start_request_id => $2::uuid,
        p_placement_type => 'standalone'
      ) AS res;
    `, [version.id, idempotencyKey]);
    assert(idem2.res.is_replay === true && idem2.res.process_instance_id === idem1.res.process_instance_id, 'Test 11: Duplicate replay returns existing instance and is_replay = true');

    // Conflicting replay
    let conflictCaught = false;
    await client.query('SAVEPOINT sp_conflict;');
    try {
      await client.query(`
        SELECT public.start_process_instance(
          p_version_id => $1,
          p_instance_name => 'Conflicting Name Attempt',
          p_start_request_id => $2::uuid,
          p_placement_type => 'standalone'
        );
      `, [version.id, idempotencyKey]);
    } catch (err) {
      conflictCaught = err.message.includes('Idempotency conflict');
      await client.query('ROLLBACK TO SAVEPOINT sp_conflict;');
    }
    assert(conflictCaught, 'Test 12: Conflicting payload with same start_request_id is rejected with Idempotency conflict error');

    // =======================================================================
    // SUITE 5: PROGRESS & REWORK CONTRACT
    // =======================================================================
    console.log('\n--- Suite 5: Progress & Rework Contract ---');
    const { rows: [progress] } = await client.query(`
      SELECT public.get_process_instance_progress($1::uuid) AS pct;
    `, [resA.res.process_instance_id]);
    assert(Number(progress.pct) > 0, 'Test 13: get_process_instance_progress computes live progress percentage');

    // =======================================================================
    // SUITE 6: RPC SECURITY, PRIVILEGES & SEARCH_PATH POSTURE
    // =======================================================================
    console.log('\n--- Suite 6: RPC Security, Privileges & Search Path ---');

    // 1. Verify anon EXECUTE is FALSE on all privileged public workflow RPCs
    const { rows: anonPrivs } = await client.query(`
      SELECT
        p.proname,
        n.nspname,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
        p.prosecdef AS is_security_definer,
        p.proconfig AS search_path_config
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'private')
        AND p.proname IN (
          'start_process_instance',
          'get_process_instance_progress',
          'complete_responsible_part',
          'reject_process_task',
          'submit_task_consultation',
          'start_process_instance_internal',
          'complete_responsible_part_internal',
          'reject_process_task_internal'
        )
      ORDER BY n.nspname, p.proname;
    `);

    // Check anon access revoked
    const anonAllowed = anonPrivs.filter(p => p.anon_can_execute);
    assert(anonAllowed.length === 0, `Test 14: anon EXECUTE is false for all privileged workflow RPCs (found ${anonAllowed.length} exposed)`);

    // Check public wrappers are SECURITY INVOKER with fixed search_path
    const publicStart = anonPrivs.find(p => p.nspname === 'public' && p.proname === 'start_process_instance');
    const publicProgress = anonPrivs.find(p => p.nspname === 'public' && p.proname === 'get_process_instance_progress');
    const publicComplete = anonPrivs.find(p => p.nspname === 'public' && p.proname === 'complete_responsible_part');
    const publicReject = anonPrivs.find(p => p.nspname === 'public' && p.proname === 'reject_process_task');

    assert(publicStart && !publicStart.is_security_definer && (publicStart.search_path_config || []).some(c => c.includes('search_path')),
      'Test 15: public.start_process_instance is SECURITY INVOKER with fixed search_path');
    assert(publicProgress && !publicProgress.is_security_definer && (publicProgress.search_path_config || []).some(c => c.includes('search_path')),
      'Test 16: public.get_process_instance_progress is SECURITY INVOKER with fixed search_path');
    assert(publicComplete && !publicComplete.is_security_definer && (publicComplete.search_path_config || []).some(c => c.includes('search_path')),
      'Test 17: public.complete_responsible_part is SECURITY INVOKER with fixed search_path');
    assert(publicReject && !publicReject.is_security_definer && (publicReject.search_path_config || []).some(c => c.includes('search_path')),
      'Test 18: public.reject_process_task is SECURITY INVOKER with fixed search_path');

    // Check private engines are SECURITY DEFINER in private schema
    const privateStart = anonPrivs.find(p => p.nspname === 'private' && p.proname === 'start_process_instance_internal');
    const privateComplete = anonPrivs.find(p => p.nspname === 'private' && p.proname === 'complete_responsible_part_internal');
    const privateReject = anonPrivs.find(p => p.nspname === 'private' && p.proname === 'reject_process_task_internal');

    assert(privateStart && privateStart.is_security_definer && (privateStart.search_path_config || []).some(c => c.includes('search_path')),
      'Test 19: private.start_process_instance_internal is SECURITY DEFINER with fixed search_path');
    assert(privateComplete && privateComplete.is_security_definer && (privateComplete.search_path_config || []).some(c => c.includes('search_path')),
      'Test 20: private.complete_responsible_part_internal is SECURITY DEFINER with fixed search_path');
    assert(privateReject && privateReject.is_security_definer && (privateReject.search_path_config || []).some(c => c.includes('search_path')),
      'Test 21: private.reject_process_task_internal is SECURITY DEFINER with fixed search_path');

    // =======================================================================
    // SUITE 7: CONSULTATION & APPROVAL LIFECYCLE EXECUTION
    // =======================================================================
    console.log('\n--- Suite 7: Consultation & Approval Lifecycle Execution ---');

    // Create a new instance for consultation & approval testing
    const startReqId3 = `66666666-6666-6666-6666-${Date.now().toString().slice(-12)}`;
    const { rows: [startRes3] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Lifecycle Workflow Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'standalone'
      ) AS res;
    `, [version.id, startReqId3]);

    const instance3 = startRes3.res;
    const { rows: tasks3 } = await client.query(`
      SELECT id, workflow_state FROM public.tasks WHERE process_instance_id = $1 AND process_step_id IS NOT NULL ORDER BY position ASC;
    `, [instance3.process_instance_id]);

    // Test public.complete_responsible_part wrapper
    const { rows: [compRes] } = await client.query(`
      SELECT public.complete_responsible_part($1::uuid, 1, 'Initial completion note') AS res;
    `, [tasks3[0].id]);
    assert(compRes.res && (compRes.res.status === 'completed' || compRes.res.status === 'in_review'), 'Test 22: public.complete_responsible_part executes cleanly via SECURITY INVOKER wrapper');

    // =======================================================================
    // SUITE 8: COMPREHENSIVE 5-PLACEMENT REAL DATABASE LIFECYCLE
    // =======================================================================
    console.log('\n--- Suite 8: Comprehensive 5-Placement Real Database Lifecycle ---');

    // 1. Standalone Placement
    const standaloneReq = `88888888-8888-8888-8888-${Date.now().toString().slice(-12)}`;
    const { rows: [pStand] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Placement Standalone Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'standalone'
      ) AS res;
    `, [version.id, standaloneReq]);
    const { rows: [standInst] } = await client.query(`SELECT * FROM public.process_instances WHERE id = $1;`, [pStand.res.process_instance_id]);
    const { rows: standTasks } = await client.query(`SELECT * FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [pStand.res.process_instance_id]);
    assert(standInst.placement_type === 'standalone' && standInst.project_id === null && standTasks.length === 4 && standTasks[0].project_id === null,
      'Test 23: Standalone placement creates container task with null project and 3 subtasks');

    // 2. Project Placement
    const projectReq = `88888888-8888-8888-8889-${Date.now().toString().slice(-12)}`;
    const { rows: [pProj] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Placement Project Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'project',
        p_project_id => $3
      ) AS res;
    `, [version.id, projectReq, project.id]);
    const { rows: [projInst] } = await client.query(`SELECT * FROM public.process_instances WHERE id = $1;`, [pProj.res.process_instance_id]);
    const { rows: projTasks } = await client.query(`SELECT * FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [pProj.res.process_instance_id]);
    assert(projInst.placement_type === 'project' && projInst.project_id === project.id && projTasks.length === 3 && projTasks[0].task_list_id === null,
      'Test 24: Project placement creates instance and step tasks with project_id and null task_list');

    // 3. Phase Placement
    const phaseReq = `88888888-8888-8888-8890-${Date.now().toString().slice(-12)}`;
    const { rows: [pPhase] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Placement Phase Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'phase',
        p_project_id => $3,
        p_phase_id => $4
      ) AS res;
    `, [version.id, phaseReq, project.id, phase.id]);
    const { rows: [phaseInst] } = await client.query(`SELECT * FROM public.process_instances WHERE id = $1;`, [pPhase.res.process_instance_id]);
    const { rows: phaseTasks } = await client.query(`SELECT * FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [pPhase.res.process_instance_id]);
    assert(phaseInst.placement_type === 'phase' && phaseInst.phase_id === phase.id && phaseTasks.length === 3 && phaseTasks[0].phase_id === phase.id,
      'Test 25: Phase placement creates instance and step tasks with project_id and phase_id');

    // 4. Task List Placement
    const taskListReq = `88888888-8888-8888-8891-${Date.now().toString().slice(-12)}`;
    const { rows: [pTaskList] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Placement TaskList Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'task_list',
        p_project_id => $3,
        p_phase_id => $4,
        p_task_list_id => $5
      ) AS res;
    `, [version.id, taskListReq, project.id, phase.id, hostTaskList.id]);
    const { rows: [tlInst] } = await client.query(`SELECT * FROM public.process_instances WHERE id = $1;`, [pTaskList.res.process_instance_id]);
    const { rows: tlTasks } = await client.query(`SELECT * FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [pTaskList.res.process_instance_id]);
    assert(tlInst.placement_type === 'task_list' && tlTasks.length === 3 && tlTasks[0].task_list_id === hostTaskList.id,
      'Test 26: Task List placement creates instance and step tasks in host custom task list');

    // 5. Task-Bound Placement
    const { rows: [todoStatus] } = await client.query(`
      SELECT id FROM public.task_statuses WHERE project_id = $1 LIMIT 1;
    `, [project.id]);

    // Create an ad-hoc parent task in the project
    const { rows: [hostTask] } = await client.query(`
      INSERT INTO public.tasks (project_id, phase_id, task_list_id, title, status_id, position, created_by)
      VALUES ($1, $2, $3, 'Host Parent Task', $4, 5000, $5)
      RETURNING *;
    `, [project.id, phase.id, hostTaskList.id, todoStatus ? todoStatus.id : null, profile.id]);

    const taskBoundReq = `88888888-8888-8888-8892-${Date.now().toString().slice(-12)}`;
    const { rows: [pTaskBound] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Placement TaskBound Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'task',
        p_parent_task_id => $3
      ) AS res;
    `, [version.id, taskBoundReq, hostTask.id]);
    const { rows: [tbInst] } = await client.query(`SELECT * FROM public.process_instances WHERE id = $1;`, [pTaskBound.res.process_instance_id]);
    const { rows: tbTasks } = await client.query(`SELECT * FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [pTaskBound.res.process_instance_id]);
    assert(tbInst.placement_type === 'task' && tbInst.parent_task_id === hostTask.id && tbTasks.length === 3 && tbTasks[0].parent_task_id === hostTask.id,
      'Test 27: Task placement creates instance and child step tasks with parent_task_id hierarchy');

    // =======================================================================
    // SUITE 9: SAME-PROCESS MULTIPLE INSTANCE COLLISION INVARIANT
    // =======================================================================
    console.log('\n--- Suite 9: Same-Process Multiple Instance Collision Invariant ---');

    const multiReq1 = `99999999-9999-9999-9999-${Date.now().toString().slice(-12)}`;
    const multiReq2 = `99999999-9999-9999-8888-${Date.now().toString().slice(-12)}`;

    const { rows: [mRes1] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Concurrent Instance 1',
        p_start_request_id => $2::uuid,
        p_placement_type => 'task_list',
        p_project_id => $3,
        p_phase_id => $4,
        p_task_list_id => $5
      ) AS res;
    `, [version.id, multiReq1, project.id, phase.id, hostTaskList.id]);

    const { rows: [mRes2] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Concurrent Instance 2',
        p_start_request_id => $2::uuid,
        p_placement_type => 'task_list',
        p_project_id => $3,
        p_phase_id => $4,
        p_task_list_id => $5
      ) AS res;
    `, [version.id, multiReq2, project.id, phase.id, hostTaskList.id]);

    assert(mRes1.res.process_instance_id !== mRes2.res.process_instance_id,
      'Test 28: Starting same process twice in same task list creates distinct instances with no unique-index collision');

    const { rows: mTasks1 } = await client.query(`SELECT id, workflow_state FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [mRes1.res.process_instance_id]);
    const { rows: mTasks2 } = await client.query(`SELECT id, workflow_state FROM public.tasks WHERE process_instance_id = $1 ORDER BY position ASC;`, [mRes2.res.process_instance_id]);
    assert(mTasks1.length === 3 && mTasks2.length === 3,
      'Test 29: Both concurrent instances contain exactly 3 materialized step tasks');

    // Complete Step 1 of Instance 1
    await client.query(`SELECT private.complete_task_and_advance($1::uuid, $2::uuid);`, [mTasks1[0].id, profile.id]);
    const { rows: [mTask1_2] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1;`, [mTasks1[1].id]);
    const { rows: [mTask2_1] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1;`, [mTasks2[0].id]);
    const { rows: [mTask2_2] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = $1;`, [mTasks2[1].id]);
    assert(mTask1_2.workflow_state === 'ready' && mTask2_1.workflow_state === 'ready' && mTask2_2.workflow_state === 'waiting',
      'Test 30: Progressing Step 1 of Instance 1 does not mutate Instance 2 state');

    // =======================================================================
    // SUITE 10: LEGACY DEFINED PROCESS INVARIANT & REGRESSION
    // =======================================================================
    console.log('\n--- Suite 10: Legacy Defined Process Invariant & Regression ---');

    // Create a legacy defined task list with version.id
    const { rows: [legacyTaskList] } = await client.query(`
      INSERT INTO public.task_lists (project_id, phase_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at, position)
      VALUES ($1, $2, 'Legacy Defined Task List', 'defined', $3, $4, 'active', $5, now(), 8000)
      RETURNING *;
    `, [project.id, phase.id, proc.id, version.id, profile.id]);

    // Test 31: Legacy version coherence validation trigger
    // Attempt to insert legacy step task with a bogus/mismatched version_id into legacyTaskList
    let versionMismatchCaught = false;
    await client.query('SAVEPOINT sp_version_mismatch;');
    try {
      const bogusVersionId = '00000000-0000-0000-0000-000000000001';
      await client.query(`
        INSERT INTO public.tasks (project_id, phase_id, task_list_id, title, status_id, process_step_id, defined_process_version_id, workflow_state, current_cycle_number, overdue_cycle_notified, position, created_by)
        VALUES ($1, $2, $3, 'Mismatch Step Task', $4, $5, $6, 'ready', 1, false, 9000, $7);
      `, [project.id, phase.id, legacyTaskList.id, todoStatus ? todoStatus.id : null, step1.id, bogusVersionId, profile.id]);
    } catch (err) {
      versionMismatchCaught = err.message.includes('Version coherence violation');
      await client.query('ROLLBACK TO SAVEPOINT sp_version_mismatch;');
    }
    assert(versionMismatchCaught, 'Test 31: Legacy step task insertion into mismatched task list is rejected by validation trigger');

    // Insert valid legacy step 1 task
    const { rows: [legTask1] } = await client.query(`
      INSERT INTO public.tasks (project_id, phase_id, task_list_id, title, status_id, process_step_id, defined_process_version_id, workflow_state, current_cycle_number, overdue_cycle_notified, position, created_by)
      VALUES ($1, $2, $3, 'Legacy Step 1 Task', $4, $5, $6, 'ready', 1, false, 9000, $7)
      RETURNING *;
    `, [project.id, phase.id, legacyTaskList.id, todoStatus ? todoStatus.id : null, step1.id, version.id, profile.id]);

    // Assign caller as Responsible on legacy task
    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id, created_by)
      VALUES ($1, 'R', $2, $2);
    `, [legTask1.id, profile.id]);

    // Test 32: Legacy unique index uq_tasks_legacy_task_list_step (duplicate step in legacy task list)
    let duplicateStepCaught = false;
    await client.query('SAVEPOINT sp_dup_legacy;');
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, phase_id, task_list_id, title, status_id, process_step_id, defined_process_version_id, workflow_state, current_cycle_number, overdue_cycle_notified, position, created_by)
        VALUES ($1, $2, $3, 'Duplicate Legacy Step 1', $4, $5, $6, 'ready', 1, false, 9100, $7);
      `, [project.id, phase.id, legacyTaskList.id, todoStatus ? todoStatus.id : null, step1.id, version.id, profile.id]);
    } catch (err) {
      duplicateStepCaught = err.message.includes('uq_tasks_legacy_task_list_step') || err.message.includes('duplicate key value');
      await client.query('ROLLBACK TO SAVEPOINT sp_dup_legacy;');
    }
    assert(duplicateStepCaught, 'Test 32: Duplicate legacy (task_list_id, process_step_id) insertion is rejected by partial unique index');

    // Test 33: Legacy start_defined_process RPC
    const { rows: [legacyStart] } = await client.query(`
      SELECT public.start_defined_process(
        p_version_id => $1,
        p_project_id => $2,
        p_phase_id => $3,
        p_instance_name => 'Legacy Process Run'
      ) AS res;
    `, [version.id, project.id, phase.id]);
    assert(legacyStart.res && legacyStart.res.task_list_id && legacyStart.res.task_count === 3,
      'Test 33: Legacy start_defined_process RPC functions and instantiates legacy step tasks');

    // Test 34: Legacy 2-argument complete_responsible_part(uuid, text)
    const { rows: [legacyComp] } = await client.query(`
      SELECT public.complete_responsible_part($1::uuid, 'Completed via legacy 2-arg signature') AS res;
    `, [legTask1.id]);
    assert(legacyComp.res && (legacyComp.res.status === 'completed' || legacyComp.res.completed === true),
      'Test 34: Legacy 2-argument complete_responsible_part(uuid, text) functions seamlessly');

    // Always rollback isolated test transaction
    await client.query('ROLLBACK;');
    console.log('\nAll test database transactions rolled back cleanly.');

  } catch (err) {
    try { await client.query('ROLLBACK;'); } catch (e) {}
    console.error('Test execution failed:', err);
    failed++;
  } finally {
    await client.end();
  }

  console.log('\n======================================================================');
  console.log(`Real Database E2E Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRealDatabaseLifecycleE2E().catch(err => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});

