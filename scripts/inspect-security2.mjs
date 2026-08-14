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
    // Map role OIDs to names
    console.log('=== ROLE OIDs ===')
    const { rows: roles } = await client.query(`
      SELECT oid, rolname FROM pg_roles 
      WHERE oid IN (16484, 16485, 16388, 16486, 0)
      ORDER BY rolname;
    `)
    console.table(roles)

    // Check function ACLs as text  
    console.log('\n=== FUNCTION ACLs (raw) ===')
    const { rows: acls } = await client.query(`
      SELECT p.proname, p.proacl
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prosecdef = true
      ORDER BY p.proname;
    `)
    for (const row of acls) {
      console.log(`${row.proname}: ${row.proacl}`)
    }

    // Check notification RLS policies detail
    console.log('\n=== NOTIFICATION RLS POLICIES ===')
    const { rows: nPolicies } = await client.query(`
      SELECT polname, polcmd, polroles, qual, with_check
      FROM pg_policy
      WHERE polrelid = 'public.notifications'::regclass
      ORDER BY polname;
    `)
    for (const p of nPolicies) {
      console.log(`Policy: ${p.polname} | CMD: ${p.polcmd} | Roles: ${p.polroles}`)
    }

    // Check if anon role exists and what oid it is
    console.log('\n=== ANON/AUTHENTICATED/PUBLIC ROLES ===')
    const { rows: authRoles } = await client.query(`
      SELECT oid, rolname FROM pg_roles 
      WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin')
      ORDER BY rolname;
    `)
    console.table(authRoles)

  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Inspection error:', err)
  process.exit(1)
})
