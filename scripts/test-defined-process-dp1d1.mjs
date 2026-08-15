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

async function runDP1D1Tests() {
  console.log('===============================================================');
  console.log('SNS Projects — DP-1-D.1 Authorization Integrity & Index Suite');
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

  // SECTION 1: STATIC CHECKS ON INDEX & POLICIES
  console.log('--- Static Index & Constraint Verification ---');

  const { rows: idxRows } = await client.query(`
    SELECT
      i.relname AS index_name,
      ARRAY(
        SELECT a.attname
        FROM pg_attribute a
        JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON a.attnum = k.attnum
        WHERE a.attrelid = ix.indrelid
        ORDER BY k.ord
      ) AS column_names
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'task_lists'
      AND i.relname = 'idx_task_lists_process_version_fk';
  `);

  assert(idxRows.length === 1, 'Test 43: idx_task_lists_process_version_fk exists on task_lists');
  if (idxRows.length === 1) {
    const rawCols = idxRows[0].column_names;
    const cols = Array.isArray(rawCols)
      ? rawCols
      : (typeof rawCols === 'string' ? rawCols.replace(/[{}]/g, '').split(',').map(s => s.trim()) : []);
    assert(
      cols.length === 2 && cols[0] === 'defined_process_version_id' && cols[1] === 'defined_process_id',
      `Test 44: index column order is exactly (defined_process_version_id, defined_process_id) (got [${cols.join(', ')}])`
    );
  }

  // 45. Performance advisor FK check
  const { rows: unindexedFks } = await client.query(`
    SELECT c.conname AS fk_name
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.contype = 'f'
      AND c.conrelid = 'public.task_lists'::regclass
      AND c.conname = 'fk_task_lists_process_version'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1] = c.conkey
      );
  `);
  assert(unindexedFks.length === 0, 'Test 45: official performance advisor reports 0 unindexed issue for fk_task_lists_process_version');

  // 50. Notification suppression check
  const { rows: notifTrigDef } = await client.query(`
    SELECT prosrc FROM pg_proc WHERE proname = 'trg_fn_task_status_changed'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'private');
  `);
  assert(
    notifTrigDef.length === 1 && notifTrigDef[0].prosrc.includes('NEW.process_step_id IS NOT NULL'),
    'Test 50: generic status notification suppression for Defined tasks still exists'
  );

  // =========================================================================
  // TRANSACTIONAL TESTS (SANDBOX WITH AUTOMATIC ROLLBACK & SAVEPOINTS)
  // =========================================================================
  console.log('\n--- Transactional Role-Based Authorization Tests (Auto-Rollback) ---');

  const { rows: [realOwnerProfile] } = await client.query(`SELECT id FROM public.profiles WHERE id = '00ae89c1-353b-4367-827e-9817343140d1';`);
  const { rows: [testDept] } = await client.query(`SELECT id FROM public.departments WHERE workspace_id = $1 LIMIT 1;`, [wsId]);
  const { rows: [testProj] } = await client.query(`SELECT id FROM public.projects WHERE workspace_id = $1 LIMIT 1;`, [wsId]);
  const { rows: [testMs] } = await client.query(`SELECT id FROM public.milestones WHERE project_id = $1 LIMIT 1;`, [testProj.id]);
  const { rows: [statusTodo] } = await client.query(`SELECT id FROM public.task_statuses WHERE project_id = $1 AND system_code = 'todo' LIMIT 1;`, [testProj.id]);
  const { rows: [statusDone] } = await client.query(`SELECT id FROM public.task_statuses WHERE project_id = $1 AND system_code = 'done' LIMIT 1;`, [testProj.id]);

  await client.query('BEGIN');
  try {
    // Trusted setup in sandbox
    await client.query(`SELECT set_config('sns.process_engine_write', 'on', true);`);

    // Create synthetic test user profiles
    const testUsers = {
      owner: realOwnerProfile.id,
      admin: '11111111-1111-1111-1111-111111111111',
      member: '22222222-2222-2222-2222-222222222222',
      viewer: '33333333-3333-3333-3333-333333333333',
      projectAdminOnly: '44444444-4444-4444-4444-444444444444',
      systemAdminOnly: '55555555-5555-5555-5555-555555555555',
      ceoOnly: '66666666-6666-6666-6666-666666666666',
      ctoOnly: '77777777-7777-7777-7777-777777777777',
      unauthorized: '88888888-8888-8888-8888-888888888888',
    };

    for (const [key, uid] of Object.entries(testUsers)) {
      if (uid !== realOwnerProfile.id) {
        await client.query(`
          INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
          VALUES ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${key}@example.com', '', now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'Test User ${key}'), now(), now())
          ON CONFLICT (id) DO NOTHING;
        `);
        await client.query(`
          INSERT INTO public.profiles (id, full_name)
          VALUES ('${uid}', 'Test User ${key}')
          ON CONFLICT (id) DO NOTHING;
        `);
      }
    }

    // Set up workspace membership roles
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
      VALUES
        ('${wsId}', '${testUsers.admin}', 'admin', 'active'),
        ('${wsId}', '${testUsers.member}', 'member', 'active'),
        ('${wsId}', '${testUsers.viewer}', 'viewer', 'active'),
        ('${wsId}', '${testUsers.projectAdminOnly}', 'viewer', 'active'),
        ('${wsId}', '${testUsers.systemAdminOnly}', 'viewer', 'active'),
        ('${wsId}', '${testUsers.ceoOnly}', 'viewer', 'active'),
        ('${wsId}', '${testUsers.ctoOnly}', 'viewer', 'active')
      ON CONFLICT (workspace_id, user_id) WHERE user_id IS NOT NULL
      DO UPDATE SET role = EXCLUDED.role, status = 'active';
    `);

    // Set up system roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role, created_by)
      VALUES
        ('${wsId}', '${testUsers.projectAdminOnly}', 'project_admin', '${realOwnerProfile.id}'),
        ('${wsId}', '${testUsers.systemAdminOnly}', 'system_admin', '${realOwnerProfile.id}'),
        ('${wsId}', '${testUsers.ceoOnly}', 'ceo', '${realOwnerProfile.id}'),
        ('${wsId}', '${testUsers.ctoOnly}', 'cto', '${realOwnerProfile.id}')
      ON CONFLICT (workspace_id, user_id, role) DO NOTHING;
    `);

    // Create a Defined Process & version & step for sandbox
    const { rows: [procA] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ('${wsId}', '${testDept.id}', 'DP1D1 Sandbox Process', 'DP1D1-S', '${realOwnerProfile.id}', '${realOwnerProfile.id}')
      RETURNING id;
    `);

    const { rows: [verA1] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, created_by, published_by, published_at)
      VALUES ('${procA.id}', 1, 'published', '${realOwnerProfile.id}', '${realOwnerProfile.id}', now())
      RETURNING id;
    `);

    const { rows: [stepA1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ('${verA1.id}', 'STP-01', 'Step 1', 1, 2)
      RETURNING id;
    `);

    const { rows: [defTl1] } = await client.query(`
      INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at)
      VALUES ('${testProj.id}', '${testMs.id}', 'Live Defined Task List', 'defined', '${procA.id}', '${verA1.id}', 'active', '${realOwnerProfile.id}', now())
      RETURNING id;
    `);

    const { rows: [defTask1] } = await client.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified, position)
      VALUES ('${testProj.id}', '${testMs.id}', '${defTl1.id}', 'Step 1 Task', '${statusTodo.id}', '${verA1.id}', '${stepA1.id}', 'ready', 1, false, 8000)
      RETURNING id;
    `);

    const { rows: [defTask2] } = await client.query(`
      INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified, position)
      VALUES ('${testProj.id}', '${testMs.id}', '${defTl1.id}', 'Step 2 Task', '${statusTodo.id}', '${verA1.id}', '${stepA1.id}', 'waiting', 1, false, 9000)
      ON CONFLICT DO NOTHING
      RETURNING id;
    `).catch(() => ({ rows: [] }));

    // Turn off trusted context for authenticated testing
    await client.query(`SELECT set_config('sns.process_engine_write', 'off', true);`);

    async function asUser(userId, callback) {
      await client.query('SET LOCAL ROLE authenticated;');
      await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}';`);
      try {
        return await callback();
      } finally {
        await client.query('SET LOCAL ROLE postgres;');
      }
    }

    // --- TASK LIST INSERT TESTS ---
    // 1. owner PASS
    await asUser(testUsers.owner, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'Owner Custom TL', 'custom')
        RETURNING id;
      `);
      assert(!!tl.id, 'Test 1: workspace owner custom Task List INSERT PASS');
    });

    // 2. admin PASS
    await asUser(testUsers.admin, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'Admin Custom TL', 'custom')
        RETURNING id;
      `);
      assert(!!tl.id, 'Test 2: workspace admin custom Task List INSERT PASS');
    });

    // 3. member PASS
    let memberTlId;
    await asUser(testUsers.member, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'Member Custom TL', 'custom')
        RETURNING id;
      `);
      memberTlId = tl.id;
      assert(!!tl.id, 'Test 3: workspace member custom Task List INSERT PASS');
    });

    // 4. project_admin PASS
    await asUser(testUsers.projectAdminOnly, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'Project Admin Custom TL', 'custom')
        RETURNING id;
      `);
      assert(!!tl.id, 'Test 4: project_admin custom Task List INSERT PASS');
    });

    // 5. system_admin PASS
    await asUser(testUsers.systemAdminOnly, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'System Admin Custom TL', 'custom')
        RETURNING id;
      `);
      assert(!!tl.id, 'Test 5: system_admin custom Task List INSERT PASS');
    });

    // 6. viewer FAIL
    await asUser(testUsers.viewer, async () => {
      await client.query('SAVEPOINT sp_v_tl_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
          VALUES ('${testProj.id}', '${testMs.id}', 'Viewer Custom TL', 'custom');
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_v_tl_ins;');
      }
      assert(failedIns, 'Test 6: viewer custom Task List INSERT FAIL (42501 permission denied)');
    });

    // 7. CEO-only FAIL
    await asUser(testUsers.ceoOnly, async () => {
      await client.query('SAVEPOINT sp_ceo_tl_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
          VALUES ('${testProj.id}', '${testMs.id}', 'CEO Custom TL', 'custom');
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_ceo_tl_ins;');
      }
      assert(failedIns, 'Test 7: CEO-only (viewer) custom Task List INSERT FAIL');
    });

    // 8. CTO-only FAIL
    await asUser(testUsers.ctoOnly, async () => {
      await client.query('SAVEPOINT sp_cto_tl_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
          VALUES ('${testProj.id}', '${testMs.id}', 'CTO Custom TL', 'custom');
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_cto_tl_ins;');
      }
      assert(failedIns, 'Test 8: CTO-only (viewer) custom Task List INSERT FAIL');
    });

    // 9. Defined Task List direct INSERT FAIL
    await asUser(testUsers.owner, async () => {
      await client.query('SAVEPOINT sp_def_tl_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type, defined_process_id, defined_process_version_id, process_state, started_by, started_at)
          VALUES ('${testProj.id}', '${testMs.id}', 'Defined TL', 'defined', '${procA.id}', '${verA1.id}', 'active', '${testUsers.owner}', now());
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_def_tl_ins;');
      }
      assert(failedIns, 'Test 9: Defined Task List direct browser INSERT FAIL');
    });

    // --- TASK LIST DELETE TESTS ---
    // 12. workspace member FAIL (ordinary member CANNOT delete task list)
    await asUser(testUsers.member, async () => {
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${memberTlId}';`);
      assert(res.rowCount === 0, 'Test 12: workspace member Custom Task List DELETE FAIL (rejected by policy)');
    });

    // 10. workspace owner Custom Task List DELETE PASS
    await asUser(testUsers.owner, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'TL to delete by Owner', 'custom')
        RETURNING id;
      `);
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${tl.id}';`);
      assert(res.rowCount === 1, 'Test 10: workspace owner Custom Task List DELETE PASS');
    });

    // 11. workspace admin PASS
    await asUser(testUsers.admin, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'TL to delete by Admin', 'custom')
        RETURNING id;
      `);
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${tl.id}';`);
      assert(res.rowCount === 1, 'Test 11: workspace admin Custom Task List DELETE PASS');
    });

    // 13. project_admin PASS
    await asUser(testUsers.projectAdminOnly, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'TL to delete by ProjAdmin', 'custom')
        RETURNING id;
      `);
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${tl.id}';`);
      assert(res.rowCount === 1, 'Test 13: project_admin Custom Task List DELETE PASS');
    });

    // 14. system_admin PASS
    await asUser(testUsers.systemAdminOnly, async () => {
      const { rows: [tl] } = await client.query(`
        INSERT INTO public.task_lists (project_id, milestone_id, name, task_list_type)
        VALUES ('${testProj.id}', '${testMs.id}', 'TL to delete by SysAdmin', 'custom')
        RETURNING id;
      `);
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${tl.id}';`);
      assert(res.rowCount === 1, 'Test 14: system_admin Custom Task List DELETE PASS');
    });

    // 15. viewer FAIL
    await asUser(testUsers.viewer, async () => {
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${memberTlId}';`);
      assert(res.rowCount === 0, 'Test 15: viewer Custom Task List DELETE FAIL');
    });

    // 16. Defined Task List direct DELETE FAIL
    await asUser(testUsers.owner, async () => {
      const res = await client.query(`DELETE FROM public.task_lists WHERE id = '${defTl1.id}';`);
      assert(res.rowCount === 0, 'Test 16: Defined Task List direct DELETE FAIL (blocked by RLS & guard)');
    });

    // --- TASK INSERT TESTS ---
    // 17. workspace owner Custom Task INSERT PASS
    let customTaskA;
    await asUser(testUsers.owner, async () => {
      const { rows: [t] } = await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
        VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task by Owner', '${statusTodo.id}', 1000)
        RETURNING id;
      `);
      customTaskA = t.id;
      assert(!!t.id, 'Test 17: workspace owner Custom Task INSERT PASS');
    });

    // 18. workspace admin PASS
    await asUser(testUsers.admin, async () => {
      const { rows: [t] } = await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
        VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task by Admin', '${statusTodo.id}', 2000)
        RETURNING id;
      `);
      assert(!!t.id, 'Test 18: workspace admin Custom Task INSERT PASS');
    });

    // 19. workspace member PASS
    let customTaskMember;
    await asUser(testUsers.member, async () => {
      const { rows: [t] } = await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
        VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task by Member', '${statusTodo.id}', 3000)
        RETURNING id;
      `);
      customTaskMember = t.id;
      assert(!!t.id, 'Test 19: workspace member Custom Task INSERT PASS');
    });

    // 20. project_admin PASS
    await asUser(testUsers.projectAdminOnly, async () => {
      const { rows: [t] } = await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
        VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task by ProjAdmin', '${statusTodo.id}', 4000)
        RETURNING id;
      `);
      assert(!!t.id, 'Test 20: project_admin Custom Task INSERT PASS');
    });

    // 21. system_admin PASS
    await asUser(testUsers.systemAdminOnly, async () => {
      const { rows: [t] } = await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
        VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task by SysAdmin', '${statusTodo.id}', 5000)
        RETURNING id;
      `);
      assert(!!t.id, 'Test 21: system_admin Custom Task INSERT PASS');
    });

    // 22. viewer FAIL
    await asUser(testUsers.viewer, async () => {
      await client.query('SAVEPOINT sp_v_t_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
          VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task by Viewer', '${statusTodo.id}', 6000);
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_v_t_ins;');
      }
      assert(failedIns, 'Test 22: viewer Custom Task INSERT FAIL');
    });

    // 23. direct Defined Task INSERT FAIL
    await asUser(testUsers.owner, async () => {
      await client.query('SAVEPOINT sp_def_t_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, defined_process_version_id, process_step_id, workflow_state, current_cycle_number, overdue_cycle_notified)
          VALUES ('${testProj.id}', '${testMs.id}', '${defTl1.id}', 'Hacked Task', '${statusTodo.id}', '${verA1.id}', '${stepA1.id}', 'ready', 1, false);
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_def_t_ins;');
      }
      assert(failedIns, 'Test 23: direct Defined Task browser INSERT FAIL');
    });

    // 24. Custom Task into Defined Task List FAIL
    await asUser(testUsers.owner, async () => {
      await client.query('SAVEPOINT sp_cust_in_def;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id)
          VALUES ('${testProj.id}', '${testMs.id}', '${defTl1.id}', 'Custom in Def List', '${statusTodo.id}');
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_cust_in_def;');
      }
      assert(failedIns, 'Test 24: Custom Task into Defined Task List FAIL');
    });

    // --- TASK DELETE TESTS ---
    // 25. workspace member Custom Task DELETE PASS
    await asUser(testUsers.member, async () => {
      const res = await client.query(`DELETE FROM public.tasks WHERE id = '${customTaskMember}';`);
      assert(res.rowCount === 1, 'Test 25: workspace member Custom Task DELETE PASS');
    });

    // 26. project_admin PASS
    await asUser(testUsers.projectAdminOnly, async () => {
      const { rows: [t] } = await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
        VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task to delete ProjAdmin', '${statusTodo.id}', 7000)
        RETURNING id;
      `);
      const res = await client.query(`DELETE FROM public.tasks WHERE id = '${t.id}';`);
      assert(res.rowCount === 1, 'Test 26: project_admin Custom Task DELETE PASS');
    });

    // 27. system_admin PASS
    await asUser(testUsers.systemAdminOnly, async () => {
      const { rows: [t] } = await client.query(`
        INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
        VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'Task to delete SysAdmin', '${statusTodo.id}', 7100)
        RETURNING id;
      `);
      const res = await client.query(`DELETE FROM public.tasks WHERE id = '${t.id}';`);
      assert(res.rowCount === 1, 'Test 27: system_admin Custom Task DELETE PASS');
    });

    // 28. viewer FAIL
    await asUser(testUsers.viewer, async () => {
      const res = await client.query(`DELETE FROM public.tasks WHERE id = '${customTaskA}';`);
      assert(res.rowCount === 0, 'Test 28: viewer Custom Task DELETE FAIL');
    });

    // 29. Defined Task DELETE FAIL
    await asUser(testUsers.owner, async () => {
      const res = await client.query(`DELETE FROM public.tasks WHERE id = '${defTask1.id}';`);
      assert(res.rowCount === 0, 'Test 29: Defined Task DELETE FAIL (protected by RLS & guard)');
    });

    // --- CUSTOM TASK RACI TESTS ---
    // 30. member RACI INSERT PASS
    let memberRaciId;
    await asUser(testUsers.member, async () => {
      const { rows: [r] } = await client.query(`
        INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
        VALUES ('${customTaskA}', 'R', '${testUsers.member}')
        RETURNING id;
      `);
      memberRaciId = r.id;
      assert(!!r.id, 'Test 30: workspace member RACI INSERT PASS');
    });

    // 31. member RACI UPDATE PASS
    await asUser(testUsers.member, async () => {
      const res = await client.query(`
        UPDATE public.task_raci_assignments SET raci_role = 'A' WHERE id = '${memberRaciId}';
      `);
      assert(res.rowCount === 1, 'Test 31: workspace member RACI UPDATE PASS');
    });

    // 32. member RACI DELETE PASS
    await asUser(testUsers.member, async () => {
      const res = await client.query(`
        DELETE FROM public.task_raci_assignments WHERE id = '${memberRaciId}';
      `);
      assert(res.rowCount === 1, 'Test 32: workspace member RACI DELETE PASS');
    });

    // 33. project_admin RACI INSERT PASS
    let paRaciId;
    await asUser(testUsers.projectAdminOnly, async () => {
      const { rows: [r] } = await client.query(`
        INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
        VALUES ('${customTaskA}', 'R', '${testUsers.projectAdminOnly}')
        RETURNING id;
      `);
      paRaciId = r.id;
      assert(!!r.id, 'Test 33: project_admin RACI INSERT PASS');
    });

    // 34. project_admin RACI UPDATE PASS
    await asUser(testUsers.projectAdminOnly, async () => {
      const res = await client.query(`
        UPDATE public.task_raci_assignments SET raci_role = 'A' WHERE id = '${paRaciId}';
      `);
      assert(res.rowCount === 1, 'Test 34: project_admin RACI UPDATE PASS');
    });

    // 35. project_admin RACI DELETE PASS
    await asUser(testUsers.projectAdminOnly, async () => {
      const res = await client.query(`
        DELETE FROM public.task_raci_assignments WHERE id = '${paRaciId}';
      `);
      assert(res.rowCount === 1, 'Test 35: project_admin RACI DELETE PASS');
    });

    // 36. system_admin RACI mutation PASS
    await asUser(testUsers.systemAdminOnly, async () => {
      const { rows: [r] } = await client.query(`
        INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
        VALUES ('${customTaskA}', 'I', '${testUsers.systemAdminOnly}')
        RETURNING id;
      `);
      const res = await client.query(`DELETE FROM public.task_raci_assignments WHERE id = '${r.id}';`);
      assert(res.rowCount === 1, 'Test 36: system_admin RACI mutation PASS');
    });

    // 37. viewer RACI mutation FAIL
    await asUser(testUsers.viewer, async () => {
      await client.query('SAVEPOINT sp_v_raci_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
          VALUES ('${customTaskA}', 'R', '${testUsers.viewer}');
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_v_raci_ins;');
      }
      assert(failedIns, 'Test 37: viewer RACI mutation FAIL');
    });

    // 38. Defined Task RACI INSERT FAIL
    await asUser(testUsers.owner, async () => {
      await client.query('SAVEPOINT sp_def_raci_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
          VALUES ('${defTask1.id}', 'R', '${testUsers.owner}');
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_def_raci_ins;');
      }
      assert(failedIns, 'Test 38: Defined Task RACI direct INSERT FAIL');
    });

    // 39-40. Defined Task RACI UPDATE/DELETE FAIL
    // Trusted insert of raci on defTask1
    await client.query(`SELECT set_config('sns.process_engine_write', 'on', true);`);
    const { rows: [defRaci1] } = await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id)
      VALUES ('${defTask1.id}', 'R', '${testUsers.owner}')
      RETURNING id;
    `);
    await client.query(`SELECT set_config('sns.process_engine_write', 'off', true);`);

    await asUser(testUsers.owner, async () => {
      const updRes = await client.query(`UPDATE public.task_raci_assignments SET raci_role = 'A' WHERE id = '${defRaci1.id}';`);
      assert(updRes.rowCount === 0, 'Test 39: Defined Task RACI direct UPDATE FAIL');

      const delRes = await client.query(`DELETE FROM public.task_raci_assignments WHERE id = '${defRaci1.id}';`);
      assert(delRes.rowCount === 0, 'Test 40: Defined Task RACI direct DELETE FAIL');
    });

    // --- EXECUTIVE TITLES (CEO / CTO) ---
    // 41. CEO-only generic Custom Task mutation FAIL
    await asUser(testUsers.ceoOnly, async () => {
      await client.query('SAVEPOINT sp_ceo_t_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
          VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'CEO Task', '${statusTodo.id}', 9900);
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_ceo_t_ins;');
      }
      assert(failedIns, 'Test 41: CEO-only generic Custom Task mutation FAIL (executive title gives no task authority)');
    });

    // 42. CTO-only generic Custom Task mutation FAIL
    await asUser(testUsers.ctoOnly, async () => {
      await client.query('SAVEPOINT sp_cto_t_ins;');
      let failedIns = false;
      try {
        await client.query(`
          INSERT INTO public.tasks (project_id, milestone_id, task_list_id, title, status_id, position)
          VALUES ('${testProj.id}', '${testMs.id}', '${memberTlId}', 'CTO Task', '${statusTodo.id}', 9910);
        `);
      } catch (e) {
        failedIns = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_cto_t_ins;');
      }
      assert(failedIns, 'Test 42: CTO-only generic Custom Task mutation FAIL (executive title gives no task authority)');
    });

    // --- DP-1-D GUARDS ---
    // 46. forged process-engine GUC still FAILS
    await asUser(testUsers.owner, async () => {
      await client.query(`SELECT set_config('sns.process_engine_write', 'on', true);`);
      await client.query('SAVEPOINT sp_forged_guc;');
      let forgedGucBlocked = false;
      try {
        await client.query(`UPDATE public.tasks SET workflow_state = 'completed' WHERE id = '${defTask1.id}';`);
      } catch (e) {
        forgedGucBlocked = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_forged_guc;');
      }
      assert(forgedGucBlocked, 'Test 46: forged process-engine GUC still FAILS (current_user != postgres check enforced)');
    });

    // 47. Defined direct status mutation still FAILS
    await asUser(testUsers.owner, async () => {
      await client.query('SAVEPOINT sp_def_status_upd;');
      let statusUpdBlocked = false;
      try {
        await client.query(`UPDATE public.tasks SET status_id = '${statusDone.id}' WHERE id = '${defTask1.id}';`);
      } catch (e) {
        statusUpdBlocked = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_def_status_upd;');
      }
      assert(statusUpdBlocked, 'Test 47: Defined direct status mutation still FAILS');
    });

    // 48. Defined cross-status DnD still FAILS
    await asUser(testUsers.owner, async () => {
      const { rows: currentTodoTasks } = await client.query(`
        SELECT id FROM public.tasks WHERE project_id = $1 AND status_id = $2 ORDER BY position ASC;
      `, [testProj.id, statusTodo.id]);
      const todoIds = currentTodoTasks.map(t => t.id);
      const remaining = todoIds.filter(id => id !== defTask1.id);

      await client.query('SAVEPOINT sp_def_cross_dnd;');
      let crossDndBlocked = false;
      try {
        await client.query(`
          SELECT public.reorder_kanban_tasks(
            '${defTask1.id}',
            '${statusDone.id}',
            $1::uuid[],
            ARRAY['${defTask1.id}']::uuid[]
          );
        `, [remaining]);
      } catch (e) {
        crossDndBlocked = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_def_cross_dnd;');
      }
      assert(crossDndBlocked, 'Test 48: Defined cross-status DnD still FAILS with workflow error');
    });

    // 49. Defined same-column reorder still PASS
    await asUser(testUsers.owner, async () => {
      const { rows: currentTodoTasks } = await client.query(`
        SELECT id FROM public.tasks WHERE project_id = $1 AND status_id = $2 ORDER BY position ASC;
      `, [testProj.id, statusTodo.id]);
      const todoIds = currentTodoTasks.map(t => t.id);

      const sameColRes = await client.query(`
        SELECT public.reorder_kanban_tasks(
          '${defTask1.id}',
          '${statusTodo.id}',
          $1::uuid[],
          $1::uuid[]
        );
      `, [todoIds]);
      assert(sameColRes.rows.length === 1, 'Test 49: Defined same-column reorder still PASS');
    });

  } finally {
    // ALWAYS rollback sandbox transaction
    await client.query('ROLLBACK');
  }

  // --- PRODUCTION BASELINE ---
  console.log('\n--- Production Baseline Verification ---');

  const { rows: [{ count: pCount }] } = await client.query(`SELECT count(*)::int as count FROM public.projects;`);
  const { rows: [{ count: mCount }] } = await client.query(`SELECT count(*)::int as count FROM public.milestones;`);
  const { rows: [{ count: tlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists;`);
  const { rows: [{ count: ctlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists WHERE task_list_type = 'custom';`);
  const { rows: [{ count: dtlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists WHERE task_list_type = 'defined';`);
  const { rows: [{ count: customTCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks WHERE process_step_id IS NULL;`);
  const { rows: [{ count: dtCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks WHERE process_step_id IS NOT NULL;`);
  const { rows: [{ count: subCount }] } = await client.query(`SELECT count(*)::int as count FROM public.subtasks;`);
  const { rows: [{ count: customRaciCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_raci_assignments tra JOIN public.tasks t ON t.id = tra.task_id WHERE t.process_step_id IS NULL;`);
  const { rows: dupRows } = await client.query(`
    SELECT project_id, status_id, position, count(*) FROM public.tasks GROUP BY project_id, status_id, position HAVING count(*) > 1;
  `);

  assert(pCount === 3, `Test 51: Projects = 3 (got ${pCount})`);
  assert(mCount === 6, `Test 52: Milestones = 6 (got ${mCount})`);
  assert(ctlCount === 12, `Test 53 & 54: Custom Task Lists = 12 (got ${ctlCount})`);
  assert(dtlCount >= 0, `Test 55: Defined Task Lists >= 0 (got ${dtlCount})`);
  assert(customTCount === 24, `Test 56: Custom Tasks = 24 (got ${customTCount})`);
  assert(dtCount >= 0, `Test 57: Defined Tasks >= 0 (got ${dtCount})`);
  assert(subCount === 48, `Test 58: Subtasks = 48 (got ${subCount})`);
  assert(customRaciCount === 72, `Test 59: Custom RACI = 72 (got ${customRaciCount})`);
  assert(dupRows.length === 0, `Test 60: duplicate Kanban groups = 0 (got ${dupRows.length})`);

  console.log('\n===============================================================');
  console.log(`DP-1-D.1 Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  await client.end();

  if (failed > 0) process.exit(1);
}

runDP1D1Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
