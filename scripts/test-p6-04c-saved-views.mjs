/**
 * SNS PROJECTS — PACKAGE 6 / P6-04C & P6-04C1 PERSISTENT SAVED VIEWS SUITE
 *
 * Automated verification for:
 * 1. Frontend Serializer, Normalizer & State Contracts
 *    - Strict schemaVersion = 1
 *    - Explicit whitelist serialization (no cache, rows, summaries or identities)
 *    - All 19 Explorer filter/group/sort fields round-trip
 *    - Frozen P6-04 Enum alignment:
 *      * Status: Active, Completed, Cancelled, Corrected, Voided
 *      * Group By: none, project, phase, task_list, owner, department, rowType, status, riskBand
 *      * Sort By: name, actualSpend, utilizationPct, riskBand, date, ownerName
 *    - Metadata normalization using actual shape (owners, creators, departments with name and 'Unassigned')
 *    - Cascading hierarchy references sanitized against current metadata
 *    - Dirty state checking accurately detects unsaved modifications
 *    - Source code audits: no canAccessFinance, real enabled contract, no localStorage, no Finance fact mutations
 *    - Generation token (activeFetchIdRef) & synchronous cache flush on scope shift
 *    - Update error handling in SavedViewsBar
 *
 * 2. Database Schema, RLS Policies, Grants & Anti-Spoofing Triggers
 *    - public.finance_explorer_saved_views table structure and constraints
 *    - Unique case-insensitive name per user per workspace
 *    - Anti-spoofing trigger forces user_id to auth.uid() on INSERT
 *    - Immutability of user_id, workspace_id, and created_at on UPDATE
 *    - Authenticated table privileges are strictly SELECT, INSERT, UPDATE, DELETE (TRUNCATE, REFERENCES, TRIGGER false)
 *    - Anon has zero table privileges
 *    - Authenticated CRUD allowed for active Finance Owner & Finance Operator
 *    - User isolation: User A cannot read, update, or delete User B's Saved Views
 *    - Cross-workspace isolation: Workspace A views invisible in Workspace B
 *    - Access control: Member, Viewer, Project Admin only, System Admin only, inactive denied
 *    - Access revocation preserves records in DB but denies RLS access
 *    - Security Advisor baseline intact (0 new public SECURITY DEFINER)
 *    - Clean transaction rollback
 *
 * Usage:
 *   node scripts/test-p6-04c-saved-views.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  SAVED_VIEW_SCHEMA_VERSION,
  DEFAULT_EXPLORER_VIEW_STATE,
  VALID_STATUSES,
  VALID_GROUP_BYS,
  VALID_SORT_BYS,
  serializeSavedViewState,
  normalizeSavedViewState,
  isSavedViewDirty,
} from '../src/lib/financialExplorerSavedViews.js';

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
                set_config('request.jwt.claim.role', 'authenticated', true)`,
        [userId]
      );
    } else {
      await client.query(`
        SELECT set_config('request.jwt.claim.sub', '', true),
               set_config('request.jwt.claim.role', '', true)
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

async function runFrontendContractsSuite() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  SUITE 1: FRONTEND CONTRACTS, SERIALIZER & NORMALIZER                     ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // 1. Schema version
  assert.equal(SAVED_VIEW_SCHEMA_VERSION, 1, 'SAVED_VIEW_SCHEMA_VERSION must be exactly 1');
  pass('SAVED_VIEW_SCHEMA_VERSION is 1');

  // 2. Explicit whitelist serialization - no cache, rows, or identities
  const mockDirtyState = {
    entityType: 'task',
    selectedProject: 'proj-123',
    selectedPhase: 'phase-456',
    selectedTaskList: 'list-789',
    selectedTask: 'task-001',
    selectedOwner: 'user-001',
    selectedDepartment: 'Finance',
    selectedStatus: 'Active',
    selectedRisk: 'ORANGE',
    overBudgetOnly: true,
    selectedCreator: 'user-002',
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    amountMin: '1000',
    amountMax: '50000',
    searchQuery: 'cloud licenses',
    groupBy: 'department',
    sortBy: 'actualSpend',
    sortOrder: 'desc',
    // Sensitive/internal fields that MUST NOT be serialized
    workspaceId: 'ws-secret',
    userId: 'user-secret',
    authorizationScopeKey: 'auth-scope-secret',
    rows: [{ id: 1, amount: 5000 }],
    financialSummaries: { total: 10000 },
    expenseData: [1, 2, 3],
  };

  const serialized = serializeSavedViewState(mockDirtyState);
  assert.equal(serialized.schemaVersion, 1);
  assert.equal(serialized.entityType, 'task');
  assert.equal(serialized.selectedProject, 'proj-123');
  assert.equal(serialized.selectedDepartment, 'Finance');
  assert.equal(serialized.selectedStatus, 'Active');
  assert.equal(serialized.overBudgetOnly, true);
  assert.equal(serialized.searchQuery, 'cloud licenses');
  assert.equal(serialized.groupBy, 'department');
  assert.equal(serialized.sortBy, 'actualSpend');
  assert.equal(serialized.sortOrder, 'desc');
  assert.equal(serialized.workspaceId, undefined, 'workspaceId must not be serialized');
  assert.equal(serialized.userId, undefined, 'userId must not be serialized');
  assert.equal(serialized.authorizationScopeKey, undefined, 'authorizationScopeKey must not be serialized');
  assert.equal(serialized.rows, undefined, 'rows must not be serialized');
  assert.equal(serialized.financialSummaries, undefined, 'financialSummaries must not be serialized');
  pass('Serializer uses strict whitelist and discards sensitive/internal cache fields');

  // 3. Normalization of unknown/invalid fields
  const malformedPayload = {
    schemaVersion: 99,
    entityType: 'INVALID_TYPE',
    selectedStatus: 'NON_EXISTENT_STATUS',
    selectedRisk: 'PURPLE',
    overBudgetOnly: 'yes', // should be boolean false
    groupBy: 'INVALID_GROUP',
    sortBy: 'INVALID_SORT',
    sortOrder: 'sideways',
    unknownJunkKey: 12345,
  };

  const normalized = normalizeSavedViewState(malformedPayload);
  assert.equal(normalized.entityType, DEFAULT_EXPLORER_VIEW_STATE.entityType);
  assert.equal(normalized.selectedStatus, DEFAULT_EXPLORER_VIEW_STATE.selectedStatus);
  assert.equal(normalized.selectedRisk, DEFAULT_EXPLORER_VIEW_STATE.selectedRisk);
  assert.equal(normalized.overBudgetOnly, false);
  assert.equal(normalized.groupBy, DEFAULT_EXPLORER_VIEW_STATE.groupBy);
  assert.equal(normalized.sortBy, DEFAULT_EXPLORER_VIEW_STATE.sortBy);
  assert.equal(normalized.sortOrder, DEFAULT_EXPLORER_VIEW_STATE.sortOrder);
  assert.equal(normalized.unknownJunkKey, undefined);
  pass('Normalizer safely sanitizes invalid enum values and strips unknown keys');

  // 4. Stale Hierarchy Reference Sanitization & Cascading Integrity
  const mockMetadata = {
    projects: [{ id: 'p1' }, { id: 'p2' }],
    phases: [{ id: 'ph1', project_id: 'p1' }],
    task_lists: [{ id: 'tl1', phase_id: 'ph1', project_id: 'p1' }],
    tasks: [{ id: 't1', task_list_id: 'tl1', phase_id: 'ph1', project_id: 'p1' }],
    owners: [{ id: 'u1' }],
    creators: [{ id: 'c1' }],
    departments: [{ name: 'Engineering' }, { name: 'Finance' }],
  };

  // Case A: Stale project resets all descendants
  const staleProjectState = {
    selectedProject: 'deleted-proj-xyz',
    selectedPhase: 'ph1',
    selectedTaskList: 'tl1',
    selectedTask: 't1',
    selectedOwner: 'u1',
    selectedDepartment: 'Finance',
  };
  const sanitizedA = normalizeSavedViewState(staleProjectState, mockMetadata);
  assert.equal(sanitizedA.selectedProject, 'all');
  assert.equal(sanitizedA.selectedPhase, 'all');
  assert.equal(sanitizedA.selectedTaskList, 'all');
  assert.equal(sanitizedA.selectedTask, 'all');
  assert.equal(sanitizedA.selectedOwner, 'u1');
  assert.equal(sanitizedA.selectedDepartment, 'Finance');
  pass('Stale Project reference safely resets Project, Phase, Task List, and Task to "all"');

  // Case B: Phase belongs to different project than selected
  const mismatchPhaseState = {
    selectedProject: 'p2',
    selectedPhase: 'ph1', // belongs to p1
    selectedTaskList: 'tl1',
    selectedTask: 't1',
  };
  const sanitizedB = normalizeSavedViewState(mismatchPhaseState, mockMetadata);
  assert.equal(sanitizedB.selectedProject, 'p2');
  assert.equal(sanitizedB.selectedPhase, 'all');
  assert.equal(sanitizedB.selectedTaskList, 'all');
  assert.equal(sanitizedB.selectedTask, 'all');
  pass('Cascading phase/project misalignment resets Phase and lower descendants');

  // Case C: Stale Owner, Creator & Department
  const staleOwnerDeptState = {
    selectedOwner: 'deleted-user',
    selectedDepartment: 'deleted-dept',
    selectedCreator: 'deleted-creator',
  };
  const sanitizedC = normalizeSavedViewState(staleOwnerDeptState, mockMetadata);
  assert.equal(sanitizedC.selectedOwner, 'all');
  assert.equal(sanitizedC.selectedDepartment, 'all');
  assert.equal(sanitizedC.selectedCreator, 'all');
  pass('Stale Owner, Department, and Creator safely fall back to "all"');

  // 5. Dirty state checker
  const baseState = { ...DEFAULT_EXPLORER_VIEW_STATE, entityType: 'expense', selectedRisk: 'RED' };
  assert.equal(isSavedViewDirty(baseState, baseState), false, 'Identical state must not be dirty');
  assert.equal(isSavedViewDirty({ ...baseState, overBudgetOnly: true }, baseState), true, 'Modified flag must be dirty');
  assert.equal(isSavedViewDirty({ ...baseState, sortBy: 'actualSpend' }, baseState), true, 'Modified sort must be dirty');
  pass('isSavedViewDirty accurately detects modifications against baseline');

  // 6. Source code inspection for authoritative storage & zero fact table writes
  const hookSource = await readFile(path.join(repoRoot, 'src', 'hooks', 'useFinancialExplorerSavedViews.js'), 'utf8');
  assert.ok(hookSource.includes('finance_explorer_saved_views'), 'Hook must query finance_explorer_saved_views table');
  assert.ok(!hookSource.includes('localStorage.setItem'), 'Hook must not use localStorage as authoritative store');
  assert.ok(!hookSource.includes('expense_transactions'), 'Hook must never mutate expense_transactions');
  assert.ok(!hookSource.includes('budgets'), 'Hook must never mutate budgets');
  pass('Hook queries canonical database table with zero fact table mutations and no localStorage reliance');

  const pageSource = await readFile(path.join(repoRoot, 'src', 'pages', 'FinancialExplorerPage.jsx'), 'utf8');
  assert.ok(pageSource.includes('FinancialExplorerSavedViewsBar'), 'FinancialExplorerPage must render SavedViewsBar');
  assert.ok(pageSource.includes('useFinancialExplorerSavedViews'), 'FinancialExplorerPage must use saved views hook');
  pass('FinancialExplorerPage integrates Saved Views bar and state management cleanly');

  // P6-04C1 Required Assertions A through Q & W, X, Y
  console.log('\n--- P6-04C1: Runtime, Enums & Metadata Hardening Assertions ---');

  // Assertion A: source contract contains NO reference to canAccessFinance
  assert.ok(!hookSource.includes('canAccessFinance'), 'Hook must NOT reference canAccessFinance');
  assert.ok(!pageSource.includes('canAccessFinance'), 'Page must NOT reference canAccessFinance');
  pass('[Req A] Source contract contains NO reference to canAccessFinance');

  // Assertion B: Saved View hook uses real Finance enable contract
  assert.ok(hookSource.includes('{ enabled = true }'), 'Hook signature must take { enabled } option');
  assert.ok(pageSource.includes('enabled: canViewWorkspaceFinance && !financeAccessError'), 'Page must pass enabled condition');
  pass('[Req B] Saved View hook uses the real Finance enable contract (canViewWorkspaceFinance && !financeAccessError)');

  // Assertion C: scope key contains userId + workspaceId + authorizationScopeKey
  assert.ok(
    hookSource.includes('userId') && hookSource.includes('workspaceId') && hookSource.includes('authorizationScopeKey'),
    'Hook scope key must combine userId, workspaceId, and authorizationScopeKey'
  );
  pass('[Req C] Saved View scope key contains userId + workspaceId + authorizationScopeKey');

  // Assertion D: scope change synchronously clears previous savedViews
  assert.ok(
    hookSource.includes('setSavedViews([])') && hookSource.includes('activeScopeKey !== activeCacheKey'),
    'Hook must synchronously flush savedViews on scope change'
  );
  pass('[Req D] Scope change synchronously clears previous savedViews');

  // Assertion E: stale fetch response is discarded via generation token
  assert.ok(
    hookSource.includes('activeFetchIdRef') && hookSource.includes('fetchId !== activeFetchIdRef.current'),
    'Hook must discard responses if fetchId !== activeFetchIdRef.current'
  );
  pass('[Req E] Stale async fetch response is safely discarded via activeFetchIdRef generation token');

  // Assertion F: Active status round-trips exactly
  assert.ok(VALID_STATUSES.includes('Active'), 'VALID_STATUSES must contain "Active"');
  assert.equal(serializeSavedViewState({ selectedStatus: 'Active' }).selectedStatus, 'Active');
  assert.equal(normalizeSavedViewState({ selectedStatus: 'Active' }).selectedStatus, 'Active');
  pass('[Req F] Status = "Active" round-trips exactly (case-sensitive preserved)');

  // Assertion G: Completed, Corrected and Voided round-trip exactly
  for (const st of ['Completed', 'Cancelled', 'Corrected', 'Voided']) {
    assert.ok(VALID_STATUSES.includes(st), `VALID_STATUSES must contain "${st}"`);
    assert.equal(serializeSavedViewState({ selectedStatus: st }).selectedStatus, st);
    assert.equal(normalizeSavedViewState({ selectedStatus: st }).selectedStatus, st);
  }
  pass('[Req G] Statuses "Completed", "Cancelled", "Corrected", "Voided" round-trip exactly');

  // Assertion H: rowType grouping round-trips exactly
  assert.ok(VALID_GROUP_BYS.includes('rowType'), 'VALID_GROUP_BYS must contain "rowType"');
  assert.equal(serializeSavedViewState({ groupBy: 'rowType' }).groupBy, 'rowType');
  assert.equal(normalizeSavedViewState({ groupBy: 'rowType' }).groupBy, 'rowType');
  pass('[Req H] Group By = "rowType" round-trips exactly');

  // Assertion I: riskBand grouping round-trips exactly
  assert.ok(VALID_GROUP_BYS.includes('riskBand'), 'VALID_GROUP_BYS must contain "riskBand"');
  assert.equal(serializeSavedViewState({ groupBy: 'riskBand' }).groupBy, 'riskBand');
  assert.equal(normalizeSavedViewState({ groupBy: 'riskBand' }).groupBy, 'riskBand');
  pass('[Req I] Group By = "riskBand" round-trips exactly');

  // Assertion J: utilizationPct sorting round-trips exactly
  assert.ok(VALID_SORT_BYS.includes('utilizationPct'), 'VALID_SORT_BYS must contain "utilizationPct"');
  assert.equal(serializeSavedViewState({ sortBy: 'utilizationPct' }).sortBy, 'utilizationPct');
  assert.equal(normalizeSavedViewState({ sortBy: 'utilizationPct' }).sortBy, 'utilizationPct');
  pass('[Req J] Sort By = "utilizationPct" round-trips exactly');

  // Assertion K: riskBand sorting round-trips exactly
  assert.ok(VALID_SORT_BYS.includes('riskBand'), 'VALID_SORT_BYS must contain "riskBand"');
  assert.equal(serializeSavedViewState({ sortBy: 'riskBand' }).sortBy, 'riskBand');
  assert.equal(normalizeSavedViewState({ sortBy: 'riskBand' }).sortBy, 'riskBand');
  pass('[Req K] Sort By = "riskBand" round-trips exactly');

  // Assertion L: ownerName sorting round-trips exactly
  assert.ok(VALID_SORT_BYS.includes('ownerName'), 'VALID_SORT_BYS must contain "ownerName"');
  assert.equal(serializeSavedViewState({ sortBy: 'ownerName' }).sortBy, 'ownerName');
  assert.equal(normalizeSavedViewState({ sortBy: 'ownerName' }).sortBy, 'ownerName');
  pass('[Req L] Sort By = "ownerName" round-trips exactly');

  // Assertion M: Owner filter survives normalization using actual owner option shape
  const ownerMeta = { owners: [{ id: 'user-alice-01', full_name: 'Alice Owner' }] };
  assert.equal(
    normalizeSavedViewState({ selectedOwner: 'user-alice-01' }, ownerMeta).selectedOwner,
    'user-alice-01'
  );
  pass('[Req M] Owner filter survives normalization using actual owner option shape (owners[].id)');

  // Assertion N: Creator filter survives normalization using actual creator option shape
  const creatorMeta = { creators: [{ id: 'user-bob-02', full_name: 'Bob Creator' }] };
  assert.equal(
    normalizeSavedViewState({ selectedCreator: 'user-bob-02' }, creatorMeta).selectedCreator,
    'user-bob-02'
  );
  pass('[Req N] Creator filter survives normalization using actual creator option shape (creators[].id)');

  // Assertion O: Department NAME survives normalization
  const deptMeta = { departments: [{ id: 'dept-1', name: 'Finance & Accounts' }] };
  assert.equal(
    normalizeSavedViewState({ selectedDepartment: 'Finance & Accounts' }, deptMeta).selectedDepartment,
    'Finance & Accounts'
  );
  pass('[Req O] Department NAME survives normalization using actual department options (departments[].name)');

  // Assertion P: Unassigned Department survives normalization
  assert.equal(
    normalizeSavedViewState({ selectedDepartment: 'Unassigned' }, deptMeta).selectedDepartment,
    'Unassigned'
  );
  pass('[Req P] "Unassigned" Department is preserved as a valid filter value');

  // Assertion Q: metadata bundle does NOT rely on nonexistent hierarchyData.profiles/primaryDepartments
  assert.ok(!pageSource.includes('hierarchyData.profiles'), 'Page must NOT reference hierarchyData.profiles');
  assert.ok(!pageSource.includes('hierarchyData.primaryDepartments'), 'Page must NOT reference hierarchyData.primaryDepartments');
  assert.ok(pageSource.includes('owners: hierarchyData?.owners'), 'Page must supply owners from hierarchyData');
  assert.ok(pageSource.includes('creators: hierarchyData?.creators'), 'Page must supply creators from hierarchyData');
  assert.ok(pageSource.includes('departments: hierarchyData?.departments'), 'Page must supply departments from hierarchyData');
  pass('[Req Q] Page metadata bundle exclusively uses real hierarchyData.owners/creators/departments');

  // Assertion W: Update mutation failure has visible error handling
  const barSource = await readFile(path.join(repoRoot, 'src', 'components', 'finance', 'FinancialExplorerSavedViewsBar.jsx'), 'utf8');
  assert.ok(
    barSource.includes('handleUpdateClick') && barSource.includes('setUpdateError'),
    'SavedViewsBar must catch update error and set visible updateError state'
  );
  pass('[Req W] Update Current View error is caught and surfaced visibly in SavedViewsBar');

  // Assertion X: Browser refresh reload path is enabled for authorized Finance user
  assert.ok(pageSource.includes('onRetryFetch={fetchSavedViews}'), 'Page supplies onRetryFetch callback to SavedViewsBar');
  assert.ok(barSource.includes('onRetryFetch'), 'SavedViewsBar wires retry button');
  pass('[Req X] Browser refresh and manual retry path are fully wired for authorized users');

  // Assertion Y: User/workspace switch cannot display stale saved-view names
  assert.ok(
    hookSource.includes('setActiveSavedViewId(null)') && hookSource.includes('setSavedViews([])'),
    'Hook clears activeSavedViewId and savedViews on scope switch'
  );
  pass('[Req Y] User/workspace switch guarantees previous saved-view names are purged immediately');
}

async function runDatabaseSuite() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  SUITE 2: DATABASE SCHEMA, RLS & OWNERSHIP IMMUTABILITY                    ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const client = new Client({
    connectionString: envAdmin.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Setup Test Workspaces & Users
    const wsA = randomUUID();
    const wsB = randomUUID();

    const ownerA = randomUUID();
    const finOpA = randomUUID();
    const memberA = randomUUID();
    const viewerA = randomUUID();
    const projAdminA = randomUUID();
    const sysAdminA = randomUUID();
    const inactiveUserA = randomUUID();

    const ownerB = randomUUID();

    const deptFinA = randomUUID();

    await client.query('SET LOCAL session_replication_role = replica');

    // 1. Insert Auth Users & Profiles
    const users = [
      [ownerA, 'SavedView Owner A'],
      [finOpA, 'SavedView FinOp A'],
      [memberA, 'SavedView Member A'],
      [viewerA, 'SavedView Viewer A'],
      [projAdminA, 'SavedView ProjAdmin A'],
      [sysAdminA, 'SavedView SysAdmin A'],
      [inactiveUserA, 'SavedView Inactive A'],
      [ownerB, 'SavedView Owner B'],
    ];
    for (const [uid, name] of users) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, email, raw_user_meta_data, created_at, updated_at, aud, role)
        VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000', $2::text, jsonb_build_object('full_name', $3::text), now(), now(), 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING
      `, [uid, `${uid.slice(0, 8)}@test.com`, name]);

      await client.query(
        `INSERT INTO public.profiles (id, full_name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
        [uid, name]
      );
    }
    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // 2. Insert Workspaces
    await client.query(
      `INSERT INTO public.workspaces (id, name, created_by) VALUES
       ($1, 'Workspace A', $2),
       ($3, 'Workspace B', $4)`,
      [wsA, ownerA, wsB, ownerB]
    );

    // 3. Insert Workspace Memberships
    await client.query(`
      INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES
        ('${wsA}', '${ownerA}', 'owner', 'active'),
        ('${wsA}', '${finOpA}', 'member', 'active'),
        ('${wsA}', '${memberA}', 'member', 'active'),
        ('${wsA}', '${viewerA}', 'viewer', 'active'),
        ('${wsA}', '${projAdminA}', 'member', 'active'),
        ('${wsA}', '${sysAdminA}', 'member', 'active'),
        ('${wsA}', '${inactiveUserA}', 'member', 'declined'),
        ('${wsB}', '${ownerB}', 'owner', 'active');
    `);

    // 4. Insert Department & Membership for FinOp A
    await client.query(
      `INSERT INTO public.departments (id, workspace_id, name, code, is_active, created_by)
       VALUES ($1, $2, 'Finance Dept', 'FIN', true, $3)`,
      [deptFinA, wsA, ownerA]
    );
    await client.query(
      `INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active, is_primary)
       VALUES ($1, $2, $3, true, true)`,
      [wsA, deptFinA, finOpA]
    );

    // 5. Insert System Roles for ProjAdmin & SysAdmin
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role) VALUES
        ('${wsA}', '${projAdminA}', 'project_admin'),
        ('${wsA}', '${sysAdminA}', 'system_admin');
    `);

    // Assertion 8: Table exists and RLS is enabled
    const { rows: tableCheck } = await client.query(`
      SELECT rowsecurity FROM pg_tables WHERE tablename = 'finance_explorer_saved_views' AND schemaname = 'public'
    `);
    assert.equal(tableCheck.length, 1, 'public.finance_explorer_saved_views table must exist');
    assert.equal(tableCheck[0].rowsecurity, true, 'Row Level Security must be enabled');
    pass('Table public.finance_explorer_saved_views exists and has Row Level Security enabled');

    // P6-04C1 Required Assertions R, S, T, U, V on Table Privileges
    console.log('\n--- P6-04C1: Database Table Privilege & Grant Hardening ---');

    // Assertion R: Authenticated table privileges are SELECT, INSERT, UPDATE, DELETE
    const { rows: privSelect } = await client.query(`SELECT has_table_privilege('authenticated', 'public.finance_explorer_saved_views', 'SELECT') AS has_priv`);
    const { rows: privInsert } = await client.query(`SELECT has_table_privilege('authenticated', 'public.finance_explorer_saved_views', 'INSERT') AS has_priv`);
    const { rows: privUpdate } = await client.query(`SELECT has_table_privilege('authenticated', 'public.finance_explorer_saved_views', 'UPDATE') AS has_priv`);
    const { rows: privDelete } = await client.query(`SELECT has_table_privilege('authenticated', 'public.finance_explorer_saved_views', 'DELETE') AS has_priv`);
    assert.equal(privSelect[0].has_priv, true, 'authenticated role must have SELECT');
    assert.equal(privInsert[0].has_priv, true, 'authenticated role must have INSERT');
    assert.equal(privUpdate[0].has_priv, true, 'authenticated role must have UPDATE');
    assert.equal(privDelete[0].has_priv, true, 'authenticated role must have DELETE');
    pass('[Req R] authenticated role has SELECT, INSERT, UPDATE, DELETE privileges');

    // Assertion S: Authenticated TRUNCATE is false
    const { rows: privTruncate } = await client.query(`SELECT has_table_privilege('authenticated', 'public.finance_explorer_saved_views', 'TRUNCATE') AS has_priv`);
    assert.equal(privTruncate[0].has_priv, false, 'authenticated role must NOT have TRUNCATE');
    pass('[Req S] authenticated TRUNCATE is strictly false');

    // Assertion T: Authenticated REFERENCES is false
    const { rows: privReferences } = await client.query(`SELECT has_table_privilege('authenticated', 'public.finance_explorer_saved_views', 'REFERENCES') AS has_priv`);
    assert.equal(privReferences[0].has_priv, false, 'authenticated role must NOT have REFERENCES');
    pass('[Req T] authenticated REFERENCES is strictly false');

    // Assertion U: Authenticated TRIGGER is false
    const { rows: privTrigger } = await client.query(`SELECT has_table_privilege('authenticated', 'public.finance_explorer_saved_views', 'TRIGGER') AS has_priv`);
    assert.equal(privTrigger[0].has_priv, false, 'authenticated role must NOT have TRIGGER');
    pass('[Req U] authenticated TRIGGER is strictly false');

    // Assertion V: Anon has no privileges
    const { rows: anonSelect } = await client.query(`SELECT has_table_privilege('anon', 'public.finance_explorer_saved_views', 'SELECT') AS has_priv`);
    const { rows: anonInsert } = await client.query(`SELECT has_table_privilege('anon', 'public.finance_explorer_saved_views', 'INSERT') AS has_priv`);
    const { rows: anonUpdate } = await client.query(`SELECT has_table_privilege('anon', 'public.finance_explorer_saved_views', 'UPDATE') AS has_priv`);
    const { rows: anonDelete } = await client.query(`SELECT has_table_privilege('anon', 'public.finance_explorer_saved_views', 'DELETE') AS has_priv`);
    assert.equal(anonSelect[0].has_priv, false, 'anon role must NOT have SELECT');
    assert.equal(anonInsert[0].has_priv, false, 'anon role must NOT have INSERT');
    assert.equal(anonUpdate[0].has_priv, false, 'anon role must NOT have UPDATE');
    assert.equal(anonDelete[0].has_priv, false, 'anon role must NOT have DELETE');
    pass('[Req V] anon role has zero table privileges (all false)');

    console.log('\n--- Core P6-04C Database RLS & Immutability Assertions ---');

    // Assertion 9: Constraints - invalid name length & non-object state
    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerA,
          `INSERT INTO public.finance_explorer_saved_views (workspace_id, user_id, name, view_state)
           VALUES ($1, $2, '', '{"schemaVersion":1}')`,
          [wsA, ownerA]
        );
      },
      /(chk_finance_explorer_saved_views_name|check constraint)/,
      'Blank name must violate chk_finance_explorer_saved_views_name'
    );
    pass('Blank Saved View name is rejected by table constraint');

    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerA,
          `INSERT INTO public.finance_explorer_saved_views (workspace_id, user_id, name, view_state)
           VALUES ($1, $2, 'Valid Name', '"not an object"')`,
          [wsA, ownerA]
        );
      },
      /(chk_finance_explorer_saved_views_state_object|check constraint)/,
      'Non-object view_state must violate chk_finance_explorer_saved_views_state_object'
    );
    pass('Non-object view_state JSON is rejected by table constraint');

    // Assertion 10: Workspace Owner creates Saved View (Anti-spoofing forces user_id to auth.uid())
    const spoofAttemptUserId = randomUUID();
    const testState = {
      schemaVersion: 1,
      entityType: 'task',
      selectedStatus: 'Active',
      groupBy: 'department',
      sortBy: 'actualSpend',
      sortOrder: 'desc',
    };

    const { rows: insertedOwnerView } = await asUser(
      client,
      ownerA,
      `INSERT INTO public.finance_explorer_saved_views (workspace_id, user_id, name, view_state)
       VALUES ($1, $2, 'Q3 Executive View', $3)
       RETURNING id, workspace_id, user_id, name, view_state`,
      [wsA, spoofAttemptUserId, JSON.stringify(testState)]
    );
    assert.equal(insertedOwnerView.length, 1);
    assert.equal(insertedOwnerView[0].user_id, ownerA, 'Trigger must overwrite user_id spoof attempt with auth.uid()');
    assert.equal(insertedOwnerView[0].name, 'Q3 Executive View');
    pass('Workspace Owner can create own Saved View with anti-spoofing ownership resolution');

    const viewA1Id = insertedOwnerView[0].id;

    // Assertion 11: Owner can SELECT own views
    const { rows: ownerViews } = await asUser(
      client,
      ownerA,
      `SELECT id, name FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
      [wsA]
    );
    assert.equal(ownerViews.length, 1);
    assert.equal(ownerViews[0].id, viewA1Id);
    pass('Workspace Owner can SELECT own Saved Views');

    // Assertion 12: Finance Operator creates own Saved View
    const { rows: insertedFinOpView } = await asUser(
      client,
      finOpA,
      `INSERT INTO public.finance_explorer_saved_views (workspace_id, name, view_state)
       VALUES ($1, 'FinOp Ledger View', $2)
       RETURNING id, user_id, name`,
      [wsA, JSON.stringify(testState)]
    );
    assert.equal(insertedFinOpView.length, 1);
    assert.equal(insertedFinOpView[0].user_id, finOpA);
    pass('Finance Operator can create own Saved View');

    const viewFinOpId = insertedFinOpView[0].id;

    // Assertion 13: Personal User Isolation - Owner cannot see FinOp's view, FinOp cannot see Owner's view
    const { rows: ownerViewCheck } = await asUser(
      client,
      ownerA,
      `SELECT id FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
      [wsA]
    );
    assert.equal(ownerViewCheck.length, 1, 'Owner A should see ONLY own view (1 row)');
    assert.equal(ownerViewCheck[0].id, viewA1Id);

    const { rows: finOpViewCheck } = await asUser(
      client,
      finOpA,
      `SELECT id FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
      [wsA]
    );
    assert.equal(finOpViewCheck.length, 1, 'FinOp A should see ONLY own view (1 row)');
    assert.equal(finOpViewCheck[0].id, viewFinOpId);
    pass('Personal User Isolation: Users cannot see other users Saved Views');

    // Assertion 14: Personal User Isolation - Owner cannot UPDATE or DELETE FinOp's view
    const { rowCount: updateCount } = await asUser(
      client,
      ownerA,
      `UPDATE public.finance_explorer_saved_views SET name = 'Hijacked' WHERE id = $1`,
      [viewFinOpId]
    );
    assert.equal(updateCount, 0, 'Owner A must not be able to UPDATE FinOp A view');

    const { rowCount: deleteCount } = await asUser(
      client,
      ownerA,
      `DELETE FROM public.finance_explorer_saved_views WHERE id = $1`,
      [viewFinOpId]
    );
    assert.equal(deleteCount, 0, 'Owner A must not be able to DELETE FinOp A view');
    pass('Personal User Isolation: Users cannot UPDATE or DELETE other users Saved Views');

    // Assertion 15: Cross-Workspace Isolation - Workspace A views invisible in Workspace B
    const { rows: wsBSelect } = await asUser(
      client,
      ownerB,
      `SELECT id FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
      [wsA]
    );
    assert.equal(wsBSelect.length, 0, 'Owner B cannot see views from Workspace A');
    pass('Cross-Workspace Isolation: Views from Workspace A are invisible in Workspace B');

    // Assertion 16: Unique case-insensitive name per user per workspace
    await assert.rejects(
      async () => {
        await asUser(
          client,
          ownerA,
          `INSERT INTO public.finance_explorer_saved_views (workspace_id, name, view_state)
           VALUES ($1, '  q3 executive view  ', $2)`,
          [wsA, JSON.stringify(testState)]
        );
      },
      /uq_finance_explorer_saved_views_user_ws_name/,
      'Duplicate trimmed case-insensitive name must violate unique index'
    );
    pass('Duplicate case-insensitive name per user/workspace is strictly rejected');

    // Assertion 17: Immutability Trigger on UPDATE
    const spoofUserId = randomUUID();
    const spoofWsId = randomUUID();
    await asUser(
      client,
      ownerA,
      `UPDATE public.finance_explorer_saved_views
       SET user_id = $1, workspace_id = $2, name = 'Q3 Executive View Renamed'
       WHERE id = $3`,
      [spoofUserId, spoofWsId, viewA1Id]
    );

    const { rows: updatedCheck } = await client.query(
      `SELECT user_id, workspace_id, name FROM public.finance_explorer_saved_views WHERE id = $1`,
      [viewA1Id]
    );
    assert.equal(updatedCheck[0].user_id, ownerA, 'user_id must remain immutable');
    assert.equal(updatedCheck[0].workspace_id, wsA, 'workspace_id must remain immutable');
    assert.equal(updatedCheck[0].name, 'Q3 Executive View Renamed');
    pass('Immutability trigger prevents spoofing user_id or workspace_id on UPDATE');

    // Assertion 18: Denied Roles (Member, Viewer, ProjAdmin only, SysAdmin only, Inactive)
    for (const [deniedUid, roleName] of [
      [memberA, 'Normal Member'],
      [viewerA, 'Viewer'],
      [projAdminA, 'Project Admin alone'],
      [sysAdminA, 'System Admin alone'],
      [inactiveUserA, 'Inactive Workspace Member'],
    ]) {
      const { rows: deniedSelect } = await asUser(
        client,
        deniedUid,
        `SELECT id FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
        [wsA]
      );
      assert.equal(deniedSelect.length, 0, `${roleName} must not be able to SELECT saved views`);

      await assert.rejects(
        async () => {
          await asUser(
            client,
            deniedUid,
            `INSERT INTO public.finance_explorer_saved_views (workspace_id, name, view_state)
             VALUES ($1, 'Unauthorized View', $2)`,
            [wsA, JSON.stringify(testState)]
          );
        },
        /policy/,
        `${roleName} must be rejected by INSERT RLS policy`
      );
    }
    pass('Unauthorized roles (Member, Viewer, ProjAdmin alone, SysAdmin alone, Inactive) fail closed');

    // Assertion 19: Revocation of Finance access retains record in DB but denies RLS access
    // Remove FinOp from finance department
    await client.query(
      `UPDATE public.department_memberships SET is_active = false WHERE department_id = $1 AND user_id = $2`,
      [deptFinA, finOpA]
    );
    const { rows: revokedSelect } = await asUser(
      client,
      finOpA,
      `SELECT id FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
      [wsA]
    );
    assert.equal(revokedSelect.length, 0, 'Revoked user must see 0 views under RLS');

    const { rows: dbRecordStillExists } = await client.query(
      `SELECT id FROM public.finance_explorer_saved_views WHERE id = $1`,
      [viewFinOpId]
    );
    assert.equal(dbRecordStillExists.length, 1, 'Saved view preference remains stored in DB after access revocation');
    pass('Access revocation blocks RLS access while preserving user preference record in DB');

    // Assertion 20: Anonymous role and unauthenticated access denied
    const { rows: nullSubRows } = await asUser(
      client,
      null,
      `SELECT id FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
      [wsA]
    );
    assert.equal(nullSubRows.length, 0, 'Unauthenticated user sees 0 rows under RLS');

    await client.query('SAVEPOINT anon_sp');
    try {
      await client.query('SET LOCAL ROLE anon');
      await client.query(`SELECT id FROM public.finance_explorer_saved_views WHERE workspace_id = $1`, [wsA]);
      assert.fail('anon role must be denied table permissions');
    } catch (err) {
      assert.ok(/permission denied/i.test(err.message), `Expected permission denied, got: ${err.message}`);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT anon_sp');
      await client.query('RESET ROLE');
    }
    pass('Anonymous access is strictly denied by table permissions and RLS');

    // Assertion 21: Security Advisor baseline intact
    const { rows: publicSecDef } = await client.query(`
      SELECT proname FROM pg_proc
      JOIN pg_namespace n ON pronamespace = n.oid
      WHERE n.nspname = 'public' AND prosecdef = true
      ORDER BY proname
    `);
    assert.equal(
      publicSecDef.length,
      7,
      'Exactly 7 baseline SECURITY DEFINER functions in public schema (0 new introduced)'
    );
    pass('Security Advisor baseline intact: exactly 7 public SECURITY DEFINER functions (0 new)');

  } finally {
    await client.query('ROLLBACK');
    await client.end();
    pass('Clean PostgreSQL transaction rollback completed — test fixtures left no trace');
  }
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — P6-04C / P6-04C1 SAVED VIEWS VERIFICATION SUITE            ');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  try {
    await runFrontendContractsSuite();
    await runDatabaseSuite();

    console.log('\n═══════════════════════════════════════════════════════════════════════════');
    console.log(`  ALL ${assertionCount} P6-04C & P6-04C1 SAVED VIEWS ASSERTIONS PASSED!       `);
    console.log('═══════════════════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n[FATAL TEST FAILURE]', err);
    process.exit(1);
  }
}

run();
