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

  console.log('=== PROJECT LEVEL PROGRESS ===');
  const { rows: projProgress } = await client.query(`
    SELECT
      p.name,
      count(t.id) as total_tasks,
      count(t.id) FILTER (WHERE ts.system_code = 'done') as done_tasks,
      round((count(t.id) FILTER (WHERE ts.system_code = 'done')::numeric / nullif(count(t.id) FILTER (WHERE ts.system_code <> 'cancelled'), 0)) * 100) as progress_pct
    FROM public.projects p
    LEFT JOIN public.tasks t ON t.project_id = p.id
    LEFT JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = '${wsId}'
    GROUP BY p.name;
  `);
  console.table(projProgress);

  console.log('\n=== MILESTONE LEVEL PROGRESS ===');
  const { rows: msProgress } = await client.query(`
    SELECT
      p.name as project,
      m.name as milestone,
      count(t.id) as total_tasks,
      count(t.id) FILTER (WHERE ts.system_code = 'done') as done_tasks,
      round((count(t.id) FILTER (WHERE ts.system_code = 'done')::numeric / nullif(count(t.id) FILTER (WHERE ts.system_code <> 'cancelled'), 0)) * 100) as progress_pct
    FROM public.milestones m
    JOIN public.projects p ON p.id = m.project_id
    LEFT JOIN public.tasks t ON t.milestone_id = m.id
    LEFT JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = '${wsId}'
    GROUP BY p.name, m.name, m.position
    ORDER BY p.name, m.position;
  `);
  console.table(msProgress);

  console.log('\n=== TASK LIST LEVEL PROGRESS ===');
  const { rows: tlProgress } = await client.query(`
    SELECT
      p.name as project,
      m.name as milestone,
      tl.name as task_list,
      count(t.id) as total_tasks,
      count(t.id) FILTER (WHERE ts.system_code = 'done') as done_tasks,
      round((count(t.id) FILTER (WHERE ts.system_code = 'done')::numeric / nullif(count(t.id) FILTER (WHERE ts.system_code <> 'cancelled'), 0)) * 100) as progress_pct
    FROM public.task_lists tl
    JOIN public.milestones m ON m.id = tl.milestone_id
    JOIN public.projects p ON p.id = tl.project_id
    LEFT JOIN public.tasks t ON t.task_list_id = tl.id
    LEFT JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = '${wsId}'
    GROUP BY p.name, m.name, tl.name, m.position, tl.position
    ORDER BY p.name, m.position, tl.position;
  `);
  console.table(tlProgress);

  await client.end();
}

main().catch(console.error);
