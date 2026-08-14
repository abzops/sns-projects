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

  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  console.log('Adding single-column FKs to tasks for PostgREST resource embedding...');
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'tasks_milestone_id_fkey' AND table_name = 'tasks'
      ) THEN
        ALTER TABLE public.tasks
          ADD CONSTRAINT tasks_milestone_id_fkey
          FOREIGN KEY (milestone_id)
          REFERENCES public.milestones(id)
          ON DELETE RESTRICT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'tasks_task_list_id_fkey' AND table_name = 'tasks'
      ) THEN
        ALTER TABLE public.tasks
          ADD CONSTRAINT tasks_task_list_id_fkey
          FOREIGN KEY (task_list_id)
          REFERENCES public.task_lists(id)
          ON DELETE RESTRICT;
      END IF;
    END $$;
  `);

  console.log('Reloading PostgREST schema cache...');
  await client.query(`NOTIFY pgrst, 'reload schema';`);

  await client.end();

  // Test with Supabase JS client
  const supabase = createClient(envApp.VITE_SUPABASE_URL, envApp.VITE_SUPABASE_ANON_KEY);
  
  // Test authenticated query
  const testUser = '00ae89c1-353b-4367-827e-9817343140d1'; // owner

  const { data: joinedData, error: joinErr } = await supabase
    .from('tasks')
    .select(`
      id,
      title,
      task_statuses:status_id (id, name),
      milestones:milestone_id (id, name),
      task_lists:task_list_id (id, name)
    `)
    .limit(5);

  console.log('Joined select tasks result:', { count: joinedData?.length, joinErr });
}

main().catch(console.error);
