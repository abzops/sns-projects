function compareByPosition(a, b) {
  const positionDelta = (a?.position ?? Number.MAX_SAFE_INTEGER) - (b?.position ?? Number.MAX_SAFE_INTEGER);
  if (positionDelta !== 0) return positionDelta;
  return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
}
function append(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

export function buildHierarchyModel(tasks = [], processInstances = []) {
  const orderedTasks = [...tasks].sort(compareByPosition);
  const allTaskIds = new Set(orderedTasks.map((task) => task.id));
  const ordinaryTasks = orderedTasks.filter(
    (task) => !task.process_instance_id && !task.process_step_id
  );
  const ordinaryChildrenByParent = new Map();
  const processStepsByInstance = new Map();
  const processesByHostTask = new Map();

  for (const task of ordinaryTasks) {
    append(ordinaryChildrenByParent, task.parent_task_id, task);
  }

  for (const task of orderedTasks) {
    if (task.process_instance_id && task.process_step_id) {
      append(processStepsByInstance, task.process_instance_id, task);
    }
  }

  for (const instance of processInstances) {
    if (instance.placement_type === 'task') {
      append(processesByHostTask, instance.parent_task_id, instance);
    }
  }

  for (const values of ordinaryChildrenByParent.values()) values.sort(compareByPosition);
  for (const values of processStepsByInstance.values()) values.sort(compareByPosition);
  for (const values of processesByHostTask.values()) {
    values.sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));
  }

  const rootTasks = ordinaryTasks.filter(
    (task) => !task.parent_task_id || !allTaskIds.has(task.parent_task_id)
  );

  return {
    rootTasks,
    ordinaryChildrenByParent,
    processStepsByInstance,
    processesByHostTask,
  };
}

export function getPlacementProcesses(processInstances = [], placementType, placementId) {
  return processInstances.filter((instance) => {
    if (instance.placement_type !== placementType) return false;
    if (placementType === 'project') return instance.project_id === placementId;
    if (placementType === 'phase') return instance.phase_id === placementId;
    if (placementType === 'task_list') return instance.task_list_id === placementId;
    return false;
  });
}
