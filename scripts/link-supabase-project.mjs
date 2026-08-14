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

async function linkProject() {
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  console.log('Linking Supabase project gqerfixdmgbqahgslzsq...');
  try {
    const out = execSync(`npx supabase link --project-ref gqerfixdmgbqahgslzsq -p "${envAdmin.SUPABASE_DB_PASSWORD}"`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    console.log(out);
  } catch (err) {
    console.error('Link failed:', err.stdout || err.message);
  }
}

linkProject().catch(console.error);
