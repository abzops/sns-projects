const CLOSED_TASK_CODES = new Set(['done', 'cancelled']);

function startOfToday(now = new Date()) {
  const value = new Date(now);
  value.setHours(0, 0, 0, 0);
  return value;
}

function taskCode(task) {
  return task.task_statuses?.system_code || '';
}

function isTaskOpen(task) {
  return !CLOSED_TASK_CODES.has(taskCode(task));
}

function isBefore(dateValue, boundary) {
  if (!dateValue) return false;
  const value = new Date(dateValue);
  return !Number.isNaN(value.getTime()) && value < boundary;
}

function isWithin(dateValue, from, through) {
  if (!dateValue) return false;
  const value = new Date(dateValue);
  return !Number.isNaN(value.getTime()) && value >= from && value <= through;
}

export function calculateProjectHealth(project, now = new Date()) {
  const today = startOfToday(now);
  const isClosed = project.project_status === 'completed' || project.project_status === 'cancelled';
  if (isClosed) return { status: 'completed', label: 'Completed', variant: 'success' };

  if (isBefore(project.target_end_date, today)) {
    return { status: 'critical', label: 'Critical (Overdue)', variant: 'danger' };
  }
  if (project.project_priority === 'critical' && (project.overdue_count || 0) > 0) {
    return { status: 'critical', label: 'Critical (Overdue Tasks)', variant: 'danger' };
  }

  const taskCount = project.task_count || 0;
  if (taskCount > 0 && (project.overdue_count || 0) / taskCount >= 0.1) {
    return { status: 'at_risk', label: 'At Risk (Overdue Work)', variant: 'warning' };
  }

  if (project.target_end_date) {
    const inSevenDays = new Date(today);
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    if (isWithin(project.target_end_date, today, inSevenDays) && (project.progress || 0) < 70) {
      return { status: 'at_risk', label: 'At Risk (Due Soon)', variant: 'warning' };
    }
  }

  return { status: 'on_track', label: 'On Track', variant: 'success' };
}

function uniqueById(rows) {
  return Array.from(new Map((rows || []).map((row) => [row.id, row])).values());
}

