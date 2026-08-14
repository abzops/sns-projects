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

  console.log('=== TASKS COLUMNS ===');
  const { rows: taskCols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks'
    ORDER BY ordinal_position;
  `);
  console.table(taskCols);

  console.log('\n=== SUBTASKS COLUMNS ===');
  const { rows: subCols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subtasks'
    ORDER BY ordinal_position;
  `);
  console.table(subCols);

  console.log('\n=== RACI COLUMNS ===');
  const { rows: raciCols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_raci_assignments'
    ORDER BY ordinal_position;
  `);
  console.table(raciCols);

  console.log('\n=== MILESTONES COLUMNS ===');
  const { rows: msCols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'milestones'
    ORDER BY ordinal_position;
  `);
  console.table(msCols);

  console.log('\n=== TASK_LISTS COLUMNS ===');
  const { rows: tlCols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_lists'
    ORDER BY ordinal_position;
  `);
  console.table(tlCols);

  console.log('\n=== PROJECTS COLUMNS ===');
  const { rows: pCols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
    ORDER BY ordinal_position;
  `);
  console.table(pCols);

  await client.end();
}

main().catch(console.error);
