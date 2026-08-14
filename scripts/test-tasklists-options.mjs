import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

const repoRoot = process.cwd();
const envAppPath = path.join(repoRoot, '.env');
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
  const envApp = parseEnv(await readFile(envAppPath, 'utf8'));
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));

  // Get user password or use admin client to test PostgREST query
  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const asrsProjId = 'f60d8120-09f8-469c-9278-4b591dfe75a8';

  const supabase = createClient(envApp.VITE_SUPABASE_URL, envApp.VITE_SUPABASE_ANON_KEY);

  // Authenticate
  // Let's test with anon key on PostgREST
  console.log('Testing Option A: with explicit FK');
  const { data: dataA, error: errA } = await supabase
    .from('task_lists')
    .select(`
      *,
      milestones:milestones!task_lists_milestone_id_fkey (
        id,
        name,
        project_id
      )
    `)
    .eq('project_id', asrsProjId);

  console.log('Option A error:', errA);
  console.log('Option A data count:', dataA?.length);

  console.log('\nTesting Option B: select(*)');
  const { data: dataB, error: errB } = await supabase
    .from('task_lists')
    .select('*')
    .eq('project_id', asrsProjId);

  console.log('Option B error:', errB);
  console.log('Option B data count:', dataB?.length);

  await pgClient.end();
}

main().catch(console.error);
