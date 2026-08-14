import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';

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

async function deployMigration() {
  console.log('===============================================================');
  console.log('SNS Projects — DP-1-A Production Migration Deployment');
  console.log('===============================================================\n');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const encodedPassword = encodeURIComponent(envAdmin.SUPABASE_DB_PASSWORD);
  const dbUrl = `postgresql://${envAdmin.SUPABASE_DB_USER || 'postgres'}:${encodedPassword}@${envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co'}:${envAdmin.SUPABASE_DB_PORT || '5432'}/${envAdmin.SUPABASE_DB_NAME || 'postgres'}`;

  console.log('Deploying migration with official CLI command: npx supabase db push --db-url ...');

  try {
    const out = execSync(`npx supabase db push --db-url "${dbUrl}"`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    console.log(out);
  } catch (err) {
    console.error('Migration push failed:', err.stdout || err.message);
    process.exit(1);
  }
}

deployMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});
