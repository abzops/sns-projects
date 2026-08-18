import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

function pass(message) {
  console.log(`[PASS] ${message}`);
}

const env = parseEnv(await readFile('.env.admin', 'utf8'));
assert.ok(env.SUPABASE_DB_URL, 'SUPABASE_DB_URL must exist in ignored .env.admin.');

const client = new Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
await client.query('BEGIN');

try {
  const { rows: [actor] } = await client.query(`
    SELECT wm.workspace_id, wm.user_id
    FROM public.workspace_members wm
    WHERE wm.status = 'active'
      AND wm.role IN ('owner', 'admin', 'member')
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_system_roles usr
        WHERE usr.workspace_id = wm.workspace_id
          AND usr.user_id = wm.user_id
          AND usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
      )
    ORDER BY wm.created_at
    LIMIT 1
  `);
  assert.ok(actor, 'A non-System active production creator is required.');

  const projectId = randomUUID();
  const phaseId = randomUUID();
  const listId = randomUUID();
  const taskId = randomUUID();
  const subtaskId = randomUUID();

  const project = await asUser(
    client,
    actor.user_id,
    `INSERT INTO public.projects
       (id, workspace_id, name, owner_id, created_by)
     VALUES ($1, $2, 'OV1-A rollback-only ownership verification', $3, $3)
     RETURNING id`,
    [projectId, actor.workspace_id, actor.user_id],
  );
  assert.equal(project.rows[0].id, projectId);
  pass('Production Project INSERT ... RETURNING succeeds for its Project Owner.');

  const phase = await asUser(
    client,
    actor.user_id,
    `INSERT INTO public.phases (id, project_id, name)
     VALUES ($1, $2, 'Rollback-only Phase') RETURNING id`,
    [phaseId, projectId],
  );
  assert.equal(phase.rows[0].id, phaseId);
  pass('Production empty Phase INSERT ... RETURNING succeeds for its Project Owner.');

  const taskList = await asUser(
    client,
    actor.user_id,
    `INSERT INTO public.task_lists (id, project_id, phase_id, name)
     VALUES ($1, $2, $3, 'Rollback-only Task List') RETURNING id`,
    [listId, projectId, phaseId],
  );
  assert.equal(taskList.rows[0].id, listId);
  pass('Production empty Task List INSERT ... RETURNING succeeds for its Project Owner.');

  const task = await asUser(
    client,
    actor.user_id,
    `INSERT INTO public.tasks
       (id, project_id, phase_id, task_list_id, title, created_by)
     VALUES ($1, $2, $3, $4, 'Rollback-only Task', $5)
     RETURNING id`,
    [taskId, projectId, phaseId, listId, actor.user_id],
  );
  assert.equal(task.rows[0].id, taskId);
  pass('Production Task INSERT ... RETURNING succeeds through Project ownership.');

  const subtask = await asUser(
    client,
    actor.user_id,
    `INSERT INTO public.subtasks (id, task_id, title, created_by)
     VALUES ($1, $2, 'Rollback-only Subtask', $3) RETURNING id`,
    [subtaskId, taskId, actor.user_id],
  );
  assert.equal(subtask.rows[0].id, subtaskId);
  pass('Production Subtask INSERT ... RETURNING succeeds through Project ownership.');

  const hierarchy = await asUser(
    client,
    actor.user_id,
    `SELECT
       (SELECT count(*)::int FROM public.projects WHERE id = $1) AS projects,
       (SELECT count(*)::int FROM public.phases WHERE id = $2) AS phases,
       (SELECT count(*)::int FROM public.task_lists WHERE id = $3) AS task_lists,
       (SELECT count(*)::int FROM public.tasks WHERE id = $4) AS tasks,
       (SELECT count(*)::int FROM public.subtasks WHERE id = $5) AS subtasks`,
    [projectId, phaseId, listId, taskId, subtaskId],
  );
  assert.deepEqual(hierarchy.rows[0], {
    projects: 1,
    phases: 1,
    task_lists: 1,
    tasks: 1,
    subtasks: 1,
  });
  pass('Production Project Owner reads the complete rollback-only hierarchy.');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
