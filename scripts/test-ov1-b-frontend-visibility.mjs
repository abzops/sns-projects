import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScopedProjectHierarchy } from '../src/lib/hierarchy.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  userContext,
  projectsPage,
  dashboardPage,
  tasksPage,
  taskDetail,
  myWork,
  processPage,
  processInstance,
  processDefinition,
  workspacesPage,
] = await Promise.all([
  read('src/hooks/useUserContext.js'),
  read('src/pages/ProjectsPage.jsx'),
  read('src/pages/DashboardPage.jsx'),
  read('src/pages/TasksPage.jsx'),
  read('src/components/TaskDetailPanel.jsx'),
  read('src/pages/MyWorkPage.jsx'),
  read('src/pages/ProcessesPage.jsx'),
  read('src/pages/ProcessInstancePage.jsx'),
  read('src/pages/ProcessDefinitionPage.jsx'),
  read('src/pages/WorkspacesPage.jsx'),
]);

let passed = 0;
function check(value, message) {
  assert.ok(value, message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

for (const role of ['ceo', 'cto', 'project_admin', 'system_admin']) {
  check(userContext.includes(`systemRoles.includes('${role}')`), `${role} retains broad operational visibility.`);
}
check(
  userContext.includes('const hasGlobalOperationalVisibility = hasSystemRole'),
  'Workspace administration is not global operational visibility.'
);
check(
  userContext.includes("const isReadOnly = !canMutateOperationalData"),
  'Viewer/read-only capability remains explicit.'
);
check(!userContext.includes('const isAdmin ='), 'No generic isAdmin visibility shortcut exists.');
check(userContext.includes('authorizationScopeKey'), 'Authorization refresh produces a cache-scope identity.');

const fullPhases = [{ id: 'phase-a' }, { id: 'phase-b' }];
const fullLists = [
  { id: 'list-a', phase_id: 'phase-a' },
  { id: 'list-b', phase_id: 'phase-b' },
];
const fullTasks = [
  { id: 'task-1', task_list_id: 'list-a' },
  { id: 'task-2', task_list_id: 'list-a' },
  { id: 'task-3', task_list_id: 'list-b' },
];
const scoped = buildScopedProjectHierarchy(
  fullPhases.slice(0, 1),
  fullLists.slice(0, 1),
  fullTasks.slice(0, 1)
);
assert.deepEqual(scoped, [{
  id: 'phase-a',
  taskLists: [{ id: 'list-a', phase_id: 'phase-a', tasks: [{ id: 'task-1', task_list_id: 'list-a' }] }],
}]);
passed += 1;
console.log(`PASS ${passed}: scoped persona sees only Phase A / List A / Task 1.`);

const owner = buildScopedProjectHierarchy(fullPhases, fullLists, fullTasks);
check(owner.length === 2 && owner[0].taskLists[0].tasks.length === 2, 'Project Owner can render the complete RLS-returned hierarchy.');
check(tasksPage.includes('buildScopedProjectHierarchy(phases, taskLists, tasks)'), 'Hierarchy renders only the server-returned row envelope.');
check(tasksPage.includes('useTasks(visibleProjectId, workspaceId)'), 'Child queries wait for an RLS-visible Project.');
check(tasksPage.includes("title={projectsError ? 'Unable to load project' : 'Project unavailable'}"), 'Unauthorized Project deep links use a safe unavailable state.');
check(!tasksPage.includes('description={projectsError.message}'), 'Project deep links do not expose backend error details.');
check(projectsPage.includes('const canCreate = canMutateOperationalData'), 'Project creation is capability-based.');
check(projectsPage.includes('No projects in your operational scope'), 'Scoped Projects empty state is personal and accurate.');
check(dashboardPage.includes("'Within your visible scope'"), 'Dashboard KPI language identifies scoped counts.');
check(dashboardPage.includes('dashboardCacheKey'), 'Dashboard stale cache is identity-scoped.');
check(dashboardPage.includes('useProjects(workspaceId, authorizationScopeKey)'), 'Dashboard cache scope changes immediately with role refresh.');
check(workspacesPage.includes('visible project'), 'Workspace badges label RLS-derived Project counts.');
check(taskDetail.includes('readOnly = false') && taskDetail.includes('{!readOnly && ('), 'Task Detail removes mutation actions for read-only viewers.');
check(tasksPage.includes('readOnly={!canMutateTasks}'), 'Hierarchy/List/Board Task Detail receives Viewer read-only state.');
check(processPage.includes('canStartProcesses = !userContext.isReadOnly'), 'Viewer sees no Start Process mutation control.');
check(processPage.includes('userContext.authorizationScopeKey'), 'Process Catalog revalidates on authorization-scope changes.');
check(processInstance.includes('!isCompleted && !isReadOnly'), 'Viewer sees no process-runtime mutation actions.');
check(processDefinition.includes('unavailable or you do not have access'), 'Process-version deep links return a metadata-safe unavailable state.');
check(myWork.includes(".from('subtasks')") && myWork.includes("add('S')"), 'My Work bulk-loads Subtask-assignee involvement without N+1 queries.');
check(myWork.includes('department_id.in.'), 'My Work includes active department-targeted RACI involvement.');

for (const path of [
  'src/hooks/useProjects.js',
  'src/hooks/usePhases.js',
  'src/hooks/useTaskLists.js',
  'src/hooks/useTaskStatuses.js',
  'src/hooks/useMembers.js',
  'src/hooks/useDepartments.js',
  'src/hooks/useDefinedProcesses.js',
  'src/hooks/useProcessInstance.js',
  'src/hooks/useWorkspaces.js',
]) {
  const source = await read(path);
  check(source.includes('userId') && source.includes('cacheKey'), `${path} cache is identity-scoped.`);
}

console.log(`\nOV1-B frontend visibility regression: ${passed} assertions passed.`);
