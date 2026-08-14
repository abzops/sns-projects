import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const envAppPath = path.join(repoRoot, '.env');

function parseEnv(content) {
  return content
    .split(/\r?\n/)
    .reduce((values, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return values;
      const equalsIndex = line.indexOf('=');
      if (equalsIndex <= 0) return values;
      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      values[key] = value;
      return values;
    }, {});
}

async function runTests() {
  console.log('===============================================================');
  console.log('SNS Projects — Structured Production Dataset Verification Suite');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const envApp = parseEnv(await readFile(envAppPath, 'utf8'));

  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  console.log('=== GROUP 1: HIERARCHY & DATASET COUNTS ===');

  // Check 1: Exactly 3 target Projects
  const { rows: projRows } = await client.query('SELECT * FROM public.projects WHERE workspace_id = $1 ORDER BY created_at;', [wsId]);
  assert(projRows.length === 3, `Check 1: Exactly 3 target Projects exist (got ${projRows.length})`);
  const projIds = projRows.map(p => p.id);

  // Check 2: Exactly 6 Milestones
  const { rows: msRows } = await client.query('SELECT * FROM public.milestones WHERE project_id = ANY($1::uuid[]) ORDER BY created_at;', [projIds]);
  assert(msRows.length === 6, `Check 2: Exactly 6 Milestones exist (got ${msRows.length})`);
  const msIds = msRows.map(m => m.id);

  // Check 3: Exactly 12 Task Lists
  const { rows: tlRows } = await client.query('SELECT * FROM public.task_lists WHERE project_id = ANY($1::uuid[]) ORDER BY created_at;', [projIds]);
  assert(tlRows.length === 12, `Check 3: Exactly 12 Task Lists exist (got ${tlRows.length})`);
  const tlIds = tlRows.map(tl => tl.id);

  // Check 4: Exactly 24 Tasks
  const { rows: taskRows } = await client.query('SELECT * FROM public.tasks WHERE project_id = ANY($1::uuid[]) ORDER BY created_at;', [projIds]);
  assert(taskRows.length === 24, `Check 4: Exactly 24 Tasks exist (got ${taskRows.length})`);
  const taskIds = taskRows.map(t => t.id);

  // Check 5: Exactly 48 Subtasks
  const { rows: subRows } = await client.query('SELECT * FROM public.subtasks WHERE task_id = ANY($1::uuid[]) ORDER BY created_at;', [taskIds]);
  assert(subRows.length === 48, `Check 5: Exactly 48 Subtasks exist (got ${subRows.length})`);

  console.log('\n=== GROUP 2: HIERARCHY INVARIANTS & INTEGRITY ===');

  // Check 6: Zero Uncategorized Tasks
  const uncategorizedTasks = taskRows.filter(t => !t.milestone_id && !t.task_list_id);
  assert(uncategorizedTasks.length === 0, `Check 6: Zero Uncategorized Tasks exist (got ${uncategorizedTasks.length})`);

  // Check 7: Zero Partial Hierarchy Tasks
  const partialTasks = taskRows.filter(t => (!t.milestone_id && t.task_list_id) || (t.milestone_id && !t.task_list_id));
  assert(partialTasks.length === 0, `Check 7: Zero Partial Hierarchy Tasks exist (got ${partialTasks.length})`);

  // Check 8: Every Task List belongs to correct Project/Milestone
  const { rows: invalidTlRows } = await client.query(`
    SELECT tl.id, tl.name
    FROM public.task_lists tl
    JOIN public.milestones m ON m.id = tl.milestone_id
    WHERE tl.project_id <> m.project_id AND tl.project_id = ANY($1::uuid[]);
  `, [projIds]);
  assert(invalidTlRows.length === 0, `Check 8: All 12 Task Lists strictly belong to correct Milestone & Project (invalid: ${invalidTlRows.length})`);

  // Check 9: Every Task belongs to correct Task List / Milestone / Project
  const { rows: invalidTaskRows } = await client.query(`
    SELECT t.id, t.title
    FROM public.tasks t
    JOIN public.task_lists tl ON tl.id = t.task_list_id
    JOIN public.milestones m ON m.id = t.milestone_id
    WHERE (t.project_id <> tl.project_id OR t.project_id <> m.project_id OR t.milestone_id <> tl.milestone_id)
      AND t.project_id = ANY($1::uuid[]);
  `, [projIds]);
  assert(invalidTaskRows.length === 0, `Check 9: All 24 Tasks strictly belong to matching Task List, Milestone & Project (invalid: ${invalidTaskRows.length})`);

  // Check 10: Exactly 2 Subtasks per Task
  const { rows: subtaskPerTaskCounts } = await client.query(`
    SELECT t.id, t.title, count(s.id) as sub_count
    FROM public.tasks t
    LEFT JOIN public.subtasks s ON s.task_id = t.id
    WHERE t.project_id = ANY($1::uuid[])
    GROUP BY t.id, t.title
    HAVING count(s.id) <> 2;
  `, [projIds]);
  assert(subtaskPerTaskCounts.length === 0, `Check 10: Every Task has exactly 2 Subtasks (non-compliant tasks: ${subtaskPerTaskCounts.length})`);

  console.log('\n=== GROUP 3: RACI GOVERNANCE & ACCOUNTABILITY ===');

  // Check 11: Every Task has >= 1 Responsible (R)
  const { rows: missingRRows } = await client.query(`
    SELECT t.id, t.title
    FROM public.tasks t
    WHERE t.project_id = ANY($1::uuid[])
      AND NOT EXISTS (
        SELECT 1 FROM public.task_raci_assignments tra
        WHERE tra.task_id = t.id AND tra.raci_role = 'R'
      );
  `, [projIds]);
  assert(missingRRows.length === 0, `Check 11: Every Task has >= 1 Responsible (R) assignment (missing: ${missingRRows.length})`);

  // Check 12: Every Task has exactly 1 Accountable (A) user
  const { rows: invalidARows } = await client.query(`
    SELECT t.id, t.title, count(tra.id) as a_count
    FROM public.tasks t
    LEFT JOIN public.task_raci_assignments tra ON tra.task_id = t.id AND tra.raci_role = 'A'
    WHERE t.project_id = ANY($1::uuid[])
    GROUP BY t.id, t.title
    HAVING count(tra.id) <> 1;
  `, [projIds]);
  assert(invalidARows.length === 0, `Check 12: Every Task has exactly 1 Accountable (A) assignment (non-compliant: ${invalidARows.length})`);

  // Check 13: Every Accountable assignment targets a real profile / user
  const { rows: invalidATargets } = await client.query(`
    SELECT tra.id, tra.user_id
    FROM public.task_raci_assignments tra
    JOIN public.tasks t ON t.id = tra.task_id
    WHERE t.project_id = ANY($1::uuid[])
      AND tra.raci_role = 'A'
      AND (tra.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = tra.user_id));
  `, [projIds]);
  assert(invalidATargets.length === 0, `Check 13: Every Accountable assignment targets a valid real profile (invalid: ${invalidATargets.length})`);

  console.log('\n=== GROUP 4: STATUS SYSTEM CODES & CORE DEPARTMENTS ===');

  // Check 14: All task status system codes valid
  const { rows: statusRows } = await client.query(`
    SELECT ts.id, ts.name, ts.system_code, ts.project_id
    FROM public.task_statuses ts
    WHERE ts.project_id = ANY($1::uuid[]);
  `, [projIds]);
  const invalidStatuses = statusRows.filter(s => !['todo', 'in_progress', 'in_review', 'blocked', 'done'].includes(s.system_code));
  assert(invalidStatuses.length === 0, `Check 14: All project task statuses have valid system_codes (total: ${statusRows.length}, invalid: ${invalidStatuses.length})`);

  // Check 15: Core 5 departments exist
  const { rows: deptRows } = await client.query('SELECT code, name, color, is_active FROM public.departments WHERE workspace_id = $1;', [wsId]);
  const deptCodes = new Set(deptRows.map(d => d.code));
  const has5Core = ['ENG', 'SWIT', 'OPS', 'PROC', 'COMM'].every(code => deptCodes.has(code));
  assert(has5Core, `Check 15: Core 5 departments exist in workspace (${deptRows.map(d => d.code).join(', ')})`);

  console.log('\n=== GROUP 5: AUTH & WORKSPACE PRESERVATION ===');

  // Check 16: Workspace membership count unchanged
  const { rows: wmRows } = await client.query('SELECT count(*)::int as c FROM public.workspace_members WHERE workspace_id = $1;', [wsId]);
  assert(wmRows[0].c === 1, `Check 16: Workspace membership count preserved (got ${wmRows[0].c})`);

  // Check 17: Auth user count unchanged
  const { rows: userRows } = await client.query("SELECT count(*)::int as c FROM auth.users WHERE email = 'abhinand@stacknstock.in';");
  assert(userRows[0].c === 1, `Check 17: Production auth user preserved (got ${userRows[0].c})`);

  // Check 18: Zero fabricated auth users created
  const { rows: allUsers } = await client.query('SELECT count(*)::int as c FROM auth.users;');
  assert(allUsers[0].c === 1, `Check 18: No fabricated auth users created (total users in auth: ${allUsers[0].c})`);

  // Check 19: Notifications cleaned after reseed
  const { rows: notifRows } = await client.query('SELECT count(*)::int as c FROM public.notifications WHERE workspace_id = $1;', [wsId]);
  assert(notifRows[0].c === 0, `Check 19: Synthetic notifications cleanly purged after reseed (remaining in inbox: ${notifRows[0].c})`);

  console.log('\n=== GROUP 6: END-TO-END POSTGREST EMBEDDING & QUERYABILITY ===');

  // Check 20: Full Hierarchy PostgREST query simulation
  const { rows: fullHierarchy } = await client.query(`
    SELECT
      p.id as project_id,
      p.name as project_name,
      m.id as milestone_id,
      m.name as milestone_name,
      tl.id as task_list_id,
      tl.name as task_list_name,
      t.id as task_id,
      t.title as task_title,
      ts.system_code as task_status,
      t.priority as task_priority,
      (SELECT count(*) FROM public.subtasks s WHERE s.task_id = t.id) as subtask_count,
      (SELECT count(*) FROM public.task_raci_assignments tra WHERE tra.task_id = t.id AND tra.raci_role = 'R') as r_count,
      (SELECT count(*) FROM public.task_raci_assignments tra WHERE tra.task_id = t.id AND tra.raci_role = 'A') as a_count
    FROM public.projects p
    JOIN public.milestones m ON m.project_id = p.id
    JOIN public.task_lists tl ON tl.milestone_id = m.id AND tl.project_id = p.id
    JOIN public.tasks t ON t.task_list_id = tl.id AND t.milestone_id = m.id AND t.project_id = p.id
    JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = '${wsId}'
    ORDER BY p.name, m.position, tl.position, t.position;
  `);

  assert(fullHierarchy.length === 24, `Check 20: Entire 5-level hierarchy is queryable with 24 structured tasks across all 3 projects`);

  console.log('\n=== STRUCTURED HIERARCHY MATRIX PREVIEW ===');
  console.table(fullHierarchy.slice(0, 8).map(r => ({
    Project: r.project_name,
    Milestone: r.milestone_name,
    TaskList: r.task_list_name,
    Task: r.task_title,
    Status: r.task_status,
    Priority: r.task_priority,
    R: r.r_count,
    A: r.a_count,
    Subtasks: r.subtask_count,
  })));

  await client.end();

  console.log('\n===============================================================');
  console.log(`Structured Dataset Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in verification:', err);
  process.exit(1);
});
