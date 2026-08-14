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

async function verifyEquivalence() {
  console.log('===============================================================');
  console.log('SNS Projects — Production Schema Equivalence Verification Suite');
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
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log('=== 1. TABLES & RLS STATUS (MIGRATIONS 01, 02, 03, 04) ===');
  const expectedTables = [
    'profiles',
    'workspaces',
    'workspace_members',
    'projects',
    'task_statuses',
    'milestones',
    'task_lists',
    'tasks',
    'subtasks',
    'task_raci_assignments',
    'departments',
    'department_memberships',
    'user_system_roles',
    'notifications',
  ];

  const { rows: tables } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public';
  `);
  const tableMap = new Map(tables.map(t => [t.tablename, t.rowsecurity]));

  for (const tbl of expectedTables) {
    const exists = tableMap.has(tbl);
    const rls = tableMap.get(tbl) === true;
    assert(exists && rls, `Table "${tbl}" exists with RLS enabled`);
  }

  console.log('\n=== 2. HIERARCHY COLUMNS & FOREIGN KEYS (MIGRATIONS 01 & 03) ===');
  const { rows: taskCols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks';
  `);
  const colNames = new Set(taskCols.map(c => c.column_name));
  assert(colNames.has('milestone_id'), 'tasks.milestone_id column exists');
  assert(colNames.has('task_list_id'), 'tasks.task_list_id column exists');
  assert(colNames.has('position'), 'tasks.position column exists');

  const { rows: taskListCols } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_lists';
  `);
  const tlColNames = new Set(taskListCols.map(c => c.column_name));
  assert(tlColNames.has('milestone_id'), 'task_lists.milestone_id column exists');
  assert(tlColNames.has('project_id'), 'task_lists.project_id column exists');

  console.log('\n=== 3. SECURITY & PRIVATE SCHEMA FUNCTIONS (MIGRATION 02) ===');
  const { rows: privateFuncs } = await client.query(`
    SELECT proname, prosecdef, pg_get_function_arguments(oid) as args
    FROM pg_proc
    WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'private');
  `);
  const privateFuncNames = new Set(privateFuncs.map(f => f.proname));
  const expectedPrivateFuncs = [
    'get_user_workspace_role',
    'is_workspace_active_member',
    'can_administer_workspace',
    'has_system_role',
    'emit_notification',
    'trg_fn_raci_assigned',
    'trg_fn_subtask_assigned',
    'trg_fn_task_status_changed',
  ];

  for (const fn of expectedPrivateFuncs) {
    assert(privateFuncNames.has(fn), `Private function private.${fn}() exists`);
  }

  console.log('\n=== 4. KANBAN RPC FUNCTION SIGNATURE & CONFIG (MIGRATION 06) ===');
  const { rows: rpcRows } = await client.query(`
    SELECT proname, prosecdef,
           pg_get_function_arguments(oid) as args,
           pg_get_function_result(oid) as result
    FROM pg_proc
    WHERE proname = 'reorder_kanban_tasks'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  `);

  assert(rpcRows.length === 1, 'Exactly one public.reorder_kanban_tasks function exists');
  assert(
    rpcRows[0]?.args === 'p_task_id uuid, p_new_status_id uuid, p_source_task_ids uuid[], p_destination_task_ids uuid[]',
    'reorder_kanban_tasks has exact 4-argument signature (p_task_id, p_new_status_id, p_source_task_ids, p_destination_task_ids)'
  );
  assert(rpcRows[0]?.prosecdef === false, 'reorder_kanban_tasks is configured as SECURITY INVOKER');

  console.log('\n=== 5. RPC EXECUTION GRANTS (SECURITY RESTRICTION) ===');
  const { rows: funcGrants } = await client.query(`
    SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' AND routine_name = 'reorder_kanban_tasks';
  `);
  const grantees = new Set(funcGrants.map(g => g.grantee));
  assert(!grantees.has('PUBLIC') && !grantees.has('anon'), 'reorder_kanban_tasks has EXECUTE REVOKED from PUBLIC and anon');
  assert(grantees.has('authenticated'), 'reorder_kanban_tasks has EXECUTE GRANTED to authenticated');

  console.log('\n=== 6. RACI & HIERARCHY CONSTRAINTS (MIGRATION 03 & 04) ===');
  const { rows: constraints } = await client.query(`
    SELECT conname, contype
    FROM pg_constraint
    WHERE conrelid = 'public.task_raci_assignments'::regclass;
  `);
  const conNames = new Set(constraints.map(c => c.conname));
  assert(conNames.size > 0, 'task_raci_assignments table has integrity constraints');

  console.log('\n=== 7. NOTIFICATION SECURITY & RLS (MIGRATION 04) ===');
  const { rows: notifCols } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications';
  `);
  const notifColNames = new Set(notifCols.map(c => c.column_name));
  assert(notifColNames.has('task_id'), 'notifications.task_id exists');
  assert(notifColNames.has('type'), 'notifications.type exists');
  assert(notifColNames.has('is_read'), 'notifications.is_read exists');

  console.log('\n===============================================================');
  console.log(`Production Schema Equivalence: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  await client.end();

  if (failed > 0) process.exit(1);
}

verifyEquivalence().catch((err) => {
  console.error(err);
  process.exit(1);
});
