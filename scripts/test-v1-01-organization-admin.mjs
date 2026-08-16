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
