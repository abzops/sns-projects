import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { normalizeFinancialSummary } from '../lib/finance.js';

const financialExplorerCache = new Map(); // cacheKey -> { rawData, normalizedRows, workspaceSummary }

export function clearFinancialExplorerCache() {
  financialExplorerCache.clear();
}

/**
 * Bounded concurrency executor for batching async requests safely without overloading PostgreSQL.
 */
async function pMap(items, mapper, concurrency = 5) {
  if (!items || items.length === 0) return [];
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await mapper(items[idx], idx);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Hook to manage Financial Explorer multi-dimensional data retrieval, normalized models, and RPC summaries.
 *
 * Strictly enforces:
 * - Cache keying by userId + workspaceId + authorizationScopeKey
 * - Bounded concurrency for summary RPCs
 * - Zero double counting: spend metrics strictly derive from leaf expense transactions
 * - Stale request invalidation and synchronous cache-flush on scope changes
 */
export function useFinancialExplorer(workspaceId, authorizationScopeKey = 'default', { enabled = true } = {}) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`;
  const cached = userId && workspaceId ? financialExplorerCache.get(cacheKey) || null : null;

  const [activeCacheKey, setActiveCacheKey] = useState(cacheKey);
  const [rows, setRows] = useState(() => cached?.normalizedRows || []);
  const [workspaceSummary, setWorkspaceSummary] = useState(() => cached?.workspaceSummary || null);
  const [hierarchyData, setHierarchyData] = useState(() => cached?.hierarchyData || {
    projects: [],
    phases: [],
    taskLists: [],
    tasks: [],
    owners: [],
    creators: [],
    departments: [],
  });
  const [loading, setLoading] = useState(() => !cached && enabled && Boolean(workspaceId && userId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const activeFetchIdRef = useRef(0);

  // Synchronously isolate state when scope key shifts (workspace, user, or authorization change)
  useEffect(() => {
    if (cacheKey !== activeCacheKey) {
      activeFetchIdRef.current++;
      setActiveCacheKey(cacheKey);
      const nextCached = financialExplorerCache.get(cacheKey) || null;
      if (nextCached) {
        setRows(nextCached.normalizedRows);
        setWorkspaceSummary(nextCached.workspaceSummary);
        setHierarchyData(nextCached.hierarchyData);
        setLoading(false);
      } else {
        setRows([]);
        setWorkspaceSummary(null);
        setHierarchyData({
          projects: [],
          phases: [],
          taskLists: [],
          tasks: [],
          owners: [],
          creators: [],
          departments: [],
        });
        setLoading(enabled && Boolean(workspaceId && userId));
      }
      setError(null);
      setRefreshing(false);
    }
  }, [cacheKey, activeCacheKey, enabled, workspaceId, userId]);

  const fetchExplorerData = useCallback(
    async (options = {}) => {
      const isSilent = options?.silent ?? false;
      if (!workspaceId || !userId || !enabled) {
        setRows([]);
        setWorkspaceSummary(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const fetchId = ++activeFetchIdRef.current;

      try {
        if (!isSilent && !financialExplorerCache.has(cacheKey)) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);

        // 1. Parallel fetch core entities
        const [
          wsSummaryRes,
          projectsRes,
          budgetsRes,
          expensesRes,
          profilesRes,
          departmentsRes,
          deptMembersRes,
        ] = await Promise.all([
          supabase.rpc('get_workspace_financial_summary', { p_workspace_id: workspaceId }),
          supabase
            .from('projects')
            .select('id, workspace_id, name, color, owner_id, created_by, created_at, project_status')
            .eq('workspace_id', workspaceId)
            .order('name'),
          supabase
            .from('budgets')
            .select('id, workspace_id, entity_type, project_id, phase_id, task_list_id, base_budget, safety_buffer, created_at, updated_at')
            .eq('workspace_id', workspaceId),
          supabase
            .from('expense_transactions')
            .select(`
              id,
              workspace_id,
              task_id,
              subtask_id,
              expense_date,
              description,
              status,
              created_by,
              updated_by,
              cycle_number,
              created_at,
              updated_at,
              expense_items (
                id,
                line_number,
                amount,
                category,
                description
              )
            `)
            .eq('workspace_id', workspaceId)
            .order('expense_date', { ascending: false }),
          supabase.from('profiles').select('id, full_name'),
          supabase.from('departments').select('id, name, code, workspace_id').eq('workspace_id', workspaceId),
          supabase.from('department_memberships').select('id, workspace_id, department_id, user_id, is_primary, is_active').eq('workspace_id', workspaceId).eq('is_active', true),
        ]);

        if (fetchId !== activeFetchIdRef.current) return;

        if (wsSummaryRes.error) throw wsSummaryRes.error;
        if (projectsRes.error) throw projectsRes.error;
        if (expensesRes.error) throw expensesRes.error;

        const rawProjects = projectsRes.data || [];
        const rawBudgets = budgetsRes.data || [];
        const rawExpenses = expensesRes.data || [];
        const rawProfiles = profilesRes.data || [];
        const rawDepartments = departmentsRes.data || [];
        const rawDeptMembers = deptMembersRes.data || [];

        const projectIds = rawProjects.map((p) => p.id);
        const expenseTaskIds = Array.from(new Set(rawExpenses.map((e) => e.task_id).filter(Boolean)));

        // 2. Fetch Phases, Task Lists, Tasks scoped to this workspace's projects and expenses
        let phasesQuery = supabase.from('phases').select('id, project_id, name, created_by, created_at, position').order('position');
        let taskListsQuery = supabase.from('task_lists').select('id, project_id, phase_id, name, position, created_by, created_at, completed_at').order('position');
        
        if (projectIds.length > 0) {
          phasesQuery = phasesQuery.in('project_id', projectIds);
          taskListsQuery = taskListsQuery.in('project_id', projectIds);
        }

        const [phasesRes, taskListsRes] = await Promise.all([phasesQuery, taskListsQuery]);
        const rawPhases = phasesRes.data || [];
        const rawTaskLists = taskListsRes.data || [];

        // Tasks query: tasks in workspace projects OR tasks attached to workspace expense transactions
        let rawTasks = [];
        if (projectIds.length > 0 || expenseTaskIds.length > 0) {
          let tasksQuery = supabase
            .from('tasks')
            .select(`
              id,
              project_id,
              phase_id,
              task_list_id,
              parent_task_id,
              process_step_id,
              process_instance_id,
              title,
              status_id,
              assignee_id,
              owner_id,
              created_by,
              created_at,
              updated_at,
              due_date,
              task_statuses (
                id,
                name,
                color,
                system_code
              ),
              subtasks (
                id,
                title,
                status
              )
            `)
            .order('created_at', { ascending: false });

          if (projectIds.length > 0 && expenseTaskIds.length > 0) {
            tasksQuery = tasksQuery.or(`project_id.in.(${projectIds.join(',')}),id.in.(${expenseTaskIds.join(',')})`);
          } else if (projectIds.length > 0) {
            tasksQuery = tasksQuery.in('project_id', projectIds);
          } else if (expenseTaskIds.length > 0) {
            tasksQuery = tasksQuery.in('id', expenseTaskIds);
          }

          const tasksRes = await tasksQuery;
          if (tasksRes.data) {
            rawTasks = tasksRes.data;
          }
        }

        if (fetchId !== activeFetchIdRef.current) return;

        // 3. Fetch canonical financial summaries via bounded concurrency pool
        const summariesMap = new Map(); // `${type}:${id}` -> normalizedSummary

        // Project summaries
        await pMap(rawProjects, async (p) => {
          try {
            const { data, error } = await supabase.rpc('get_project_financial_summary', { p_project_id: p.id });
            if (!error && data) {
              summariesMap.set(`project:${p.id}`, normalizeFinancialSummary(data));
            }
          } catch {
            // Fail safe per entity
          }
        }, 5);

        // Phase summaries
        await pMap(rawPhases, async (ph) => {
          try {
            const { data, error } = await supabase.rpc('get_phase_financial_summary', { p_phase_id: ph.id });
            if (!error && data) {
              summariesMap.set(`phase:${ph.id}`, normalizeFinancialSummary(data));
            }
          } catch {
            // Fail safe per entity
          }
        }, 5);

        // Task List summaries
        await pMap(rawTaskLists, async (tl) => {
          try {
            const { data, error } = await supabase.rpc('get_task_list_financial_summary', { p_task_list_id: tl.id });
            if (!error && data) {
              summariesMap.set(`task_list:${tl.id}`, normalizeFinancialSummary(data));
            }
          } catch {
            // Fail safe per entity
          }
        }, 5);

        if (fetchId !== activeFetchIdRef.current) return;

        // 4. Build Lookup Indices
        const profilesMap = new Map(rawProfiles.map((pr) => [pr.id, pr.full_name]));
        const departmentsMap = new Map(rawDepartments.map((d) => [d.id, d]));
        
        // Resolve primary department per user in current workspace
        const userDeptMap = new Map(); // userId -> { id, name, code }
        for (const dm of rawDeptMembers) {
          const dept = departmentsMap.get(dm.department_id);
          if (dept) {
            if (dm.is_primary || !userDeptMap.has(dm.user_id)) {
              userDeptMap.set(dm.user_id, dept);
            }
          }
        }

        const projectsMap = new Map(rawProjects.map((p) => [p.id, p]));
        const phasesMap = new Map(rawPhases.map((ph) => [ph.id, ph]));
        const taskListsMap = new Map(rawTaskLists.map((tl) => [tl.id, tl]));
        const tasksMap = new Map(rawTasks.map((t) => [t.id, t]));

        const budgetsMap = new Map();
        for (const b of rawBudgets) {
          if (b.entity_type === 'project') budgetsMap.set(`project:${b.project_id}`, b);
          else if (b.entity_type === 'phase') budgetsMap.set(`phase:${b.phase_id}`, b);
          else if (b.entity_type === 'task_list') budgetsMap.set(`task_list:${b.task_list_id}`, b);
        }

        // Calculate direct leaf expenses per task (excluding voided)
        const taskLeafSpendMap = new Map(); // taskId -> total effective spend
        const taskExpensesListMap = new Map(); // taskId -> expense_transactions[]
        for (const tx of rawExpenses) {
          if (!taskExpensesListMap.has(tx.task_id)) {
            taskExpensesListMap.set(tx.task_id, []);
          }
          taskExpensesListMap.get(tx.task_id).push(tx);

          if (tx.status !== 'voided') {
            const itemsSum = (tx.expense_items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
            taskLeafSpendMap.set(tx.task_id, (taskLeafSpendMap.get(tx.task_id) || 0) + itemsSum);
          }
        }

        // 5. Generate Normalized Explorer Rows
        const normalizedRows = [];

        // 5.1 Project Rows
        for (const p of rawProjects) {
          const summary = summariesMap.get(`project:${p.id}`) || null;
          const ownBudget = budgetsMap.get(`project:${p.id}`) || null;
          const ownerDept = userDeptMap.get(p.owner_id);

          normalizedRows.push({
            id: `project-${p.id}`,
            entityId: p.id,
            rowType: 'project',
            name: p.name,
            description: `Project · ${p.project_status || 'Active'}`,
            projectId: p.id,
            projectName: p.name,
            projectColor: p.color,
            phaseId: null,
            phaseName: '—',
            taskListId: null,
            taskListName: '—',
            taskId: null,
            taskTitle: '—',
            subtaskId: null,
            isStandalone: false,
            ownerId: p.owner_id,
            ownerName: profilesMap.get(p.owner_id) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: p.created_by,
            creatorName: profilesMap.get(p.created_by) || 'System',
            status: p.project_status || 'Active',
            date: p.created_at ? p.created_at.slice(0, 10) : '—',
            budgetSource: ownBudget ? 'Project Budget' : 'Unbudgeted',
            budgetSourceType: ownBudget ? 'project' : null,
            isOwnBudget: Boolean(ownBudget),
            baseBudget: summary ? summary.base_budget : (ownBudget?.base_budget || null),
            safetyBuffer: summary ? summary.safety_buffer : (ownBudget?.safety_buffer || null),
            actualSpend: summary ? summary.actual_spend : 0,
            remainingBase: summary ? summary.remaining_base : 0,
            overrun: summary ? summary.overrun : 0,
            utilizationPct: summary ? summary.utilization_pct : 0,
            riskBand: summary?.risk_band || (ownBudget ? 'GREEN' : 'UNBUDGETED'),
            isOverBudget: summary ? summary.overrun > 0 || summary.risk_band === 'ORANGE' || summary.risk_band === 'RED' : false,
            hasSummary: Boolean(summary),
            rawEntity: p,
          });
        }

        // 5.2 Phase Rows
        for (const ph of rawPhases) {
          const summary = summariesMap.get(`phase:${ph.id}`) || null;
          const ownBudget = budgetsMap.get(`phase:${ph.id}`) || null;
          const parentProj = projectsMap.get(ph.project_id);
          const ownerDept = userDeptMap.get(parentProj?.owner_id);

          normalizedRows.push({
            id: `phase-${ph.id}`,
            entityId: ph.id,
            rowType: 'phase',
            name: ph.name,
            description: `Phase in ${parentProj?.name || 'Project'}`,
            projectId: ph.project_id,
            projectName: parentProj?.name || 'Unknown',
            projectColor: parentProj?.color,
            phaseId: ph.id,
            phaseName: ph.name,
            taskListId: null,
            taskListName: '—',
            taskId: null,
            taskTitle: '—',
            subtaskId: null,
            isStandalone: false,
            ownerId: parentProj?.owner_id || null,
            ownerName: profilesMap.get(parentProj?.owner_id) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: ph.created_by,
            creatorName: profilesMap.get(ph.created_by) || 'System',
            status: '—', // Phases do not have active/completed status in P6
            date: ph.created_at ? ph.created_at.slice(0, 10) : '—',
            budgetSource: ownBudget
              ? 'Phase Budget'
              : summary?.budget_source_type === 'project'
              ? 'Inherited from Project'
              : 'Unbudgeted',
            budgetSourceType: ownBudget ? 'phase' : summary?.budget_source_type || null,
            isOwnBudget: Boolean(ownBudget),
            baseBudget: summary ? summary.base_budget : (ownBudget?.base_budget || null),
            safetyBuffer: summary ? summary.safety_buffer : (ownBudget?.safety_buffer || null),
            actualSpend: summary ? summary.actual_spend : 0,
            remainingBase: summary ? summary.remaining_base : 0,
            overrun: summary ? summary.overrun : 0,
            utilizationPct: summary ? summary.utilization_pct : 0,
            riskBand: summary?.risk_band || (ownBudget ? 'GREEN' : 'UNBUDGETED'),
            isOverBudget: summary ? summary.overrun > 0 || summary.risk_band === 'ORANGE' || summary.risk_band === 'RED' : false,
            hasSummary: Boolean(summary),
            rawEntity: ph,
          });
        }

        // 5.3 Task List Rows
        for (const tl of rawTaskLists) {
          const summary = summariesMap.get(`task_list:${tl.id}`) || null;
          const ownBudget = budgetsMap.get(`task_list:${tl.id}`) || null;
          const parentProj = projectsMap.get(tl.project_id);
          const parentPhase = phasesMap.get(tl.phase_id);
          const ownerDept = userDeptMap.get(parentProj?.owner_id);

          normalizedRows.push({
            id: `task_list-${tl.id}`,
            entityId: tl.id,
            rowType: 'task_list',
            name: tl.name,
            description: `Task List in ${parentPhase?.name || parentProj?.name || 'Project'}`,
            projectId: tl.project_id,
            projectName: parentProj?.name || 'Unknown',
            projectColor: parentProj?.color,
            phaseId: tl.phase_id,
            phaseName: parentPhase?.name || '—',
            taskListId: tl.id,
            taskListName: tl.name,
            taskId: null,
            taskTitle: '—',
            subtaskId: null,
            isStandalone: false,
            ownerId: parentProj?.owner_id || null,
            ownerName: profilesMap.get(parentProj?.owner_id) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: tl.created_by,
            creatorName: profilesMap.get(tl.created_by) || 'System',
            status: tl.completed_at ? 'Completed' : 'Active',
            date: tl.created_at ? tl.created_at.slice(0, 10) : '—',
            budgetSource: ownBudget
              ? 'Task List Budget'
              : summary?.budget_source_type === 'phase'
              ? 'Inherited from Phase'
              : summary?.budget_source_type === 'project'
              ? 'Inherited from Project'
              : 'Unbudgeted',
            budgetSourceType: ownBudget ? 'task_list' : summary?.budget_source_type || null,
            isOwnBudget: Boolean(ownBudget),
            baseBudget: summary ? summary.base_budget : (ownBudget?.base_budget || null),
            safetyBuffer: summary ? summary.safety_buffer : (ownBudget?.safety_buffer || null),
            actualSpend: summary ? summary.actual_spend : 0,
            remainingBase: summary ? summary.remaining_base : 0,
            overrun: summary ? summary.overrun : 0,
            utilizationPct: summary ? summary.utilization_pct : 0,
            riskBand: summary?.risk_band || (ownBudget ? 'GREEN' : 'UNBUDGETED'),
            isOverBudget: summary ? summary.overrun > 0 || summary.risk_band === 'ORANGE' || summary.risk_band === 'RED' : false,
            hasSummary: Boolean(summary),
            rawEntity: tl,
          });
        }

        // 5.4 Task Rows
        for (const t of rawTasks) {
          const isStandalone = !t.project_id && !t.phase_id && !t.task_list_id;
          const isProcessStep = Boolean(t.process_step_id || t.process_instance_id);
          const isChildTask = Boolean(t.parent_task_id);

          const parentProj = projectsMap.get(t.project_id);
          const parentPhase = phasesMap.get(t.phase_id);
          const parentTaskList = taskListsMap.get(t.task_list_id);

          // Determine nearest budget-owning ancestor
          let nearestBudgetSource = 'Unbudgeted';
          let ancestorSummary = null;

          if (t.task_list_id && budgetsMap.has(`task_list:${t.task_list_id}`)) {
            nearestBudgetSource = 'Inherited from Task List';
            ancestorSummary = summariesMap.get(`task_list:${t.task_list_id}`);
          } else if (t.phase_id && budgetsMap.has(`phase:${t.phase_id}`)) {
            nearestBudgetSource = 'Inherited from Phase';
            ancestorSummary = summariesMap.get(`phase:${t.phase_id}`);
          } else if (t.project_id && budgetsMap.has(`project:${t.project_id}`)) {
            nearestBudgetSource = 'Inherited from Project';
            ancestorSummary = summariesMap.get(`project:${t.project_id}`);
          } else if (t.task_list_id && summariesMap.get(`task_list:${t.task_list_id}`)?.budget_source_id) {
            ancestorSummary = summariesMap.get(`task_list:${t.task_list_id}`);
            nearestBudgetSource = ancestorSummary.budget_source_type === 'phase' ? 'Inherited from Phase' : 'Inherited from Project';
          } else if (t.phase_id && summariesMap.get(`phase:${t.phase_id}`)?.budget_source_id) {
            ancestorSummary = summariesMap.get(`phase:${t.phase_id}`);
            nearestBudgetSource = 'Inherited from Project';
          } else if (t.project_id) {
            ancestorSummary = summariesMap.get(`project:${t.project_id}`);
            nearestBudgetSource = 'Inherited from Project';
          } else {
            nearestBudgetSource = 'Unbudgeted / Standalone';
          }

          const taskSpend = taskLeafSpendMap.get(t.id) || 0;
          const taskOwnerId = t.owner_id || t.assignee_id;
          const ownerDept = userDeptMap.get(taskOwnerId);

          const sysCode = t.task_statuses?.system_code || 'todo';
          const taskStatus = sysCode === 'done' ? 'Completed' : sysCode === 'cancelled' ? 'Cancelled' : 'Active';

          const taskRisk = isStandalone
            ? 'UNBUDGETED'
            : ancestorSummary?.risk_band || 'GREEN';

          const isOverBudget = ancestorSummary
            ? ancestorSummary.overrun > 0 || ancestorSummary.risk_band === 'ORANGE' || ancestorSummary.risk_band === 'RED'
            : false;

          let taskVariantLabel = 'Task';
          if (isStandalone) taskVariantLabel = 'Standalone Task';
          else if (isProcessStep) taskVariantLabel = 'Process Step';
          else if (isChildTask) taskVariantLabel = 'Child Task';

          normalizedRows.push({
            id: `task-${t.id}`,
            entityId: t.id,
            rowType: 'task',
            taskVariant: taskVariantLabel,
            name: t.title,
            description: `${taskVariantLabel} · ${taskStatus}`,
            projectId: t.project_id,
            projectName: parentProj?.name || (isStandalone ? 'Standalone' : 'Unassigned'),
            projectColor: parentProj?.color,
            phaseId: t.phase_id,
            phaseName: parentPhase?.name || '—',
            taskListId: t.task_list_id,
            taskListName: parentTaskList?.name || '—',
            taskId: t.id,
            taskTitle: t.title,
            subtaskId: null,
            isStandalone,
            ownerId: taskOwnerId || null,
            ownerName: profilesMap.get(taskOwnerId) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: t.created_by,
            creatorName: profilesMap.get(t.created_by) || 'System',
            status: taskStatus,
            date: t.created_at ? t.created_at.slice(0, 10) : '—',
            budgetSource: nearestBudgetSource,
            budgetSourceType: null,
            isOwnBudget: false,
            baseBudget: null, // Tasks do NOT own budgets
            safetyBuffer: null,
            actualSpend: taskSpend,
            remainingBase: null,
            overrun: null,
            utilizationPct: null,
            riskBand: taskRisk,
            isOverBudget,
            hasSummary: Boolean(ancestorSummary),
            rawEntity: t,
          });
        }

        // 5.5 Expense Rows (Physical leaf records)
        for (const tx of rawExpenses) {
          const parentTask = tasksMap.get(tx.task_id);
          const isStandalone = parentTask ? (!parentTask.project_id && !parentTask.phase_id && !parentTask.task_list_id) : true;
          const parentProj = parentTask?.project_id ? projectsMap.get(parentTask.project_id) : null;
          const parentPhase = parentTask?.phase_id ? phasesMap.get(parentTask.phase_id) : null;
          const parentTaskList = parentTask?.task_list_id ? taskListsMap.get(parentTask.task_list_id) : null;

          const taskOwnerId = parentTask ? (parentTask.owner_id || parentTask.assignee_id) : null;
          const ownerDept = userDeptMap.get(taskOwnerId);

          const itemsSum = (tx.expense_items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
          const effectiveSpend = tx.status === 'voided' ? 0 : itemsSum;

          // Find task's budget context
          let taskRisk = 'GREEN';
          let budgetSource = 'Unbudgeted';
          if (parentTask) {
            const taskRow = normalizedRows.find((r) => r.id === `task-${parentTask.id}`);
            if (taskRow) {
              taskRisk = taskRow.riskBand;
              budgetSource = taskRow.budgetSource;
            }
          }

          const primaryDesc = tx.description || tx.expense_items?.[0]?.description || tx.expense_items?.[0]?.category || 'Expense Entry';

          normalizedRows.push({
            id: `expense-${tx.id}`,
            entityId: tx.id,
            rowType: 'expense',
            name: primaryDesc,
            description: `${tx.status.toUpperCase()} Expense · ${tx.expense_date}`,
            projectId: parentTask?.project_id || null,
            projectName: parentProj?.name || (isStandalone ? 'Standalone' : 'Unassigned'),
            projectColor: parentProj?.color,
            phaseId: parentTask?.phase_id || null,
            phaseName: parentPhase?.name || '—',
            taskListId: parentTask?.task_list_id || null,
            taskListName: parentTaskList?.name || '—',
            taskId: tx.task_id,
            taskTitle: parentTask?.title || 'Unknown Task',
            subtaskId: tx.subtask_id,
            isStandalone,
            ownerId: taskOwnerId || null,
            ownerName: profilesMap.get(taskOwnerId) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: tx.created_by,
            creatorName: profilesMap.get(tx.created_by) || 'System',
            status: tx.status,
            date: tx.expense_date || (tx.created_at ? tx.created_at.slice(0, 10) : '—'),
            budgetSource,
            budgetSourceType: null,
            isOwnBudget: false,
            baseBudget: null,
            safetyBuffer: null,
            actualSpend: effectiveSpend,
            rawSpend: itemsSum,
            remainingBase: null,
            overrun: null,
            utilizationPct: null,
            riskBand: taskRisk,
            isOverBudget: taskRisk === 'ORANGE' || taskRisk === 'RED',
            hasSummary: true,
            rawEntity: tx,
          });
        }

        // 6. Structure Hierarchy Options for Cascading Filters
        const uniqueOwners = Array.from(
          new Set(
            normalizedRows
              .filter((r) => r.ownerId)
              .map((r) => JSON.stringify({ id: r.ownerId, name: r.ownerName }))
          )
        ).map((s) => JSON.parse(s));

        const uniqueCreators = Array.from(
          new Set(
            normalizedRows
              .filter((r) => r.createdBy)
              .map((r) => JSON.stringify({ id: r.createdBy, name: r.creatorName }))
          )
        ).map((s) => JSON.parse(s));

        const uniqueDepts = Array.from(
          new Set(
            normalizedRows
              .filter((r) => r.departmentName && r.departmentName !== 'Unassigned')
              .map((r) => JSON.stringify({ id: r.departmentId, name: r.departmentName, code: r.departmentCode }))
          )
        ).map((s) => JSON.parse(s));

        const hierarchy = {
          projects: rawProjects,
          phases: rawPhases,
          taskLists: rawTaskLists,
          tasks: rawTasks,
          owners: uniqueOwners,
          creators: uniqueCreators,
          departments: uniqueDepts,
        };

        const normalizedWsSummary = normalizeFinancialSummary(wsSummaryRes.data);

        // Store into cache and update state
        financialExplorerCache.set(cacheKey, {
          normalizedRows,
          workspaceSummary: normalizedWsSummary,
          hierarchyData: hierarchy,
        });

        setRows(normalizedRows);
        setWorkspaceSummary(normalizedWsSummary);
        setHierarchyData(hierarchy);
      } catch (err) {
        if (fetchId !== activeFetchIdRef.current) return;
        console.error('[useFinancialExplorer] fetchExplorerData error:', err);
        setError(err.message || 'Failed to load Financial Explorer data.');

        if (!financialExplorerCache.has(cacheKey)) {
          setRows([]);
          setWorkspaceSummary(null);
        }
      } finally {
        if (fetchId === activeFetchIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [workspaceId, userId, enabled, cacheKey]
  );

  useEffect(() => {
    fetchExplorerData();
  }, [fetchExplorerData]);

  return {
    rows,
    workspaceSummary,
    hierarchyData,
    loading,
    refreshing,
    error,
    refetch: fetchExplorerData,
  };
}
