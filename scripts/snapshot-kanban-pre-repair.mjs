import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

async function runSnapshot() {
  console.log('=== SNS Projects: Pre-Write Snapshot for Kanban Repair ===');
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

  const { rows: tasks } = await client.query(`
    SELECT 
      t.id as task_id,
      t.project_id,
      p.name as project_name,
      t.milestone_id,
      m.name as milestone_name,
      t.task_list_id,
      tl.name as task_list_name,
      t.title,
      t.status_id,
      ts.name as status_name,
      ts.system_code as status_system_code,
      t.priority,
      t.position,
      t.assignee_id,
      t.created_at,
      t.updated_at
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    LEFT JOIN public.milestones m ON m.id = t.milestone_id
    LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
    LEFT JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = $1
    ORDER BY p.name, m.position, tl.position, t.position, t.id;
  `, [wsId]);

  console.log(`Retrieved ${tasks.length} tasks for workspace ${wsId}.`);

  const taskIds = tasks.map(t => t.task_id);

  const { rows: raci } = await client.query(`
    SELECT 
      id, task_id, raci_role, user_id, department_id, created_at
    FROM public.task_raci_assignments
    WHERE task_id = ANY($1::uuid[])
    ORDER BY task_id, raci_role, created_at;
  `, [taskIds]);

  const { rows: subtasks } = await client.query(`
    SELECT 
      id, task_id, title, status, position, assignee_id, created_at, updated_at
    FROM public.subtasks
    WHERE task_id = ANY($1::uuid[])
    ORDER BY task_id, position, id;
  `, [taskIds]);

  const raciByTaskId = {};
  for (const r of raci) {
    if (!raciByTaskId[r.task_id]) raciByTaskId[r.task_id] = [];
    raciByTaskId[r.task_id].push(r);
  }

  const subtasksByTaskId = {};
  for (const s of subtasks) {
    if (!subtasksByTaskId[s.task_id]) subtasksByTaskId[s.task_id] = [];
    subtasksByTaskId[s.task_id].push(s);
  }

  const snapshotData = {
    timestamp: new Date().toISOString(),
    workspace_id: wsId,
    task_count: tasks.length,
    raci_count: raci.length,
    subtask_count: subtasks.length,
    tasks: tasks.map(t => ({
      ...t,
      raci: raciByTaskId[t.task_id] || [],
      subtasks: subtasksByTaskId[t.task_id] || [],
    })),
  };

  const backupDir = path.join(repoRoot, 'data-backups');
  await mkdir(backupDir, { recursive: true });

  const backupFile = path.join(backupDir, 'pre-kanban-repair-snapshot.json');
  await writeFile(backupFile, JSON.stringify(snapshotData, null, 2), 'utf8');

  console.log(`Successfully saved snapshot to ${backupFile}`);
  console.log(`Snapshot Summary: ${tasks.length} tasks, ${raci.length} RACI assignments, ${subtasks.length} subtasks.`);

  await client.end();
}

runSnapshot().catch(err => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
