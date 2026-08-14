import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg

const repoRoot = process.cwd()
const envAdminPath = path.join(repoRoot, '.env.admin')
const schemaPath = path.join(repoRoot, 'supabase', 'schema.sql')
const seedPath = path.join(repoRoot, 'supabase', 'seed_sns_projects_dataset.sql')

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

function escapeSqlString(value) {
  return value.replaceAll("'", "''")
}

function buildConnectionConfig(env) {
  if (env.SUPABASE_DB_URL) {
    return {
      connectionString: env.SUPABASE_DB_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  }

  const password = env.SUPABASE_DB_PASSWORD
  if (!password) {
    throw new Error('Missing SUPABASE_DB_URL or SUPABASE_DB_PASSWORD in .env.admin')
  }

  return {
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(env.SUPABASE_DB_PORT || '5432'),
    database: env.SUPABASE_DB_NAME || 'postgres',
    user: env.SUPABASE_DB_USER || 'postgres',
    password,
    ssl: {
      rejectUnauthorized: false,
    },
  }
}

async function loadAdminEnv() {
  try {
    return parseEnv(await readFile(envAdminPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Create ${envAdminPath} before running this script.`)
    }
    throw error
  }
}

async function applySql(client, label, sql) {
  console.log(`Applying ${label}...`)
  await client.query(sql)
  console.log(`Applied ${label}.`)
}

async function verify(client) {
  const { rows } = await client.query(`
    select
      (select count(*)::int from public.profiles) as profiles,
      (select count(*)::int from public.workspaces) as workspaces,
      (select count(*)::int from public.workspace_members) as workspace_members,
      (select count(*)::int from public.projects) as projects,
      (select count(*)::int from public.task_statuses) as task_statuses,
      (select count(*)::int from public.tasks) as tasks
  `)

  console.table(rows)
}

async function main() {
  const env = await loadAdminEnv()
  const connectionConfig = buildConnectionConfig(env)
  const seedEmail = env.SUPABASE_SEED_EMAIL?.trim()

  const client = new Client(connectionConfig)

  await client.connect()

  try {
    await applySql(client, 'schema', await readFile(schemaPath, 'utf8'))

    if (seedEmail) {
      const seedSql = (await readFile(seedPath, 'utf8')).replace(
        "target_user_email text := 'CHANGE_ME_TO_YOUR_LOGIN_EMAIL';",
        `target_user_email text := '${escapeSqlString(seedEmail)}';`
      )

      await applySql(client, `SNS project dataset for ${seedEmail}`, seedSql)
    } else {
      console.log('Skipping dataset seed. Add SUPABASE_SEED_EMAIL to .env.admin after signing up in the app.')
    }

    console.log('Database verification counts:')
    await verify(client)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  if (error.code === 'ETIMEDOUT') {
    console.error('Database setup failed: connection timed out.')
    console.error('If your Supabase direct DB host resolves only to IPv6, set SUPABASE_DB_URL in .env.admin to the Session Pooler connection string from Supabase.')
    process.exit(1)
  }

  console.error(`Database setup failed: ${error.message}`)
  process.exit(1)
})
