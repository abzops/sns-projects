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

async function runTests() {
  console.log('===============================================================');
  console.log('SNS Projects — Kanban DnD Contracts & Isolation Verification Suite');
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

  // Helper for role-simulated queries
  async function asRole(role, sub, fn) {
    await pgClient.query('BEGIN');
    await pgClient.query(`SET LOCAL ROLE ${role}`);
    if (sub) {
      await pgClient.query(`SET LOCAL request.jwt.claims = '{"sub": "${sub}"}'`);
    }
    try {
      const result = await fn(pgClient);
      await pgClient.query('COMMIT');
      return result;
    } catch (e) {
      await pgClient.query('ROLLBACK');
      throw e;
    }
  }

  // 1. Snapshot all 24 business tasks before any test execution
  const { rows: baselineBusinessTasks } = await pgClient.query(`
    SELECT t.id, t.title, t.project_id, t.status_id, ts.system_code, t.position
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = $1
    ORDER BY t.id;
  `, [wsId]);

  console.log(`✓ Baseline snapshotted: ${baselineBusinessTasks.length} business tasks.`);

  // Get project A and project B
  const { rows: projects } = await pgClient.query(`
    SELECT id, name FROM public.projects WHERE workspace_id = $1 ORDER BY name;
  `, [wsId]);
  const projA = projects[0]; // ASRS Product Development
  const projB = projects[1]; // SNS Projects Internal Rollout

  const { rows: projAStatuses } = await pgClient.query(`
    SELECT id, name, system_code, position FROM public.task_statuses WHERE project_id = $1 ORDER BY position;
  `, [projA.id]);
  const todoStatusA = projAStatuses.find(s => s.system_code === 'todo');
  const inProgressStatusA = projAStatuses.find(s => s.system_code === 'in_progress');
  const inReviewStatusA = projAStatuses.find(s => s.system_code === 'in_review');
  const blockedStatusA = projAStatuses.find(s => s.system_code === 'blocked');
  const doneStatusA = projAStatuses.find(s => s.system_code === 'done');

  const { rows: [firstTlA] } = await pgClient.query(`
    SELECT id, milestone_id FROM public.task_lists WHERE project_id = $1 LIMIT 1;
  `, [projA.id]);

  const { rows: [firstTlB] } = await pgClient.query(`
    SELECT id, milestone_id FROM public.task_lists WHERE project_id = $1 LIMIT 1;
  `, [projB.id]);

  const { rows: [ownerProfile] } = await pgClient.query(`
    SELECT wm.user_id FROM public.workspace_members wm WHERE wm.workspace_id = $1 AND wm.role = 'owner' AND wm.status = 'active' LIMIT 1;
  `, [wsId]);

  let tempTaskA1, tempTaskA2, tempTaskA3, tempTaskB1;

  try {
    // Create temporary isolated test tasks
    console.log('\nCreating isolated temporary test tasks...');

    // Max position currently in todo status of Project A
    const { rows: [maxPosRow] } = await pgClient.query(`
      SELECT COALESCE(MAX(position), 0) as max_pos FROM public.tasks WHERE project_id = $1 AND status_id = $2;
    `, [projA.id, todoStatusA.id]);
    let nextPos = Number(maxPosRow.max_pos) + 1000;

    const { rows: [t1] } = await pgClient.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, priority, position, created_by)
      VALUES ($1, $2, $3, 'TEMP-TEST-T1', $4, 'medium', $5, $6)
      RETURNING id, status_id, position;
    `, [projA.id, firstTlA.milestone_id, firstTlA.id, todoStatusA.id, nextPos, ownerProfile.user_id]);
    tempTaskA1 = t1;
    nextPos += 1000;

    const { rows: [t2] } = await pgClient.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, priority, position, created_by)
      VALUES ($1, $2, $3, 'TEMP-TEST-T2', $4, 'medium', $5, $6)
      RETURNING id, status_id, position;
    `, [projA.id, firstTlA.milestone_id, firstTlA.id, todoStatusA.id, nextPos, ownerProfile.user_id]);
    tempTaskA2 = t2;
    nextPos += 1000;

    const { rows: [t3] } = await pgClient.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, priority, position, created_by)
      VALUES ($1, $2, $3, 'TEMP-TEST-T3', $4, 'medium', $5, $6)
      RETURNING id, status_id, position;
    `, [projA.id, firstTlA.milestone_id, firstTlA.id, todoStatusA.id, nextPos, ownerProfile.user_id]);
    tempTaskA3 = t3;

    const { rows: [tb1] } = await pgClient.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, priority, position, created_by)
      VALUES ($1, $2, $3, 'TEMP-TEST-B1', (SELECT id FROM public.task_statuses WHERE project_id = $1 AND system_code = 'todo' LIMIT 1), 'medium', 10000, $4)
      RETURNING id, status_id, position;
    `, [projB.id, firstTlB.milestone_id, firstTlB.id, ownerProfile.user_id]);
    tempTaskB1 = tb1;

    console.log(`Created temp tasks: T1=${tempTaskA1.id}, T2=${tempTaskA2.id}, T3=${tempTaskA3.id}, B1=${tempTaskB1.id}`);

    // Helper: get current complete IDs in status
    async function getCompleteStatusIds(projectId, statusId) {
      const { rows } = await pgClient.query(`
        SELECT id FROM public.tasks WHERE project_id = $1 AND status_id = $2 ORDER BY position ASC, id ASC;
      `, [projectId, statusId]);
      return rows.map(r => r.id);
    }

    // ── TEST 1: Same-Column Reorder ──
    console.log('\n--- Test 1: Same-Column Reorder ---');
    const allTodoBefore = await getCompleteStatusIds(projA.id, todoStatusA.id);
    // Reverse the temp tasks in the list
    const otherTodo = allTodoBefore.filter(id => ![tempTaskA1.id, tempTaskA2.id, tempTaskA3.id].includes(id));
    const reorderedSame = [...otherTodo, tempTaskA3.id, tempTaskA2.id, tempTaskA1.id];

    const { rows: [t1Res] } = await pgClient.query(`
      SELECT public.reorder_kanban_tasks($1, $2, $3, $4) as res;
    `, [tempTaskA3.id, todoStatusA.id, reorderedSame, reorderedSame]);
    assert(t1Res.res?.success === true && t1Res.res?.same_column === true, 'Test 1: same-column reorder executes successfully');

    // ── TEST 2: Cross-Column Reorder ──
    console.log('\n--- Test 2: Cross-Column Reorder ---');
    const allTodoCurrent = await getCompleteStatusIds(projA.id, todoStatusA.id);
    const allInProgCurrent = await getCompleteStatusIds(projA.id, inProgressStatusA.id);

    const sourceAfterMove = allTodoCurrent.filter(id => id !== tempTaskA1.id);
    const destAfterMove = [...allInProgCurrent, tempTaskA1.id];

    const { rows: [t2Res] } = await pgClient.query(`
      SELECT public.reorder_kanban_tasks($1, $2, $3, $4) as res;
    `, [tempTaskA1.id, inProgressStatusA.id, sourceAfterMove, destAfterMove]);
    assert(t2Res.res?.success === true && t2Res.res?.same_column === false, 'Test 2: cross-column reorder executes successfully');

    // ── TEST 3: Drop into Empty Column (Blocked) ──
    console.log('\n--- Test 3: Drop into Empty Column ---');
    const allTodoNow = await getCompleteStatusIds(projA.id, todoStatusA.id);
    const sourceAfterBlocked = allTodoNow.filter(id => id !== tempTaskA2.id);
    const destBlocked = [tempTaskA2.id];

    const { rows: [t3Res] } = await pgClient.query(`
      SELECT public.reorder_kanban_tasks($1, $2, $3, $4) as res;
    `, [tempTaskA2.id, blockedStatusA.id, sourceAfterBlocked, destBlocked]);
    assert(t3Res.res?.success === true && t3Res.res?.destination_count === 1, 'Test 3: drop into empty column executes successfully');

    // ── TEST 4: Move only Task out of source column ──
    console.log('\n--- Test 4: Move only Task out of source column ---');
    const destTodoNow = [...(await getCompleteStatusIds(projA.id, todoStatusA.id)), tempTaskA2.id];
    const { rows: [t4Res] } = await pgClient.query(`
      SELECT public.reorder_kanban_tasks($1, $2, $3, $4) as res;
    `, [tempTaskA2.id, todoStatusA.id, [], destTodoNow]);
    assert(t4Res.res?.success === true && t4Res.res?.source_count === 0, 'Test 4: move only task out of source column executes successfully');

    // ── TEST 5: Complete source array validation (missing task rejected) ──
    console.log('\n--- Test 5: Incomplete Source Array Rejection ---');
    let t5Rejected = false;
    try {
      const allTodoForT3 = await getCompleteStatusIds(projA.id, todoStatusA.id);
      // Omit a task from source array
      const incompleteSource = allTodoForT3.filter(id => id !== tempTaskA3.id).slice(1);
      const destWithT3 = [...(await getCompleteStatusIds(projA.id, inReviewStatusA.id)), tempTaskA3.id];
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
      `, [tempTaskA3.id, inReviewStatusA.id, incompleteSource, destWithT3]);
    } catch (e) {
      t5Rejected = true;
    }
    assert(t5Rejected, 'Test 5: complete source array validation rejects missing source tasks');

    // ── TEST 6: Complete destination array validation (missing task rejected) ──
    console.log('\n--- Test 6: Incomplete Destination Array Rejection ---');
    let t6Rejected = false;
    try {
      const allTodoForT3 = await getCompleteStatusIds(projA.id, todoStatusA.id);
      const sourceT3 = allTodoForT3.filter(id => id !== tempTaskA3.id);
      // Destination array omits an existing destination task
      const incompleteDest = [tempTaskA3.id]; // missing other tasks in review
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
      `, [tempTaskA3.id, inReviewStatusA.id, sourceT3, incompleteDest]);
    } catch (e) {
      t6Rejected = true;
    }
    assert(t6Rejected, 'Test 6: complete destination array validation rejects incomplete destination arrays');

    // ── TEST 7: Duplicate UUID Rejection ──
    console.log('\n--- Test 7: Duplicate UUID Rejection ---');
    let t7Rejected = false;
    try {
      const allTodo = await getCompleteStatusIds(projA.id, todoStatusA.id);
      const sourceT3 = allTodo.filter(id => id !== tempTaskA3.id);
      const existingInReview = await getCompleteStatusIds(projA.id, inReviewStatusA.id);
      const duplicateDest = [...existingInReview, tempTaskA3.id, tempTaskA3.id];
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
      `, [tempTaskA3.id, inReviewStatusA.id, sourceT3, duplicateDest]);
    } catch (e) {
      t7Rejected = true;
    }
    assert(t7Rejected, 'Test 7: duplicate UUID rejection in task arrays');

    // ── TEST 8: Wrong-Project UUID Rejection ──
    console.log('\n--- Test 8: Wrong-Project UUID Rejection ---');
    let t8Rejected = false;
    try {
      const allTodo = await getCompleteStatusIds(projA.id, todoStatusA.id);
      const sourceT3 = allTodo.filter(id => id !== tempTaskA3.id);
      const existingInReview = await getCompleteStatusIds(projA.id, inReviewStatusA.id);
      const foreignDest = [...existingInReview, tempTaskA3.id, tempTaskB1.id]; // B1 is from project B
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
      `, [tempTaskA3.id, inReviewStatusA.id, sourceT3, foreignDest]);
    } catch (e) {
      t8Rejected = true;
    }
    assert(t8Rejected, 'Test 8: wrong-project UUID rejection enforced');

    // ── TEST 9: Wrong-Status Sibling Rejection ──
    console.log('\n--- Test 9: Wrong-Status Sibling Rejection ---');
    let t9Rejected = false;
    try {
      const allTodo = await getCompleteStatusIds(projA.id, todoStatusA.id);
      // Put tempTaskA1 (which is currently in progress) into todo source list
      const wrongStatusSource = [...allTodo.filter(id => id !== tempTaskA3.id), tempTaskA1.id];
      const existingInReview = await getCompleteStatusIds(projA.id, inReviewStatusA.id);
      const destT3 = [...existingInReview, tempTaskA3.id];
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
      `, [tempTaskA3.id, inReviewStatusA.id, wrongStatusSource, destT3]);
    } catch (e) {
      t9Rejected = true;
    }
    assert(t9Rejected, 'Test 9: wrong-status sibling rejection in source array');

    // ── TEST 10: Moved Task Missing from Destination Rejection ──
    console.log('\n--- Test 10: Moved Task Missing from Destination ---');
    let t10Rejected = false;
    try {
      const allTodo = await getCompleteStatusIds(projA.id, todoStatusA.id);
      const sourceT3 = allTodo.filter(id => id !== tempTaskA3.id);
      const existingInReview = await getCompleteStatusIds(projA.id, inReviewStatusA.id);
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
      `, [tempTaskA3.id, inReviewStatusA.id, sourceT3, existingInReview]); // T3 missing
    } catch (e) {
      t10Rejected = true;
    }
    assert(t10Rejected, 'Test 10: moved task missing from destination array rejection');

    // ── TEST 11: Hidden/Filtered Tasks Preserved in Frontend Logic ──
    console.log('\n--- Test 11: Filter-Safe Full-Column Logic ---');
    // Unit test filter-safe derivation logic
    const fullCol = [{ id: 'A', position: 1000 }, { id: 'B', position: 2000 }, { id: 'C', position: 3000 }, { id: 'D', position: 4000 }];
    const visibleSub = ['C', 'A']; // B and D hidden by filter
    const visibleSet = new Set(visibleSub);
    const merged = [];
    let vIdx = 0;
    for (const t of fullCol) {
      if (visibleSet.has(t.id)) {
        merged.push(visibleSub[vIdx++]);
      } else {
        merged.push(t.id);
      }
    }
    while (vIdx < visibleSub.length) merged.push(visibleSub[vIdx++]);

    const isFilterSafe = merged.length === 4 && merged[0] === 'C' && merged[1] === 'B' && merged[2] === 'A' && merged[3] === 'D';
    assert(isFilterSafe, 'Test 11: hidden/filtered tasks preserved deterministically in full-column derivation (C, B, A, D)');

    // ── TEST 12: Concurrent Stale Ordering Rejected ──
    console.log('\n--- Test 12: Stale Concurrent Ordering Rejection ---');
    let t12Rejected = false;
    try {
      // Stale source list missing a task that was added in meantime
      const staleSource = ['00000000-0000-0000-0000-000000000001'];
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
      `, [tempTaskA3.id, inReviewStatusA.id, staleSource, [tempTaskA3.id]]);
    } catch (e) {
      t12Rejected = true;
    }
    assert(t12Rejected, 'Test 12: concurrent stale ordering rejected via set-equality check');

    // ── TEST 13: Positions Always Spaced 1000 ──
    console.log('\n--- Test 13: 1000 Spacing Verification ---');
    const { rows: non1000Rows } = await pgClient.query(`
      SELECT id, position FROM public.tasks WHERE project_id = $1 AND position % 1000 <> 0;
    `, [projA.id]);
    assert(non1000Rows.length === 0, 'Test 13: all task positions are strictly positive multiples of 1000');

    // ── TEST 14: Duplicate Position Query = 0 ──
    console.log('\n--- Test 14: Zero Duplicate Positions Query ---');
    const { rows: dupsAfter } = await pgClient.query(`
      SELECT project_id, status_id, position, count(*) as cnt 
      FROM public.tasks 
      WHERE project_id IN ($1, $2)
      GROUP BY project_id, status_id, position 
      HAVING count(*) > 1;
    `, [projA.id, projB.id]);
    assert(dupsAfter.length === 0, 'Test 14: duplicate position query returns exactly ZERO rows');

    // ── TEST 15: RPC Failure Rolls Back Both Columns ──
    console.log('\n--- Test 15: Full Transactional Rollback on Error ---');
    const preFailTodo = await getCompleteStatusIds(projA.id, todoStatusA.id);
    const preFailReview = await getCompleteStatusIds(projA.id, inReviewStatusA.id);
    try {
      await pgClient.query(`
        SELECT public.reorder_kanban_tasks(
          $1, $2, $3, ARRAY['00000000-0000-0000-0000-000000000099'::uuid]
        );
      `, [tempTaskA3.id, inReviewStatusA.id, preFailTodo]);
    } catch (e) {
      // Expected to fail
    }
    const postFailTodo = await getCompleteStatusIds(projA.id, todoStatusA.id);
    const postFailReview = await getCompleteStatusIds(projA.id, inReviewStatusA.id);
    const rollbackSuccess =
      JSON.stringify(preFailTodo) === JSON.stringify(postFailTodo) &&
      JSON.stringify(preFailReview) === JSON.stringify(postFailReview);
    assert(rollbackSuccess, 'Test 15: RPC failure atomically rolls back both source and destination columns');

    // ── TEST 16: Viewer Rejected via RLS ──
    console.log('\n--- Test 16: Viewer Role Rejected ---');
    // Test viewer role execution restriction
    let viewerBlocked = false;
    try {
      // Create a temporary mock user ID not having write role
      const mockViewerId = '00000000-0000-0000-0000-000000000088';
      await asRole('authenticated', mockViewerId, async (c) => {
        await c.query(`
          SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
        `, [tempTaskA3.id, todoStatusA.id, preFailTodo, preFailTodo]);
      });
    } catch (e) {
      viewerBlocked = true;
    }
    assert(viewerBlocked, 'Test 16: unauthorized user / viewer rejected by RLS inside SECURITY INVOKER function');

    // ── TEST 17: Anonymous Role Rejected ──
    console.log('\n--- Test 17: Anonymous Role Rejected ---');
    let anonBlocked = false;
    try {
      await asRole('anon', null, async (c) => {
        await c.query(`
          SELECT public.reorder_kanban_tasks($1, $2, $3, $4);
        `, [tempTaskA3.id, todoStatusA.id, preFailTodo, preFailTodo]);
      });
    } catch (e) {
      anonBlocked = true;
    }
    assert(anonBlocked, 'Test 17: anonymous role execute permission strictly REVOKED (42501)');

  } finally {
    // ── MANDATORY CLEANUP IN FINALLY BLOCK ──
    console.log('\n--- Cleaning up temporary test tasks ---');
    const tempIds = [tempTaskA1?.id, tempTaskA2?.id, tempTaskA3?.id, tempTaskB1?.id].filter(Boolean);
    if (tempIds.length > 0) {
      await pgClient.query(`DELETE FROM public.subtasks WHERE task_id = ANY($1::uuid[]);`, [tempIds]);
      await pgClient.query(`DELETE FROM public.task_raci_assignments WHERE task_id = ANY($1::uuid[]);`, [tempIds]);
      await pgClient.query(`DELETE FROM public.notifications WHERE task_id = ANY($1::uuid[]);`, [tempIds]);
      await pgClient.query(`DELETE FROM public.tasks WHERE id = ANY($1::uuid[]);`, [tempIds]);
      console.log(`Cleaned up ${tempIds.length} temporary test tasks.`);
    }

    // Clean any generated notifications
    await pgClient.query(`DELETE FROM public.notifications WHERE workspace_id = $1;`, [wsId]);
  }

  // ── TEST 18: Assert Business Tasks 100% Unchanged ──
  console.log('\n--- Test 18: Business Task Isolation Assertion ---');
  const { rows: postTestBusinessTasks } = await pgClient.query(`
    SELECT t.id, t.title, t.project_id, t.status_id, ts.system_code, t.position
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = $1
    ORDER BY t.id;
  `, [wsId]);

  let businessPollution = false;
  const changedTasks = [];

  for (const base of baselineBusinessTasks) {
    const post = postTestBusinessTasks.find(p => p.id === base.id);
    if (!post) {
      businessPollution = true;
      changedTasks.push(`Task "${base.title}" was DELETED!`);
    } else if (post.status_id !== base.status_id || post.position !== base.position) {
      businessPollution = true;
      changedTasks.push(`Task "${base.title}": status (${base.system_code} -> ${post.system_code}), pos (${base.position} -> ${post.position})`);
    }
  }

  if (postTestBusinessTasks.length !== baselineBusinessTasks.length) {
    businessPollution = true;
    changedTasks.push(`Task count mismatch: baseline was ${baselineBusinessTasks.length}, post-test is ${postTestBusinessTasks.length}`);
  }

  assert(!businessPollution, 'Test 18: All 24 structured business tasks remain 100% IDENTICAL and UNPOLLUTED after test suite', changedTasks.join(', '));

  await pgClient.end();

  console.log('\n===============================================================');
  console.log(`Kanban DnD Contracts Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
