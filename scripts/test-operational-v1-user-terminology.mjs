import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function userFacingFragments(source) {
  const clean = stripComments(source);
  const fragments = [];
  const stringPattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  const jsxTextPattern = />([^<>{}\r\n]+)</g;
  let match;
  while ((match = stringPattern.exec(clean))) fragments.push(match[2]);
  while ((match = jsxTextPattern.exec(clean))) fragments.push(match[1]);
  return fragments;
}

const forbidden = /\b(?:Accountable|Responsible)\b/i;
const violations = [];
for (const file of await sourceFiles(path.join(root, 'src'))) {
  const source = await readFile(file, 'utf8');
  for (const fragment of userFacingFragments(source)) {
    if (forbidden.test(fragment)) {
      violations.push(`${path.relative(root, file)}: ${fragment.trim()}`);
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `1-2. User-facing terminology contains legacy labels:\n${violations.join('\n')}`
);

const [
  presentation,
  taskHook,
  processHook,
  taskDetail,
  taskPage,
  myWork,
  processDefinition,
  processMatrix,
  picker,
] = await Promise.all([
  import(pathToFileURL(path.join(root, 'src/utils/raciPresentation.js'))),
  read('src/hooks/useTasks.js'),
  read('src/hooks/useProcessInstance.js'),
  read('src/components/TaskDetailPanel.jsx'),
  read('src/pages/TasksPage.jsx'),
  read('src/pages/MyWorkPage.jsx'),
  read('src/components/process-builder/ProcessDefinitionWorkflow.jsx'),
  read('src/components/process-builder/RaciMatrix.jsx'),
  read('src/components/process-builder/RaciUserPicker.jsx'),
]);

assert.match(taskHook, /raci_role:\s*'A'/);
assert.match(taskHook, /raci_role:\s*'R'/);
assert.match(taskHook, /accountable_id/);
assert.match(taskHook, /responsible_id/);
assert.match(processHook, /complete_responsible_part/);
assert.match(processHook, /task_responsible_completions/);
assert.equal(presentation.RACI_ROLE_LABELS.A, 'Owner', '4. Owner maps to A.');
assert.equal(presentation.RACI_ROLE_LABELS.R, 'Assignee', '5. Assignee maps to R.');
assert.equal(presentation.RACI_ROLE_GROUP_LABELS.R, 'Assignees');

assert.match(processDefinition, /RACI_ROLE_GROUP_LABELS/);
assert.match(processDefinition, /Execution steps and assignments/);
assert.match(processMatrix, />Assignees</);
assert.match(processMatrix, />Owner</);
assert.match(picker, /<strong>Assignees \(R\):<\/strong>/);
assert.match(picker, /<strong>Owner \(A\):<\/strong>/);

assert.match(taskDetail, /Ownership & Assignments/);
assert.match(taskDetail, />Owner<\/span>/);
assert.match(taskDetail, />Assignees<\/span>/);
assert.match(taskPage, />Select Owner…<\/option>/);
assert.match(taskPage, />Select Assignee…<\/option>/);

assert.match(myWork, /<strong>Assigned to Me<\/strong>/);
assert.match(myWork, /<strong>I Own<\/strong>/);
assert.match(myWork, /<strong>Needs My Input<\/strong>/);
assert.match(myWork, /<strong>For My Info<\/strong>/);

console.log('Operational V1 user-facing terminology: PASS (9 required contracts)');
