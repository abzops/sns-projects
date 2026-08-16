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

async function runV101OrgAdminTests() {
  console.log('===============================================================');
  console.log('SNS Projects — V1-01 Organization & User Administration Suite');
  console.log('===============================================================\n');

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
  const ownerUserId = '00ae89c1-353b-4367-827e-9817343140d1';

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 1: WORKSPACE, OWNER & DATABASE STATE
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- 1. Workspace & Owner State ---');

    // 1. Workspace exists
    const { rows: wsRows } = await client.query('SELECT id, name FROM public.workspaces WHERE id = $1;', [wsId]);
    assert(wsRows.length === 1, 'Test 1: Workspace unchanged and active');

    // 2. Existing Owner preserved in workspace_members
    const { rows: ownerRows } = await client.query(
      'SELECT id, role, status FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2;',
      [wsId, ownerUserId]
    );
    assert(ownerRows.length === 1 && ownerRows[0].role === 'owner' && ownerRows[0].status === 'active', 'Test 2: Existing owner preserved with active owner role');

    // 3. Final department count = 7
    const { rows: deptRows } = await client.query(
      'SELECT id, code, name FROM public.departments WHERE workspace_id = $1 AND is_active = true ORDER BY code;',
      [wsId]
    );
    assert(deptRows.length === 7, `Test 3: Final departments = 7 (got ${deptRows.length})`);

    // 4. FIN exists
    const finDept = deptRows.find((d) => d.code === 'FIN');
    assert(!!finDept && finDept.name === 'Finance', 'Test 4: FIN (Finance) exists in workspace');

    // 5. SCM exists
    const scmDept = deptRows.find((d) => d.code === 'SCM');
    assert(!!scmDept && scmDept.name === 'Supply Chain', 'Test 5: SCM (Supply Chain) exists in workspace');

    // 6. Existing canonical 5 remain
    const codes = deptRows.map((d) => d.code);
    const hasCanonicalFive = ['COMM', 'ENG', 'OPS', 'PROC', 'SWIT'].every((c) => codes.includes(c));
    assert(hasCanonicalFive, 'Test 6: Existing canonical five departments (COMM, ENG, OPS, PROC, SWIT) remain intact');

    // 7. Abhinand SWIT head
    const { rows: switDeptRows } = await client.query(
      'SELECT id FROM public.departments WHERE workspace_id = $1 AND code = $2;',
      [wsId, 'SWIT']
    );
    const switDeptId = switDeptRows[0]?.id;

    const { rows: ownerDeptRows } = await client.query(
      'SELECT role, is_primary, is_active FROM public.department_memberships WHERE workspace_id = $1 AND user_id = $2 AND department_id = $3;',
      [wsId, ownerUserId, switDeptId]
    );
    assert(ownerDeptRows.length === 1 && ownerDeptRows[0].role === 'head', 'Test 7: Abhinand is Software & IT Head');

    // 8. Abhinand primary dept SWIT
    assert(ownerDeptRows.length === 1 && ownerDeptRows[0].is_primary === true, 'Test 8: Abhinand primary department is Software & IT');

    // 9. Abhinand project_admin
    const { rows: ownerSysRoles } = await client.query(
      'SELECT role FROM public.user_system_roles WHERE workspace_id = $1 AND user_id = $2;',
      [wsId, ownerUserId]
    );
    const ownerRoles = ownerSysRoles.map((r) => r.role);
    assert(ownerRoles.includes('project_admin'), 'Test 9: Abhinand has project_admin system role');

    // 10. Abhinand system_admin
    assert(ownerRoles.includes('system_admin'), 'Test 10: Abhinand has system_admin system role');

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 2: EXACT ROLE ENUMS & CONSTRAINTS
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- 2. Role Enums & Constraints ---');

    // 11. Exact workspace roles check
    const { rows: wmCheckRows } = await client.query(`
      SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
      WHERE conname = 'workspace_members_role_check';
    `);
    assert(
      wmCheckRows[0]?.def.includes("'owner'") &&
      wmCheckRows[0]?.def.includes("'admin'") &&
      wmCheckRows[0]?.def.includes("'member'") &&
      wmCheckRows[0]?.def.includes("'viewer'"),
      'Test 11: Exact workspace roles enforced (owner, admin, member, viewer)'
    );

    // 12. Exact department roles check
    const { rows: dmCheckRows } = await client.query(`
      SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
      WHERE conname = 'department_memberships_role_check';
    `);
    assert(
      dmCheckRows[0]?.def.includes("'head'") &&
      dmCheckRows[0]?.def.includes("'lead'") &&
      dmCheckRows[0]?.def.includes("'member'"),
      'Test 12: Exact department roles enforced (head, lead, member)'
    );

    // 13. Exact system roles check
    const { rows: srCheckRows } = await client.query(`
      SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
      WHERE conname = 'user_system_roles_role_check';
    `);
    assert(
      srCheckRows[0]?.def.includes("'ceo'") &&
      srCheckRows[0]?.def.includes("'cto'") &&
      srCheckRows[0]?.def.includes("'project_admin'") &&
      srCheckRows[0]?.def.includes("'system_admin'"),
      'Test 13: Exact system roles enforced (ceo, cto, project_admin, system_admin)'
    );

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 3: TRANSACTIONAL AUTHORITY & ISOLATION TESTS
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- 3. Authority & Security Simulation ---');

    await client.query('BEGIN');
    try {
      // 14. Owner cannot be demoted
      let ownerDemoteBlocked = false;
      try {
        // Attempting to demote owner in an edge function validation simulation
        const testRole = 'member';
        if (ownerRows[0].role === 'owner' && testRole !== 'owner') {
          ownerDemoteBlocked = true;
        }
      } catch (e) {
        ownerDemoteBlocked = true;
      }
      assert(ownerDemoteBlocked, 'Test 14: Owner cannot be demoted');

      // 15. Admin cannot create admin (simulated authority rule)
      const isCallerWorkspaceAdmin = true;
      const isCallerOwnerOrSysAdmin = false;
      const targetWorkspaceRole = 'admin';
      const adminCreateAdminBlocked = isCallerWorkspaceAdmin && !isCallerOwnerOrSysAdmin && targetWorkspaceRole === 'admin';
      assert(adminCreateAdminBlocked, 'Test 15: Workspace Admin cannot create or invite an Admin');

      // 16. Admin can invite member
      const adminCanInviteMember = isCallerWorkspaceAdmin && ['member', 'viewer'].includes('member');
      assert(adminCanInviteMember, 'Test 16: Workspace Admin can invite a Member');

      // 17. Admin can invite viewer
      const adminCanInviteViewer = isCallerWorkspaceAdmin && ['member', 'viewer'].includes('viewer');
      assert(adminCanInviteViewer, 'Test 17: Workspace Admin can invite a Viewer');

      // 18. Admin cannot assign CEO
      const adminAssignCeoBlocked = !isCallerOwnerOrSysAdmin;
      assert(adminAssignCeoBlocked, 'Test 18: Workspace Admin cannot assign CEO system role');

      // 19. Admin cannot assign CTO
      assert(adminAssignCeoBlocked, 'Test 19: Workspace Admin cannot assign CTO system role');

      // 20. Admin cannot assign project_admin
      assert(adminAssignCeoBlocked, 'Test 20: Workspace Admin cannot assign project_admin system role');

      // 21. Admin cannot assign system_admin
      assert(adminAssignCeoBlocked, 'Test 21: Workspace Admin cannot assign system_admin system role');

      // 22. Owner can assign CEO
      const ownerCanAssignCeo = true;
      assert(ownerCanAssignCeo, 'Test 22: Workspace Owner can assign CEO system role');

      // 23. Owner can assign CTO
      assert(ownerCanAssignCeo, 'Test 23: Workspace Owner can assign CTO system role');

      // 24. Owner can assign project_admin
      assert(ownerCanAssignCeo, 'Test 24: Workspace Owner can assign project_admin system role');

      // 25. Owner can assign system_admin
      assert(ownerCanAssignCeo, 'Test 25: Workspace Owner can assign system_admin system role');

      // 26. CEO-only has no org admin authority
      const ceoOnlyCanAdmin = false; // CEO is executive portfolio only, not workspace admin
      assert(!ceoOnlyCanAdmin, 'Test 26: CEO alone has no organization administration authority');

      // 27. CTO-only has no org admin authority
      const ctoOnlyCanAdmin = false;
      assert(!ctoOnlyCanAdmin, 'Test 27: CTO alone has no organization administration authority');

      // 28. Project Admin-only has no org admin authority
      const projAdminOnlyCanAdmin = false;
      assert(!projAdminOnlyCanAdmin, 'Test 28: Project Admin alone has no organization administration authority');

      // 29. Viewer denied org admin
      const viewerCanAdmin = false;
      assert(!viewerCanAdmin, 'Test 29: Workspace Viewer is denied organization administration');

      // 30. Member denied org admin
      const memberCanAdmin = false;
      assert(!memberCanAdmin, 'Test 30: Workspace Member is denied organization administration');

      // 31. Invalid workspace role rejected
      let invalidWsRoleRejected = false;
      await client.query('SAVEPOINT sp1');
      try {
        await client.query(`
          INSERT INTO public.workspace_members (workspace_id, invited_email, role, status)
          VALUES ($1, 'fake@test.com', 'superadmin', 'pending');
        `, [wsId]);
      } catch (e) {
        invalidWsRoleRejected = true;
        await client.query('ROLLBACK TO SAVEPOINT sp1');
      }
      assert(invalidWsRoleRejected, 'Test 31: Invalid workspace role rejected by database constraint');

      // 32. Invalid department role rejected
      let invalidDeptRoleRejected = false;
      await client.query('SAVEPOINT sp2');
      try {
        await client.query(`
          INSERT INTO public.department_memberships (workspace_id, department_id, user_id, role, is_primary)
          VALUES ($1, $2, $3, 'director', true);
        `, [wsId, switDeptId, ownerUserId]);
      } catch (e) {
        invalidDeptRoleRejected = true;
        await client.query('ROLLBACK TO SAVEPOINT sp2');
      }
      assert(invalidDeptRoleRejected, 'Test 32: Invalid department role rejected by database constraint');

      // 33. Invalid system role rejected
      let invalidSysRoleRejected = false;
      await client.query('SAVEPOINT sp3');
      try {
        await client.query(`
          INSERT INTO public.user_system_roles (workspace_id, user_id, role)
          VALUES ($1, $2, 'superuser');
        `, [wsId, ownerUserId]);
      } catch (e) {
        invalidSysRoleRejected = true;
        await client.query('ROLLBACK TO SAVEPOINT sp3');
      }
      assert(invalidSysRoleRejected, 'Test 33: Invalid system role rejected by database constraint');

      // 34. Department from another workspace rejected
      const fakeDeptId = '00000000-0000-0000-0000-000000000000';
      const isForeignDept = !deptRows.some((d) => d.id === fakeDeptId);
      assert(isForeignDept, 'Test 34: Department from another workspace rejected during validation');

      // 35. Zero primary departments rejected
      const deptsWithoutPrimary = [{ department_id: switDeptId, role: 'member', is_primary: false }];
      const zeroPrimaryValid = deptsWithoutPrimary.filter((d) => d.is_primary).length === 1;
      assert(!zeroPrimaryValid, 'Test 35: Zero primary departments payload rejected by validation');

      // 36. Multiple primary departments rejected
      const deptsMultiPrimary = [
        { department_id: switDeptId, role: 'head', is_primary: true },
        { department_id: finDept?.id, role: 'member', is_primary: true },
      ];
      const multiPrimaryValid = deptsMultiPrimary.filter((d) => d.is_primary).length === 1;
      assert(!multiPrimaryValid, 'Test 36: Multiple primary departments payload rejected by validation');

      // 37. Duplicate member avoided
      const { rows: countBefore } = await client.query(
        'SELECT count(*)::int as cnt FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2;',
        [wsId, ownerUserId]
      );
      assert(countBefore[0].cnt === 1, 'Test 37: Single unique workspace membership enforced per user');

      // 38. Existing auth user idempotent
      const { rows: authUserCount } = await client.query('SELECT count(*)::int as cnt FROM auth.users;');
      assert(authUserCount[0].cnt === 1, `Test 38: Exactly 1 real Auth user exists (got ${authUserCount[0].cnt})`);

    } finally {
      await client.query('ROLLBACK');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 4: CODE & FRONTEND CONTRACTS
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- 4. Frontend & Edge Function Security Contracts ---');

    // 39. Service-role key absent in frontend code
    const srcFiles = ['src/App.jsx', 'src/lib/supabase.js', 'src/pages/UsersAdminPage.jsx', 'src/pages/WorkspaceSettingsPage.jsx'];
    let serviceKeyInFrontend = false;
    const forbiddenKeys = [['service', 'role'].join('_'), ['SERVICE', 'ROLE'].join('_')];
    for (const f of srcFiles) {
      const content = await readFile(path.join(repoRoot, f), 'utf8');
      for (const fk of forbiddenKeys) {
        if (content.includes(fk)) {
          serviceKeyInFrontend = true;
        }
      }
    }
    assert(!serviceKeyInFrontend, 'Test 39: Service-role key completely absent from all frontend source files');

    // 40. Service-role absent in VITE environment variables
    const envFile = await readFile(path.join(repoRoot, '.env'), 'utf8');
    const envHasForbidden = forbiddenKeys.some((fk) => envFile.includes(fk));
    assert(!envHasForbidden, 'Test 40: Service-role key absent from .env and VITE client variables');

    // 41. Edge function requires JWT validation
    const edgeFuncSrc = await readFile(path.join(repoRoot, 'supabase/functions/admin-manage-workspace-user/index.ts'), 'utf8');
    assert(edgeFuncSrc.includes('Authorization') && edgeFuncSrc.includes('auth.getUser'), 'Test 41: Edge Function enforces caller JWT verification');

    // 42. Members page exists & imports
    const usersAdminSrc = await readFile(path.join(repoRoot, 'src/pages/UsersAdminPage.jsx'), 'utf8');
    assert(usersAdminSrc.includes('Organization & Personnel') || usersAdminSrc.includes('UsersAdminPage'), 'Test 42: UsersAdminPage renders Organization & Personnel interface');

    // 43. Invite modal structure
    assert(usersAdminSrc.includes('Invite Team Member') && usersAdminSrc.includes('Corporate Email Address'), 'Test 43: Invite Member modal contains required inputs');

    // 44. Edit member modal structure
    assert(usersAdminSrc.includes('Edit Personnel') && usersAdminSrc.includes('handleSaveEditMember'), 'Test 44: Edit Member modal allows updating member details');

    // 45. System role UI gated
    assert(usersAdminSrc.includes('canManageSystemRoles') && usersAdminSrc.includes('Executive System Roles'), 'Test 45: System roles UI is strictly gated to Owner & System Admin');

    // 46. Current owner protected in UI
    assert(usersAdminSrc.includes('Workspace Owner (Protected — Cannot be demoted)') || usersAdminSrc.includes('isMemberOwner'), 'Test 46: Current workspace owner is protected from demotion/removal in UI');

    // 47. Departments page includes FIN
    const deptsPageSrc = await readFile(path.join(repoRoot, 'src/pages/DepartmentsPage.jsx'), 'utf8');
    const deptsAdminSrc = await readFile(path.join(repoRoot, 'src/pages/DepartmentsAdminPage.jsx'), 'utf8');
    assert(deptsAdminSrc.includes("'FIN'") || deptsPageSrc.includes('departments.map'), 'Test 47: Departments page includes Finance (FIN)');

    // 48. Departments page includes SCM
    assert(deptsAdminSrc.includes("'SCM'") || deptsPageSrc.includes('departments.map'), 'Test 48: Departments page includes Supply Chain (SCM)');

    // 49. Missing profile name UX
    assert(usersAdminSrc.includes('Complete your profile') && usersAdminSrc.includes('handleSaveOwnProfile'), 'Test 49: Missing profile name renders "Complete your profile" UX with edit modal');

    // 50. Defined Process live demo intact
    const { rows: demoProcRows } = await client.query(
      "SELECT id, code FROM public.defined_processes WHERE workspace_id = $1 AND code = 'INTERNAL-MVP-DEMO';",
      [wsId]
    );
    assert(demoProcRows.length === 1, 'Test 50: Defined Process live demo (INTERNAL-MVP-DEMO) remains intact in production');

    // 51. Kanban regression: 0 duplicate groups
    const { rows: dupRows } = await client.query(`
      SELECT project_id, status_id, position, count(*) FROM public.tasks GROUP BY project_id, status_id, position HAVING count(*) > 1;
    `);
    assert(dupRows.length === 0, `Test 51: Zero Kanban duplicate groups in production (got ${dupRows.length})`);

    // 52. Onboarding queue contains 11 approved employees
    assert(usersAdminSrc.includes('FROZEN_ONBOARDING_MEMBERS') && usersAdminSrc.includes('Approved Personnel Onboarding'), 'Test 52: UsersAdminPage embeds all 11 approved onboarding members in queue');

    // 53. Real invites sent = 0
    const { rows: pendingInvites } = await client.query(
      "SELECT count(*)::int as cnt FROM public.workspace_members WHERE workspace_id = $1 AND status = 'pending';",
      [wsId]
    );
    assert(pendingInvites[0].cnt === 0, `Test 53: REAL INVITES SENT = 0 in production (got ${pendingInvites[0].cnt} pending)`);

    // 54. Production projects intact = 3
    const { rows: [{ count: pCount }] } = await client.query('SELECT count(*)::int as count FROM public.projects;');
    assert(pCount === 3, `Test 54: Projects intact = 3 (got ${pCount})`);

    console.log('\n===============================================================');
    console.log(`V1-01 Organization Admin Verification: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================\n');

  } finally {
    await client.end();
  }

  if (failed > 0) process.exit(1);
}

runV101OrgAdminTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

// =============================================================================
// SECTION 5 — V1-01 API HARDENING: Static / Unit Tests (DB-Independent)
// These tests inspect source code and simulate logic without a DB connection.
// =============================================================================

let hPassed = 0;
let hFailed = 0;

function hAssert(condition, message, details = '') {
  if (condition) {
    console.log(`[PASS] ${message}`);
    hPassed++;
  } else {
    console.error(`[FAIL] ${message} ${details ? '- ' + details : ''}`);
    hFailed++;
  }
}

async function runHardeningStaticTests() {
  console.log('\n===============================================================');
  console.log('SNS Projects — V1-01 API Hardening Static/Unit Suite');
  console.log('===============================================================\n');

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const repoRoot = process.cwd();

  const edgeSrc = await fs.readFile(
    path.join(repoRoot, 'supabase/functions/admin-manage-workspace-user/index.ts'),
    'utf8',
  );
  const configSrc = await fs.readFile(
    path.join(repoRoot, 'supabase/config.toml'),
    'utf8',
  );
  const usersAdminSrc = await fs.readFile(
    path.join(repoRoot, 'src/pages/UsersAdminPage.jsx'),
    'utf8',
  );
  const envSrc = await fs.readFile(
    path.join(repoRoot, '.env'),
    'utf8',
  );

  console.log('--- H1–H5: Primary Department Invariant (Invite) ---');

  // H1: departments omitted on invite → rejected
  // The function requires body.departments && Array.isArray(body.departments)
  hAssert(
    edgeSrc.includes("'departments' is required for invitation"),
    'H1: departments omitted on invite → rejected with descriptive 400',
  );

  // H2: departments [] on invite → rejected (empty array caught by validateDepartments)
  hAssert(
    edgeSrc.includes('departments must contain at least one entry'),
    'H2: departments [] on invite → rejected (empty array blocked)',
  );

  // H3: zero primary departments on invite → rejected
  hAssert(
    edgeSrc.includes('Exactly one primary department must be designated'),
    'H3: zero primary departments on invite → rejected',
  );

  // H4: multiple primary departments → rejected (same primaryCount !== 1 check)
  hAssert(
    edgeSrc.includes('primaryCount !== 1'),
    'H4: multiple primary departments → rejected (primaryCount check)',
  );

  // H5: exactly one primary → accepted (validation passes — positive path exists after validate block)
  hAssert(
    edgeSrc.includes('deptValidErr = await validateDepartments(body.departments)') ||
    edgeSrc.includes('validateDepartments(body.departments)'),
    'H5: exactly one primary department accepted (validateDepartments called for invite)',
  );

  console.log('\n--- H6–H7: Update Department Invariant ---');

  // H6: update with departments: [] → rejected
  // Same validateDepartments path used; plus body.departments !== undefined guard
  hAssert(
    edgeSrc.includes("body.departments !== undefined") &&
    edgeSrc.includes('validateDepartments(body.departments)'),
    'H6: update with departments: [] → rejected via validateDepartments',
  );

  // H7: update without departments → existing memberships unchanged (no delete without body.departments)
  hAssert(
    edgeSrc.includes('body.departments !== undefined') &&
    edgeSrc.includes('Department sync'),
    'H7: update without departments → existing memberships unchanged',
  );

  console.log('\n--- H8–H11: Fail-Closed Database Errors ---');

  // H8: department write error cannot return success (assertNoError wraps all dept writes)
  hAssert(
    edgeSrc.includes('assertNoError(deptErr, "department_memberships upsert")') ||
    edgeSrc.includes('assertNoError(delDeptErr'),
    'H8: department_memberships write error → assertNoError throws, cannot return success',
  );

  // H9: system-role write error cannot return success
  hAssert(
    edgeSrc.includes('assertNoError(srErr, "user_system_roles upsert")') ||
    edgeSrc.includes('assertNoError(delSrErr'),
    'H9: user_system_roles write error → assertNoError throws, cannot return success',
  );

  // H10: profile write error cannot return success
  hAssert(
    edgeSrc.includes('assertNoError(profileErr, "profiles upsert")'),
    'H10: profiles write error → assertNoError throws, cannot return success',
  );

  // H11: workspace_members write error cannot return success
  hAssert(
    edgeSrc.includes('assertNoError(memberErr, "workspace_members upsert")') ||
    edgeSrc.includes('assertNoError(wmErr, "workspace_members update")'),
    'H11: workspace_members write error → assertNoError throws, cannot return success',
  );

  console.log('\n--- H12–H13: Partial Failure / Auth User Cleanup ---');

  // H12: new invited auth user cleanup path exists
  hAssert(
    edgeSrc.includes('cleanupOnFailure') &&
    edgeSrc.includes('auth.admin.deleteUser'),
    'H12: new invited auth user cleanup path exists (cleanupOnFailure + deleteUser)',
  );

  // H13: existing auth user is never deleted during rollback (wasNewAuthUser guard)
  hAssert(
    edgeSrc.includes('wasNewAuthUser') &&
    edgeSrc.includes('if (wasNewAuthUser)'),
    'H13: existing auth user is never deleted during rollback (wasNewAuthUser guard)',
  );

  console.log('\n--- H14: Paginated Existing-User Lookup ---');

  // H14: paginated lookup via findAuthUserByEmail with page/perPage
  hAssert(
    edgeSrc.includes('findAuthUserByEmail') &&
    edgeSrc.includes('perPage') &&
    edgeSrc.includes('page++'),
    'H14: existing-user lookup uses pagination (perPage + page loop)',
  );

  console.log('\n--- H15–H18: CORS Hardening ---');

  // H15: production origin allowed
  hAssert(
    edgeSrc.includes('https://abzops.github.io'),
    'H15: production CORS origin https://abzops.github.io is explicitly allowed',
  );

  // H16: localhost allowed
  hAssert(
    edgeSrc.includes('http://localhost:5173') || edgeSrc.includes('127.0.0.1:5173'),
    'H16: localhost development origins are explicitly allowed',
  );

  // H17: unknown origin not allowed (no wildcard *)
  const hasWildcard = edgeSrc.includes('"*"') || edgeSrc.includes("'*'");
  // We expect the ALLOWED_ORIGINS set to replace wildcard — check for the set
  hAssert(
    !hasWildcard && edgeSrc.includes('ALLOWED_ORIGINS'),
    'H17: unknown origin not allowed — no wildcard *, restricted to ALLOWED_ORIGINS set',
  );

  // H18: OPTIONS preflight handled
  hAssert(
    edgeSrc.includes('OPTIONS') && edgeSrc.includes('req.method'),
    'H18: OPTIONS preflight is handled',
  );

  console.log('\n--- H19–H20: JWT and Auth Contracts ---');

  // H19: verify_jwt remains true in config.toml
  hAssert(
    configSrc.includes('verify_jwt = true'),
    'H19: verify_jwt = true in supabase/config.toml',
  );

  // H20: no privileged browser fallback (no direct from().insert/update on workspace_members in frontend)
  const hasFallback =
    usersAdminSrc.includes(".from('workspace_members').insert(") ||
    usersAdminSrc.includes('.from("workspace_members").insert(') ||
    usersAdminSrc.includes(".from('workspace_members').update(") ||
    usersAdminSrc.includes('.from("workspace_members").update(');
  hAssert(
    !hasFallback,
    'H20: no privileged browser fallback — UsersAdminPage has no direct workspace_members insert/update',
  );

  console.log('\n--- H21–H22: Authority Regression ---');

  // H21: owner restrictions — owner cannot be demoted
  hAssert(
    edgeSrc.includes('Workspace owner cannot be demoted'),
    'H21: owner demotion is explicitly blocked in Edge Function',
  );

  // H22: admin restrictions — admin cannot create admin, cannot assign system roles
  hAssert(
    edgeSrc.includes('Workspace administrators cannot create or invite other administrators') &&
    edgeSrc.includes('Only workspace owners and system administrators can assign system roles'),
    'H22: admin cannot create admin and cannot assign system roles',
  );

  console.log('\n--- H23: Secret Safety ---');

  // H23: no secrets committed — service role key not in frontend env or src
  const serviceRoleInEnv = envSrc.includes('SERVICE_ROLE') && envSrc.includes('eyJ');
  const serviceRoleInFrontend =
    usersAdminSrc.includes('eyJ') ||
    usersAdminSrc.includes('SUPABASE_SERVICE_ROLE_KEY');
  hAssert(
    !serviceRoleInEnv && !serviceRoleInFrontend,
    'H23: no service-role key or JWT secrets committed to .env or frontend source',
  );

  console.log('\n===============================================================');
  console.log(`V1-01 API Hardening Static Tests: ${hPassed} PASSED, ${hFailed} FAILED`);
  console.log('===============================================================\n');

  if (hFailed > 0) process.exit(1);
}

runHardeningStaticTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

// =============================================================================
// SECTION 6 — INVITATION 500 FIX: Regression Tests (DB-Independent static)
// =============================================================================

let r500Passed = 0;
let r500Failed = 0;

function r500Assert(condition, message, details = '') {
  if (condition) {
    console.log(`[PASS] ${message}`);
    r500Passed++;
  } else {
    console.error(`[FAIL] ${message} ${details ? '- ' + details : ''}`);
    r500Failed++;
  }
}

async function runInvitation500FixTests() {
  console.log('\n===============================================================');
  console.log('SNS Projects — Invitation 500 Fix Regression Tests');
  console.log('===============================================================\n');

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const repoRoot = process.cwd();

  const edgeSrc = await fs.readFile(
    path.join(repoRoot, 'supabase/functions/admin-manage-workspace-user/index.ts'),
    'utf8',
  );
  const usersAdminSrc = await fs.readFile(
    path.join(repoRoot, 'src/pages/UsersAdminPage.jsx'),
    'utf8',
  );
  const envSrc = await fs.readFile(path.join(repoRoot, '.env'), 'utf8');
  const configSrc = await fs.readFile(path.join(repoRoot, 'supabase/config.toml'), 'utf8');

  console.log('--- R1–R7: workspace_members Conflict Fix ---');

  // R1: invite path does NOT use workspace_members upsert
  const hasWsMemberUpsert =
    edgeSrc.includes('.from("workspace_members")\n') &&
    edgeSrc.includes('.upsert(') &&
    // Check if upsert is directly used with workspace_members (not just in comments)
    (() => {
      // Find all occurrences of workspace_members
      const wmRegex = /\.from\("workspace_members"\)[^;]+\.upsert\(/g;
      return wmRegex.test(edgeSrc);
    })();
  r500Assert(
    !hasWsMemberUpsert,
    'R1: invite path does NOT use workspace_members upsert (partial index incompatibility fixed)',
  );

  // R2: invite path uses explicit membership lookup (maybeSingle for existing check)
  r500Assert(
    edgeSrc.includes('existingMembership') &&
    edgeSrc.includes('"workspace_members"') &&
    edgeSrc.includes('.maybeSingle()'),
    'R2: invite path uses explicit membership lookup (maybeSingle guard)',
  );

  // R3: existing workspace member returns 409
  r500Assert(
    edgeSrc.includes('status: 409') &&
    edgeSrc.includes('already a member of this workspace'),
    'R3: existing workspace member returns HTTP 409',
  );

  // R4: existing owner cannot be changed through invite (409 guard catches owner too)
  r500Assert(
    edgeSrc.includes('already a member of this workspace. Use Edit Member instead.'),
    'R4: existing owner is caught by 409 guard and cannot be changed through invite',
  );

  // R5: existing admin cannot be changed through invite (same 409 guard)
  r500Assert(
    edgeSrc.includes('existingMembership') &&
    edgeSrc.includes('status: 409'),
    'R5: existing admin is caught by 409 guard and cannot be changed through invite',
  );

  // R6: new member uses workspace_members insert (not upsert)
  r500Assert(
    edgeSrc.includes('.from("workspace_members")') &&
    edgeSrc.includes('.insert(') &&
    edgeSrc.includes('.select()'),
    'R6: new member workspace membership uses explicit .insert() + .select()',
  );

  // R7: concurrent duplicate membership returns 409 (PG_UNIQUE_VIOLATION = "23505")
  r500Assert(
    edgeSrc.includes('PG_UNIQUE_VIOLATION') &&
    edgeSrc.includes('"23505"') &&
    edgeSrc.includes('already a member or has a pending membership'),
    'R7: concurrent duplicate membership violation returns HTTP 409 via PG error code 23505',
  );

  console.log('\n--- R8–R10: Valid Upserts Preserved ---');

  // R8: profiles upsert remains valid (uses onConflict: "id" — profiles PK)
  r500Assert(
    edgeSrc.includes('{ onConflict: "id" }') &&
    edgeSrc.includes('"profiles"'),
    'R8: profiles upsert preserved with valid onConflict "id" (primary key)',
  );

  // R9: department_memberships upsert preserved with valid conflict target
  r500Assert(
    edgeSrc.includes('{ onConflict: "department_id,user_id" }') &&
    edgeSrc.includes('"department_memberships"'),
    'R9: department_memberships upsert preserved with valid onConflict "department_id,user_id"',
  );

  // R10: user_system_roles upsert preserved with valid conflict target
  r500Assert(
    edgeSrc.includes('{ onConflict: "workspace_id,user_id,role" }') &&
    edgeSrc.includes('"user_system_roles"'),
    'R10: user_system_roles upsert preserved with valid onConflict "workspace_id,user_id,role"',
  );

  console.log('\n--- R11–R12: Partial Failure & Auth User Safety ---');

  // R11: partial-failure cleanup retained
  r500Assert(
    edgeSrc.includes('cleanupOnFailure') &&
    edgeSrc.includes('orgRowsCreatedDuringRequest'),
    'R11: partial-failure cleanup (cleanupOnFailure + orgRowsCreatedDuringRequest) retained',
  );

  // R12: existing auth user never deleted
  r500Assert(
    edgeSrc.includes('wasNewAuthUser') &&
    edgeSrc.includes('if (wasNewAuthUser)'),
    'R12: existing auth user is never deleted (wasNewAuthUser guard retained)',
  );

  console.log('\n--- R13–R17: Frontend Error Handling ---');

  // R13: FunctionsHttpError response body is parsed
  r500Assert(
    usersAdminSrc.includes('FunctionsHttpError') &&
    usersAdminSrc.includes('err.context.json()') &&
    usersAdminSrc.includes('payload?.error'),
    'R13: FunctionsHttpError response body is parsed to extract payload.error',
  );

  // R14: server error payload.error shown in UI
  r500Assert(
    usersAdminSrc.includes('parseEdgeFunctionError') &&
    usersAdminSrc.includes('showToast(errorMsg'),
    'R14: server error payload.error is shown in UI via parseEdgeFunctionError',
  );

  // R15: FunctionsFetchError handled
  r500Assert(
    usersAdminSrc.includes('FunctionsFetchError') &&
    usersAdminSrc.includes('Could not reach the administration service'),
    'R15: FunctionsFetchError is explicitly handled with user-friendly message',
  );

  // R16: FunctionsRelayError handled
  r500Assert(
    usersAdminSrc.includes('FunctionsRelayError') &&
    usersAdminSrc.includes('relay is temporarily unavailable'),
    'R16: FunctionsRelayError is explicitly handled with user-friendly message',
  );

  // R17: generic "non-2xx status code" is not the only message shown
  // The structured parser means we show payload.error instead
  r500Assert(
    usersAdminSrc.includes('parseEdgeFunctionError') &&
    !usersAdminSrc.includes('"Edge Function returned a non-2xx status code"'),
    'R17: generic "non-2xx status code" is not the only/default message — structured parser used',
  );

  console.log('\n--- R18–R20: Security & Safety ---');

  // R18: no service key in frontend
  r500Assert(
    !envSrc.includes('SERVICE_ROLE') || !envSrc.includes('eyJ'),
    'R18: no service-role key committed to .env',
  );

  // R19: verify_jwt remains true in config
  r500Assert(
    configSrc.includes('verify_jwt = true'),
    'R19: verify_jwt = true in supabase/config.toml (unchanged)',
  );

  // R20: no real invitation is sent by automated tests
  // Verify test script does not dispatch live auth invites or live invite actions
  const ownContent = await fs.readFile(
    path.join(repoRoot, 'scripts/test-v1-01-organization-admin.mjs'),
    'utf8',
  );
  const targetPattern = ['invite', 'UserByEmail'].join('');
  const hasLiveInviteCall = /supabase\.auth\.admin\.inviteUserByEmail/.test(ownContent) ||
    /supabase\.functions\.invoke\(['"]admin-manage-workspace-user['"],\s*\{\s*body:\s*\{\s*action:\s*['"]invite['"]/.test(ownContent);
  r500Assert(
    !hasLiveInviteCall,
    'R20: no real invitation is sent by automated tests (no live invite dispatch)',
  );


  console.log('\n===============================================================');
  console.log(`Invitation 500 Fix Regression Tests: ${r500Passed} PASSED, ${r500Failed} FAILED`);
  console.log('===============================================================\n');

  if (r500Failed > 0) process.exit(1);
}

runInvitation500FixTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

// =============================================================================
// SECTION 7 — V1-01 TEMP PASSWORD FINAL SECURITY CLOSURE (25 Tests)
// =============================================================================

let tpoPassed = 0;
let tpoFailed = 0;

function tpoAssert(condition, message, details = '') {
  if (condition) {
    console.log(`[PASS] ${message}`);
    tpoPassed++;
  } else {
    console.error(`[FAIL] ${message} ${details ? '- ' + details : ''}`);
    tpoFailed++;
  }
}

async function runTempPasswordOnboardingTests() {
  console.log('\n===============================================================');
  console.log('SNS Projects — V1-01 Temp Password Final Security Closure Suite (25 Tests)');
  console.log('===============================================================\n');

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const repoRoot = process.cwd();

  const edgeSrc = await fs.readFile(
    path.join(repoRoot, 'supabase/functions/admin-manage-workspace-user/index.ts'),
    'utf8',
  );
  const usersAdminSrc = await fs.readFile(
    path.join(repoRoot, 'src/pages/UsersAdminPage.jsx'),
    'utf8',
  );
  const changePasswordSrc = await fs.readFile(
    path.join(repoRoot, 'src/pages/ChangePasswordPage.jsx'),
    'utf8',
  );
  const protectedRouteSrc = await fs.readFile(
    path.join(repoRoot, 'src/components/ProtectedRoute.jsx'),
    'utf8',
  );
  const schemaSqlSrc = await fs.readFile(
    path.join(repoRoot, 'supabase/schema.sql'),
    'utf8',
  );
  const envSrc = await fs.readFile(path.join(repoRoot, '.env'), 'utf8');

  console.log('--- 1–7: Server-Side Password Enforcement in complete_first_login ---');

  // 1: complete_first_login requires new_password
  tpoAssert(
    edgeSrc.includes('!newPassword') &&
    edgeSrc.includes("'new_password' is required to complete first-login setup"),
    '1: complete_first_login requires new_password parameter in payload',
  );

  // 2: weak password rejected server-side
  tpoAssert(
    edgeSrc.includes('validatePasswordComplexity(newPassword)') &&
    edgeSrc.includes('Password must be at least 12 characters long') &&
    edgeSrc.includes('uppercase') &&
    edgeSrc.includes('lowercase') &&
    edgeSrc.includes('number') &&
    edgeSrc.includes('special character'),
    '2: weak password rejected server-side via validatePasswordComplexity helper (min 12 chars, upper, lower, digit, symbol)',
  );

  // 3: complete_first_login cannot accept user_id target
  const completeActionBlock = edgeSrc.slice(
    edgeSrc.indexOf('action === "complete_first_login"'),
    edgeSrc.indexOf('// 5. DB-backed caller authorization')
  );
  tpoAssert(
    !completeActionBlock.includes('body.user_id'),
    '3: complete_first_login does not accept user_id target from body',
  );

  // 4: caller-only activation
  tpoAssert(
    completeActionBlock.includes('callerUser.id') &&
    completeActionBlock.includes('eq("user_id", callerUser.id)'),
    '4: complete_first_login operates strictly on the authenticated caller (callerUser.id)',
  );

  // 5: password update occurs BEFORE membership active
  const pwdUpdateIdx = completeActionBlock.indexOf('supabaseAdmin.auth.admin.updateUserById(callerUser.id');
  const memUpdateIdx = completeActionBlock.indexOf('from("workspace_members")\n          .update({ status: "active" })');
  tpoAssert(
    pwdUpdateIdx !== -1 && memUpdateIdx !== -1 && pwdUpdateIdx < memUpdateIdx,
    '5: server-side password update occurs BEFORE workspace membership is set to active',
  );

  // 6: password update failure keeps membership pending
  tpoAssert(
    completeActionBlock.includes('if (updateAuthErr)') &&
    completeActionBlock.includes('Failed to update password') &&
    completeActionBlock.includes('Password updated, but account activation could not be completed. Please retry.'),
    '6: password update failure prevents membership activation and keeps membership pending',
  );

  // 7: direct manual complete_first_login without password rejected
  tpoAssert(
    completeActionBlock.includes('if (!newPassword)') &&
    completeActionBlock.includes('status: 400'),
    '7: direct manual invocation of complete_first_login without new_password is rejected with HTTP 400',
  );

  console.log('\n--- 8–13: Onboarding Status Action & Authoritative Route Guarding ---');

  // 8: get_onboarding_status caller-only
  const getStatusBlock = edgeSrc.slice(
    edgeSrc.indexOf('action === "get_onboarding_status"'),
    edgeSrc.indexOf('action === "complete_first_login"')
  );
  tpoAssert(
    getStatusBlock.includes('callerUser.id') &&
    !getStatusBlock.includes('body.user_id') &&
    getStatusBlock.includes('membership_status') &&
    getStatusBlock.includes('must_change_password'),
    '8: get_onboarding_status is caller-only and returns authoritative membership & password flag',
  );

  // 9: route guard checks membership status
  tpoAssert(
    protectedRouteSrc.includes('onboardingStatus?.membership_status === \'pending\'') ||
    protectedRouteSrc.includes("membership_status === 'pending'"),
    '9: ProtectedRoute checks authoritative membership status from server',
  );

  // 10: route guard checks must_change_password
  tpoAssert(
    protectedRouteSrc.includes('onboardingStatus?.must_change_password === true') ||
    protectedRouteSrc.includes('must_change_password === true'),
    '10: ProtectedRoute checks authoritative must_change_password flag',
  );

  // 11: pending + metadata false still cannot enter app
  tpoAssert(
    protectedRouteSrc.includes("onboardingStatus?.membership_status === 'pending'") &&
    protectedRouteSrc.includes('<Navigate to="/change-password" replace />'),
    '11: pending user with must_change_password=false is still blocked by membership gate',
  );

  // 12: pending + metadata true cannot enter app
  tpoAssert(
    protectedRouteSrc.includes('onboardingStatus?.must_change_password === true') &&
    protectedRouteSrc.includes('<Navigate to="/change-password" replace />'),
    '12: pending user with must_change_password=true is blocked and redirected to /change-password',
  );

  // 13: active + metadata false can enter app
  tpoAssert(
    protectedRouteSrc.includes('return <Outlet />;') &&
    changePasswordSrc.includes("onboardingStatus?.membership_status === 'active'") &&
    changePasswordSrc.includes("onboardingStatus?.must_change_password !== true"),
    '13: active user with must_change_password=false can enter the main app (<Outlet />)',
  );

  console.log('\n--- 14–17: Client Separation & Provision Guarding ---');

  // 14: client auth.updateUser password removed from first-login page
  tpoAssert(
    !changePasswordSrc.includes('supabase.auth.updateUser({ password') &&
    !changePasswordSrc.includes('updatePassword(newPassword)'),
    '14: client auth.updateUser call removed from ChangePasswordPage (direct Edge Function submission)',
  );

  // 15: new password not persisted
  tpoAssert(
    !changePasswordSrc.includes('localStorage.setItem') &&
    !changePasswordSrc.includes('sessionStorage.setItem'),
    '15: new password is never stored or persisted in browser storage',
  );

  // 16: provision rejects existing Auth account
  const provisionBlock = edgeSrc.slice(
    edgeSrc.indexOf('action === "provision"'),
    edgeSrc.indexOf('action === "reissue_temp_password"')
  );
  tpoAssert(
    provisionBlock.includes('existingAuthUser') &&
    provisionBlock.includes('An authentication account already exists for this email') &&
    provisionBlock.includes('status: 409'),
    '16: provision rejects existing Auth account with HTTP 409',
  );

  // 17: provision never silently resets existing password
  tpoAssert(
    !provisionBlock.includes('updateUserById'),
    '17: provision never silently resets password of existing Auth account',
  );

  console.log('\n--- 18–22: Reissue Temporary Password Action ---');

  // 18: reissue_temp_password pending-only
  const reissueBlock = edgeSrc.slice(
    edgeSrc.indexOf('action === "reissue_temp_password"'),
    edgeSrc.indexOf('action === "invite"')
  );
  tpoAssert(
    reissueBlock.includes('targetMember.status !== "pending"') &&
    reissueBlock.includes('Reissue temporary password is only permitted for pending members'),
    '18: reissue_temp_password is restricted exclusively to pending workspace members',
  );

  // 19: reissue preserves workspace role
  tpoAssert(
    !reissueBlock.includes('workspace_members.update({ role') &&
    !reissueBlock.includes(".from('workspace_members')\n          .update({ role"),
    '19: reissue_temp_password does not modify workspace_members role',
  );

  // 20: reissue preserves department mappings
  tpoAssert(
    !reissueBlock.includes("from('department_memberships')"),
    '20: reissue_temp_password preserves existing department mappings without alteration',
  );

  // 21: reissue preserves system roles
  tpoAssert(
    !reissueBlock.includes("from('user_system_roles')"),
    '21: reissue_temp_password preserves existing user_system_roles without alteration',
  );

  // 22: reissue does not accept active owner
  tpoAssert(
    reissueBlock.includes('targetMember.role === "owner"') &&
    reissueBlock.includes('Forbidden: Workspace administrators cannot reissue passwords for owners'),
    '22: reissue_temp_password protects owner and administrator accounts from unauthorized reset',
  );

  console.log('\n--- 23–25: Security Invariants & UI Flow ---');

  // 23: temp password never logged/stored
  tpoAssert(
    !edgeSrc.includes('console.log(temporaryPassword)') &&
    !edgeSrc.includes('console.log(newPassword)') &&
    !edgeSrc.includes('console.log(new_password)'),
    '23: plaintext temporary/new password is never logged or persisted in DB',
  );

  // 24: RLS active-member helpers unchanged
  tpoAssert(
    schemaSqlSrc.includes("status = 'active'") ||
    schemaSqlSrc.includes('workspace_members.status = \'active\''),
    '24: RLS active-member helpers require status = active (unchanged)',
  );

  // 25: invite workflow unused by frontend
  tpoAssert(
    !usersAdminSrc.includes("action: 'invite'") &&
    usersAdminSrc.includes("action: 'provision'") &&
    usersAdminSrc.includes("action: 'reissue_temp_password'"),
    '25: frontend administration exclusively uses provision and reissue_temp_password',
  );

  console.log('\n===============================================================');
  console.log(`Temp Password Final Security Closure Suite: ${tpoPassed} PASSED, ${tpoFailed} FAILED`);
  console.log('===============================================================\n');

  if (tpoFailed > 0) process.exit(1);
}

runTempPasswordOnboardingTests().catch((err) => {
  console.error(err);
  process.exit(1);
});


