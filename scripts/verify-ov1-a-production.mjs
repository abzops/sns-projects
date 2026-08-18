import assert from 'node:assert/strict';
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
await client.query('BEGIN READ ONLY');

try {
  const { rows: [tip] } = await client.query(`
    SELECT version
    FROM supabase_migrations.schema_migrations
    ORDER BY version DESC
    LIMIT 1
  `);
  assert.equal(tip.version, '20260818110545');
  pass('Production migration tip is OV1-A 20260818110545.');

  const targetTables = [
    'projects', 'phases', 'task_lists', 'tasks', 'subtasks',
    'task_raci_assignments', 'task_statuses', 'process_instances',
    'process_audit_events', 'task_approval_cycles',
    'task_consultation_responses', 'task_evidence_submissions',
    'task_responsible_completions',
  ];
  const { rows: rlsRows } = await client.query(`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  `, [targetTables]);
  assert.equal(rlsRows.length, targetTables.length);
  assert.ok(rlsRows.every((row) => row.relrowsecurity));
  pass('RLS remains enabled on every OV1-A operational/runtime table.');

  const expectedPolicies = new Map([
    ['projects_select_member', 'can_view_operational_project'],
    ['phases_select_member', 'can_view_operational_phase'],
    ['task_lists_select_member', 'can_view_operational_task_list'],
    ['tasks_select_member', 'can_view_operational_task'],
    ['subtasks_select_member', 'can_view_operational_subtask'],
    ['task_raci_select_member', 'can_view_operational_task'],
    ['task_statuses_select_member', 'can_view_operational_project'],
    ['process_instances_select_policy', 'can_view_operational_process_instance'],
    ['process_audit_select_member', 'has_global_operational_visibility'],
    ['task_approval_select_member', 'can_view_operational_task'],
    ['task_consult_resp_select_member', 'can_view_operational_task'],
    ['task_evidence_select_member', 'can_view_operational_task'],
    ['task_resp_comp_select_member', 'can_view_operational_task'],
  ]);
  const { rows: policyRows } = await client.query(`
    SELECT policyname, qual
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname = ANY($1::text[])
  `, [[...expectedPolicies.keys()]]);
  assert.equal(policyRows.length, expectedPolicies.size);
  for (const row of policyRows) {
    assert.match(row.qual, new RegExp(expectedPolicies.get(row.policyname)));
  }
  pass('Production SELECT policies point to the scoped OV1-A helpers.');

  const helperNames = [
    'has_global_operational_visibility',
    'can_view_operational_project',
    'can_view_operational_phase',
    'can_view_operational_task_list',
    'can_view_operational_task',
    'can_view_operational_subtask',
    'can_view_operational_process_instance',
  ];
  const { rows: helpers } = await client.query(`
    SELECT p.proname,
           p.prosecdef,
           p.proconfig,
           pg_get_functiondef(p.oid) AS definition,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = ANY($1::text[])
  `, [helperNames]);
  assert.equal(helpers.length, helperNames.length);
  for (const helper of helpers) {
    assert.equal(helper.prosecdef, true);
    assert.ok(helper.proconfig?.includes('search_path=""'));
    assert.match(helper.definition, /auth\.uid\(\)/);
    assert.equal(helper.anon_execute, false);
    assert.equal(helper.authenticated_execute, true);
  }
  pass('Production helpers are auth-bound, hardened, and deny anon execution.');

  const indexNames = [
    'idx_workspace_members_active_user_workspace',
    'idx_projects_workspace_id',
    'idx_tasks_assignee_project',
    'idx_task_raci_user_task',
    'idx_subtasks_assignee_task',
    'idx_department_memberships_active_user_department',
  ];
  const { rows: indexes } = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY($1::text[])
  `, [indexNames]);
  assert.equal(indexes.length, indexNames.length);
  pass('All six authorization predicate indexes exist in production.');

  const { rows: systemActors } = await client.query(`
    SELECT DISTINCT usr.workspace_id, usr.user_id, usr.role
    FROM public.user_system_roles usr
    JOIN public.workspace_members wm
      ON wm.workspace_id = usr.workspace_id
     AND wm.user_id = usr.user_id
     AND wm.status = 'active'
    WHERE usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
  `);
  const systemRolesSeen = new Set();
  for (const actor of systemActors) {
    const { rows: [total] } = await client.query(
      'SELECT count(*)::int AS count FROM public.projects WHERE workspace_id = $1',
      [actor.workspace_id],
    );
    const { rows: [visible] } = await asUser(
      client,
      actor.user_id,
      'SELECT count(*)::int AS count FROM public.projects WHERE workspace_id = $1',
      [actor.workspace_id],
    );
    assert.equal(visible.count, total.count);
    systemRolesSeen.add(actor.role);
  }
  assert.ok(systemActors.length > 0, 'At least one active production System Role is required for verification.');
  pass(`Active System Role actors retain broad visibility (${[...systemRolesSeen].sort().join(', ')} observed).`);

  const { rows: scopedActors } = await client.query(`
    SELECT DISTINCT wm.workspace_id, wm.user_id, wm.role
    FROM public.workspace_members wm
    WHERE wm.status = 'active'
      AND wm.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_system_roles usr
        WHERE usr.workspace_id = wm.workspace_id
          AND usr.user_id = wm.user_id
          AND usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
      )
    ORDER BY wm.role
  `);
  assert.ok(scopedActors.length > 0, 'At least one no-System-Role actor is required.');
  for (const actor of scopedActors) {
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', 'authenticated', true)`,
      [actor.user_id],
    );
    const { rows: expected } = await client.query(
      `SELECT id
       FROM public.projects
       WHERE workspace_id = $1
         AND private.can_view_operational_project(id)
       ORDER BY id`,
      [actor.workspace_id],
    );
    const { rows: visible } = await asUser(
      client,
      actor.user_id,
      'SELECT id FROM public.projects WHERE workspace_id = $1 ORDER BY id',
      [actor.workspace_id],
    );
    assert.deepEqual(visible, expected);
  }
  pass('No-System-Role production actors receive exactly helper-authorized Projects.');

  const deepLinkActor = scopedActors.find(Boolean);
  await client.query(
    `SELECT set_config('request.jwt.claim.sub', $1, true),
            set_config('request.jwt.claim.role', 'authenticated', true)`,
    [deepLinkActor.user_id],
  );
  const { rows: [unrelated] } = await client.query(
    `SELECT id
     FROM public.projects
     WHERE workspace_id = $1
       AND NOT private.can_view_operational_project(id)
     LIMIT 1`,
    [deepLinkActor.workspace_id],
  );
  if (unrelated) {
    const denied = await asUser(
      client,
      deepLinkActor.user_id,
      'SELECT id FROM public.projects WHERE id = $1',
      [unrelated.id],
    );
    assert.equal(denied.rowCount, 0);
    pass('Production deep-link query for an unrelated Project returns zero rows.');
  } else {
    console.log('[SKIP] Selected scoped actor has no unrelated Project fixture for deep-link verification.');
  }
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
