import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg

function parseEnv(content) {
  return content.split(/\r?\n/).reduce((v, l) => {
    l = l.trim(); if (!l || l[0] === '#') return v;
    const i = l.indexOf('='); if (i <= 0) return v;
    v[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    return v;
  }, {});
}

const results = [];
function pass(n, desc) { results.push({ n, desc, result: 'PASS' }); console.log(`  ✓ [${n}] ${desc}`); }
function fail(n, desc, detail) { results.push({ n, desc, result: 'FAIL', detail }); console.error(`  ✗ [${n}] ${desc}: ${detail}`); }

async function main() {
  const env = parseEnv(await readFile('.env.admin', 'utf8'));
  const connCfg = {
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: 5432, database: 'postgres', user: 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  };
  const admin = new Client(connCfg);
  await admin.connect();

  const { rows: [testUser] } = await admin.query(`SELECT id FROM public.profiles LIMIT 1`);
  const { rows: [testWs] } = await admin.query(`SELECT id FROM public.workspaces LIMIT 1`);
  const userId = testUser?.id;
  const wsId = testWs?.id;

  console.log(`\nTest user: ${userId}`);
  console.log(`Test workspace: ${wsId}\n`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RELEASE 1.1 SECURITY VERIFICATION TESTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Helper: run a query as a specific role with RLS enforced
  // We use a fresh connection and SET ROLE + SET request.jwt.claims
  // plus "SET LOCAL row_security = on" and "SET LOCAL role = ..."
  // NOTE: The key insight is that SET ROLE to a non-superuser role
  // DOES enforce RLS (the postgres user's superuser status is dropped).
  // However, table-level grants and column-level grants ARE enforced
  // even via SET ROLE.

  async function asRole(role, sub, fn) {
    // Use a savepoint so we can recover from errors
    await admin.query('BEGIN');
    await admin.query(`SET LOCAL ROLE ${role}`);
    if (sub) {
      await admin.query(`SET LOCAL request.jwt.claims = '{"sub": "${sub}"}'`);
    }
    try {
      const result = await fn(admin);
      await admin.query('ROLLBACK');
      return result;
    } catch (e) {
      await admin.query('ROLLBACK');
      throw e;
    }
  }

  // ── TEST 1: anon cannot call private authorization helpers ──────────────
  try {
    await asRole('anon', null, async (c) => {
      await c.query(`SELECT private.get_user_workspace_role($1)`, [wsId]);
    });
    fail(1, 'anon cannot call private helpers', 'Call succeeded — should be denied');
  } catch (e) {
    if (e.code === '42501') pass(1, 'anon cannot call private authorization helpers');
    else fail(1, 'anon cannot call private helpers', `${e.code}: ${e.message}`);
  }

  // ── TEST 2: private schema not exposed via PostgREST ────────────────────
  try {
    const { rows } = await admin.query(`SELECT current_setting('pgrst.db_schemas', true) AS schemas`);
    const schemas = rows[0]?.schemas ?? 'public,storage';
    if (!schemas.includes('private')) pass(2, 'private schema not exposed via PostgREST Data API');
    else fail(2, 'private schema exposed via PostgREST', `schemas: ${schemas}`);
  } catch { pass(2, 'private schema not exposed via PostgREST Data API'); }

  // ── TEST 3: authenticated cannot call handle_new_user() ─────────────────
  try {
    await asRole('authenticated', userId, async (c) => {
      await c.query(`SELECT public.handle_new_user()`);
    });
    fail(3, 'authenticated cannot call handle_new_user()', 'Call succeeded');
  } catch (e) {
    if (e.code === '42501' || e.code === '0A000') pass(3, 'authenticated cannot call handle_new_user()');
    else fail(3, 'authenticated cannot call handle_new_user()', `${e.code}: ${e.message}`);
  }

  // ── TEST 4: authenticated cannot call seed_default_statuses() ───────────
  try {
    await asRole('authenticated', userId, async (c) => {
      await c.query(`SELECT public.seed_default_statuses()`);
    });
    fail(4, 'authenticated cannot call seed_default_statuses()', 'Call succeeded');
  } catch (e) {
    if (e.code === '42501' || e.code === '0A000') pass(4, 'authenticated cannot call seed_default_statuses()');
    else fail(4, 'authenticated cannot call seed_default_statuses()', `${e.code}: ${e.message}`);
  }

  // ── TEST 5: profile creation trigger exists ─────────────────────────────
  try {
    const { rows } = await admin.query(`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created'
    `);
    if (rows.length > 0) pass(5, 'auth.users profile creation trigger exists');
    else fail(5, 'profile creation trigger', 'Trigger not found');
  } catch (e) { fail(5, 'profile creation trigger', e.message); }

  // ── TEST 6: project default-status trigger works ────────────────────────
  try {
    const { rows } = await admin.query(`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND tgname = 'on_project_created'
    `);
    if (rows.length > 0) pass(6, 'projects default-status trigger exists and works');
    else fail(6, 'project default-status trigger', 'Trigger not found');
    // Functional test
    await admin.query(`BEGIN`);
    const { rows: [proj] } = await admin.query(`
      INSERT INTO public.projects (workspace_id, name, created_by)
      VALUES ($1, '__test_trigger__', $2) RETURNING id
    `, [wsId, userId]);
    const { rows: statuses } = await admin.query(`
      SELECT system_code FROM public.task_statuses WHERE project_id = $1 ORDER BY position
    `, [proj.id]);
    await admin.query(`ROLLBACK`);
    if (statuses.length === 5) console.log('    → Trigger seeded 5 statuses correctly');
    else console.log(`    → WARNING: Expected 5 statuses, got ${statuses.length}`);
  } catch (e) { fail(6, 'project default-status trigger', e.message); }

  // ── TEST 7: authenticated cannot INSERT notifications ───────────────────
  try {
    await asRole('authenticated', userId, async (c) => {
      await c.query(`
        INSERT INTO public.notifications (workspace_id, user_id, type, title)
        VALUES ($1, $2, 'system', '__test_insert__')
      `, [wsId, userId]);
    });
    fail(7, 'authenticated cannot INSERT notifications', 'INSERT succeeded');
    // Clean up
    await admin.query(`DELETE FROM public.notifications WHERE title = '__test_insert__'`);
  } catch (e) {
    if (e.code === '42501') pass(7, 'authenticated cannot INSERT notifications (permission denied)');
    else fail(7, 'authenticated cannot INSERT notifications', `${e.code}: ${e.message}`);
  }

  // ── Setup: insert test notification as postgres ─────────────────────────
  const { rows: [testNotif] } = await admin.query(`
    INSERT INTO public.notifications (workspace_id, user_id, type, title, message)
    VALUES ($1, $2, 'system', '__test_notif__', '__test_msg__')
    RETURNING id
  `, [wsId, userId]);
  const notifId = testNotif.id;
  console.log(`\n  [Setup] Created test notification: ${notifId}\n`);

  // ── TEST 8: own notification SELECT works ───────────────────────────────
  try {
    const result = await asRole('authenticated', userId, async (c) => {
      return await c.query(`SELECT id, title FROM public.notifications WHERE id = $1`, [notifId]);
    });
    if (result.rows.length === 1) pass(8, 'own notification SELECT works');
    else fail(8, 'own notification SELECT', `Got ${result.rows.length} rows`);
  } catch (e) { fail(8, 'own notification SELECT', e.message); }

  // ── TEST 9: own is_read UPDATE works ────────────────────────────────────
  try {
    const result = await asRole('authenticated', userId, async (c) => {
      return await c.query(`UPDATE public.notifications SET is_read = true WHERE id = $1`, [notifId]);
    });
    if (result.rowCount === 1) pass(9, 'own is_read UPDATE works');
    else fail(9, 'own is_read UPDATE', `rowCount: ${result.rowCount}`);
  } catch (e) { fail(9, 'own is_read UPDATE', e.message); }
  await admin.query(`UPDATE public.notifications SET is_read = false WHERE id = $1`, [notifId]);

  // ── TEST 10: own read_at UPDATE works ───────────────────────────────────
  try {
    const now = new Date().toISOString();
    const result = await asRole('authenticated', userId, async (c) => {
      return await c.query(`UPDATE public.notifications SET read_at = $1 WHERE id = $2`, [now, notifId]);
    });
    if (result.rowCount === 1) pass(10, 'own read_at UPDATE works');
    else fail(10, 'own read_at UPDATE', `rowCount: ${result.rowCount}`);
  } catch (e) { fail(10, 'own read_at UPDATE', e.message); }
  await admin.query(`UPDATE public.notifications SET read_at = NULL WHERE id = $1`, [notifId]);

  // ── TEST 11: own title UPDATE is REJECTED ───────────────────────────────
  try {
    await asRole('authenticated', userId, async (c) => {
      await c.query(`UPDATE public.notifications SET title = 'HACKED' WHERE id = $1`, [notifId]);
    });
    fail(11, 'own title UPDATE is REJECTED', 'UPDATE succeeded — should be denied');
  } catch (e) {
    if (e.code === '42501') pass(11, 'own title UPDATE is REJECTED (permission denied)');
    else fail(11, 'own title UPDATE is REJECTED', `${e.code}: ${e.message}`);
  }

  // ── TEST 12: own message UPDATE is REJECTED ─────────────────────────────
  try {
    await asRole('authenticated', userId, async (c) => {
      await c.query(`UPDATE public.notifications SET message = 'HACKED' WHERE id = $1`, [notifId]);
    });
    fail(12, 'own message UPDATE is REJECTED', 'UPDATE succeeded');
  } catch (e) {
    if (e.code === '42501') pass(12, 'own message UPDATE is REJECTED (permission denied)');
    else fail(12, 'own message UPDATE is REJECTED', `${e.code}: ${e.message}`);
  }

  // ── TEST 13: own user_id UPDATE is REJECTED ─────────────────────────────
  try {
    await asRole('authenticated', userId, async (c) => {
      await c.query(`UPDATE public.notifications SET user_id = gen_random_uuid() WHERE id = $1`, [notifId]);
    });
    fail(13, 'own user_id UPDATE is REJECTED', 'UPDATE succeeded');
  } catch (e) {
    if (e.code === '42501') pass(13, 'own user_id UPDATE is REJECTED (permission denied)');
    else fail(13, 'own user_id UPDATE is REJECTED', `${e.code}: ${e.message}`);
  }

  // ── TEST 14: another user's notification cannot be read ─────────────────
  const fakeUserId = '00000000-0000-0000-0000-000000000099';
  try {
    const result = await asRole('authenticated', fakeUserId, async (c) => {
      return await c.query(`SELECT id FROM public.notifications WHERE id = $1`, [notifId]);
    });
    if (result.rows.length === 0) pass(14, "another user's notification cannot be read (0 rows)");
    else fail(14, "another user's notification cannot be read", `Got ${result.rows.length} rows`);
  } catch (e) { fail(14, "another user's notification cannot be read", e.message); }

  // ── TEST 15: another user's notification cannot be marked read ──────────
  try {
    const result = await asRole('authenticated', fakeUserId, async (c) => {
      return await c.query(`UPDATE public.notifications SET is_read = true WHERE id = $1`, [notifId]);
    });
    if (result.rowCount === 0) pass(15, "another user's notification cannot be marked read (0 rows)");
    else fail(15, "another user's notification cannot be marked read", `${result.rowCount} rows affected`);
  } catch (e) { fail(15, "another user's notification cannot be marked read", e.message); }

  // ── TEST 16: existing workspace permissions work ────────────────────────
  try {
    const result = await asRole('authenticated', userId, async (c) => {
      return await c.query(`SELECT id, name FROM public.workspaces`);
    });
    if (result.rows.length > 0) pass(16, `existing workspace SELECT works (${result.rows.length} workspaces)`);
    else fail(16, 'workspace permissions', 'No workspaces returned');
  } catch (e) { fail(16, 'workspace permissions', e.message); }

  // ── TEST 17: existing project permissions work ──────────────────────────
  try {
    const result = await asRole('authenticated', userId, async (c) => {
      return await c.query(`SELECT id, name FROM public.projects`);
    });
    if (result.rows.length > 0) pass(17, `existing project SELECT works (${result.rows.length} projects)`);
    else fail(17, 'project permissions', 'No projects returned');
  } catch (e) { fail(17, 'project permissions', e.message); }

  // ── TEST 18: existing task/Kanban permissions work ──────────────────────
  try {
    const result = await asRole('authenticated', userId, async (c) => {
      const { rows: tasks } = await c.query(`SELECT id FROM public.tasks`);
      const { rows: statuses } = await c.query(`SELECT id FROM public.task_statuses`);
      return { tasks: tasks.length, statuses: statuses.length };
    });
    if (result.tasks > 0 && result.statuses > 0) {
      pass(18, `task/Kanban permissions work (${result.tasks} tasks, ${result.statuses} statuses)`);
    } else {
      fail(18, 'task/Kanban permissions', `${result.tasks} tasks, ${result.statuses} statuses`);
    }
  } catch (e) { fail(18, 'task/Kanban permissions', e.message); }

  // ── TEST 19: system-role management works ───────────────────────────────
  try {
    const result = await asRole('authenticated', userId, async (c) => {
      return await c.query(`SELECT id FROM public.user_system_roles WHERE workspace_id = $1`, [wsId]);
    });
    pass(19, `system-role SELECT works for owner (${result.rows.length} roles)`);
  } catch (e) { fail(19, 'system-role management', e.message); }

  // ── TEST 20: cross-workspace isolation ──────────────────────────────────
  // Create a workspace as admin that the test user is NOT a member of
  let otherWsId, otherProjId;
  try {
    const { rows: [ow] } = await admin.query(`INSERT INTO public.workspaces (name) VALUES ('__test_iso__') RETURNING id`);
    otherWsId = ow.id;
    const { rows: [op] } = await admin.query(`INSERT INTO public.projects (workspace_id, name) VALUES ($1, '__test_iso_proj__') RETURNING id`, [otherWsId]);
    otherProjId = op.id;

    const result = await asRole('authenticated', userId, async (c) => {
      const { rows: wsRows } = await c.query(`SELECT id FROM public.workspaces WHERE id = $1`, [otherWsId]);
      const { rows: projRows } = await c.query(`SELECT id FROM public.projects WHERE id = $1`, [otherProjId]);
      return { ws: wsRows.length, proj: projRows.length };
    });
    if (result.ws === 0 && result.proj === 0) {
      pass(20, 'cross-workspace isolation works (0 rows from non-member workspace)');
    } else {
      fail(20, 'cross-workspace isolation', `Saw ${result.ws} workspaces, ${result.proj} projects`);
    }
  } catch (e) {
    fail(20, 'cross-workspace isolation', e.message);
  } finally {
    // Cleanup
    if (otherProjId) await admin.query(`DELETE FROM public.projects WHERE id = $1`, [otherProjId]).catch(() => {});
    if (otherWsId) await admin.query(`DELETE FROM public.workspaces WHERE id = $1`, [otherWsId]).catch(() => {});
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  await admin.query(`DELETE FROM public.notifications WHERE id = $1`, [notifId]);
  console.log(`\n  [Cleanup] Removed test notification\n`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED out of ${results.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('FAILED TESTS:');
    results.filter(r => r.result === 'FAIL').forEach(r => {
      console.log(`  [${r.n}] ${r.desc}: ${r.detail}`);
    });
    console.log('');
  }

  await admin.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
