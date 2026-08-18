import fs from 'node:fs';
import path from 'node:path';

let failedTests = 0;
let passedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ ${message}`);
    failedTests++;
  }
}

console.log('============================================================');
console.log('RUNNING NAVIGATION & LOADING UX AUDIT SUITE');
console.log('============================================================\n');

const rootDir = process.cwd();

// Test 1: Verify Skeleton component existence and exports
console.log('[Test 1] Verifying Skeleton component suite');
const skeletonJsxPath = path.join(rootDir, 'src', 'components', 'Skeleton.jsx');
const skeletonCssPath = path.join(rootDir, 'src', 'components', 'Skeleton.module.css');

assert(fs.existsSync(skeletonJsxPath), 'src/components/Skeleton.jsx exists');
assert(fs.existsSync(skeletonCssPath), 'src/components/Skeleton.module.css exists');

const skeletonJsx = fs.readFileSync(skeletonJsxPath, 'utf8');
assert(skeletonJsx.includes('TaskRowSkeleton'), 'Skeleton.jsx exports TaskRowSkeleton');
assert(skeletonJsx.includes('CardGridSkeleton'), 'Skeleton.jsx exports CardGridSkeleton');
assert(skeletonJsx.includes('MetricCardsSkeleton'), 'Skeleton.jsx exports MetricCardsSkeleton');

// Test 2: Audit MyWorkPage.jsx for SWR cache, parallel queries, and non-blocking layout
console.log('\n[Test 2] Auditing MyWorkPage.jsx');
const myWorkPagePath = path.join(rootDir, 'src', 'pages', 'MyWorkPage.jsx');
const myWorkJsx = fs.readFileSync(myWorkPagePath, 'utf8');

assert(myWorkJsx.includes('myWorkCache = new Map()'), 'MyWorkPage has in-memory session cache');
assert(myWorkJsx.includes('Promise.all(['), 'MyWorkPage uses Promise.all for parallel query batching');
assert(!myWorkJsx.includes('if (loading) {\n    return (\n      <div className={styles.loadingContainer}>'), 'MyWorkPage removed full-page blocking spinner');
assert(myWorkJsx.includes('<PageHeader'), 'MyWorkPage always renders PageHeader unconditionally');
assert(myWorkJsx.includes('TaskRowSkeleton'), 'MyWorkPage renders TaskRowSkeleton for initial loading');
assert(myWorkJsx.includes('refreshingPill') || myWorkJsx.includes('refreshing'), 'MyWorkPage includes silent background refreshing state');
assert(myWorkJsx.includes('useMemo(() => {') && myWorkJsx.includes('activeTab !== \'all\''), 'MyWorkPage filters tabs in-memory with useMemo');

// Test 3: Audit DashboardPage.jsx for non-blocking layout and cache
console.log('\n[Test 3] Auditing DashboardPage.jsx');
const dashboardPagePath = path.join(rootDir, 'src', 'pages', 'DashboardPage.jsx');
const dashboardJsx = fs.readFileSync(dashboardPagePath, 'utf8');

assert(dashboardJsx.includes('dashboardTasksCache = new Map()'), 'DashboardPage has in-memory tasks cache');
assert(!dashboardJsx.includes('if (projectsLoading || tasksLoading) {\n    return (\n      <div className={styles.loadingContainer}>'), 'DashboardPage removed full-page blocking spinner');
assert(dashboardJsx.includes('<PageHeader'), 'DashboardPage renders PageHeader immediately');
assert(dashboardJsx.includes('MetricCardsSkeleton'), 'DashboardPage renders MetricCardsSkeleton on initial load');

// Test 4: Audit ProjectsPage.jsx
console.log('\n[Test 4] Auditing ProjectsPage.jsx');
const projectsPagePath = path.join(rootDir, 'src', 'pages', 'ProjectsPage.jsx');
const projectsJsx = fs.readFileSync(projectsPagePath, 'utf8');

assert(!projectsJsx.includes('if (loading) {\n    return (\n      <div className={styles.loadingContainer}>'), 'ProjectsPage removed full-page blocking spinner');
assert(projectsJsx.includes('CardGridSkeleton'), 'ProjectsPage renders CardGridSkeleton on initial load');

// Test 5: Audit DepartmentsPage.jsx & DepartmentWorkspacePage.jsx
console.log('\n[Test 5] Auditing DepartmentsPage and DepartmentWorkspacePage');
const deptPagePath = path.join(rootDir, 'src', 'pages', 'DepartmentsPage.jsx');
const deptJsx = fs.readFileSync(deptPagePath, 'utf8');
assert(!deptJsx.includes('if (loading) {\n    return (\n      <div className={styles.loadingContainer}>'), 'DepartmentsPage removed full-page blocking spinner');
assert(deptJsx.includes('CardGridSkeleton'), 'DepartmentsPage renders CardGridSkeleton');

const deptWsPagePath = path.join(rootDir, 'src', 'pages', 'DepartmentWorkspacePage.jsx');
const deptWsJsx = fs.readFileSync(deptWsPagePath, 'utf8');
assert(!deptWsJsx.includes('if (deptLoading || membersLoading) {\n    return (\n      <div className={styles.loadingContainer}>'), 'DepartmentWorkspacePage removed full-page blocking spinner');

// Test 6: Audit UsersAdminPage.jsx & WorkspaceSettingsPage.jsx
console.log('\n[Test 6] Auditing UsersAdminPage and WorkspaceSettingsPage');
const usersAdminPath = path.join(rootDir, 'src', 'pages', 'UsersAdminPage.jsx');
const usersAdminJsx = fs.readFileSync(usersAdminPath, 'utf8');
assert(!usersAdminJsx.includes('if (membersLoading || rolesLoading) {\n    return (\n      <div className={styles.loadingContainer}>'), 'UsersAdminPage removed full-page blocking spinner');
assert(usersAdminJsx.includes('TaskRowSkeleton'), 'UsersAdminPage renders TaskRowSkeleton');

const wsSettingsPath = path.join(rootDir, 'src', 'pages', 'WorkspaceSettingsPage.jsx');
const wsSettingsJsx = fs.readFileSync(wsSettingsPath, 'utf8');
assert(!wsSettingsJsx.includes('if (workspacesLoading) {\n    return (\n      <div className={styles.loadingContainer}>'), 'WorkspaceSettingsPage removed full-page blocking spinner');

// Test 7: Audit TasksPage.jsx
console.log('\n[Test 7] Auditing TasksPage.jsx');
const tasksPagePath = path.join(rootDir, 'src', 'pages', 'TasksPage.jsx');
const tasksPageJsx = fs.readFileSync(tasksPagePath, 'utf8');
assert(!tasksPageJsx.includes('if (isInitialLoading) {\n    return (\n      <div className={styles.loadingState}>'), 'TasksPage removed full-page blocking spinner');
assert(tasksPageJsx.includes('TaskRowSkeleton'), 'TasksPage renders TaskRowSkeleton during initial load');

// Test 8: Audit Hook Caches
console.log('\n[Test 8] Auditing Hook In-Memory Caches');
const useProjectsPath = path.join(rootDir, 'src', 'hooks', 'useProjects.js');
const useProjectsJs = fs.readFileSync(useProjectsPath, 'utf8');
assert(useProjectsJs.includes('projectsCache'), 'useProjects hook has module-level session cache');

const useDepartmentsPath = path.join(rootDir, 'src', 'hooks', 'useDepartments.js');
const useDepartmentsJs = fs.readFileSync(useDepartmentsPath, 'utf8');
assert(useDepartmentsJs.includes('departmentsCache'), 'useDepartments hook has module-level session cache');

const useMembersPath = path.join(rootDir, 'src', 'hooks', 'useMembers.js');
const useMembersJs = fs.readFileSync(useMembersPath, 'utf8');
assert(useMembersJs.includes('membersCache'), 'useMembers hook has module-level session cache');

const useTaskStatusesPath = path.join(rootDir, 'src', 'hooks', 'useTaskStatuses.js');
const useTaskStatusesJs = fs.readFileSync(useTaskStatusesPath, 'utf8');
assert(useTaskStatusesJs.includes('taskStatusesCache'), 'useTaskStatuses hook has module-level session cache');

const usePhasesPath = path.join(rootDir, 'src', 'hooks', 'usePhases.js');
const usePhasesJs = fs.readFileSync(usePhasesPath, 'utf8');
assert(usePhasesJs.includes('phasesCache'), 'usePhases hook has module-level session cache');

const useTaskListsPath = path.join(rootDir, 'src', 'hooks', 'useTaskLists.js');
const useTaskListsJs = fs.readFileSync(useTaskListsPath, 'utf8');
assert(useTaskListsJs.includes('taskListsCache'), 'useTaskLists hook has module-level session cache');

// Test 9: BrowserRouter navigation must not use hash-only internal URLs
console.log('\n[Test 9] Auditing internal navigation compatibility');
const departmentsAdminPath = path.join(rootDir, 'src', 'pages', 'DepartmentsAdminPage.jsx');
const departmentsAdminJsx = fs.readFileSync(departmentsAdminPath, 'utf8');
assert(!departmentsAdminJsx.includes('href={`#/workspace/'), 'Department Personnel link avoids hash routing under BrowserRouter');
assert(departmentsAdminJsx.includes('to={`/workspace/${department.workspace_id}/admin/users`}'), 'Department Personnel link uses React Router navigation');

console.log('\n============================================================');
console.log(`SUMMARY: ${passedTests} passed, ${failedTests} failed`);
console.log('============================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('ALL NAVIGATION & LOADING UX CONTRACTS PASSED!\n');
  process.exit(0);
}
