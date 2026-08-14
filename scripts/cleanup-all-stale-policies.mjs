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

  // Define the canonical R1.1 policies to KEEP for each table
  const keepPolicies = {
    'public.workspaces': [
      'workspaces_select_member',
      'workspaces_insert_authenticated',
      'workspaces_update_owner',
      'workspaces_delete_owner',
    ],
    'public.workspace_members': [
      'workspace_members_select_active',
      'workspace_members_insert_admin_owner',
      'workspace_members_update_admin_owner',
      'workspace_members_delete_admin_owner',
    ],
    'public.profiles': [
      'profiles_select_authenticated',
      'profiles_update_own',
    ],
    'public.projects': [
      'projects_select_member',
      'projects_insert_member',
      'projects_update_member',
      'projects_delete_admin_owner',
    ],
    'public.task_statuses': [
      'task_statuses_select_member',
      'task_statuses_insert_member',
      'task_statuses_update_member',
      'task_statuses_delete_member',
    ],
    'public.tasks': [
      'tasks_select_member',
      'tasks_insert_member',
      'tasks_update_member',
      'tasks_delete_member',
    ],
    'public.user_system_roles': [
      'user_system_roles_select',
      'user_system_roles_manage',
    ],
    'public.departments': [
      'departments_select_member',
      'departments_insert_manage',
      'departments_update_manage',
      'departments_delete_owner',
    ],
    'public.department_memberships': [
      'dept_memberships_select_member',
      'dept_memberships_manage',
    ],
    'public.task_raci_assignments': [
      'task_raci_select_member',
      'task_raci_manage',
    ],
    'public.notifications': [
      'notifications_select_own',
      'notifications_update_own',
    ],
  };

  console.log('Cleaning up stale policies — keeping only R1.1 canonical set...\n');

  await client.query('BEGIN');

  for (const [table, keepers] of Object.entries(keepPolicies)) {
    const { rows: allPolicies } = await client.query(`
      SELECT polname FROM pg_policy WHERE polrelid = $1::regclass
    `, [table]);

    for (const { polname } of allPolicies) {
      if (!keepers.includes(polname)) {
        const shortTable = table.replace('public.', '');
        console.log(`  DROP: ${shortTable} → "${polname}"`);
        await client.query(`DROP POLICY IF EXISTS "${polname}" ON ${table}`);
      }
    }
  }

  await client.query('COMMIT');
  console.log('\n✓ All stale policies removed.\n');

  // Verify
  for (const [table, keepers] of Object.entries(keepPolicies)) {
    const shortTable = table.replace('public.', '');
    const { rows } = await client.query(`
      SELECT polname, polcmd FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname
    `, [table]);
    console.log(`${shortTable} (${rows.length} policies):`);
    for (const r of rows) {
      const marker = keepers.includes(r.polname) ? '✓' : '✗ UNEXPECTED';
      console.log(`  ${marker} ${r.polname} [${r.polcmd}]`);
    }
    console.log('');
  }

  await client.end();
}

main().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
