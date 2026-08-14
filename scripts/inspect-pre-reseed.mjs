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

async function main() {
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

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  console.log('=== WORKSPACE INFO ===');
  const { rows: wsRows } = await client.query(`SELECT * FROM public.workspaces WHERE id = '${wsId}';`);
  console.table(wsRows);

  console.log('\n=== WORKSPACE MEMBERS ===');
  const { rows: wmRows } = await client.query(`SELECT * FROM public.workspace_members WHERE workspace_id = '${wsId}';`);
  console.table(wmRows);

  console.log('\n=== EXISTING DEPARTMENTS ===');
  const { rows: deptRows } = await client.query(`SELECT * FROM public.departments WHERE workspace_id = '${wsId}';`);
  console.table(deptRows);

  console.log('\n=== CURRENT PROJECT COUNTS ===');
  const { rows: counts } = await client.query(`
    SELECT
      (SELECT count(*) FROM public.projects WHERE workspace_id = '${wsId}') as projects,
      (SELECT count(*) FROM public.milestones WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = '${wsId}')) as milestones,
      (SELECT count(*) FROM public.task_lists WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = '${wsId}')) as task_lists,
      (SELECT count(*) FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = '${wsId}')) as tasks,
      (SELECT count(*) FROM public.subtasks WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = '${wsId}'))) as subtasks,
      (SELECT count(*) FROM public.task_raci_assignments WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = '${wsId}'))) as raci,
      (SELECT count(*) FROM public.task_statuses WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = '${wsId}')) as statuses,
      (SELECT count(*) FROM public.notifications WHERE workspace_id = '${wsId}') as notifications;
  `);
  console.table(counts);

  console.log('\n=== PROJECT TRIGGERS ===');
  const { rows: trigRows } = await client.query(`
    SELECT tgname, proname
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE tgrelid = 'public.projects'::regclass;
  `);
  console.table(trigRows);

  console.log('\n=== TASK STATUSES SCHEMA ===');
  const { rows: statusCols } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_statuses';
  `);
  console.table(statusCols);

  await client.end();
}

main().catch(console.error);
