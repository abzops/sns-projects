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

  console.log('Dropping ALL stale V1 policies...\n');

  const sql = `
    BEGIN;

    -- ── workspace_members: drop stale V1 policies ──
    DROP POLICY IF EXISTS "wm_select" ON public.workspace_members;
    DROP POLICY IF EXISTS "wm_update" ON public.workspace_members;
    DROP POLICY IF EXISTS "wm_insert" ON public.workspace_members;
    DROP POLICY IF EXISTS "wm_delete" ON public.workspace_members;

    -- ── workspaces: drop stale V1 policies ──
    DROP POLICY IF EXISTS "Members can view workspaces" ON public.workspaces;
    DROP POLICY IF EXISTS "Owners can delete workspaces" ON public.workspaces;
    DROP POLICY IF EXISTS "Owners can update workspaces" ON public.workspaces;
    DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
    DROP POLICY IF EXISTS "workspaces_select" ON public.workspaces;
    DROP POLICY IF EXISTS "workspaces_insert" ON public.workspaces;
    DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;
    DROP POLICY IF EXISTS "workspaces_delete" ON public.workspaces;

    -- ── profiles: drop stale V1 policies ──
    DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

    -- ── projects: drop stale V1 policies ──
    DROP POLICY IF EXISTS "Workspace members can view projects" ON public.projects;
    DROP POLICY IF EXISTS "Members can create projects" ON public.projects;
    DROP POLICY IF EXISTS "Members can update projects" ON public.projects;
    DROP POLICY IF EXISTS "Admins can delete projects" ON public.projects;

    -- ── task_statuses: drop stale V1 policies ──
    DROP POLICY IF EXISTS "Workspace members can view statuses" ON public.task_statuses;
    DROP POLICY IF EXISTS "Members can create statuses" ON public.task_statuses;
    DROP POLICY IF EXISTS "Members can update statuses" ON public.task_statuses;
    DROP POLICY IF EXISTS "Members can delete statuses" ON public.task_statuses;

    -- ── tasks: drop stale V1 policies ──
    DROP POLICY IF EXISTS "Workspace members can view tasks" ON public.tasks;
    DROP POLICY IF EXISTS "Members can create tasks" ON public.tasks;
    DROP POLICY IF EXISTS "Members can update tasks" ON public.tasks;
    DROP POLICY IF EXISTS "Members can delete tasks" ON public.tasks;

    COMMIT;
  `;

  await client.query(sql);
  console.log('✓ All stale V1 policies dropped.\n');

  // Verify remaining policies per table
  const tables = ['workspaces', 'workspace_members', 'profiles', 'projects', 'task_statuses', 'tasks'];
  for (const t of tables) {
    const { rows } = await client.query(`
      SELECT polname, polcmd FROM pg_policy
      WHERE polrelid = $1::regclass ORDER BY polname
    `, [`public.${t}`]);
    console.log(`${t} (${rows.length} policies):`);
    rows.forEach(r => console.log(`  - ${r.polname} [${r.polcmd}]`));
    console.log('');
  }

  await client.end();
}

main().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
