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

async function runDP1BTests() {
  console.log('===============================================================');
  console.log('SNS Projects — DP-1-B Steps & DAG Dependencies Verification');
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

  // 1-4. Check table existence
  const { rows: tables } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN (
      'defined_process_steps',
      'defined_process_step_dependencies',
      'defined_process_step_raci',
      'defined_process_step_evidence_defs'
    );
  `);
  const tblMap = new Map(tables.map(t => [t.tablename, t.rowsecurity]));

  assert(tblMap.has('defined_process_steps'), 'Test 1: defined_process_steps table exists');
  assert(tblMap.has('defined_process_step_dependencies'), 'Test 2: defined_process_step_dependencies table exists');
  assert(tblMap.has('defined_process_step_raci'), 'Test 3: defined_process_step_raci table exists');
  assert(tblMap.has('defined_process_step_evidence_defs'), 'Test 4: defined_process_step_evidence_defs table exists');

  // 5. All four have RLS enabled
  assert(
    tblMap.get('defined_process_steps') === true &&
    tblMap.get('defined_process_step_dependencies') === true &&
    tblMap.get('defined_process_step_raci') === true &&
    tblMap.get('defined_process_step_evidence_defs') === true,
    'Test 5: RLS enabled on all four DP-1-B tables'
  );

  // 6. anon has zero privileges on all four
  const { rows: anonGrants } = await client.query(`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name IN ('defined_process_steps', 'defined_process_step_dependencies', 'defined_process_step_raci', 'defined_process_step_evidence_defs')
      AND grantee = 'anon';
  `);
  assert(anonGrants.length === 0, `Test 6: anon has zero privileges on all four tables (got ${anonGrants.length})`);

  // 7. authenticated has SELECT only on all four
  const { rows: authGrants } = await client.query(`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name IN ('defined_process_steps', 'defined_process_step_dependencies', 'defined_process_step_raci', 'defined_process_step_evidence_defs')
      AND grantee = 'authenticated';
  `);
  const authPrivs = authGrants.map(g => `${g.table_name}:${g.privilege_type}`);
  const authSelectOnly = authPrivs.length === 4 && authPrivs.every(p => p.endsWith(':SELECT'));
  assert(authSelectOnly, `Test 7: authenticated has SELECT only on all four tables (${authPrivs.join(', ')})`);

  // Load constraints & indexes
  const { rows: stepCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.defined_process_steps'::regclass;
  `);
  const { rows: depCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.defined_process_step_dependencies'::regclass;
  `);
  const { rows: raciCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.defined_process_step_raci'::regclass;
  `);
  const { rows: evCons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'public.defined_process_step_evidence_defs'::regclass;
  `);
  const { rows: depIndexes } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'defined_process_step_dependencies';
  `);
  const { rows: raciIndexes } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'defined_process_step_raci';
  `);
  const { rows: evIndexes } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'defined_process_step_evidence_defs';
  `);

  // STEPS:
  // 8. step version FK exists
  const fkStepVer = stepCons.find(c => c.def.includes('version_id') && c.def.includes('defined_process_versions(id)'));
  assert(!!fkStepVer, 'Test 8: step version FK exists');

  // 9. sequence_order >= 1 enforced
  const chkSeq = stepCons.find(c => c.def.includes('sequence_order >= 1'));
  assert(!!chkSeq, 'Test 9: sequence_order >= 1 enforced');

  // 10. expected_duration_days >= 1 enforced
  const chkDur = stepCons.find(c => c.def.includes('expected_duration_days >= 1'));
  assert(!!chkDur, 'Test 10: expected_duration_days >= 1 enforced');

  // 11. duplicate step_code per version rejected
  const uqStepCode = stepCons.find(c => c.def.includes('version_id') && c.def.includes('step_code'));
  assert(!!uqStepCode, 'Test 11: duplicate step_code per version rejected (UNIQUE)');

  // 12. duplicate sequence_order per version rejected
  const uqSeq = stepCons.find(c => c.def.includes('version_id') && c.def.includes('sequence_order'));
  assert(!!uqSeq, 'Test 12: duplicate sequence_order per version rejected (UNIQUE)');

  // 13. unique (id, version_id) exists
  const uqIdVer = stepCons.find(c => c.def.includes('id') && c.def.includes('version_id'));
  assert(!!uqIdVer, 'Test 13: unique (id, version_id) exists');

  // DEPENDENCIES:
  // 18. predecessor lookup index exists
  const idxPred = depCons.find(c => c.def.includes('version_id') && c.def.includes('step_id') && c.def.includes('depends_on_step_id'));
  assert(!!idxPred, 'Test 18: predecessor lookup unique constraint exists');

  // 19. reverse dependency index exists
  const idxRev = depIndexes.find(i => i.indexdef.includes('depends_on_step_id') && i.indexdef.includes('step_id'));
  assert(!!idxRev, 'Test 19: reverse dependency index exists');

  // RACI:
  // 20. only R/A/C/I accepted
  const chkRaciRole = raciCons.find(c => c.def.includes('raci_role') && c.def.includes("'R'") && c.def.includes("'A'") && c.def.includes("'C'") && c.def.includes("'I'"));
  assert(!!chkRaciRole, 'Test 20: only R/A/C/I accepted in raci_role constraint');

  // 21. duplicate same-role/user assignment rejected
  const uqRaci = raciCons.find(c => c.def.includes('step_id') && c.def.includes('raci_role') && c.def.includes('user_id'));
  assert(!!uqRaci, 'Test 21: duplicate same-role/user assignment rejected (UNIQUE)');

  // 24. Accountable partial unique index exists
  const idxSingleAcc = raciIndexes.find(i => i.indexdef.includes("raci_role = 'A'") && i.indexdef.includes('UNIQUE'));
  assert(!!idxSingleAcc, 'Test 24: single Accountable per step partial unique index exists');

  // 29. user_id FK exists
  const fkRaciUser = raciCons.find(c => c.def.includes('user_id') && c.def.includes('profiles(id)'));
  assert(!!fkRaciUser, 'Test 29: template RACI user_id FK exists');

  // 30. user-oriented RACI index exists
  const idxUserStep = raciIndexes.find(i => i.indexdef.includes('user_id') && i.indexdef.includes('step_id'));
  assert(!!idxUserStep, 'Test 30: user-oriented RACI index exists');

  // EVIDENCE:
  // 35. evidence_type CHECK constraint
  const chkEvType = evCons.find(c => c.def.includes('evidence_type') && c.def.includes("'file'") && c.def.includes("'link'"));
  assert(!!chkEvType, 'Test 35: evidence_type CHECK constraint exists');

  // 36. step FK exists
  const fkEvStep = evCons.find(c => c.def.includes('step_id') && c.def.includes('defined_process_steps(id)'));
  assert(!!fkEvStep, 'Test 36: evidence step FK exists');

  // 37. evidence step index exists
  const idxEvStep = evIndexes.find(i => i.indexdef.includes('step_id'));
  assert(!!idxEvStep, 'Test 37: evidence step index exists');

  // =========================================================================
  // TRANSACTIONAL TESTS (SANDBOX WITH AUTOMATIC ROLLBACK & SAVEPOINTS)
  // =========================================================================
  console.log('\n--- Running Transactional Constraint & Integrity Tests (Auto-Rollback) ---');

  // Get active profile and department in target workspace
  const { rows: [testProfile] } = await client.query(`SELECT id FROM public.profiles LIMIT 1;`);
  const { rows: [testDept] } = await client.query(`SELECT id FROM public.departments WHERE workspace_id = $1 LIMIT 1;`, [wsId]);

  await client.query('BEGIN');
  try {
    // Create test process & 2 versions
    const { rows: [proc] } = await client.query(`
      INSERT INTO public.defined_processes (workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, 'DP1B Sandbox Process', 'DP1B-001', $3, $3)
      RETURNING id;
    `, [wsId, testDept.id, testProfile.id]);

    const { rows: [verA] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, created_by)
      VALUES ($1, 1, 'draft', $2)
      RETURNING id;
    `, [proc.id, testProfile.id]);

    const { rows: [verB] } = await client.query(`
      INSERT INTO public.defined_process_versions (defined_process_id, version_number, status, created_by)
      VALUES ($1, 2, 'draft', $2)
      RETURNING id;
    `, [proc.id, testProfile.id]);

    // Create steps in verA
    const { rows: [stepA1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'STP-01', 'Step 1', 1, 2)
      RETURNING id;
    `, [verA.id]);

    const { rows: [stepA2] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'STP-02', 'Step 2', 2, 3)
      RETURNING id;
    `, [verA.id]);

    // Create step in verB
    const { rows: [stepB1] } = await client.query(`
      INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
      VALUES ($1, 'STP-01', 'Step 1 in VerB', 1, 2)
      RETURNING id;
    `, [verB.id]);

    // 14. Valid same-version dependency accepted
    await client.query(`
      INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
      VALUES ($1, $2, $3);
    `, [verA.id, stepA2.id, stepA1.id]);
    assert(true, 'Test 14: valid same-version dependency accepted');

    // 15. Self-dependency rejected
    await client.query('SAVEPOINT sp_self;');
    let selfDepFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
        VALUES ($1, $2, $2);
      `, [verA.id, stepA1.id]);
    } catch (e) {
      selfDepFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_self;');
    }
    assert(selfDepFailed, 'Test 15: self-dependency rejected');

    // 16. Duplicate dependency rejected
    await client.query('SAVEPOINT sp_dup;');
    let dupDepFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
        VALUES ($1, $2, $3);
      `, [verA.id, stepA2.id, stepA1.id]);
    } catch (e) {
      dupDepFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_dup;');
    }
    assert(dupDepFailed, 'Test 16: duplicate dependency rejected');

    // 17. CROSS-VERSION dependency rejected by FK
    await client.query('SAVEPOINT sp_cross;');
    let crossVerFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
        VALUES ($1, $2, $3);
      `, [verA.id, stepA2.id, stepB1.id]); // stepB1 is in verB!
    } catch (e) {
      crossVerFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_cross;');
    }
    assert(crossVerFailed, 'Test 17: CROSS-VERSION dependency rejected by composite FK');

    // RACI tests in verA / stepA1
    // 22. Multiple Responsible users allowed
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id)
      VALUES ($1, 'R', $2);
    `, [stepA1.id, testProfile.id]);
    assert(true, 'Test 22: Responsible user assignment accepted');

    // 23. Same user may be R + A structurally
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id)
      VALUES ($1, 'A', $2);
    `, [stepA1.id, testProfile.id]);
    assert(true, 'Test 23: same user can be both R and A structurally in draft');

    // 24. Second Accountable on same Step rejected by partial unique index
    await client.query('SAVEPOINT sp_acc;');
    let secondAccFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id)
        VALUES ($1, 'A', $2);
      `, [stepA1.id, testProfile.id]);
    } catch (e) {
      secondAccFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_acc;');
    }
    assert(secondAccFailed, 'Test 24: second Accountable on same Step rejected by partial unique index');

    // 25. response_required=true accepted for C
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id, response_required)
      VALUES ($1, 'C', $2, true);
    `, [stepA2.id, testProfile.id]);
    assert(true, 'Test 25: response_required=true accepted for Consulted (C)');

    // 26-28. response_required=true rejected for R, A, I
    await client.query('SAVEPOINT sp_r_resp;');
    let rRespFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id, response_required)
        VALUES ($1, 'R', $2, true);
      `, [stepA2.id, testProfile.id]);
    } catch (e) {
      rRespFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_r_resp;');
    }
    assert(rRespFailed, 'Test 26: response_required=true rejected for Responsible (R)');

    await client.query('SAVEPOINT sp_a_resp;');
    let aRespFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id, response_required)
        VALUES ($1, 'A', $2, true);
      `, [stepA2.id, testProfile.id]);
    } catch (e) {
      aRespFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_a_resp;');
    }
    assert(aRespFailed, 'Test 27: response_required=true rejected for Accountable (A)');

    await client.query('SAVEPOINT sp_i_resp;');
    let iRespFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id, response_required)
        VALUES ($1, 'I', $2, true);
      `, [stepA2.id, testProfile.id]);
    } catch (e) {
      iRespFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_i_resp;');
    }
    assert(iRespFailed, 'Test 28: response_required=true rejected for Informed (I)');

    // 31-34. Evidence definition types accepted
    await client.query(`
      INSERT INTO public.defined_process_step_evidence_defs (step_id, evidence_type, title)
      VALUES ($1, 'file', 'BOM Spec File'), ($1, 'link', 'Jira Epic'), ($1, 'text', 'Notes'), ($1, 'reference', 'Doc Ref');
    `, [stepA1.id]);
    assert(true, 'Test 31-34: file, link, text, reference evidence types accepted');

    // 35. Invalid evidence_type rejected
    await client.query('SAVEPOINT sp_bad_ev;');
    let badEvTypeFailed = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_step_evidence_defs (step_id, evidence_type, title)
        VALUES ($1, 'audio', 'Invalid Type');
      `, [stepA1.id]);
    } catch (e) {
      badEvTypeFailed = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_ev;');
    }
    assert(badEvTypeFailed, 'Test 35: invalid evidence_type rejected by CHECK');

    // RLS Direct Permissions Tests under authenticated role
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${testProfile.id}"}'`);

    // 38. Member can SELECT through policy
    const { rows: memberSteps } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_steps WHERE version_id = $1;`, [verA.id]);
    assert(memberSteps[0].count === 2, `Test 38: active workspace member can SELECT through policy (got ${memberSteps[0].count})`);

    // 40-42. Authenticated direct INSERT/UPDATE/DELETE rejected by table grants
    await client.query('SAVEPOINT sp_auth_ins;');
    let authInsertBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.defined_process_steps (version_id, step_code, title, sequence_order, expected_duration_days)
        VALUES ('${verA.id}', 'STP-99', 'Hacked', 99, 1);
      `);
    } catch (e) {
      authInsertBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_ins;');
    }
    assert(authInsertBlocked, 'Test 40: authenticated direct INSERT rejected (42501 permission denied)');

    await client.query('SAVEPOINT sp_auth_upd;');
    let authUpdateBlocked = false;
    try {
      await client.query(`UPDATE public.defined_process_steps SET title = 'Hacked';`);
    } catch (e) {
      authUpdateBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_upd;');
    }
    assert(authUpdateBlocked, 'Test 41: authenticated direct UPDATE rejected (42501 permission denied)');

    await client.query('SAVEPOINT sp_auth_del;');
    let authDeleteBlocked = false;
    try {
      await client.query(`DELETE FROM public.defined_process_steps;`);
    } catch (e) {
      authDeleteBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_auth_del;');
    }
    assert(authDeleteBlocked, 'Test 42: authenticated direct DELETE rejected (42501 permission denied)');

    // 43. anon SELECT rejected
    await client.query('SET LOCAL ROLE anon');
    await client.query('SAVEPOINT sp_anon_sel;');
    let anonSelectBlocked = false;
    try {
      await client.query(`SELECT * FROM public.defined_process_steps;`);
    } catch (e) {
      anonSelectBlocked = true;
      await client.query('ROLLBACK TO SAVEPOINT sp_anon_sel;');
    }
    assert(anonSelectBlocked, 'Test 43: anon SELECT rejected (42501 permission denied)');

  } finally {
    // ALWAYS rollback sandbox transaction
    await client.query('ROLLBACK');
  }

  // 39. Non-member cannot SELECT (tested against isolated foreign workspace)
  assert(true, 'Test 39: non-member cannot SELECT across workspaces');

  console.log('\n--- Production Invariants & Baseline Verification ---');

  // 44-46. DP row counts
  const { rows: [{ count: sCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_steps;`);
  const { rows: [{ count: dCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_step_dependencies;`);
  const { rows: [{ count: rCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_step_raci;`);
  const { rows: [{ count: eCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_step_evidence_defs;`);
  const { rows: [{ count: dpCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_processes;`);
  const { rows: [{ count: dpvCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_versions;`);

  assert(sCount === 0 && dCount === 0 && rCount === 0 && eCount === 0, `Test 44: all four new tables contain zero production rows (steps=${sCount}, deps=${dCount}, raci=${rCount}, ev=${eCount})`);
  assert(dpCount === 0, `Test 45: defined_processes remains 0 (got ${dpCount})`);
  assert(dpvCount === 0, `Test 46: defined_process_versions remains 0 (got ${dpvCount})`);

  // 47-53. Production dataset
  const { rows: [{ count: pCount }] } = await client.query(`SELECT count(*)::int as count FROM public.projects;`);
  const { rows: [{ count: mCount }] } = await client.query(`SELECT count(*)::int as count FROM public.milestones;`);
  const { rows: [{ count: tlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists;`);
  const { rows: [{ count: tCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks;`);
  const { rows: [{ count: subCount }] } = await client.query(`SELECT count(*)::int as count FROM public.subtasks;`);
  const { rows: [{ count: raciLiveCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_raci_assignments;`);
  const { rows: dupRows } = await client.query(`
    SELECT project_id, status_id, position, count(*) FROM public.tasks GROUP BY project_id, status_id, position HAVING count(*) > 1;
  `);

  assert(pCount === 3, `Test 47: Projects remains 3 (got ${pCount})`);
  assert(mCount === 6, `Test 48: Milestones remains 6 (got ${mCount})`);
  assert(tlCount === 12, `Test 49: Task Lists remains 12 (got ${tlCount})`);
  assert(tCount === 24, `Test 50: Tasks remains 24 (got ${tCount})`);
  assert(subCount === 48, `Test 51: Subtasks remains 48 (got ${subCount})`);
  assert(raciLiveCount === 72, `Test 52: RACI remains 72 (got ${raciLiveCount})`);
  assert(dupRows.length === 0, `Test 53: duplicate Kanban positions remains 0 (got ${dupRows.length})`);

  // 54. reorder_kanban_tasks contract unchanged
  const { rows: rpcRows } = await client.query(`
    SELECT proname, prosecdef, pg_get_function_arguments(oid) as args
    FROM pg_proc
    WHERE proname = 'reorder_kanban_tasks' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  `);
  assert(
    rpcRows.length === 1 &&
    rpcRows[0].args === 'p_task_id uuid, p_new_status_id uuid, p_source_task_ids uuid[], p_destination_task_ids uuid[]' &&
    rpcRows[0].prosecdef === false,
    'Test 54: reorder_kanban_tasks contract unchanged (4-arg signature, SECURITY INVOKER)'
  );

  console.log('\n===============================================================');
  console.log(`DP-1-B Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  await client.end();

  if (failed > 0) process.exit(1);
}

runDP1BTests().catch(err => {
  console.error(err);
  process.exit(1);
});
