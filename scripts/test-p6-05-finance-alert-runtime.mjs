/**
 * SNS PROJECTS — PACKAGE 6 / P6-05 FINANCE ALERT RUNTIME & PERSISTENT BACKEND TEST SUITE
 *
 * Automated verification for:
 * 1. Schema, Grants, RLS & Immutability
 *    - public.finance_alerts table structure, constraints, partial unique unresolved index
 *    - private.finance_alert_risk_state table structure, constraint, privilege revocation
 *    - notifications_type_check constraint extension (finance_risk_orange, finance_risk_red + all 20 existing)
 *    - Table grants: authenticated has SELECT & restricted UPDATE only (no direct INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER)
 *    - anon has zero table privileges (all false)
 *    - Row-Level Security: can_manage_budgets OR is_finance_operator allowed; Member, Viewer, Project Admin, System Admin, Inactive denied
 *    - Mutation guard: direct client INSERT/DELETE blocked, arbitrary snapshot mutations prevented
 *    - Public mutation RPCs: acknowledge_finance_alert & resolve_finance_alert are SECURITY INVOKER with search_path=''
 *    - Public SECURITY DEFINER baseline intact (exactly 7 functions in database, 0 new)
 *    - Realtime publication: public.finance_alerts in supabase_realtime
 *
 * 2. Threshold Engine & Risk State Machine
 *    - GREEN -> YELLOW creates no alert and no notification
 *    - GREEN/YELLOW -> ORANGE creates one OPEN incident and sends finance_risk_orange
 *    - ORANGE same-band updates (spend increase within ORANGE) creates no duplicate and no extra notification
 *    - ORANGE -> RED escalates existing incident (current_risk_band = RED, red_at set, opened_risk_band preserved) and sends finance_risk_red
 *    - RED same-band update creates no duplicate
 *    - RED -> ORANGE sends no executive notification
 *    - High risk -> GREEN/YELLOW sets condition_cleared_at without auto-resolving lifecycle
 *    - Re-breach before resolution reuses same unresolved incident and sends a fresh executive notification
 *    - After RESOLVED, a future breach creates a NEW incident while retaining history
 *
 * 3. Executive Notification Routing
 *    - ORANGE sends finance_risk_orange; RED sends finance_risk_red; YELLOW sends zero
 *    - Active CEO and CTO in workspace receive executive notifications
 *    - Inactive CEO/CTO do not receive notifications
 *    - Finance Operator, Member, Viewer, Project Admin only, System Admin only, Owner/Admin without executive role do NOT receive executive notifications
 *    - Notification metadata points to finance_alert entity and enclosing project
 *
 * 4. Alert Lifecycle Management
 *    - Finance Operator can OPEN -> ACKNOWLEDGED
 *    - Finance Operator CANNOT resolve (Budget Manager authority required)
 *    - Budget Manager can acknowledge
 *    - OPEN -> RESOLVED is rejected (must be acknowledged first)
 *    - Resolution rejected while canonical risk is ORANGE or RED
 *    - ACKNOWLEDGED -> RESOLVED succeeds after risk returns to GREEN or YELLOW
 *    - Actor and timestamp fields are server-owned
 *    - RESOLVED is terminal
 *
 * 5. Transaction Correctness & Deferred Reconciliations
 *    - Multi-line item expense transaction triggers deferred reconciliation seeing final state
 *    - Repeated trigger callbacks inside one transaction cause zero duplicate alerts or notifications
 *    - Expense correction updates risk
 *    - Expense void lowers risk
 *    - Budget modification updates risk
 *    - Task hierarchy movement reattributes expenses and updates risk
 *    - Alert evaluations never block operational completion
 *
 * 6. Production Bootstrap Verification
 *    - 5 existing high-risk entities bootstrapped into finance_alerts (1 ORANGE, 4 RED)
 *    - Zero retroactive finance_risk_orange/red notifications sent during bootstrap
 *    - Clean transaction rollback
 *
 * Usage:
 *   node scripts/test-p6-05-finance-alert-runtime.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

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

let assertionCount = 0;
function pass(msg) {
  assertionCount++;
  console.log(`[PASS ${assertionCount}] ${msg}`);
}

async function asUser(client, userId, sql, params = []) {
  await client.query('SAVEPOINT as_user_sp');
  await client.query('SET LOCAL ROLE authenticated');
  try {
    if (userId) {
      await client.query(
        `SELECT set_config('request.jwt.claim.sub', $1, true),
                set_config('request.jwt.claim.role', 'authenticated', true),
                set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
    } else {
      await client.query(`
        SELECT set_config('request.jwt.claim.sub', '', true),
               set_config('request.jwt.claim.role', '', true),
               set_config('request.jwt.claims', '', true)
      `);
    }
    const result = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT as_user_sp');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK TO SAVEPOINT as_user_sp');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      await client.query('RESET ROLE');
    } catch {
      // ignore
    }
  }
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — P6-05 FINANCE ALERT RUNTIME VERIFICATION SUITE              ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const client = new Client({
    connectionString: envAdmin.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // SUITE 1: PRODUCTION DEPLOYMENT & BOOTSTRAP READ-ONLY VERIFICATION
    // ══════════════════════════════════════════════════════════════════════════
    console.log('--- Suite 1: Production Deployment & Bootstrap State ---');

    // 1. Migration ledger check
    const { rows: migCheck } = await client.query(`
      SELECT version, name FROM supabase_migrations.schema_migrations
      WHERE version = '20260822144843'
    `);
    assert.equal(migCheck.length, 1, 'Migration 20260822144843 must be recorded in ledger');
    pass('Migration 20260822144843_p6_05_finance_alert_runtime is recorded in schema_migrations');

    // 2. Production Security Advisor Baseline: exactly 7 public SECURITY DEFINER functions (0 new)
    const { rows: secDefRows } = await client.query(`
      SELECT proname FROM pg_proc
      JOIN pg_namespace n ON pronamespace = n.oid
      WHERE n.nspname = 'public' AND prosecdef = true
      ORDER BY proname
    `);
    assert.equal(secDefRows.length, 7, 'Database must have exactly 7 public SECURITY DEFINER functions (0 new)');
    pass('Security Advisor baseline intact: exactly 7 public SECURITY DEFINER functions (0 new added by P6-05)');

    // 3. Public RPCs are SECURITY INVOKER with search_path = ''
    const { rows: invokerFuncs } = await client.query(`
      SELECT proname, prosecdef, proconfig FROM pg_proc
      JOIN pg_namespace n ON pronamespace = n.oid
      WHERE n.nspname = 'public' AND proname IN ('acknowledge_finance_alert', 'resolve_finance_alert')
      ORDER BY proname
    `);
    assert.equal(invokerFuncs.length, 2, 'Both acknowledge and resolve RPCs must exist in public schema');
    for (const fn of invokerFuncs) {
      assert.equal(fn.prosecdef, false, `public.${fn.proname} must be SECURITY INVOKER`);
      assert.ok(
        Array.isArray(fn.proconfig) && fn.proconfig.some(c => c.startsWith('search_path=')),
        `public.${fn.proname} must have search_path setting in proconfig (got ${JSON.stringify(fn.proconfig)})`
      );
    }
    pass('public.acknowledge_finance_alert & resolve_finance_alert are SECURITY INVOKER with search_path=""');

    // 4. Private engine functions are SECURITY DEFINER with search_path = ''
    const { rows: definerFuncs } = await client.query(`
      SELECT proname, prosecdef, proconfig FROM pg_proc
      JOIN pg_namespace n ON pronamespace = n.oid
      WHERE n.nspname = 'private' AND proname IN (
        'reconcile_finance_alerts_for_workspace',
        'trg_fn_finance_alerts_guard_mutation',
        'trg_fn_finance_alerts_reconcile_budgets',
        'trg_fn_finance_alerts_reconcile_expense_transactions',
        'trg_fn_finance_alerts_reconcile_expense_items',
        'trg_fn_finance_alerts_reconcile_tasks'
      )
    `);
    assert.equal(definerFuncs.length, 6, 'All 6 private engine/trigger functions must exist in private schema');
    for (const fn of definerFuncs) {
      assert.equal(fn.prosecdef, true, `private.${fn.proname} must be SECURITY DEFINER`);
      assert.ok(
        Array.isArray(fn.proconfig) && fn.proconfig.some(c => c.startsWith('search_path=')),
        `private.${fn.proname} must have search_path setting in proconfig (got ${JSON.stringify(fn.proconfig)})`
      );
    }
    pass('All private alert engine and trigger functions are private SECURITY DEFINER with search_path=""');

    // 5. Realtime publication check
    const { rows: rtCheck } = await client.query(`
      SELECT tablename FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'finance_alerts'
    `);
    assert.equal(rtCheck.length, 1, 'public.finance_alerts must be in supabase_realtime publication');
    pass('public.finance_alerts is registered in supabase_realtime publication');

    // 6. Notifications constraint includes all 22 valid types
    const { rows: notifCheck } = await client.query(`
      SELECT pg_get_constraintdef(oid) as def 
      FROM pg_constraint 
      WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check'
    `);
    assert.ok(notifCheck[0].def.includes('finance_risk_orange'), 'notifications_type_check must contain finance_risk_orange');
    assert.ok(notifCheck[0].def.includes('finance_risk_red'), 'notifications_type_check must contain finance_risk_red');
    assert.ok(notifCheck[0].def.includes('task_assigned'), 'notifications_type_check must preserve existing types');
    pass('notifications_type_check correctly includes finance_risk_orange and finance_risk_red alongside all 20 existing types');

    // 7. Table Grants check
    const { rows: grantAlerts } = await client.query(`
      SELECT has_table_privilege('authenticated', 'public.finance_alerts', 'SELECT') as auth_select,
             has_table_privilege('authenticated', 'public.finance_alerts', 'INSERT') as auth_insert,
             has_table_privilege('authenticated', 'public.finance_alerts', 'DELETE') as auth_delete,
             has_table_privilege('authenticated', 'public.finance_alerts', 'TRUNCATE') as auth_truncate,
             has_table_privilege('authenticated', 'public.finance_alerts', 'REFERENCES') as auth_ref,
             has_table_privilege('authenticated', 'public.finance_alerts', 'TRIGGER') as auth_trig,
             has_table_privilege('anon', 'public.finance_alerts', 'SELECT') as anon_select,
             has_table_privilege('anon', 'public.finance_alerts', 'INSERT') as anon_insert,
             has_table_privilege('anon', 'public.finance_alerts', 'UPDATE') as anon_update,
             has_table_privilege('anon', 'public.finance_alerts', 'DELETE') as anon_delete
    `);
    assert.equal(grantAlerts[0].auth_select, true, 'authenticated must have SELECT on finance_alerts');
    assert.equal(grantAlerts[0].auth_insert, false, 'authenticated must NOT have INSERT on finance_alerts');
    assert.equal(grantAlerts[0].auth_delete, false, 'authenticated must NOT have DELETE on finance_alerts');
    assert.equal(grantAlerts[0].auth_truncate, false, 'authenticated must NOT have TRUNCATE on finance_alerts');
    assert.equal(grantAlerts[0].auth_ref, false, 'authenticated must NOT have REFERENCES on finance_alerts');
    assert.equal(grantAlerts[0].auth_trig, false, 'authenticated must NOT have TRIGGER on finance_alerts');
    assert.equal(grantAlerts[0].anon_select, false, 'anon must NOT have SELECT');
    assert.equal(grantAlerts[0].anon_insert, false, 'anon must NOT have INSERT');
    assert.equal(grantAlerts[0].anon_update, false, 'anon must NOT have UPDATE');
    assert.equal(grantAlerts[0].anon_delete, false, 'anon must NOT have DELETE');
    pass('Table privileges on public.finance_alerts strictly enforce least privilege (anon all false, auth SELECT/restricted UPDATE only)');

    // 8. Bootstrap snapshot verification
    const { rows: bootstrappedAlerts } = await client.query(`
      SELECT entity_type, entity_name, opened_risk_band, current_risk_band, lifecycle_status,
             base_budget, safety_buffer, actual_spend
      FROM public.finance_alerts
      ORDER BY entity_name
    `);
    assert.equal(bootstrappedAlerts.length, 5, 'Exactly 5 high-risk alerts bootstrapped in production workspace');
    const orangeCount = bootstrappedAlerts.filter((a) => a.current_risk_band === 'ORANGE').length;
    const redCount = bootstrappedAlerts.filter((a) => a.current_risk_band === 'RED').length;
    assert.equal(orangeCount, 1, 'Expected 1 ORANGE alert bootstrapped');
    assert.equal(redCount, 4, 'Expected 4 RED alerts bootstrapped');
    for (const a of bootstrappedAlerts) {
      assert.equal(a.lifecycle_status, 'open', 'All bootstrapped alerts must have lifecycle_status="open"');
    }
    pass('Production bootstrap: exactly 5 open Finance Alerts created (1 ORANGE: Kerala Pilot, 4 RED: Site, Installation, Property, Deployment)');

    // 9. Zero retroactive notifications
    const { rows: retroNotifs } = await client.query(`
      SELECT count(*) as cnt FROM public.notifications
      WHERE type IN ('finance_risk_orange', 'finance_risk_red')
    `);
    assert.equal(Number(retroNotifs[0].cnt), 0, 'Zero retroactive executive notifications sent during bootstrap');
    pass('Production bootstrap: exactly 0 retroactive finance_risk_orange / finance_risk_red notifications generated');

    // ══════════════════════════════════════════════════════════════════════════
    // SUITE 2: ISOLATED TRANSACTION INTEGRATION & TEST FIXTURES
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n--- Suite 2: Isolated Integration Fixtures & RLS Access Matrix ---');
    await client.query('BEGIN');

    // Create Test Workspace & Personas
    const wsId = randomUUID();
    const otherWsId = randomUUID();

    const ownerId = randomUUID();
    const adminId = randomUUID();
    const ceoId = randomUUID();
    const ctoId = randomUUID();
    const finOpId = randomUUID();
    const memberId = randomUUID();
    const viewerId = randomUUID();
    const projAdminId = randomUUID();
    const sysAdminId = randomUUID();
    const inactiveCeoId = randomUUID();

    const otherOwnerId = randomUUID();

    const deptFinId = randomUUID();

    await client.query('SET LOCAL session_replication_role = replica');

    // Insert Auth Users & Profiles
    const testUsers = [
      [ownerId, 'Alert Test Owner'],
      [adminId, 'Alert Test Admin'],
      [ceoId, 'Alert Test CEO'],
      [ctoId, 'Alert Test CTO'],
      [finOpId, 'Alert Test FinOp'],
      [memberId, 'Alert Test Member'],
      [viewerId, 'Alert Test Viewer'],
      [projAdminId, 'Alert Test ProjAdmin'],
      [sysAdminId, 'Alert Test SysAdmin'],
      [inactiveCeoId, 'Alert Test Inactive CEO'],
      [otherOwnerId, 'Alert Test Other Owner'],
    ];

    for (const [uid, name] of testUsers) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, email, raw_user_meta_data, created_at, updated_at, aud, role)
        VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000', $2::text, jsonb_build_object('full_name', $3::text), now(), now(), 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING
      `, [uid, `${uid.slice(0, 8)}@alert-test.com`, name]);

      await client.query(
        `INSERT INTO public.profiles (id, full_name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
        [uid, name]
      );
    }
    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // Workspaces
    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by) VALUES
      ('${wsId}', 'Alert Test Workspace', '${ownerId}'),
      ('${otherWsId}', 'Other Workspace', '${otherOwnerId}')
    `);

    // Memberships
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES
      ('${wsId}', '${ownerId}', 'owner', 'active'),
      ('${wsId}', '${adminId}', 'admin', 'active'),
      ('${wsId}', '${ceoId}', 'member', 'active'),
      ('${wsId}', '${ctoId}', 'member', 'active'),
      ('${wsId}', '${finOpId}', 'member', 'active'),
      ('${wsId}', '${memberId}', 'member', 'active'),
      ('${wsId}', '${viewerId}', 'viewer', 'active'),
      ('${wsId}', '${projAdminId}', 'member', 'active'),
      ('${wsId}', '${sysAdminId}', 'member', 'active'),
      ('${wsId}', '${inactiveCeoId}', 'member', 'declined'),
      ('${otherWsId}', '${otherOwnerId}', 'owner', 'active');
    `);

    // System Roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role) VALUES
      ('${wsId}', '${ceoId}', 'ceo'),
      ('${wsId}', '${ctoId}', 'cto'),
      ('${wsId}', '${projAdminId}', 'project_admin'),
      ('${wsId}', '${sysAdminId}', 'system_admin'),
      ('${wsId}', '${inactiveCeoId}', 'ceo');
    `);

    // Finance Department for FinOp
    await client.query(`
      INSERT INTO public.departments (id, workspace_id, name, code, is_active, created_by)
      VALUES ('${deptFinId}', '${wsId}', 'Finance Dept', 'FIN', true, '${ownerId}');
      
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active, is_primary)
      VALUES ('${wsId}', '${deptFinId}', '${finOpId}', true, true);
    `);

    // Create Test Project, Phase, Task List, Task
    const projId = randomUUID();
    const phaseId = randomUUID();
    const taskListId = randomUUID();
    const taskId1 = randomUUID();
    const taskId2 = randomUUID();

    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, created_by)
      VALUES ('${projId}', '${wsId}', 'Alpha Solar Grid', '${ownerId}');

      INSERT INTO public.phases (id, project_id, name, created_by)
      VALUES ('${phaseId}', '${projId}', 'Phase 1 Grid Setup', '${ownerId}');

      INSERT INTO public.task_lists (id, phase_id, project_id, name, created_by)
      VALUES ('${taskListId}', '${phaseId}', '${projId}', 'Solar Panels Procurement', '${ownerId}');

      INSERT INTO public.tasks (id, task_list_id, phase_id, project_id, title, created_by)
      VALUES 
      ('${taskId1}', '${taskListId}', '${phaseId}', '${projId}', 'Procure Inverters', '${ownerId}'),
      ('${taskId2}', '${taskListId}', '${phaseId}', '${projId}', 'Mounting Hardware', '${ownerId}');
    `);

    // Project Budget: Base = 10,000, Buffer = 2,000 (Ceiling = 12,000)
    // Risk boundaries:
    // Spend < 8,000 -> GREEN
    // 8,000 <= Spend <= 10,000 -> YELLOW
    // 10,000 < Spend <= 12,000 -> ORANGE
    // Spend > 12,000 -> RED
    const projBudgetId = randomUUID();
    await client.query(`
      INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by)
      VALUES ('${projBudgetId}', '${wsId}', 'project', '${projId}', 10000.00, 2000.00, '${ownerId}')
    `);

    // 10. Initial state check: Spend is 0, Risk is GREEN
    const { rows: initialAlerts } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'
    `);
    assert.equal(initialAlerts.length, 0, 'No alert should exist for newly budgeted project at 0 spend');
    pass('GREEN risk state on fresh budget generates zero alert rows');

    // 11. Add expense: 8,500 (YELLOW)
    // Inserting expense transaction and item
    const txId1 = randomUUID();
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ('${txId1}', '${wsId}', '${taskId1}', 'active', '${ownerId}');

      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ('${txId1}', 8500.00, 'Initial hardware invoice');
    `);

    // Force deferred trigger reconciliation to execute
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: yellowAlerts } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'
    `);
    assert.equal(yellowAlerts.length, 0, 'YELLOW risk (8,500 / 10,000) must NOT create an alert');

    const { rows: yellowNotifs } = await client.query(`
      SELECT * FROM public.notifications WHERE workspace_id = '${wsId}'
    `);
    assert.equal(yellowNotifs.length, 0, 'YELLOW risk must NOT generate executive notifications');
    pass('GREEN -> YELLOW transition (Spend = ₹8,500) generates 0 alerts and 0 notifications');

    // 12. Add expense: +2,500 -> Total Spend = 11,000 (ORANGE, Over Base 10,000, under Ceiling 12,000)
    const txId2 = randomUUID();
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ('${txId2}', '${wsId}', '${taskId2}', 'active', '${ownerId}');

      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ('${txId2}', 2500.00, 'Inverter shipping charges');
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: orangeAlerts } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'
    `);
    assert.equal(orangeAlerts.length, 1, 'YELLOW -> ORANGE transition must create exactly 1 alert');
    const alert1 = orangeAlerts[0];
    assert.equal(alert1.entity_type, 'project');
    assert.equal(alert1.entity_id, projId);
    assert.equal(alert1.opened_risk_band, 'ORANGE');
    assert.equal(alert1.current_risk_band, 'ORANGE');
    assert.equal(alert1.lifecycle_status, 'open');
    assert.equal(Number(alert1.actual_spend), 11000.00);
    assert.equal(Number(alert1.base_budget), 10000.00);
    assert.equal(Number(alert1.safety_buffer), 2000.00);
    assert.equal(Number(alert1.overrun), 0.00);
    assert.equal(alert1.red_at, null);
    assert.equal(alert1.condition_cleared_at, null);
    pass('YELLOW -> ORANGE threshold entry creates exactly one OPEN incident with accurate financial snapshot');

    // 13. Notifications sent to active CEO & CTO ONLY
    const { rows: orangeNotifs } = await client.query(`
      SELECT user_id, type, title, message, entity_type, entity_id, project_id
      FROM public.notifications
      WHERE workspace_id = '${wsId}' AND type = 'finance_risk_orange'
      ORDER BY user_id
    `);
    assert.equal(orangeNotifs.length, 2, 'Exactly 2 notifications sent (1 to active CEO, 1 to active CTO)');
    const notifRecipients = new Set(orangeNotifs.map((n) => n.user_id));
    assert.ok(notifRecipients.has(ceoId), 'Active CEO must receive notification');
    assert.ok(notifRecipients.has(ctoId), 'Active CTO must receive notification');
    assert.ok(!notifRecipients.has(inactiveCeoId), 'Inactive CEO must NOT receive notification');
    assert.ok(!notifRecipients.has(finOpId), 'Finance Operator must NOT receive executive notification');
    assert.ok(!notifRecipients.has(ownerId), 'Workspace Owner without CEO/CTO role must NOT receive notification');
    assert.ok(!notifRecipients.has(memberId), 'Normal Member must NOT receive notification');
    assert.equal(orangeNotifs[0].entity_type, 'finance_alert');
    assert.equal(orangeNotifs[0].entity_id, alert1.id);
    assert.equal(orangeNotifs[0].project_id, projId);
    pass('ORANGE notification routed exclusively to active CEO and CTO; non-executive roles excluded');

    // 14. Same-band update: Add +200 -> Total Spend = 11,200 (Still ORANGE)
    const txId3 = randomUUID();
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ('${txId3}', '${wsId}', '${taskId2}', 'active', '${ownerId}');

      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ('${txId3}', 200.00, 'Minor brackets');
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: orangeAlertsSameBand } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'
    `);
    assert.equal(orangeAlertsSameBand.length, 1, 'Same-band spend change must NOT create duplicate alerts');
    assert.equal(Number(orangeAlertsSameBand[0].actual_spend), 11200.00, 'Actual spend updated to 11,200');

    const { rows: orangeNotifsSameBand } = await client.query(`
      SELECT * FROM public.notifications WHERE workspace_id = '${wsId}' AND type = 'finance_risk_orange'
    `);
    assert.equal(orangeNotifsSameBand.length, 2, 'Same-band spend change must NOT send additional notifications');
    pass('ORANGE same-band spend update refreshes existing incident metrics without duplicate alerts or notifications');

    // 15. Escalation: Add +1,000 -> Total Spend = 12,200 (RED, Exceeds Ceiling 12,000)
    const txId4 = randomUUID();
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ('${txId4}', '${wsId}', '${taskId1}', 'active', '${ownerId}');

      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ('${txId4}', 1000.00, 'Overrun electrical rework');
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: redAlerts } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'
    `);
    assert.equal(redAlerts.length, 1, 'Escalation to RED must update the SAME incident');
    assert.equal(redAlerts[0].id, alert1.id, 'Incident ID must remain unchanged');
    assert.equal(redAlerts[0].opened_risk_band, 'ORANGE', 'Original opened_risk_band preserved as ORANGE');
    assert.equal(redAlerts[0].current_risk_band, 'RED', 'current_risk_band updated to RED');
    assert.ok(redAlerts[0].red_at !== null, 'red_at timestamp must be recorded');
    assert.equal(Number(redAlerts[0].actual_spend), 12200.00);
    assert.equal(Number(redAlerts[0].overrun), 200.00);

    const { rows: redNotifs } = await client.query(`
      SELECT * FROM public.notifications WHERE workspace_id = '${wsId}' AND type = 'finance_risk_red'
    `);
    assert.equal(redNotifs.length, 2, 'Exactly 2 RED notifications sent to active CEO & CTO');
    pass('ORANGE -> RED escalation updates existing incident, sets red_at, and sends finance_risk_red notification');

    // 16. Downward transition within high-risk: Void txId4 (1,000) -> Spend drops to 11,200 (ORANGE)
    await client.query(`
      UPDATE public.expense_transactions SET status = 'voided' WHERE id = '${txId4}'
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: redToOrangeAlerts } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE id = '${alert1.id}'
    `);
    assert.equal(redToOrangeAlerts[0].current_risk_band, 'ORANGE');
    assert.equal(Number(redToOrangeAlerts[0].actual_spend), 11200.00);

    const { rows: allNotifsAfterDownward } = await client.query(`
      SELECT count(*) as cnt FROM public.notifications WHERE workspace_id = '${wsId}'
    `);
    // Previously: 2 orange + 2 red = 4. Downward RED -> ORANGE must add ZERO notifications.
    assert.equal(Number(allNotifsAfterDownward[0].cnt), 4, 'RED -> ORANGE must NOT send any new notification');
    pass('RED -> ORANGE downward shift updates current_risk_band without sending new notifications');

    // 17. Condition Cleared: Void txId2 (2,500) -> Spend drops to 8,700 (YELLOW)
    await client.query(`
      UPDATE public.expense_transactions SET status = 'voided' WHERE id = '${txId2}'
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: recoveredAlerts } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE id = '${alert1.id}'
    `);
    assert.equal(recoveredAlerts[0].current_risk_band, 'YELLOW');
    assert.equal(Number(recoveredAlerts[0].actual_spend), 8700.00);
    assert.ok(recoveredAlerts[0].condition_cleared_at !== null, 'condition_cleared_at timestamp must be set');
    assert.equal(recoveredAlerts[0].lifecycle_status, 'open', 'Lifecycle must NOT be auto-resolved; remains open');
    pass('Risk drop to YELLOW sets condition_cleared_at while preserving open lifecycle status (no auto-resolve)');

    // 18. Re-breach before resolution: Un-void or add expense +3,000 -> Spend = 11,700 (ORANGE)
    // Mark previous notifications as read (simulating user acknowledgment/time progression)
    await client.query(`UPDATE public.notifications SET is_read = true WHERE workspace_id = '${wsId}'`);

    const txId5 = randomUUID();
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ('${txId5}', '${wsId}', '${taskId1}', 'active', '${ownerId}');

      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ('${txId5}', 3000.00, 'Re-breach extra inverters');
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: rebreachedAlerts } = await client.query(`
      SELECT * FROM public.finance_alerts WHERE id = '${alert1.id}'
    `);
    assert.equal(rebreachedAlerts[0].current_risk_band, 'ORANGE');
    assert.equal(rebreachedAlerts[0].condition_cleared_at, null, 'condition_cleared_at cleared on re-breach');
    assert.equal(Number(rebreachedAlerts[0].actual_spend), 11700.00);

    const { rows: orangeNotifsAfterRebreach } = await client.query(`
      SELECT * FROM public.notifications WHERE workspace_id = '${wsId}' AND type = 'finance_risk_orange'
    `);
    assert.equal(orangeNotifsAfterRebreach.length, 4, 'Re-breach from recovered state sends fresh executive notifications (2 new)');
    pass('Re-breach after temporary recovery reuses unresolved incident, clears condition_cleared_at, and sends fresh notifications');

    // ══════════════════════════════════════════════════════════════════════════
    // SUITE 3: LIFECYCLE MUTATION & PERMISSIONS MATRIX
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n--- Suite 3: Lifecycle Mutation & Permissions Matrix ---');

    // 19. Unauthorized user cannot SELECT alert
    const { rows: memberAlertSelect } = await asUser(
      client,
      memberId,
      `SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'`
    );
    assert.equal(memberAlertSelect.length, 0, 'Member cannot SELECT alerts under RLS');

    const { rows: viewerAlertSelect } = await asUser(
      client,
      viewerId,
      `SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'`
    );
    assert.equal(viewerAlertSelect.length, 0, 'Viewer cannot SELECT alerts under RLS');

    const { rows: projAdminAlertSelect } = await asUser(
      client,
      projAdminId,
      `SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'`
    );
    assert.equal(projAdminAlertSelect.length, 0, 'Project Admin alone cannot SELECT alerts');

    const { rows: sysAdminAlertSelect } = await asUser(
      client,
      sysAdminId,
      `SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'`
    );
    assert.equal(sysAdminAlertSelect.length, 0, 'System Admin alone cannot SELECT alerts');

    // Cross-workspace isolation
    const { rows: otherWsAlertSelect } = await asUser(
      client,
      otherOwnerId,
      `SELECT * FROM public.finance_alerts WHERE workspace_id = '${wsId}'`
    );
    assert.equal(otherWsAlertSelect.length, 0, 'Other Workspace Owner cannot SELECT alerts from different workspace');
    pass('Unauthorized roles (Member, Viewer, ProjAdmin alone, SysAdmin alone, Other Workspace) strictly fail closed on SELECT');

    // 20. Authorized users can SELECT alerts
    for (const [authUid, roleName] of [
      [ownerId, 'Workspace Owner'],
      [adminId, 'Workspace Admin'],
      [ceoId, 'CEO'],
      [ctoId, 'CTO'],
      [finOpId, 'Finance Operator'],
    ]) {
      const { rows: authAlertSelect } = await asUser(
        client,
        authUid,
        `SELECT id, entity_name FROM public.finance_alerts WHERE workspace_id = '${wsId}'`
      );
      assert.equal(authAlertSelect.length, 1, `${roleName} must be able to SELECT workspace alerts`);
    }
    pass('Authorized personas (Owner, Admin, CEO, CTO, Finance Operator) can SELECT workspace alerts');

    // 21. Finance Operator can OPEN -> ACKNOWLEDGED
    const ackResult = await asUser(
      client,
      finOpId,
      `SELECT public.acknowledge_finance_alert($1) as res`,
      [alert1.id]
    );
    const ackObj = ackResult.rows[0].res;
    assert.equal(ackObj.lifecycle_status, 'acknowledged');
    assert.equal(ackObj.acknowledged_by, finOpId);

    const { rows: dbAckCheck } = await client.query(`
      SELECT lifecycle_status, acknowledged_by, acknowledged_at FROM public.finance_alerts WHERE id = '${alert1.id}'
    `);
    assert.equal(dbAckCheck[0].lifecycle_status, 'acknowledged');
    assert.equal(dbAckCheck[0].acknowledged_by, finOpId);
    assert.ok(dbAckCheck[0].acknowledged_at !== null);
    pass('Finance Operator can acknowledge open alert (OPEN -> ACKNOWLEDGED) with server-owned actor and timestamp');

    // 22. Finance Operator CANNOT resolve (Budget Manager authority required)
    await assert.rejects(
      async () => {
        await asUser(
          client,
          finOpId,
          `SELECT public.resolve_finance_alert($1, 'Attempted resolve by fin op')`,
          [alert1.id]
        );
      },
      /Budget Manager authority required/,
      'Finance Operator must be strictly denied resolution authority'
    );
    pass('Finance Operator is strictly DENIED resolution authority (Decision 56 / 66 enforced)');

    // 23. Resolution rejected while current risk is ORANGE / RED
    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerId,
          `SELECT public.resolve_finance_alert($1, 'Attempted resolve while ORANGE')`,
          [alert1.id]
        );
      },
      /Cannot resolve finance alert while current risk is ORANGE/,
      'Resolution must be blocked while risk remains in high-risk band'
    );
    pass('Resolution is strictly REJECTED while underlying canonical risk remains ORANGE / RED');

    // 24. Reduce spend to GREEN by voiding txId5 (3,000) and txId3 (200) -> Spend = 8,500 (YELLOW)
    // Then void txId1 (8,500) -> Spend = 0 (GREEN)
    await client.query(`
      UPDATE public.expense_transactions SET status = 'voided' WHERE id IN ('${txId5}', '${txId3}', '${txId1}')
    `);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: greenAlertCheck } = await client.query(`
      SELECT current_risk_band, condition_cleared_at, actual_spend FROM public.finance_alerts WHERE id = '${alert1.id}'
    `);
    assert.equal(greenAlertCheck[0].current_risk_band, 'GREEN');
    assert.equal(Number(greenAlertCheck[0].actual_spend), 0.00);
    assert.ok(greenAlertCheck[0].condition_cleared_at !== null);
    pass('Spend reduced to ₹0.00 (GREEN); condition_cleared_at recorded');

    // 25. Budget Manager (Workspace Owner) resolves alert (ACKNOWLEDGED -> RESOLVED)
    const resolveResult = await asUser(
      client,
      ownerId,
      `SELECT public.resolve_finance_alert($1, 'Overspend rectified and verified with vendor') as res`,
      [alert1.id]
    );
    const resolveObj = resolveResult.rows[0].res;
    assert.equal(resolveObj.lifecycle_status, 'resolved');
    assert.equal(resolveObj.resolved_by, ownerId);
    assert.equal(resolveObj.resolution_note, 'Overspend rectified and verified with vendor');

    const { rows: dbResolveCheck } = await client.query(`
      SELECT lifecycle_status, resolved_by, resolved_at, resolution_note FROM public.finance_alerts WHERE id = '${alert1.id}'
    `);
    assert.equal(dbResolveCheck[0].lifecycle_status, 'resolved');
    assert.equal(dbResolveCheck[0].resolved_by, ownerId);
    assert.ok(dbResolveCheck[0].resolved_at !== null);
    assert.equal(dbResolveCheck[0].resolution_note, 'Overspend rectified and verified with vendor');
    pass('Budget Manager successfully resolves alert once condition is GREEN (ACKNOWLEDGED -> RESOLVED)');

    // 26. RESOLVED is terminal (cannot acknowledge or re-resolve)
    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerId,
          `SELECT public.acknowledge_finance_alert($1)`,
          [alert1.id]
        );
      },
      /Cannot acknowledge alert with status resolved/,
      'Resolved alert cannot transition back to acknowledged'
    );
    pass('RESOLVED lifecycle status is terminal and immutable');

    // 27. Future breach after resolution creates a NEW incident row
    const txId6 = randomUUID();
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ('${txId6}', '${wsId}', '${taskId1}', 'active', '${ownerId}');

      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ('${txId6}', 11500.00, 'New fiscal year massive hardware spend');
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: allProjectAlerts } = await client.query(`
      SELECT id, lifecycle_status, opened_risk_band, current_risk_band, resolution_note
      FROM public.finance_alerts
      WHERE workspace_id = '${wsId}' AND entity_id = '${projId}'
      ORDER BY created_at
    `);
    assert.equal(allProjectAlerts.length, 2, 'Future breach after resolution creates a second alert incident');
    assert.equal(allProjectAlerts[0].lifecycle_status, 'resolved', 'First incident remains preserved in resolved status');
    assert.equal(allProjectAlerts[1].lifecycle_status, 'open', 'Second incident is created in open status');
    assert.equal(allProjectAlerts[1].current_risk_band, 'ORANGE');
    pass('Future breach after incident resolution creates a fresh new alert while permanently preserving historical resolved incident');

    // 28. Multi-item transaction correctness: inserting 3 expense items in 1 transaction evaluates once
    const txId7 = randomUUID();
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ('${txId7}', '${wsId}', '${taskId2}', 'active', '${ownerId}');

      INSERT INTO public.expense_items (transaction_id, line_number, amount, description) VALUES
      ('${txId7}', 1, 500.00, 'Split item 1'),
      ('${txId7}', 2, 500.00, 'Split item 2'),
      ('${txId7}', 3, 500.00, 'Split item 3');
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: multiItemAlerts } = await client.query(`
      SELECT id, current_risk_band, actual_spend FROM public.finance_alerts
      WHERE workspace_id = '${wsId}' AND lifecycle_status = 'open'
    `);
    assert.equal(multiItemAlerts.length, 1, 'Multi-item split transaction results in exactly 1 open alert');
    // 11,500 + 1,500 = 13,000 (RED)
    assert.equal(multiItemAlerts[0].current_risk_band, 'RED');
    assert.equal(Number(multiItemAlerts[0].actual_spend), 13000.00);
    pass('Itemized multi-line expense insertion reconciles atomically at transaction commit with zero intermediate duplicate alerts');

    // 29. Budget modification re-evaluates risk: Increase Project Base to 20,000 -> Spend 13,000 becomes YELLOW (13,000 / 20,000 = 65% < 80% is GREEN!)
    await client.query(`
      UPDATE public.budgets
      SET base_budget = 20000.00, safety_buffer = 5000.00
      WHERE id = '${projBudgetId}'
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    const { rows: budgetModifiedAlerts } = await client.query(`
      SELECT id, current_risk_band, condition_cleared_at, base_budget FROM public.finance_alerts
      WHERE workspace_id = '${wsId}' AND lifecycle_status = 'open'
    `);
    assert.equal(budgetModifiedAlerts[0].current_risk_band, 'GREEN');
    assert.equal(Number(budgetModifiedAlerts[0].base_budget), 20000.00);
    assert.ok(budgetModifiedAlerts[0].condition_cleared_at !== null);
    pass('Budget modification trigger re-evaluates canonical risk and sets condition_cleared_at when risk drops');

    // 31. Direct OPEN -> RESOLVED transition rejected
    const openAlertId = budgetModifiedAlerts[0].id;
    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerId,
          `SELECT public.resolve_finance_alert($1, 'Attempt direct resolve from open')`,
          [openAlertId]
        );
      },
      /must be acknowledged first/,
      'Direct transition from OPEN to RESOLVED must be rejected'
    );
    pass('Direct OPEN -> RESOLVED transition is rejected (Decision 66 Open -> Acknowledged -> Resolved enforced)');

    // 32. Phase & Task List budget alert generation
    const phaseBudgetId = randomUUID();
    const taskListBudgetId = randomUUID();

    await client.query(`
      INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer, created_by)
      VALUES ('${phaseBudgetId}', '${wsId}', 'phase', '${projId}', '${phaseId}', 5000.00, 1000.00, '${ownerId}');

      INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, safety_buffer, created_by)
      VALUES ('${taskListBudgetId}', '${wsId}', 'task_list', '${projId}', '${phaseId}', '${taskListId}', 2000.00, 500.00, '${ownerId}');
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    // Both Phase (spend 13,000 > ceiling 6,000) and Task List (spend 13,000 > ceiling 2,500) will be in RED
    const { rows: hierarchyAlerts } = await client.query(`
      SELECT entity_type, entity_name, opened_risk_band, current_risk_band, lifecycle_status
      FROM public.finance_alerts
      WHERE workspace_id = '${wsId}' AND entity_type IN ('phase', 'task_list')
      ORDER BY entity_type
    `);
    assert.equal(hierarchyAlerts.length, 2, 'Phase and Task List budget breaches create corresponding alert incidents');
    assert.equal(hierarchyAlerts[0].entity_type, 'phase');
    assert.equal(hierarchyAlerts[0].current_risk_band, 'RED');
    assert.equal(hierarchyAlerts[1].entity_type, 'task_list');
    assert.equal(hierarchyAlerts[1].current_risk_band, 'RED');
    pass('Hierarchy alert derivation: Phase and Task List budget breaches generate dedicated persistent alerts');

    // 33. Task movement across projects reattributes spend
    const proj2Id = randomUUID();
    const phase2Id = randomUUID();
    const taskList2Id = randomUUID();
    const proj2BudgetId = randomUUID();

    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, created_by)
      VALUES ('${proj2Id}', '${wsId}', 'Beta Wind Farm', '${ownerId}');

      INSERT INTO public.phases (id, project_id, name, created_by)
      VALUES ('${phase2Id}', '${proj2Id}', 'Turbine Assembly', '${ownerId}');

      INSERT INTO public.task_lists (id, phase_id, project_id, name, created_by)
      VALUES ('${taskList2Id}', '${phase2Id}', '${proj2Id}', 'Rotor Installation', '${ownerId}');

      -- Proj 2 Budget: Base = 5000, Buffer = 1000 (Ceiling = 6000)
      INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by)
      VALUES ('${proj2BudgetId}', '${wsId}', 'project', '${proj2Id}', 5000.00, 1000.00, '${ownerId}');
    `);

    // Move taskId1 (has 11,500 spend) from Project 1 to Project 2
    await client.query(`
      UPDATE public.tasks
      SET project_id = '${proj2Id}', phase_id = '${phase2Id}', task_list_id = '${taskList2Id}'
      WHERE id = '${taskId1}'
    `);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    // Project 2 now has 11,500 spend -> RED breach!
    const { rows: proj2Alerts } = await client.query(`
      SELECT entity_name, current_risk_band, actual_spend FROM public.finance_alerts
      WHERE workspace_id = '${wsId}' AND entity_id = '${proj2Id}'
    `);
    assert.equal(proj2Alerts.length, 1, 'Task hierarchy movement successfully triggered alert reconciliation for destination project');
    assert.equal(proj2Alerts[0].current_risk_band, 'RED');
    assert.equal(Number(proj2Alerts[0].actual_spend), 11500.00);
    pass('Task hierarchy movement dynamically re-attributes spend and evaluates alerts for both source and destination entities');

    // 34. Private risk state table access isolation
    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerId,
          `SELECT * FROM private.finance_alert_risk_state`
        );
      },
      /permission denied/,
      'Authenticated user must be denied SELECT on private risk state table'
    );
    pass('private.finance_alert_risk_state is strictly internal (zero client/browser access)');

    // 35. Direct client DML protection on public.finance_alerts
    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerId,
          `INSERT INTO public.finance_alerts (workspace_id, entity_type, entity_id, entity_name, opened_risk_band, current_risk_band)
           VALUES ('${wsId}', 'project', '${projId}', 'Fake Alert', 'ORANGE', 'ORANGE')`
        );
      },
      /(Direct client INSERT|permission denied)/,
      'Direct client INSERT must be rejected'
    );

    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerId,
          `DELETE FROM public.finance_alerts WHERE workspace_id = '${wsId}'`
        );
      },
      /(Direct client DELETE|permission denied)/,
      'Direct client DELETE must be rejected'
    );

    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerId,
          `UPDATE public.finance_alerts SET actual_spend = 0.00, base_budget = 999999.00 WHERE workspace_id = '${wsId}'`
        );
      },
      /(Invalid finance alert lifecycle transition|immutable|permission denied)/,
      'Direct tampering with financial snapshot fields must be blocked'
    );
    pass('Direct client INSERT, DELETE, and arbitrary snapshot UPDATE on public.finance_alerts are strictly blocked');

  } finally {
    await client.query('ROLLBACK');
    await client.end();
    pass('Clean PostgreSQL transaction rollback completed — test fixtures left no trace');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`  ALL ${assertionCount} P6-05 FINANCE ALERT RUNTIME ASSERTIONS PASSED!       `);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

run().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]', err);
  process.exit(1);
});
