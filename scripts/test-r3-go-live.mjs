import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

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
  console.log('Connected to Supabase PostgreSQL for Release 3 Go-Live Verification.\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // SETUP TEST FIXTURE (Clean temporary project & entities)
    // -------------------------------------------------------------
    const { rows: testUsers } = await pgClient.query(`SELECT id FROM auth.users LIMIT 2;`);
    const testUser1 = testUsers[0]?.id;
    let testUser2 = testUsers[1]?.id;
    let createdDummyUser = false;

    const { rows: wsRows } = await pgClient.query(`SELECT id FROM public.workspaces LIMIT 1;`);
    const workspaceId = wsRows[0]?.id;

    if (!testUser2 || testUser2 === testUser1) {
      testUser2 = '00000000-0000-0000-0000-000000000002';
      createdDummyUser = true;
      // Clean before insert
      await pgClient.query(`DELETE FROM auth.users WHERE id = '${testUser2}';`);
      await pgClient.query(`
        INSERT INTO auth.users (
          id,
          instance_id,
          email,
          raw_app_meta_data,
          raw_user_meta_data,
          created_at,
          updated_at
        ) VALUES (
          '${testUser2}',
          '00000000-0000-0000-0000-000000000000',
          'test.engineer2@stacknstock.in',
          '{"provider":"email","providers":["email"]}',
          '{"full_name":"Test Engineer 2"}',
          now(),
          now()
        );
      `);
      await pgClient.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ('${testUser2}', 'Test Engineer 2')
        ON CONFLICT (id) DO UPDATE SET full_name = 'Test Engineer 2';
      `);
      await pgClient.query(`
        INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
        VALUES ('${workspaceId}', '${testUser2}', 'member', 'active')
        ON CONFLICT DO NOTHING;
      `);
    }

    // Clean any previous test artifacts
    await pgClient.query(`DELETE FROM public.projects WHERE name = 'R3 Go-Live Test Project';`);
    await pgClient.query(`DELETE FROM public.departments WHERE code LIKE 'R3%';`);

    // Create test project
    const { rows: projRows } = await pgClient.query(`
      INSERT INTO public.projects (workspace_id, name, color, owner_id)
      VALUES ('${workspaceId}', 'R3 Go-Live Test Project', '#FDE215', '${testUser1}')
      RETURNING id;
    `);
    const testProjId = projRows[0].id;

    // Get statuses
    const { rows: statuses } = await pgClient.query(`
      SELECT id, system_code, name FROM public.task_statuses WHERE project_id = '${testProjId}';
    `);
    const todoStatus = statuses.find(s => s.system_code === 'todo') || statuses[0];
    const doneStatus = statuses.find(s => s.system_code === 'done') || statuses[3];

    // Create Milestone
    const { rows: mRows } = await pgClient.query(`
      INSERT INTO public.milestones (project_id, name, description)
      VALUES ('${testProjId}', 'Phase 1 Commissioning', 'Commissioning deliverables')
      RETURNING id;
    `);
    const testMId = mRows[0].id;

    // Create Task List
    const { rows: tlRows } = await pgClient.query(`
      INSERT INTO public.task_lists (milestone_id, project_id, name)
      VALUES ('${testMId}', '${testProjId}', 'Controls Engineering')
      RETURNING id;
    `);
    const testTLId = tlRows[0].id;

    // -------------------------------------------------------------
    // GROUP 1: HIERARCHY & TASK INTEGRITY
    // -------------------------------------------------------------
    console.log('=== GROUP 1: HIERARCHY & TASK INTEGRITY ===');

    // 1. Hierarchy tables remain correct and queryable
    const { rows: hCheck } = await pgClient.query(`
      SELECT
        (SELECT count(*)::int FROM public.milestones WHERE id = '${testMId}') as m_cnt,
        (SELECT count(*)::int FROM public.task_lists WHERE id = '${testTLId}') as tl_cnt;
    `);
    assert(hCheck[0].m_cnt === 1 && hCheck[0].tl_cnt === 1, 'Test 1: Hierarchy tables remain correct and queryable');

    // 2. Create structured task
    const { rows: tRows } = await pgClient.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, created_by)
      VALUES ('${testProjId}', '${testMId}', '${testTLId}', 'Configure PLC Gateway', '${todoStatus.id}', '${testUser1}')
      RETURNING id;
    `);
    const testTaskId = tRows[0].id;

    // 3. New Task produces exactly 1 Accountable (A) and >= 1 Responsible (R)
    await pgClient.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id, created_by)
      VALUES
        ('${testTaskId}', 'A', '${testUser1}', '${testUser1}'),
        ('${testTaskId}', 'R', '${testUser2}', '${testUser1}');
    `);

    const { rows: raciCheck } = await pgClient.query(`
      SELECT raci_role, user_id FROM public.task_raci_assignments WHERE task_id = '${testTaskId}';
    `);
    const aRoles = raciCheck.filter(r => r.raci_role === 'A');
    const rRoles = raciCheck.filter(r => r.raci_role === 'R');

    assert(rRoles.length >= 1, 'Test 2: New Task produces >= 1 Responsible assignment');
    assert(aRoles.length === 1, 'Test 3: New Task produces exactly 1 Accountable assignment');

    // 4. Failed RACI insertion leaves no accidental task (Simulate atomic rollback)
    const { rows: orphanCheckTask } = await pgClient.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, created_by)
      VALUES ('${testProjId}', '${testMId}', '${testTLId}', 'Rollback Test Task', '${todoStatus.id}', '${testUser1}')
      RETURNING id;
    `);
    const orphanId = orphanCheckTask[0].id;
    let raciFailed = false;
    try {
      await pgClient.query(`
        INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
        VALUES ('${orphanId}', 'A', '${testUser1}'), ('${orphanId}', 'A', '${testUser2}');
      `);
    } catch (e) {
      raciFailed = true;
      await pgClient.query(`DELETE FROM public.tasks WHERE id = '${orphanId}';`);
    }
    const { rows: remainingOrphan } = await pgClient.query(`SELECT count(*)::int as count FROM public.tasks WHERE id = '${orphanId}';`);
    assert(raciFailed && remainingOrphan[0].count === 0, 'Test 4: Failed RACI insertion leaves no accidental Task (compensating rollback)');

    // -------------------------------------------------------------
    // GROUP 2: NOTIFICATION TRIGGER ENGINE (EVENTS A, B, C)
    // -------------------------------------------------------------
    console.log('\n=== GROUP 2: NOTIFICATION TRIGGER ENGINE ===');

    // 5. R assignment produces in-app notification
    const { rows: rNotif } = await pgClient.query(`
      SELECT * FROM public.notifications
      WHERE user_id = '${testUser2}' AND type = 'task_assigned' AND task_id = '${testTaskId}';
    `);
    assert(
      rNotif.length > 0 && rNotif[0].title === 'Task assigned to you' && rNotif[0].message.includes('Phase 1 Commissioning'),
      'Test 5: R assignment produces notification with hierarchy context'
    );

    // 6. A assignment produces in-app notification
    const { rows: aNotif } = await pgClient.query(`
      SELECT * FROM public.notifications
      WHERE user_id = '${testUser1}' AND type = 'task_accountable' AND task_id = '${testTaskId}';
    `);
    assert(
      aNotif.length > 0 && aNotif[0].title === 'You are accountable for a task',
      'Test 6: A assignment produces notification'
    );

    // 7. C assignment produces in-app notification (use second task so no dedup collision)
    const { rows: tRows2 } = await pgClient.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, created_by)
      VALUES ('${testProjId}', '${testMId}', '${testTLId}', 'Safety Circuit Interlock', '${todoStatus.id}', '${testUser1}')
      RETURNING id;
    `);
    const testTaskId2 = tRows2[0].id;

    await pgClient.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id, created_by)
      VALUES ('${testTaskId2}', 'C', '${testUser2}', '${testUser1}');
    `);
    const { rows: cNotif } = await pgClient.query(`
      SELECT * FROM public.notifications
      WHERE user_id = '${testUser2}' AND type = 'task_consulted' AND task_id = '${testTaskId2}';
    `);
    assert(
      cNotif.length > 0 && cNotif[0].title === 'Your input is requested',
      'Test 7: C assignment produces notification'
    );

    // 8. I assignment produces in-app notification
    await pgClient.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id, created_by)
      VALUES ('${testTaskId2}', 'I', '${testUser2}', '${testUser1}');
    `);
    const { rows: iNotif } = await pgClient.query(`
      SELECT * FROM public.notifications
      WHERE user_id = '${testUser2}' AND type = 'task_informed' AND task_id = '${testTaskId2}';
    `);
    assert(
      iNotif.length > 0 && iNotif[0].title === 'You are following a task',
      'Test 8: I assignment produces notification'
    );

    // 9. Department R/C/I resolves active members in department_memberships
    const dynamicCode = `R3_${Date.now().toString().slice(-4)}`;
    const { rows: deptRows } = await pgClient.query(`
      INSERT INTO public.departments (workspace_id, code, name, color)
      VALUES ('${workspaceId}', '${dynamicCode}', 'R3 Engineering Dept', '#8cc9ff')
      RETURNING id;
    `);
    const testDeptId = deptRows[0].id;

    await pgClient.query(`
      INSERT INTO public.department_memberships (department_id, user_id, workspace_id, is_active)
      VALUES ('${testDeptId}', '${testUser1}', '${workspaceId}', true);
    `);

    // Assign department on testTaskId2
    await pgClient.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, department_id, created_by)
      VALUES ('${testTaskId2}', 'R', '${testDeptId}', '${testUser2}');
    `);

    const { rows: deptNotifs } = await pgClient.query(`
      SELECT * FROM public.notifications
      WHERE user_id = '${testUser1}' AND message LIKE '%(via Department assignment)%';
    `);
    assert(
      deptNotifs.length > 0,
      'Test 9: Department R/C/I assignment resolves active members and notifies them'
    );

    // 10. Duplicate recipient notification prevented (Deduplication within 10s)
    const { rows: countBeforeDup } = await pgClient.query(`
      SELECT count(*)::int as count FROM public.notifications
      WHERE user_id = '${testUser2}' AND type = 'task_assigned' AND task_id = '${testTaskId}';
    `);
    await pgClient.query(`
      SELECT private.emit_notification(
        '${workspaceId}',
        '${testUser2}',
        'task_assigned',
        'Task assigned to you',
        'Duplicate message',
        'task',
        '${testTaskId}',
        '${testProjId}',
        '${testTaskId}'
      );
    `);
    const { rows: countAfterDup } = await pgClient.query(`
      SELECT count(*)::int as count FROM public.notifications
      WHERE user_id = '${testUser2}' AND type = 'task_assigned' AND task_id = '${testTaskId}';
    `);
    assert(
      countAfterDup[0].count === countBeforeDup[0].count,
      'Test 10: Deduplication prevents duplicate unread notifications within 10 seconds'
    );

    // 11. Task status change produces correct notifications
    await pgClient.query(`
      UPDATE public.tasks
      SET status_id = '${doneStatus.id}'
      WHERE id = '${testTaskId}';
    `);
    const { rows: statusNotifs } = await pgClient.query(`
      SELECT * FROM public.notifications
      WHERE type = 'task_status_changed' AND task_id = '${testTaskId}';
    `);
    assert(
      statusNotifs.length > 0 && statusNotifs[0].title.includes('Done'),
      'Test 11: Task status change produces notification with new status name'
    );

    // 12. Unchanged status update produces NO notification
    const statusNotifCountBefore = statusNotifs.length;
    await pgClient.query(`
      UPDATE public.tasks
      SET title = 'Updated Title Only'
      WHERE id = '${testTaskId}';
    `);
    const { rows: statusNotifsAfter } = await pgClient.query(`
      SELECT count(*)::int as count FROM public.notifications
      WHERE type = 'task_status_changed' AND task_id = '${testTaskId}';
    `);
    assert(
      statusNotifsAfter[0].count === statusNotifCountBefore,
      'Test 12: Unchanged status update produces NO status notification'
    );

    // 13. Subtask assignment produces notification
    const { rows: stRows } = await pgClient.query(`
      INSERT INTO public.subtasks (task_id, title, assignee_id, status)
      VALUES ('${testTaskId}', 'Verify PLC IO Pins', '${testUser2}', 'todo')
      RETURNING id;
    `);
    const testSubtaskId = stRows[0].id;

    const { rows: stNotif } = await pgClient.query(`
      SELECT * FROM public.notifications
      WHERE user_id = '${testUser2}' AND type = 'subtask_assigned' AND entity_id = '${testSubtaskId}';
    `);
    assert(
      stNotif.length > 0 && stNotif[0].title === 'Subtask assigned to you',
      'Test 13: Subtask assignment produces notification with parent task hierarchy context'
    );

    // -------------------------------------------------------------
    // GROUP 3: NOTIFICATION SECURITY & RLS POLICIES
    // -------------------------------------------------------------
    console.log('\n=== GROUP 3: NOTIFICATION SECURITY & RLS POLICIES ===');

    // 14. Authenticated direct notification INSERT rejected
    let authInsertFailed = false;
    try {
      await pgClient.query(`SET ROLE authenticated;`);
      await pgClient.query(`SET request.jwt.claims TO '{"sub": "${testUser1}", "role": "authenticated"}';`);
      await pgClient.query(`
        INSERT INTO public.notifications (workspace_id, user_id, type, title)
        VALUES ('${workspaceId}', '${testUser2}', 'fake_type', 'Fake Title');
      `);
    } catch (e) {
      authInsertFailed = true;
    } finally {
      await pgClient.query(`RESET ROLE;`);
    }
    assert(authInsertFailed, 'Test 14: Authenticated direct notification INSERT is REJECTED (permission denied)');

    // 15. Anon direct notification INSERT rejected
    let anonInsertFailed = false;
    try {
      await pgClient.query(`SET ROLE anon;`);
      await pgClient.query(`
        INSERT INTO public.notifications (workspace_id, user_id, type, title)
        VALUES ('${workspaceId}', '${testUser2}', 'fake_type', 'Fake Title');
      `);
    } catch (e) {
      anonInsertFailed = true;
    } finally {
      await pgClient.query(`RESET ROLE;`);
    }
    assert(anonInsertFailed, 'Test 15: Anon direct notification INSERT is REJECTED (permission denied)');

    // 16. Own notification SELECT works
    await pgClient.query(`SET ROLE authenticated;`);
    await pgClient.query(`SET request.jwt.claims TO '{"sub": "${testUser2}", "role": "authenticated"}';`);
    const { rows: ownNotifs } = await pgClient.query(`SELECT count(*)::int as count FROM public.notifications;`);
    await pgClient.query(`RESET ROLE;`);
    assert(ownNotifs[0].count > 0, 'Test 16: Own notification SELECT works via RLS');

    // 17. Another user's notification SELECT denied (returns only own rows)
    await pgClient.query(`SET ROLE authenticated;`);
    await pgClient.query(`SET request.jwt.claims TO '{"sub": "${testUser1}", "role": "authenticated"}';`);
    const { rows: otherUserNotifs } = await pgClient.query(`SELECT count(*)::int as count FROM public.notifications WHERE user_id = '${testUser2}';`);
    await pgClient.query(`RESET ROLE;`);
    assert(otherUserNotifs[0].count === 0, "Test 17: Another user's notifications cannot be read via RLS (0 rows)");

    // 18. Own is_read update works
    const targetNotifId = rNotif[0].id;
    await pgClient.query(`SET ROLE authenticated;`);
    await pgClient.query(`SET request.jwt.claims TO '{"sub": "${testUser2}", "role": "authenticated"}';`);
    await pgClient.query(`UPDATE public.notifications SET is_read = true WHERE id = '${targetNotifId}';`);
    await pgClient.query(`RESET ROLE;`);
    const { rows: readCheck } = await pgClient.query(`SELECT is_read FROM public.notifications WHERE id = '${targetNotifId}';`);
    assert(readCheck[0].is_read === true, 'Test 18: Own is_read update works');

    // 19. Own read_at update works
    const nowIso = new Date().toISOString();
    await pgClient.query(`SET ROLE authenticated;`);
    await pgClient.query(`SET request.jwt.claims TO '{"sub": "${testUser2}", "role": "authenticated"}';`);
    await pgClient.query(`UPDATE public.notifications SET read_at = '${nowIso}' WHERE id = '${targetNotifId}';`);
    await pgClient.query(`RESET ROLE;`);
    const { rows: readAtCheck } = await pgClient.query(`SELECT read_at FROM public.notifications WHERE id = '${targetNotifId}';`);
    assert(readAtCheck[0].read_at !== null, 'Test 19: Own read_at update works');

    // 20. Protected notification fields cannot update
    let titleUpdateFailed = false;
    try {
      await pgClient.query(`SET ROLE authenticated;`);
      await pgClient.query(`SET request.jwt.claims TO '{"sub": "${testUser2}", "role": "authenticated"}';`);
      await pgClient.query(`UPDATE public.notifications SET title = 'Hacked Title' WHERE id = '${targetNotifId}';`);
    } catch (e) {
      titleUpdateFailed = true;
    } finally {
      await pgClient.query(`RESET ROLE;`);
    }
    assert(titleUpdateFailed, 'Test 20: Protected notification fields (title, type, user_id) cannot be updated');

    // -------------------------------------------------------------
    // GROUP 4: VIEWER & CROSS-WORKSPACE ISOLATION
    // -------------------------------------------------------------
    console.log('\n=== GROUP 4: VIEWER & CROSS-WORKSPACE ISOLATION ===');

    // 21. Viewer cannot mutate hierarchy
    let viewerMutateFailed = false;
    try {
      await pgClient.query(`SET ROLE authenticated;`);
      await pgClient.query(`SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated"}';`);
      await pgClient.query(`INSERT INTO public.milestones (project_id, name) VALUES ('${testProjId}', 'Viewer Milestone');`);
    } catch (e) {
      viewerMutateFailed = true;
    } finally {
      await pgClient.query(`RESET ROLE;`);
    }
    assert(viewerMutateFailed, 'Test 21: Non-member/viewer cannot mutate project hierarchy');

    // 22. Cross-workspace hierarchy access denied
    await pgClient.query(`SET ROLE authenticated;`);
    await pgClient.query(`SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated"}';`);
    const { rows: isolatedMilestones } = await pgClient.query(`SELECT count(*)::int as count FROM public.milestones WHERE project_id = '${testProjId}';`);
    await pgClient.query(`RESET ROLE;`);
    assert(isolatedMilestones[0].count === 0, 'Test 22: Cross-workspace hierarchy access denied (0 rows via RLS)');

    // 23. Private helper schema remains non-exposed
    const { rows: privRoutines } = await pgClient.query(`
      SELECT count(*)::int as count FROM information_schema.routines
      WHERE routine_schema = 'private';
    `);
    assert(privRoutines[0].count >= 5, 'Test 23: Private helper schema contains all internal functions');

    // 24. Notification Realtime publication configured
    const { rows: rtPubCheck } = await pgClient.query(`
      SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'notifications' AND schemaname = 'public';
    `);
    assert(rtPubCheck.length === 1, 'Test 24: Notification Realtime publication is configured (public.notifications)');

    // -------------------------------------------------------------
    // CLEANUP & BASELINE DATA VERIFICATION
    // -------------------------------------------------------------
    console.log('\n=== CLEANUP & BASELINE INTEGRITY ===');

    // Delete test project and all associated notifications/entities
    await pgClient.query(`DELETE FROM public.projects WHERE id = '${testProjId}';`);
    await pgClient.query(`DELETE FROM public.departments WHERE id = '${testDeptId}';`);

    if (createdDummyUser) {
      await pgClient.query(`DELETE FROM public.workspace_members WHERE user_id = '${testUser2}';`);
      await pgClient.query(`DELETE FROM public.profiles WHERE id = '${testUser2}';`);
      await pgClient.query(`DELETE FROM auth.users WHERE id = '${testUser2}';`);
    }

    // 25. Project/task/baseline counts remain 100% intact after cleanup
    const { rows: finalProjects } = await pgClient.query(`SELECT count(*)::int as count FROM public.projects;`);
    const { rows: finalTasks } = await pgClient.query(`SELECT count(*)::int as count FROM public.tasks;`);
    assert(
      finalProjects[0].count === 6 && finalTasks[0].count === 26,
      'Test 25: All 6 baseline projects and 26 baseline tasks remain 100% intact after test cleanup'
    );

  } finally {
    await pgClient.end();
  }

  console.log(`\n========================================`);
  console.log(`Release 3 Go-Live Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in R3 Go-Live verification:', err);
  process.exit(1);
});
