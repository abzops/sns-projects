import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHierarchyModel, getPlacementProcesses } from '../src/lib/hierarchy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if (/\.(?:js|jsx|css)$/.test(entry.name)) files.push(target);
  }
  return files;
}

const tasks = [
  { id: 'host', title: 'Host', position: 1, parent_task_id: null },
  { id: 'child', title: 'Child', position: 2, parent_task_id: 'host' },
  {
    id: 'step-a',
    title: 'Process A step',
    position: 3,
    parent_task_id: 'host',
    process_instance_id: 'process-a',
    process_step_id: 'definition-step-a',
  },
  {
    id: 'step-b',
    title: 'Process B step',
    position: 4,
    parent_task_id: 'host',
    process_instance_id: 'process-b',
    process_step_id: 'definition-step-b',
  },
];

const processInstances = [
  { id: 'process-a', placement_type: 'task', parent_task_id: 'host', started_at: '2026-01-01' },
  { id: 'process-b', placement_type: 'task', parent_task_id: 'host', started_at: '2026-01-02' },
  { id: 'process-c', placement_type: 'task_list', task_list_id: 'list-1', started_at: '2026-01-03' },
];

const model = buildHierarchyModel(tasks, processInstances);
assert.deepEqual(model.rootTasks.map((task) => task.id), ['host']);
assert.deepEqual(model.ordinaryChildrenByParent.get('host').map((task) => task.id), ['child']);
assert.deepEqual(model.processesByHostTask.get('host').map((item) => item.id), ['process-a', 'process-b']);
assert.deepEqual(model.processStepsByInstance.get('process-a').map((task) => task.id), ['step-a']);
assert.deepEqual(model.processStepsByInstance.get('process-b').map((task) => task.id), ['step-b']);
assert.deepEqual(
  getPlacementProcesses(processInstances, 'task_list', 'list-1').map((item) => item.id),
  ['process-c']
);

const component = await read('src/components/HierarchyTaskTree.jsx');
assert.match(component, /className=\{styles\.otherGroupLabel\}>Other</);
assert.match(component, /onClick=\{\(\) => onTaskOpen\?\.\(task\)\}/);
assert.match(component, /aria-expanded=\{expanded\}/);
assert.match(component, /No visible process steps\./);

const tasksHook = await read('src/hooks/useTasks.js');
for (const field of ['parent_task_id', 'process_instance_id', 'process_step_id', 'workflow_state']) {
  assert.match(tasksHook, new RegExp(`\\b${field}\\b`), `useTasks must select ${field}`);
}
assert.match(tasksHook, /phases:phases!fk_tasks_phase/);
assert.match(tasksHook, /task_lists:task_lists!fk_tasks_task_list/);

const processHook = await read('src/hooks/useProjectProcessInstances.js');
assert.match(processHook, /process_instances_defined_process_id_fkey/);
assert.match(processHook, /process_instances_defined_process_version_id_fkey/);
assert.match(processHook, /get_process_instance_progress/);

const tasksPage = await read('src/pages/TasksPage.jsx');
assert.match(tasksPage, /<HierarchyTaskTree/);
assert.match(tasksPage, /<HierarchyProcessGroups/);
assert.match(tasksPage, /view === 'kanban'/);
assert.match(tasksPage, /view === 'list'/);
assert.match(tasksPage, /<TaskDetailPanel/);

const activeSource = await sourceFiles(path.join(root, 'src'));
const terminologyViolations = [];
for (const file of activeSource) {
  const contents = await readFile(file, 'utf8');
  if (/milestone/i.test(contents)) terminologyViolations.push(path.relative(root, file));
}
assert.deepEqual(
  terminologyViolations,
  [],
  `Active frontend still contains Milestone terminology: ${terminologyViolations.join(', ')}`
);

console.log('P3-01 hierarchy UI regression: PASS');
console.log('P3-01 active Milestone terminology verifier: PASS (0 matches)');
