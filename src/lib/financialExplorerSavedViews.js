/**
 * SNS PROJECTS — FINANCIAL EXPLORER SAVED VIEWS CONTRACT
 *
 * Canonical serializer, deserializer, validator, and normalizer for
 * persistent personal Saved Views in Financial Explorer.
 *
 * Schema Version: 1
 *
 * Invariants:
 * - Persists ONLY UI filter/group/sort configuration
 * - Zero persistence of rows, summary caches, financial data, or tenancy identities
 * - Unknown JSON keys are safely stripped
 * - Invalid enum values, malformed types, and stale entity references safely fall back to canonical defaults
 * - Cascading hierarchy references (Project -> Phase -> Task List -> Task) validated against current live metadata
 */

export const SAVED_VIEW_SCHEMA_VERSION = 1;

export const VALID_ENTITY_TYPES = Object.freeze([
  'all',
  'project',
  'phase',
  'task_list',
  'task',
  'expense',
  'standalone',
]);

export const VALID_STATUSES = Object.freeze([
  'all',
  'active',
  'completed',
  'cancelled',
  'corrected',
  'voided',
]);

export const VALID_RISKS = Object.freeze([
  'all',
  'GREEN',
  'YELLOW',
  'ORANGE',
  'RED',
  'UNBUDGETED',
]);

export const VALID_GROUP_BYS = Object.freeze([
  'none',
  'project',
  'phase',
  'task_list',
  'owner',
  'department',
  'entity_type',
  'status',
  'risk',
]);

export const VALID_SORT_BYS = Object.freeze([
  'name',
  'actualSpend',
  'utilization',
  'risk',
  'date',
  'owner',
]);

export const VALID_SORT_ORDERS = Object.freeze(['asc', 'desc']);

export const DEFAULT_EXPLORER_VIEW_STATE = Object.freeze({
  entityType: 'all',
  selectedProject: 'all',
  selectedPhase: 'all',
  selectedTaskList: 'all',
  selectedTask: 'all',
  selectedOwner: 'all',
  selectedDepartment: 'all',
  selectedStatus: 'all',
  selectedRisk: 'all',
  overBudgetOnly: false,
  selectedCreator: 'all',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
  searchQuery: '',
  groupBy: 'none',
  sortBy: 'name',
  sortOrder: 'asc',
});

/**
 * Serializes current React filter/sort state into a canonical Saved View JSON payload.
 *
 * @param {Object} state - Current explorer filter and view state
 * @returns {Object} JSON-serializable object conforming to schemaVersion 1
 */
export function serializeSavedViewState(state = {}) {
  return {
    schemaVersion: SAVED_VIEW_SCHEMA_VERSION,
    entityType: typeof state.entityType === 'string' && VALID_ENTITY_TYPES.includes(state.entityType)
      ? state.entityType
      : DEFAULT_EXPLORER_VIEW_STATE.entityType,
    selectedProject: typeof state.selectedProject === 'string' ? state.selectedProject : 'all',
    selectedPhase: typeof state.selectedPhase === 'string' ? state.selectedPhase : 'all',
    selectedTaskList: typeof state.selectedTaskList === 'string' ? state.selectedTaskList : 'all',
    selectedTask: typeof state.selectedTask === 'string' ? state.selectedTask : 'all',
    selectedOwner: typeof state.selectedOwner === 'string' ? state.selectedOwner : 'all',
    selectedDepartment: typeof state.selectedDepartment === 'string' ? state.selectedDepartment : 'all',
    selectedStatus: typeof state.selectedStatus === 'string' && VALID_STATUSES.includes(state.selectedStatus)
      ? state.selectedStatus
      : DEFAULT_EXPLORER_VIEW_STATE.selectedStatus,
    selectedRisk: typeof state.selectedRisk === 'string' && VALID_RISKS.includes(state.selectedRisk)
      ? state.selectedRisk
      : DEFAULT_EXPLORER_VIEW_STATE.selectedRisk,
    overBudgetOnly: Boolean(state.overBudgetOnly),
    selectedCreator: typeof state.selectedCreator === 'string' ? state.selectedCreator : 'all',
    dateFrom: typeof state.dateFrom === 'string' ? state.dateFrom.trim() : '',
    dateTo: typeof state.dateTo === 'string' ? state.dateTo.trim() : '',
    amountMin: typeof state.amountMin === 'string' ? state.amountMin.trim() : '',
    amountMax: typeof state.amountMax === 'string' ? state.amountMax.trim() : '',
    searchQuery: typeof state.searchQuery === 'string' ? state.searchQuery : '',
    groupBy: typeof state.groupBy === 'string' && VALID_GROUP_BYS.includes(state.groupBy)
      ? state.groupBy
      : DEFAULT_EXPLORER_VIEW_STATE.groupBy,
    sortBy: typeof state.sortBy === 'string' && VALID_SORT_BYS.includes(state.sortBy)
      ? state.sortBy
      : DEFAULT_EXPLORER_VIEW_STATE.sortBy,
    sortOrder: typeof state.sortOrder === 'string' && VALID_SORT_ORDERS.includes(state.sortOrder)
      ? state.sortOrder
      : DEFAULT_EXPLORER_VIEW_STATE.sortOrder,
  };
}

