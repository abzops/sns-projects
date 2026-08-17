import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const envAdminPath = path.join(process.cwd(), '.env.admin');
const content = await readFile(envAdminPath, 'utf8');

const envAdmin = content
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

const client = new Client({
  host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: String(envAdmin.SUPABASE_DB_PASSWORD || ''),
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('======================================================================');
  console.log('SNS Projects — Remote Supabase Migration 27 (P2-02) Deployment');
  console.log('Target: gqerfixdmgbqahgslzsq');
  console.log('======================================================================\n');

  await client.connect();
  console.log('Connected to remote PostgreSQL successfully.');

  const migrationFile = path.join(process.cwd(), 'supabase/migrations/20260817123556_p2_02_process_instance_movement_cancellation.sql');
  const sql = await readFile(migrationFile, 'utf8');

  console.log('Applying P2-02 migration in atomic transaction...');
  await client.query('BEGIN;');
  await client.query(sql);

  // Record in supabase_migrations.schema_migrations
  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260817123556', 'p2_02_process_instance_movement_cancellation')
    ON CONFLICT (version) DO NOTHING;
  `);

  await client.query('COMMIT;');
  console.log('P2-02 Migration applied and recorded successfully!\n');

  // Verify tip
  const { rows: tipRows } = await client.query(`
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    ORDER BY version DESC
    LIMIT 5;
  `);
  console.log('Latest 5 Applied Migrations:');
  console.table(tipRows);

  // Verify new columns & RPCs
  const { rows: taskCol } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'owner_id';
  `);
  console.log('tasks.owner_id column:', taskCol);

  const { rows: auditCol } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'process_audit_events' AND column_name = 'process_instance_id';
  `);
  console.log('process_audit_events.process_instance_id column:', auditCol);

  const { rows: rpcRows } = await client.query(`
    SELECT proname, prosecdef, provolatile
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND proname IN ('move_process_instance', 'cancel_process_instance', 'get_process_instance_permissions')
    ORDER BY proname;
  `);
  console.log('Public P2-02 RPCs:');
  console.table(rpcRows);

  // Verify Security Advisor baseline
  const { rows: secAdvisorRows } = await client.query(`
    SELECT p.proname, n.nspname, p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef = true
      AND n.nspname = 'public'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname NOT LIKE 'pg_%'
    ORDER BY p.proname;
  `);
  console.log(`\nPublic SECURITY DEFINER functions executable by authenticated: ${secAdvisorRows.length} (Expected baseline: 5)`);
  console.table(secAdvisorRows);
}

run()
  .catch(async (err) => {
    console.error('Migration failed:', err);
    try { await client.query('ROLLBACK;'); } catch (e) {}
    process.exit(1);
  })
  .finally(async () => {
    await client.end();
  });
