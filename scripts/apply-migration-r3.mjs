import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260814_04_day0_notifications_go_live.sql');

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
  const env = parseEnv(await readFile(envAdminPath, 'utf8'));
  const sql = await readFile(migrationPath, 'utf8');

  const client = new Client({
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(env.SUPABASE_DB_PORT || '5432'),
    database: env.SUPABASE_DB_NAME || 'postgres',
    user: env.SUPABASE_DB_USER || 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Supabase PostgreSQL database.');

  console.log('Applying 20260814_04_day0_notifications_go_live.sql...');
  await client.query(sql);
  console.log('Release 3 Migration applied successfully!');

  // Verify Realtime publication membership
  const { rows: rtPub } = await client.query(`
    SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
  `);
  console.log('supabase_realtime tables:', rtPub.map(r => r.tablename));

  // Verify triggers
  const { rows: trgs } = await client.query(`
    SELECT trigger_name, event_manipulation, event_object_table
    FROM information_schema.triggers
    WHERE trigger_name IN ('trg_raci_assigned', 'trg_task_status_changed', 'trg_subtask_assigned');
  `);
  console.log('Verified notification triggers:', trgs);

  // Reload PostgREST schema cache
  await client.query(`NOTIFY pgrst, 'reload schema';`);
  console.log('PostgREST schema cache reloaded.');

  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
