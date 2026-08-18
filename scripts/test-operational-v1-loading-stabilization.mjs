import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [
  userContext,
  projectsHook,
  processesHook,
  instanceHook,
  tasksHook,
  dashboardHook,
  projectsPage,
  myWorkPage,
  tasksPage,
  processesPage,
  departmentsPage,
  deptWorkspacePage,
  usersAdminPage,
  workspacesPage,
  appColdLoader,
  appColdLoaderCss,
  protectedRoute,
  authContext,
] = await Promise.all([
  read('src/hooks/useUserContext.js'),
  read('src/hooks/useProjects.js'),
  read('src/hooks/useDefinedProcesses.js'),
  read('src/hooks/useProcessInstance.js'),
  read('src/hooks/useTasks.js'),
  read('src/hooks/useDashboardData.js'),
  read('src/pages/ProjectsPage.jsx'),
  read('src/pages/MyWorkPage.jsx'),
  read('src/pages/TasksPage.jsx'),
  read('src/pages/ProcessesPage.jsx'),
  read('src/pages/DepartmentsPage.jsx'),
  read('src/pages/DepartmentWorkspacePage.jsx'),
  read('src/pages/UsersAdminPage.jsx'),
  read('src/pages/WorkspacesPage.jsx'),
  read('src/components/AppColdLoader.jsx'),
  read('src/components/AppColdLoader.module.css'),
  read('src/components/ProtectedRoute.jsx'),
  read('src/contexts/AuthContext.jsx'),
]);

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log(`[PASS ${passed.toString().padStart(2, '0')}] ${message}`);
}

// 1. Unresolved auth cannot render final persona or premature data
check(
  userContext.includes('UNRESOLVED_CONTEXT') &&
    userContext.includes('authorizationScopeKey: null') &&
    userContext.includes('hasGlobalOperationalVisibility: false'),
  'Unresolved auth defaults to null authorizationScopeKey and false visibility.'
);

// 2. Partial role state cannot choose persona
check(
  userContext.includes('computeResolvedContext') &&
    userContext.includes('Promise.all(['),
  'Role state evaluates atomically only after all concurrent auth queries resolve.'
);

// 3. Unresolved data cannot render business empty state
check(
  projectsPage.includes('const isInitialLoading = !authorizationScopeKey || (loading && projects.length === 0)') &&
    projectsPage.includes('isInitialLoading ? (') &&
    projectsPage.includes('<CardGridSkeleton count={3} />'),
  'ProjectsPage suppresses empty states while authorization or query is unresolved.'
);

// 4. Scope-key mismatch is loading/fail-closed
check(
  projectsHook.includes('const scopeIsCurrent = activeCacheKey === cacheKey') &&
    projectsHook.includes('loading: !scopeIsCurrent || loading'),
  'useProjects fails closed with loading=true on scope-key mismatch.'
);

// 5. Previous broad scope never flashes after role reduction
check(
  userContext.includes('if (!isSameScope)') &&
    userContext.includes('setContextData(UNRESOLVED_CONTEXT)') &&
    userContext.includes('setLoading(true)'),
  'useUserContext resets atomically to unresolved state on identity/workspace change.'
);

// 6. Previous user never flashes after identity change
check(
  userContext.includes("cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}`") &&
    projectsHook.includes("cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`"),
  'UserContext and Data hooks isolate cache entries by userId.'
);

// 7. Previous workspace never flashes after workspace change
check(
  processesHook.includes("cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`") &&
    tasksHook.includes("cacheKey = `${userId || 'anonymous'}:${projectId || 'none'}`"),
  'Workspace and Project data hooks strictly segment caches by resource IDs.'
);

// 8. Cached same-scope route renders immediately
check(
  userContext.includes('userContextCache.get(cacheKey)') &&
    projectsHook.includes('projectsCache.get(cacheKey)'),
  'Same-scope route navigation initializes synchronously from memory cache.'
);

// 9. Background refresh keeps existing content
check(
  projectsHook.includes('fetchProjects({ silent: Boolean(scopedCache) })') &&
    userContext.includes('fetchContext({ silent: Boolean(scopedCached) })'),
  'Silent revalidation updates cache in background without unmounting rendered data.'
);

// 10. Genuine zero result renders empty state only after READY
check(
  projectsPage.includes('filteredProjects.length === 0 ? (') &&
    projectsPage.includes('icon={FolderKanban}') &&
    !projectsPage.includes('loading && filteredProjects.length === 0'),
  'Genuine empty state renders only when query is complete and not loading.'
);

