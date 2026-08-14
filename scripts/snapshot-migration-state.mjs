import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { execSync } from 'node:child_process';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const backupDir = path.join(repoRoot, 'data-backups');

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

async function snapshotMigrationState() {
  console.log('=== MIGRATION PRE-RECONCILIATION SNAPSHOT ===\n');
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));

  // A. Full listing and hashes of supabase/migrations/
  const files = (await readdir(migrationsDir)).sort();
  const fileHashes = {};

  console.log('A. Current files in supabase/migrations/:');
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const content = await readFile(filePath);
    const hash = createHash('sha256').update(content).digest('hex');
    fileHashes[file] = hash;
    console.log(`  - ${file} (${content.length} bytes, SHA256: ${hash})`);
  }

  // B. Current remote supabase_migrations.schema_migrations
  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const { rows: remoteMigrations } = await pgClient.query(`
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    ORDER BY version;
  `);

  console.log('\nB. Current remote supabase_migrations.schema_migrations:');
  console.table(remoteMigrations);

  // C. Test supabase migration list via CLI
  console.log('\nC. Running npx supabase migration list --linked...');
  let cliListOutput = '';
  try {
    cliListOutput = execSync('npx supabase migration list --linked', {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_DB_PASSWORD: envAdmin.SUPABASE_DB_PASSWORD }
    });
    console.log(cliListOutput);
  } catch (err) {
    console.log('CLI list stderr/output:', err.stdout || err.message);
    cliListOutput = err.stdout || err.message;
  }

  // D. Git status
  const gitStatus = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  console.log('D. Current git status --porcelain:\n', gitStatus || '(clean)');

  // Save snapshot to data-backups
  await mkdir(backupDir, { recursive: true });
  const snapshotData = {
    timestamp: new Date().toISOString(),
    files: fileHashes,
    remoteMigrations,
    cliListOutput,
    gitStatus,
  };

  await writeFile(
    path.join(backupDir, 'migration-history-pre-repair-snapshot.json'),
    JSON.stringify(snapshotData, null, 2),
    'utf8'
  );

  console.log('\n✓ Snapshot saved to data-backups/migration-history-pre-repair-snapshot.json');

  await pgClient.end();
}

snapshotMigrationState().catch(err => {
  console.error(err);
  process.exit(1);
});
