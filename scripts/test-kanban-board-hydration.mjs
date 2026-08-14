import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');

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

// Canonical status resolution helper
function getStatusSystemCode(status) {
  if (!status) return 'todo';
  if (status.system_code) return status.system_code;
  const name = (status.name || '').toLowerCase().trim();
  if (name.includes('progress')) return 'in_progress';
  if (name.includes('review')) return 'in_review';
  if (name.includes('blocked') || name.includes('hold')) return 'blocked';
  if (name.includes('done') || name.includes('complete')) return 'done';
  return 'todo';
}

function buildBoardState(tasks, statuses) {
  const map = {
    todo: [],
    in_progress: [],
    in_review: [],
    blocked: [],
    done: [],
  };

  // Ensure all status codes from project statuses are initialized
  (statuses || []).forEach((s) => {
    const code = getStatusSystemCode(s);
    if (!map[code]) map[code] = [];
  });

  const statusesById = new Map((statuses || []).map((s) => [s.id, s]));

  (tasks || []).forEach((t) => {
    const st = statusesById.get(t.status_id) || t.task_statuses;
    const code = getStatusSystemCode(st);
    if (!map[code]) map[code] = [];
    map[code].push(t);
  });

  Object.keys(map).forEach((code) => {
    map[code].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  });

  return map;
}

async function runTests() {
  console.log('===============================================================');
  console.log('SNS Projects — Kanban Board Hydration Verification Suite');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = '') {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));

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

  console.log('=== GROUP 1: WAREHOUSE DEPLOYMENT PILOT HYDRATION ===');

  // Find Warehouse project
  const { rows: pRows } = await pgClient.query(`
    SELECT id, name FROM public.projects WHERE name ILIKE '%Warehouse%' AND workspace_id = '${wsId}';
  `);
  const warehouseProj = pRows[0];
  assert(!!warehouseProj, `Test 1: Project "${warehouseProj?.name}" found`);

  // Fetch statuses including system_code
  const { rows: liveStatuses } = await pgClient.query(`
    SELECT id, project_id, name, color, position, system_code, created_at
    FROM public.task_statuses
    WHERE project_id = '${warehouseProj.id}'
    ORDER BY position ASC;
  `);
  assert(liveStatuses.length === 5, `Test 2: Exactly 5 statuses fetched (got ${liveStatuses.length})`);

  // Fetch tasks
  const { rows: liveTasks } = await pgClient.query(`
    SELECT t.id, t.title, t.status_id, t.position, t.project_id, t.milestone_id, t.task_list_id
    FROM public.tasks t
    WHERE t.project_id = '${warehouseProj.id}'
    ORDER BY t.position ASC;
  `);
  assert(liveTasks.length === 8, `Test 3: Exactly 8 tasks fetched for Warehouse Deployment Pilot (got ${liveTasks.length})`);

  // Build Board state using canonical hydration engine
  const board = buildBoardState(liveTasks, liveStatuses);

  assert(board.todo.length === 3, `Test 4: To Do column has exactly 3 tasks (got ${board.todo.length})`);
  assert(board.in_progress.length === 0, `Test 5: In Progress column has exactly 0 tasks (got ${board.in_progress.length})`);
  assert(board.in_review.length === 2, `Test 6: In Review column has exactly 2 tasks (got ${board.in_review.length})`);
  assert(board.blocked.length === 0, `Test 7: Blocked column has exactly 0 tasks (got ${board.blocked.length})`);
  assert(board.done.length === 3, `Test 8: Done column has exactly 3 tasks (got ${board.done.length})`);

  const allBoardTaskIds = Object.values(board).flat().map(t => t.id);
  assert(allBoardTaskIds.length === 8, `Test 9: Total normalized board tasks equals 8 (got ${allBoardTaskIds.length})`);

  // Check no duplicates or lost tasks
  const uniqueBoardIds = new Set(allBoardTaskIds);
  assert(uniqueBoardIds.size === 8, 'Test 10: No duplicate tasks in Board state');

  const rawTaskIds = new Set(liveTasks.map(t => t.id));
  const difference = allBoardTaskIds.filter(id => !rawTaskIds.has(id));
  assert(difference.length === 0, 'Test 11: Board task IDs match fetched task IDs 1-to-1 with zero lost tasks');

  console.log('\n=== GROUP 2: ALL 3 PROJECTS HYDRATION CONSISTENCY ===');

  const { rows: allProjs } = await pgClient.query(`
    SELECT id, name FROM public.projects WHERE workspace_id = '${wsId}' ORDER BY name;
  `);

  for (const p of allProjs) {
    const { rows: pStatuses } = await pgClient.query(`
      SELECT id, name, system_code FROM public.task_statuses WHERE project_id = '${p.id}' ORDER BY position;
    `);
    const { rows: pTasks } = await pgClient.query(`
      SELECT id, title, status_id, position FROM public.tasks WHERE project_id = '${p.id}';
    `);

    const pBoard = buildBoardState(pTasks, pStatuses);
    const pTotal = Object.values(pBoard).flat().length;
    assert(pTotal === pTasks.length, `Test 12: Project "${p.name}" hydrated ${pTotal}/${pTasks.length} tasks across 5 columns with zero lost`);
  }

  console.log('\n=== GROUP 3: SNAPSHOT & RECOVERY INTEGRITY ===');

  // Test snapshot clone
  const snapshot = JSON.parse(JSON.stringify(board));
  assert(Object.values(snapshot).flat().length === 8, 'Test 13: Board snapshot creates exact deep copy for drag cancel/rollback');

  await pgClient.end();

  console.log('\n===============================================================');
  console.log(`Kanban Board Hydration Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
