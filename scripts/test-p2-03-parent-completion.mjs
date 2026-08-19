import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
let passed = 0;
let failed = 0;
let savepointCounter = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

const repoRoot = process.cwd();

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
  } catch (e) {}

  const connectionString = process.env.DATABASE_URL || envAdmin.SUPABASE_DB_URL;
  if (connectionString) {
    const hostname = new URL(connectionString).hostname;
    const isLocal = hostname === '127.0.0.1' || hostname === 'localhost';
    return {
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    };
  }

  return {
    host: process.env.PGHOST || envAdmin.SUPABASE_DB_HOST || '127.0.0.1',
    port: Number(process.env.PGPORT || envAdmin.SUPABASE_DB_PORT || '54322'),
    database: process.env.PGDATABASE || envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: process.env.PGUSER || envAdmin.SUPABASE_DB_USER || 'postgres',
    password: process.env.PGPASSWORD || envAdmin.SUPABASE_DB_PASSWORD || 'postgres',
    ssl: false,
  };
}

async function expectError(client, sql, params = []) {
  const savepoint = `p203_expected_${++savepointCounter}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return null;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return error;
  }
}

async function run() {
  console.log('======================================================================');
  console.log('SNS Projects — Package 2 / P2-03: Parent Completion Runtime Suite');
  console.log('======================================================================\n');

  const config = await getConnectionConfig();
  const client = new Client(config);
  await client.connect();
  try {
    await client.query('BEGIN');

    const p501bMigration = await readFile(path.join(repoRoot, 'supabase/migrations/20260819154319_p5_01b_operational_scope_authorization_closure.sql'), 'utf8');
    await client.query(p501bMigration);

    const userId = (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const suffix = Date.now();
    await client.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [userId, `p203_${suffix}@example.com`]);
    await client.query('INSERT INTO public.profiles (id, full_name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name', [userId, 'P2-03 Runtime Owner']);

    const { rows: [workspace] } = await client.query(
      'INSERT INTO public.workspaces (name, created_by) VALUES ($1, $2) RETURNING *',
      ['P2-03 Workspace', userId],
    );
    await client.query(
      "INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')",
      [workspace.id, userId],
    );

    const { rows: [project] } = await client.query(
      'INSERT INTO public.projects (workspace_id, name, owner_id, created_by) VALUES ($1, $2, $3, $3) RETURNING *',
      [workspace.id, 'P2-03 Project', userId],
    );
    const { rows: [todo] } = await client.query(
      "INSERT INTO public.task_statuses (project_id, name, color, system_code, position) VALUES ($1, 'To Do', '#999999', 'todo', 1000) RETURNING *",
      [project.id],
    );
    const { rows: [done] } = await client.query(
      "INSERT INTO public.task_statuses (project_id, name, color, system_code, position) VALUES ($1, 'Done', '#00aa00', 'done', 2000) RETURNING *",
      [project.id],
    );

    const { rows: [department] } = await client.query(
      'INSERT INTO public.departments (workspace_id, code, name, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [workspace.id, `P203-${suffix}`, 'P2-03 Department', userId],
    );
    const { rows: [definedProcess] } = await client.query(
      'INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *',
      [workspace.id, department.id, 'P2-03 Three Step Process', `PROC-P203-${suffix}`, userId],
    );
    const { rows: [version] } = await client.query(
      "INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, published_at, published_by, created_by) VALUES ($1, 1, 'published', now(), $2, $2) RETURNING *",
      [definedProcess.id, userId],
    );
    const steps = [];
    for (let index = 1; index <= 3; index++) {
      const { rows: [step] } = await client.query(
        'INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days) VALUES ($1, $2, $3, $4, 1) RETURNING *',
        [version.id, `S${index}`, `Step ${index}`, index],
      );
      steps.push(step);
      await client.query(
        "INSERT INTO public.defined_process_step_raci (step_id, raci_role, actor_type, user_id, response_required) VALUES ($1, 'R', 'process_starter', NULL, false), ($1, 'A', 'user', $2, false)",
        [step.id, userId],
      );
    }
    await client.query(
      'INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id) VALUES ($1, $2, $3), ($1, $4, $2)',
      [version.id, steps[1].id, steps[0].id, steps[2].id],
    );

    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("SELECT set_config('sns.process_engine_write', 'on', true)");

    async function task(title, statusId = todo.id, parentTaskId = null) {
      const { rows: [row] } = await client.query(
        'INSERT INTO public.tasks (project_id, title, status_id, parent_task_id, position, created_by, owner_id) VALUES ($1, $2, $3, $4, 1000, $5, $5) RETURNING *',
        [project.id, title, statusId, parentTaskId, userId],
      );
      return row;
    }

    let instanceCounter = 0;
    async function processInstance({ placement = 'task', hostId = null, states = ['ready'], name = null } = {}) {
      await client.query("SELECT set_config('sns.process_engine_write', 'on', true)");
      const instanceName = name || `P2-03 Instance ${++instanceCounter}`;
      const { rows: [instance] } = await client.query(
        `INSERT INTO public.process_instances (
          workspace_id, defined_process_id, defined_process_version_id, start_request_id,
          instance_name, started_by, owner_id, placement_type, project_id, parent_task_id, status
        ) VALUES ($1, $2, $3, gen_random_uuid(), $4, $5, $5, $6,
          CASE WHEN $6 = 'standalone' THEN NULL ELSE $7::uuid END,
          CASE WHEN $6 = 'task' THEN $8::uuid ELSE NULL END,
          'running') RETURNING *`,
        [workspace.id, definedProcess.id, version.id, instanceName, userId, placement, project.id, hostId],
      );

      let container = null;
      if (placement === 'standalone') {
        const { rows: [containerRow] } = await client.query(
          `INSERT INTO public.tasks (
            project_id, title, process_instance_id, workflow_state, current_cycle_number,
            ready_at, due_date, position, created_by
          ) VALUES (NULL, $1, $2, 'ready', 1, now(), NULL, 1000, $3) RETURNING *`,
          [`${instanceName} Container`, instance.id, userId],
        );
        container = containerRow;
        await client.query('UPDATE public.process_instances SET parent_task_id = $2 WHERE id = $1', [instance.id, container.id]);
      }

      const stepTasks = [];
      for (let index = 0; index < states.length; index++) {
        const state = states[index];
        const { rows: [stepTask] } = await client.query(
          `INSERT INTO public.tasks (
            project_id, parent_task_id, process_instance_id, defined_process_version_id,
            process_step_id, title, status_id, workflow_state, current_cycle_number,
            ready_at, workflow_completed_at, overdue_cycle_notified, position, created_by
          ) VALUES (
            CASE WHEN $1 = 'standalone' THEN NULL ELSE $2::uuid END,
            CASE WHEN $1 = 'standalone' THEN $3::uuid WHEN $1 = 'task' THEN $4::uuid ELSE NULL END,
            $5, $6, $7, $8,
            CASE WHEN $1 = 'standalone' THEN NULL ELSE $9::uuid END,
            $10, 1,
            CASE WHEN $10 IN ('ready', 'active') THEN now() ELSE NULL END,
            CASE WHEN $10 = 'completed' THEN now() ELSE NULL END,
            false, $11, $12
          ) RETURNING *`,
          [placement, project.id, container?.id ?? null, hostId, instance.id, version.id, steps[index].id,
            `${instanceName} / Step ${index + 1}`, todo.id, state, 2000 + index * 1000, userId],
        );
        stepTasks.push(stepTask);
      }

      return { instance, container, stepTasks };
    }

    async function status(taskId) {
      return (await client.query('SELECT status_id FROM public.tasks WHERE id = $1', [taskId])).rows[0].status_id;
    }

    console.log('--- Parent Task closure invariants ---');

    const leaf = await task('1. Leaf');
    const leafAuto = await client.query('SELECT private.try_auto_complete_parent_task($1, $2) AS completed', [leaf.id, userId]);
    assert(leafAuto.rows[0].completed === false && await status(leaf.id) === todo.id,
      '1. Leaf with no dependencies does not auto-complete');

    const blockedParent = await task('2. Blocked parent');
    await task('2. Open child', todo.id, blockedParent.id);
    const manualDoneError = await expectError(client, 'UPDATE public.tasks SET status_id = $2 WHERE id = $1', [blockedParent.id, done.id]);
    assert(manualDoneError?.message.includes('remain open'), '2. Open child blocks manual parent Done');

    const childParent = await task('3. Child parent');
    const finalChild = await task('3. Final child', todo.id, childParent.id);
    await client.query('UPDATE public.tasks SET status_id = $2 WHERE id = $1', [finalChild.id, done.id]);
    assert(await status(childParent.id) === done.id, '3. Final ordinary child completion auto-completes parent');

    const grandparent = await task('4. Grandparent');
    const nestedParent = await task('4. Nested parent', todo.id, grandparent.id);
    const nestedLeaf = await task('4. Nested leaf', todo.id, nestedParent.id);
    await client.query('UPDATE public.tasks SET status_id = $2 WHERE id = $1', [nestedLeaf.id, done.id]);
    assert(await status(nestedParent.id) === done.id && await status(grandparent.id) === done.id,
      '4. Nested ordinary Task completion propagates safely upward');

    const runningHost = await task('5. Running process host');
    await processInstance({ hostId: runningHost.id });
    const runningManualError = await expectError(client, 'UPDATE public.tasks SET status_id = $2 WHERE id = $1', [runningHost.id, done.id]);
    assert(runningManualError?.message.includes('remain open'), '5. Running attached Process Instance blocks host completion');

    const completedHost = await task('6. Completed process host');
    const completedPi = await processInstance({ hostId: completedHost.id, states: ['completed'] });
    await client.query("UPDATE public.process_instances SET status = 'completed', completed_at = now() WHERE id = $1", [completedPi.instance.id]);
    assert(await status(completedHost.id) === done.id, '6. Completed attached Process Instance permits host completion');

    const cancelledHost = await task('7. Cancelled process host');
    const cancelledPi = await processInstance({ hostId: cancelledHost.id });
    await client.query(
      "UPDATE public.process_instances SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'P2-03 test' WHERE id = $1",
      [cancelledPi.instance.id, userId],
    );
    assert(await status(cancelledHost.id) === done.id, '7. Cancelled attached Process Instance counts as closed');

    const multiHost = await task('8. Multi-process host');
    const multiA = await processInstance({ hostId: multiHost.id, states: ['completed'] });
    const multiB = await processInstance({ hostId: multiHost.id });
    await client.query("UPDATE public.process_instances SET status = 'completed', completed_at = now() WHERE id = $1", [multiA.instance.id]);
    const stillOpenAfterOne = await status(multiHost.id);
    await client.query(
      "UPDATE public.process_instances SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'P2-03 test' WHERE id = $1",
      [multiB.instance.id, userId],
    );
    assert(stillOpenAfterOne === todo.id && await status(multiHost.id) === done.id,
      '8. Multiple attached processes require every instance to be closed');

    const comboHost = await task('9. Child and process host');
    const comboChild = await task('9. Ordinary child', todo.id, comboHost.id);
    const comboPi = await processInstance({ hostId: comboHost.id, states: ['completed'] });
    await client.query('UPDATE public.tasks SET status_id = $2 WHERE id = $1', [comboChild.id, done.id]);
    const comboAfterChild = await status(comboHost.id);
    await client.query("UPDATE public.process_instances SET status = 'completed', completed_at = now() WHERE id = $1", [comboPi.instance.id]);
    assert(comboAfterChild === todo.id && await status(comboHost.id) === done.id,
      '9. Child plus Process Instance combination closes only after both close');

    console.log('\n--- Process Instance closure and progress invariants ---');

    const standalone = await processInstance({ placement: 'standalone', states: ['ready'], name: '10. Standalone finalizer' });
    await client.query('SELECT private.complete_task_and_advance($1, $2)', [standalone.stepTasks[0].id, userId]);
    const standaloneState = await client.query(
      'SELECT pi.status, t.workflow_state, t.workflow_completed_at FROM public.process_instances pi JOIN public.tasks t ON t.id = pi.parent_task_id WHERE pi.id = $1',
      [standalone.instance.id],
    );
    assert(standaloneState.rows[0].status === 'completed'
      && standaloneState.rows[0].workflow_state === 'completed'
      && standaloneState.rows[0].workflow_completed_at !== null,
    '10. Standalone Process completion closes its authoritative container Task');

    const gated = await processInstance({ placement: 'project', states: ['completed', 'ready'], name: '11. Completion gate' });
    const incompleteError = await expectError(
      client,
      "UPDATE public.process_instances SET status = 'completed', completed_at = now() WHERE id = $1",
      [gated.instance.id],
    );
    await client.query(
      "UPDATE public.tasks SET workflow_state = 'completed', workflow_completed_at = now() WHERE id = $1",
      [gated.stepTasks[1].id],
    );
    await client.query("UPDATE public.process_instances SET status = 'completed', completed_at = now() WHERE id = $1", [gated.instance.id]);
    const gatedStatus = (await client.query('SELECT status FROM public.process_instances WHERE id = $1', [gated.instance.id])).rows[0].status;
    assert(incompleteError?.message.includes('every materialized process step') && gatedStatus === 'completed',
      '11. Process Instance completes only when every materialized step is completed');

    const progressPi = await processInstance({ placement: 'project', states: ['completed', 'cancelled', 'cancelled'], name: '12. Partial cancelled progress' });
    await client.query(
      "UPDATE public.process_instances SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'Partial cancellation' WHERE id = $1",
      [progressPi.instance.id, userId],
    );
    const progressValue = (await client.query('SELECT public.get_process_instance_progress($1) AS progress', [progressPi.instance.id])).rows[0].progress;
    assert(Number(progressValue) === 33.33, '12. Equal-weight progress excludes cancelled steps from completed progress', progressValue);

    console.log('\n--- Placement preservation and idempotency invariants ---');

    const oldHost = await task('13. Old movement host');
    const movingPi = await processInstance({ hostId: oldHost.id, states: ['ready'], name: '13. Moving process' });
    await client.query(
      "SELECT public.move_process_instance($1, 'project', NULL, NULL, NULL, 'P2-03 host closure test')",
      [movingPi.instance.id],
    );
    assert(await status(oldHost.id) === done.id, '13. Moving a running process away reevaluates and closes its old host');

    const doneHost = await task('14. Done host');
    await client.query('UPDATE public.tasks SET status_id = $2 WHERE id = $1', [doneHost.id, done.id]);
    const startOnDoneError = await expectError(
      client,
      "SELECT public.start_process_instance($1, '14. Rejected start', gen_random_uuid(), NULL, 'task', NULL, NULL, NULL, $2)",
      [version.id, doneHost.id],
    );
    const movable = await processInstance({ placement: 'project', states: ['ready'], name: '14. Rejected move' });
    const moveOnDoneError = await expectError(
      client,
      "SELECT public.move_process_instance($1, 'task', NULL, NULL, $2, 'P2-03 rejected placement test')",
      [movable.instance.id, doneHost.id],
    );
    assert(startOnDoneError?.message.includes('Done host task') && moveOnDoneError?.message.includes('Done host task'),
      '14. Running Process Instances cannot start or move onto a Done host');

    const childOnDoneError = await expectError(
      client,
      'INSERT INTO public.tasks (project_id, title, status_id, parent_task_id, position, created_by) VALUES ($1, $2, $3, $4, 1000, $5)',
      [project.id, '14. Rejected ordinary child', todo.id, doneHost.id, userId],
    );
    assert(childOnDoneError?.message.includes('Done parent task'),
      '15. Ordinary children cannot be attached beneath a Done parent');

    const auditCountBefore = await client.query(
      "SELECT count(*)::integer AS count FROM public.process_audit_events WHERE task_id = $1 AND event_type = 'PARENT_TASK_AUTO_COMPLETED'",
      [childParent.id],
    );
    await client.query('SELECT private.try_auto_complete_parent_task($1, $2)', [childParent.id, userId]);
    await client.query('SELECT private.try_auto_complete_parent_task($1, $2)', [childParent.id, userId]);
    const auditCountAfter = await client.query(
      "SELECT count(*)::integer AS count FROM public.process_audit_events WHERE task_id = $1 AND event_type = 'PARENT_TASK_AUTO_COMPLETED'",
      [childParent.id],
    );
    assert(auditCountBefore.rows[0].count === 1 && auditCountAfter.rows[0].count === 1,
      '16. Parent auto-completion is idempotent and writes no duplicate audit event');

    const privilegeRows = await client.query(`
      SELECT p.proname,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        p.prosecdef,
        p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname IN (
          'resolve_project_done_status', 'get_task_closure_state', 'try_auto_complete_parent_task',
          'trg_fn_guard_parent_task_closure', 'trg_fn_reevaluate_parent_task_closure',
          'trg_fn_guard_process_instance_closure', 'trg_fn_sync_process_instance_closure'
        )
    `);
    assert(privilegeRows.rows.length === 7
      && privilegeRows.rows.every(row => row.prosecdef === true
        && row.authenticated_execute === false
        && row.anon_execute === false
        && row.proconfig?.includes('search_path=""')),
    '17. All new private helpers use fixed empty search_path and deny browser execution');

    await client.query('ROLLBACK');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    await client.end();
  }

  console.log('\n======================================================================');
  console.log(`P2-03 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('======================================================================');
  if (failed > 0) process.exit(1);
}

run().catch(error => {
  console.error('\nP2-03 suite failed:', error.message);
  process.exit(1);
});
