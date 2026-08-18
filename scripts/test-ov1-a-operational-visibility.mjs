import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

const ids = Object.fromEntries([
  'workspace',
  'ceo', 'cto', 'projectAdmin', 'systemAdmin',
  'workspaceAdmin', 'workspaceOwner', 'member', 'viewer',
  'taskOwner', 'assignee', 'consulted', 'informed', 'directAssignee',
  'subtaskAssignee', 'processParticipant', 'processStarter',
  'projectA', 'projectB', 'phaseA', 'phaseB', 'listA', 'listB',
  'statusA', 'statusB', 'taskA', 'taskASibling', 'directTask',
  'taskB', 'taskBSibling', 'subtaskB', 'processInstance', 'processStepTask',
  'department', 'definedProcess', 'definedVersion', 'definedStep',
].map((key) => [key, randomUUID()]));

let passed = 0;

function pass(message) {
  passed += 1;
  console.log(`[PASS] ${message}`);
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
      // Preserve the original database error when the transaction is aborted.
    }
    throw error;
  }
  await client.query('RESET ROLE');
  return result;
}

async function visibleIds(client, userId, table, column = 'id') {
  const { rows } = await asUser(
    client,
    userId,
    `SELECT ${column} AS id FROM public.${table} ORDER BY ${column}`,
  );
  return new Set(rows.map((row) => row.id));
}

