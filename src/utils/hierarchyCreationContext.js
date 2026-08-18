function requireId(value, label) {
  const id = typeof value === 'string' ? value : value?.id;
  if (!id) throw new Error(`${label} ID is required`);
  return id;
}

export function createTaskListCreationContext(phase) {
  return {
    phaseId: requireId(phase, 'Phase'),
    phaseName: phase?.name || 'Selected Phase',
  };
}

export function createTaskCreationContext({ projectId, projectName, phase, taskList }) {
  const phaseId = requireId(phase, 'Phase');
  const taskListId = requireId(taskList, 'Task List');

  if (taskList?.phase_id && taskList.phase_id !== phaseId) {
    throw new Error('Task List does not belong to the selected Phase');
  }

  return {
    projectId: requireId(projectId, 'Project'),
    projectName: projectName || 'Current Project',
    phaseId,
    phaseName: phase?.name || 'Selected Phase',
    taskListId,
    taskListName: taskList?.name || 'Selected Task List',
  };
}

export function resolveTaskListParentId(context, selectedPhaseId) {
  return context?.phaseId || selectedPhaseId || '';
}

export function resolveTaskParentIds(context, selectedPhaseId, selectedTaskListId) {
  return {
    phaseId: context?.phaseId || selectedPhaseId || '',
    taskListId: context?.taskListId || selectedTaskListId || '',
  };
}
