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

  const { rows } = await pgClient.query(`
    SELECT t.id, t.title, ts.name as status_name, ts.system_code, t.position
    FROM public.tasks t
    JOIN public.task_statuses ts ON ts.id = t.status_id
    JOIN public.projects p ON p.id = t.project_id
    WHERE p.name ILIKE '%Warehouse%'
    ORDER BY ts.position, t.position;
  `);

  console.log('Warehouse Tasks in Live DB:');
  console.table(rows);

  const statusCount = {};
  rows.forEach(r => {
    statusCount[r.system_code] = (statusCount[r.system_code] || 0) + 1;
  });
  console.log('Status counts:', statusCount);

  await pgClient.end();
}

main().catch(console.error);
