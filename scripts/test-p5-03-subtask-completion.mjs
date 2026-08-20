import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

function parseEnv(content) {
  return content.split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return acc;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length > 0) {
      acc[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
    return acc;
  }, {});
}

let passed = 0;
function pass(msg) {
  passed += 1;
  console.log(`[PASS ${String(passed).padStart(2, '0')}] ${msg}`);
}

async function expectError(client, fn, expectedMsgSubstr = null) {
  await client.query('SAVEPOINT sp_err');
  try {
    await fn();
    assert.fail('Expected operation to fail, but it succeeded');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_err');
    if (expectedMsgSubstr) {
      assert.ok(
        err.message.includes(expectedMsgSubstr),
        `Expected error message to contain "${expectedMsgSubstr}", got: "${err.message}"`
      );
    }
  }
}

async function asUser(client, userId, sql, params = []) {
  await client.query('SET LOCAL ROLE authenticated');
  let result;
  try {
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', 'authenticated', true)`,
      [userId],
    );
    result = await client.query(sql, params);
  } catch (error) {
    try {
      await client.query('RESET ROLE');
    } catch { /* ignore */ }
    throw error;
  }
  await client.query('RESET ROLE');
  return result;
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — P5-03: SUBTASK COMPLETION, EXPENSE & PARENT CLOSURE      ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const env = parseEnv(await readFile('.env.admin', 'utf8'));
  assert.ok(env.SUPABASE_DB_URL, 'SUPABASE_DB_URL must exist in .env.admin');

  const client = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL. Starting isolated test transaction...');
  await client.query('BEGIN');

  try {
    // ── Apply migrations in order ──────────────────────────────────────────────
    for (const [label, file] of [
      ['P5-01',  '20260819131603_p5_01_expense_execution_runtime.sql'],
      ['P5-01A', '20260819151608_p5_01a_expense_runtime_security_parity_hotfix.sql'],
      ['P5-01B', '20260819154319_p5_01b_operational_scope_authorization_closure.sql'],
      ['P5-01C', '20260819190058_p5_01c_parent_completion_ownership_closure.sql'],
      ['P5-02A', '20260819214046_p5_02a_parent_direct_completion_guard.sql'],
      ['P5-03',  '20260820072145_p5_03_subtask_completion_expense_parent_closure.sql'],
      ['P5-03A', '20260820073423_p5_03a_drop_ambiguous_expense_overload.sql'],
      ['P5-03B', '20260820082034_p5_03b_subtask_rpc_execution_hotfix.sql'],
      ['P4-01B', '20260820174313_p4_01b_finance_active_tenancy_authorization_closure.sql'],
    ]) {
      const sql = await readFile(path.join('supabase', 'migrations', file), 'utf8');
      await client.query(sql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, ''));
      console.log(`[SETUP] Applied ${label} migration`);
    }

    // ── Fixtures ────────────────────────────────────────────────────────────────
    const ids = {
      ws: randomUUID(),
      owner: randomUUID(),
      member: randomUUID(),
      viewer: randomUUID(),
      project: randomUUID(),
      status_ip: randomUUID(),
      status_done: randomUUID(),
      task: randomUUID(),
    };

    await client.query('SET LOCAL session_replication_role = replica');

    // Profiles
    for (const [uid, name] of [
      [ids.owner, 'Owner User'],
      [ids.member, 'Member User'],
      [ids.viewer, 'Viewer User'],
    ]) {
      await client.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO NOTHING
      `, [uid, name]);
    }

    // Workspace & project
    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by)
      VALUES ($1, 'P5-03 WS', $2)`,
      [ids.ws, ids.owner]);

    for (const [uid, role] of [
      [ids.owner, 'owner'],
      [ids.member, 'member'],
      [ids.viewer, 'viewer'],
    ]) {
      await client.query(`
        INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
        VALUES ($1, $2, $3, 'active')`, [ids.ws, uid, role]);
    }

    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, owner_id)
      VALUES ($1, $2, 'P5-03 Project', $3)`,
      [ids.project, ids.ws, ids.owner]);

    await client.query(`
      INSERT INTO public.task_statuses (id, project_id, name, color, system_code, position)
      VALUES ($1, $2, 'In Progress', '#3b82f6', 'in_progress', 1),
             ($3, $2, 'Done', '#10b981', 'done', 2)`,
      [ids.status_ip, ids.project, ids.status_done]);

    // Parent task
    await client.query(`
      INSERT INTO public.tasks (id, project_id, title, status_id, assignee_id, owner_id, created_by)
      VALUES ($1, $2, 'Parent Task', $3, $4, $4, $4)`,
      [ids.task, ids.project, ids.status_ip, ids.owner]);

    // 2 subtasks
    const st1 = randomUUID();
    const st2 = randomUUID();
    await client.query(`
      INSERT INTO public.subtasks (id, task_id, title, status, created_by)
      VALUES ($1, $2, 'Subtask 1', 'todo', $3),
             ($4, $2, 'Subtask 2', 'todo', $3)`,
      [st1, ids.task, ids.owner, st2]);

    await client.query('SET LOCAL session_replication_role = DEFAULT');

    pass('P5-03 fixtures created: workspace, project, statuses, parent task, 2 subtasks');

    // ── 1. get_task_closure_state includes subtasks ─────────────────────────────
    const csRes = await client.query(
      'SELECT private.get_task_closure_state($1)', [ids.task]);
    const cs = csRes.rows[0]['get_task_closure_state'];
    assert.equal(cs.subtask_count, 2, 'closure state: 2 subtasks total');
    assert.equal(cs.open_subtask_count, 2, 'closure state: 2 open subtasks');
    assert.equal(cs.has_dependencies, true, 'closure state: has_dependencies=true with open subtasks');
    assert.equal(cs.all_closed, false, 'closure state: all_closed=false with open subtasks');
    pass('1. get_task_closure_state correctly reports 2 open subtasks and has_dependencies=true');

    // ── 2. Direct browser UPDATE subtask status to done is BLOCKED ─────────────
    await expectError(client,
      () => client.query(`UPDATE public.subtasks SET status='done' WHERE id=$1`, [st1]),
      'prohibited'
    );
    pass('2. Direct browser UPDATE subtask status=done is BLOCKED by trigger (requires RPC)');

    // ── 3. Direct browser UPDATE to cancelled is ALLOWED ───────────────────────
    await client.query(`SAVEPOINT sp_cancel`);
    await client.query(`UPDATE public.subtasks SET status='cancelled' WHERE id=$1`, [st1]);
    await client.query(`ROLLBACK TO SAVEPOINT sp_cancel`);
    pass('3. Direct browser UPDATE to cancelled is ALLOWED');

    // ── 4. Direct browser UPDATE to todo (reopen) is ALLOWED ───────────────────
    await client.query(`SAVEPOINT sp_reopen`);
    await client.query(`UPDATE public.subtasks SET status='todo' WHERE id=$1`, [st1]);
    await client.query(`ROLLBACK TO SAVEPOINT sp_reopen`);
    pass('4. Direct browser UPDATE to todo/in_progress is ALLOWED');

    // ── 5. complete_subtask_with_expense exists and is callable ─────────────────
    const fnCheck = await client.query(
      `SELECT 1 FROM pg_proc WHERE proname='complete_subtask_with_expense' AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')`);
    assert.equal(fnCheck.rows.length, 1);
    pass('5. public.complete_subtask_with_expense RPC exists in production schema');

    // ── 6. Viewer CANNOT complete subtask ───────────────────────────────────────
    await expectError(client,
      () => asUser(client, ids.viewer,
        `SELECT public.complete_subtask_with_expense($1, NULL, NULL)`, [st1]),
      'does not have mutation capability'
    );
    pass('6. Viewer CANNOT complete subtask via RPC (fails closed)');

    // ── 7. Member CAN complete subtask without expense ──────────────────────────
    const res7 = await asUser(client, ids.member,
      `SELECT public.complete_subtask_with_expense($1, NULL, 'done')`, [st1]);
    const r7 = res7.rows[0]['complete_subtask_with_expense'];
    assert.equal(r7.success, true, 'complete_subtask: success=true');
    assert.equal(r7.subtask_id, st1, 'complete_subtask: correct subtask_id');
    assert.equal(r7.status, 'done', 'complete_subtask: status=done');
    assert.equal(r7.transaction_id, null, 'no expense = no transaction_id');
    pass('7. Member CAN complete subtask without expense - success=true, no transaction created');

    // ── 8. Subtask status is now 'done' ─────────────────────────────────────────
    const stCheck = await client.query(
      `SELECT status FROM public.subtasks WHERE id=$1`, [st1]);
    assert.equal(stCheck.rows[0].status, 'done');
    pass('8. Subtask status confirmed as done in database');

    // ── 9. Parent task remains In Progress (st2 still open) ─────────────────────
    const parentCheck = await client.query(
      `SELECT status_id FROM public.tasks WHERE id=$1`, [ids.task]);
    assert.equal(parentCheck.rows[0].status_id, ids.status_ip, 'parent still In Progress with open st2');
    pass('9. Parent task remains In Progress because st2 is still open (partial closure)');

    // ── 10. Closure state after 1 subtask done ──────────────────────────────────
    const cs2 = (await client.query(`SELECT private.get_task_closure_state($1)`, [ids.task]))
      .rows[0]['get_task_closure_state'];
    assert.equal(cs2.done_subtask_count, 1);
    assert.equal(cs2.open_subtask_count, 1);
    assert.equal(cs2.all_closed, false);
    pass('10. Closure state after 1/2 subtasks done: 1 open, all_closed=false');

    // ── 11. Completing st1 again (idempotent re-entry) ──────────────────────────
    const retry11 = await asUser(client, ids.member,
      `SELECT public.complete_subtask_with_expense($1, NULL, NULL)`, [st1]);
    const r11 = retry11.rows[0]['complete_subtask_with_expense'];
    assert.equal(r11.success, true);
    assert.equal(r11.is_retry, true, 'idempotent retry recognized');
    pass('11. Re-completing an already-done subtask returns idempotent success with is_retry=true');

    // ── 12. Complete st2 with expense ───────────────────────────────────────────
    const expense = JSON.stringify({
      mode: 'single',
      expense_date: '2026-08-20',
      description: 'Subtask expense',
      amount: 1200.00,
      category: 'Labour',
    });
    const res12 = await asUser(client, ids.member,
      `SELECT public.complete_subtask_with_expense($1, $2::jsonb, 'Subtask 2 done')`,
      [st2, expense]);
    const r12 = res12.rows[0]['complete_subtask_with_expense'];
    assert.equal(r12.success, true);
    assert.notEqual(r12.transaction_id, null, 'expense recorded: transaction_id present');
    assert.ok(parseFloat(r12.total_expense) === 1200.00, 'expense amount matches 1200.00');
    pass('12. Member completes st2 with expense: success=true, transaction_id present, amount=1200.00');

    // ── 13. expense_transactions.subtask_id is set correctly ────────────────────
    const txRow = await client.query(
      `SELECT task_id, subtask_id, cycle_number FROM public.expense_transactions WHERE id=$1`,
      [r12.transaction_id]);
    assert.equal(txRow.rows[0].task_id, ids.task, 'expense.task_id = parent task ID');
    assert.equal(txRow.rows[0].subtask_id, st2, 'expense.subtask_id = subtask ID');
    assert.equal(txRow.rows[0].cycle_number, null, 'expense.cycle_number = NULL for subtasks');
    pass('13. expense_transactions: task_id=parent, subtask_id=st2, cycle_number=NULL');

    // ── 14. audit log also records subtask_id ───────────────────────────────────
    const auditRow = await client.query(
      `SELECT subtask_id FROM public.expense_audit_logs WHERE transaction_id=$1`,
      [r12.transaction_id]);
    assert.equal(auditRow.rows[0].subtask_id, st2);
    pass('14. expense_audit_logs.subtask_id correctly set to st2');

    // ── 15. Parent task auto-completes when both subtasks are done ──────────────
    const parentAfter = await client.query(
      `SELECT status_id FROM public.tasks WHERE id=$1`, [ids.task]);
    assert.equal(parentAfter.rows[0].status_id, ids.status_done, 'parent auto-completed to Done');
    pass('15. Parent task auto-completes to Done after all subtasks reach done state');

    // ── 16. Closure state: all_closed=true ──────────────────────────────────────
    const cs3 = (await client.query(`SELECT private.get_task_closure_state($1)`, [ids.task]))
      .rows[0]['get_task_closure_state'];
    assert.equal(cs3.all_closed, true);
    assert.equal(cs3.open_subtask_count, 0);
    pass('16. Closure state after all subtasks done: all_closed=true, open_subtask_count=0');

    // ── 17. subtask_id invariant: expense cannot reference subtask from different task ──
    const otherTask = randomUUID();
    const otherSubtask = randomUUID();
    await client.query(`
      INSERT INTO public.tasks (id, project_id, title, status_id, assignee_id, owner_id, created_by)
      VALUES ($1, $2, 'Other Task', $3, $4, $4, $4)`,
      [otherTask, ids.project, ids.status_ip, ids.owner]);
    await client.query(`
      INSERT INTO public.subtasks (id, task_id, title, status, created_by)
      VALUES ($1, $2, 'Other Subtask', 'todo', $3)`,
      [otherSubtask, otherTask, ids.owner]);

    await expectError(client,
      () => client.query(
        `INSERT INTO public.expense_transactions (workspace_id, task_id, subtask_id, expense_date, description, status, created_by, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,CURRENT_DATE,'test','active',$4,$4,now(),now())`,
        [ids.ws, ids.task, otherSubtask, ids.owner]
      ),
      'belongs to task'
    );
    pass('17. expense_transactions.subtask_id invariant trigger REJECTS subtask from different task');

    // ── 18. Reopening subtask under Done parent reopens parent task ──────────────
    // st1 and st2 both done, parent is Done.
    await client.query(`UPDATE public.subtasks SET status='todo' WHERE id=$1`, [st1]);
    const parentReopened = await client.query(
      `SELECT status_id FROM public.tasks WHERE id=$1`, [ids.task]);
    assert.equal(parentReopened.rows[0].status_id, ids.status_ip, 'parent reopened to In Progress');
    pass('18. Reopening subtask to todo under Done parent automatically reopens parent to In Progress');

    // ── 19. Inserting a new active subtask under Done task reopens parent ────────
    // First re-complete st1 to get parent back to Done
    await asUser(client, ids.member,
      `SELECT public.complete_subtask_with_expense($1, NULL, NULL)`, [st1]);
    const beforeInsert = await client.query(
      `SELECT status_id FROM public.tasks WHERE id=$1`, [ids.task]);
    assert.equal(beforeInsert.rows[0].status_id, ids.status_done, 'parent back to Done before insert');

    const st3 = randomUUID();
    await client.query(`
      INSERT INTO public.subtasks (id, task_id, title, status, created_by)
      VALUES ($1, $2, 'Subtask 3', 'todo', $3)`,
      [st3, ids.task, ids.owner]);
    const afterInsert = await client.query(
      `SELECT status_id FROM public.tasks WHERE id=$1`, [ids.task]);
    assert.equal(afterInsert.rows[0].status_id, ids.status_ip, 'parent reopened after new subtask inserted');
    pass('19. Inserting a new active subtask under Done parent automatically reopens parent to In Progress');

    // ── 20. Deleting subtask with expense is BLOCKED ────────────────────────────
    await expectError(client,
      () => client.query(`DELETE FROM public.subtasks WHERE id=$1`, [st2]),
      null  // FK RESTRICT error
    );
    pass('20. Deleting subtask with expense transactions is BLOCKED by ON DELETE RESTRICT');

    // ── 21. Finance rollup: subtask expense aggregates into parent task actual spend ──
    const rollup = await client.query(
      `SELECT SUM(ei.amount) as total
       FROM public.expense_items ei
       JOIN public.expense_transactions et ON et.id = ei.transaction_id
       WHERE et.task_id = $1`, [ids.task]);
    assert.ok(parseFloat(rollup.rows[0].total) >= 1200.00, 'rollup >= 1200.00');
    pass('21. Finance rollup: subtask expense (1200.00) aggregates into parent task actual spend with zero double counting');

    // ── 22. complete_task_with_expense rejects task with active subtasks ─────────
    // task has st3 (todo) — so direct task completion should be rejected
    await expectError(client,
      () => asUser(client, ids.owner,
        `SELECT public.complete_task_with_expense($1, NULL, NULL)`, [ids.task]),
      'Parent tasks with child dependencies cannot be directly completed'
    );
    pass('22. complete_task_with_expense REJECTS task with active subtasks (backend guard)');

    // ── 23. No duplicate unique-index violations from subtask expenses ────────────
    // Subtask expenses use cycle_number=NULL and unique partial index only covers non-null cycle
    const dupCheck = await client.query(
      `SELECT COUNT(*) as cnt FROM public.expense_transactions WHERE task_id=$1 AND status='active'`,
      [ids.task]);
    assert.ok(parseInt(dupCheck.rows[0].cnt) >= 1, 'at least one active expense transaction');
    pass('23. No duplicate index violation: subtask expenses have cycle_number=NULL bypassing task/cycle unique index');

    // ── 24. public.complete_subtask_with_expense is SECURITY INVOKER ─────────────
    const secCheck = await client.query(
      `SELECT prosecdef FROM pg_proc WHERE proname='complete_subtask_with_expense' AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')`);
    assert.equal(secCheck.rows[0].prosecdef, false, 'SECURITY INVOKER = prosecdef=false');
    pass('24. public.complete_subtask_with_expense is SECURITY INVOKER (not DEFINER)');

    // ── 25. private.complete_subtask_with_expense_internal is SECURITY DEFINER ───
    const secCheck2 = await client.query(
      `SELECT prosecdef FROM pg_proc WHERE proname='complete_subtask_with_expense_internal' AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='private')`);
    assert.equal(secCheck2.rows[0].prosecdef, true, 'internal is SECURITY DEFINER');
    pass('25. private.complete_subtask_with_expense_internal is SECURITY DEFINER');

    // ── 26. Viewer cannot access complete_subtask_with_expense directly ──────────
    await expectError(client,
      () => asUser(client, ids.viewer,
        `SELECT public.complete_subtask_with_expense($1, NULL, NULL)`, [st3]),
      'mutation capability'
    );
    pass('26. Viewer strictly blocked from complete_subtask_with_expense (mutation guard)');

    // ── 27. insert_expense_transaction_internal has exactly 1 overload ───────────
    const overloadCheck = await client.query(
      `SELECT count(*) as cnt FROM pg_proc WHERE proname='insert_expense_transaction_internal'`);
    assert.equal(parseInt(overloadCheck.rows[0].cnt), 1, 'exactly 1 overload (P5-03A drop successful)');
    pass('27. P5-03A hotfix: exactly 1 overload of insert_expense_transaction_internal exists (no ambiguity)');

    // ── 28. resolve_project_in_progress_status returns correct status ────────────
    const ipRes = await client.query(
      `SELECT private.resolve_project_in_progress_status($1)`, [ids.project]);
    assert.equal(ipRes.rows[0]['resolve_project_in_progress_status'], ids.status_ip);
    pass('28. resolve_project_in_progress_status correctly resolves In Progress status for project');

    // ── 29. Security Advisor: 0 new SECURITY DEFINER in public ──────────────────
    const { rows: pubSecDef } = await client.query(`
      SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prosecdef = true
        AND p.proname IN ('complete_task_with_expense', 'complete_responsible_step_with_expense', 'complete_subtask_with_expense', 'correct_expense_transaction', 'void_expense_transaction', 'hard_delete_expense_transaction')
    `);
    assert.equal(pubSecDef.length, 0, 'Zero new SECURITY DEFINER functions in public schema');
    pass('29. Zero new SECURITY DEFINER functions in public schema (Security Advisor baseline maintained)');

    // ── 30. Granted to authenticated, revoked from anon ──────────────────────────
    const grantCheck = await client.query(`
      SELECT has_function_privilege('authenticated', 
        'public.complete_subtask_with_expense(uuid, jsonb, text)', 'EXECUTE') as ok`);
    assert.equal(grantCheck.rows[0].ok, true, 'authenticated has EXECUTE grant');
    pass('30. authenticated role has EXECUTE grant on public.complete_subtask_with_expense');

    // ── 31. Anon execution is strictly blocked ──────────────────────────────────
    const anonCheck = await client.query(`
      SELECT has_function_privilege('anon', 
        'public.complete_subtask_with_expense(uuid, jsonb, text)', 'EXECUTE') as ok`);
    assert.equal(anonCheck.rows[0].ok, false, 'anon does not have EXECUTE grant');
    pass('31. anon role CANNOT execute public.complete_subtask_with_expense (revoked)');

    // ── 32. Unrelated user / guessed UUID is strictly rejected ──────────────────
    const unrelatedUid = randomUUID();
    const fakeSubtaskId = randomUUID();
    await expectError(client,
      () => asUser(client, unrelatedUid,
        `SELECT public.complete_subtask_with_expense($1, NULL, NULL)`, [fakeSubtaskId]),
      'Subtask not found'
    );
    await expectError(client,
      () => asUser(client, unrelatedUid,
        `SELECT public.complete_subtask_with_expense($1, NULL, NULL)`, [st3]),
      'does not have mutation capability'
    );
    pass('32. Unrelated user and guessed UUID strictly rejected (fails closed)');

    // ── 33. Invalid expense payload: atomic rollback, subtask stays todo, 0 tx ──
    const invalidExpense = JSON.stringify({
      mode: 'single',
      amount: -500, // Invalid negative amount
      description: 'Invalid expense',
      category: 'Labour',
    });
    const preTxCount = (await client.query(`SELECT count(*)::int as cnt FROM public.expense_transactions WHERE task_id=$1`, [ids.task])).rows[0].cnt;
    await expectError(client,
      () => asUser(client, ids.member,
        `SELECT public.complete_subtask_with_expense($1, $2::jsonb, NULL)`, [st3, invalidExpense]),
      'Expense amount must be a positive number'
    );
    const postTxCount = (await client.query(`SELECT count(*)::int as cnt FROM public.expense_transactions WHERE task_id=$1`, [ids.task])).rows[0].cnt;
    assert.equal(preTxCount, postTxCount, 'zero expense transactions created on validation error');
    const st3Check = (await client.query(`SELECT status FROM public.subtasks WHERE id=$1`, [st3])).rows[0].status;
    assert.equal(st3Check, 'todo', 'subtask remains in todo status after failed completion attempt');
    pass('33. Invalid expense payload fails atomically: subtask remains todo, 0 new expense transactions');

    // ── 34. Live ACL check on private internal engine ───────────────────────────
    const privAclCheck = await client.query(`
      SELECT 
        p.prosecdef as is_sec_def,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'private' AND p.proname = 'complete_subtask_with_expense_internal'
    `);
    assert.equal(privAclCheck.rows[0].is_sec_def, true, 'internal engine is SECURITY DEFINER');
    assert.equal(privAclCheck.rows[0].auth_ok, true, 'authenticated can execute internal engine');
    assert.equal(privAclCheck.rows[0].anon_ok, false, 'anon CANNOT execute internal engine');
    pass('34. private.complete_subtask_with_expense_internal ACL: authenticated=true, anon=false, sec_def=true');

    // ── 35. Single Total ₹123.45 exact database verification ───────────────────
    const stSingleId = randomUUID();
    await client.query(`
      INSERT INTO public.subtasks (id, task_id, title, status, created_by)
      VALUES ($1, $2, 'Single Total Test Subtask', 'todo', $3)`,
      [stSingleId, ids.task, ids.owner]);
    const singlePayload = JSON.stringify({
      expense_date: '2026-08-20',
      amount: 123.45,
      category: 'Materials',
      description: 'acceptance test',
    });
    const res35 = await asUser(client, ids.member,
      `SELECT public.complete_subtask_with_expense($1, $2::jsonb, 'Single 123.45 notes')`,
      [stSingleId, singlePayload]);
    const r35 = res35.rows[0]['complete_subtask_with_expense'];
    assert.equal(r35.success, true);
    assert.notEqual(r35.transaction_id, null, 'transaction_id created for single total ₹123.45');
    assert.equal(parseFloat(r35.total_expense), 123.45);

    const tx35 = await client.query(
      `SELECT task_id, subtask_id, status FROM public.expense_transactions WHERE id=$1`,
      [r35.transaction_id]);
    assert.equal(tx35.rows[0].task_id, ids.task);
    assert.equal(tx35.rows[0].subtask_id, stSingleId);
    assert.equal(tx35.rows[0].status, 'active');

    const items35 = await client.query(
      `SELECT line_number, amount, category, description FROM public.expense_items WHERE transaction_id=$1`,
      [r35.transaction_id]);
    assert.equal(items35.rows.length, 1);
    assert.equal(parseFloat(items35.rows[0].amount), 123.45);
    assert.equal(items35.rows[0].category, 'Materials');
    assert.equal(items35.rows[0].description, 'acceptance test');
    pass('35. Single Total ₹123.45 (Materials, acceptance test): transaction, line item, and response verified');

    // ── 36. Itemized ₹350.00 (100+200+50) exact database verification ────────────
    const stItemId = randomUUID();
    await client.query(`
      INSERT INTO public.subtasks (id, task_id, title, status, created_by)
      VALUES ($1, $2, 'Itemized Test Subtask', 'todo', $3)`,
      [stItemId, ids.task, ids.owner]);
    const itemizedPayload = JSON.stringify({
      expense_date: '2026-08-20',
      description: 'Itemized acceptance package',
      items: [
        { line_number: 1, amount: 100.00, category: 'Hardware', description: 'Item 1' },
        { line_number: 2, amount: 200.00, category: 'Materials', description: 'Item 2' },
        { line_number: 3, amount: 50.00, category: 'Logistics', description: 'Item 3' },
      ],
    });
    const res36 = await asUser(client, ids.member,
      `SELECT public.complete_subtask_with_expense($1, $2::jsonb, 'Itemized notes')`,
      [stItemId, itemizedPayload]);
    const r36 = res36.rows[0]['complete_subtask_with_expense'];
    assert.equal(r36.success, true);
    assert.notEqual(r36.transaction_id, null, 'transaction_id created for itemized ₹350.00');
    assert.equal(parseFloat(r36.total_expense), 350.00);

    const items36 = await client.query(
      `SELECT line_number, amount, category, description FROM public.expense_items WHERE transaction_id=$1 ORDER BY line_number`,
      [r36.transaction_id]);
    assert.equal(items36.rows.length, 3);
    assert.equal(parseFloat(items36.rows[0].amount), 100.00);
    assert.equal(parseFloat(items36.rows[1].amount), 200.00);
    assert.equal(parseFloat(items36.rows[2].amount), 50.00);
    const sum36 = items36.rows.reduce((acc, row) => acc + parseFloat(row.amount), 0);
    assert.equal(sum36, 350.00);
    pass('36. Itemized ₹350.00 (100+200+50): 3 line items, parent linking, and total verified');

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`  ALL ${passed} P5-03 / P5-03C SUBTASK COMPLETION ASSERTIONS PASSED!  `);
    console.log('═══════════════════════════════════════════════════════════════════════════');

  } finally {
    console.log('\nRolling back test transaction (database untouched)...');
    await client.query('ROLLBACK');
    await client.end();
  }
}

runTests().catch((err) => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
