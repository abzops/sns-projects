import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

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

async function reconcileHistory() {
  console.log('===============================================================');
  console.log('SNS Projects — Reconcile Remote Migration History via Supabase CLI');
  console.log('===============================================================\n');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const encodedPassword = encodeURIComponent(envAdmin.SUPABASE_DB_PASSWORD);
  const dbUrl = `postgresql://${envAdmin.SUPABASE_DB_USER || 'postgres'}:${encodedPassword}@${envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co'}:${envAdmin.SUPABASE_DB_PORT || '5432'}/${envAdmin.SUPABASE_DB_NAME || 'postgres'}`;

  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
  const canonicalVersions = files.map(f => f.split('_')[0]);

  console.log(`Target Canonical Migration Chain (${canonicalVersions.length} versions):`);
  files.forEach((f, idx) => console.log(`  ${idx + 1}. ${f} -> Version: ${canonicalVersions[idx]}`));

  // Step 1: Revert legacy 20260814 version
  console.log('\n--- Step 1: Reverting legacy version 20260814 from history ---');
  try {
    const outRevert = execSync(`npx supabase migration repair --db-url "${dbUrl}" --status reverted 20260814`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    console.log(outRevert);
  } catch (err) {
    console.error('Revert failed:', err.stdout || err.message);
  }

  // Step 2: Mark each new canonical version as applied in exact order
  console.log('\n--- Step 2: Marking canonical migration versions as applied ---');
  for (let i = 0; i < canonicalVersions.length; i++) {
    const v = canonicalVersions[i];
    const f = files[i];
    console.log(`\nRepairing [${i + 1}/${canonicalVersions.length}]: Version ${v} (${f}) -> APPLIED...`);
    const outApply = execSync(`npx supabase migration repair --db-url "${dbUrl}" --status applied ${v}`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    console.log(outApply);
  }

  // Step 3: Verify with pgClient directly
  console.log('\n--- Step 3: Direct DB verification of supabase_migrations.schema_migrations ---');
  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const { rows: postRows } = await pgClient.query(`
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    ORDER BY version;
  `);

  console.table(postRows);
  await pgClient.end();

  // Step 4: Run CLI migration list
  console.log('\n--- Step 4: CLI migration list output ---');
  const listOut = execSync(`npx supabase migration list --db-url "${dbUrl}"`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  console.log(listOut);

  // Step 5: Run CLI db push --dry-run
  console.log('\n--- Step 5: CLI db push --dry-run output ---');
  const pushDryOut = execSync(`npx supabase db push --dry-run --db-url "${dbUrl}"`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  console.log(pushDryOut);

  console.log('\n===============================================================');
  console.log('MIGRATION HISTORY RECONCILIATION COMPLETE');
  console.log('===============================================================');
}

reconcileHistory().catch((err) => {
  console.error(err);
  process.exit(1);
});
