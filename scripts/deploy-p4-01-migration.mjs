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
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const dbUrl = envAdmin.SUPABASE_DB_URL;

  console.log('Deploying P4-01 migration to remote Supabase project:');
  try {
    const out = execSync(`npx supabase db push --db-url "${dbUrl}"`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    console.log(out);
  } catch (err) {
    console.error('Deployment error:', err.stdout || err.message);
    process.exit(1);
  }
}

deployMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});