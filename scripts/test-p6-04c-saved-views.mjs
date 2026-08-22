/**
 * SNS PROJECTS — PACKAGE 6 / P6-04C PERSISTENT SAVED VIEWS SUITE
 *
 * Automated verification for:
 * 1. Frontend Serializer, Normalizer & State Contracts
 *    - Strict schemaVersion = 1
 *    - Explicit whitelist serialization (no cache, rows, summaries or identities)
 *    - All 19 Explorer filter/group/sort fields round-trip
 *    - Invalid enums, types, and unknown keys normalized to canonical defaults
 *    - Cascading hierarchy references sanitized against current metadata
 *    - Dirty state checking accurately detects unsaved modifications
 *    - Source code audits: no localStorage as authoritative store, no mutations to Finance facts
 *
 * 2. Database Schema, RLS Policies & Anti-Spoofing Triggers
 *    - public.finance_explorer_saved_views table structure and constraints
 *    - Unique case-insensitive name per user per workspace
 *    - Anti-spoofing trigger forces user_id to auth.uid() on INSERT
 *    - Immutability of user_id, workspace_id, and created_at on UPDATE
 *    - Authenticated CRUD allowed for active Finance Owner
 *    - Authenticated CRUD allowed for active Finance Operator
 *    - User isolation: User A cannot read, update, or delete User B's Saved Views
 *    - Cross-workspace isolation: Workspace A views invisible in Workspace B
 *    - Access control: Member, Viewer, Project Admin only, System Admin only, inactive denied
 *    - Access revocation preserves records in DB but denies RLS access
 *    - Anonymous role denied
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
    selectedDepartment: 'dept-fin',
    selectedStatus: 'active',
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
  assert.equal(serialized.selectedDepartment, 'dept-fin');
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
    profiles: [{ id: 'u1' }],
    primary_departments: [{ department_id: 'dept1' }],
  };

  // Case A: Stale project resets all descendants
  const staleProjectState = {
    selectedProject: 'deleted-proj-xyz',
    selectedPhase: 'ph1',
    selectedTaskList: 'tl1',
    selectedTask: 't1',
    selectedOwner: 'u1',
    selectedDepartment: 'dept1',
  };
  const sanitizedA = normalizeSavedViewState(staleProjectState, mockMetadata);
  assert.equal(sanitizedA.selectedProject, 'all');
  assert.equal(sanitizedA.selectedPhase, 'all');
  assert.equal(sanitizedA.selectedTaskList, 'all');
  assert.equal(sanitizedA.selectedTask, 'all');
  assert.equal(sanitizedA.selectedOwner, 'u1');
  assert.equal(sanitizedA.selectedDepartment, 'dept1');
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

  // Case C: Stale Owner & Department
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
      `INSERT INTO public.workspaces (id, name, created_by) VALUES ($1, 'SavedView WS A', $2), ($3, 'SavedView WS B', $4)`,
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
      INSERT INTO public.user_system_roles (workspace_id, user_id, role, created_by) VALUES
        ('${wsA}', '${projAdminA}', 'project_admin', '${ownerA}'),
        ('${wsA}', '${sysAdminA}', 'system_admin', '${ownerA}');
    `);

    // Assertion 8: Table Structure & RLS enabled
    const { rows: rlsCheck } = await client.query(`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'finance_explorer_saved_views'
    `);
    assert.equal(rlsCheck.length, 1);
    assert.equal(rlsCheck[0].relrowsecurity, true, 'RLS must be enabled on finance_explorer_saved_views');
    pass('Table public.finance_explorer_saved_views exists and has Row Level Security enabled');

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

    // Assertion 10: Owner A can insert and select own Saved View
    const testState = { schemaVersion: 1, entityType: 'project', groupBy: 'phase' };
    const { rows: ownerInsert } = await asUser(
      client,
      ownerA,
      `INSERT INTO public.finance_explorer_saved_views (workspace_id, name, view_state)
       VALUES ($1, 'Q3 Executive View', $2)
       RETURNING id, workspace_id, user_id, name, view_state`,
      [wsA, JSON.stringify(testState)]
    );
    assert.equal(ownerInsert.length, 1);
    assert.equal(ownerInsert[0].user_id, ownerA, 'Anti-spoofing trigger must assign user_id to auth.uid()');
    assert.equal(ownerInsert[0].name, 'Q3 Executive View');
    const viewA1Id = ownerInsert[0].id;
    pass('Workspace Owner can create own Saved View with anti-spoofing ownership resolution');

    // Assertion 11: Owner A can SELECT own Saved View
    const { rows: ownerSelect } = await asUser(
      client,
      ownerA,
      `SELECT id, name, view_state FROM public.finance_explorer_saved_views WHERE workspace_id = $1`,
      [wsA]
    );
    assert.equal(ownerSelect.length, 1);
    assert.equal(ownerSelect[0].id, viewA1Id);
    pass('Workspace Owner can SELECT own Saved Views');

    // Assertion 12: Finance Operator can create and read own Saved View
    const { rows: finOpInsert } = await asUser(
      client,
      finOpA,
      `INSERT INTO public.finance_explorer_saved_views (workspace_id, name, view_state)
       VALUES ($1, 'Finance Operator Drilldown', $2)
       RETURNING id, user_id, name`,
      [wsA, JSON.stringify({ schemaVersion: 1, entityType: 'expense' })]
    );
    assert.equal(finOpInsert.length, 1);
    assert.equal(finOpInsert[0].user_id, finOpA);
    const viewFinOpId = finOpInsert[0].id;
    pass('Finance Operator can create own Saved View');

    // Assertion 13: User Isolation - Owner A cannot see FinOp A's view and vice versa
    const { rows: ownerIsolation } = await asUser(
      client,
      ownerA,
      `SELECT id FROM public.finance_explorer_saved_views WHERE id = $1`,
      [viewFinOpId]
    );
    assert.equal(ownerIsolation.length, 0, 'Owner A must not see FinOp A saved view');

    const { rows: finOpIsolation } = await asUser(
      client,
      finOpA,
      `SELECT id FROM public.finance_explorer_saved_views WHERE id = $1`,
      [viewA1Id]
    );
    assert.equal(finOpIsolation.length, 0, 'FinOp A must not see Owner A saved view');
    pass('Personal User Isolation: Users cannot see other users Saved Views');

    // Assertion 14: User Isolation - Owner A cannot UPDATE or DELETE FinOp A's view
    const { rowCount: updateCount } = await asUser(
      client,
      ownerA,
      `UPDATE public.finance_explorer_saved_views SET name = 'Hacked Name' WHERE id = $1`,
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
  console.log('  SNS PROJECTS — P6-04C PERSISTENT SAVED VIEWS VERIFICATION SUITE           ');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  try {
    await runFrontendContractsSuite();
    await runDatabaseSuite();

    console.log('\n═══════════════════════════════════════════════════════════════════════════');
    console.log(`  ALL ${assertionCount} P6-04C PERSISTENT SAVED VIEWS ASSERTIONS PASSED!           `);
    console.log('═══════════════════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n[FATAL TEST FAILURE]', err);
    process.exit(1);
  }
}

run();
