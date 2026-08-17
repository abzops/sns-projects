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

    const { rows: [phase] } = await client.query(`
      INSERT INTO public.milestones (project_id, name) VALUES ($1, 'Host Phase') RETURNING id;
    `, [project.id]);

    const { rows: [hostTaskList] } = await client.query(`
      INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, process_state)
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
