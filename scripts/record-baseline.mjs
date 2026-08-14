import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;

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
  const env = parseEnv(await readFile('.env.admin', 'utf8'));
  const client = new Client({
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(env.SUPABASE_DB_PORT || '5432'),
    database: env.SUPABASE_DB_NAME || 'postgres',
    user: env.SUPABASE_DB_USER || 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const { rows: projRows } = await client.query('SELECT id, name FROM public.projects ORDER BY id');
  const { rows: taskRows } = await client.query('SELECT id, title, project_id FROM public.tasks ORDER BY id');
  const { rows: raciRows } = await client.query('SELECT id, task_id, raci_role FROM public.task_raci_assignments ORDER BY id');

  console.log('=== PRE-MIGRATION BASELINE ===');
  console.log(`Projects: ${projRows.length}`);
  console.log(`Tasks: ${taskRows.length}`);
  console.log(`Task RACI Assignments: ${raciRows.length}`);
  console.log('Project IDs:', projRows.map((p) => ({ id: p.id, name: p.name })));
  console.log('Task IDs count:', taskRows.length);

  await client.end();
}

main().catch(console.error);
