import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');

const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

async function collectSourceFiles(directory, result = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(fullPath, result);
    else if (/\.(?:js|jsx)$/.test(entry.name)) result.push(fullPath);
  }
  return result;
}

const [
  app,
  workspaces,
  projects,
  departments,
  departmentsAdmin,
  processes,
  usersAdmin,
  tasks,
  taskDetail,
  notifications,
] = await Promise.all([
  read('src/App.jsx'),
  read('src/pages/WorkspacesPage.jsx'),
  read('src/pages/ProjectsPage.jsx'),
  read('src/pages/DepartmentsPage.jsx'),
  read('src/pages/DepartmentsAdminPage.jsx'),
  read('src/pages/ProcessesPage.jsx'),
  read('src/pages/UsersAdminPage.jsx'),
  read('src/pages/TasksPage.jsx'),
  read('src/components/TaskDetailPanel.jsx'),
  read('src/components/NotificationBell.jsx'),
]);

const requiredRoutes = [
  '/login',
  '/change-password',
  '/workspace/:workspaceId/dashboard',
  '/workspace/:workspaceId/my-work',
  '/workspace/:workspaceId/projects',
  '/workspace/:workspaceId/processes',
  '/workspace/:workspaceId/processes/:processId/builder',
  '/workspace/:workspaceId/project/:projectId',
  '/workspace/:workspaceId/project/:projectId/process/:taskListId',
  '/workspace/:workspaceId/departments',
  '/workspace/:workspaceId/department/:departmentId',
  '/workspace/:workspaceId/admin/users',
  '/workspace/:workspaceId/admin/departments',
  '/workspace/:workspaceId/settings',
];

for (const route of requiredRoutes) {
  assert.ok(app.includes(`path="${route}"`), `Missing operational route: ${route}`);
}

assert.doesNotMatch(departmentsAdmin, /href=\{?`?#\/workspace\//);
assert.match(departmentsAdmin, /to=\{`\/workspace\/\$\{department\.workspace_id\}\/admin\/users`\}/);

assert.match(workspaces, /const \{ data, error: createError \} = await createWorkspace/);
assert.match(workspaces, /if \(createError\) throw createError/);
assert.match(workspaces, /title="Unable to load workspaces"/);

assert.match(projects, /const \{ error: createError \} = await createProject/);
assert.match(projects, /if \(createError\) throw createError/);
assert.match(projects, /title="Unable to load projects"/);
assert.match(departments, /title="Unable to load departments"/);
assert.match(processes, /title="Unable to load defined processes"/);

assert.match(usersAdmin, /const \{ error: removeError \} = await removeMember/);
assert.match(usersAdmin, /if \(removeError\)/);
assert.match(tasks, /const \{ error: deleteError \} = await deleteTask/);
assert.match(tasks, /if \(deleteError\)/);

const taskDeleteHandler = taskDetail.match(/const handleDelete = \(\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
assert.ok(taskDeleteHandler.includes('onDelete?.(task.id)'));
assert.ok(!taskDeleteHandler.includes('onClose?.()'));
assert.match(taskDetail, /Failed to update Accountable assignment/);
assert.match(taskDetail, /Failed to add RACI assignment/);

assert.match(notifications, /Failed to open notification/);
assert.match(notifications, /Failed to mark notifications as read/);
assert.match(notifications, /await markAsRead\(notif\.id\)/);

const sourceFiles = await collectSourceFiles(sourceRoot);
const milestoneViolations = [];
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8');
  if (/milestone/i.test(content)) milestoneViolations.push(path.relative(root, file));
}
assert.deepEqual(milestoneViolations, [], `Active Milestone terminology found in: ${milestoneViolations.join(', ')}`);

console.log(`Operational V1 stability regression: PASS (${requiredRoutes.length} routes + 16 failure-state contracts)`);
console.log('Operational V1 active Milestone terminology: PASS (0 matches)');
