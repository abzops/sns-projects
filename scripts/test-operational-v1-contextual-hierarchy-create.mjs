import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const {
  createTaskCreationContext,
  createTaskListCreationContext,
  resolveTaskListParentId,
  resolveTaskParentIds,
} = await import(pathToFileURL(path.join(root, 'src/utils/hierarchyCreationContext.js')));

const phaseA = { id: 'phase-a', name: 'Discovery' };
const phaseB = { id: 'phase-b', name: 'Delivery' };
const listA = { id: 'list-a', phase_id: 'phase-a', name: 'Research' };
const listB = { id: 'list-b', phase_id: 'phase-b', name: 'Build' };

const listContextA = createTaskListCreationContext(phaseA);
assert.equal(listContextA.phaseId, 'phase-a', '1. Phase + selects its exact Phase.');

const taskContextA = createTaskCreationContext({
  projectId: 'project-1',
  projectName: 'Operations',
  phase: phaseA,
  taskList: listA,
});
assert.deepEqual(
  resolveTaskParentIds(taskContextA, 'tampered-phase', 'tampered-list'),
  { phaseId: 'phase-a', taskListId: 'list-a' },
  '2. Task List + locks the exact Phase and Task List.'
);

assert.equal(
  resolveTaskListParentId(listContextA, 'tampered-phase'),
  'phase-a',
  '3. Contextual Task List creation writes the locked parent ID.'
);

assert.notEqual(
  createTaskListCreationContext(phaseA).phaseId,
  createTaskListCreationContext(phaseB).phaseId,
  '4. Different Phase + buttons produce different defaults.'
);

const taskContextB = createTaskCreationContext({
  projectId: 'project-1',
  phase: phaseB,
  taskList: listB,
});
assert.notDeepEqual(
  resolveTaskParentIds(taskContextA, '', ''),
  resolveTaskParentIds(taskContextB, '', ''),
  '5. Different Task List + buttons produce different defaults.'
);

assert.deepEqual(
  resolveTaskParentIds(null, 'global-phase', 'global-list'),
  { phaseId: 'global-phase', taskListId: 'global-list' },
  '6. Global creation keeps editable form selections.'
);
assert.equal(resolveTaskListParentId(null, 'global-phase'), 'global-phase');

assert.throws(
  () => createTaskCreationContext({ projectId: 'project-1', phase: phaseA, taskList: listB }),
  /does not belong/,
  'Context builder rejects a mismatched Phase and Task List.'
);

const [page, taskHook, taskListHook] = await Promise.all([
  read('src/pages/TasksPage.jsx'),
  read('src/hooks/useTasks.js'),
  read('src/hooks/useTaskLists.js'),
]);

assert.match(page, /aria-label="Add Task List"/);
assert.match(page, /aria-label="Add Task"/);
assert.match(page, /onClick=\{\(\) => handleOpenAddTaskList\(phase\)\}/);
assert.match(page, /onClick=\{\(\) => handleOpenAddTask\(\{ phase, taskList \}\)\}/);
assert.match(page, /Creating inside selected Phase/);
assert.match(page, /Creating inside selected Task List/);
assert.match(page, /onClick=\{\(\) => handleOpenAddTaskList\(\)\}/);
assert.match(page, /onClick=\{\(\) => handleOpenAddTask\(\)\}/);

assert.equal(
  (page.match(/await createTask\(\{/g) || []).length,
  1,
  '7. Contextual and global Task creation share one mutation path.'
);
assert.equal(
  (page.match(/await createTaskList\(\{/g) || []).length,
  1,
  '7. Contextual and global Task List creation share one mutation path.'
);

assert.equal(
  (page.match(/setCollapsedPhases/g) || []).length,
  2,
  '8. Creation handlers do not mutate Phase expansion state.'
);
assert.equal(
  (page.match(/setCollapsedTaskLists/g) || []).length,
  2,
  '8. Creation handlers do not mutate Task List expansion state.'
);
assert.match(taskHook, /await fetchTasks\(\{ silent: true \}\)/);
assert.match(taskListHook, /await fetchTaskLists\(\{ silent: true \}\)/);

console.log('Operational V1 contextual hierarchy creation: PASS (8 required contracts)');
