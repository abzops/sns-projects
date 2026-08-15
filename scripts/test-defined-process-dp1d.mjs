import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

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

async function runDP1DTests() {
  console.log('===============================================================');
  console.log('SNS Projects — DP-1-D Runtime Provenance & Guard Verification');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = '') {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));

  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  // Load columns & constraints
  const { rows: tlCols } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_lists';
  `);
  const tlColMap = new Map(tlCols.map(c => [c.column_name, c]));

  const { rows: tCols } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks';
  `);
  const tColMap = new Map(tCols.map(c => [c.column_name, c]));

  const { rows: tlCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.task_lists'::regclass;
  `);
  const { rows: tCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass;
  `);

  // SECTION 1: TASK LIST STRUCTURE
  assert(tlColMap.has('task_list_type'), 'Test 1: task_list_type column exists on task_lists');

  const { rows: [{ count: nonCustomTlCount }] } = await client.query(`
    SELECT count(*)::int as count FROM public.task_lists WHERE task_list_type <> 'custom';
  `);
  assert(nonCustomTlCount === 0, `Test 2: all existing production Task Lists default custom (non-custom: ${nonCustomTlCount})`);

  const chkTlType = tlCons.find(c => c.def.includes('task_list_type') && c.def.includes("'custom'") && c.def.includes("'defined'"));
  assert(!!chkTlType, 'Test 3: task_list_type CHECK constraint enforces custom/defined');

  const fkProcessVer = tlCons.find(c => c.def.includes('defined_process_version_id') && c.def.includes('defined_process_versions(id, defined_process_id)'));
  assert(!!fkProcessVer, 'Test 4: task_lists composite FK to defined_process_versions(id, defined_process_id) exists');

  const uqTlVer = tlCons.find(c => c.def.includes('id') && c.def.includes('defined_process_version_id'));
  assert(!!uqTlVer, 'Test 11: task_lists UNIQUE (id, defined_process_version_id) constraint exists');

  // SECTION 2: TASK STRUCTURE
  assert(
    tColMap.has('defined_process_version_id') &&
    tColMap.has('process_step_id') &&
    tColMap.has('workflow_state') &&
    tColMap.has('current_cycle_number') &&
    tColMap.has('ready_at') &&
    tColMap.has('activated_at') &&
    tColMap.has('workflow_completed_at') &&
    tColMap.has('overdue_cycle_notified'),
    'Test 12: all 8 new process columns exist on tasks table'
  );

  const chkWfState = tCons.find(c => c.def.includes('workflow_state') && c.def.includes("'waiting'") && c.def.includes("'completed'"));
  assert(!!chkWfState, 'Test 13: workflow_state CHECK constraint enforces valid states');

  const fkTaskStepVer = tCons.find(c => c.def.includes('process_step_id') && c.def.includes('defined_process_steps(id, version_id)'));
  assert(!!fkTaskStepVer, 'Test 19: tasks composite FK to defined_process_steps(id, version_id) exists');

  const fkTaskTlVer = tCons.find(c => c.def.includes('task_list_id') && c.def.includes('task_lists(id, defined_process_version_id)'));
  assert(!!fkTaskTlVer, 'Test 20: tasks composite FK to task_lists(id, defined_process_version_id) exists');

  const { rows: tIndexes } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tasks';
  `);
  const uqTaskStep = tIndexes.find(i => i.indexname === 'uq_tasks_task_list_process_step' && i.indexdef.includes('UNIQUE'));
  assert(!!uqTaskStep, 'Test 21: partial UNIQUE index on (task_list_id, process_step_id) exists');

  const { rows: [{ count: nonCustomTaskCount }] } = await client.query(`
    SELECT count(*)::int as count FROM public.tasks WHERE process_step_id IS NOT NULL;
  `);
  assert(nonCustomTaskCount === 0, `Test 23: all existing 24 production Tasks remain custom/legacy (defined count: ${nonCustomTaskCount})`);

  // SECTION 3: TRIGGERS & RPC CONTRACTS
  const { rows: trigProcs } = await client.query(`
    SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('trg_fn_guard_defined_task_mutation', 'trg_fn_guard_defined_task_list_mutation')
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'private');
  `);
  const allInvoker = trigProcs.length === 2 && trigProcs.every(p => p.prosecdef === false);
  assert(allInvoker, 'Test 43: mutation guard trigger functions are strictly SECURITY INVOKER');

  const { rows: raciPolicies } = await client.query(`
    SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_raci_assignments';
  `);
  const hasManageAll = raciPolicies.some(p => p.policyname === 'task_raci_manage');
  const hasInsert = raciPolicies.some(p => p.policyname === 'task_raci_insert_member' && p.cmd === 'INSERT');
  const hasUpdate = raciPolicies.some(p => p.policyname === 'task_raci_update_member' && p.cmd === 'UPDATE');
  const hasDelete = raciPolicies.some(p => p.policyname === 'task_raci_delete_member' && p.cmd === 'DELETE');
  assert(!hasManageAll, 'Test 57: task_raci_manage ALL policy removed');
  assert(hasInsert && hasUpdate && hasDelete, 'Test 58: operation-specific mutation policies exist (INSERT/UPDATE/DELETE)');

  const { rows: rpcRows } = await client.query(`
    SELECT proname, prosecdef, pg_get_function_arguments(oid) as args
    FROM pg_proc
    WHERE proname = 'reorder_kanban_tasks' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  `);
  assert(
    rpcRows.length === 1 &&
    rpcRows[0].args === 'p_task_id uuid, p_new_status_id uuid, p_source_task_ids uuid[], p_destination_task_ids uuid[]' &&
    rpcRows[0].prosecdef === false,
    'Test 65-67: reorder_kanban_tasks contract unchanged (4-arg signature, SECURITY INVOKER)'
  );

  // Notification suppression trigger
  const { rows: notifTrigDef } = await client.query(`
    SELECT prosrc FROM pg_proc WHERE proname = 'trg_fn_task_status_changed'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'private');
  `);
  assert(
    notifTrigDef.length === 1 && notifTrigDef[0].prosrc.includes('NEW.process_step_id IS NOT NULL'),
    'Test 68-70: trg_fn_task_status_changed suppresses generic status notification for Defined tasks'
  );

  // =========================================================================
  // TRANSACTIONAL TESTS (SANDBOX WITH AUTOMATIC ROLLBACK & SAVEPOINTS)
  // =========================================================================
  console.log('\n--- Running Transactional Constraint, Guard & Integrity Tests (Auto-Rollback) ---');

  const { rows: [testProfile] } = await client.query(`SELECT id FROM public.profiles LIMIT 1;`);
  const { rows: [testDept] } = await client.query(`SELECT id FROM public.departments WHERE workspace_id = $1 LIMIT 1;`, [wsId]);
  const { rows: [testProj] } = await client.query(`SELECT id FROM public.projects WHERE workspace_id = $1 LIMIT 1;`, [wsId]);
  const { rows: [testMs] } = await client.query(`SELECT id FROM public.milestones WHERE project_id = $1 LIMIT 1;`, [testProj.id]);
  const { rows: [statusTodo] } = await client.query(`SELECT id FROM public.task_statuses WHERE project_id = $1 AND system_code = 'todo' LIMIT 1;`, [testProj.id]);
  const { rows: [statusDone] } = await client.query(`SELECT id FROM public.task_statuses WHERE project_id = $1 AND system_code = 'done' LIMIT 1;`, [testProj.id]);

  await client.query('BEGIN');
  try {
    // Set trusted internal Process Engine context for fixture setup
    await client.query(`SELECT set_config('sns.process_engine_write', 'on', true);`);

    // 1. Create test process & 2 versions
    const { rows: [procA] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, 'DP1D Sandbox Process A', 'DP1D-A', $3, $3)
      RETURNING id;
    `, [wsId, testDept.id, testProfile.id]);

    const { rows: [procB] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, 'DP1D Sandbox Process B', 'DP1D-B', $3, $3)
      RETURNING id;
    `, [wsId, testDept.id, testProfile.id]);

    const { rows: [verA1] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, created_by, published_by, published_at)
      VALUES ($1, 1, 'published', $2, $2, now())
      RETURNING id;
    `, [procA.id, testProfile.id]);

    const { rows: [verB1] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, created_by, published_by, published_at)
      VALUES ($1, 1, 'published', $2, $2, now())
      RETURNING id;
    `, [procB.id, testProfile.id]);

    // Create steps for verA1
    const { rows: [stepA1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'STP-01', 'Step 1', 1, 2)
      RETURNING id;
    `, [verA1.id]);

    const { rows: [stepA2] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'STP-02', 'Step 2', 2, 3)
      RETURNING id;
    `, [verA1.id]);

    // 5. process/version mismatch rejected on task_lists
    await client.query('SAVEPOINT sp_ver_mismatch;');
    let verMismatchFailed = false;
    try {
      await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at)
        VALUES ($1, $2, 'Mismatch List', 'defined', $3, $4, 'active', $5, now());
      `, [testProj.id, testMs.id, procA.id, verB1.id, testProfile.id]); // procA with verB1!
    } catch (e) {
      verMismatchFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_ver_mismatch;');
    }
    assert(verMismatchFailed, 'Test 5: process/version mismatch on task_list rejected by composite FK');

    // 6. custom Task List with provenance rejected
    await client.query('SAVEPOINT sp_custom_prov;');
    let customProvFailed = false;
    try {
      await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id)
        VALUES ($1, $2, 'Bad Custom List', 'custom', $3);
      `, [testProj.id, testMs.id, procA.id]);
    } catch (e) {
      customProvFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_custom_prov;');
    }
    assert(customProvFailed, 'Test 6: custom Task List with process provenance rejected by CHECK');

    // 7. defined active lifecycle accepted
    const { rows: [defTl1] } = await client.query(`
      INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at)
      VALUES ($1, $2, 'Live Defined Process Instance 1', 'defined', $3, $4, 'active', $5, now())
      RETURNING id;
    `, [testProj.id, testMs.id, procA.id, verA1.id, testProfile.id]);
    assert(true, 'Test 7: defined active lifecycle accepted');

    // 8. invalid completed lifecycle rejected (completed_at NULL)
    await client.query('SAVEPOINT sp_bad_completed;');
    let badCompletedFailed = false;
    try {
      await client.query(`
        UPDATE public.task_lists SET process_state = 'completed', completed_at = NULL WHERE id = $1;
      `, [defTl1.id]);
    } catch (e) {
      badCompletedFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_completed;');
    }
    assert(badCompletedFailed, 'Test 8: invalid completed lifecycle rejected by CHECK');

    // 9-10. invalid cancelled lifecycle rejected (cancelled_at or reason missing/blank)
    await client.query('SAVEPOINT sp_bad_cancelled;');
    let badCancelledFailed = false;
    try {
      await client.query(`
        UPDATE public.task_lists SET process_state = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancellation_reason = '   ' WHERE id = $1;
      `, [defTl1.id, testProfile.id]);
    } catch (e) {
      badCancelledFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_cancelled;');
    }
    assert(badCancelledFailed, 'Test 9-10: invalid cancelled lifecycle / blank cancellation reason rejected by CHECK');

    // 14. invalid workflow state rejected on tasks
    await client.query('SAVEPOINT sp_bad_wf;');
    let badWfFailed = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
        VALUES ($1, $2, $3, 'Bad Task', $4, $5, $6, 'invalid_status', 1, false);
      `, [testProj.id, testMs.id, defTl1.id, statusTodo.id, verA1.id, stepA1.id]);
    } catch (e) {
      badWfFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_wf;');
    }
    assert(badWfFailed, 'Test 14: invalid workflow state rejected on tasks by CHECK');

    // 15. current_cycle_number >= 1 enforced on defined tasks
    await client.query('SAVEPOINT sp_bad_cycle;');
    let badCycleFailed = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
        VALUES ($1, $2, $3, 'Bad Cycle Task', $4, $5, $6, 'ready', 0, false);
      `, [testProj.id, testMs.id, defTl1.id, statusTodo.id, verA1.id, stepA1.id]);
    } catch (e) {
      badCycleFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_cycle;');
    }
    assert(badCycleFailed, 'Test 15: current_cycle_number >= 1 enforced on defined tasks');

    // 16. Custom Task with workflow metadata rejected
    await client.query('SAVEPOINT sp_custom_wf;');
    let customWfFailed = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, title, status_id, workflow_state)
        VALUES ($1, $2, 'Custom Bad Task', $3, 'active');
      `, [testProj.id, testMs.id, statusTodo.id]);
    } catch (e) {
      customWfFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_custom_wf;');
    }
    assert(customWfFailed, 'Test 16: Custom Task with workflow metadata rejected by CHECK');

    // 18. Defined Task with assignee_id rejected
    await client.query('SAVEPOINT sp_def_assignee;');
    let defAssigneeFailed = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, assignee_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
        VALUES ($1, $2, $3, 'Bad Assignee Task', $4, $5, $6, $7, 'ready', 1, false);
      `, [testProj.id, testMs.id, defTl1.id, statusTodo.id, testProfile.id, verA1.id, stepA1.id]);
    } catch (e) {
      defAssigneeFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_def_assignee;');
    }
    assert(defAssigneeFailed, 'Test 18: Defined Task with assignee_id rejected (must use RACI)');

    // 19. Step/Version mismatch rejected on task
    await client.query('SAVEPOINT sp_task_step_ver;');
    let taskStepVerFailed = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
        VALUES ($1, $2, $3, 'Step Version Mismatch Task', $4, $5, $6, 'ready', 1, false);
      `, [testProj.id, testMs.id, defTl1.id, statusTodo.id, verB1.id, stepA1.id]); // verB1 with stepA1!
    } catch (e) {
      taskStepVerFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_task_step_ver;');
    }
    assert(taskStepVerFailed, 'Test 19: Step/Version mismatch rejected by composite FK');

    // 20. Task / Task List version mismatch rejected
    const { rows: [defTl2] } = await client.query(`
      INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at)
      VALUES ($1, $2, 'Live Instance 2', 'defined', $3, $4, 'active', $5, now())
      RETURNING id;
    `, [testProj.id, testMs.id, procB.id, verB1.id, testProfile.id]);

    await client.query('SAVEPOINT sp_task_tl_ver;');
    let taskTlVerFailed = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
        VALUES ($1, $2, $3, 'Task TL Version Mismatch', $4, $5, $6, 'ready', 1, false);
      `, [testProj.id, testMs.id, defTl2.id, statusTodo.id, verA1.id, stepA1.id]); // defTl2 has verB1, but task has verA1!
    } catch (e) {
      taskTlVerFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_task_tl_ver;');
    }
    assert(taskTlVerFailed, 'Test 20: Task / Task List version mismatch rejected by composite FK');

    // Insert valid runtime tasks into defTl1
    const { rows: [defTask1] } = await client.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified, position)
      VALUES ($1, $2, $3, 'Step 1 Task', $4, $5, $6, 'ready', 1, false, 8000)
      RETURNING id;
    `, [testProj.id, testMs.id, defTl1.id, statusTodo.id, verA1.id, stepA1.id]);

    const { rows: [defTask2] } = await client.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified, position)
      VALUES ($1, $2, $3, 'Step 2 Task', $4, $5, $6, 'waiting', 1, false, 9000)
      RETURNING id;
    `, [testProj.id, testMs.id, defTl1.id, statusTodo.id, verA1.id, stepA2.id]);

    // 21. Duplicate runtime step in one task list rejected
    await client.query('SAVEPOINT sp_dup_runtime_step;');
    let dupRuntimeStepFailed = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
        VALUES ($1, $2, $3, 'Duplicate Step 1', $4, $5, $6, 'ready', 1, false);
      `, [testProj.id, testMs.id, defTl1.id, statusTodo.id, verA1.id, stepA1.id]);
    } catch (e) {
      dupRuntimeStepFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_dup_runtime_step;');
    }
    assert(dupRuntimeStepFailed, 'Test 21: duplicate runtime step in same process instance rejected by partial UNIQUE');

    // 22. Same step may exist in a different process instance
    const { rows: [defTl1B] } = await client.query(`
      INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at)
      VALUES ($1, $2, 'Live Instance 1B', 'defined', $3, $4, 'active', $5, now())
      RETURNING id;
    `, [testProj.id, testMs.id, procA.id, verA1.id, testProfile.id]);

    const { rows: [defTask1B] } = await client.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified, position)
      VALUES ($1, $2, $3, 'Step 1 Task in Instance B', $4, $5, $6, 'ready', 1, false, 8000)
      RETURNING id;
    `, [testProj.id, testMs.id, defTl1B.id, statusTodo.id, verA1.id, stepA1.id]);
    assert(!!defTask1B.id, 'Test 22: same Step can instantiate in different process instances');

    // 42. Trusted postgres + transaction-local marker can perform protected update
    await client.query(`
      UPDATE public.tasks SET workflow_state = 'active', activated_at = now() WHERE id = $1;
    `, [defTask1.id]);
    assert(true, 'Test 42: trusted internal process engine can perform protected workflow update');

    // Turn off trusted context and switch to authenticated role
    await client.query(`SELECT set_config('sns.process_engine_write', 'off', true);`);
    await client.query('SET LOCAL ROLE authenticated;');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${testProfile.id}"}';`);

    // 24. Browser direct Defined Task List INSERT rejected
    await client.query('SAVEPOINT sp_auth_ins_tl;');
    let authInsTlBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at)
        VALUES ('${testProj.id}', '${testMs.id}', 'Hacked List', 'defined', '${procA.id}', '${verA1.id}', 'active', '${testProfile.id}', now());
      `);
    } catch (e) {
      authInsTlBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_ins_tl;');
    }
    assert(authInsTlBlocked, 'Test 24: browser direct Defined Task List INSERT rejected by RLS & guard');

    // 25. Browser direct Defined Task INSERT rejected
    await client.query('SAVEPOINT sp_auth_ins_task;');
    let authInsTaskBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
        VALUES ('${testProj.id}', '${testMs.id}', '${defTl1.id}', 'Hacked Task', '${statusTodo.id}', '${verA1.id}', '${stepA1.id}', 'ready', 1, false);
      `);
    } catch (e) {
      authInsTaskBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_ins_task;');
    }
    assert(authInsTaskBlocked, 'Test 25: browser direct Defined Task INSERT rejected by RLS & guard');

    // 26. Browser cannot add Custom Task into Defined Task List
    await client.query('SAVEPOINT sp_auth_ins_custom_in_def;');
    let authCustomInDefBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id)
        VALUES ('${testProj.id}', '${testMs.id}', '${defTl1.id}', 'Custom in Def List', '${statusTodo.id}');
      `);
    } catch (e) {
      authCustomInDefBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_ins_custom_in_def;');
    }
    assert(authCustomInDefBlocked, 'Test 26: browser adding Custom Task into Defined Task List rejected');

    // 27. Browser Defined Task DELETE rejected (either rowCount = 0 or exception)
    await client.query('SAVEPOINT sp_auth_del_def_task;');
    let authDelDefTaskBlocked = false;
    try {
      const res = await client.query(`DELETE FROM public.tasks WHERE id = '${defTask1.id}';`);
      if (res.rowCount === 0) authDelDefTaskBlocked = true;
    } catch (e) {
      authDelDefTaskBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_del_def_task;');
    }
    assert(authDelDefTaskBlocked, 'Test 27: browser Defined Task DELETE rejected by RLS & guard');

    // 28. Browser Defined Task List DELETE rejected (either rowCount = 0 or exception)
    await client.query('SAVEPOINT sp_auth_del_def_tl;');
    let authDelDefTlBlocked = false;
    try {
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${defTl1.id}';`);
      if (res.rowCount === 0) authDelDefTlBlocked = true;
    } catch (e) {
      authDelDefTlBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_del_def_tl;');
    }
    assert(authDelDefTlBlocked, 'Test 28: browser Defined Task List DELETE rejected by RLS & guard');

    // 31. Direct Defined Task status update rejected
    await client.query('SAVEPOINT sp_auth_upd_status;');
    let authUpdStatusBlocked = false;
    try {
      await client.query(`UPDATE public.tasks SET status_id = '${statusDone.id}' WHERE id = '${defTask1.id}';`);
    } catch (e) {
      authUpdStatusBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_upd_status;');
    }
    assert(authUpdStatusBlocked, 'Test 31: direct Defined Task status update rejected by guard trigger');

    // 32. Direct Defined Task due_date update rejected
    await client.query('SAVEPOINT sp_auth_upd_due;');
    let authUpdDueBlocked = false;
    try {
      await client.query(`UPDATE public.tasks SET due_date = '2026-12-31' WHERE id = '${defTask1.id}';`);
    } catch (e) {
      authUpdDueBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_upd_due;');
    }
    assert(authUpdDueBlocked, 'Test 32: direct Defined Task due_date update rejected by guard trigger');

    // 33. Direct Defined Task workflow_state update rejected
    await client.query('SAVEPOINT sp_auth_upd_wf;');
    let authUpdWfBlocked = false;
    try {
      await client.query(`UPDATE public.tasks SET workflow_state = 'completed' WHERE id = '${defTask1.id}';`);
    } catch (e) {
      authUpdWfBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_upd_wf;');
    }
    assert(authUpdWfBlocked, 'Test 33: direct Defined Task workflow_state update rejected by guard trigger');

    // 34-37. Direct Defined Task title / assignee / hierarchy updates rejected
    await client.query('SAVEPOINT sp_auth_upd_title;');
    let authUpdTitleBlocked = false;
    try {
      await client.query(`UPDATE public.tasks SET title = 'Hacked Title' WHERE id = '${defTask1.id}';`);
    } catch (e) {
      authUpdTitleBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_upd_title;');
    }
    assert(authUpdTitleBlocked, 'Test 34-37: direct Defined Task title update rejected by guard trigger');

    // 38-40. Defined Task safe metadata edits allowed (description, priority, position)
    await client.query(`
      UPDATE public.tasks SET description = 'Updated Description', priority = 'urgent', position = 1500 WHERE id = '${defTask1.id}';
    `);
    assert(true, 'Test 38-40: Defined Task safe metadata edits (description, priority, position) allowed');

    // 41. FORGED GUC BYPASS TEST: Authenticated user sets sns.process_engine_write='on', but protected update STILL rejected!
    await client.query(`SELECT set_config('sns.process_engine_write', 'on', true);`);
    await client.query('SAVEPOINT sp_forged_guc;');
    let forgedGucBlocked = false;
    try {
      await client.query(`UPDATE public.tasks SET workflow_state = 'completed' WHERE id = '${defTask1.id}';`);
    } catch (e) {
      forgedGucBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_forged_guc;');
    }
    assert(forgedGucBlocked, 'Test 41: FORGED GUC BYPASS REJECTED (current_user != postgres check enforced)');

    // 44-46. Defined Task List process_state direct update rejected
    await client.query('SAVEPOINT sp_auth_upd_tl_state;');
    let authUpdTlStateBlocked = false;
    try {
      await client.query(`UPDATE public.task_lists SET process_state = 'completed' WHERE id = '${defTl1.id}';`);
    } catch (e) {
      authUpdTlStateBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_upd_tl_state;');
    }
    assert(authUpdTlStateBlocked, 'Test 44: Defined Task List process_state direct update rejected by guard');

    // 47-49. Defined Task List safe metadata edits allowed (name, description, position)
    await client.query(`
      UPDATE public.task_lists SET name = 'Renamed List', description = 'Safe Edit', position = 5000 WHERE id = '${defTl1.id}';
    `);
    assert(true, 'Test 47-49: Defined Task List safe metadata edits (name, description, position) allowed');

    // 50-52. Custom Task RACI mutation works
    const { rows: [customTl] } = await client.query(`
      SELECT id FROM public.task_lists WHERE milestone_id = $1 AND task_list_type = 'custom' LIMIT 1;
    `, [testMs.id]);

    const { rows: [customTask] } = await client.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
      VALUES ('${testProj.id}', '${testMs.id}', '${customTl.id}', 'Custom Sibling', '${statusTodo.id}', 10000)
      RETURNING id;
    `);

    const { rows: [customRaci] } = await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ('${customTask.id}', 'R', '${testProfile.id}')
      RETURNING id;
    `);
    assert(!!customRaci.id, 'Test 50: Custom Task RACI INSERT allowed to authorized member');

    await client.query(`
      UPDATE public.task_raci_assignments SET raci_role = 'A' WHERE id = '${customRaci.id}';
    `);
    assert(true, 'Test 51: Custom Task RACI UPDATE allowed');

    await client.query(`
      DELETE FROM public.task_raci_assignments WHERE id = '${customRaci.id}';
    `);
    assert(true, 'Test 52: Custom Task RACI DELETE allowed');

    // 52a. Verify ordinary workspace member CANNOT delete Task Lists
    await client.query('SET LOCAL ROLE postgres;');
    const memberUid = '22222222-2222-2222-2222-222222222222';
    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ('${memberUid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'testmember@example.com', '', now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'Test Member'), now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.profiles (id, full_name) VALUES ('${memberUid}', 'Test Member')
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES ('${wsId}', '${memberUid}', 'member', 'active')
      ON CONFLICT (workspace_id, user_id) WHERE user_id IS NOT NULL
      DO UPDATE SET role = 'member', status = 'active';
    `);
    await client.query('SET LOCAL ROLE authenticated;');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${memberUid}"}';`);

    const memberDelRes = await client.query(`DELETE FROM public.task_lists WHERE id = '${customTl.id}';`);
    assert(memberDelRes.rowCount === 0, 'Test 52a: ordinary workspace member CANNOT delete Task Lists');

    // 52b. Verify project_admin system role has full Custom Task List / Task / RACI authority
    await client.query('SET LOCAL ROLE postgres;');
    const paUid = '44444444-4444-4444-4444-444444444444';
    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ('${paUid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'testpa@example.com', '', now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'Test ProjAdmin'), now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.profiles (id, full_name) VALUES ('${paUid}', 'Test ProjAdmin')
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES ('${wsId}', '${paUid}', 'viewer', 'active')
      ON CONFLICT (workspace_id, user_id) WHERE user_id IS NOT NULL
      DO UPDATE SET role = 'viewer', status = 'active';
    `);
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role, created_by)
      VALUES ('${wsId}', '${paUid}', 'project_admin', '${testProfile.id}')
      ON CONFLICT (workspace_id, user_id, role) DO NOTHING;
    `);
    await client.query('SET LOCAL ROLE authenticated;');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${paUid}"}';`);

    // PA Task List INSERT & DELETE
    const { rows: [paTl] } = await client.query(`
      INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
      VALUES ('${testProj.id}', '${testMs.id}', 'PA Task List', 'custom')
      RETURNING id;
    `);
    assert(!!paTl.id, 'Test 52b: project_admin custom Task List INSERT allowed');

    // PA Task INSERT
    const { rows: [paTask] } = await client.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
      VALUES ('${testProj.id}', '${testMs.id}', '${paTl.id}', 'PA Task', '${statusTodo.id}', 12000)
      RETURNING id;
    `);
    assert(!!paTask.id, 'Test 52c: project_admin custom Task INSERT allowed');

    // PA RACI INSERT / UPDATE / DELETE
    const { rows: [paRaci] } = await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ('${paTask.id}', 'R', '${paUid}')
      RETURNING id;
    `);
    assert(!!paRaci.id, 'Test 52d: project_admin Task RACI INSERT allowed');

    await client.query(`UPDATE public.task_raci_assignments SET raci_role = 'A' WHERE id = '${paRaci.id}';`);
    assert(true, 'Test 52e: project_admin Task RACI UPDATE allowed');

    await client.query(`DELETE FROM public.task_raci_assignments WHERE id = '${paRaci.id}';`);
    assert(true, 'Test 52f: project_admin Task RACI DELETE allowed');

    // PA Task DELETE
    const paTaskDelRes = await client.query(`DELETE FROM public.tasks WHERE id = '${paTask.id}';`);
    assert(paTaskDelRes.rowCount === 1, 'Test 52g: project_admin custom Task DELETE allowed');

    // PA Task List DELETE
    const paTlDelRes = await client.query(`DELETE FROM public.task_lists WHERE id = '${paTl.id}';`);
    assert(paTlDelRes.rowCount === 1, 'Test 52h: project_admin custom Task List DELETE allowed');

    // Switch back to owner for remainder of tests
    await client.query('SET LOCAL ROLE authenticated;');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${testProfile.id}"}';`);

    // 53-55. Defined Task RACI direct mutation rejected
    await client.query('SAVEPOINT sp_auth_ins_def_raci;');
    let authInsDefRaciBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
        VALUES ('${defTask1.id}', 'R', '${testProfile.id}');
      `);
    } catch (e) {
      authInsDefRaciBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_ins_def_raci;');
    }
    assert(authInsDefRaciBlocked, 'Test 53: Defined Task RACI direct INSERT rejected by RLS');

    // 56. Defined Task RACI SELECT remains visible to active members
    // (Switch to trusted to insert raci row, then switch back to authenticated)
    await client.query(`SELECT set_config('sns.process_engine_write', 'on', true);`);
    await client.query('SET LOCAL ROLE postgres;');
    const { rows: [defRaci] } = await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ('${defTask1.id}', 'R', '${testProfile.id}')
      RETURNING id;
    `);
    await client.query(`SELECT set_config('sns.process_engine_write', 'off', true);`);
    await client.query('SET LOCAL ROLE authenticated;');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${testProfile.id}"}';`);

    const { rows: readRaciRows } = await client.query(`
      SELECT id FROM public.task_raci_assignments WHERE id = '${defRaci.id}';
    `);
    assert(readRaciRows.length === 1, 'Test 56: Defined Task RACI SELECT remains visible to active member');

    // Fetch all current tasks in statusTodo for project
    const { rows: currentTodoTasks } = await client.query(`
      SELECT id FROM public.tasks WHERE project_id = $1 AND status_id = $2 ORDER BY position ASC;
    `, [testProj.id, statusTodo.id]);
    const todoIds = currentTodoTasks.map(t => t.id);

    // 61. Defined same-column Kanban reorder PASS (with complete column array)
    const sameColRes = await client.query(`
      SELECT public.reorder_kanban_tasks(
        '${defTask1.id}',
        '${statusTodo.id}',
        $1::uuid[],
        $1::uuid[]
      );
    `, [todoIds]);
    assert(sameColRes.rows.length === 1, 'Test 61: Defined Task same-column Kanban reorder PASS');

    // 62. Defined cross-column Kanban reorder REJECTED
    await client.query('SAVEPOINT sp_def_cross_dnd;');
    let defCrossDndBlocked = false;
    try {
      const remainingSource = todoIds.filter(id => id !== defTask1.id);
      await client.query(`
        SELECT public.reorder_kanban_tasks(
          '${defTask1.id}',
          '${statusDone.id}',
          $1::uuid[],
          ARRAY['${defTask1.id}']::uuid[]
        );
      `, [remainingSource]);
    } catch (e) {
      defCrossDndBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_def_cross_dnd;');
    }
    assert(defCrossDndBlocked, 'Test 62: Defined Task cross-status Kanban DnD REJECTED with workflow exception');

    // 63. Mixed Custom + Defined column ordering PASS
    const { rows: allMixedTodoTasks } = await client.query(`
      SELECT id FROM public.tasks WHERE project_id = $1 AND status_id = $2 ORDER BY position ASC;
    `, [testProj.id, statusTodo.id]);
    const mixedIds = allMixedTodoTasks.map(t => t.id);

    const mixedRes = await client.query(`
      SELECT public.reorder_kanban_tasks(
        '${customTask.id}',
        '${statusTodo.id}',
        $1::uuid[],
        $1::uuid[]
      );
    `, [mixedIds]);
    assert(mixedRes.rows.length === 1, 'Test 63: Mixed Custom + Defined complete-column ordering PASS');

    // 29-30. Custom Task INSERT/DELETE still works
    await client.query(`DELETE FROM public.tasks WHERE id = '${customTask.id}';`);
    assert(true, 'Test 29-30: Custom Task INSERT and DELETE still works cleanly');

  } finally {
    // ALWAYS rollback sandbox transaction
    await client.query('ROLLBACK');
  }

  console.log('\n--- Production Invariants & Baseline Verification ---');

  // 71-80. Baseline data counts
  const { rows: [{ count: pCount }] } = await client.query(`SELECT count(*)::int as count FROM public.projects;`);
  const { rows: [{ count: mCount }] } = await client.query(`SELECT count(*)::int as count FROM public.milestones;`);
  const { rows: [{ count: tlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists;`);
  const { rows: [{ count: tCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks;`);
  const { rows: [{ count: subCount }] } = await client.query(`SELECT count(*)::int as count FROM public.subtasks;`);
  const { rows: [{ count: raciLiveCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_raci_assignments;`);
  const { rows: [{ count: defTlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists WHERE task_list_type = 'defined';`);
  const { rows: [{ count: defTCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks WHERE process_step_id IS NOT NULL;`);
  const { rows: dupRows } = await client.query(`
    SELECT project_id, status_id, position, count(*) FROM public.tasks GROUP BY project_id, status_id, position HAVING count(*) > 1;
  `);

  assert(pCount === 3, `Test 71: Projects remains 3 (got ${pCount})`);
  assert(mCount === 6, `Test 72: Milestones remains 6 (got ${mCount})`);
  assert(tlCount === 12, `Test 73: Task Lists remains 12 (got ${tlCount})`);
  assert(tCount === 24, `Test 74: Tasks remains 24 (got ${tCount})`);
  assert(subCount === 48, `Test 75: Subtasks remains 48 (got ${subCount})`);
  assert(raciLiveCount === 72, `Test 76: Task RACI remains 72 (got ${raciLiveCount})`);
  assert(defTlCount === 0, `Test 77 & 78: production Defined Task Lists count = 0 (got ${defTlCount})`);
  assert(defTCount === 0, `Test 78: production Defined Tasks count = 0 (got ${defTCount})`);
  assert(dupRows.length === 0, `Test 79: duplicate Kanban positions remains 0 (got ${dupRows.length})`);

  console.log('\n===============================================================');
  console.log(`DP-1-D Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  await client.end();

  if (failed > 0) process.exit(1);
}

runDP1DTests().catch(err => {
  console.error(err);
  process.exit(1);
});
