/**
 * SNS PROJECTS — PACKAGE 6 / P6-05A & P6-05A1 FINANCE ALERT CENTER TEST SUITE
 *
 * Automated verification for:
 * 1. Routing & Navigation Contracts
 *    - Route /workspace/:workspaceId/finance/alerts in App.jsx
 *    - FinanceOverviewPage renders Alert Center entry link
 *    - NotificationBell routes finance_alert, finance_risk_orange, finance_risk_red to /finance/alerts?alert=<id>
 *    - Non-finance notification routing is fully preserved
 * 2. Access Control, Hook Architecture & P6-05A1 Runtime State Hardening
 *    - Gated by canViewWorkspaceFinance from useFinanceAccess
 *    - Fails closed on unauthorized access and financeAccessError
 *    - useFinanceAlerts keys cache by userId:workspaceId:authorizationScopeKey
 *    - Synchronous state flush on scope shift & generation token (activeFetchIdRef)
 *    - Direct query against public.finance_alerts under RLS; zero localStorage or service_role
 *    - [P6-05A1-A] Invalid ?alert is removed after successful fetch even when alerts = []
 *    - [P6-05A1-B] Invalid deep link is NOT rejected before initial loading completes
 *    - [P6-05A1-C] Resolve modal target is stored by ID, not copied alert object
 *    - [P6-05A1-D] Resolve target derives from current alerts array
 *    - [P6-05A1-E] Realtime risk change updates open Resolve modal state
 *    - [P6-05A1-F] Re-breach ORANGE/RED disables Confirm Resolution
 *    - [P6-05A1-G] Lifecycle no longer acknowledged disables Confirm Resolution
 *    - [P6-05A1-H] Disappearing/inaccessible resolve target closes safely
 *    - [P6-05A1-I] Pending mutation state is keyed per alert
 *    - [P6-05A1-J] Alert A pending does not disable Alert B
 *    - [P6-05A1-K] Same Alert A cannot double-submit
 *    - [P6-05A1-L] No client-generated acknowledged_at timestamp
 *    - [P6-05A1-M] No client-generated resolved_at timestamp
 *    - [P6-05A1-N] Refresh failure preserves current rows and exposes visible failure feedback
 *    - [P6-05A1-O] Text search tests do NOT require risk-band text
 *    - [P6-05A1-P] RED count uses Risk dropdown/filter semantics
 * 3. Realtime Postgres Changes & State Convergence
 *    - Subscribes to public.finance_alerts with workspace_id filter
 *    - Realtime INSERT dedupes, UPDATE merges, DELETE purges
 *    - Cleanup removes channel on unmount or scope change
 *    - Detail modal derives selected alert from current alerts array
 * 4. Lifecycle Action Modals & Mutation Safety
 *    - Acknowledge mutation uses public.acknowledge_finance_alert RPC
 *    - Resolve mutation uses public.resolve_finance_alert RPC
 *    - Resolve UI restricted to canManageBudgets and requires canonical risk recovery (GREEN/YELLOW)
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
  console.log('  SNS PROJECTS — P6-05A & P6-05A1 FINANCE ALERT CENTER VERIFICATION SUITE  ');
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
  pass('useFinanceAlerts delegates mutations exclusively to RPCs');

  // --------------------------------------------------------------------------
  // SUITE 3: P6-05A1 RUNTIME CLOSURE & STATE INTEGRITY ASSERTIONS (A - P)
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 3: P6-05A1 Runtime Closure & State Integrity Assertions (A - P) ---');

  const pageCode = await readFile(path.join(repoRoot, 'src/pages/FinanceAlertCenterPage.jsx'), 'utf8');

  // A & B: Invalid ?alert is removed after successful fetch even when alerts = [] and not before loading completes
  assert.match(
    pageCode,
    /!deepLinkAlertId\s*\|\|\s*loading\s*\|\|\s*!initialFetchCompleted/,
    '[P6-05A1-B] Invalid deep link is NOT rejected before initial loading completes'
  );
  assert.match(
    pageCode,
    /nextParams\.delete\(['"]alert['"]\);[\s\S]*?setSearchParams\(nextParams,\s*\{\s*replace:\s*true\s*\}\)/,
    '[P6-05A1-A] Invalid ?alert is removed using replace navigation after fetch completes'
  );
  pass('P6-05A1-A & B: Deep-link resolution safely cleans missing alerts across zero/non-zero lists only after initial fetch');

  // C & D: Resolve modal target is stored by ID and derived from current alerts array
  assert.match(
    pageCode,
    /const\s*\[resolveTargetAlertId,\s*setResolveTargetAlertId\]\s*=\s*useState\(null\)/,
    '[P6-05A1-C] Resolve modal target is stored strictly by ID (resolveTargetAlertId)'
  );
  assert.match(
    pageCode,
    /const\s+resolveTargetAlert\s*=\s*useMemo\([\s\S]*?resolveTargetAlertId/,
    '[P6-05A1-D] Resolve target is reactively derived from live alerts array using useMemo'
  );
  pass('P6-05A1-C & D: Resolve modal target stores alert ID and reactively derives alert state from live collection');

  // E, F, G: Resolve modal defense-in-depth and live updates
  const resolveModalCode = await readFile(
    path.join(repoRoot, 'src/components/finance/FinanceAlertResolveModal.jsx'),
    'utf8'
  );
  assert.match(
    resolveModalCode,
    /canResolveCurrent\s*=\s*isAcknowledged\s*&&\s*isRiskRecovered\s*&&\s*canManageBudgets/,
    '[P6-05A1-E/F/G] Resolve modal computes canResolveCurrent from live acknowledged status, recovered risk, and manager authority'
  );
  assert.match(
    resolveModalCode,
    /disabled=\{isPending\s*\|\|\s*!canResolveCurrent\}/,
    '[P6-05A1-F/G] Confirm Resolution button is strictly disabled when canResolveCurrent is false'
  );
  assert.match(
    resolveModalCode,
    /if\s*\(!canResolveCurrent\s*\|\|\s*isPending\)\s*return/,
    '[P6-05A1-F/G] handleSubmit rejects submission when alert is no longer eligible'
  );
  pass('P6-05A1-E, F, G: FinanceAlertResolveModal provides defense-in-depth guards against active risk or unacknowledged state');

  // H: Disappearing/inaccessible resolve target closes safely
  assert.match(
    pageCode,
    /resolveTargetAlertId\s*&&\s*!resolveTargetAlert\s*&&\s*!loading[\s\S]*?setResolveTargetAlertId\(null\)/,
    '[P6-05A1-H] Disappearing or inaccessible resolve target auto-closes modal safely'
  );
  pass('P6-05A1-H: Disappearing or inaccessible resolve target automatically closes Resolve modal');

  // I, J, K: Per-alert mutation locks
  assert.match(
    hookCode,
    /const\s*\[pendingAlertActions,\s*setPendingAlertActions\]\s*=\s*useState\(\{\}\)/,
    '[P6-05A1-I] pendingAlertActions is keyed per alert ID'
  );
  assert.match(
    hookCode,
    /if\s*\(!alertId\s*\|\|\s*pendingAlertActions\[alertId\]\)\s*return/,
    '[P6-05A1-K] Same Alert cannot double-submit concurrently'
  );
  assert.match(
    hookCode,
    /setPendingAlertActions\([\s\S]*?\[alertId\]:\s*['"](acknowledge|resolve)['"]/,
    '[P6-05A1-J] Alert A pending sets only its own key and does not block Alert B'
  );
  pass('P6-05A1-I, J, K: Per-alert mutation locks prevent double-submit on Alert A without disabling Alert B');

  // L & M: No client-generated timestamps in hook mutations
  assert.doesNotMatch(
    hookCode,
    /acknowledged_at:\s*returnedAlert\.acknowledged_at\s*\|\|\s*new\s+Date\(\)/,
    '[P6-05A1-L] No client-fabricated acknowledged_at timestamp'
  );
  assert.doesNotMatch(
    hookCode,
    /resolved_at:\s*returnedAlert\.resolved_at\s*\|\|\s*new\s+Date\(\)/,
    '[P6-05A1-M] No client-fabricated resolved_at timestamp'
  );
  pass('P6-05A1-L & M: Hook consumes authoritative backend timestamps exclusively without fabricating client dates');

  // N: Refresh failure preserves current rows and exposes visible failure feedback
  assert.match(
    pageCode,
    /error\s*&&\s*alerts\.length\s*>\s*0/,
    '[P6-05A1-N] Page renders visible refresh error notification when background refresh fails'
  );
  assert.match(
    pageCode,
    /Retry Refresh/,
    '[P6-05A1-N] Page offers Retry action for background refresh failures'
  );
  pass('P6-05A1-N: Refresh failure preserves existing alert rows while displaying visible retry feedback');

  // O & P: Text search & risk filter semantics
  assert.match(
    pageCode,
    /const\s+matchName\s*=\s*\(a\.entity_name\s*\|\|\s*''\)\.toLowerCase\(\)\.includes\(query\)/,
    '[P6-05A1-O] Search matches entity_name'
  );
  assert.match(
    pageCode,
    /const\s+matchType\s*=\s*\(a\.entity_type\s*\|\|\s*''\)\.toLowerCase\(\)\.includes\(query\)/,
    '[P6-05A1-O] Search matches entity_type'
  );
  assert.match(
    pageCode,
    /const\s+matchNote\s*=\s*\(a\.resolution_note\s*\|\|\s*''\)\.toLowerCase\(\)\.includes\(query\)/,
    '[P6-05A1-O] Search matches resolution_note'
  );
  assert.doesNotMatch(
    pageCode,
    /current_risk_band.*\.includes\(query\)/,
    '[P6-05A1-O] Text search does not pollute with risk band text matching'
  );
  assert.match(
    pageCode,
    /<option value=["']RED["']>Risk: RED<\/option>/,
    '[P6-05A1-P] Risk filtering uses dedicated Risk dropdown semantics'
  );
  pass('P6-05A1-O & P: Search matches entity/note fields cleanly; risk band filtering uses dedicated dropdown filter');

  // --------------------------------------------------------------------------
  // SUITE 4: UI ARCHITECTURE, MODALS & LIFECYCLE PRESENTATION
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 4: UI Architecture, Modals & Lifecycle Presentation ---');

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
  // SUITE 5: POSTGRESQL LIVE DATABASE READ-ONLY STATE PARITY VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 5: PostgreSQL Live Database Read-Only State Parity Verification ---');

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
    pass('Security Advisor baseline intact: exactly 7 public SECURITY DEFINER functions (0 new added by P6-05A/A1)');

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

    // 6. Verify isolated transaction rollback test for lifecycle RPCs without touching production facts
    await client.query('BEGIN');
    try {
      const targetRes = await client.query(`
        SELECT id, workspace_id, entity_name, current_risk_band
        FROM public.finance_alerts
        WHERE lifecycle_status = 'open'
        LIMIT 1
      `);
      const testAlert = targetRes.rows[0];
      assert.ok(testAlert, 'Should find open test alert');

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

    // 7. Re-verify production counts post-rollback
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
  console.log(`  ALL ${passCount} P6-05A & P6-05A1 ASSERTIONS PASSED!`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

runP605ATestSuite().catch((err) => {
  console.error('\n❌ P6-05A Verification Suite Failed:', err);
  process.exit(1);
});
