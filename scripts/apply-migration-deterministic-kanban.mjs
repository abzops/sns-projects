import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260814173224_enforce_deterministic_kanban_ordering.sql');

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

async function applyMigration() {
  console.log('=== Applying 20260814173224_enforce_deterministic_kanban_ordering.sql ===');
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const sql = await readFile(migrationPath, 'utf8');

  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('BEGIN;');
    await client.query(sql);
    await client.query('COMMIT;');
    console.log('✓ Migration applied successfully to live Supabase database!');

    // Verify function in database
    const { rows: rpcRows } = await client.query(`
      SELECT proname, prosecdef,
             pg_get_function_arguments(oid) as args,
             pg_get_function_result(oid) as result
      FROM pg_proc
      WHERE proname = 'reorder_kanban_tasks'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    `);

    console.log('\nVerified RPC signature in DB:');
    console.log(JSON.stringify(rpcRows, null, 2));

  } catch (err) {
    await client.query('ROLLBACK;');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

applyMigration().catch(() => process.exit(1));
