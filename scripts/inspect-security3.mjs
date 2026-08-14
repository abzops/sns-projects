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
    // 1. Default privileges
    console.log('=== DEFAULT PRIVILEGES ===')
    const { rows: defPrivs } = await client.query(`
      SELECT
        pg_catalog.pg_get_userbyid(defaclrole) AS owner,
        defaclnamespace,
        n.nspname AS schema_name,
        defaclobjtype,
        defaclacl
      FROM pg_default_acl d
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      ORDER BY owner, schema_name;
    `)
    console.table(defPrivs)

    // 2. ALL public schema functions (not just SECURITY DEFINER)
    console.log('\n=== ALL FUNCTIONS IN public SCHEMA ===')
    const { rows: allFuncs } = await client.query(`
      SELECT
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS args,
        p.prosecdef AS is_security_definer,
        p.provolatile,
        COALESCE(p.proacl::text, 'DEFAULT') AS acl
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      ORDER BY p.proname;
    `)
    console.table(allFuncs)

    // 3. Current table-level privileges on notifications
    console.log('\n=== NOTIFICATIONS TABLE PRIVILEGES ===')
    const { rows: tblPrivs } = await client.query(`
      SELECT
        grantee,
        privilege_type,
        is_grantable
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' AND table_name = 'notifications'
      ORDER BY grantee, privilege_type;
    `)
    console.table(tblPrivs)

    // 4. Column privileges on notifications
    console.log('\n=== NOTIFICATIONS COLUMN PRIVILEGES ===')
    const { rows: colPrivs } = await client.query(`
      SELECT
        grantee,
        column_name,
        privilege_type
      FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'notifications'
      ORDER BY grantee, column_name;
    `)
    if (colPrivs.length === 0) {
      console.log('(No column-level grants - table-level grants apply)')
    } else {
      console.table(colPrivs)
    }

    // 5. Check if 'private' schema already exists
    console.log('\n=== PRIVATE SCHEMA EXISTS? ===')
    const { rows: privSchema } = await client.query(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'private';
    `)
    console.log(privSchema.length > 0 ? 'YES - private schema exists' : 'NO - private schema does not exist')

    // 6. Check Supabase exposed schemas config
    console.log('\n=== SUPABASE EXPOSED SCHEMAS (pgrst config) ===')
    const { rows: pgrstConfig } = await client.query(`
      SELECT name, setting 
      FROM pg_settings 
      WHERE name LIKE 'pgrst%' AND name LIKE '%schema%';
    `)
    console.table(pgrstConfig)

  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Inspection error:', err)
  process.exit(1)
})
