import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const surfacePairs = [
  ['Login', 'src/pages/LoginPage.jsx', 'src/pages/LoginPage.module.css'],
  ['Dashboard', 'src/pages/DashboardPage.jsx', 'src/pages/DashboardPage.module.css'],
  ['My Work', 'src/pages/MyWorkPage.jsx', 'src/pages/MyWorkPage.module.css'],
  ['Projects', 'src/pages/ProjectsPage.jsx', 'src/pages/ProjectsPage.module.css'],
  ['Tasks hierarchy', 'src/pages/TasksPage.jsx', 'src/pages/TasksPage.module.css'],
  ['Phase and Task List sections', 'src/pages/TasksPage.jsx', 'src/pages/TasksPage.module.css'],
  ['List', 'src/pages/TasksPage.jsx', 'src/pages/TasksPage.module.css'],
  ['Board', 'src/pages/TasksPage.jsx', 'src/pages/TasksPage.module.css'],
  ['Task Detail', 'src/components/TaskDetailPanel.jsx', 'src/components/TaskDetailPanel.module.css'],
  ['Subtasks', 'src/components/TaskDetailPanel.jsx', 'src/components/TaskDetailPanel.module.css'],
  ['RACI editor', 'src/components/TaskDetailPanel.jsx', 'src/components/TaskDetailPanel.module.css'],
  ['Process Catalog', 'src/pages/ProcessesPage.jsx', 'src/pages/ProcessesPage.module.css'],
  ['Process Builder', 'src/pages/ProcessBuilderPage.jsx', 'src/pages/ProcessBuilderPage.module.css'],
  ['Process Instance', 'src/pages/ProcessInstancePage.jsx', 'src/pages/ProcessInstancePage.module.css'],
  ['Departments', 'src/pages/DepartmentsPage.jsx', 'src/pages/DepartmentsPage.module.css'],
  ['Admin Users', 'src/pages/UsersAdminPage.jsx', 'src/pages/UsersAdminPage.module.css'],
  ['Admin Departments', 'src/pages/DepartmentsAdminPage.jsx', 'src/pages/DepartmentsAdminPage.module.css'],
  ['Workspace Settings', 'src/pages/WorkspaceSettingsPage.jsx', 'src/pages/WorkspaceSettingsPage.module.css'],
];

for (const [label, jsxPath, cssPath] of surfacePairs) {
  const [jsx, css] = await Promise.all([read(jsxPath), read(cssPath)]);
  assert.match(jsx, /\.module\.css['"];?/, `${label} must use its CSS Module.`);
  assert.match(css, /\.[A-Za-z_][\w-]*\s*[{,]/, `${label} CSS Module must contain selectors.`);
}

const [taskDetail, taskDetailCss, appLayoutCss, raciMatrixCss, usersAdminCss] = await Promise.all([
  read('src/components/TaskDetailPanel.jsx'),
  read('src/components/TaskDetailPanel.module.css'),
  read('src/components/AppLayout.module.css'),
  read('src/components/process-builder/RaciMatrix.module.css'),
  read('src/pages/UsersAdminPage.module.css'),
]);

const activeRaciClasses = [
  'raciRoleBlock',
  'raciRoleHeader',
  'raciRoleLabelWrap',
  'raciPill',
  'pillA',
  'pillR',
  'pillC',
  'pillI',
  'raciItemsList',
  'raciItemTag',
  'raciItemName',
  'removeRaciBtn',
  'raciEmpty',
  'addRaciForm',
];
for (const className of activeRaciClasses) {
  assert.match(taskDetail, new RegExp(`styles\\.${className}\\b`), `Task Detail must use ${className}.`);
  assert.match(taskDetailCss, new RegExp(`\\.${className}\\b`), `Task Detail CSS must define ${className}.`);
}

const obsoleteRaciClasses = [
  'raciBlock',
  'raciBlockHeader',
  'raciRoleMeta',
  'raciBadge',
  'badgeA',
  'badgeR',
  'badgeC',
  'badgeI',
  'tagGrid',
  'raciItemPill',
  'removeTagBtn',
  'raciEmptyWarning',
  'raciEmptyMuted',
  'addRaciBox',
];
for (const className of obsoleteRaciClasses) {
  assert.doesNotMatch(
    `${taskDetail}\n${taskDetailCss}`,
    new RegExp(`(?:styles\\.|\\.)${className}\\b`),
    `Obsolete RACI class ${className} must not remain active.`
  );
}

assert.match(taskDetailCss, /height:\s*100dvh/);
assert.match(taskDetailCss, /\.content\s*{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/);
assert.match(taskDetailCss, /\.header\s*{[\s\S]*?flex-shrink:\s*0;/);
assert.match(taskDetailCss, /\.footer\s*{[\s\S]*?flex-shrink:\s*0;/);
assert.match(taskDetailCss, /\.raciRoleHeader\s*{[\s\S]*?gap:\s*10px;[\s\S]*?flex-wrap:\s*wrap;/);
assert.match(taskDetailCss, /\.raciItemName\s*{[\s\S]*?text-overflow:\s*ellipsis;/);
assert.match(taskDetailCss, /\.removeRaciBtn\s*{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/);
assert.match(taskDetailCss, /\.addSubtaskForm\s*{[\s\S]*?flex-wrap:\s*wrap;/);
assert.match(taskDetailCss, /@media\s*\(max-width:\s*720px\)/);
assert.match(taskDetailCss, /@media\s*\(max-width:\s*420px\)/);
assert.match(taskDetailCss, /\.propertiesGrid\s*{\s*grid-template-columns:\s*1fr;/);
assert.match(taskDetail, /aria-label={`Remove \$\{/);

assert.match(appLayoutCss, /@media\s*\(max-width:\s*900px\)/);
assert.match(appLayoutCss, /\.contentContainer\s*{\s*padding:\s*20px 14px;/);
assert.match(raciMatrixCss, /overflow-x:\s*auto/);
assert.match(raciMatrixCss, /min-width:\s*900px/);
assert.match(usersAdminCss, /overflow-x:\s*auto/);

const verifier = await read('scripts/verify-css-module-contracts.mjs');
assert.ok(verifier.includes('escapedAlias}\\\\.([A-Za-z_$]'));
assert.ok(verifier.includes('escapedAlias}\\\\[\\\\s*'));
assert.ok(verifier.includes('([^\\\\\\`$]+)'));

console.log(
  `Operational V1 visual integrity static audit: PASS ` +
    `(${surfacePairs.length} critical surfaces + RACI/responsive/control contracts)`
);
