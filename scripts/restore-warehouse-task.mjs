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
  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  // Find To Do status of Warehouse
  const { rows: todoRows } = await pgClient.query(`
    SELECT ts.id FROM public.task_statuses ts
    JOIN public.projects p ON p.id = ts.project_id
    WHERE p.name ILIKE '%Warehouse%' AND ts.system_code = 'todo';
  `);
  const todoStatusId = todoRows[0]?.id;

  // Find In Review status of Warehouse
  const { rows: statusRows } = await pgClient.query(`
    SELECT ts.id FROM public.task_statuses ts
    JOIN public.projects p ON p.id = ts.project_id
    WHERE p.name ILIKE '%Warehouse%' AND ts.system_code = 'in_review';
  `);
  const inReviewStatusId = statusRows[0]?.id;

  // Update Freeze Integrated Deployment Schedule back to in_review
  await pgClient.query(`
    UPDATE public.tasks
    SET status_id = '${inReviewStatusId}', position = 1000
    WHERE title = 'Freeze Integrated Deployment Schedule'
    AND project_id IN (SELECT id FROM public.projects WHERE name ILIKE '%Warehouse%');
  `);

  // Update Commission PLC & HMI back to todo
  await pgClient.query(`
    UPDATE public.tasks
    SET status_id = '${todoStatusId}', position = 2000
    WHERE title = 'Commission PLC & HMI'
    AND project_id IN (SELECT id FROM public.projects WHERE name ILIKE '%Warehouse%');
  `);

  console.log('Restored Warehouse tasks to canonical status distribution');
  await pgClient.end();
}

main().catch(console.error);
