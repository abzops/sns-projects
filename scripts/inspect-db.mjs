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
    const { rows: counts } = await client.query(`
      select
        (select count(*)::int from public.profiles) as profiles_count,
        (select count(*)::int from public.workspaces) as workspaces_count,
        (select count(*)::int from public.workspace_members) as workspace_members_count,
        (select count(*)::int from public.projects) as projects_count,
        (select count(*)::int from public.task_statuses) as task_statuses_count,
        (select count(*)::int from public.tasks) as tasks_count
    `)
    console.log('Current Row Counts:', counts[0])

    const { rows: tables } = await client.query(`
      select table_name 
      from information_schema.tables 
      where table_schema = 'public'
      order by table_name
    `)
    console.log('Current Public Tables:', tables.map(t => t.table_name))

    const { rows: projectCols } = await client.query(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'projects'
      order by ordinal_position
    `)
    console.log('Current projects Columns:', projectCols)

    const { rows: statusCols } = await client.query(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'task_statuses'
      order by ordinal_position
    `)
    console.log('Current task_statuses Columns:', statusCols)

    const { rows: sampleStatuses } = await client.query(`
      select id, project_id, name, color, position from public.task_statuses order by project_id, position
    `)
    console.log('Sample task_statuses rows count:', sampleStatuses.length)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Inspect error:', err)
  process.exit(1)
})