export function buildDashboardMetrics({
  projects = [],
  tasks = [],
  raciRows = [],
  subtasks = [],
  processInstances = [],
  departments = [],
  userId = null,
  departmentIds = [],
  admin = null,
  scopedOperational = false,
  now = new Date(),
} = {}) {
  const today = startOfToday(now);
  const dueSoonBoundary = new Date(today);
  dueSoonBoundary.setDate(dueSoonBoundary.getDate() + 7);

  const openTasks = tasks.filter(isTaskOpen);
  const overdueTasks = openTasks.filter((task) => isBefore(task.due_date, today));
  const dueSoonTasks = openTasks.filter((task) => isWithin(task.due_date, today, dueSoonBoundary));
  const blockedTasks = openTasks.filter((task) => taskCode(task) === 'blocked');
  const activeProjects = projects.filter((project) => !['completed', 'cancelled'].includes(project.project_status));

  const projectHealth = new Map(projects.map((project) => [project.id, calculateProjectHealth(project, now)]));
  const criticalProjects = projects.filter((project) => projectHealth.get(project.id)?.status === 'critical');
  const atRiskProjects = projects.filter((project) => projectHealth.get(project.id)?.status === 'at_risk');

  const raciByTask = new Map();
  for (const row of raciRows) {
    if (!raciByTask.has(row.task_id)) raciByTask.set(row.task_id, []);
    raciByTask.get(row.task_id).push(row);
  }

  const missingOwnerTasks = [];
  const missingAssigneeTasks = [];
  const completeAssignmentTasks = [];
  for (const task of openTasks) {
    const assignments = raciByTask.get(task.id) || [];
    const hasOwner = assignments.some((row) => row.raci_role === 'A');
    const hasAssignee = assignments.some((row) => row.raci_role === 'R') || Boolean(task.assignee_id);
    if (!hasOwner) missingOwnerTasks.push(task);
    if (!hasAssignee) missingAssigneeTasks.push(task);
    if (hasOwner && hasAssignee) completeAssignmentTasks.push(task);
  }
  const assignmentGapTasks = uniqueById([...missingOwnerTasks, ...missingAssigneeTasks]);

  const departmentSet = new Set(departmentIds);
  const myRolesByTask = new Map();
  for (const row of raciRows) {
    if (row.user_id !== userId && !departmentSet.has(row.department_id)) continue;
    if (!myRolesByTask.has(row.task_id)) myRolesByTask.set(row.task_id, new Set());
    myRolesByTask.get(row.task_id).add(row.raci_role);
  }
  for (const task of tasks) {
    if (task.assignee_id !== userId) continue;
    if (!myRolesByTask.has(task.id)) myRolesByTask.set(task.id, new Set());
    myRolesByTask.get(task.id).add('R');
  }

  const assignedSubtasks = subtasks.filter((subtask) => subtask.assignee_id === userId && !['done', 'cancelled'].includes(subtask.status));
  const personalTasks = tasks
    .filter((task) => myRolesByTask.has(task.id) || assignedSubtasks.some((subtask) => subtask.task_id === task.id))
    .map((task) => ({ ...task, myRoles: Array.from(myRolesByTask.get(task.id) || []) }));
  const personalOpenTasks = personalTasks.filter(isTaskOpen);
  const ownedTasks = personalOpenTasks.filter((task) => task.myRoles.includes('A'));
  const assignedTasks = personalOpenTasks.filter((task) => task.myRoles.includes('R'));
  const consultedTasks = personalOpenTasks.filter((task) => task.myRoles.includes('C'));
  const informedTasks = personalOpenTasks.filter((task) => task.myRoles.includes('I'));
  const personalOverdueTasks = personalOpenTasks.filter((task) => isBefore(task.due_date, today));
  const personalDueSoonTasks = personalOpenTasks.filter((task) => isWithin(task.due_date, today, dueSoonBoundary));
  const personalBlockedTasks = personalOpenTasks.filter((task) => taskCode(task) === 'blocked');
  const overdueSubtasks = assignedSubtasks.filter((subtask) => isBefore(subtask.due_date, today));
  const dueSoonSubtasks = assignedSubtasks.filter((subtask) => isWithin(subtask.due_date, today, dueSoonBoundary));

  const personalProcessIds = new Set(
    personalTasks.map((task) => task.process_instance_id).filter(Boolean)
  );
  const myProcesses = scopedOperational
    ? processInstances
    : processInstances.filter(
        (instance) => instance.owner_id === userId || instance.started_by === userId || personalProcessIds.has(instance.id)
      );

  const statusDistribution = ['todo', 'in_progress', 'in_review', 'blocked', 'done'].map((code) => ({
    code,
    count: tasks.filter((task) => taskCode(task) === code).length,
  }));

  const departmentCounts = new Map();
  for (const row of raciRows) {
    if (!row.department_id) continue;
    if (!departmentCounts.has(row.department_id)) departmentCounts.set(row.department_id, new Set());
    departmentCounts.get(row.department_id).add(row.task_id);
  }
  const departmentOverview = departments
    .map((department) => ({
      id: department.id,
      name: department.name,
      code: department.code,
      color: department.color,
      taskCount: departmentCounts.get(department.id)?.size || 0,
    }))
    .filter((department) => department.taskCount > 0)
    .sort((a, b) => b.taskCount - a.taskCount);

  return {
    activeProjects,
    criticalProjects,
    atRiskProjects,
    projectHealth,
    openTasks,
    overdueTasks,
    dueSoonTasks,
    blockedTasks,
    missingOwnerTasks,
    missingAssigneeTasks,
    completeAssignmentTasks,
    assignmentGapTasks,
    statusDistribution,
    departmentOverview,
    personal: {
      tasks: personalTasks,
      openTasks: personalOpenTasks,
      assignedTasks,
      ownedTasks,
      consultedTasks,
      informedTasks,
      assignedSubtasks,
      overdueTasks: uniqueById(personalOverdueTasks),
      dueSoonTasks: uniqueById(personalDueSoonTasks),
      blockedTasks: uniqueById(personalBlockedTasks),
      overdueSubtasks,
      dueSoonSubtasks,
      processes: myProcesses,
      assignedCount: assignedTasks.length + assignedSubtasks.length,
      overdueCount: personalOverdueTasks.length + overdueSubtasks.length,
      dueSoonCount: personalDueSoonTasks.length + dueSoonSubtasks.length,
    },
    admin: {
      activeUsers: (admin?.members || []).filter((member) => member.status === 'active').length,
      pendingUsers: (admin?.members || []).filter((member) => member.status === 'pending').length,
      workspaceMembers: (admin?.members || []).length,
      systemRoleAssignments: (admin?.systemRoles || []).length,
      departments: departments.length,
    },
  };
}
