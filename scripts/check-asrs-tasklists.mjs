import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const envAppPath = path.join(repoRoot, '.env');

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
  const envApp = parseEnv(await readFile(envAppPath, 'utf8'));

  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  // Find ASRS project ID
  const { rows: pRows } = await pgClient.query("SELECT id, name FROM public.projects WHERE name ILIKE '%ASRS%';");
  const asrsProj = pRows[0];
  console.log('ASRS Project:', asrsProj);

  // Check all task lists in ASRS
  const { rows: tlRows } = await pgClient.query(`
    SELECT tl.id, tl.name, tl.milestone_id, m.name as milestone_name, tl.position
    FROM public.task_lists tl
    LEFT JOIN public.milestones m ON m.id = tl.milestone_id
    WHERE tl.project_id = '${asrsProj.id}'
    ORDER BY m.position, tl.position;
  `);
  console.log('\nTask lists currently in DB for ASRS:');
  console.table(tlRows);

  await pgClient.end();
}

main().catch(console.error);
