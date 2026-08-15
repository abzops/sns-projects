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
  console.log('SNS Projects — Task List Hierarchy Hotfix Verification Suite');
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

  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  console.log('=== GROUP 1: ASRS PRODUCT DEVELOPMENT HIERARCHY & TASK LISTS ===');

  const { rows: asrsProjRows } = await pgClient.query("SELECT id, name FROM public.projects WHERE name ILIKE '%ASRS%' AND workspace_id = $1;", [wsId]);
  assert(asrsProjRows.length === 1, 'Test 1: ASRS Product Development project found');
  const asrsId = asrsProjRows[0].id;

  // Verify ASRS has exactly 4 custom task lists (stray Test cleaned up)
  const { rows: asrsTaskLists } = await pgClient.query(`
    SELECT tl.id, tl.name, tl.milestone_id, m.name as milestone_name, tl.position
    FROM public.task_lists tl
    JOIN public.milestones m ON m.id = tl.milestone_id
    WHERE tl.project_id = '${asrsId}' AND tl.task_list_type = 'custom'
    ORDER BY m.position, tl.position;
  `);
  assert(asrsTaskLists.length === 4, `Test 2: ASRS project has exactly 4 Custom Task Lists after stray cleanup (got ${asrsTaskLists.length})`);

  const strayCheck = asrsTaskLists.find(tl => tl.name === 'Test');
  assert(!strayCheck, 'Test 3: Stray "Test" task list is confirmed removed');

  const deLists = asrsTaskLists.filter(tl => tl.milestone_name === 'Design & Engineering');
  assert(deLists.length === 2, `Test 4: Milestone "Design & Engineering" has exactly 2 Custom Task Lists (${deLists.map(tl => tl.name).join(', ')})`);

  const pvLists = asrsTaskLists.filter(tl => tl.milestone_name === 'Prototype & Validation');
  assert(pvLists.length === 2, `Test 5: Milestone "Prototype & Validation" has exactly 2 Custom Task Lists (${pvLists.map(tl => tl.name).join(', ')})`);

  console.log('\n=== GROUP 2: ALL 3 PROJECTS HIERARCHY & TASK LISTS ===');

  const { rows: allProjects } = await pgClient.query(`
    SELECT p.id, p.name,
      (SELECT count(*) FROM public.milestones m WHERE m.project_id = p.id) as milestone_count,
      (SELECT count(*) FROM public.task_lists tl WHERE tl.project_id = p.id AND tl.task_list_type = 'custom') as task_list_count,
      (SELECT count(*) FROM public.tasks t WHERE t.project_id = p.id AND t.process_step_id IS NULL) as task_count
    FROM public.projects p
    WHERE p.workspace_id = '${wsId}'
    ORDER BY p.name;
  `);

  assert(allProjects.length === 3, `Test 6: Exactly 3 Projects in target workspace (got ${allProjects.length})`);

  for (const p of allProjects) {
    assert(
      Number(p.milestone_count) === 2 && Number(p.task_list_count) === 4 && Number(p.task_count) === 8,
      `Test 7: Project "${p.name}" has 2 Milestones, 4 Custom Task Lists, and 8 Custom Tasks`
    );
  }

  console.log('\n=== GROUP 3: CLIENT QUERY LOGIC SIMULATION (useTaskLists) ===');

  // Simulate useTaskLists step 1 query: select(*) from task_lists where project_id = ... and task_list_type = 'custom'
  const { rows: clientQuerySimulation } = await pgClient.query(`
    SELECT * FROM public.task_lists
    WHERE project_id = '${asrsId}' AND task_list_type = 'custom'
    ORDER BY position ASC, created_at ASC;
  `);
  assert(clientQuerySimulation.length === 4, `Test 8: useTaskLists step 1 query returns 4 custom task lists for ASRS`);

  // Simulate step 2 query for custom task stats
  const { rows: taskStatsSimulation } = await pgClient.query(`
    SELECT t.id, t.task_list_id, ts.system_code
    FROM public.tasks t
    JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE t.project_id = '${asrsId}' AND t.task_list_id IS NOT NULL AND t.process_step_id IS NULL;
  `);
  assert(taskStatsSimulation.length === 8, `Test 9: useTaskLists step 2 query returns 8 custom tasks with status system_code`);

  // Calculate task counts per task list
  const statsByList = new Map();
  for (const t of taskStatsSimulation) {
    if (!statsByList.has(t.task_list_id)) statsByList.set(t.task_list_id, { total: 0, completed: 0 });
    const s = statsByList.get(t.task_list_id);
    s.total++;
    if (t.system_code === 'done') s.completed++;
  }

  const enriched = clientQuerySimulation.map(tl => {
    const s = statsByList.get(tl.id) || { total: 0, completed: 0 };
    return {
      ...tl,
      task_count: s.total,
      completed_count: s.completed,
      progress: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
    };
  });

  const mechList = enriched.find(tl => tl.name === 'Mechanical Design');
  assert(mechList && mechList.task_count === 2 && mechList.completed_count === 1 && mechList.progress === 50,
    `Test 10: Mechanical Design progress computed accurately (1/2 done = 50%)`);

  const elecList = enriched.find(tl => tl.name === 'Electrical & Controls');
  assert(elecList && elecList.task_count === 2 && elecList.completed_count === 0 && elecList.progress === 0,
    `Test 11: Electrical & Controls progress computed accurately (0/2 done = 0%)`);

  console.log('\n=== GROUP 4: DYNAMIC TASK LIST CREATION & DELETION LIFECYCLE ===');

  // Create temporary task list under Design & Engineering
  const deMilestone = asrsTaskLists.find(tl => tl.milestone_name === 'Design & Engineering');
  const { rows: tempTl } = await pgClient.query(`
    INSERT INTO public.task_lists (project_id, milestone_id, name, description, position)
    VALUES ('${asrsId}', '${deMilestone.milestone_id}', 'Temporary Verification List', 'Created for automated lifecycle test', 99)
    RETURNING id;
  `);
  assert(tempTl.length === 1, 'Test 12: Successfully created temporary Task List');

  // Verify custom task list count increments to 5
  const { rows: countAfterInsert } = await pgClient.query(`SELECT count(*)::int as c FROM public.task_lists WHERE project_id = '${asrsId}' AND task_list_type = 'custom';`);
  assert(countAfterInsert[0].c === 5, `Test 13: Custom Task List count reactively reflects new task list (5 lists)`);

  // Delete temporary task list
  await pgClient.query(`DELETE FROM public.task_lists WHERE id = '${tempTl[0].id}';`);
  const { rows: countAfterDelete } = await pgClient.query(`SELECT count(*)::int as c FROM public.task_lists WHERE project_id = '${asrsId}' AND task_list_type = 'custom';`);
  assert(countAfterDelete[0].c === 4, `Test 14: Custom Task List count returns to exactly 4 after deletion`);

  console.log('\n=== GROUP 5: RLS & SECURITY PRESERVATION ===');

  const { rows: rlsCheck } = await pgClient.query(`
    SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'task_lists';
  `);
  assert(rlsCheck[0]?.rowsecurity === true, 'Test 15: Row-Level Security (RLS) is strictly enabled on task_lists');

  await pgClient.end();

  console.log('\n===============================================================');
  console.log(`Hotfix Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
