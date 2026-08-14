import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// Load env
const envContent = await readFile('.env', 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...rest] = trimmed.split('=');
    env[k.trim()] = rest.join('=').trim();
  }
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

console.log('🧪 Testing Release 2 Supabase Data Contracts...');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(name, condition, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${details}`);
      failed++;
    }
  }

  // 1. Test Workspaces & Projects schema
  try {
    const { data: projects, error: pErr } = await supabase
      .from('projects')
      .select(`
        id,
        workspace_id,
        name,
        description,
        color,
        owner_id,
        start_date,
        target_end_date,
        project_status,
        project_priority,
        created_by,
        created_at,
        updated_at
      `)
      .limit(5);

    assert('Projects table supports all V2 metadata columns', !pErr && Array.isArray(projects), pErr?.message);
  } catch (e) {
    assert('Projects table query', false, e.message);
  }

  // 2. Test Departments schema
  try {
    const { data: depts, error: dErr } = await supabase
      .from('departments')
      .select('id, workspace_id, code, name, description, color, is_active')
      .limit(5);

    assert('Departments table queryable with all fields', !dErr && Array.isArray(depts), dErr?.message);
  } catch (e) {
    assert('Departments table query', false, e.message);
  }

  // 3. Test Department Memberships schema
  try {
    const { data: dm, error: dmErr } = await supabase
      .from('department_memberships')
      .select('id, department_id, user_id, role, is_primary, created_at')
      .limit(5);

    assert('Department memberships table queryable', !dmErr && Array.isArray(dm), dmErr?.message);
  } catch (e) {
    assert('Department memberships query', false, e.message);
  }

  // 4. Test User System Roles schema
  try {
    const { data: roles, error: rErr } = await supabase
      .from('user_system_roles')
      .select('id, workspace_id, user_id, role, created_at')
      .limit(5);

    assert('User system roles table queryable', !rErr && Array.isArray(roles), rErr?.message);
  } catch (e) {
    assert('User system roles query', false, e.message);
  }

  // 5. Test Task RACI assignments schema
  try {
    const { data: raci, error: raciErr } = await supabase
      .from('task_raci_assignments')
      .select(`
        id,
        task_id,
        raci_role,
        user_id,
        department_id
      `)
      .limit(5);

    assert('Task RACI assignments table queryable', !raciErr && Array.isArray(raci), raciErr?.message);
  } catch (e) {
    assert('Task RACI assignments query', false, e.message);
  }

  // 6. Test Task Statuses system_code column
  try {
    const { data: statuses, error: sErr } = await supabase
      .from('task_statuses')
      .select('id, project_id, name, color, position, system_code')
      .limit(5);

    assert('Task statuses includes system_code column', !sErr && Array.isArray(statuses), sErr?.message);
  } catch (e) {
    assert('Task statuses query', false, e.message);
  }

  // 7. Test Notifications table column level access
  try {
    const { data: notifs, error: nErr } = await supabase
      .from('notifications')
      .select('id, workspace_id, user_id, type, title, message, is_read')
      .limit(5);

    assert('Notifications table queryable for authenticated', !nErr, nErr?.message);
  } catch (e) {
    assert('Notifications query', false, e.message);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
