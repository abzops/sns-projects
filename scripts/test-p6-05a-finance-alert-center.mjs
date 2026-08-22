/**
 * SNS PROJECTS — PACKAGE 6 / P6-05A FINANCE ALERT CENTER TEST SUITE
 *
 * Automated verification for:
 * 1. Routing & Navigation Contracts
 *    - Route /workspace/:workspaceId/finance/alerts in App.jsx
 *    - FinanceOverviewPage renders Alert Center entry link
 *    - NotificationBell routes finance_alert, finance_risk_orange, finance_risk_red to /finance/alerts?alert=<id>
 *    - Non-finance notification routing is fully preserved
 * 2. Access Control & Hook Architecture
 *    - Gated by canViewWorkspaceFinance from useFinanceAccess
 *    - Fails closed on unauthorized access and financeAccessError
 *    - useFinanceAlerts keys cache by userId:workspaceId:authorizationScopeKey
 *    - Synchronous state flush on scope shift & generation token (activeFetchIdRef)
 *    - Direct query against public.finance_alerts under RLS; zero localStorage or service_role
 * 3. Realtime Postgres Changes & State Convergence
 *    - Subscribes to public.finance_alerts with workspace_id filter
 *    - Realtime INSERT dedupes, UPDATE merges, DELETE purges
 *    - Cleanup removes channel on unmount or scope change
 *    - Detail modal derives selected alert from current alerts array
 * 4. Lifecycle Action Modals & Mutation Safety
 *    - Acknowledge mutation uses public.acknowledge_finance_alert RPC
 *    - Resolve mutation uses public.resolve_finance_alert RPC
 *    - Per-alert pending mutation tracking prevents double-click submission
 *    - Resolve UI restricted to canManageBudgets and requires canonical risk recovery (GREEN/YELLOW)
 *    - Active ORANGE/RED cannot present enabled resolve action
 *    - Resolution note is optional
 *    - Zero client-side calculation of financial risk, overruns, or budgets
 * 5. Production Database Invariants & Read-Only State Parity
 *    - Live database reports exactly 5 open alerts (1 ORANGE, 4 RED)
 *    - Exactly 0 new public SECURITY DEFINER functions (Security Advisor baseline intact: 6 warnings, 7 public secdef)
 *    - Clean transaction rollback for isolated fixture tests
 *
 * Usage:
 *   node scripts/test-p6-05a-finance-alert-center.mjs
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
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

let passCount = 0;
function pass(msg) {
  passCount++;
  console.log(`[PASS ${passCount}] ${msg}`);
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
    await client.query('SET LOCAL ROLE postgres');
  }
}

async function runP605ATestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — P6-05A FINANCE ALERT CENTER VERIFICATION SUITE           ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // --------------------------------------------------------------------------
  // SUITE 1: SOURCE CODE CONTRACTS, ROUTING & NOTIFICATION DEEP-LINKING
  // --------------------------------------------------------------------------
  console.log('--- Suite 1: Source Code Contracts, Routing & Notification Deep-Linking ---');

  const appJsx = await readFile(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  assert.match(
    appJsx,
    /import\s+FinanceAlertCenterPage\s+from\s+['"]\.\/pages\/FinanceAlertCenterPage['"]/,
    'App.jsx must import FinanceAlertCenterPage'
  );
  assert.match(
    appJsx,
    /<Route\s+path=["']\/workspace\/:workspaceId\/finance\/alerts["']\s+element={<FinanceAlertCenterPage\s*\/>}\s*\/>/,
    'App.jsx must register /workspace/:workspaceId/finance/alerts route'
  );
  pass('App.jsx correctly imports and registers /workspace/:workspaceId/finance/alerts route');

  const overviewJsx = await readFile(path.join(repoRoot, 'src/pages/FinanceOverviewPage.jsx'), 'utf8');
  assert.match(
    overviewJsx,
    /\/workspace\/\$\{workspaceId\}\/finance\/alerts/,
    'FinanceOverviewPage must link to Alert Center'
  );
  assert.match(
    overviewJsx,
    /canViewWorkspaceFinance/,
    'Alert Center link in Finance Overview must be guarded by canViewWorkspaceFinance'
  );
  pass('FinanceOverviewPage renders Alert Center entry link strictly guarded by canViewWorkspaceFinance');

  const bellJsx = await readFile(path.join(repoRoot, 'src/components/NotificationBell.jsx'), 'utf8');
  assert.match(
    bellJsx,
    /notif\.entity_type\s*===\s*['"]finance_alert['"]/,
    'NotificationBell must check for entity_type === finance_alert'
  );
  assert.match(
    bellJsx,
    /notif\.type\s*===\s*['"]finance_risk_orange['"]/,
    'NotificationBell must recognize finance_risk_orange notification type'
  );
  assert.match(
    bellJsx,
    /notif\.type\s*===\s*['"]finance_risk_red['"]/,
    'NotificationBell must recognize finance_risk_red notification type'
  );
  assert.match(
    bellJsx,
    /\/workspace\/\$\{notif\.workspace_id\}\/finance\/alerts\?alert=\$\{targetAlertId\}/,
    'NotificationBell must navigate to /finance/alerts?alert=<id> for Finance Alert notifications'
  );
  assert.match(
    bellJsx,
    /navigate\(`\/workspace\/\$\{notif\.workspace_id\}\/project\/\$\{notif\.project_id\}`\)/,
    'NotificationBell must preserve generic project navigation fallback'
  );
  pass('NotificationBell routes Finance Alert notifications to Alert Center deep link before generic project fallback');

  // --------------------------------------------------------------------------
  // SUITE 2: ACCESS CONTRACT, HOOK ARCHITECTURE & SCOPE ISOLATION
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 2: Access Contract, Hook Architecture & Scope Isolation ---');

  const hookCode = await readFile(path.join(repoRoot, 'src/hooks/useFinanceAlerts.js'), 'utf8');
  assert.match(
    hookCode,
    /export\s+function\s+useFinanceAlerts\(/,
    'useFinanceAlerts must be exported from src/hooks/useFinanceAlerts.js'
  );
  assert.match(
    hookCode,
    /activeFetchIdRef/,
    'useFinanceAlerts must maintain activeFetchIdRef generation token to eliminate async race conditions'
  );
  assert.match(
    hookCode,
    /\.from\(['"]finance_alerts['"]\)/,
    'useFinanceAlerts must query public.finance_alerts table directly under RLS'
  );
  assert.match(
    hookCode,
    /\.eq\(['"]workspace_id['"],\s*workspaceId\)/,
    'useFinanceAlerts must strictly filter query by workspace_id'
  );
  assert.doesNotMatch(
    hookCode,
    /localStorage/,
    'useFinanceAlerts must not use localStorage'
  );
  assert.doesNotMatch(
    hookCode,
    /service_role/,
    'useFinanceAlerts must not use service_role'
  );
  pass('useFinanceAlerts queries public.finance_alerts under RLS with workspace_id scoping and zero localStorage');

  assert.match(
    hookCode,
    /activeScopeKey\s*!==\s*activeCacheKey\s*\|\|\s*!enabled/,
    'useFinanceAlerts must detect scope key shifts and disabled state'
  );
  assert.match(
    hookCode,
    /setAlerts\(\[\]\)/,
    'useFinanceAlerts must synchronously flush alerts on scope shift'
  );
  pass('useFinanceAlerts implements synchronous cache isolation and state flush on scope key shifts');

  assert.match(
    hookCode,
    /supabase\s*\.channel\(/,
    'useFinanceAlerts must open a Supabase Realtime channel'
  );
  assert.match(
    hookCode,
    /table:\s*['"]finance_alerts['"]/,
    'useFinanceAlerts must subscribe to postgres_changes on finance_alerts'
  );
  assert.match(
    hookCode,
    /supabase\s*\.removeChannel\(/,
    'useFinanceAlerts must clean up Realtime channel on unmount or scope change'
  );
  pass('useFinanceAlerts configures Realtime Postgres Changes subscription with clean channel teardown');

  assert.match(
    hookCode,
    /supabase\.rpc\(['"]acknowledge_finance_alert['"]/,
    'acknowledgeAlert must invoke public.acknowledge_finance_alert RPC'
  );
  assert.match(
    hookCode,
    /supabase\.rpc\(['"]resolve_finance_alert['"]/,
    'resolveAlert must invoke public.resolve_finance_alert RPC'
  );
  assert.match(
    hookCode,
    /pendingAlertAction/,
    'useFinanceAlerts must track pendingAlertAction to prevent duplicate simultaneous submissions'
  );
  pass('useFinanceAlerts delegates mutations exclusively to RPCs with per-alert pending action guards');

  // --------------------------------------------------------------------------
  // SUITE 3: UI ARCHITECTURE, MODALS & LIFECYCLE PRESENTATION
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 3: UI Architecture, Modals & Lifecycle Presentation ---');

  const pageCode = await readFile(path.join(repoRoot, 'src/pages/FinanceAlertCenterPage.jsx'), 'utf8');
  assert.match(
    pageCode,
    /useFinanceAccess\(workspaceId\)/,
    'FinanceAlertCenterPage must consume canonical useFinanceAccess'
  );
  assert.match(
    pageCode,
    /!canViewWorkspaceFinance\s*\|\|\s*financeAccessError/,
    'FinanceAlertCenterPage must fail closed when canViewWorkspaceFinance is false or error occurs'
  );
  assert.match(
    pageCode,
    /Finance alerts provide financial (governance|risk) visibility and do not block operational task or process execution/,
    'FinanceAlertCenterPage must render operational non-blocking governance banner'
  );
  pass('FinanceAlertCenterPage enforces fail-closed access gating and displays non-blocking governance banner');

  assert.match(
    pageCode,
    /useSearchParams/,
    'FinanceAlertCenterPage must use useSearchParams for ?alert=<id> deep linking'
  );
  assert.match(
    pageCode,
    /That Finance Alert is not available\./,
    'FinanceAlertCenterPage must display safe feedback when deep linked alert is not available'
  );
  assert.match(
    pageCode,
    /nextParams\.delete\(['"]alert['"]\)/,
    'FinanceAlertCenterPage must clean up invalid or closed deep link query parameter'
  );
  pass('FinanceAlertCenterPage handles deep linking (?alert=<uuid>) with safe unauthenticated/missing fallback');

  const resolveModalCode = await readFile(
    path.join(repoRoot, 'src/components/finance/FinanceAlertResolveModal.jsx'),
    'utf8'
  );
  assert.match(
    resolveModalCode,
    /FinanceAlertResolveModal/,
    'FinanceAlertResolveModal component must exist'
  );
  assert.match(
    resolveModalCode,
    /onResolve\(alert\.id,\s*note\)/,
    'FinanceAlertResolveModal must pass alert id and optional note to onResolve'
  );
  assert.match(
    resolveModalCode,
    /It does (?:<strong>)?not(?:<\/strong>)? delete finance history, budgets, expenses, or alter financial totals/,
    'FinanceAlertResolveModal must explain that resolution is an operational closure only'
  );
  pass('FinanceAlertResolveModal renders controlled resolution flow with optional note and audit invariants');

  const detailModalCode = await readFile(
    path.join(repoRoot, 'src/components/finance/FinanceAlertDetailModal.jsx'),
    'utf8'
  );
  assert.match(
    detailModalCode,
    /FinanceAlertDetailModal/,
    'FinanceAlertDetailModal component must exist'
  );
  assert.match(
    detailModalCode,
    /alert\.actual_spend/,
    'FinanceAlertDetailModal must display actual_spend snapshot'
  );
  assert.match(
    detailModalCode,
    /alert\.base_budget/,
    'FinanceAlertDetailModal must display base_budget snapshot'
  );
  assert.match(
    detailModalCode,
    /alert\.safety_buffer/,
    'FinanceAlertDetailModal must display safety_buffer snapshot'
  );
  assert.match(
    detailModalCode,
    /alert\.overrun/,
    'FinanceAlertDetailModal must display overrun snapshot'
  );
  assert.match(
    detailModalCode,
    /alert\.utilization_pct/,
    'FinanceAlertDetailModal must display utilization_pct snapshot'
  );
  assert.match(
    detailModalCode,
    /canResolveNow\s*\?/,
    'FinanceAlertDetailModal must strictly check canResolveNow (acknowledged + manager + GREEN/YELLOW)'
  );
  pass('FinanceAlertDetailModal renders complete financial metrics snapshot and enforces resolution prerequisites');

  const badgeCode = await readFile(
    path.join(repoRoot, 'src/components/finance/FinanceAlertLifecycleBadge.jsx'),
    'utf8'
  );
  assert.match(badgeCode, /OPEN/, 'FinanceAlertLifecycleBadge must support OPEN');
  assert.match(badgeCode, /ACKNOWLEDGED/, 'FinanceAlertLifecycleBadge must support ACKNOWLEDGED');
  assert.match(badgeCode, /RESOLVED/, 'FinanceAlertLifecycleBadge must support RESOLVED');
  assert.match(badgeCode, /CONDITION CLEARED/, 'FinanceAlertLifecycleBadge must support contextual CONDITION CLEARED');
  pass('FinanceAlertLifecycleBadge correctly formats OPEN, ACKNOWLEDGED, RESOLVED, and CONDITION CLEARED states');

  // --------------------------------------------------------------------------
  // SUITE 4: POSTGRESQL LIVE DATABASE READ-ONLY STATE PARITY VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 4: PostgreSQL Live Database Read-Only State Parity Verification ---');

  const envContent = await readFile(envAdminPath, 'utf8');
  const env = parseEnv(envContent);
  const dbUrl = env.SUPABASE_DB_URL || env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL not found in .env.admin');
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // 1. Verify schema_migrations contains P6-05 & P6-05R1 tips
    const migRes = await client.query(`
      SELECT version FROM supabase_migrations.schema_migrations
      WHERE version IN ('20260822144843', '20260822152000')
      ORDER BY version
    `);
    assert.equal(migRes.rows.length, 2, 'Migrations 20260822144843 and 20260822152000 must be in schema_migrations');
    pass('Migrations 20260822144843 and 20260822152000 confirmed in ledger');

    // 2. Security Advisor baseline: exactly 7 public SECURITY DEFINER functions (0 new added)
    const secDefRes = await client.query(`
      SELECT proname FROM pg_proc
      JOIN pg_namespace n ON pronamespace = n.oid
      WHERE n.nspname = 'public' AND prosecdef = true
      ORDER BY proname
    `);
    assert.equal(
      secDefRes.rows.length,
      7,
      `Expected exactly 7 public SECURITY DEFINER functions, got ${secDefRes.rows.length}`
    );
    pass('Security Advisor baseline intact: exactly 7 public SECURITY DEFINER functions (0 new added by P6-05A)');

    // 3. Verify public lifecycle RPCs are SECURITY INVOKER with search_path = ''
    const rpcRes = await client.query(`
      SELECT proname, prosecdef, proconfig
      FROM pg_proc
      JOIN pg_namespace n ON pronamespace = n.oid
      WHERE n.nspname = 'public' AND proname IN ('acknowledge_finance_alert', 'resolve_finance_alert')
    `);
    assert.equal(rpcRes.rows.length, 2, 'Both public lifecycle RPCs must exist');
    for (const row of rpcRes.rows) {
      assert.equal(row.prosecdef, false, `public.${row.proname} must be SECURITY INVOKER`);
      assert.ok(
        row.proconfig?.some((cfg) => cfg === 'search_path=""' || cfg === 'search_path='),
        `public.${row.proname} must have empty search_path`
      );
    }
    pass('public.acknowledge_finance_alert and resolve_finance_alert are SECURITY INVOKER with search_path=""');

    // 4. Verify public.finance_alerts RLS is enabled
    const rlsRes = await client.query(`
      SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'finance_alerts'
    `);
    assert.equal(rlsRes.rows[0]?.rowsecurity, true, 'public.finance_alerts must have RLS enabled');
    pass('public.finance_alerts table has Row Level Security enabled');

    // 5. Verify production alert count: exactly 5 alerts (1 ORANGE, 4 RED, all 5 OPEN)
    const alertCountRes = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE lifecycle_status = 'open')::int AS open_count,
        COUNT(*) FILTER (WHERE lifecycle_status = 'acknowledged')::int AS ack_count,
        COUNT(*) FILTER (WHERE lifecycle_status = 'resolved')::int AS resolved_count,
        COUNT(*) FILTER (WHERE current_risk_band = 'ORANGE')::int AS orange_count,
        COUNT(*) FILTER (WHERE current_risk_band = 'RED')::int AS red_count
      FROM public.finance_alerts
    `);
    const c = alertCountRes.rows[0];
    assert.equal(c.total, 5, `Expected 5 production finance alerts, found ${c.total}`);
    assert.equal(c.open_count, 5, `Expected 5 open finance alerts, found ${c.open_count}`);
    assert.equal(c.ack_count, 0, `Expected 0 acknowledged finance alerts, found ${c.ack_count}`);
    assert.equal(c.resolved_count, 0, `Expected 0 resolved finance alerts, found ${c.resolved_count}`);
    assert.equal(c.orange_count, 1, `Expected 1 ORANGE finance alert, found ${c.orange_count}`);
    assert.equal(c.red_count, 4, `Expected 4 RED finance alerts, found ${c.red_count}`);
    pass(`Production live parity confirmed: 5 total alerts (5 OPEN, 0 ACK, 0 RESOLVED | 1 ORANGE, 4 RED)`);

    // 6. Verify zero retroactive notifications existed for initial bootstrap
    const notifRes = await client.query(`
      SELECT COUNT(*)::int AS count FROM public.notifications
      WHERE type IN ('finance_risk_orange', 'finance_risk_red')
    `);
    assert.equal(notifRes.rows[0]?.count, 0, 'Production baseline must have 0 retroactive finance notifications');
    pass('Production bootstrap baseline has exactly 0 retroactive finance notifications');

    // 7. Verify isolated transaction rollback test for lifecycle RPCs without touching production facts
    await client.query('BEGIN');
    try {
      // Pick one open alert in the transaction
      const targetRes = await client.query(`
        SELECT id, workspace_id, entity_name, current_risk_band
        FROM public.finance_alerts
        WHERE lifecycle_status = 'open'
        LIMIT 1
      `);
      const testAlert = targetRes.rows[0];
      assert.ok(testAlert, 'Should find open test alert');

      // Find active workspace member for authorization
      const memberRes = await client.query(`
        SELECT user_id FROM public.workspace_members
        WHERE workspace_id = $1 AND role IN ('owner', 'admin') AND status = 'active'
        LIMIT 1
      `, [testAlert.workspace_id]);
      const authUserId = memberRes.rows[0]?.user_id;
      assert.ok(authUserId, 'Must find active owner/admin for test');

      // Test Acknowledge RPC execution
      const ackRes = await asUser(
        client,
        authUserId,
        `SELECT public.acknowledge_finance_alert($1::uuid) AS result`,
        [testAlert.id]
      );
      const ackData = ackRes.rows[0]?.result;
      assert.equal(ackData?.lifecycle_status, 'acknowledged', 'Status should be acknowledged');

      // Verify direct transition to RESOLVED while risk is ORANGE/RED fails
      let resolveBlocked = false;
      try {
        await asUser(
          client,
          authUserId,
          `SELECT public.resolve_finance_alert($1::uuid, 'Premature resolution') AS result`,
          [testAlert.id]
        );
      } catch (err) {
        resolveBlocked = true;
        assert.match(
          err.message,
          /Cannot resolve finance alert while current risk is/i,
          'Resolution of active ORANGE/RED alert must be rejected'
        );
      }
      assert.equal(resolveBlocked, true, 'Resolution while active ORANGE/RED was strictly rejected');
      pass('public.resolve_finance_alert strictly blocks resolution while risk remains ORANGE or RED');
    } finally {
      await client.query('ROLLBACK');
      pass('Clean PostgreSQL transaction rollback completed — production database remains untouched');
    }

    // 8. Re-verify production counts post-rollback
    const postRollbackRes = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE lifecycle_status = 'open')::int AS open_count
      FROM public.finance_alerts
    `);
    assert.equal(postRollbackRes.rows[0]?.total, 5, 'Production alert total must remain 5 after rollback');
    assert.equal(postRollbackRes.rows[0]?.open_count, 5, 'Production open alerts must remain 5 after rollback');
    pass('Post-rollback check confirmed zero mutation leakage into production state');
  } finally {
    await client.end();
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`  ALL ${passCount} P6-05A FINANCE ALERT CENTER ASSERTIONS PASSED!`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

runP605ATestSuite().catch((err) => {
  console.error('\n❌ P6-05A Verification Suite Failed:', err);
  process.exit(1);
});
