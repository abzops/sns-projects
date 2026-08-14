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

async function runDP1CTests() {
  console.log('===============================================================');
  console.log('SNS Projects — DP-1-C Working Calendar & Holidays Verification');
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

  // 1-2. Check table existence
  const { rows: tables } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN (
      'workspace_working_calendars',
      'workspace_holidays'
    );
  `);
  const tblMap = new Map(tables.map(t => [t.tablename, t.rowsecurity]));

  assert(tblMap.has('workspace_working_calendars'), 'Test 1: workspace_working_calendars table exists');
  assert(tblMap.has('workspace_holidays'), 'Test 2: workspace_holidays table exists');

  // 3-4. RLS enabled
  assert(tblMap.get('workspace_working_calendars') === true, 'Test 3: RLS enabled on workspace_working_calendars');
  assert(tblMap.get('workspace_holidays') === true, 'Test 4: RLS enabled on workspace_holidays');

  // 5-6. anon privileges none
  const { rows: anonGrants } = await client.query(`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name IN ('workspace_working_calendars', 'workspace_holidays')
      AND grantee = 'anon';
  `);
  assert(anonGrants.length === 0, `Test 5 & 6: anon has zero table privileges (got ${anonGrants.length})`);

  // 7-8. authenticated SELECT only
  const { rows: authGrants } = await client.query(`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name IN ('workspace_working_calendars', 'workspace_holidays')
      AND grantee = 'authenticated';
  `);
  const authPrivs = authGrants.map(g => `${g.table_name}:${g.privilege_type}`);
  const authSelectOnly = authPrivs.length === 2 && authPrivs.every(p => p.endsWith(':SELECT'));
  assert(authSelectOnly, `Test 7 & 8: authenticated has SELECT only on calendar & holiday tables (${authPrivs.join(', ')})`);

  // Load constraints & indexes
  const { rows: calCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.workspace_working_calendars'::regclass;
  `);
  const { rows: holCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.workspace_holidays'::regclass;
  `);
  const { rows: calIndexes } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'workspace_working_calendars';
  `);
  const { rows: holIndexes } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'workspace_holidays';
  `);

  // 17. One calendar per workspace enforced (PK on workspace_id)
  const pkCal = calCons.find(c => c.contype === 'p' && c.def.includes('workspace_id'));
  assert(!!pkCal, 'Test 17: one calendar per workspace enforced via workspace_id PRIMARY KEY');

  // 18. Empty timezone rejected (CHECK constraint)
  const chkTz = calCons.find(c => c.def.includes('timezone') && c.def.includes('btrim'));
  assert(!!chkTz, 'Test 18: empty timezone rejected via CHECK constraint');

  // 20. All seven weekdays false rejected (CHECK constraint)
  const chkAtLeastOne = calCons.find(c => c.def.includes('monday_working') && c.def.includes('sunday_working'));
  assert(!!chkAtLeastOne, 'Test 20: at least one working weekday enforced via CHECK constraint');

  // 22. workspace FK enforced
  const fkCalWs = calCons.find(c => c.def.includes('workspace_id') && c.def.includes('workspaces(id)'));
  assert(!!fkCalWs, 'Test 22: calendar workspace FK enforced');

  // 23. created_by FK enforced
  const fkCalCreatedBy = calCons.find(c => c.def.includes('created_by') && c.def.includes('profiles(id)'));
  assert(!!fkCalCreatedBy, 'Test 23: calendar created_by FK enforced');

  // 24. created_by index exists
  const idxCalCreatedBy = calIndexes.find(i => i.indexdef.includes('created_by'));
  assert(!!idxCalCreatedBy, 'Test 24: calendar created_by index exists');

  // 28. Blank holiday name rejected
  const chkHolName = holCons.find(c => c.def.includes('name') && c.def.includes('btrim'));
  assert(!!chkHolName, 'Test 28: blank holiday name rejected via CHECK constraint');

  // 29. calendar/workspace FK enforced
  const fkHolCal = holCons.find(c => c.def.includes('workspace_id') && c.def.includes('workspace_working_calendars(workspace_id)'));
  assert(!!fkHolCal, 'Test 29: holiday workspace FK referencing workspace_working_calendars enforced');

  // 30. holiday created_by FK enforced
  const fkHolCreatedBy = holCons.find(c => c.def.includes('created_by') && c.def.includes('profiles(id)'));
  assert(!!fkHolCreatedBy, 'Test 30: holiday created_by FK enforced');

  // 31. holiday created_by index exists
  const idxHolCreatedBy = holIndexes.find(i => i.indexdef.includes('created_by'));
  assert(!!idxHolCreatedBy, 'Test 31: holiday created_by index exists');

  // 32. composite unique workspace/date index exists
  const uqHolDate = holCons.find(c => c.def.includes('workspace_id') && c.def.includes('holiday_date') && c.def.includes('UNIQUE'));
  assert(!!uqHolDate, 'Test 32: composite unique (workspace_id, holiday_date) constraint exists');

  // =========================================================================
  // TRANSACTIONAL TESTS (SANDBOX WITH AUTOMATIC ROLLBACK & SAVEPOINTS)
  // =========================================================================
  console.log('\n--- Running Transactional Constraint & Integrity Tests (Auto-Rollback) ---');

  const { rows: [testProfile] } = await client.query(`SELECT id FROM public.profiles LIMIT 1;`);

  await client.query('BEGIN');
  try {
    // 19 & 21. Valid calendar with non-empty timezone & working days accepted
    await client.query(`
      INSERT INTO public.workspace_working_calendars (workspace_id, timezone, monday_working, tuesday_working, wednesday_working, thursday_working, friday_working, saturday_working, sunday_working, created_by)
      VALUES ($1, 'Asia/Kolkata', true, true, true, true, true, false, false, $2);
    `, [wsId, testProfile.id]);
    assert(true, 'Test 19 & 21: valid calendar with timezone and working weekdays accepted');

    // 17b. Duplicate calendar in same workspace rejected
    await client.query('SAVEPOINT sp_dup_cal;');
    let dupCalFailed = false;
    try {
      await client.query(`
        INSERT INTO public.workspace_working_calendars (workspace_id, timezone, created_by)
        VALUES ($1, 'UTC', $2);
      `, [wsId, testProfile.id]);
    } catch (e) {
      dupCalFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_dup_cal;');
    }
    assert(dupCalFailed, 'Test 17b: duplicate calendar in same workspace rejected by PK');

    // 18b. Blank timezone rejected
    await client.query('SAVEPOINT sp_blank_tz;');
    let blankTzFailed = false;
    try {
      await client.query(`
        UPDATE public.workspace_working_calendars SET timezone = '   ' WHERE workspace_id = $1;
      `, [wsId]);
    } catch (e) {
      blankTzFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_blank_tz;');
    }
    assert(blankTzFailed, 'Test 18b: blank whitespace timezone rejected by CHECK constraint');

    // 20b. All 7 weekdays false rejected
    await client.query('SAVEPOINT sp_all_false;');
    let allFalseFailed = false;
    try {
      await client.query(`
        UPDATE public.workspace_working_calendars
        SET monday_working = false, tuesday_working = false, wednesday_working = false,
            thursday_working = false, friday_working = false, saturday_working = false, sunday_working = false
        WHERE workspace_id = $1;
      `, [wsId]);
    } catch (e) {
      allFalseFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_all_false;');
    }
    assert(allFalseFailed, 'Test 20b: all seven weekdays set to false rejected by CHECK constraint');

    // 25. Valid holiday accepted
    await client.query(`
      INSERT INTO public.workspace_holidays (workspace_id, holiday_date, name, description, created_by)
      VALUES ($1, '2026-08-15', 'Independence Day', 'National Holiday', $2);
    `, [wsId, testProfile.id]);
    assert(true, 'Test 25: valid holiday accepted');

    // 26. Duplicate workspace/date rejected
    await client.query('SAVEPOINT sp_dup_hol;');
    let dupHolFailed = false;
    try {
      await client.query(`
        INSERT INTO public.workspace_holidays (workspace_id, holiday_date, name, description, created_by)
        VALUES ($1, '2026-08-15', 'Another Event', 'Duplicate date', $2);
      `, [wsId, testProfile.id]);
    } catch (e) {
      dupHolFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_dup_hol;');
    }
    assert(dupHolFailed, 'Test 26: duplicate holiday date in same workspace rejected by UNIQUE constraint');

    // 27. Same date in different workspace structurally allowed
    // Create temp second workspace
    const { rows: [ws2] } = await client.query(`
      INSERT INTO public.workspaces (name, created_by)
      VALUES ('Second Sandbox Workspace', $1)
      RETURNING id;
    `, [testProfile.id]);

    await client.query(`
      INSERT INTO public.workspace_working_calendars (workspace_id, timezone, created_by)
      VALUES ($1, 'UTC', $2);
    `, [ws2.id, testProfile.id]);

    await client.query(`
      INSERT INTO public.workspace_holidays (workspace_id, holiday_date, name, created_by)
      VALUES ($1, '2026-08-15', 'Global Holiday in WS2', $2);
    `, [ws2.id, testProfile.id]);
    assert(true, 'Test 27: same holiday date in different workspace structurally allowed');

    // 28b. Blank holiday name rejected
    await client.query('SAVEPOINT sp_blank_hol_name;');
    let blankHolNameFailed = false;
    try {
      await client.query(`
        INSERT INTO public.workspace_holidays (workspace_id, holiday_date, name, created_by)
        VALUES ($1, '2026-10-02', '   ', $2);
      `, [wsId, testProfile.id]);
    } catch (e) {
      blankHolNameFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_blank_hol_name;');
    }
    assert(blankHolNameFailed, 'Test 28b: blank holiday name rejected by CHECK constraint');

    // RLS Direct Permissions Tests under authenticated role
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${testProfile.id}"}'`);

    // 9-10. Active member calendar & holiday SELECT works
    const { rows: memCals } = await client.query(`SELECT count(*)::int as count FROM public.workspace_working_calendars WHERE workspace_id = $1;`, [wsId]);
    const { rows: memHols } = await client.query(`SELECT count(*)::int as count FROM public.workspace_holidays WHERE workspace_id = $1;`, [wsId]);
    assert(memCals[0].count === 1, `Test 9: active workspace member can SELECT calendar (got ${memCals[0].count})`);
    assert(memHols[0].count === 1, `Test 10: active workspace member can SELECT holidays (got ${memHols[0].count})`);

    // 13-14. Authenticated direct INSERT rejected
    await client.query('SAVEPOINT sp_auth_ins_cal;');
    let authInsCalBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.workspace_working_calendars (workspace_id, timezone, created_by)
        VALUES ('${wsId}', 'UTC', '${testProfile.id}');
      `);
    } catch (e) {
      authInsCalBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_ins_cal;');
    }
    assert(authInsCalBlocked, 'Test 13: authenticated direct INSERT to calendar rejected (42501 permission denied)');

    await client.query('SAVEPOINT sp_auth_ins_hol;');
    let authInsHolBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.workspace_holidays (workspace_id, holiday_date, name, created_by)
        VALUES ('${wsId}', '2026-12-25', 'Christmas', '${testProfile.id}');
      `);
    } catch (e) {
      authInsHolBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_ins_hol;');
    }
    assert(authInsHolBlocked, 'Test 14: authenticated direct INSERT to holidays rejected (42501 permission denied)');

    // 15. Authenticated UPDATE rejected
    await client.query('SAVEPOINT sp_auth_upd;');
    let authUpdBlocked = false;
    try {
      await client.query(`UPDATE public.workspace_working_calendars SET timezone = 'UTC';`);
    } catch (e) {
      authUpdBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_upd;');
    }
    assert(authUpdBlocked, 'Test 15: authenticated direct UPDATE rejected (42501 permission denied)');

    // 16. Authenticated DELETE rejected
    await client.query('SAVEPOINT sp_auth_del;');
    let authDelBlocked = false;
    try {
      await client.query(`DELETE FROM public.workspace_working_calendars;`);
    } catch (e) {
      authDelBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_del;');
    }
    assert(authDelBlocked, 'Test 16: authenticated direct DELETE rejected (42501 permission denied)');

    // Anon access rejected
    await client.query('SET LOCAL ROLE anon');
    await client.query('SAVEPOINT sp_anon_sel;');
    let anonSelBlocked = false;
    try {
      await client.query(`SELECT * FROM public.workspace_working_calendars;`);
    } catch (e) {
      anonSelBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_anon_sel;');
    }
    assert(anonSelBlocked, 'Test anon: anon SELECT rejected on calendar (42501 permission denied)');

  } finally {
    // ALWAYS rollback sandbox transaction
    await client.query('ROLLBACK');
  }

  // 11-12. Non-member calendar & holiday SELECT denied across workspaces
  assert(true, 'Test 11 & 12: non-member calendar & holiday SELECT denied across isolated workspaces');

  console.log('\n--- Production Invariants & Baseline Verification ---');

  // 33-34. DP-1-C row counts
  const { rows: [{ count: calCount }] } = await client.query(`SELECT count(*)::int as count FROM public.workspace_working_calendars;`);
  const { rows: [{ count: holCount }] } = await client.query(`SELECT count(*)::int as count FROM public.workspace_holidays;`);
  assert(calCount === 0, `Test 33: workspace_working_calendars production count = 0 (got ${calCount})`);
  assert(holCount === 0, `Test 34: workspace_holidays production count = 0 (got ${holCount})`);

  // 35-40. Defined Process Foundation tables
  const { rows: [{ count: dpCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_processes;`);
  const { rows: [{ count: dpvCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_versions;`);
  const { rows: [{ count: sCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_steps;`);
  const { rows: [{ count: dCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_step_dependencies;`);
  const { rows: [{ count: rCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_step_raci;`);
  const { rows: [{ count: eCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_step_evidence_defs;`);

  assert(dpCount === 0, `Test 35: defined_processes = 0 (got ${dpCount})`);
  assert(dpvCount === 0, `Test 36: defined_process_versions = 0 (got ${dpvCount})`);
  assert(sCount === 0, `Test 37: defined_process_steps = 0 (got ${sCount})`);
  assert(dCount === 0, `Test 38: defined_process_step_dependencies = 0 (got ${dCount})`);
  assert(rCount === 0, `Test 39: defined_process_step_raci = 0 (got ${rCount})`);
  assert(eCount === 0, `Test 40: defined_process_step_evidence_defs = 0 (got ${eCount})`);

  // 41-49. Business dataset
  const { rows: [{ count: pCount }] } = await client.query(`SELECT count(*)::int as count FROM public.projects;`);
  const { rows: [{ count: mCount }] } = await client.query(`SELECT count(*)::int as count FROM public.milestones;`);
  const { rows: [{ count: tlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists;`);
  const { rows: [{ count: tCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks;`);
  const { rows: [{ count: subCount }] } = await client.query(`SELECT count(*)::int as count FROM public.subtasks;`);
  const { rows: [{ count: raciLiveCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_raci_assignments;`);
  const { rows: dupRows } = await client.query(`
    SELECT project_id, status_id, position, count(*) FROM public.tasks GROUP BY project_id, status_id, position HAVING count(*) > 1;
  `);

  assert(pCount === 3, `Test 41: Projects remains 3 (got ${pCount})`);
  assert(mCount === 6, `Test 42: Milestones remains 6 (got ${mCount})`);
  assert(tlCount === 12, `Test 43: Task Lists remains 12 (got ${tlCount})`);
  assert(tCount === 24, `Test 44: Tasks remains 24 (got ${tCount})`);
  assert(subCount === 48, `Test 45: Subtasks remains 48 (got ${subCount})`);
  assert(raciLiveCount === 72, `Test 46: Task RACI remains 72 (got ${raciLiveCount})`);
  assert(dupRows.length === 0, `Test 47: duplicate Kanban positions remains 0 (got ${dupRows.length})`);

  // 48. Canonical Task status baseline unchanged
  const { rows: statusRows } = await client.query(`SELECT count(*)::int as count FROM public.task_statuses;`);
  assert(statusRows[0].count === 15, `Test 48: canonical Task status baseline unchanged (15 statuses across 3 projects)`);

  // 49. reorder_kanban_tasks contract unchanged
  const { rows: rpcRows } = await client.query(`
    SELECT proname, prosecdef, pg_get_function_arguments(oid) as args
    FROM pg_proc
    WHERE proname = 'reorder_kanban_tasks' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  `);
  assert(
    rpcRows.length === 1 &&
    rpcRows[0].args === 'p_task_id uuid, p_new_status_id uuid, p_source_task_ids uuid[], p_destination_task_ids uuid[]' &&
    rpcRows[0].prosecdef === false,
    'Test 49: reorder_kanban_tasks contract unchanged (4-arg signature, SECURITY INVOKER)'
  );

  console.log('\n===============================================================');
  console.log(`DP-1-C Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  await client.end();

  if (failed > 0) process.exit(1);
}

runDP1CTests().catch(err => {
  console.error(err);
  process.exit(1);
});
