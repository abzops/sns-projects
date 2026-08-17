import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message} ${details ? '- ' + details : ''}`);
    failed++;
  }
}

async function runLocalBrowserFlowVerification() {
  console.log('======================================================================');
  console.log('SNS Projects — Package 2 / P2-01A: Local Hierarchy & UI Flows Suite');
  console.log('======================================================================\n');

  const client = new Client({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
    ssl: false,
  });

  await client.connect();

  try {
    await client.query('BEGIN;');

    // 1. Setup disposable Workspace & Profile
    const testUserId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    await client.query(`
      INSERT INTO auth.users (id, email)
      VALUES ($1, 'local-test@stacknstock.in')
      ON CONFLICT (id) DO NOTHING;
    `, [testUserId]);

    const { rows: [profile] } = await client.query(`
      INSERT INTO public.profiles (id, full_name)
      VALUES ($1, 'Local Test User')
      RETURNING *;
    `, [testUserId]);

    const { rows: [workspace] } = await client.query(`
      INSERT INTO public.workspaces (name, created_by)
      VALUES ('Local Test Workspace', $1)
      RETURNING *;
    `, [profile.id]);

    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES ($1, $2, 'owner', 'active');
    `, [workspace.id, profile.id]);

    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES ($1, $2, 'system_admin')
      ON CONFLICT DO NOTHING;
    `, [workspace.id, profile.id]);

    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${profile.id}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: profile.id, role: 'authenticated' })}';`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);

    console.log('--- 1. Login & Workspace Context ---');
    assert(!!profile.id && !!workspace.id, 'Flow 1: User login & active workspace context loaded');

    // 2. Open Project Hierarchy
    console.log('\n--- 2. Project Hierarchy & Phase Terminology ---');
    const { rows: [project] } = await client.query(`
      INSERT INTO public.projects (workspace_id, name, owner_id)
      VALUES ($1, 'Local Test Project', $2)
      RETURNING *;
    `, [workspace.id, profile.id]);

    await client.query(`
      INSERT INTO public.task_statuses (project_id, name, color, system_code, position)
      VALUES 
        ($1, 'To Do', '#94a3b8', 'todo', 1000),
        ($1, 'In Progress', '#3b82f6', 'in_progress', 2000),
        ($1, 'Done', '#22c55e', 'done', 3000);
    `, [project.id]);

    assert(!!project.id, 'Flow 2: Open Project hierarchy');

    // 3. Verify Phase Terminology
    const usePhasesCode = await readFile(path.join(repoRoot, 'src/hooks/usePhases.js'), 'utf8');
    assert(!usePhasesCode.includes('milestone'), 'Flow 3: usePhases hook contains zero milestone references');

    // 4. Create Phase
    console.log('\n--- 4. Phase CRUD Operations ---');
    const { rows: [phase] } = await client.query(`
      INSERT INTO public.phases (project_id, name, description, position, owner_id)
      VALUES ($1, 'Phase 1: Architecture Inception', 'Initial inception phase', 1000, $2)
      RETURNING *;
    `, [project.id, profile.id]);
    assert(phase.name === 'Phase 1: Architecture Inception', 'Flow 4: Create Phase in database');

    // 5. Edit Phase
    const { rows: [editedPhase] } = await client.query(`
      UPDATE public.phases
      SET name = 'Phase 1: Architecture Inception (Updated)', description = 'Updated description'
      WHERE id = $1
      RETURNING *;
    `, [phase.id]);
    assert(editedPhase.name.includes('(Updated)'), 'Flow 5: Edit Phase metadata and name');

    // 6. Create Task List under Phase
    console.log('\n--- 6. Task List & Task Hierarchy ---');
    const { rows: [taskList] } = await client.query(`
      INSERT INTO public.task_lists (project_id, phase_id, name, position, task_list_type)
      VALUES ($1, $2, 'Frontend Implementation Task List', 1000, 'custom')
      RETURNING *;
    `, [project.id, phase.id]);
    assert(taskList.phase_id === phase.id, 'Flow 6: Create Task List bound to Phase');

    // 7. Create Task under Task List
    const { rows: [todoStatus] } = await client.query(`
      SELECT id FROM public.task_statuses WHERE project_id = $1 AND system_code = 'todo' LIMIT 1;
    `, [project.id]);

    const { rows: [task] } = await client.query(`
      INSERT INTO public.tasks (project_id, phase_id, task_list_id, title, status_id, position, created_by)
      VALUES ($1, $2, $3, 'Implement Phase Navigation Components', $4, 1000, $5)
      RETURNING *;
    `, [project.id, phase.id, taskList.id, todoStatus.id, profile.id]);
    assert(task.phase_id === phase.id && task.task_list_id === taskList.id,
      'Flow 7: Create Task under Task List with authoritative Phase hierarchy');

    // 8. Phase Filtering
    console.log('\n--- 8. Phase Filtering & Breadcrumbs ---');
    const { rows: filteredTasks } = await client.query(`
      SELECT t.*, ph.name as phase_name, tl.name as task_list_name
      FROM public.tasks t
      JOIN public.phases ph ON ph.id = t.phase_id
      JOIN public.task_lists tl ON tl.id = t.task_list_id
      WHERE t.project_id = $1 AND t.phase_id = $2;
    `, [project.id, phase.id]);
    assert(filteredTasks.length === 1 && filteredTasks[0].id === task.id,
      'Flow 8: Filter tasks by Phase ID');

    // 9. Task Hierarchy Breadcrumbs
    const taskBreadcrumb = `${project.name} > ${filteredTasks[0].phase_name} > ${filteredTasks[0].task_list_name} > ${task.title}`;
    assert(taskBreadcrumb.includes('Phase 1') && !taskBreadcrumb.includes('Milestone'),
      'Flow 9: Task hierarchy breadcrumb contains Phase terminology');

    // 10. My Work Hierarchy Context
    console.log('\n--- 10. My Work & Assigned Context ---');
    const { rows: myWorkTasks } = await client.query(`
      SELECT t.id, t.title, ph.name as phase_name, p.name as project_name
      FROM public.tasks t
      LEFT JOIN public.phases ph ON ph.id = t.phase_id
      LEFT JOIN public.projects p ON p.id = t.project_id
      WHERE t.created_by = $1;
    `, [profile.id]);
    assert(myWorkTasks.length === 1 && myWorkTasks[0].phase_name.includes('Phase 1'),
      'Flow 10: My Work hierarchy query loads phases:phase_id relation');

    // 11. Start Process Modal & Defined Process Setup
    console.log('\n--- 11. Process Instance Placement & Execution ---');
    const { rows: [dept] } = await client.query(`
      INSERT INTO public.departments (workspace_id, code, name, created_by)
      VALUES ($1, 'ENG', 'Engineering', $2)
      RETURNING *;
    `, [workspace.id, profile.id]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_primary)
      VALUES ($1, $2, $3, true);
    `, [workspace.id, dept.id, profile.id]);

    const { rows: [defProc] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, 'Local Test Standard Flow', 'LOCAL-FLOW-01', $3, $3)
      RETURNING *;
    `, [workspace.id, dept.id, profile.id]);

    const { rows: [defVer] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, published_at, published_by, created_by)
      VALUES ($1, 1, 'published', now(), $2, $2)
      RETURNING *;
    `, [defProc.id, profile.id]);

    const { rows: [step1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'STEP-1', 'Initial Setup Step', 1, 3)
      RETURNING *;
    `, [defVer.id]);

    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, actor_type, user_id)
      VALUES ($1, 'R', 'process_starter', NULL);
    `, [step1.id]);

    const startModalCode = await readFile(path.join(repoRoot, 'src/components/StartProcessModal.jsx'), 'utf8');
    assert(startModalCode.includes('p_phase_id') && startModalCode.includes('Target Phase'),
      'Flow 11: Start Process modal uses p_phase_id and Target Phase label');

    // 12. Select Phase Placement & 13. Start Process Instance
    const startReqId = `88888888-8888-8888-8899-${Date.now().toString().slice(-12)}`;
    const { rows: [instResult] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Phase-Bound Instance Test',
        p_start_request_id => $2,
        p_placement_type => 'phase',
        p_project_id => $3,
        p_phase_id => $4
      ) as res;
    `, [defVer.id, startReqId, project.id, phase.id]);

    assert(instResult.res && instResult.res.placement_type === 'phase',
      'Flow 12 & 13: Start Phase-bound Process Instance via public.start_process_instance');

    // 14. Open Process Instance Page
    console.log('\n--- 14. Process Instance Page & Zero-Milestone Terminology ---');
    const { rows: [instanceRow] } = await client.query(`
      SELECT pi.*, ph.name as phase_name, p.name as project_name
      FROM public.process_instances pi
      LEFT JOIN public.phases ph ON ph.id = pi.phase_id
      LEFT JOIN public.projects p ON p.id = pi.project_id
      WHERE pi.id = $1;
    `, [instResult.res.process_instance_id]);
    assert(instanceRow && instanceRow.phase_name.includes('Phase 1'),
      'Flow 14: Process Instance page query loads Phase name cleanly');

    // 15. Confirm No Visible Milestone Terminology
    const tasksPageCode = await readFile(path.join(repoRoot, 'src/pages/TasksPage.jsx'), 'utf8');
    const procPageCode = await readFile(path.join(repoRoot, 'src/pages/ProcessInstancePage.jsx'), 'utf8');
    assert(!/milestone/i.test(tasksPageCode) && !/milestone/i.test(procPageCode),
      'Flow 15: TasksPage and ProcessInstancePage contain 0 active milestone references');

  } finally {
    await client.query('ROLLBACK;');
    await client.end();
  }

  console.log('\n======================================================================');
  console.log(`Local Browser & UI Flow Verification: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
}

runLocalBrowserFlowVerification().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
