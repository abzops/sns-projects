import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

const keys = [
  'workspace', 'projectOwner', 'unrelatedOwner', 'workspaceAdmin',
  'workspaceOwner', 'member', 'viewer', 'projectAdmin', 'ownedProject',
  'ownedPhase', 'ownedList', 'ownedTask', 'ownedChildTask', 'ownedSubtask',
  'ownedProcess', 'unrelatedProject', 'unrelatedPhase', 'unrelatedList',
  'memberTask', 'unrelatedSibling',
];
const ids = Object.fromEntries(keys.map((key) => [key, randomUUID()]));

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
  } finally {
    await client.query('RESET ROLE');
  }
  return result;
}

async function visibleIds(client, userId, table) {
  const { rows } = await asUser(client, userId, `SELECT id FROM public.${table} ORDER BY id`);
  return new Set(rows.map(({ id }) => id));
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
      ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;
    `);
    await client.query('SET LOCAL session_replication_role = replica');

    const people = [
      ids.projectOwner, ids.unrelatedOwner, ids.workspaceAdmin,
      ids.workspaceOwner, ids.member, ids.viewer, ids.projectAdmin,
    ];
    for (const [index, userId] of people.entries()) {
      await client.query(
        'INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)',
        [userId, `OV1-A Ownership User ${index + 1}`],
      );
    }
    await client.query(
      'INSERT INTO public.workspaces (id, name, created_by) VALUES ($1, $2, $3)',
      [ids.workspace, 'OV1-A Ownership Workspace', ids.workspaceOwner],
    );
    const roles = new Map([
      [ids.workspaceAdmin, 'admin'],
      [ids.workspaceOwner, 'owner'],
      [ids.viewer, 'viewer'],
    ]);
    for (const userId of people) {
      await client.query(
        `INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')`,
        [ids.workspace, userId, roles.get(userId) || 'member'],
      );
    }
    await client.query(
      `INSERT INTO public.user_system_roles (workspace_id, user_id, role, created_by)
       VALUES ($1, $2, 'project_admin', $3)`,
      [ids.workspace, ids.projectAdmin, ids.workspaceOwner],
    );

    await client.query(
      `INSERT INTO public.projects (id, workspace_id, name, owner_id)
       VALUES ($1, $2, 'Unrelated Project', $3)`,
      [ids.unrelatedProject, ids.workspace, ids.unrelatedOwner],
    );
    await client.query(
      `INSERT INTO public.phases (id, project_id, name)
       VALUES ($1, $2, 'Unrelated Phase')`,
      [ids.unrelatedPhase, ids.unrelatedProject],
    );
    await client.query(
      `INSERT INTO public.task_lists (id, project_id, phase_id, name)
       VALUES ($1, $2, $3, 'Unrelated List')`,
      [ids.unrelatedList, ids.unrelatedProject, ids.unrelatedPhase],
    );
    for (const [taskId, title] of [
      [ids.memberTask, 'Member Involvement Task'],
      [ids.unrelatedSibling, 'Unrelated Sibling Task'],
    ]) {
      await client.query(
        `INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title)
         VALUES ($1, $2, $3, $4, $5)`,
        [taskId, ids.unrelatedProject, ids.unrelatedPhase, ids.unrelatedList, title],
      );
    }
    for (const [userId, role] of [[ids.member, 'R'], [ids.viewer, 'I']]) {
      await client.query(
        `INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
         VALUES ($1, $2, $3)`,
        [ids.memberTask, role, userId],
      );
    }
    await client.query('SET LOCAL session_replication_role = origin');

    const createdProject = await asUser(
      client,
      ids.projectOwner,
      `INSERT INTO public.projects
         (id, workspace_id, name, owner_id, created_by)
       VALUES ($1, $2, 'Owned Empty Project', $3, $3)
       RETURNING id`,
      [ids.ownedProject, ids.workspace, ids.projectOwner],
    );
    assert.equal(createdProject.rows[0].id, ids.ownedProject);
    pass('Project Owner creates an empty Project and reads INSERT ... RETURNING');

    const createdPhase = await asUser(
      client,
      ids.projectOwner,
      `INSERT INTO public.phases (id, project_id, name)
       VALUES ($1, $2, 'Owned Empty Phase') RETURNING id`,
      [ids.ownedPhase, ids.ownedProject],
    );
    assert.equal(createdPhase.rows[0].id, ids.ownedPhase);
    pass('Project Owner creates and reads an empty Phase');

    const createdList = await asUser(
      client,
      ids.projectOwner,
      `INSERT INTO public.task_lists (id, project_id, phase_id, name)
       VALUES ($1, $2, $3, 'Owned Empty Task List') RETURNING id`,
      [ids.ownedList, ids.ownedProject, ids.ownedPhase],
    );
    assert.equal(createdList.rows[0].id, ids.ownedList);
    pass('Project Owner creates and reads an empty Task List');

    const createdTask = await asUser(
      client,
      ids.projectOwner,
      `INSERT INTO public.tasks
         (id, project_id, phase_id, task_list_id, title, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, 'Owned Project Task', $5, $6)
       RETURNING id`,
      [
        ids.ownedTask, ids.ownedProject, ids.ownedPhase, ids.ownedList,
        ids.unrelatedOwner, ids.projectOwner,
      ],
    );
    assert.equal(createdTask.rows[0].id, ids.ownedTask);
    pass('Project Owner creates and reads a Task assigned to another user');

    const createdSubtask = await asUser(
      client,
      ids.projectOwner,
      `INSERT INTO public.subtasks (id, task_id, title, assignee_id, created_by)
       VALUES ($1, $2, 'Owned Project Subtask', $3, $4) RETURNING id`,
      [ids.ownedSubtask, ids.ownedTask, ids.unrelatedOwner, ids.projectOwner],
    );
    assert.equal(createdSubtask.rows[0].id, ids.ownedSubtask);
    pass('Project Owner creates and reads a Subtask assigned to another user');

    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      `INSERT INTO public.tasks
         (id, project_id, phase_id, task_list_id, title, assignee_id, parent_task_id)
       VALUES ($1, $2, $3, $4, 'Owned Child Task', $5, $6)`,
      [
        ids.ownedChildTask, ids.ownedProject, ids.ownedPhase, ids.ownedList,
        ids.unrelatedOwner, ids.ownedTask,
      ],
    );
    await client.query(
      `INSERT INTO public.process_instances
         (id, workspace_id, defined_process_id, defined_process_version_id,
          instance_name, started_by, owner_id, placement_type, project_id)
       VALUES ($1, $2, $3, $4, 'Owned Project Process', $5, $5, 'project', $6)`,
      [
        ids.ownedProcess, ids.workspace, randomUUID(), randomUUID(),
        ids.unrelatedOwner, ids.ownedProject,
      ],
    );
    await client.query('SET LOCAL session_replication_role = origin');

    hasExactly(
      await visibleIds(client, ids.projectOwner, 'projects'),
      new Set([ids.ownedProject]),
      'Project Owner sees the owned Project but not an unrelated Project',
    );
    hasExactly(
      await visibleIds(client, ids.projectOwner, 'phases'),
      new Set([ids.ownedPhase]),
      'Project Owner sees all Phases in the owned Project',
    );
    hasExactly(
      await visibleIds(client, ids.projectOwner, 'task_lists'),
      new Set([ids.ownedList]),
      'Project Owner sees all Task Lists in the owned Project',
    );
    hasExactly(
      await visibleIds(client, ids.projectOwner, 'tasks'),
      new Set([ids.ownedTask, ids.ownedChildTask]),
      'Project Owner sees Tasks and Child Tasks in the owned Project',
    );
    hasExactly(
      await visibleIds(client, ids.projectOwner, 'subtasks'),
      new Set([ids.ownedSubtask]),
      'Project Owner sees Subtasks in the owned Project',
    );
    hasExactly(
      await visibleIds(client, ids.projectOwner, 'process_instances'),
      new Set([ids.ownedProcess]),
      'Project Owner sees attached/runtime Processes in the owned Project',
    );

    for (const [userId, label] of [
      [ids.workspaceAdmin, 'Workspace Admin without System Role'],
      [ids.workspaceOwner, 'Workspace Owner without System Role'],
    ]) {
      hasExactly(
        await visibleIds(client, userId, 'projects'),
        new Set(),
        `${label} still sees no unrelated Projects`,
      );
    }

    hasExactly(
      await visibleIds(client, ids.member, 'projects'),
      new Set([ids.unrelatedProject]),
      'Member involvement-only visibility still exposes the required Project ancestor',
    );
    hasExactly(
      await visibleIds(client, ids.member, 'tasks'),
      new Set([ids.memberTask]),
      'Member involvement-only visibility still hides sibling Tasks',
    );

    hasExactly(
      await visibleIds(client, ids.viewer, 'tasks'),
      new Set([ids.memberTask]),
      'Viewer retains scoped SELECT visibility',
    );
    const viewerUpdate = await asUser(
      client,
      ids.viewer,
      'UPDATE public.tasks SET title = title WHERE id = $1 RETURNING id',
      [ids.memberTask],
    );
    assert.equal(viewerUpdate.rowCount, 0);
    pass('Viewer remains read-only');

    hasExactly(
      await visibleIds(client, ids.projectAdmin, 'projects'),
      new Set([ids.ownedProject, ids.unrelatedProject]),
      'System Role broad visibility remains unchanged',
    );

    await client.query(
      'UPDATE public.projects SET owner_id = $1 WHERE id = $2',
      [ids.unrelatedOwner, ids.ownedProject],
    );
    hasExactly(
      await visibleIds(client, ids.projectOwner, 'projects'),
      new Set(),
      'Removing final Project ownership removes ownership-based visibility',
    );

    const { rows: helpers } = await client.query(`
      SELECT p.proname, p.prosecdef, p.proconfig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname IN (
          'has_owned_project_visibility',
          'has_owned_project_visibility_for_task',
          'has_owned_project_visibility_for_process_instance'
        )
    `);
    assert.equal(helpers.length, 3);
    for (const helper of helpers) {
      assert.equal(helper.prosecdef, true);
      assert.deepEqual(helper.proconfig, ['search_path=""']);
      assert.equal(helper.anon_execute, false);
      assert.equal(helper.authenticated_execute, true);
    }
    pass('Ownership helpers are auth-bound, private-schema, and hardened');

    console.log(`\nOV1-A ownership/bootstrap suite: ${passed} assertions passed.`);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
