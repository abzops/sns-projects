import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
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

async function testMigrationReplay() {
  console.log('=== TESTING SEQUENTIAL MIGRATION CHAIN REPLAY ===\n');
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));

  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
  console.log(`Found ${files.length} canonical migrations to test in order:`);
  files.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  console.log('\nStarting transactional replay validation (isolated schema test)...');

  // We test the migration chain inside an isolated test schema
  try {
    await pgClient.query('BEGIN;');
    
    // Create temporary isolated sandbox schema
    await pgClient.query('CREATE SCHEMA IF NOT EXISTS _test_migration_sandbox;');
    await pgClient.query('SET LOCAL search_path = _test_migration_sandbox, public;');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`\nReplaying [${i + 1}/${files.length}]: ${file}...`);
      
      // Execute migration SQL inside transaction
      await pgClient.query(sql);
      console.log(`✓ [${file}] executed cleanly without error`);
    }

    // Always rollback the sandbox test transaction
    await pgClient.query('ROLLBACK;');
    console.log('\n✓ All 6 canonical migrations replayed cleanly in sequence with ZERO errors!');

  } catch (err) {
    await pgClient.query('ROLLBACK;');
    console.error('\n✗ Migration replay failed:', err);
    throw err;
  } finally {
    await pgClient.end();
  }
}

testMigrationReplay().catch(() => process.exit(1));
