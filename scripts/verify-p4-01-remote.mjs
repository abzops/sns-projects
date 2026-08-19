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

async function verifyRemote() {
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const client = new Client({
    connectionString: envAdmin.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  REMOTE PRODUCTION DATABASE VERIFICATION — POST P4-01 DEPLOYMENT          ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // 1. Migration History Tip
  const { rows: migRows } = await client.query(`
    SELECT version
    FROM supabase_migrations.schema_migrations
    ORDER BY version DESC
    LIMIT 5
  `);
  console.log('=== LATEST APPLIED MIGRATIONS ===');
  console.table(migRows);

  // 2. Finance Tables Created
  const { rows: finTables } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('budgets', 'budget_audit_logs', 'budget_reallocations', 'expense_transactions', 'expense_items', 'expense_audit_logs')
    ORDER BY tablename
  `);
  console.log('\n=== FINANCE TABLES & RLS ===');
  console.table(finTables);

  // 3. Security Advisor: Public Security Definers
  const { rows: pubSecDef } = await client.query(`
    SELECT p.proname, n.nspname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prosecdef = true
    ORDER BY p.proname
  `);
  console.log(`\n=== SECURITY DEFINER FUNCTIONS IN PUBLIC SCHEMA (Count: ${pubSecDef.length}, Expected <= 6) ===`);
  console.table(pubSecDef);

  // 4. Data Row Counts in Operational V1 Tables
  const { rows: opCounts } = await client.query(`
    SELECT
      (SELECT count(*) FROM public.workspaces) as workspaces,
      (SELECT count(*) FROM public.profiles) as profiles,
      (SELECT count(*) FROM public.projects) as projects,
      (SELECT count(*) FROM public.phases) as phases,
      (SELECT count(*) FROM public.task_lists) as task_lists,
      (SELECT count(*) FROM public.tasks) as tasks
  `);
  console.log('\n=== OPERATIONAL V1 DATA INTEGRITY (PRESERVED) ===');
  console.table(opCounts);

  await client.end();
}

verifyRemote().catch((err) => {
  console.error(err);
  process.exit(1);
});