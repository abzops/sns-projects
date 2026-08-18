import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getAuthAccessFingerprint,
  getProtectedRouteDecision,
  reconcileAuthUser,
} from '../src/lib/authGate.js';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const activeStatus = {
  must_change_password: false,
  membership_status: 'active',
};
const currentUser = {
  id: 'user-1',
  app_metadata: { provider: 'email', must_change_password: false, role: 'authenticated' },
  email: 'old@example.test',
};
const refreshedSameUser = {
  id: 'user-1',
  app_metadata: { role: 'authenticated', must_change_password: false, provider: 'email' },
  email: 'new@example.test',
};

assert.equal(
  getAuthAccessFingerprint(currentUser),
  getAuthAccessFingerprint(refreshedSameUser),
  'Access fingerprint must be stable across object/key-order churn.'
);
assert.strictEqual(
  reconcileAuthUser(currentUser, refreshedSameUser, 'TOKEN_REFRESHED'),
  currentUser,
  'Same-user TOKEN_REFRESHED must preserve the stable user reference.'
);

const changedAccessUser = {
  ...refreshedSameUser,
  app_metadata: { ...refreshedSameUser.app_metadata, must_change_password: true },
};
assert.strictEqual(
  reconcileAuthUser(currentUser, changedAccessUser, 'TOKEN_REFRESHED'),
  changedAccessUser,
  'A meaningful access claim change must propagate for revalidation.'
);

const allowDecision = getProtectedRouteDecision({
  authLoading: false,
  userId: 'user-1',
  mustChangePassword: false,
  resolvedUserId: 'user-1',
  onboardingStatus: activeStatus,
});
assert.equal(allowDecision, 'allow', 'A verified active session must keep content mounted.');
assert.equal(
  getProtectedRouteDecision({
    authLoading: true,
    userId: null,
    mustChangePassword: false,
    resolvedUserId: null,
    onboardingStatus: null,
  }),
  'cold-loading',
  'Unknown initial auth must remain fail-closed behind the cold gate.'
);
assert.equal(
  getProtectedRouteDecision({
    authLoading: false,
    userId: null,
    mustChangePassword: false,
    resolvedUserId: null,
    onboardingStatus: null,
  }),
  'login',
  'Sign-out/session expiry must redirect to login.'
);
assert.equal(
  getProtectedRouteDecision({
    authLoading: false,
    userId: 'user-1',
    mustChangePassword: true,
    resolvedUserId: 'user-1',
    onboardingStatus: activeStatus,
  }),
  'change-password',
  'must_change_password must redirect immediately.'
);
assert.equal(
  getProtectedRouteDecision({
    authLoading: false,
    userId: 'user-1',
    mustChangePassword: false,
    resolvedUserId: 'user-1',
    onboardingStatus: { membership_status: 'pending', must_change_password: false },
  }),
  'change-password',
  'Pending membership must remain blocked by onboarding.'
);
assert.equal(
  getProtectedRouteDecision({
    authLoading: false,
    userId: 'user-1',
    mustChangePassword: false,
    resolvedUserId: 'user-1',
    onboardingStatus: { membership_status: 'revoked', must_change_password: false },
  }),
  'access-denied',
  'Revoked membership must fail closed.'
);
assert.equal(
  getProtectedRouteDecision({
    authLoading: false,
    userId: 'user-2',
    mustChangePassword: false,
    resolvedUserId: 'user-1',
    onboardingStatus: activeStatus,
  }),
  'cold-loading',
  'A different signed-in identity must receive a fresh cold access gate.'
);

const [authContext, protectedRoute, tasksHook, myWork] = await Promise.all([
  read('src/contexts/AuthContext.jsx'),
  read('src/components/ProtectedRoute.jsx'),
  read('src/hooks/useTasks.js'),
  read('src/pages/MyWorkPage.jsx'),
]);

assert.match(authContext, /reconcileAuthUser\(currentUser, nextSession\?\.user \?\? null, event\)/);
assert.doesNotMatch(protectedRoute, /\}, \[user\]\);/);
assert.match(protectedRoute, /document\.addEventListener\('visibilitychange'/);
assert.match(protectedRoute, /checkStatus\(\{ background: true, dedupe: true \}\)/);
assert.match(protectedRoute, /<Outlet \/>/);
assert.match(protectedRoute, /data-auth-cold-loading/);
assert.match(protectedRoute, /memberRow\?\.status \|\| 'none'/);
assert.doesNotMatch(protectedRoute, /membership_status:\s*'active'\s*,?\s*\}\);\s*\}\s*catch/);

const taskFetchDependencies = tasksHook.match(/const fetchTasks = useCallback\([\s\S]*?\n    \[([^\]]+)\]\n  \);/)?.[1] || '';
assert.match(taskFetchDependencies, /projectId/);
assert.match(taskFetchDependencies, /userId/);
assert.doesNotMatch(taskFetchDependencies, /\buser\b|statuses|members|tasks\.length/);
assert.match(tasksHook, /await Promise\.all\(\[/);
assert.match(tasksHook, /taskSourceRef/);
assert.match(myWork, /\[cacheKey, departmentIds, userId, workspaceId\]/);
assert.doesNotMatch(myWork, /\[cacheKey, user, workspaceId\]/);

console.log('Operational V1 auth/performance regression: PASS (19 behavioral and source contracts)');