function hasExactly(actual, expected, message) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), message);
  pass(message);
}

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  });

  await client.connect();
  await client.query('BEGIN');

  try {
    // The repository replay harness reconstructs schema objects but intentionally
    // omits Supabase platform default table grants. Add them transaction-locally
    // so RLS can be exercised as the real authenticated role.
    await client.query('GRANT USAGE ON SCHEMA public, private TO authenticated');
    await client.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated',
    );
    await client.query(`
      ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.phases ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.task_lists ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.task_raci_assignments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.task_statuses ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.process_audit_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.task_approval_cycles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.task_consultation_responses ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.task_evidence_submissions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.task_responsible_completions ENABLE ROW LEVEL SECURITY;
    `);
    await client.query('SET LOCAL session_replication_role = replica');

    const people = [
      ids.ceo, ids.cto, ids.projectAdmin, ids.systemAdmin,
      ids.workspaceAdmin, ids.workspaceOwner, ids.member, ids.viewer,
      ids.taskOwner, ids.assignee, ids.consulted, ids.informed,
      ids.directAssignee, ids.subtaskAssignee, ids.processParticipant,
      ids.processStarter,
    ];
    for (const [index, userId] of people.entries()) {
      await client.query(
        'INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)',
        [userId, `OV1-A User ${index + 1}`],
      );
    }

    await client.query(
      'INSERT INTO public.workspaces (id, name, created_by) VALUES ($1, $2, $3)',
      [ids.workspace, 'OV1-A Workspace', ids.workspaceOwner],
    );

    const workspaceRoles = new Map([
      [ids.workspaceOwner, 'owner'],
      [ids.workspaceAdmin, 'admin'],
      [ids.viewer, 'viewer'],
    ]);
    for (const userId of people) {
      await client.query(
        `INSERT INTO public.workspace_members
          (workspace_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')`,
        [ids.workspace, userId, workspaceRoles.get(userId) || 'member'],
      );
    }

    for (const [userId, role] of [
      [ids.ceo, 'ceo'],
      [ids.cto, 'cto'],
      [ids.projectAdmin, 'project_admin'],
      [ids.systemAdmin, 'system_admin'],
    ]) {
      await client.query(
        `INSERT INTO public.user_system_roles (workspace_id, user_id, role, created_by)
         VALUES ($1, $2, $3, $4)`,
        [ids.workspace, userId, role, ids.workspaceOwner],
      );
    }

    for (const [projectId, name] of [[ids.projectA, 'Project A'], [ids.projectB, 'Project B']]) {
      await client.query(
        `INSERT INTO public.projects (id, workspace_id, name, created_by)
         VALUES ($1, $2, $3, $4)`,
        [projectId, ids.workspace, name, ids.workspaceOwner],
      );
    }
    for (const [phaseId, projectId, name] of [
      [ids.phaseA, ids.projectA, 'Phase A'],
      [ids.phaseB, ids.projectB, 'Phase B'],
    ]) {
      await client.query(
        'INSERT INTO public.phases (id, project_id, name) VALUES ($1, $2, $3)',
        [phaseId, projectId, name],
      );
    }
    for (const [listId, projectId, phaseId, name] of [
      [ids.listA, ids.projectA, ids.phaseA, 'List A'],
      [ids.listB, ids.projectB, ids.phaseB, 'List B'],
    ]) {
      await client.query(
        `INSERT INTO public.task_lists (id, project_id, phase_id, name)
         VALUES ($1, $2, $3, $4)`,
        [listId, projectId, phaseId, name],
      );
    }
    for (const [statusId, projectId] of [[ids.statusA, ids.projectA], [ids.statusB, ids.projectB]]) {
      await client.query(
        `INSERT INTO public.task_statuses (id, project_id, name, color, position, system_code)
         VALUES ($1, $2, 'To Do', '#888888', 0, 'todo')`,
        [statusId, projectId],
      );
    }

    for (const [taskId, projectId, phaseId, listId, statusId, title, assigneeId, parentTaskId] of [
      [ids.taskA, ids.projectA, ids.phaseA, ids.listA, ids.statusA, 'Involved Task A', null, null],
      [ids.taskASibling, ids.projectA, ids.phaseA, ids.listA, ids.statusA, 'Unrelated Sibling A', null, null],
      [ids.directTask, ids.projectA, ids.phaseA, ids.listA, ids.statusA, 'Legacy Direct Assignment', ids.directAssignee, null],
      [ids.taskB, ids.projectB, ids.phaseB, ids.listB, ids.statusB, 'Process Host B', null, null],
      [ids.taskBSibling, ids.projectB, ids.phaseB, ids.listB, ids.statusB, 'Unrelated Sibling B', null, null],
    ]) {
      await client.query(
        `INSERT INTO public.tasks
          (id, project_id, phase_id, task_list_id, status_id, title, assignee_id, parent_task_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [taskId, projectId, phaseId, listId, statusId, title, assigneeId, parentTaskId],
      );
    }

    for (const [userId, role] of [
      [ids.taskOwner, 'A'],
      [ids.assignee, 'R'],
      [ids.consulted, 'C'],
      [ids.informed, 'I'],
      [ids.workspaceOwner, 'R'],
      [ids.workspaceAdmin, 'C'],
      [ids.member, 'I'],
      [ids.viewer, 'R'],
      [ids.projectAdmin, 'R'],
    ]) {
      await client.query(
        `INSERT INTO public.task_raci_assignments
          (task_id, raci_role, user_id, created_by)
         VALUES ($1, $2, $3, $4)`,
        [ids.taskA, role, userId, ids.workspaceOwner],
      );
    }

    await client.query(
      `INSERT INTO public.subtasks (id, task_id, title, assignee_id)
       VALUES ($1, $2, 'Assigned Subtask', $3)`,
      [ids.subtaskB, ids.taskB, ids.subtaskAssignee],
    );

    await client.query(
      `INSERT INTO public.departments (id, workspace_id, code, name, created_by)
       VALUES ($1, $2, 'OV1A', 'OV1-A Department', $3)`,
      [ids.department, ids.workspace, ids.workspaceOwner],
    );
    await client.query(
      `INSERT INTO public.defined_processes
        (id, workspace_id, department_id, name, code, process_owner_id, created_by)
       VALUES ($1, $2, $3, 'OV1-A Process', 'OV1A_PROCESS', $4, $4)`,
      [ids.definedProcess, ids.workspace, ids.department, ids.processStarter],
    );
    await client.query(
      `INSERT INTO public.defined_process_versions
        (id, defined_process_id, version_number, status, published_by, published_at, created_by)
       VALUES ($1, $2, 1, 'published', $3, now(), $3)`,
      [ids.definedVersion, ids.definedProcess, ids.processStarter],
    );
    await client.query(
      `INSERT INTO public.defined_process_steps
        (id, version_id, step_code, title, sequence_order, expected_duration_days)
       VALUES ($1, $2, 'STEP_1', 'Runtime Step', 1, 1)`,
      [ids.definedStep, ids.definedVersion],
    );
    await client.query(
      `INSERT INTO public.process_instances
        (id, workspace_id, defined_process_id, defined_process_version_id,
         instance_name, started_by, owner_id, placement_type, project_id,
         phase_id, task_list_id, parent_task_id)
       VALUES ($1, $2, $3, $4, 'OV1-A Instance', $5, $5, 'task', $6, $7, $8, $9)`,
      [
        ids.processInstance, ids.workspace, ids.definedProcess, ids.definedVersion,
        ids.processStarter, ids.projectB, ids.phaseB, ids.listB, ids.taskB,
      ],
    );
    await client.query(
      `INSERT INTO public.tasks
        (id, project_id, phase_id, task_list_id, status_id, title, parent_task_id,
         process_instance_id, process_step_id, defined_process_version_id,
         workflow_state, current_cycle_number, overdue_cycle_notified)
       VALUES ($1, $2, $3, $4, $5, 'Runtime Process Step', $6, $7, $8, $9, 'active', 1, false)`,
      [
        ids.processStepTask, ids.projectB, ids.phaseB, ids.listB, ids.statusB,
        ids.taskB, ids.processInstance, ids.definedStep, ids.definedVersion,
      ],
    );
    await client.query(
      `INSERT INTO public.task_raci_assignments
        (task_id, raci_role, user_id, created_by)
       VALUES ($1, 'R', $2, $3)`,
      [ids.processStepTask, ids.processParticipant, ids.workspaceOwner],
    );

    await client.query('SET LOCAL session_replication_role = origin');

    for (const [userId, label] of [
      [ids.ceo, 'CEO'],
      [ids.cto, 'CTO'],
      [ids.projectAdmin, 'Project Admin'],
      [ids.systemAdmin, 'System Admin'],
    ]) {
      hasExactly(
        await visibleIds(client, userId, 'projects'),
        new Set([ids.projectA, ids.projectB]),
        `${label} sees unrelated Projects A and B`,
      );
    }

    for (const [userId, label] of [
      [ids.workspaceAdmin, 'Workspace Admin without System Role'],
      [ids.workspaceOwner, 'Workspace Owner without System Role'],
      [ids.member, 'Member without System Role'],
      [ids.viewer, 'Viewer'],
    ]) {
      const visibilityProbe = await asUser(
        client,
        userId,
        `SELECT auth.uid() AS actor_id,
                private.has_global_operational_visibility($1) AS broad,
                private.can_view_operational_project($2) AS project_a,
                private.can_view_operational_project($3) AS project_b`,
        [ids.workspace, ids.projectA, ids.projectB],
      );
      assert.equal(visibilityProbe.rows[0].actor_id, userId, `${label} auth.uid is isolated`);
      assert.equal(visibilityProbe.rows[0].broad, false, `${label} has no global operational visibility`);
      assert.equal(visibilityProbe.rows[0].project_a, true, `${label} sees involved Project A`);
      assert.equal(visibilityProbe.rows[0].project_b, false, `${label} cannot see unrelated Project B`);
      hasExactly(
        await visibleIds(client, userId, 'projects'),
        new Set([ids.projectA]),
        `${label} sees only involved hierarchy`,
      );
    }

    const viewerUpdate = await asUser(
      client,
      ids.viewer,
      'UPDATE public.tasks SET title = title || $1 WHERE id = $2 RETURNING id',
      [' blocked', ids.taskA],
    );
    assert.equal(viewerUpdate.rowCount, 0);
    pass('Viewer has scoped SELECT visibility and no mutation authority');

    for (const [userId, label] of [
      [ids.taskOwner, 'Task Owner (A)'],
      [ids.assignee, 'Task Assignee (R)'],
      [ids.consulted, 'Consulted participant (C)'],
      [ids.informed, 'Informed participant (I)'],
    ]) {
      hasExactly(
        await visibleIds(client, userId, 'tasks'),
        new Set([ids.taskA]),
        `${label} sees the Task but not sibling Tasks`,
      );
      hasExactly(
        await visibleIds(client, userId, 'projects'),
        new Set([ids.projectA]),
        `${label} receives the required Project ancestor`,
      );
    }

    hasExactly(
      await visibleIds(client, ids.directAssignee, 'tasks'),
      new Set([ids.directTask]),
      'Legacy direct Task assignee receives scoped visibility',
    );

    hasExactly(
      await visibleIds(client, ids.subtaskAssignee, 'subtasks'),
      new Set([ids.subtaskB]),
      'Subtask Assignee sees the assigned Subtask',
    );
    hasExactly(
      await visibleIds(client, ids.subtaskAssignee, 'tasks'),
      new Set([ids.taskB]),
      'Subtask Assignee sees the parent Task but not siblings',
    );
    hasExactly(
      await visibleIds(client, ids.subtaskAssignee, 'task_lists'),
      new Set([ids.listB]),
      'Subtask Assignee receives Task List ancestor context',
    );
    hasExactly(
      await visibleIds(client, ids.subtaskAssignee, 'phases'),
      new Set([ids.phaseB]),
      'Subtask Assignee receives Phase ancestor context',
    );

    hasExactly(
      await visibleIds(client, ids.processParticipant, 'process_instances'),
      new Set([ids.processInstance]),
      'Process participant sees the relevant Process Instance',
    );
    hasExactly(
      await visibleIds(client, ids.processParticipant, 'tasks'),
      new Set([ids.taskB, ids.processStepTask]),
      'Process participant sees the runtime Step and host Task hierarchy only',
    );

    const unrelatedProject = await asUser(
      client,
      ids.member,
      'SELECT id FROM public.projects WHERE id = $1',
      [ids.projectB],
    );
    const unrelatedTask = await asUser(
      client,
      ids.member,
      'SELECT id FROM public.tasks WHERE id = $1',
      [ids.taskBSibling],
    );
    assert.equal(unrelatedProject.rowCount, 0);
    assert.equal(unrelatedTask.rowCount, 0);
    pass('Direct query/deep-link for unrelated Project and Task returns no data');

    await client.query('UPDATE public.tasks SET assignee_id = NULL WHERE id = $1', [ids.directTask]);
    hasExactly(
      await visibleIds(client, ids.directAssignee, 'tasks'),
      new Set(),
      'Removing the final involvement immediately removes Task visibility',
    );

    await client.query(
      `UPDATE public.subtasks SET assignee_id = $1 WHERE id = $2`,
      [ids.member, ids.subtaskB],
    );
    hasExactly(
      await visibleIds(client, ids.member, 'projects'),
      new Set([ids.projectA, ids.projectB]),
      'Multiple involvement paths union visibility across Projects',
    );

    await client.query(
      `DELETE FROM public.user_system_roles
       WHERE workspace_id = $1 AND user_id = $2 AND role = 'project_admin'`,
      [ids.workspace, ids.projectAdmin],
    );
    hasExactly(
      await visibleIds(client, ids.projectAdmin, 'projects'),
      new Set([ids.projectA]),
      'System Role removal immediately falls back to scoped visibility',
    );

    const { rows: helperRows } = await client.query(`
      SELECT p.proname,
             p.prosecdef,
             p.proconfig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname IN (
          'has_global_operational_visibility',
          'can_view_operational_project',
          'can_view_operational_phase',
          'can_view_operational_task_list',
          'can_view_operational_task',
          'can_view_operational_subtask',
          'can_view_operational_process_instance'
        )
    `);
    assert.equal(helperRows.length, 7);
    for (const row of helperRows) {
      assert.equal(row.prosecdef, true);
      assert.deepEqual(row.proconfig, ['search_path=""']);
      assert.equal(row.anon_execute, false);
      assert.equal(row.authenticated_execute, true);
    }
    pass('Private helpers use SECURITY DEFINER, empty search_path, and explicit safe ACLs');

    const { rows: indexRows } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_workspace_members_active_user_workspace',
          'idx_projects_workspace_id',
          'idx_tasks_assignee_project',
          'idx_task_raci_user_task',
          'idx_subtasks_assignee_task',
          'idx_department_memberships_active_user_department'
        )
    `);
    assert.equal(indexRows.length, 6);
    pass('Authorization predicate indexes are present');

    console.log(`\nOV1-A authorization matrix: ${passed} assertions passed.`);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
