import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHierarchyModel, getTaskDescendants } from '../src/lib/hierarchy.js';

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

const subtask = (id, status = 'todo', position = 0) => ({
  id,
  task_id: id.split('-subtask')[0],
  title: id,
  status,
  position,
});

const tasks = [
  { id: 'subtasks-only', title: 'Subtasks only', position: 1, subtasks: [subtask('subtasks-only-subtask')] },
  { id: 'leaf', title: 'Leaf', position: 2, subtasks: [] },
  { id: 'subtasks-process', title: 'Subtasks and Process', position: 3, subtasks: [subtask('subtasks-process-subtask')] },
  { id: 'subtasks-children', title: 'Subtasks and Child Tasks', position: 4, subtasks: [subtask('subtasks-children-subtask')] },
  { id: 'child-one', title: 'Child one', position: 5, parent_task_id: 'subtasks-children', subtasks: [] },
  {
    id: 'all-three',
    title: 'All descendants',
    position: 6,
    subtasks: [
      subtask('all-three-subtask-done', 'done', 2),
      subtask('all-three-subtask-cancelled', 'cancelled', 1),
    ],
  },
  { id: 'child-two', title: 'Child two', position: 7, parent_task_id: 'all-three', subtasks: [] },
];

const processInstances = [
  { id: 'process-one', placement_type: 'task', parent_task_id: 'subtasks-process', started_at: '2026-01-01' },
  { id: 'process-two', placement_type: 'task', parent_task_id: 'all-three', started_at: '2026-01-02' },
];

const model = buildHierarchyModel(tasks, processInstances);

// 1. Task with only Subtasks gets a descendant chevron contract.
const subtasksOnly = getTaskDescendants('subtasks-only', model);
assert.equal(subtasksOnly.hasDescendants, true);
assert.deepEqual(subtasksOnly.groupOrder, ['subtasks']);

// 2. Task with no descendants gets no chevron contract.
assert.equal(getTaskDescendants('leaf', model).hasDescendants, false);

// 3. Subtasks render under the correct Task and preserve position ordering.
assert.deepEqual(model.subtasksByTaskId.get('subtasks-only').map((item) => item.id), ['subtasks-only-subtask']);
assert.deepEqual(
  model.subtasksByTaskId.get('all-three').map((item) => item.id),
  ['all-three-subtask-cancelled', 'all-three-subtask-done']
);

// 4. Subtasks are a separate entity group, never ordinary Child Tasks.
assert.equal(model.ordinaryChildrenByParent.get('subtasks-only'), undefined);
assert.equal(model.rootTasks.some((task) => task.id === 'subtasks-only-subtask'), false);

// 5. Subtasks + Process renders both groups.
assert.deepEqual(getTaskDescendants('subtasks-process', model).groupOrder, ['subtasks', 'processes']);

// 6. Subtasks + Child Tasks renders both groups.
assert.deepEqual(getTaskDescendants('subtasks-children', model).groupOrder, ['subtasks', 'child_tasks']);

// 7. All three descendant types use a deterministic order.
assert.deepEqual(getTaskDescendants('all-three', model).groupOrder, [
  'subtasks',
  'processes',
  'child_tasks',
]);

// 8. Cancelled Subtasks remain visible, distinct, and excluded from completion denominators.
assert.equal(model.subtasksByTaskId.get('all-three')[0].status, 'cancelled');
const taskHook = await read('src/hooks/useTasks.js');
assert.match(taskHook, /s\.items\.push\(st\);\s+if \(st\.status !== 'cancelled'\)/);
assert.match(taskHook, /assignee:profiles!subtasks_assignee_id_fkey/);
assert.match(taskHook, /\.from\('subtasks'\)[\s\S]*?\.in\('task_id', taskIds\)/);

const tree = await read('src/components/HierarchyTaskTree.jsx');
assert.match(tree, /hasDescendants \?/);
assert.match(tree, /<span>Subtasks<\/span>/);
assert.match(tree, /<span>Processes<\/span>/);
assert.match(tree, />Child Tasks<\/div>/);
assert.match(tree, /case 'cancelled':[\s\S]*?label: 'Cancelled'/);
assert.match(tree, /subtask\.assignee\?\.full_name/);
assert.match(tree, /subtask\.due_date/);

const taskDetail = await read('src/components/TaskDetailPanel.jsx');
assert.match(taskDetail, /if \(subtask\.status === 'cancelled'\) return;/);
assert.match(taskDetail, /onSubtasksChange\?\.\(\)/);

const subtaskHook = await read('src/hooks/useSubtasks.js');
for (const operation of ['createSubtask', 'updateSubtask', 'toggleSubtask', 'deleteSubtask']) {
  assert.match(subtaskHook, new RegExp(`\\b${operation}\\b`), `Task Detail CRUD must preserve ${operation}`);
}

// 9. Active frontend terminology remains Phase-only.
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

console.log('P3-02 Subtask hierarchy regression: PASS (9 contracts)');
console.log('P3-02 bulk Subtask query verifier: PASS (1 project task-set query)');
console.log('P3-02 active Milestone terminology verifier: PASS (0 matches)');
