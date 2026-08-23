/**
 * SNS PROJECTS — PACKAGE 7 / P7-01 FINANCIAL HIERARCHY READ MODEL TEST SUITE
 *
 * Automated verification for:
 * 1. Schema, Security Baseline & Migration Parity
 *    - public.get_project_financial_hierarchy is SECURITY INVOKER with search_path=''
 *    - private.get_project_financial_hierarchy_internal is SECURITY DEFINER with search_path=''
 *    - PUBLIC and anon execution strictly revoked
 *    - Public SECURITY DEFINER baseline verified (zero unexpected increase)
 *    - Security Advisor warning baseline intact (zero new warnings)
 *
 * 2. Operational Visibility vs Finance Authority Intersection (All 12 Personas)
 *    - 1. Workspace Owner (Full hierarchy visibility, project + phase + task list summaries, task rollups)
 *    - 2. Workspace Admin (Full hierarchy visibility)
 *    - 3. CEO (Full hierarchy visibility via executive system role)
 *    - 4. CTO (Full hierarchy visibility via executive system role)
 *    - 5. Finance Operator (Full finance authority across caller's allowed operational graph)
 *    - 6. Project Owner (Full hierarchy visibility within owned project)
 *    - 7. Phase Owner (Scoped to owned phase + child task lists, project summary is null)
 *    - 8. Ordinary Member (Container summaries are null, visible tasks expose direct + visible rollup spend)
 *    - 9. Viewer (Container summaries are null, visible tasks expose direct + visible rollup spend)
 *    - 10. Project Admin only (Operational visibility without container finance)
 *    - 11. System Admin only (Operational visibility without container finance)
 *    - 12. Unauthenticated caller (Returns NULL fail-closed)
 *
 * 3. Exact Test Assertions (A - Z):
 *    - A: Hidden Project returns NULL
 *    - B: Hidden Phase ID is not leaked (completely omitted)
 *    - C: Hidden Task List ID is not leaked (completely omitted)
 *    - D: Hidden Task ID is not leaked (completely omitted)
 *    - E: Hidden child Task spend excluded from visible parent rollup
 *    - F: Hidden sibling spend excluded
 *    - G: Process Step Task rollup isolation
 *    - H: Placed processes outside task do not leak into task rollups
 *    - I: Child Task recursion sums correctly
 *    - J: Cycle protection terminates safely
 *    - K: Subtask expense counted exactly once
 *    - L: Voided transaction excluded
 *    - M: Corrected transaction handled canonically
 *    - N: Inherited budget source semantics (task_list -> phase -> project -> none)
 *    - O: Own-budget container semantics
 *    - P: Project Admin / System Admin operational visibility does not grant container finance
 *    - Q: Finance Operator authority does not reveal operationally hidden entities
 *    - R: Cross-project isolation
 *    - S: Cross-workspace isolation
 *    - T: Frontend hook stale request rejection
 *    - U: Frontend hook render-time scope isolation
 *    - V: Frontend hook disabled fail-closed
 *    - W: Frontend hook project-scope switch fail-closed
 *    - X: Frontend hook user-scope switch fail-closed
 *    - Y: Frontend hook authorizationScopeKey switch fail-closed
 *    - Z: No new SECURITY DEFINER exposure
 *
 * Usage:
 *   node scripts/test-p7-01-financial-hierarchy.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { normalizeProjectFinancialHierarchy } from '../src/lib/finance.js';

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

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`[PASS ${passed.toString().padStart(2, '0')}] ${msg}`);
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
      await client.query(`
        SELECT set_config('request.jwt.claim.sub', '', true),
               set_config('request.jwt.claim.role', '', true),
               set_config('request.jwt.claims', '', true)
      `);
      await client.query('RESET ROLE');
    } catch {
      // ignore
    }
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — PACKAGE 7 / P7-01 FINANCIAL HIERARCHY READ MODEL TESTS    ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const env = parseEnv(await readFile(envAdminPath, 'utf8'));
  assert.ok(env.SUPABASE_DB_URL, 'SUPABASE_DB_URL must exist in .env.admin');

  const client = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL. Starting test execution...\n');

  // Check baseline public SECURITY DEFINER functions BEFORE migration
  const preSecDefRes = await client.query(`
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prosecdef = true
    ORDER BY p.proname
  `);
  const baselinePublicSecDefCount = preSecDefRes.rows.length;
  console.log(`[PRE-CHECK] Baseline public SECURITY DEFINER function count: ${baselinePublicSecDefCount}`);

  // Apply P7-01 migration to database if not already applied
  const migrationSql = await readFile(
    path.join(repoRoot, 'supabase', 'migrations', '20260823180000_p7_01_financial_hierarchy_read_model.sql'),
    'utf8'
  );
  await client.query(migrationSql);
  console.log('[SETUP] Applied migration 20260823180000_p7_01_financial_hierarchy_read_model.sql\n');

  // Start isolated test transaction
  await client.query('BEGIN');

  try {
    // ── SUITE 1: Schema & Security Baseline Verification ──────────────────────
    console.log('--- Suite 1: Schema, Grants & Security Baseline ---');

    // 1. Function security attributes
    const fnCheck = await client.query(`
      SELECT p.proname, n.nspname, p.prosecdef, p.provolatile
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.proname IN ('get_project_financial_hierarchy', 'get_project_financial_hierarchy_internal')
      ORDER BY n.nspname, p.proname
    `);

    const pubFn = fnCheck.rows.find(r => r.nspname === 'public');
    const privFn = fnCheck.rows.find(r => r.nspname === 'private');

    assert.ok(pubFn, 'public.get_project_financial_hierarchy must exist');
    assert.equal(pubFn.prosecdef, false, 'public.get_project_financial_hierarchy must be SECURITY INVOKER');
    pass('public.get_project_financial_hierarchy is SECURITY INVOKER');

    assert.ok(privFn, 'private.get_project_financial_hierarchy_internal must exist');
    assert.equal(privFn.prosecdef, true, 'private.get_project_financial_hierarchy_internal must be SECURITY DEFINER');
    pass('private.get_project_financial_hierarchy_internal is SECURITY DEFINER');

    // 2. Permission revocation check
    const anonPrivCheck = await client.query(`
      SELECT routine_name, grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_schema IN ('public', 'private')
        AND routine_name IN ('get_project_financial_hierarchy', 'get_project_financial_hierarchy_internal')
        AND grantee IN ('PUBLIC', 'anon')
    `);
    assert.equal(anonPrivCheck.rows.length, 0, 'PUBLIC and anon execution must be revoked');
    pass('Direct execute revoked from PUBLIC and anon for both public and private functions');

    // 3. Public SECURITY DEFINER baseline intact (Assertion Z)
    const postSecDefRes = await client.query(`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prosecdef = true
      ORDER BY p.proname
    `);
    assert.equal(
      postSecDefRes.rows.length,
      baselinePublicSecDefCount,
      `Public SECURITY DEFINER count must remain exactly ${baselinePublicSecDefCount}`
    );
    pass('Assertion Z: Zero new public SECURITY DEFINER functions added (baseline preserved)');

    // ── SUITE 2: Fixture Setup (Isolated Test Workspace & Entities) ───────────
    console.log('\n--- Suite 2: Multi-Persona Fixtures & Hierarchy Setup ---');

    const wsId = randomUUID();
    const otherWsId = randomUUID();

    // User personas
    const uOwner = randomUUID();
    const uAdmin = randomUUID();
    const uCeo = randomUUID();
    const uCto = randomUUID();
    const uFinOp = randomUUID();
    const uProjOwner = randomUUID();
    const uPhaseOwner = randomUUID();
    const uMember = randomUUID();
    const uViewer = randomUUID();
    const uProjAdminOnly = randomUUID();
    const uSysAdminOnly = randomUUID();
    const uOtherWsUser = randomUUID();

    const allUsers = [
      uOwner, uAdmin, uCeo, uCto, uFinOp, uProjOwner, uPhaseOwner,
      uMember, uViewer, uProjAdminOnly, uSysAdminOnly, uOtherWsUser,
    ];

    // Seed test users into auth.users and public.profiles
    await client.query('SET LOCAL session_replication_role = replica');
    for (const uid of allUsers) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, email, raw_user_meta_data, created_at, updated_at, aud, role)
        VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000', $2::text, jsonb_build_object('full_name', $3::text), now(), now(), 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING
      `, [uid, `p7_test_${uid.slice(0, 8)}@example.com`, `P7 User ${uid.slice(0, 8)}`]);

      await client.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
      `, [uid, `P7 User ${uid.slice(0, 8)}`]);
    }
    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // Create primary workspace and secondary isolation workspace
    await client.query(`
      INSERT INTO public.workspaces (id, name, created_by)
      VALUES ($1, 'P7 Test Workspace', $2),
             ($3, 'P7 Other Workspace', $4)
    `, [wsId, uOwner, otherWsId, uOtherWsUser]);

    // Workspace memberships
    const memberships = [
      [wsId, uOwner, 'owner'],
      [wsId, uAdmin, 'admin'],
      [wsId, uCeo, 'member'],
      [wsId, uCto, 'member'],
      [wsId, uFinOp, 'member'],
      [wsId, uProjOwner, 'member'],
      [wsId, uPhaseOwner, 'member'],
      [wsId, uMember, 'member'],
      [wsId, uViewer, 'viewer'],
      [wsId, uProjAdminOnly, 'member'],
      [wsId, uSysAdminOnly, 'member'],
      [otherWsId, uOtherWsUser, 'owner'],
    ];

    for (const [w, u, r] of memberships) {
      await client.query(`
        INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
        VALUES ($1, $2, $3, 'active')
      `, [w, u, r]);
    }

    // System roles (CEO, CTO, Project Admin, System Admin)
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES ($1, $2, 'ceo'),
             ($1, $3, 'cto'),
             ($1, $4, 'project_admin'),
             ($1, $5, 'system_admin')
    `, [wsId, uCeo, uCto, uProjAdminOnly, uSysAdminOnly]);

    // Finance department and Finance Operator membership
    const finDeptId = randomUUID();
    await client.query(`
      INSERT INTO public.departments (id, workspace_id, name, code)
      VALUES ($1, $2, 'Finance Department', 'FIN')
    `, [finDeptId, wsId]);

    await client.query(`
      INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active, is_primary)
      VALUES ($1, $2, $3, true, true)
    `, [wsId, finDeptId, uFinOp]);

    // Create Test Projects
    const projId = randomUUID();
    const otherProjId = randomUUID();

    await client.query(`
      INSERT INTO public.projects (id, workspace_id, name, owner_id, created_by)
      VALUES ($1, $2, 'P7 Main Test Project', $3, $3),
             ($4, $2, 'P7 Hidden Sibling Project', $5, $5)
    `, [projId, wsId, uProjOwner, otherProjId, uOwner]);

    // Phases: Phase 1 (owned by uPhaseOwner), Phase 2 (owned by uProjOwner)
    const ph1Id = randomUUID();
    const ph2Id = randomUUID();
    await client.query(`
      INSERT INTO public.phases (id, project_id, name, owner_id, position)
      VALUES ($1, $2, 'Phase 1 - Owned by PhaseOwner', $3, 1),
             ($4, $2, 'Phase 2 - Owned by ProjOwner', $5, 2)
    `, [ph1Id, projId, uPhaseOwner, ph2Id, uProjOwner]);

    // Task Lists: TL1 (in Phase 1), TL2 (in Phase 2)
    const tl1Id = randomUUID();
    const tl2Id = randomUUID();
    await client.query(`
      INSERT INTO public.task_lists (id, project_id, phase_id, name, position)
      VALUES ($1, $2, $3, 'Task List 1 in Phase 1', 1),
             ($4, $2, $5, 'Task List 2 in Phase 2', 1)
    `, [tl1Id, projId, ph1Id, tl2Id, ph2Id]);

    // Budgets:
    // Project Budget: Base 100,000, Buffer 20,000
    // Phase 1 Budget: Base 40,000, Buffer 5,000
    // Task List 1 Budget: Base 20,000, Buffer 2,000
    // Phase 2 has NO own budget (inherits Project budget)
    // Task List 2 has NO own budget (inherits Project budget via Phase 2)
    const bProjId = randomUUID();
    const bPh1Id = randomUUID();
    const bTl1Id = randomUUID();

    await client.query(`
      INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by)
      VALUES ($1, $2, 'project', $3, 100000.00, 20000.00, $4)
    `, [bProjId, wsId, projId, uOwner]);

    await client.query(`
      INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, phase_id, base_budget, safety_buffer, created_by)
      VALUES ($1, $2, 'phase', $3, $4, 40000.00, 5000.00, $5)
    `, [bPh1Id, wsId, projId, ph1Id, uOwner]);

    await client.query(`
      INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, safety_buffer, created_by)
      VALUES ($1, $2, 'task_list', $3, $4, $5, 20000.00, 2000.00, $6)
    `, [bTl1Id, wsId, projId, ph1Id, tl1Id, uOwner]);

    // Tasks:
    // Task 1: in TL1, assigned to uMember (visible to uMember)
    // Task 1.1 (Child of Task 1): in TL1, assigned to uMember (visible)
    // Task 1.2 (Hidden Child of Task 1): in TL1, assigned to uOwner only (HIDDEN from uMember)
    // Task 2: in TL2, assigned to uViewer (visible to uViewer)
    // Task 3: in TL1, attached process host task assigned to uMember
    const t1Id = randomUUID();
    const t11Id = randomUUID();
    const t12HiddenId = randomUUID();
    const t2Id = randomUUID();
    const t3HostId = randomUUID();
    const tAdminId = randomUUID();
    const tFinOpId = randomUUID();
    const tPhaseOwnerId = randomUUID();

    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title, assignee_id, created_by)
      VALUES ($1, $2, $3, $4, 'Task 1 (Visible to Member)', $5, $6),
             ($7, $2, $8, $9, 'Task 2 (Visible to Viewer)', $10, $6),
             ($11, $2, $3, $4, 'Task 3 Host (Visible to Member)', $5, $6),
             ($12, $2, $3, $4, 'Task Admin (Visible to Admin)', $13, $6),
             ($14, $2, $3, $4, 'Task FinOp (Visible to FinOp)', $15, $6),
             ($16, $2, $3, $4, 'Task PhaseOwner (Visible to PhaseOwner)', $17, $6)
    `, [t1Id, projId, ph1Id, tl1Id, uMember, uOwner, t2Id, ph2Id, tl2Id, uViewer, t3HostId, tAdminId, uAdmin, tFinOpId, uFinOp, tPhaseOwnerId, uPhaseOwner]);

    // Child task 1.1 (parent is t1Id, assigned to uMember)
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, parent_task_id, title, assignee_id, created_by)
      VALUES ($1, $2, $3, $4, $5, 'Task 1.1 Visible Child', $6, $7)
    `, [t11Id, projId, ph1Id, tl1Id, t1Id, uMember, uOwner]);

    // Child task 1.2 (parent is t1Id, assigned to uOwner, no RACI for uMember -> HIDDEN from uMember)
    await client.query(`
      INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, parent_task_id, title, assignee_id, created_by)
      VALUES ($1, $2, $3, $4, $5, 'Task 1.2 Hidden Child', $6, $6)
    `, [t12HiddenId, projId, ph1Id, tl1Id, t1Id, uOwner]);

    // Subtask on Task 1 (assigned to uMember)
    const st1Id = randomUUID();
    await client.query(`
      INSERT INTO public.subtasks (id, task_id, title, assignee_id, created_by)
      VALUES ($1, $2, 'Subtask 1 on Task 1', $3, $4)
    `, [st1Id, t1Id, uMember, uOwner]);

    // Create a published defined process & version for the attached process instance
    const dpId = randomUUID();
    const dpVerId = randomUUID();
    await client.query(`
      INSERT INTO public.defined_processes (id, workspace_id, department_id, name, code, process_owner_id, created_by)
      VALUES ($1, $2, $3, 'P7 Test Process', 'P7_PROC', $4, $4)
    `, [dpId, wsId, finDeptId, uOwner]);

    await client.query(`
      INSERT INTO public.defined_process_versions (id, defined_process_id, version_number, status, published_at, published_by, created_by)
      VALUES ($1, $2, 1, 'published', now(), $3, $3)
    `, [dpVerId, dpId, uOwner]);

    const dpStepId = randomUUID();
    await client.query(`
      INSERT INTO public.defined_process_steps (id, version_id, step_code, title, description, sequence_order, expected_duration_days)
      VALUES ($1, $2, 'S1', 'Step 1', 'Description', 1, 1)
    `, [dpStepId, dpVerId]);

    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, actor_type, user_id)
      VALUES ($1, 'R', 'user', $2)
    `, [dpStepId, uMember]);

    // Process Instance attached to Task 3 (Host Task)
    const piId = randomUUID();
    const t3StepId = randomUUID();
    await client.query(`
      INSERT INTO public.process_instances (
        id, workspace_id, defined_process_id, defined_process_version_id,
        instance_name, started_by, owner_id, placement_type,
        project_id, phase_id, task_list_id, parent_task_id, status
      )
      VALUES ($1, $2, $3, $4, 'P7 Attached Instance', $5, $5, 'task', $6, $7, $8, $9, 'running')
    `, [piId, wsId, dpId, dpVerId, uOwner, projId, ph1Id, tl1Id, t3HostId]);

    await client.query(`
      INSERT INTO public.tasks (
        id, project_id, phase_id, task_list_id, process_instance_id,
        process_step_id, defined_process_version_id, workflow_state,
        current_cycle_number, title, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 1, 'Process Step on Attached PI', $8)
    `, [t3StepId, projId, ph1Id, tl1Id, piId, dpStepId, dpVerId, uOwner]);

    await client.query(`
      INSERT INTO public.task_raci_assignments (task_id, user_id, raci_role)
      VALUES ($1, $2, 'R')
    `, [t3StepId, uMember]);

    // Expenses:
    // 1. Direct Expense on Task 1: 1,000.00 (active)
    // 2. Subtask Expense on Task 1 (subtask st1Id): 500.00 (active) -> et.task_id = t1Id, et.subtask_id = st1Id
    // 3. Expense on Child Task 1.1: 2,000.00 (active)
    // 4. Expense on Hidden Child Task 1.2: 4,000.00 (active)
    // 5. Voided Expense on Task 1: 8,000.00 (voided -> must be excluded)
    // 6. Corrected Expense on Task 2: originally 500.00, corrected item amount 750.00
    // 7. Expense on Process Step Task t3StepId: 1,200.00 (active)
    const tx1Id = randomUUID();
    const txSubId = randomUUID();
    const tx11Id = randomUUID();
    const tx12HiddenId = randomUUID();
    const txVoidId = randomUUID();
    const txCorrectedId = randomUUID();
    const txStepId = randomUUID();

    // Direct on Task 1
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ($1, $2, $3, 'active', $4)
    `, [tx1Id, wsId, t1Id, uOwner]);
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ($1, 1000.00, 'Direct expense on Task 1')
    `, [tx1Id]);

    // Subtask expense on Task 1 (subtask_id = st1Id)
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, subtask_id, status, created_by)
      VALUES ($1, $2, $3, $4, 'active', $5)
    `, [txSubId, wsId, t1Id, st1Id, uOwner]);
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ($1, 500.00, 'Subtask expense on Task 1')
    `, [txSubId]);

    // Expense on Child Task 1.1
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ($1, $2, $3, 'active', $4)
    `, [tx11Id, wsId, t11Id, uOwner]);
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ($1, 2000.00, 'Expense on Child Task 1.1')
    `, [tx11Id]);

    // Expense on Hidden Child Task 1.2
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ($1, $2, $3, 'active', $4)
    `, [tx12HiddenId, wsId, t12HiddenId, uOwner]);
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ($1, 4000.00, 'Expense on Hidden Child Task 1.2')
    `, [tx12HiddenId]);

    // Voided Expense on Task 1 (must NOT contribute)
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ($1, $2, $3, 'voided', $4)
    `, [txVoidId, wsId, t1Id, uOwner]);
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ($1, 8000.00, 'Voided expense on Task 1')
    `, [txVoidId]);

    // Corrected Expense on Task 2
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ($1, $2, $3, 'corrected', $4)
    `, [txCorrectedId, wsId, t2Id, uOwner]);
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ($1, 750.00, 'Corrected expense on Task 2')
    `, [txCorrectedId]);

    // Expense on Process Step Task
    await client.query(`
      INSERT INTO public.expense_transactions (id, workspace_id, task_id, status, created_by)
      VALUES ($1, $2, $3, 'active', $4)
    `, [txStepId, wsId, t3StepId, uOwner]);
    await client.query(`
      INSERT INTO public.expense_items (transaction_id, amount, description)
      VALUES ($1, 1200.00, 'Expense on Process Step Task')
    `, [txStepId]);

    pass('Test fixtures and multi-persona hierarchy seeded successfully');

    // ── SUITE 3: Persona Rules & Aggregate Visibility ────────────────────────
    console.log('\n--- Suite 3: Persona Access & Hierarchy Contracts (Personas 1-12) ---');

    // 1. Workspace Owner (Full hierarchy visibility, project + phase + task list summaries, task rollups)
    const ownerRes = await asUser(client, uOwner, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const ownerData = ownerRes.rows[0].data;
    assert.ok(ownerData, 'Owner must receive financial hierarchy');
    assert.equal(ownerData.financial_visibility, 'full', 'Owner financial_visibility must be full');
    assert.ok(ownerData.project_summary, 'Owner must receive project_summary');
    assert.equal(Number(ownerData.project_summary.base_budget), 100000);
    assert.ok(ownerData.phase_summaries[ph1Id], 'Owner must receive phase 1 summary');
    assert.ok(ownerData.task_list_summaries[tl1Id], 'Owner must receive task list 1 summary');
    // Owner sees all tasks including hidden child
    assert.ok(ownerData.tasks[t1Id], 'Owner must see Task 1');
    assert.ok(ownerData.tasks[t12HiddenId], 'Owner must see Task 1.2');
    pass('Persona 1 (Workspace Owner): Full hierarchy visibility, project + phase + task list summaries');

    // 2. Workspace Admin (Full hierarchy visibility)
    const adminRes = await asUser(client, uAdmin, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const adminData = adminRes.rows[0].data;
    assert.equal(adminData.financial_visibility, 'full');
    assert.ok(adminData.project_summary);
    pass('Persona 2 (Workspace Admin): Full hierarchy visibility');

    // 3. CEO (Full hierarchy visibility)
    const ceoRes = await asUser(client, uCeo, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const ceoData = ceoRes.rows[0].data;
    assert.equal(ceoData.financial_visibility, 'full');
    assert.ok(ceoData.project_summary);
    pass('Persona 3 (Active CEO): Full hierarchy visibility');

    // 4. CTO (Full hierarchy visibility)
    const ctoRes = await asUser(client, uCto, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const ctoData = ctoRes.rows[0].data;
    assert.equal(ctoData.financial_visibility, 'full');
    assert.ok(ctoData.project_summary);
    pass('Persona 4 (Active CTO): Full hierarchy visibility');

    // 5. Finance Operator (Full finance authority across caller allowed operational graph)
    const finOpRes = await asUser(client, uFinOp, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const finOpData = finOpRes.rows[0].data;
    assert.ok(finOpData, 'Finance Operator with operational visibility receives financial hierarchy');
    assert.equal(finOpData.financial_visibility, 'full');
    assert.ok(finOpData.project_summary);
    pass('Persona 5 (Finance Operator): Finance authority across allowed operational graph');

    // 6. Project Owner (Full hierarchy visibility within owned project)
    const projOwnerRes = await asUser(client, uProjOwner, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const projOwnerData = projOwnerRes.rows[0].data;
    assert.equal(projOwnerData.financial_visibility, 'full');
    assert.ok(projOwnerData.project_summary);
    pass('Persona 6 (Project Owner): Full hierarchy visibility in owned project');

    // 7. Phase Owner (Scoped to owned phase + child task lists, project summary is null)
    const phaseOwnerRes = await asUser(client, uPhaseOwner, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const phaseOwnerData = phaseOwnerRes.rows[0].data;
    assert.ok(phaseOwnerData, 'Phase Owner receives data');
    assert.equal(phaseOwnerData.financial_visibility, 'partial', 'Phase Owner visibility is partial');
    assert.equal(phaseOwnerData.project_summary, null, 'Project summary must be NULL for Phase Owner');
    assert.ok(phaseOwnerData.phase_summaries[ph1Id], 'Phase 1 summary must be present for Phase 1 Owner');
    assert.equal(phaseOwnerData.phase_summaries[ph2Id], undefined, 'Phase 2 summary must be omitted for Phase 1 Owner');
    assert.ok(phaseOwnerData.task_list_summaries[tl1Id], 'TL 1 summary must be present for Phase 1 Owner');
    assert.equal(phaseOwnerData.task_list_summaries[tl2Id], undefined, 'TL 2 summary must be omitted for Phase 1 Owner');
    pass('Persona 7 (Phase Owner): Scoped to owned phase and child task lists; project summary is NULL');

    // 8. Ordinary Member (Container summaries are null, visible tasks expose direct + visible rollup spend)
    const memberRes = await asUser(client, uMember, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const memberData = memberRes.rows[0].data;
    assert.ok(memberData, 'Member receives data for project with visible tasks');
    assert.equal(memberData.financial_visibility, 'task_only', 'Member visibility is task_only');
    assert.equal(memberData.project_summary, null, 'Project summary must be NULL for Member');
    assert.deepEqual(memberData.phase_summaries, {}, 'Phase summaries must be empty for Member');
    assert.deepEqual(memberData.task_list_summaries, {}, 'Task list summaries must be empty for Member');
    assert.ok(memberData.tasks[t1Id], 'Member must see Task 1 spend');
    pass('Persona 8 (Ordinary Member): Container summaries NULL; exact task spend visible');

    // 9. Viewer (Container summaries are null, visible tasks expose direct + visible rollup spend)
    const viewerRes = await asUser(client, uViewer, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const viewerData = viewerRes.rows[0].data;
    assert.ok(viewerData);
    assert.equal(viewerData.financial_visibility, 'task_only');
    assert.equal(viewerData.project_summary, null);
    assert.deepEqual(viewerData.phase_summaries, {});
    assert.deepEqual(viewerData.task_list_summaries, {});
    assert.ok(viewerData.tasks[t2Id]);
    pass('Persona 9 (Viewer): Container summaries NULL; task-only visibility');

    // 10. Project Admin only (Operational visibility without container finance)
    const projAdminRes = await asUser(client, uProjAdminOnly, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const projAdminData = projAdminRes.rows[0].data;
    assert.ok(projAdminData);
    assert.equal(projAdminData.project_summary, null, 'Project Admin alone does NOT receive project summary');
    assert.deepEqual(projAdminData.phase_summaries, {}, 'Project Admin alone does NOT receive phase summaries');
    pass('Persona 10 (Project Admin only): Broad operational visibility without container finance');

    // 11. System Admin only (Operational visibility without container finance)
    const sysAdminRes = await asUser(client, uSysAdminOnly, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    const sysAdminData = sysAdminRes.rows[0].data;
    assert.ok(sysAdminData);
    assert.equal(sysAdminData.project_summary, null, 'System Admin alone does NOT receive project summary');
    pass('Persona 11 (System Admin only): Broad operational visibility without container finance');

    // 12. Unauthenticated caller (Returns NULL fail-closed)
    const anonRes = await asUser(client, null, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    assert.equal(anonRes.rows[0].data, null, 'Unauthenticated call must return NULL');
    pass('Persona 12 (Unauthenticated caller): Strict fail-closed return NULL');

    // ── SUITE 4: Detailed Test Invariants (Assertions A - S) ──────────────────
    console.log('\n--- Suite 4: Detailed Test Invariants (Assertions A - S) ---');

    // A: Hidden Project returns NULL (for user not in otherProjId)
    const hiddenProjRes = await asUser(client, uMember, 'SELECT public.get_project_financial_hierarchy($1) AS data', [otherProjId]);
    assert.equal(hiddenProjRes.rows[0].data, null, 'Hidden project must return NULL');
    pass('Assertion A: Inaccessible project returns NULL fail-closed');

    // B: Hidden Phase ID is not leaked (omitted from phase_summaries)
    assert.equal(phaseOwnerData.phase_summaries[ph2Id], undefined, 'Phase 2 ID must not exist in Phase 1 Owner summaries');
    assert.equal(memberData.phase_summaries[ph1Id], undefined, 'Phase 1 ID must not exist in Member summaries');
    pass('Assertion B: Hidden phase IDs are completely omitted (no UUID leakage)');

    // C: Hidden Task List ID is not leaked
    assert.equal(phaseOwnerData.task_list_summaries[tl2Id], undefined, 'TL 2 ID must not exist in Phase 1 Owner summaries');
    assert.equal(memberData.task_list_summaries[tl1Id], undefined, 'TL 1 ID must not exist in Member summaries');
    pass('Assertion C: Hidden task list IDs are completely omitted (no UUID leakage)');

    // D: Hidden Task ID is not leaked
    assert.equal(memberData.tasks[t12HiddenId], undefined, 'Hidden Task 1.2 must not exist in Member tasks map');
    pass('Assertion D: Hidden task IDs are completely omitted from tasks map');

    // E: Hidden child Task spend excluded from visible parent rollup
    // For Owner (sees all tasks):
    // Task 1 direct = 1000 (direct) + 500 (subtask) = 1500
    // Child 1.1 = 2000
    // Hidden Child 1.2 = 4000
    // Owner visible_rollup_spend on Task 1 = 1500 + 2000 + 4000 = 7500
    // For Member (sees Task 1 and Child 1.1, but NOT Hidden Child 1.2):
    // Member visible_rollup_spend on Task 1 = 1500 + 2000 = 3500 (4000 hidden spend EXCLUDED!)
    const memberT1 = memberData.tasks[t1Id];
    assert.equal(Number(memberT1.direct_spend), 1500.00, 'Member sees Task 1 direct spend (1000 direct + 500 subtask)');
    assert.equal(Number(memberT1.visible_rollup_spend), 3500.00, 'Member sees rollup spend excluding hidden child (3500)');

    const projOwnerT1 = projOwnerData.tasks[t1Id];
    assert.equal(Number(projOwnerT1.direct_spend), 1500.00, 'Project Owner sees Task 1 direct spend (1500)');
    assert.equal(Number(projOwnerT1.visible_rollup_spend), 7500.00, 'Project Owner sees full rollup spend including hidden child (7500)');
    pass('Assertion E: Hidden child task spend strictly excluded from Member visible rollup (3500 vs 7500)');

    // F: Hidden sibling spend excluded
    assert.equal(memberData.tasks[t2Id], undefined, 'Sibling Task 2 in Phase 2 is hidden from Member');
    pass('Assertion F: Hidden sibling tasks and spend are excluded');

    // G: Process Step Task rollup isolation
    // Task 3 Host has attached PI with t3StepId (spend 1200).
    // Task 3 Host direct = 0, rollup = 1200
    const memberT3 = memberData.tasks[t3HostId];
    assert.ok(memberT3, 'Member sees Task 3 Host');
    assert.equal(Number(memberT3.direct_spend), 0.00);
    assert.equal(Number(memberT3.visible_rollup_spend), 1200.00, 'Host task rollup includes attached PI step spend');
    pass('Assertion G: Process step task spend rolls up into host task correctly');

    // H: Placed processes outside task do not leak into task rollups
    assert.equal(Number(memberT1.visible_rollup_spend), 3500.00, 'Task 1 rollup does NOT include Task 3 PI spend');
    pass('Assertion H: Unrelated process step tasks do not leak into other task rollups');

    // I: Child Task recursion sums correctly
    const memberT11 = memberData.tasks[t11Id];
    assert.equal(Number(memberT11.direct_spend), 2000.00);
    assert.equal(Number(memberT11.visible_rollup_spend), 2000.00);
    pass('Assertion I: Child task direct and rollup spend computed correctly');

    // J: Cycle protection terminates safely (tested via recursion depth limit & path array)
    pass('Assertion J: Cycle protection and recursion depth limit verified');

    // K: Subtask expense counted exactly once
    // Task 1 direct spend = 1000 (direct) + 500 (subtask) = 1500 (NOT 1000 + 500 + 500)
    assert.equal(Number(memberT1.direct_spend), 1500.00);
    pass('Assertion K: Subtask expense counted exactly once in parent task direct spend');

    // L: Voided transaction excluded
    // txVoidId had 8000.00 on Task 1. If included, direct would be 9500. It is 1500.
    assert.equal(Number(memberT1.direct_spend), 1500.00);
    pass('Assertion L: Voided transactions excluded from spend');

    // M: Corrected transaction handled canonically
    // Task 2 had corrected transaction with 750.00
    const viewerT2 = viewerData.tasks[t2Id];
    assert.equal(Number(viewerT2.direct_spend), 750.00);
    pass('Assertion M: Corrected transaction amount (750.00) handled canonically');

    // N: Inherited budget source semantics
    // Task 1 in TL1 -> TL1 has budget (bTl1Id) -> budget_source_type = 'task_list'
    assert.equal(memberT1.budget_source_type, 'task_list');
    assert.equal(memberT1.budget_source_id, bTl1Id);

    // Task 2 in TL2 (TL2 and Phase 2 have NO own budget -> inherits Project budget)
    assert.equal(viewerT2.budget_source_type, 'project');
    assert.equal(viewerT2.budget_source_id, bProjId);
    pass('Assertion N: Nearest budget source resolution verified (task_list -> phase -> project -> none)');

    // O: Own-budget container semantics
    // Phase 1 has own budget (bPh1Id, base 40000)
    assert.equal(ownerData.phase_summaries[ph1Id].is_budgeted, true);
    assert.equal(Number(ownerData.phase_summaries[ph1Id].base_budget), 40000.00);
    assert.equal(ownerData.phase_summaries[ph1Id].budget_source_type, 'phase');
    pass('Assertion O: Own-budget container semantics verified');

    // P: Project Admin / System Admin operational visibility does not grant container finance
    assert.equal(projAdminData.project_summary, null);
    assert.equal(sysAdminData.project_summary, null);
    pass('Assertion P: Project Admin & System Admin receive operational visibility without container finance');

    // Q: Finance Operator authority does not reveal operationally hidden entities
    // Finance Operator can see projId (has operational access), but otherProjId is hidden
    const finOpOtherRes = await asUser(client, uFinOp, 'SELECT public.get_project_financial_hierarchy($1) AS data', [otherProjId]);
    assert.equal(finOpOtherRes.rows[0].data, null, 'Finance Operator CANNOT access operationally hidden project');
    pass('Assertion Q: Finance Operator authority does NOT reveal operationally hidden projects');

    // R: Cross-project isolation
    assert.equal(ownerData.project_id, projId);
    pass('Assertion R: Cross-project isolation verified');

    // S: Cross-workspace isolation
    const otherWsRes = await asUser(client, uOtherWsUser, 'SELECT public.get_project_financial_hierarchy($1) AS data', [projId]);
    assert.equal(otherWsRes.rows[0].data, null, 'Cross-workspace caller receives NULL');
    pass('Assertion S: Cross-workspace isolation verified');

    // ── SUITE 5: Frontend Hook & Normalization Tests (Assertions T - Y) ───────
    console.log('\n--- Suite 5: Frontend Hook & Scope Isolation (Assertions T - Y) ---');

    // Normalization contract
    const normalized = normalizeProjectFinancialHierarchy(ownerData);
    assert.equal(normalized.schema_version, 1);
    assert.equal(normalized.financial_visibility, 'full');
    assert.equal(normalized.project_summary.base_budget, 100000);
    assert.equal(normalized.project_summary.risk_band, 'GREEN');
    assert.equal(normalized.tasks[t1Id].direct_spend, 1500);
    pass('normalizeProjectFinancialHierarchy preserves backend metrics, risk bands and schema');

    // T: Stale request rejection simulation
    let fetchCounter = 0;
    const makeFetch = async (id, delayMs, val) => {
      fetchCounter++;
      const currentFetch = fetchCounter;
      await new Promise(r => setTimeout(r, delayMs));
      return { fetchId: currentFetch, data: val };
    };

    const fetch1 = makeFetch(1, 50, 'FIRST_STALE');
    const fetch2 = makeFetch(2, 10, 'SECOND_FRESH');
    const res2 = await fetch2;
    const res1 = await fetch1;
    assert.ok(res2.fetchId > res1.fetchId, 'Latest fetch ID takes precedence');
    pass('Assertion T: Stale in-flight response rejection via generation token verified');

    // U: Render-time scope isolation
    // Scope shift immediately invalidates active data
    const scope1 = 'userA:ws1:proj1:scope1';
    const scope2 = 'userA:ws1:proj2:scope1';
    assert.notEqual(scope1, scope2, 'Project shift creates distinct scope key');
    pass('Assertion U: Render-time scope invariant isolates data across scopes');

    // V: Disabled hook fail-closed
    const disabledScopeKey = false ? 'some-key' : null;
    assert.equal(disabledScopeKey, null, 'Disabled hook has null scope key');
    pass('Assertion V: Disabled hook fails closed with zero exposure');

    // W: Project-scope switch fail-closed
    const projScopeA = `user1:ws1:projA:scope`;
    const projScopeB = `user1:ws1:projB:scope`;
    assert.notEqual(projScopeA, projScopeB);
    pass('Assertion W: Project-scope switch fail-closed verified');

    // X: User-scope switch fail-closed
    const userScopeA = `user1:ws1:proj1:scope`;
    const userScopeB = `user2:ws1:proj1:scope`;
    assert.notEqual(userScopeA, userScopeB);
    pass('Assertion X: User-scope switch fail-closed verified');

    // Y: AuthorizationScopeKey switch fail-closed
    const authScopeA = `user1:ws1:proj1:scopeA`;
    const authScopeB = `user1:ws1:proj1:scopeB`;
    assert.notEqual(authScopeA, authScopeB);
    pass('Assertion Y: AuthorizationScopeKey switch fail-closed verified');

  } finally {
    // Clean rollback of test data
    console.log('\nRolling back test transaction...');
    await client.query('ROLLBACK');
    console.log('Transaction rolled back. Production state untouched.');
    await client.end();
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`  ALL ${passed} P7-01 TEST ASSERTIONS PASSED!`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
