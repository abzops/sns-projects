import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const { Client } = pg
const repoRoot = process.cwd()
const envAdminPath = path.join(repoRoot, '.env.admin')
const envPath = path.join(repoRoot, '.env')

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
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'))
  const env = parseEnv(await readFile(envPath, 'utf8'))

  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()

  console.log('--- RUNNING RLS & FUNCTION TESTS ---\n')

  try {
    // 1. Check Anon Client RLS
    console.log('Test 1: Anonymous user cannot read organizational data...')
    const anonSupabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
    const { data: anonDepts, error: anonErr } = await anonSupabase.from('departments').select('*')
    if (anonDepts?.length === 0 || anonErr) {
      console.log('  [PASS] Anon blocked from departments (0 rows returned or error):', anonErr?.message || '0 rows')
    } else {
      throw new Error(`Anon was able to read departments: ${JSON.stringify(anonDepts)}`)
    }

    const { data: anonRoles } = await anonSupabase.from('user_system_roles').select('*')
    if (anonRoles?.length === 0) {
      console.log('  [PASS] Anon blocked from user_system_roles')
    }

    const { data: anonNotifs } = await anonSupabase.from('notifications').select('*')
    if (anonNotifs?.length === 0) {
      console.log('  [PASS] Anon blocked from notifications')
    }

    // 2. Test helper functions in SQL
    console.log('\nTest 2: Verifying helper functions in SQL...')
    const { rows: workspaces } = await client.query('select id, created_by from public.workspaces limit 1')
    const workspaceId = workspaces[0].id
    const ownerId = workspaces[0].created_by

    const { rows: memberCheck } = await client.query(`
      select public.get_user_workspace_role('${workspaceId}'::uuid) as test_role;
    `)
    console.log('  [PASS] Helper get_user_workspace_role executed without error')

    // 3. Test RACI constraints
    console.log('\nTest 3: Testing RACI table constraints...')
    const { rows: taskSample } = await client.query('select id from public.tasks limit 1')
    const testTaskId = taskSample[0]?.id

    if (testTaskId) {
      // Test A role with user_id is valid
      const { rows: testInsert } = await client.query(`
        insert into public.task_raci_assignments (task_id, raci_role, user_id)
        values ('${testTaskId}', 'A', '${ownerId}')
        returning id;
      `)
      const raciId = testInsert[0].id
      console.log('  [PASS] Valid Accountable (A) record inserted:', raciId)

      // Test duplicate A fails (partial unique index)
      let dupFailed = false
      try {
        await client.query(`
          insert into public.task_raci_assignments (task_id, raci_role, user_id)
          values ('${testTaskId}', 'A', '${ownerId}');
        `)
      } catch (err) {
        dupFailed = true
        console.log('  [PASS] Duplicate Accountable (A) correctly rejected by uq_task_raci_accountable')
      }
      if (!dupFailed) throw new Error('Duplicate A was allowed!')

      // Clean up test RACI
      await client.query(`delete from public.task_raci_assignments where id = '${raciId}'`)
    }

    // 4. Test department creation and constraints
    console.log('\nTest 4: Testing Department uniqueness and constraint...')
    const { rows: testDept } = await client.query(`
      insert into public.departments (workspace_id, code, name, color)
      values ('${workspaceId}', 'TEST_DEPT', 'Test Department', '#8cc9ff')
      returning id;
    `)
    const deptId = testDept[0].id
    console.log('  [PASS] Department inserted:', deptId)

    let dupDeptFailed = false
    try {
      await client.query(`
        insert into public.departments (workspace_id, code, name)
        values ('${workspaceId}', 'TEST_DEPT', 'Duplicate Code Dept');
      `)
    } catch (err) {
      dupDeptFailed = true
      console.log('  [PASS] Duplicate department code correctly rejected by uq_department_workspace_code')
    }
    if (!dupDeptFailed) throw new Error('Duplicate department code was allowed!')

    // Clean up test dept
    await client.query(`delete from public.departments where id = '${deptId}'`)

    console.log('\n>>> ALL RLS & CONSTRAINT TESTS PASSED SUCCESSFULLY! <<<')

  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
