import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const repoRoot = process.cwd()
const envAdminPath = path.join(repoRoot, '.env.admin')

function parseEnv(content) {
  return content
    .split(/\r?\n/)
    .reduce((values, rawLine) => {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) return values
      const equalsIndex = line.indexOf('=')
      if (equalsIndex <= 0) return values
      const key = line.slice(0, equalsIndex).trim()
      const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '')
      values[key] = value
      return values
    }, {})
}

async function main() {
  const env = parseEnv(await readFile(envAdminPath, 'utf8'))
  const client = new Client({
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(env.SUPABASE_DB_PORT || '5432'),
    database: env.SUPABASE_DB_NAME || 'postgres',
    user: env.SUPABASE_DB_USER || 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    // 1. Current SECURITY DEFINER functions and their grants
    console.log('=== SECURITY DEFINER FUNCTIONS IN public SCHEMA ===')
    const { rows: secFuncs } = await client.query(`
      SELECT
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS args,
        p.prosecdef AS is_security_definer,
        p.proconfig AS config
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.prosecdef = true
      ORDER BY p.proname;
    `)
    console.table(secFuncs)

    // 2. Current EXECUTE grants on those functions
    console.log('\n=== FUNCTION EXECUTE PRIVILEGES ===')
    const { rows: funcPrivs } = await client.query(`
      SELECT
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS args,
        acl.grantee,
        acl.privilege_type
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
      JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public'
      ORDER BY p.proname, r.rolname;
    `)
    console.table(funcPrivs)

    // 3. Check current notification row counts
    console.log('\n=== NOTIFICATION ROWS ===')
    const { rows: notifCount } = await client.query(`
      SELECT count(*)::int AS count FROM public.notifications;
    `)
    console.log('Notification rows:', notifCount[0].count)

    // 4. Check workspace data
    console.log('\n=== WORKSPACES ===')
    const { rows: workspaces } = await client.query(`
      SELECT id, name, created_by FROM public.workspaces ORDER BY name;
    `)
    console.table(workspaces)

    // 5. Check existing row counts
    console.log('\n=== ROW COUNTS ===')
    const { rows: counts } = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.profiles) AS profiles,
        (SELECT count(*)::int FROM public.workspaces) AS workspaces,
        (SELECT count(*)::int FROM public.workspace_members) AS members,
        (SELECT count(*)::int FROM public.projects) AS projects,
        (SELECT count(*)::int FROM public.task_statuses) AS statuses,
        (SELECT count(*)::int FROM public.tasks) AS tasks,
        (SELECT count(*)::int FROM public.task_raci_assignments) AS raci,
        (SELECT count(*)::int FROM public.departments) AS departments,
        (SELECT count(*)::int FROM public.user_system_roles) AS sys_roles,
        (SELECT count(*)::int FROM public.department_memberships) AS dept_members,
        (SELECT count(*)::int FROM public.notifications) AS notifications
    `)
    console.table(counts)

    // 6. Check if internal schema exists
    console.log('\n=== SCHEMA CHECK ===')
    const { rows: schemas } = await client.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY schema_name;
    `)
    console.log('Schemas:', schemas.map(s => s.schema_name))

  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Inspection error:', err)
  process.exit(1)
})
