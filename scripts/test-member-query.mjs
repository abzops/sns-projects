import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const repoRoot = process.cwd();
const envAppPath = path.join(repoRoot, '.env');

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

async function main() {
  const env = parseEnv(await readFile(envAppPath, 'utf8'));
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

  // Require explicit password via environment variable; never guess or use fallbacks
  const password = process.env.TEST_PASSWORD;
  if (!password) {
    console.log('[SKIP] TEST_PASSWORD not set. Skipping live authenticated query.');
    return;
  }

  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_EMAIL || 'abhinand@stacknstock.in',
    password,
  });

  console.log('Testing workspace_members query with explicit foreign key...');
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      id,
      workspace_id,
      user_id,
      invited_email,
      role,
      status,
      invited_by,
      created_at,
      profile:profiles!workspace_members_user_id_fkey(
        id,
        full_name,
        avatar_url
      )
    `)
    .eq('workspace_id', 'dbcaddf1-cf02-4bad-8af1-974301cdfbea');

  console.log('Query result:', { count: data?.length, error, members: JSON.stringify(data, null, 2) });
}

main().catch(console.error);
