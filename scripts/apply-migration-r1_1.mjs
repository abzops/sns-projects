import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const repoRoot = process.cwd()
const envAdminPath = path.join(repoRoot, '.env.admin')
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260814_02_security_hardening.sql')

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

function buildConnectionConfig(env) {
  if (env.SUPABASE_DB_URL) {
    return {
      connectionString: env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    }
  }
  return {
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(env.SUPABASE_DB_PORT || '5432'),
    database: env.SUPABASE_DB_NAME || 'postgres',
    user: env.SUPABASE_DB_USER || 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  }
}

async function main() {
  const env = parseEnv(await readFile(envAdminPath, 'utf8'))
  const client = new Client(buildConnectionConfig(env))
  await client.connect()

  try {
    const migrationSql = await readFile(migrationPath, 'utf8')
    console.log('Applying Release 1.1 Security Hardening Migration...')
    console.log(`File: ${migrationPath}\n`)
    await client.query(migrationSql)
    console.log('✓ Migration applied successfully.\n')

    // ── Verification ──

    console.log('--- VERIFY: private schema exists ---')
    const { rows: schemas } = await client.query(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'private';
    `)
    console.log(schemas.length > 0 ? '✓ private schema exists' : '✗ MISSING private schema')

    console.log('\n--- VERIFY: private functions ---')
    const { rows: privFuncs } = await client.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'private'
      ORDER BY p.proname;
    `)
    console.table(privFuncs)

    console.log('\n--- VERIFY: public helper functions removed ---')
    const { rows: pubHelpers } = await client.query(`
      SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_user_workspace_role','is_workspace_active_member','has_system_role','can_administer_workspace');
    `)
    console.log(pubHelpers.length === 0 ? '✓ All public helpers removed' : `✗ ${pubHelpers.length} public helpers remain: ${pubHelpers.map(r=>r.proname).join(', ')}`)

    console.log('\n--- VERIFY: private function ACLs ---')
    const { rows: privAcls } = await client.query(`
      SELECT p.proname, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'private'
      ORDER BY p.proname;
    `)
    console.table(privAcls)

    console.log('\n--- VERIFY: trigger function ACLs ---')
    const { rows: trigAcls } = await client.query(`
      SELECT p.proname, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname IN ('handle_new_user', 'seed_default_statuses')
      ORDER BY p.proname;
    `)
    console.table(trigAcls)

    console.log('\n--- VERIFY: notification table privileges ---')
    const { rows: notifPrivs } = await client.query(`
      SELECT grantee, privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' AND table_name = 'notifications'
        AND grantee = 'authenticated'
      ORDER BY privilege_type;
    `)
    console.table(notifPrivs)

    console.log('\n--- VERIFY: notification column-level UPDATE grants ---')
    const { rows: colPrivs } = await client.query(`
      SELECT grantee, column_name, privilege_type
      FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'notifications'
        AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
      ORDER BY column_name;
    `)
    console.table(colPrivs)

    console.log('\n--- VERIFY: notification RLS policies ---')
    const { rows: notifPolicies } = await client.query(`
      SELECT polname, polcmd
      FROM pg_policy WHERE polrelid = 'public.notifications'::regclass
      ORDER BY polname;
    `)
    console.table(notifPolicies)

    console.log('\n--- VERIFY: default privileges for postgres in public ---')
    const { rows: defPrivs } = await client.query(`
      SELECT defaclobjtype AS obj_type, defaclacl::text AS acl
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE pg_catalog.pg_get_userbyid(defaclrole) = 'postgres'
        AND n.nspname = 'public'
        AND defaclobjtype = 'f';
    `)
    console.table(defPrivs)

    console.log('\n--- VERIFY: RLS still enabled on all tables ---')
    const { rows: rlsCheck } = await client.query(`
      SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `)
    console.table(rlsCheck)

    console.log('\n--- VERIFY: PostgREST exposed schemas ---')
    try {
      const { rows: pgrst } = await client.query(`SELECT current_setting('pgrst.db_schemas', true) AS schemas`)
      console.log('pgrst.db_schemas:', pgrst[0]?.schemas ?? '(not set — defaults to public,storage)')
    } catch {
      console.log('pgrst.db_schemas: not available')
    }

  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Migration FAILED:', err)
  process.exit(1)
})