/**
 * Validates, normalizes, and sanitizes a raw Saved View JSON payload against
 * currently authorized workspace metadata.
 *
 * @param {Object} rawState - Raw view_state JSON from Supabase
 * @param {Object} metadata - Current workspace metadata (projects, phases, task_lists, tasks, profiles, primary_departments)
 * @returns {Object} Normalized Explorer state ready for React application
 */
export function normalizeSavedViewState(rawState = {}, metadata = null) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return { ...DEFAULT_EXPLORER_VIEW_STATE };
  }

  // 1. Whitelist-based scalar validation
  const normalized = {
    entityType: VALID_ENTITY_TYPES.includes(rawState.entityType)
      ? rawState.entityType
      : DEFAULT_EXPLORER_VIEW_STATE.entityType,
    selectedProject: typeof rawState.selectedProject === 'string' ? rawState.selectedProject : 'all',
    selectedPhase: typeof rawState.selectedPhase === 'string' ? rawState.selectedPhase : 'all',
    selectedTaskList: typeof rawState.selectedTaskList === 'string' ? rawState.selectedTaskList : 'all',
    selectedTask: typeof rawState.selectedTask === 'string' ? rawState.selectedTask : 'all',
    selectedOwner: typeof rawState.selectedOwner === 'string' ? rawState.selectedOwner : 'all',
    selectedDepartment: typeof rawState.selectedDepartment === 'string' ? rawState.selectedDepartment : 'all',
    selectedStatus: VALID_STATUSES.includes(rawState.selectedStatus)
      ? rawState.selectedStatus
      : DEFAULT_EXPLORER_VIEW_STATE.selectedStatus,
    selectedRisk: VALID_RISKS.includes(rawState.selectedRisk)
      ? rawState.selectedRisk
      : DEFAULT_EXPLORER_VIEW_STATE.selectedRisk,
    overBudgetOnly: rawState.overBudgetOnly === true,
    selectedCreator: typeof rawState.selectedCreator === 'string' ? rawState.selectedCreator : 'all',
    dateFrom: typeof rawState.dateFrom === 'string' ? rawState.dateFrom.trim() : '',
    dateTo: typeof rawState.dateTo === 'string' ? rawState.dateTo.trim() : '',
    amountMin: typeof rawState.amountMin === 'string' ? rawState.amountMin.trim() : '',
    amountMax: typeof rawState.amountMax === 'string' ? rawState.amountMax.trim() : '',
    searchQuery: typeof rawState.searchQuery === 'string' ? rawState.searchQuery : '',
    groupBy: VALID_GROUP_BYS.includes(rawState.groupBy)
      ? rawState.groupBy
      : DEFAULT_EXPLORER_VIEW_STATE.groupBy,
    sortBy: VALID_SORT_BYS.includes(rawState.sortBy)
      ? rawState.sortBy
      : DEFAULT_EXPLORER_VIEW_STATE.sortBy,
    sortOrder: VALID_SORT_ORDERS.includes(rawState.sortOrder)
      ? rawState.sortOrder
      : DEFAULT_EXPLORER_VIEW_STATE.sortOrder,
  };

  // 2. If metadata is provided, sanitize stale hierarchy references and enforce cascading integrity
  if (metadata && typeof metadata === 'object') {
    const rawProjects = Array.isArray(metadata.projects) ? metadata.projects : [];
    const rawPhases = Array.isArray(metadata.phases) ? metadata.phases : [];
    const rawTaskLists = Array.isArray(metadata.task_lists) ? metadata.task_lists : [];
    const rawTasks = Array.isArray(metadata.tasks) ? metadata.tasks : [];
    const rawProfiles = Array.isArray(metadata.profiles) ? metadata.profiles : [];
    const rawPrimaryDepts = Array.isArray(metadata.primary_departments) ? metadata.primary_departments : [];

    const projectIds = new Set(rawProjects.map((p) => p.id));
    const phaseMap = new Map(rawPhases.map((ph) => [ph.id, ph]));
    const taskListMap = new Map(rawTaskLists.map((tl) => [tl.id, tl]));
    const taskMap = new Map(rawTasks.map((t) => [t.id, t]));
    const profileIds = new Set(rawProfiles.map((pr) => pr.id));
    const departmentIds = new Set(rawPrimaryDepts.map((d) => d.department_id || d.id));

    // A. Project check
    if (normalized.selectedProject !== 'all' && !projectIds.has(normalized.selectedProject)) {
      normalized.selectedProject = 'all';
      normalized.selectedPhase = 'all';
      normalized.selectedTaskList = 'all';
      normalized.selectedTask = 'all';
    }

    // B. Phase check & project alignment
    if (normalized.selectedPhase !== 'all') {
      const phase = phaseMap.get(normalized.selectedPhase);
      if (!phase || (normalized.selectedProject !== 'all' && phase.project_id !== normalized.selectedProject)) {
        normalized.selectedPhase = 'all';
        normalized.selectedTaskList = 'all';
        normalized.selectedTask = 'all';
      }
    }

    // C. Task List check & phase alignment
    if (normalized.selectedTaskList !== 'all') {
      const taskList = taskListMap.get(normalized.selectedTaskList);
      if (
        !taskList ||
        (normalized.selectedPhase !== 'all' && taskList.phase_id !== normalized.selectedPhase) ||
        (normalized.selectedProject !== 'all' && taskList.project_id !== normalized.selectedProject)
      ) {
        normalized.selectedTaskList = 'all';
        normalized.selectedTask = 'all';
      }
    }

    // D. Task check & task list alignment
    if (normalized.selectedTask !== 'all') {
      const task = taskMap.get(normalized.selectedTask);
      if (
        !task ||
        (normalized.selectedTaskList !== 'all' && task.task_list_id !== normalized.selectedTaskList) ||
        (normalized.selectedPhase !== 'all' && task.phase_id !== normalized.selectedPhase) ||
        (normalized.selectedProject !== 'all' && task.project_id !== normalized.selectedProject)
      ) {
        normalized.selectedTask = 'all';
      }
    }

    // E. Owner check
    if (normalized.selectedOwner !== 'all' && !profileIds.has(normalized.selectedOwner)) {
      normalized.selectedOwner = 'all';
    }

    // F. Creator check
    if (normalized.selectedCreator !== 'all' && !profileIds.has(normalized.selectedCreator)) {
      normalized.selectedCreator = 'all';
    }

    // G. Department check
    if (normalized.selectedDepartment !== 'all' && !departmentIds.has(normalized.selectedDepartment)) {
      normalized.selectedDepartment = 'all';
    }
  }

  return normalized;
}