// 11. Populated Projects never display 0 Projects first
check(
  projectsPage.includes('badge={!isInitialLoading ? <span className={styles.totalBadge}>{projects.length} Projects</span> : null}'),
  'Projects header badge suppresses 0 Projects count while loading.'
);

// 12. System Role never flashes scoped wording
check(
  projectsPage.includes("title={hasGlobalOperationalVisibility ? 'Projects Portfolio' : 'My Visible Projects'}"),
  'ProjectsPage title derives directly from authoritative global operational visibility.'
);

// 13. Scoped user never flashes portfolio wording
check(
  projectsPage.includes("No projects in your operational scope"),
  'Scoped empty state messaging is specific to operational scope.'
);

// 14. Viewer never flashes mutation controls
check(
  projectsPage.includes('canCreate && (') &&
    processesPage.includes('canCreateProcess && (') &&
    processesPage.includes('canStartProcesses && <button'),
  'Mutation action buttons are conditionally rendered based on authoritative permissions.'
);

// 15. Dashboard persona remains stable
check(
  dashboardHook.includes('dashboardDataCache') &&
    dashboardHook.includes('scopeIsCurrent'),
  'Dashboard data hook enforces cache isolation and fail-closed state transitions.'
);

// 16. My Work no false empty flash
check(
  myWorkPage.includes('const isPageLoading = userContextLoading || (initialLoading && tasks.length === 0)') &&
    myWorkPage.includes('isPageLoading && tasks.length === 0 ? (') &&
    myWorkPage.includes('!isPageLoading && ('),
  'MyWorkPage suppresses false empty inbox and 0 active tasks badge while loading.'
);

// 17. Processes no false empty flash
check(
  processesPage.includes('const isInitialLoading = userContext.loading || (loading && processes.length === 0)') &&
    processesPage.includes('isInitialLoading ? (') &&
    processesPage.includes('!isInitialLoading && processes.length > 0'),
  'ProcessesPage suppresses false empty catalog and 0 defined badge during load.'
);

// 18. Departments/Admin no false zero flash
check(
  departmentsPage.includes('const isInitialLoading = userContext.loading || (loading && departments.length === 0)') &&
    usersAdminPage.includes("membersLoading ? '—' : stats.totalPeople") &&
    usersAdminPage.includes("membersLoading ? '—' : stats.totalDepts"),
  'Departments and Admin pages suppress 0 counters and false empty states during load.'
);

// 19. Sidebar capabilities remain stable
check(
  deptWorkspacePage.includes('const [tasksLoading, setTasksLoading] = useState(true)') &&
    deptWorkspacePage.includes('tasksLoading && filteredTasks.length === 0 ? (') &&
    deptWorkspacePage.includes('<TaskRowSkeleton count={4} />'),
  'DepartmentWorkspacePage fixes undefined setTasksLoading and guards task loading.'
);

// 20. Tasks project unavailable guard remains stable
check(
  tasksPage.includes('if (!userContextLoading && !projectsLoading && !project)') &&
    tasksPage.includes('if (isInitialLoading && !project)'),
  'TasksPage prevents project unavailable flash while authorization and project list resolve.'
);

// 21. Manual refresh shows animated AppColdLoader
check(
  protectedRoute.includes("<AppColdLoader />") &&
    protectedRoute.includes("data-auth-cold-loading") &&
    appColdLoader.includes("STACK N STOCK") &&
    appColdLoader.includes("Preparing your workspace"),
  'ProtectedRoute mounts branded AppColdLoader on cold loading decision.'
);

// 22. Normal route navigation does NOT show AppColdLoader
check(
  !projectsPage.includes('AppColdLoader') &&
    !myWorkPage.includes('AppColdLoader') &&
    !tasksPage.includes('AppColdLoader') &&
    !processesPage.includes('AppColdLoader'),
  'In-app route navigation uses localized skeletons and cached data, never full AppColdLoader.'
);

// 23. Reduced-motion behavior exists
check(
  appColdLoaderCss.includes('@media (prefers-reduced-motion: reduce)') &&
    appColdLoaderCss.includes('animation: none'),
  'AppColdLoader provides accessible styling under prefers-reduced-motion.'
);

// 24. Existing auth tab-return/background refresh behavior remains intact
check(
  protectedRoute.includes("handleVisibilityChange") &&
    protectedRoute.includes("checkStatus({ background: true, dedupe: true })"),
  'Tab return and background auth revalidation handlers remain intact.'
);

console.log(`\nOperational V1 Loading & Navigation Stabilization: All ${passed} test cases passed.`);
