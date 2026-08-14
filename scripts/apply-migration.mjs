import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const repoRoot = process.cwd()
const envAdminPath = path.join(repoRoot, '.env.admin')
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260814_01_day0_foundation.sql')

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
    console.log('Applying Day-0 Foundation Migration...')
    await client.query(migrationSql)
    console.log('Migration applied successfully.')

    // Verification queries
    console.log('\n--- VERIFYING TABLES ---')
    const { rows: tables } = await client.query(`
      select table_name from information_schema.tables 
      where table_schema = 'public' 
      order by table_name;
    `)
    console.log('Public tables:', tables.map(t => t.table_name))

    console.log('\n--- VERIFYING RLS ON NEW TABLES ---')
    const { rows: rlsCheck } = await client.query(`
      select tablename, rowsecurity 
      from pg_tables 
      where schemaname = 'public';
    `)
    console.table(rlsCheck)

    console.log('\n--- VERIFYING TASK RACI BACKFILL ---')
    const { rows: raciCount } = await client.query(`
      select count(*)::int as raci_count from public.task_raci_assignments;
    `)
    console.log('RACI assignments count (backfilled):', raciCount[0].raci_count)

    console.log('\n--- VERIFYING TASK STATUSES & SYSTEM CODES ---')
    const { rows: statusCodes } = await client.query(`
      select name, system_code, position, count(*)::int 
      from public.task_statuses 
      group by name, system_code, position 
      order by position;
    `)
    console.table(statusCodes)

    console.log('\n--- VERIFYING PROJECTS ENHANCED COLUMNS ---')
    const { rows: projectSample } = await client.query(`
      select id, name, owner_id, project_status, project_priority from public.projects limit 3;
    `)
    console.table(projectSample)

  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
