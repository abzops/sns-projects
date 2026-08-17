import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

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

async function runP202TestSuite() {
  console.log('======================================================================');
  console.log('SNS Projects — Package 2 / P2-02: Movement, Cancellation & RLS Suite');
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

    const testId = `p202_${Date.now()}`;
    const testUserId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    const starterId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    const ownerId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    const adminId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    const ceoId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    const ctoId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    const memberId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;
    const outsiderId = (await client.query('SELECT gen_random_uuid() as id')).rows[0].id;

    // 1. Create test users in auth.users and profiles
    const users = [
      { id: testUserId, email: `${testId}_test@example.com`, name: 'Test Lead' },
      { id: starterId, email: `${testId}_starter@example.com`, name: 'Starter User' },
      { id: ownerId, email: `${testId}_owner@example.com`, name: 'Owner User' },
      { id: adminId, email: `${testId}_admin@example.com`, name: 'Admin User' },
      { id: ceoId, email: `${testId}_ceo@example.com`, name: 'CEO User' },
      { id: ctoId, email: `${testId}_cto@example.com`, name: 'CTO User' },
      { id: memberId, email: `${testId}_member@example.com`, name: 'Member User' },
      { id: outsiderId, email: `${testId}_outsider@example.com`, name: 'Outsider User' },
    ];

    for (const u of users) {
      await client.query(`
        INSERT INTO auth.users (id, email)
        VALUES ($1, $2)
        ON CONFLICT (id) DO NOTHING;
      `, [u.id, u.email]);

      await client.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
      `, [u.id, u.name]);
    }

    // 2. Setup Primary Workspace & Memberships
    const { rows: [workspace] } = await client.query(`
      INSERT INTO public.workspaces (name, created_by)
      VALUES ('P2-02 Test Workspace', $1)
      RETURNING *;
    `, [testUserId]);

    const { rows: [otherWorkspace] } = await client.query(`
      INSERT INTO public.workspaces (name, created_by)
      VALUES ('Other Workspace', $1)
      RETURNING *;
    `, [outsiderId]);

    // Workspace memberships
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES
        ($1, $2, 'owner', 'active'),
        ($1, $3, 'member', 'active'),
        ($1, $4, 'member', 'active'),
        ($1, $5, 'admin', 'active'),
        ($1, $6, 'member', 'active'),
        ($1, $7, 'member', 'active'),
        ($1, $8, 'member', 'active'),
        ($9, $10, 'owner', 'active');
    `, [workspace.id, testUserId, starterId, ownerId, adminId, ceoId, ctoId, memberId, otherWorkspace.id, outsiderId]);

    // System roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES
        ($1, $2, 'ceo'),
        ($1, $3, 'cto');
    `, [workspace.id, ceoId, ctoId]);

    // Setup working calendar
    await client.query(`
      INSERT INTO public.workspace_working_calendars (
        workspace_id, timezone, created_by, monday_working, tuesday_working, wednesday_working, thursday_working, friday_working
      ) VALUES ($1, 'UTC', $2, true, true, true, true, true)
      ON CONFLICT DO NOTHING;
    `, [workspace.id, testUserId]);

    // 3. Setup Projects, Phases, Task Lists & Tasks
    const { rows: [project1] } = await client.query(`
      INSERT INTO public.projects (workspace_id, name, owner_id, created_by)
      VALUES ($1, 'Project Alpha', $2, $2)
      RETURNING *;
    `, [workspace.id, ownerId]);

    const { rows: [project2] } = await client.query(`
      INSERT INTO public.projects (workspace_id, name, owner_id, created_by)
      VALUES ($1, 'Project Beta (Cross)', $2, $2)
      RETURNING *;
    `, [workspace.id, ownerId]);

    // Task statuses for project 1
    const { rows: [statusTodo] } = await client.query(`
      INSERT INTO public.task_statuses (project_id, name, color, system_code, position)
      VALUES ($1, 'To Do', '#94a3b8', 'todo', 1000)
      RETURNING *;
    `, [project1.id]);

    const { rows: [statusDone] } = await client.query(`
      INSERT INTO public.task_statuses (project_id, name, color, system_code, position)
      VALUES ($1, 'Done', '#22c55e', 'done', 2000)
      RETURNING *;
    `, [project1.id]);

    // Phases
    const { rows: [phase1] } = await client.query(`
      INSERT INTO public.phases (project_id, name, position, owner_id, created_by)
      VALUES ($1, 'Phase 1 - Inception', 1000, $2, $2)
      RETURNING *;
    `, [project1.id, ownerId]);

    const { rows: [phase2Cross] } = await client.query(`
      INSERT INTO public.phases (project_id, name, position, owner_id, created_by)
      VALUES ($1, 'Phase 2 (Cross Project)', 1000, $2, $2)
      RETURNING *;
    `, [project2.id, ownerId]);

    // Task Lists
    const { rows: [taskList1] } = await client.query(`
      INSERT INTO public.task_lists (project_id, phase_id, name, position, owner_id, created_by, task_list_type)
      VALUES ($1, $2, 'Task List Alpha', 1000, $3, $3, 'custom')
      RETURNING *;
    `, [project1.id, phase1.id, ownerId]);

    const { rows: [taskListCross] } = await client.query(`
      INSERT INTO public.task_lists (project_id, phase_id, name, position, owner_id, created_by, task_list_type)
      VALUES ($1, $2, 'Task List Cross', 1000, $3, $3, 'custom')
      RETURNING *;
    `, [project2.id, phase2Cross.id, ownerId]);

    // Host Parent Task
    const { rows: [hostTask1] } = await client.query(`
      INSERT INTO public.tasks (project_id, phase_id, task_list_id, title, status_id, position, created_by, owner_id)
      VALUES ($1, $2, $3, 'Host Container Task 1', $4, 1000, $5, $5)
      RETURNING *;
    `, [project1.id, phase1.id, taskList1.id, statusTodo.id, ownerId]);

    const { rows: [hostTaskCross] } = await client.query(`
      INSERT INTO public.tasks (project_id, phase_id, task_list_id, title, status_id, position, created_by, owner_id)
      VALUES ($1, $2, $3, 'Host Task Cross', $4, 1000, $5, $5)
      RETURNING *;
    `, [project2.id, phase2Cross.id, taskListCross.id, statusTodo.id, ownerId]);

    // 4. Setup Defined Process with 3 steps
    const { rows: [dept] } = await client.query(`
      INSERT INTO public.departments (workspace_id, code, name, created_by)
      VALUES ($1, 'ENG', 'Engineering', $2)
      RETURNING *;
    `, [workspace.id, testUserId]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_primary)
      VALUES ($1, $2, $3, true);
    `, [workspace.id, dept.id, starterId]);

    const { rows: [proc] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, 'Linear 3-Step Process', 'PROC-P202', $3, $3)
      RETURNING *;
    `, [workspace.id, dept.id, ownerId]);

    const { rows: [version] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, published_at, published_by, created_by)
      VALUES ($1, 1, 'published', now(), $2, $2)
      RETURNING *;
    `, [proc.id, ownerId]);

    const { rows: [step1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'S1', 'Step 1: Initiation', 1, 2)
      RETURNING *;
    `, [version.id]);

    const { rows: [step2] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'S2', 'Step 2: Execution', 2, 3)
      RETURNING *;
    `, [version.id]);

    const { rows: [step3] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'S3', 'Step 3: Verification', 3, 2)
      RETURNING *;
    `, [version.id]);

    // Step DAG dependencies (Step 2 depends on Step 1, Step 3 depends on Step 2)
    await client.query(`
      INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
      VALUES
        ($1, $3, $2),
        ($1, $4, $3);
    `, [version.id, step1.id, step2.id, step3.id]);

    // RACI for steps
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, actor_type, user_id)
      VALUES
        ($1, 'R', 'process_starter', NULL),
        ($1, 'A', 'user', $4),
        ($2, 'R', 'user', $5),
        ($2, 'A', 'user', $4),
        ($3, 'R', 'user', $5),
        ($3, 'A', 'user', $4);
    `, [step1.id, step2.id, step3.id, ownerId, starterId]);

    // =======================================================================
    // SUITE 1: MOVEMENT POSITIVE FLOWS & STRUCTURAL INVARIANTS
    // =======================================================================
    console.log('--- Suite 1: Movement Positive Flows & Structural Invariants ---');

    // Authenticate as Starter/Owner
    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${starterId}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: starterId, role: 'authenticated' })}';`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);

    const startReqId1 = `11111111-1111-1111-2222-${Date.now().toString().slice(-12)}`;
    const { rows: [startRes1] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Movable Process Instance 1',
        p_start_request_id => $2::uuid,
        p_placement_type => 'project',
        p_project_id => $3
      ) AS res;
    `, [version.id, startReqId1, project1.id]);

    const inst1 = startRes1.res;
    assert(inst1 && inst1.process_instance_id, 'Test 1: Attached project process instance created');

    // A. Project -> Phase Move
    const { rows: [moveRes1] } = await client.query(`
      SELECT public.move_process_instance(
        p_instance_id => $1,
        p_target_placement_type => 'phase',
        p_target_phase_id => $2,
        p_reason => 'Relocating to Phase 1 for scheduled sprint'
      ) AS res;
    `, [inst1.process_instance_id, phase1.id]);

    assert(moveRes1.res && moveRes1.res.success === true && moveRes1.res.placement_type === 'phase',
      'Test 2: Project -> Phase move succeeded');

    const { rows: [instRowAfterMove1] } = await client.query(`
      SELECT * FROM public.process_instances WHERE id = $1;
    `, [inst1.process_instance_id]);
    assert(instRowAfterMove1.placement_type === 'phase' && instRowAfterMove1.phase_id === phase1.id && instRowAfterMove1.task_list_id === null,
      'Test 3: Process instance placement updated to phase with null task_list_id');

    const { rows: stepTasksAfterMove1 } = await client.query(`
      SELECT id, phase_id, task_list_id, parent_task_id, workflow_state FROM public.tasks WHERE process_instance_id = $1 ORDER BY position;
    `, [inst1.process_instance_id]);
    assert(stepTasksAfterMove1.length === 3 && stepTasksAfterMove1.every(t => t.phase_id === phase1.id && t.task_list_id === null && t.parent_task_id === null),
      'Test 4: All 3 step tasks updated to phase_id with null task_list_id');

    // Verify PROCESS_MOVED audit event
    const { rows: auditMove1 } = await client.query(`
      SELECT * FROM public.process_audit_events
      WHERE process_instance_id = $1 AND event_type = 'PROCESS_MOVED';
    `, [inst1.process_instance_id]);
    assert(auditMove1.length === 1 && auditMove1[0].payload.new_placement.placement_type === 'phase',
      'Test 5: PROCESS_MOVED audit event logged with new placement snapshot');

    // B. Phase -> Task List Move
    const { rows: [moveRes2] } = await client.query(`
      SELECT public.move_process_instance(
        p_instance_id => $1,
        p_target_placement_type => 'task_list',
        p_target_task_list_id => $2,
        p_reason => 'Attaching under Task List Alpha'
      ) AS res;
    `, [inst1.process_instance_id, taskList1.id]);

    assert(moveRes2.res && moveRes2.res.success === true && moveRes2.res.task_list_id === taskList1.id,
      'Test 6: Phase -> Task List move succeeded');

    const { rows: stepTasksAfterMove2 } = await client.query(`
      SELECT id, phase_id, task_list_id, parent_task_id FROM public.tasks WHERE process_instance_id = $1;
    `, [inst1.process_instance_id]);
    assert(stepTasksAfterMove2.every(t => t.task_list_id === taskList1.id && t.phase_id === phase1.id),
      'Test 7: Step tasks updated with authoritative phase_id and task_list_id');

    // C. Task List -> Task Move
    const { rows: [moveRes3] } = await client.query(`
      SELECT public.move_process_instance(
        p_instance_id => $1,
        p_target_placement_type => 'task',
        p_target_parent_task_id => $2,
        p_reason => 'Nesting under Host Container Task 1'
      ) AS res;
    `, [inst1.process_instance_id, hostTask1.id]);

    assert(moveRes3.res && moveRes3.res.success === true && moveRes3.res.parent_task_id === hostTask1.id,
      'Test 8: Task List -> Task move succeeded');

    const { rows: stepTasksAfterMove3 } = await client.query(`
      SELECT id, phase_id, task_list_id, parent_task_id FROM public.tasks WHERE process_instance_id = $1;
    `, [inst1.process_instance_id]);
    assert(stepTasksAfterMove3.every(t => t.parent_task_id === hostTask1.id && t.task_list_id === taskList1.id),
      'Test 9: Root step tasks nested under target parent task ID');

    // D. Task -> Project Move
    const { rows: [moveRes4] } = await client.query(`
      SELECT public.move_process_instance(
        p_instance_id => $1,
        p_target_placement_type => 'project',
        p_reason => 'Promoting back to project root'
      ) AS res;
    `, [inst1.process_instance_id]);

    assert(moveRes4.res && moveRes4.res.success === true && moveRes4.res.placement_type === 'project',
      'Test 10: Task -> Project move succeeded');

    // E. No-Op Move
    const { rows: [noopRes] } = await client.query(`
      SELECT public.move_process_instance(
        p_instance_id => $1,
        p_target_placement_type => 'project',
        p_reason => 'Redundant no-op move'
      ) AS res;
    `, [inst1.process_instance_id]);
    assert(noopRes.res && noopRes.res.is_noop === true, 'Test 11: Exact same target move returns is_noop = true');

    async function expectError(queryFn, matchPattern, message) {
      await client.query('SAVEPOINT sp_expect_err;');
      let caught = false;
      try {
        await queryFn();
        await client.query('RELEASE SAVEPOINT sp_expect_err;');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_expect_err;');
        caught = matchPattern ? matchPattern.test(e.message) : true;
        if (!caught) {
          console.error(`  Expected error matching ${matchPattern}, but got: "${e.message}"`);
        }
      }
      assert(caught, message);
    }

    // =======================================================================
    // SUITE 2: MOVEMENT NEGATIVE TESTS & CYCLE PREVENTION
    // =======================================================================
    console.log('\n--- Suite 2: Movement Negative Tests & Cycle Prevention ---');

    // 1. Cross-Project Phase Move (rejected)
    await expectError(
      () => client.query(`
        SELECT public.move_process_instance(
          p_instance_id => $1,
          p_target_placement_type => 'phase',
          p_target_phase_id => $2,
          p_reason => 'Cross project move attempt'
        );
      `, [inst1.process_instance_id, phase2Cross.id]),
      /Cross-project movement is prohibited/i,
      'Test 12: Cross-project Phase move rejected'
    );

    // 2. Cross-Project Task List Move (rejected)
    await expectError(
      () => client.query(`
        SELECT public.move_process_instance(
          p_instance_id => $1,
          p_target_placement_type => 'task_list',
          p_target_task_list_id => $2,
          p_reason => 'Cross project task list move attempt'
        );
      `, [inst1.process_instance_id, taskListCross.id]),
      /Cross-project movement is prohibited/i,
      'Test 13: Cross-project Task List move rejected'
    );

    // 3. Standalone -> Attached Move (rejected)
    const startReqIdStandalone = `22222222-2222-2222-2222-${Date.now().toString().slice(-12)}`;
    const { rows: [startStandaloneRes] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Standalone Process Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'standalone'
      ) AS res;
    `, [version.id, startReqIdStandalone]);
    const standaloneInstId = startStandaloneRes.res.process_instance_id;

    await expectError(
      () => client.query(`
        SELECT public.move_process_instance(
          p_instance_id => $1,
          p_target_placement_type => 'project',
          p_reason => 'Convert standalone to attached'
        );
      `, [standaloneInstId]),
      /Standalone instance cannot be moved/i,
      'Test 14: Standalone -> Attached move rejected'
    );

    // 4. Attached -> Standalone Move (rejected)
    await expectError(
      () => client.query(`
        SELECT public.move_process_instance(
          p_instance_id => $1,
          p_target_placement_type => 'standalone',
          p_reason => 'Convert attached to standalone'
        );
      `, [inst1.process_instance_id]),
      /Attached instance cannot be converted to standalone/i,
      'Test 15: Attached -> Standalone move rejected'
    );

    // 5. Cycle Prevention: Move to Self Step Task (rejected)
    const { rows: [stepTask1] } = await client.query(`
      SELECT id FROM public.tasks WHERE process_instance_id = $1 LIMIT 1;
    `, [inst1.process_instance_id]);

    await expectError(
      () => client.query(`
        SELECT public.move_process_instance(
          p_instance_id => $1,
          p_target_placement_type => 'task',
          p_target_parent_task_id => $2,
          p_reason => 'Self step cycle move'
        );
      `, [inst1.process_instance_id, stepTask1.id]),
      /Circular hierarchy detected/i,
      'Test 16: Move to own step task rejected for cycle prevention'
    );

    // 6. Empty Reason (rejected)
    await expectError(
      () => client.query(`
        SELECT public.move_process_instance(
          p_instance_id => $1,
          p_target_placement_type => 'phase',
          p_target_phase_id => $2,
          p_reason => '   '
        );
      `, [inst1.process_instance_id, phase1.id]),
      /Move reason is required/i,
      'Test 17: Empty/whitespace movement reason rejected'
    );

    // =======================================================================
    // SUITE 3: CANCELLATION LIFECYCLE & IDEMPOTENCY
    // =======================================================================
    console.log('\n--- Suite 3: Cancellation Lifecycle & Idempotency ---');

    const startReqId2 = `33333333-3333-3333-3333-${Date.now().toString().slice(-12)}`;
    const { rows: [startRes2] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Cancellable Process Instance',
        p_start_request_id => $2::uuid,
        p_placement_type => 'phase',
        p_project_id => $3,
        p_phase_id => $4
      ) AS res;
    `, [version.id, startReqId2, project1.id, phase1.id]);

    const inst2Id = startRes2.res.process_instance_id;

    // Advance Step 1 to completed
    const { rows: stepTasks2 } = await client.query(`
      SELECT id, process_step_id FROM public.tasks WHERE process_instance_id = $1 ORDER BY position;
    `, [inst2Id]);

    await client.query(`
      SELECT public.complete_responsible_part(
        p_task_id => $1,
        p_cycle_number => 1,
        p_notes => 'Completing step 1 before cancel'
      );
    `, [stepTasks2[0].id]);

    // Verify step 1 is completed and step 2 is ready
    const { rows: tasksBeforeCancel } = await client.query(`
      SELECT id, workflow_state FROM public.tasks WHERE process_instance_id = $1 ORDER BY position;
    `, [inst2Id]);
    assert(tasksBeforeCancel[0].workflow_state === 'completed' && tasksBeforeCancel[1].workflow_state === 'ready',
      'Test 18: Step 1 completed and Step 2 ready prior to cancellation');

    // Execute cancellation
    const { rows: [cancelRes1] } = await client.query(`
      SELECT public.cancel_process_instance(
        p_instance_id => $1,
        p_reason => 'Project cancelled due to budget cuts'
      ) AS res;
    `, [inst2Id]);

    assert(cancelRes1.res && cancelRes1.res.status === 'cancelled' && cancelRes1.res.is_replay === false,
      'Test 19: Process instance cancelled successfully');

    // Assert Process Instance record
    const { rows: [inst2Row] } = await client.query(`
      SELECT status, cancelled_by, cancelled_at, cancel_reason FROM public.process_instances WHERE id = $1;
    `, [inst2Id]);
    assert(inst2Row.status === 'cancelled' && inst2Row.cancelled_by === starterId && inst2Row.cancel_reason === 'Project cancelled due to budget cuts',
      'Test 20: Process instance record contains status=cancelled, cancelled_by and cancel_reason');

    // Assert Step Tasks States: Step 1 = completed, Step 2 = cancelled, Step 3 = cancelled
    const { rows: tasksAfterCancel } = await client.query(`
      SELECT id, workflow_state FROM public.tasks WHERE process_instance_id = $1 ORDER BY position;
    `, [inst2Id]);
    assert(tasksAfterCancel[0].workflow_state === 'completed', 'Test 21: Step 1 remains completed');
    assert(tasksAfterCancel[1].workflow_state === 'cancelled', 'Test 22: Step 2 transitioned from ready to cancelled');
    assert(tasksAfterCancel[2].workflow_state === 'cancelled', 'Test 23: Step 3 transitioned from waiting to cancelled');

    // Assert RACI intact
    const { rows: raciAfterCancel } = await client.query(`
      SELECT ra.* FROM public.task_raci_assignments ra
      JOIN public.tasks t ON t.id = ra.task_id
      WHERE t.process_instance_id = $1;
    `, [inst2Id]);
    assert(raciAfterCancel.length >= 4, 'Test 24: Task RACI assignments remain 100% intact after cancellation');

    // Assert PROCESS_CANCELLED audit event
    const { rows: auditCancel1 } = await client.query(`
      SELECT * FROM public.process_audit_events
      WHERE process_instance_id = $1 AND event_type = 'PROCESS_CANCELLED';
    `, [inst2Id]);
    assert(auditCancel1.length === 1 && auditCancel1[0].payload.completed_step_count === 1 && auditCancel1[0].payload.cancelled_step_count === 2,
      'Test 25: PROCESS_CANCELLED audit event logged with step counts');

    // Idempotent cancellation retry
    const { rows: [cancelReplayRes] } = await client.query(`
      SELECT public.cancel_process_instance(
        p_instance_id => $1,
        p_reason => 'Duplicate cancel retry'
      ) AS res;
    `, [inst2Id]);
    assert(cancelReplayRes.res && cancelReplayRes.res.is_replay === true && cancelReplayRes.res.status === 'cancelled',
      'Test 26: Replaying cancellation returns is_replay = true and preserves status');

    const { rows: auditCancelAfterReplay } = await client.query(`
      SELECT * FROM public.process_audit_events
      WHERE process_instance_id = $1 AND event_type = 'PROCESS_CANCELLED';
    `, [inst2Id]);
    assert(auditCancelAfterReplay.length === 1, 'Test 27: Zero duplicate audit events created on cancellation replay');

    // Move cancelled instance (rejected)
    await expectError(
      () => client.query(`
        SELECT public.move_process_instance(
          p_instance_id => $1,
          p_target_placement_type => 'project',
          p_reason => 'Attempt move cancelled'
        );
      `, [inst2Id]),
      /Cannot move cancelled process instance/i,
      'Test 28: Moving cancelled process instance is rejected'
    );

    // =======================================================================
    // SUITE 4: POST-CANCELLATION RUNTIME MUTATION GUARDS
    // =======================================================================
    console.log('\n--- Suite 4: Post-Cancellation Runtime Mutation Guards ---');

    // Attempt complete_responsible_part on cancelled step task 2
    await expectError(
      () => client.query(`
        SELECT public.complete_responsible_part(
          p_task_id => $1,
          p_cycle_number => 1,
          p_notes => 'Attempt complete on cancelled task'
        );
      `, [stepTasks2[1].id]),
      /cancelled process instance|cancelled/i,
      'Test 29: complete_responsible_part on cancelled step task rejected'
    );

    // Attempt reject_process_task on cancelled step task
    await expectError(
      () => client.query(`
        SELECT public.reject_process_task(
          p_task_id => $1,
          p_cycle_number => 1,
          p_rejection_reason => 'Attempt reject cancelled'
        );
      `, [stepTasks2[1].id]),
      /cancelled process instance|not awaiting approval/i,
      'Test 30: reject_process_task on cancelled step task rejected'
    );

    // =======================================================================
    // SUITE 5: AUTHORIZED ROLE MATRIX & OVERRIDES
    // =======================================================================
    console.log('\n--- Suite 5: Authorized Role Matrix & Overrides ---');

    // Cancel by CEO override
    const startReqIdCEO = `44444444-4444-4444-4444-${Date.now().toString().slice(-12)}`;
    const { rows: [startResCEO] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'CEO Override Cancel Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'project',
        p_project_id => $3
      ) AS res;
    `, [version.id, startReqIdCEO, project1.id]);
    const instCEOId = startResCEO.res.process_instance_id;

    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${ceoId}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: ceoId, role: 'authenticated' })}';`);
    const { rows: [cancelCEORes] } = await client.query(`
      SELECT public.cancel_process_instance(
        p_instance_id => $1,
        p_reason => 'CEO executive cancellation'
      ) AS res;
    `, [instCEOId]);
    assert(cancelCEORes.res && cancelCEORes.res.status === 'cancelled', 'Test 31: CEO override successfully cancelled instance');

    // Cancel by CTO override
    const startReqIdCTO = `55555555-5555-5555-5555-${Date.now().toString().slice(-12)}`;
    const { rows: [startResCTO] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'CTO Override Cancel Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'project',
        p_project_id => $3
      ) AS res;
    `, [version.id, startReqIdCTO, project1.id]);
    const instCTOId = startResCTO.res.process_instance_id;

    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${ctoId}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: ctoId, role: 'authenticated' })}';`);
    const { rows: [cancelCTORes] } = await client.query(`
      SELECT public.cancel_process_instance(
        p_instance_id => $1,
        p_reason => 'CTO technical cancellation'
      ) AS res;
    `, [instCTOId]);
    assert(cancelCTORes.res && cancelCTORes.res.status === 'cancelled', 'Test 32: CTO override successfully cancelled instance');

    // Unauthorized member cancel attempt (rejected)
    const startReqIdMember = `66666666-6666-6666-6666-${Date.now().toString().slice(-12)}`;
    const { rows: [startResMember] } = await client.query(`
      SELECT public.start_process_instance(
        p_version_id => $1,
        p_instance_name => 'Member Cancel Test',
        p_start_request_id => $2::uuid,
        p_placement_type => 'project',
        p_project_id => $3
      ) AS res;
    `, [version.id, startReqIdMember, project1.id]);
    const instMemberId = startResMember.res.process_instance_id;

    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${memberId}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: memberId, role: 'authenticated' })}';`);
    await expectError(
      () => client.query(`
        SELECT public.cancel_process_instance(
          p_instance_id => $1,
          p_reason => 'Unauthorized cancellation attempt'
        );
      `, [instMemberId]),
      /Caller not authorized/i,
      'Test 33: Unauthorized ordinary member cancel is rejected'
    );

    // =======================================================================
    // SUITE 6: PERMISSIONS API & VISIBILITY / RLS
    // =======================================================================
    console.log('\n--- Suite 6: Permissions API & Visibility / RLS ---');

    // Starter permissions on running instance
    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${starterId}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: starterId, role: 'authenticated' })}';`);
    const { rows: [starterPerms] } = await client.query(`
      SELECT public.get_process_instance_permissions($1) AS perms;
    `, [inst1.process_instance_id]);
    assert(starterPerms.perms.can_view === true && starterPerms.perms.can_move === true && starterPerms.perms.can_cancel === true,
      'Test 34: Starter has can_view=true, can_move=true, can_cancel=true');

    // Ordinary member permissions on attached instance
    await client.query(`SET LOCAL "request.jwt.claim.sub" = '${memberId}';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: memberId, role: 'authenticated' })}';`);
    const { rows: [memberPerms] } = await client.query(`
      SELECT public.get_process_instance_permissions($1) AS perms;
    `, [instMemberId]);
    assert(memberPerms.perms.can_view === true && memberPerms.perms.can_move === false && memberPerms.perms.can_cancel === false,
      'Test 35: Ordinary member on attached instance has can_view=true, can_move=false, can_cancel=false');

    // Direct DML Mutation Blocking: direct UPDATE on process_instances rejected for authenticated
    await expectError(
      () => client.query(`
        UPDATE public.process_instances SET status = 'cancelled' WHERE id = $1;
      `, [instMemberId]),
      null,
      'Test 36: Direct UPDATE on public.process_instances rejected for authenticated role'
    );

  } finally {
    await client.query('ROLLBACK;');
    await client.end();
  }

  console.log('\n======================================================================');
  console.log(`P2-02 Movement & Cancellation Test Suite: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
}

runP202TestSuite().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
