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

async function runMVPTests() {
  console.log('===============================================================');
  console.log('SNS Projects — Defined Process Engine MVP End-to-End Suite');
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

  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  // SECTION 1: WORKING-DAY DUE DATE CALCULATION VERIFICATION
  console.log('--- Working Day Calculation Unit Tests ---');

  // Verify calendar exists for workspace
  const { rows: calRows } = await client.query(`
    SELECT * FROM public.workspace_working_calendars WHERE workspace_id = $1;
  `, [wsId]);
  assert(calRows.length === 1, 'Test 1: Workspace working calendar seeded and active');

  // Wed (2026-08-19) + 1 day -> Wed (2026-08-19)
  const { rows: [d1] } = await client.query(`SELECT private.add_working_days($1, '2026-08-19'::date, 1)::text as res;`, [wsId]);
  assert(d1.res === '2026-08-19', 'Test 2: Wednesday + 1 working day = Wednesday');

  // Wed (2026-08-19) + 3 days -> Fri (2026-08-21)
  const { rows: [d2] } = await client.query(`SELECT private.add_working_days($1, '2026-08-19'::date, 3)::text as res;`, [wsId]);
  assert(d2.res === '2026-08-21', 'Test 3: Wednesday + 3 working days = Friday');

  // Fri (2026-08-21) + 2 days -> Mon (2026-08-24) (skips Sat-Sun)
  const { rows: [d3] } = await client.query(`SELECT private.add_working_days($1, '2026-08-21'::date, 2)::text as res;`, [wsId]);
  assert(d3.res === '2026-08-24', 'Test 4: Friday + 2 working days = Monday (skips weekend)');

  // Sat (2026-08-22 non-working) + 1 day -> Mon (2026-08-24)
  const { rows: [d4] } = await client.query(`SELECT private.add_working_days($1, '2026-08-22'::date, 1)::text as res;`, [wsId]);
  assert(d4.res === '2026-08-24', 'Test 5: Non-working Saturday + 1 working day begins on Monday');

  // SECTION 2: END-TO-END WORKFLOW (ISOLATED ROLLBACK SANDBOX)
  console.log('\n--- End-to-End Workflow Tests (Auto-Rollback Sandbox) ---');

  const { rows: [realOwner] } = await client.query(`SELECT id FROM public.profiles WHERE id = '00ae89c1-353b-4367-827e-9817343140d1';`);
  const { rows: [testDept] } = await client.query(`SELECT id FROM public.departments WHERE workspace_id = $1 LIMIT 1;`, [wsId]);
  const { rows: [testProj] } = await client.query(`SELECT id FROM public.projects WHERE workspace_id = $1 LIMIT 1;`, [wsId]);
  const { rows: [testMs] } = await client.query(`SELECT id FROM public.milestones WHERE project_id = $1 LIMIT 1;`, [testProj.id]);

  await client.query('BEGIN');
  try {
    // Setup synthetic users for multi-role workflow test in sandbox
    const uids = {
      head: '11111111-1111-1111-1111-111111111111',
      resp1: '22222222-2222-2222-2222-222222222222',
      resp2: '33333333-3333-3333-3333-333333333333',
      accountable: '44444444-4444-4444-4444-444444444444',
      consulted: '55555555-5555-5555-5555-555555555555',
      unauthorized: '66666666-6666-6666-6666-666666666666',
    };

    for (const [key, uid] of Object.entries(uids)) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${key}@example.com', '', now(), '{"provider":"email"}', jsonb_build_object('full_name', 'Test User ${key}'), now(), now())
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.profiles (id, full_name) VALUES ('${uid}', 'Test User ${key}')
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
        VALUES ('${wsId}', '${uid}', 'member', 'active')
        ON CONFLICT (workspace_id, user_id) WHERE user_id IS NOT NULL
        DO UPDATE SET status = 'active';
      `);
    }

    // Set Department Head
    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, role, is_active)
      VALUES ('${wsId}', '${testDept.id}', '${uids.head}', 'head', true)
      ON CONFLICT (department_id, user_id) DO UPDATE SET role = 'head', is_active = true;
    `);

    async function asUser(userId, callback) {
      await client.query('SET LOCAL ROLE authenticated;');
      await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}';`);
      try {
        const res = await callback();
        await client.query('RESET ROLE;');
        await client.query('RESET request.jwt.claims;');
        return res;
      } catch (err) {
        throw err;
      }
    }

    async function expectReject(action, label) {
      await client.query('SAVEPOINT sp_expect_reject;');
      let rejected = false;
      try {
        await action();
      } catch (e) {
        rejected = true;
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT sp_expect_reject;');
      }
      assert(rejected, label);
    }

    // CREATE DRAFT PROCESS FOR TESTING
    const { rows: [proc] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ('${wsId}', '${testDept.id}', 'E2E Test Procurement Process', 'E2E-PROC-01', '${uids.head}', '${realOwner.id}')
      RETURNING id;
    `);

    const { rows: [ver] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, created_by)
      VALUES ('${proc.id}', 1, 'draft', '${realOwner.id}')
      RETURNING id;
    `);

    // Add Step 1 (Root, multi-R, Evidence required, Approval required)
    const { rows: [step1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days, approval_required, consultation_required)
      VALUES ('${ver.id}', 'STP-001', 'Purchase Request & Quotation', 1, 2, true, false)
      RETURNING id;
    `);

    // Add Step 2 (Downstream, Consulted with response_required, Approval required)
    const { rows: [step2] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days, approval_required, consultation_required)
      VALUES ('${ver.id}', 'STP-002', 'Vendor Evaluation & PO', 2, 1, true, true)
      RETURNING id;
    `);

    // Dependency: Step 2 depends on Step 1
    await client.query(`
      INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
      VALUES ('${ver.id}', '${step2.id}', '${step1.id}');
    `);

    // Evidence definition on Step 1
    const { rows: [evDef1] } = await client.query(`
      INSERT INTO public.defined_process_step_evidence_defs (step_id, title, evidence_type, is_mandatory)
      VALUES ('${step1.id}', 'Quotation Summary Document', 'text', true)
      RETURNING id;
    `);

    // Step 1 RACI: 2 Responsible (resp1, resp2), 1 Accountable (accountable)
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id)
      VALUES
        ('${step1.id}', 'R', '${uids.resp1}'),
        ('${step1.id}', 'R', '${uids.resp2}'),
        ('${step1.id}', 'A', '${uids.accountable}');
    `);

    // Step 2 RACI: 1 Responsible (resp1), 1 Accountable (accountable), 1 Consulted (consulted with response_required)
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id, response_required)
      VALUES
        ('${step2.id}', 'R', '${uids.resp1}', false),
        ('${step2.id}', 'A', '${uids.accountable}', false),
        ('${step2.id}', 'C', '${uids.consulted}', true);
    `);

    // --- PUBLISH VALIDATION TESTS ---
    // Unauthorized publish attempt (regular member) -> FAIL
    await expectReject(async () => {
      await asUser(uids.resp1, async () => {
        await client.query(`SELECT public.publish_defined_process_version('${ver.id}');`);
      });
    }, 'Test 6: Unauthorized member cannot publish process version');

    // Authorized publish by Department Head -> PASS
    await asUser(uids.head, async () => {
      const { rows: [pubRes] } = await client.query(`SELECT public.publish_defined_process_version('${ver.id}') as res;`);
      assert(pubRes.res.status === 'published', 'Test 7: Department Head successfully published process version');
    });

    // Verify published status in DB
    const { rows: [pubVer] } = await client.query(`SELECT status FROM public.defined_process_versions WHERE id = '${ver.id}';`);
    assert(pubVer.status === 'published', 'Test 8: Process version status transitioned to published in database');

    // --- START PROCESS TESTS ---
    // Start attempt by non-root-Responsible user (head is not in Step 1 R) -> FAIL
    await expectReject(async () => {
      await asUser(uids.head, async () => {
        await client.query(`
          SELECT public.start_defined_process('${ver.id}', '${testProj.id}', '${testMs.id}', 'E2E Live Order 101');
        `);
      });
    }, 'Test 9: Non-Responsible caller rejected by start_defined_process (root R mandatory)');

    // Start attempt by root Responsible user (resp1) -> PASS
    let startResult;
    await asUser(uids.resp1, async () => {
      const { rows: [res] } = await client.query(`
        SELECT public.start_defined_process('${ver.id}', '${testProj.id}', '${testMs.id}', 'E2E Live Order 101') as res;
      `);
      startResult = res.res;
    });

    assert(!!startResult.task_list_id && startResult.task_count === 2, 'Test 10: start_defined_process created task list and 2 defined tasks');

    // Verify Root Task is 'ready' and Downstream Task is 'waiting'
    const { rows: liveTasks } = await client.query(`
      SELECT id, title, workflow_state, current_cycle_number, due_date, ready_at
      FROM public.tasks
      WHERE task_list_id = $1
      ORDER BY position ASC;
    `, [startResult.task_list_id]);

    assert(liveTasks[0].workflow_state === 'ready' && liveTasks[0].ready_at !== null && liveTasks[0].due_date !== null, 'Test 11: Root Step 1 task is READY with computed working-day due date');
    assert(liveTasks[1].workflow_state === 'waiting' && liveTasks[1].ready_at === null && liveTasks[1].due_date === null, 'Test 12: Downstream Step 2 task is WAITING with NULL due date');

    const rootTaskId = liveTasks[0].id;
    const step2TaskId = liveTasks[1].id;

    // Verify notifications emitted only for Root Task RACI
    const { rows: notifRows } = await client.query(`
      SELECT user_id, type, title FROM public.notifications
      WHERE project_id = $1 AND entity_id = $2;
    `, [testProj.id, rootTaskId]);
    assert(notifRows.length >= 2, 'Test 13: Workflow notifications generated for Root Task RACI participants');

    // --- RESPONSIBLE COMPLETION & EVIDENCE TESTS ---
    // Submit evidence from non-R user -> FAIL
    await expectReject(async () => {
      await asUser(uids.consulted, async () => {
        await client.query(`
          SELECT public.submit_task_evidence('${rootTaskId}', '${evDef1.id}', 'text', '{"note": "Hacked Evidence"}'::jsonb);
        `);
      });
    }, 'Test 14: Non-Responsible user evidence submission rejected');

    // Responsible 1 (resp1) submits completion (multi-R partial) -> returns remaining_responsible = 1
    await asUser(uids.resp1, async () => {
      const { rows: [comp1] } = await client.query(`
        SELECT public.complete_responsible_part('${rootTaskId}', 'Completed part by Resp 1') as res;
      `);
      assert(comp1.res.completed === false && comp1.res.remaining_responsible === 1, 'Test 15: Multi-R partial completion returns remaining responsible count');
    });

    // Duplicate completion by resp1 in same cycle -> FAIL
    await expectReject(async () => {
      await asUser(uids.resp1, async () => {
        await client.query(`SELECT public.complete_responsible_part('${rootTaskId}', 'Duplicate submission');`);
      });
    }, 'Test 16: Duplicate Responsible completion in same cycle rejected');

    // Responsible 2 attempts to complete without required evidence -> FAIL
    await expectReject(async () => {
      await asUser(uids.resp2, async () => {
        await client.query(`SELECT public.complete_responsible_part('${rootTaskId}', 'Done without evidence');`);
      });
    }, 'Test 17: Responsible completion blocked when required evidence is missing');

    // Submit valid evidence by resp1 -> PASS
    await asUser(uids.resp1, async () => {
      const { rows: [evRes] } = await client.query(`
        SELECT public.submit_task_evidence('${rootTaskId}', '${evDef1.id}', 'text', '{"doc_url": "https://example.com/quotation.pdf", "vendor": "ACME Corp"}'::jsonb) as res;
      `);
      assert(evRes.res.success === true, 'Test 18: Valid text/link evidence submission accepted');
    });

    // Responsible 2 (resp2) submits completion with evidence present -> transitions to awaiting_approval
    await asUser(uids.resp2, async () => {
      const { rows: [comp2] } = await client.query(`
        SELECT public.complete_responsible_part('${rootTaskId}', 'Completed part by Resp 2') as res;
      `);
      assert(comp2.res.workflow_state === 'awaiting_approval', 'Test 19: All Responsible completed with evidence -> transitions to awaiting_approval');
    });

    // --- REJECTION / REWORK CYCLE TESTS ---
    // Accountable rejects Step 1 with reason and new due date -> transitions to rework_required
    await asUser(uids.accountable, async () => {
      const { rows: [rejRes] } = await client.query(`
        SELECT public.reject_process_task('${rootTaskId}', 'Quotation vendor discount missing', '2026-08-25'::date) as res;
      `);
      assert(rejRes.res.workflow_state === 'rework_required' && rejRes.res.new_cycle_number === 2, 'Test 20: Accountable rejection transitions task to rework_required and increments cycle to 2');
    });

    const { rows: [reworkTask] } = await client.query(`SELECT workflow_state, current_cycle_number, due_date FROM public.tasks WHERE id = '${rootTaskId}';`);
    assert(reworkTask.workflow_state === 'rework_required' && reworkTask.current_cycle_number === 2, 'Test 21: Task workflow_state in DB is rework_required with cycle 2');

    // Submit new evidence for cycle 2
    await asUser(uids.resp1, async () => {
      await client.query(`
        SELECT public.submit_task_evidence('${rootTaskId}', '${evDef1.id}', 'text', '{"doc_url": "https://example.com/quotation-v2.pdf", "discount": "15%"}'::jsonb);
      `);
      await client.query(`SELECT public.complete_responsible_part('${rootTaskId}', 'Rework part 1 done');`);
    });

    await asUser(uids.resp2, async () => {
      const { rows: [reworkComp] } = await client.query(`SELECT public.complete_responsible_part('${rootTaskId}', 'Rework part 2 done') as res;`);
      assert(reworkComp.res.workflow_state === 'awaiting_approval', 'Test 22: Rework completion transitions task back to awaiting_approval for cycle 2');
    });

    // --- APPROVAL & DAG ADVANCEMENT TESTS ---
    // Non-Accountable user approval attempt -> FAIL
    await expectReject(async () => {
      await asUser(uids.resp1, async () => {
        await client.query(`SELECT public.approve_process_task('${rootTaskId}');`);
      });
    }, 'Test 23: Non-Accountable user approval rejected');

    // Accountable user approves Step 1 -> Step 1 completes, Step 2 unlocks and transitions to READY!
    await asUser(uids.accountable, async () => {
      const { rows: [appRes] } = await client.query(`SELECT public.approve_process_task('${rootTaskId}') as res;`);
      assert(appRes.res.workflow_state === 'completed', 'Test 24: Accountable approval completes Step 1');
    });

    // Verify Step 1 is completed and Step 2 is now READY with computed due date
    const { rows: [step1After] } = await client.query(`SELECT workflow_state FROM public.tasks WHERE id = '${rootTaskId}';`);
    const { rows: [step2After] } = await client.query(`SELECT workflow_state, due_date, ready_at FROM public.tasks WHERE id = '${step2TaskId}';`);

    assert(step1After.workflow_state === 'completed', 'Test 25: Step 1 task workflow_state is completed');
    assert(step2After.workflow_state === 'ready' && step2After.ready_at !== null && step2After.due_date !== null, 'Test 26: Downstream Step 2 automatically unlocked and transitioned from WAITING to READY');

    // --- STEP 2 EXECUTION: CONSULTATION & APPROVAL ---
    // Step 2 Responsible completes work -> transitions to awaiting_consultation (because consultation_required = true)
    await asUser(uids.resp1, async () => {
      const { rows: [s2Comp] } = await client.query(`SELECT public.complete_responsible_part('${step2TaskId}', 'Vendor evaluation draft') as res;`);
      assert(s2Comp.res.workflow_state === 'awaiting_consultation', 'Test 27: Step 2 transitions to awaiting_consultation when required C has not responded');
    });

    // Consulted user submits consultation response
    await asUser(uids.consulted, async () => {
      const { rows: [cRes] } = await client.query(`
        SELECT public.submit_task_consultation('${step2TaskId}', 'Vendor meets technical requirements and SLA standards.') as res;
      `);
      assert(cRes.res.consultation_complete === true && cRes.res.workflow_state === 'awaiting_approval', 'Test 28: Consultation submission completes consultation requirement and advances to awaiting_approval');
    });

    // Step 2 Accountable approves -> Step 2 completes, process instance AUTOMATICALLY COMPLETES!
    await asUser(uids.accountable, async () => {
      const { rows: [s2App] } = await client.query(`SELECT public.approve_process_task('${step2TaskId}') as res;`);
      assert(s2App.res.workflow_state === 'completed', 'Test 29: Step 2 approved and completed');
    });

    // --- AUTOMATIC PROCESS COMPLETION VERIFICATION ---
    const { rows: [liveTaskList] } = await client.query(`
      SELECT process_state, completed_at FROM public.task_lists WHERE id = '${startResult.task_list_id}';
    `);
    assert(liveTaskList.process_state === 'completed' && liveTaskList.completed_at !== null, 'Test 30: Task List (process instance) automatically transitioned to COMPLETED');

    // Verify Audit Events log complete lifecycle
    const { rows: auditEvents } = await client.query(`
      SELECT event_type FROM public.process_audit_events
      WHERE task_list_id = $1
      ORDER BY created_at ASC;
    `, [startResult.task_list_id]);
    const eventTypes = auditEvents.map(e => e.event_type);

    assert(eventTypes.includes('PROCESS_STARTED'), 'Test 31: PROCESS_STARTED audit event recorded');
    assert(eventTypes.includes('TASK_READY'), 'Test 32: TASK_READY audit event recorded');
    assert(eventTypes.includes('TASK_REWORK_REQUIRED'), 'Test 33: TASK_REWORK_REQUIRED audit event recorded');
    assert(eventTypes.includes('TASK_COMPLETED'), 'Test 34: TASK_COMPLETED audit events recorded');
    assert(eventTypes.includes('PROCESS_COMPLETED'), 'Test 35: PROCESS_COMPLETED audit event recorded');

  } finally {
    // ALWAYS rollback sandbox transaction
    await client.query('ROLLBACK');
  }

  // SECTION 3: PRODUCTION BASELINE INVARIANTS
  console.log('\n--- Production Baseline Verification ---');

  const { rows: [{ count: pCount }] } = await client.query(`SELECT count(*)::int as count FROM public.projects;`);
  const { rows: [{ count: mCount }] } = await client.query(`SELECT count(*)::int as count FROM public.milestones;`);
  const { rows: [{ count: tlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists;`);
  const { rows: [{ count: ctlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists WHERE task_list_type = 'custom';`);
  const { rows: [{ count: dtlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists WHERE task_list_type = 'defined';`);
  const { rows: [{ count: tCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks;`);
  const { rows: [{ count: dtCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks WHERE process_step_id IS NOT NULL;`);
  const { rows: [{ count: subCount }] } = await client.query(`SELECT count(*)::int as count FROM public.subtasks;`);
  const { rows: [{ count: raciLiveCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_raci_assignments;`);
  const { rows: dupRows } = await client.query(`
    SELECT project_id, status_id, position, count(*) FROM public.tasks GROUP BY project_id, status_id, position HAVING count(*) > 1;
  `);

  assert(pCount === 3, `Test 36: Projects = 3 (got ${pCount})`);
  assert(mCount === 6, `Test 37: Milestones = 6 (got ${mCount})`);
  assert(tlCount === 12, `Test 38: Task Lists = 12 (got ${tlCount})`);
  assert(ctlCount === 12, `Test 39: Custom Task Lists = 12 (got ${ctlCount})`);
  assert(dtlCount === 0, `Test 40: Defined Task Lists = 0 (got ${dtlCount})`);
  assert(tCount === 24, `Test 41: Tasks = 24 (got ${tCount})`);
  assert(dtCount === 0, `Test 42: Defined Tasks = 0 (got ${dtCount})`);
  assert(subCount === 48, `Test 43: Subtasks = 48 (got ${subCount})`);
  assert(raciLiveCount === 72, `Test 44: RACI = 72 (got ${raciLiveCount})`);
  assert(dupRows.length === 0, `Test 45: duplicate Kanban groups = 0 (got ${dupRows.length})`);

  console.log('\n===============================================================');
  console.log(`Defined Process MVP Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  await client.end();

  if (failed > 0) process.exit(1);
}

runMVPTests().catch(err => {
  console.error(err);
  process.exit(1);
});
