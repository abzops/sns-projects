import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg

function parseEnv(content) {
  return content.split(/\r?\n/).reduce((v, l) => {
    l = l.trim(); if (!l || l[0] === '#') return v;
    const i = l.indexOf('='); if (i <= 0) return v;
    v[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    return v;
  }, {});
}

async function main() {
  const env = parseEnv(await readFile('.env.admin', 'utf8'));
  const client = new Client({
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: 5432, database: 'postgres', user: 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log('Fixing workspace_members_select_active and workspaces_select_member policies...\n');

  await client.query(`
    BEGIN;

    -- Fix: workspace_members SELECT — use SECURITY DEFINER helper to avoid recursion
    DROP POLICY IF EXISTS "workspace_members_select_active" ON public.workspace_members;
    CREATE POLICY "workspace_members_select_active" ON public.workspace_members FOR SELECT TO authenticated
      USING (private.is_workspace_active_member(workspace_id));

    -- Fix: workspaces SELECT — use SECURITY DEFINER helper to avoid recursion
    DROP POLICY IF EXISTS "workspaces_select_member" ON public.workspaces;
    CREATE POLICY "workspaces_select_member" ON public.workspaces FOR SELECT TO authenticated
      USING (private.is_workspace_active_member(id));

    COMMIT;
  `);

  console.log('✓ Policies fixed.\n');
  await client.end();
}

main().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
