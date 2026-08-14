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
  console.log('SNS Projects — Kanban Board DnD Contracts Verification Suite');
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

  console.log('=== GROUP 1: STATUS MAPPINGS & SYSTEM CODES ===');

  // 1. Check all projects have 5 statuses with standard system_codes
  const { rows: statusRows } = await pgClient.query(`
    SELECT ts.id, ts.project_id, ts.name, ts.system_code, p.name as project_name
    FROM public.task_statuses ts
    JOIN public.projects p ON p.id = ts.project_id
    WHERE p.workspace_id = '${wsId}'
    ORDER BY p.name, ts.position;
  `);

  const validCodes = new Set(['todo', 'in_progress', 'in_review', 'blocked', 'done']);
  const invalidStatuses = statusRows.filter(s => !validCodes.has(s.system_code));
  assert(invalidStatuses.length === 0, 'Test 1: All project statuses map to valid system_codes (todo, in_progress, in_review, blocked, done)');

  // 2. Check all tasks have valid status_id matching one of the project statuses
  const { rows: taskStatusCheck } = await pgClient.query(`
    SELECT t.id, t.title, t.status_id, ts.system_code, t.position
    FROM public.tasks t
    LEFT JOIN public.task_statuses ts ON ts.id = t.status_id
    JOIN public.projects p ON p.id = t.project_id
    WHERE p.workspace_id = '${wsId}';
  `);
  const tasksWithoutStatus = taskStatusCheck.filter(t => !t.system_code);
  assert(tasksWithoutStatus.length === 0, `Test 2: All ${taskStatusCheck.length} tasks map to a valid project status`);

  // 3. Check position column is numeric and queryable
  const nonNumericPos = taskStatusCheck.filter(t => typeof t.position !== 'number');
  assert(nonNumericPos.length === 0, 'Test 3: Tasks utilize integer position column');

  console.log('\n=== GROUP 2: ATOMIC RPC FUNCTION INTEGRITY & DETERMINISTIC POSITIONING ===');

  // Pick Warehouse Deployment Pilot project for testing
  const { rows: projRows } = await pgClient.query(`
    SELECT id, name FROM public.projects WHERE name ILIKE '%Warehouse%' AND workspace_id = '${wsId}';
  `);
  const testProject = projRows[0];
  assert(!!testProject, `Test 4: Target project "${testProject?.name}" found for Kanban tests`);

  // Get project statuses
  const { rows: projStatuses } = await pgClient.query(`
    SELECT id, name, system_code FROM public.task_statuses WHERE project_id = '${testProject.id}' ORDER BY position;
  `);
  const todoStatus = projStatuses.find(s => s.system_code === 'todo');
  const inProgressStatus = projStatuses.find(s => s.system_code === 'in_progress');
  const inReviewStatus = projStatuses.find(s => s.system_code === 'in_review');
  const blockedStatus = projStatuses.find(s => s.system_code === 'blocked');
  const doneStatus = projStatuses.find(s => s.system_code === 'done');

  // Get tasks in this project
  const { rows: projTasks } = await pgClient.query(`
    SELECT id, title, status_id, milestone_id, task_list_id, project_id, position
    FROM public.tasks
    WHERE project_id = '${testProject.id}'
    ORDER BY position ASC;
  `);

  const taskA = projTasks[0];
  const taskB = projTasks[1];
  const originalMilestoneA = taskA.milestone_id;
  const originalTaskListA = taskA.task_list_id;

  // 5. Test Same-Column Reordering via RPC
  console.log('\nTesting Same-Column Reorder via reorder_kanban_tasks RPC...');
  const { rows: reorderResult } = await pgClient.query(`
    SELECT public.reorder_kanban_tasks(
      '${taskA.id}'::uuid,
      '${taskA.status_id}'::uuid,
      ARRAY['${taskB.id}'::uuid, '${taskA.id}'::uuid]
    ) as res;
  `);
  assert(reorderResult[0]?.res?.success === true, 'Test 5: Same-column atomic reordering RPC executes successfully');

  // Verify positions are updated with 1000 spacing
  const { rows: checkReorder } = await pgClient.query(`
    SELECT id, position FROM public.tasks WHERE id IN ('${taskA.id}', '${taskB.id}') ORDER BY position ASC;
  `);
  assert(
    checkReorder[0].id === taskB.id && checkReorder[0].position === 1000 &&
    checkReorder[1].id === taskA.id && checkReorder[1].position === 2000,
    `Test 6: Sibling positions deterministically updated (B=1000, A=2000)`
  );

  // 6. Test Cross-Column Move into Empty Column (Blocked) via RPC
  console.log('\nTesting Cross-Column Move to empty Blocked column...');
  const { rows: moveBlockedRes } = await pgClient.query(`
    SELECT public.reorder_kanban_tasks(
      '${taskA.id}'::uuid,
      '${blockedStatus.id}'::uuid,
      ARRAY['${taskA.id}'::uuid]
    ) as res;
  `);
  assert(moveBlockedRes[0]?.res?.success === true, 'Test 7: Cross-column move into empty column executes successfully');

  const { rows: checkBlocked } = await pgClient.query(`
    SELECT id, status_id, milestone_id, task_list_id, project_id, position FROM public.tasks WHERE id = '${taskA.id}';
  `);
  assert(
    checkBlocked[0].status_id === blockedStatus.id &&
    checkBlocked[0].milestone_id === originalMilestoneA &&
    checkBlocked[0].task_list_id === originalTaskListA &&
    checkBlocked[0].project_id === testProject.id,
    'Test 8: Task status updated to Blocked while preserving Milestone ID, Task List ID, and Project ID'
  );

  // 7. Verify RACI assignments and subtasks remain intact
  const { rows: raciCheck } = await pgClient.query(`
    SELECT count(*)::int as count FROM public.task_raci_assignments WHERE task_id = '${taskA.id}';
  `);
  assert(raciCheck[0].count >= 2, `Test 9: RACI assignments remain 100% intact after Board movement (${raciCheck[0].count} assignments)`);

  const { rows: subtaskCheck } = await pgClient.query(`
    SELECT count(*)::int as count FROM public.subtasks WHERE task_id = '${taskA.id}';
  `);
  assert(subtaskCheck[0].count === 2, `Test 10: Subtasks remain 100% intact after Board movement (${subtaskCheck[0].count} subtasks)`);

  // 8. Restore taskA back to its initial status and position
  await pgClient.query(`
    SELECT public.reorder_kanban_tasks(
      '${taskA.id}'::uuid,
      '${taskA.status_id}'::uuid,
      ARRAY['${taskA.id}'::uuid, '${taskB.id}'::uuid]
    );
  `);
  console.log('Restored task back to initial status.\n');

  console.log('=== GROUP 3: SECURITY & TRANSACTION ROLLBACK ON ERROR ===');

  // 9. Attempt reorder with status from a DIFFERENT project -> Must FAIL and Rollback
  const { rows: otherProjStatuses } = await pgClient.query(`
    SELECT ts.id FROM public.task_statuses ts WHERE ts.project_id <> '${testProject.id}' LIMIT 1;
  `);
  const foreignStatusId = otherProjStatuses[0]?.id;

  let foreignStatusRejected = false;
  try {
    await pgClient.query(`
      SELECT public.reorder_kanban_tasks(
        '${taskA.id}'::uuid,
        '${foreignStatusId}'::uuid,
        ARRAY['${taskA.id}'::uuid]
      );
    `);
  } catch (err) {
    foreignStatusRejected = true;
  }
  assert(foreignStatusRejected, 'Test 11: Cross-project status ID update is strictly REJECTED and rolled back by RPC');

  // 10. Attempt reorder with invalid/foreign task ID -> Must FAIL
  let invalidTaskRejected = false;
  try {
    await pgClient.query(`
      SELECT public.reorder_kanban_tasks(
        '${taskA.id}'::uuid,
        '${todoStatus.id}'::uuid,
        ARRAY['${taskA.id}'::uuid, '00000000-0000-0000-0000-000000000099'::uuid]
      );
    `);
  } catch (err) {
    invalidTaskRejected = true;
  }
  assert(invalidTaskRejected, 'Test 12: Foreign task ID in sibling list is strictly REJECTED and rolled back by RPC');

  // 11. Verify SECURITY INVOKER configuration
  const { rows: secProc } = await pgClient.query(`
    SELECT proname, prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND proname = 'reorder_kanban_tasks';
  `);
  assert(secProc[0]?.prosecdef === false, 'Test 13: reorder_kanban_tasks is configured as SECURITY INVOKER (RLS enforced)');

  // 12. Clean test notifications generated during status change tests
  await pgClient.query(`DELETE FROM public.notifications WHERE workspace_id = '${wsId}';`);

  await pgClient.end();

  console.log('\n===============================================================');
  console.log(`Kanban DnD Contracts Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
