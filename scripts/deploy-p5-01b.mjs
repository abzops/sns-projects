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

async function deployP501b() {
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const dbUrl = envAdmin.SUPABASE_DB_URL;

  console.log('Pushing migration P5-01B to remote Supabase database...');
  try {
    const out = execSync(`npx supabase db push --db-url "${dbUrl}"`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    console.log(out);
  } catch (err) {
    console.log('Push error:', err.stdout || err.message);
    process.exit(1);
  }
}

deployP501b().catch(console.error);