/**
 * Compares current Explorer UI configuration against the loaded Saved View baseline.
 *
 * @param {Object} currentState - Current active Explorer state
 * @param {Object} baselineState - Baseline state of the active Saved View
 * @returns {boolean} True if any configuration field differs
 */
export function isSavedViewDirty(currentState = {}, baselineState = {}) {
  if (!baselineState || typeof baselineState !== 'object') return false;

  const current = serializeSavedViewState(currentState);
  const baseline = serializeSavedViewState(baselineState);

  return (
    current.entityType !== baseline.entityType ||
    current.selectedProject !== baseline.selectedProject ||
    current.selectedPhase !== baseline.selectedPhase ||
    current.selectedTaskList !== baseline.selectedTaskList ||
    current.selectedTask !== baseline.selectedTask ||
    current.selectedOwner !== baseline.selectedOwner ||
    current.selectedDepartment !== baseline.selectedDepartment ||
    current.selectedStatus !== baseline.selectedStatus ||
    current.selectedRisk !== baseline.selectedRisk ||
    current.overBudgetOnly !== baseline.overBudgetOnly ||
    current.selectedCreator !== baseline.selectedCreator ||
    current.dateFrom !== baseline.dateFrom ||
    current.dateTo !== baseline.dateTo ||
    current.amountMin !== baseline.amountMin ||
    current.amountMax !== baseline.amountMax ||
    current.searchQuery !== baseline.searchQuery ||
    current.groupBy !== baseline.groupBy ||
    current.sortBy !== baseline.sortBy ||
    current.sortOrder !== baseline.sortOrder
  );
}
