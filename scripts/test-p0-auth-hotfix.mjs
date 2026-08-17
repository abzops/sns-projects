import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('SNS Projects — P0 Auth Password Change Hotfix Verification');
  console.log('===============================================================\n');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: SOURCE CODE CONTRACT VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════
  console.log('--- Section 1: ChangePasswordPage Source Code Contracts ---');

  const cpSrc = await readFile(path.join(repoRoot, 'src/pages/ChangePasswordPage.jsx'), 'utf8');
  const prSrc = await readFile(path.join(repoRoot, 'src/components/ProtectedRoute.jsx'), 'utf8');
  const authSrc = await readFile(path.join(repoRoot, 'src/contexts/AuthContext.jsx'), 'utf8');

  // Test 1: No refreshSession() call in handleSubmit (comments don't count)
  const handleSubmitSection = cpSrc.slice(cpSrc.indexOf('handleSubmit'));
  const handleSubmitCode = handleSubmitSection.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert(!handleSubmitCode.includes('refreshSession()') && !handleSubmitCode.includes('await refreshSession'),
    'Test 1: refreshSession() is NOT called after complete_first_login.');

  // Test 2: signInWithPassword is used after Edge Function success
  assert(cpSrc.includes('supabase.auth.signInWithPassword'),
    'Test 2: signInWithPassword is used to obtain fresh session after password change.');

  // Test 3: Email is captured BEFORE Edge Function call
  assert(cpSrc.includes('authenticatedEmail = user?.email') || cpSrc.includes("authenticatedEmail = user?.email"),
    'Test 3: Authenticated email is captured from current session before Edge Function call.');

  // Test 4: signInWithPassword uses captured email and newPassword
  assert(cpSrc.includes('email: authenticatedEmail') && cpSrc.includes('password: newPassword'),
    'Test 4: Fresh signIn uses captured authenticatedEmail and newPassword.');

  // Test 5: Fallback path shows success message, not failure
  assert(cpSrc.includes('Password changed successfully. Please sign in with your new password.'),
    'Test 5: Fallback path (re-login failure) shows password changed SUCCESS message.');

  // Test 6: No false failure message in fallback
  assert(!cpSrc.includes('password reset failed') && !cpSrc.includes('Password change failed'),
    'Test 6: No false "password change failed" message in fallback path.');

  // Test 7: Button disabled while submitting
  assert(cpSrc.includes('disabled={!checks.allRequirementsMet || submitting}'),
    'Test 7: Submit button is disabled during submission to prevent duplicates.');

  // Test 8: passwordChangeInProgress state exists
  assert(cpSrc.includes('passwordChangeInProgress') && cpSrc.includes('setPasswordChangeInProgress'),
    'Test 8: passwordChangeInProgress state is implemented to prevent race conditions.');

  // Test 9: useEffect guards against passwordChangeInProgress
  assert(cpSrc.includes('passwordChangeInProgress') && cpSrc.includes('!user || passwordChangeInProgress'),
    'Test 9: Onboarding status useEffect is guarded by passwordChangeInProgress flag.');

  // Test 10: refreshSession not destructured from useAuth
  const useAuthLine = cpSrc.split('\n').find(l => l.includes('useAuth()'));
  assert(useAuthLine && !useAuthLine.includes('refreshSession'),
    'Test 10: refreshSession is NOT destructured from useAuth in ChangePasswordPage.');

  // Test 11: complete_first_login is invoked exactly once (single call site)
  const firstLoginMatches = cpSrc.match(/action:\s*'complete_first_login'/g);
  assert(firstLoginMatches && firstLoginMatches.length === 1,
    'Test 11: complete_first_login action is invoked in exactly ONE code path.');

  // Test 12: Local signOut on re-login failure
  assert(cpSrc.includes("signOut({ scope: 'local' })"),
    'Test 12: Local-scoped signOut is used on re-login failure to clear stale auth state.');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: CASE SEPARATION VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 2: Case Separation (Server Failure vs Re-Auth Failure) ---');

  // Test 13: CASE 1 - Edge Function failure shows error
  assert(cpSrc.includes('Password change could not be completed. Please retry.'),
    'Test 13: CASE 1 (Edge Function failure) shows appropriate error message.');

  // Test 14: CASE 2 - Re-auth failure redirects to login
  assert(cpSrc.includes("navigate('/login', { replace: true })"),
    'Test 14: CASE 2 (re-auth failure) redirects to /login.');

  // Test 15: CASE 2 - Re-auth failure shows success toast
  const case2Start = cpSrc.indexOf('Password change SUCCEEDED on server');
  const case2End = cpSrc.indexOf('} catch (err)', case2Start);
  const case2Section = cpSrc.slice(case2Start, case2End);
  assert(case2Section.includes("'success'"),
    'Test 15: CASE 2 fallback shows success toast (not error) when re-login fails.');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: PROTECTEDROUTE & AUTH CONTEXT INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 3: ProtectedRoute & AuthContext ---');

  // Test 16: ProtectedRoute still redirects to /change-password when must_change_password
  assert(prSrc.includes("Navigate to=\"/change-password\""),
    'Test 16: ProtectedRoute still redirects to /change-password for pending users.');

  // Test 17: ProtectedRoute checks must_change_password
  assert(prSrc.includes('must_change_password'),
    'Test 17: ProtectedRoute evaluates must_change_password in its gate.');

  // Test 18: /change-password route is NOT inside ProtectedRoute
  const appSrc = await readFile(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const changePasswordRouteIndex = appSrc.indexOf('/change-password');
  const protectedRouteIndex = appSrc.indexOf('element={<ProtectedRoute');
  assert(changePasswordRouteIndex < protectedRouteIndex,
    'Test 18: /change-password route is defined BEFORE ProtectedRoute (not nested inside it).');

  // Test 19: AuthContext still has signInWithPassword
  assert(authSrc.includes('signInWithPassword'),
    'Test 19: AuthContext signIn still uses signInWithPassword.');

  // Test 20: Edge Function contract unchanged (verify_jwt=true)
  const configSrc = await readFile(path.join(repoRoot, 'supabase/config.toml'), 'utf8');
  assert(configSrc.includes('admin-manage-workspace-user') && configSrc.includes('verify_jwt = true'),
    'Test 20: admin-manage-workspace-user Edge Function maintains verify_jwt = true.');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: ADMIN UI — REISSUE PASSWORD ELIGIBILITY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 4: Admin UI — Reissue Password Eligibility ---');

  const adminSrc = await readFile(path.join(repoRoot, 'src/pages/UsersAdminPage.jsx'), 'utf8');

  // Test 21: Status badge uses member.status === 'active' (authoritative workspace_members.status)
  assert(adminSrc.includes("member.status === 'active'") && adminSrc.includes('Active'),
    'Test 21: Status badge is driven by authoritative workspace_members.status.');

  // Test 22: PASSWORD SETUP REQUIRED badge shown for non-active members
  assert(adminSrc.includes('PASSWORD SETUP REQUIRED'),
    'Test 22: PASSWORD SETUP REQUIRED badge is rendered for pending members.');

  // Test 23: Reissue Password button visible ONLY when member.status === 'pending'
  assert(adminSrc.includes("member.status === 'pending'") && adminSrc.includes('Reissue Password'),
    'Test 23: Reissue Password button visibility is gated on member.status === pending.');

  // Test 24: Reissue Password button is NOT shown for active members (no separate active check needed — the pending gate handles it)
  const reissueGateMatch = adminSrc.match(/canAdminUsers\s*&&\s*member\.status\s*===\s*'pending'/);
  assert(reissueGateMatch !== null,
    'Test 24: Reissue Password button requires both admin authority AND pending status.');

  // Test 25: After reissue, refetchMembers() is called to refresh authoritative state
  const reissueHandler = adminSrc.slice(adminSrc.indexOf('handleReissueTempPassword'));
  assert(reissueHandler.includes('refetchMembers()'),
    'Test 25: handleReissueTempPassword calls refetchMembers() after success.');

  // Test 26: Credentials modal shows context-appropriate title for reissue
  assert(adminSrc.includes("isReissue ? 'Temporary Password Reissued'"),
    'Test 26: Credentials modal title is context-aware (reissue vs provision).');

  // Test 27: Reissue credentials include "replaces all previously issued" messaging
  assert(adminSrc.includes('replaces all previously issued temporary passwords'),
    'Test 27: Reissue credentials modal states that new password replaces all previous ones.');

  // Test 28: Temporary password is copyable (copy button exists)
  assert(adminSrc.includes('navigator.clipboard.writeText(createdUserCredentials.temporaryPassword)'),
    'Test 28: Temporary password has a copy-to-clipboard button.');

  // Test 29: Reissue sets isReissue flag on credentials state
  const reissueSection = adminSrc.slice(adminSrc.indexOf('reissue_temp_password'), adminSrc.indexOf('refetchMembers', adminSrc.indexOf('reissue_temp_password')));
  assert(reissueSection.includes('isReissue: true'),
    'Test 29: Reissue password handler sets isReissue flag on credentials state.');

  // Test 30: Temporary password is never stored/logged (no console.log of password)
  assert(!adminSrc.includes('console.log') || !adminSrc.match(/console\.log.*temporaryPassword/),
    'Test 30: Temporary password is never logged to console.');

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n===============================================================`);
  console.log(`P0 HOTFIX TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

runTests();
