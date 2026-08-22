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
 * - Full validation of all core database queries (fails safe, never silently coerces failure to empty data)
 * - Summary RPC error handling: never fakes ₹0/GREEN/UNBUDGETED on RPC failure
 * - Primary department only (dm.is_active = true AND dm.is_primary = true)
 * - Canonical owner resolution for Phase (phase.owner_id) and Task List (task_list.owner_id)
 * - Mixed-row financial activity date filter semantics
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

        // 1. Parallel fetch: Finance-authorized metadata RPC + Finance-authorized financial data
        //    ARCHITECTURAL NOTE: projects/phases/task_lists/tasks/profiles/departments are fetched
        //    via get_workspace_finance_explorer_metadata (SECURITY INVOKER → private SECURITY DEFINER
        //    internal) which validates Finance authorization and bypasses operational RLS so Finance
        //    Operators see all workspace hierarchy — not just operationally involved phases/task_lists.
        //    budgets and expense_transactions use their existing Finance-authorized RLS.
        const [
          wsSummaryRes,
          metadataRes,
          budgetsRes,
          expensesRes,
        ] = await Promise.all([
          supabase.rpc('get_workspace_financial_summary', { p_workspace_id: workspaceId }),
          supabase.rpc('get_workspace_finance_explorer_metadata', { p_workspace_id: workspaceId }),
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
        ]);

        if (fetchId !== activeFetchIdRef.current) return;

        // Explicitly check errors from all initial parallel queries
        if (wsSummaryRes.error) throw wsSummaryRes.error;
        if (metadataRes.error) throw metadataRes.error;
        if (budgetsRes.error) throw budgetsRes.error;
        if (expensesRes.error) throw expensesRes.error;

        // Extract metadata from the Finance-authorized RPC response
        const metadata = metadataRes.data || {};
        const rawProjects = metadata.projects || [];
        const rawPhases = metadata.phases || [];
        const rawTaskLists = metadata.task_lists || [];
        // Merge task_statuses onto tasks (RPC returns statuses separately)
        const taskStatusesById = new Map((metadata.task_statuses || []).map((ts) => [ts.id, ts]));
        const rawTasks = (metadata.tasks || []).map((t) => ({
          ...t,
          task_statuses: t.status_id ? (taskStatusesById.get(t.status_id) || null) : null,
        }));
        // Build profiles map from Finance-scoped profiles (only referenced identities)
        const rawProfiles = metadata.profiles || [];
        // Build primary department map from Finance-scoped primary_departments
        const rawPrimaryDepts = metadata.primary_departments || [];

        const rawBudgets = budgetsRes.data || [];
        const rawExpenses = expensesRes.data || [];

        if (fetchId !== activeFetchIdRef.current) return;

        // 3. Fetch canonical financial summaries via bounded concurrency pool
        // Track summary state per entity: { state: 'loaded' | 'error', data: summary | null, error: err | null }
        const summariesMap = new Map(); // `${type}:${id}` -> { state, data, error }

        // Project summaries
        await pMap(rawProjects, async (p) => {
          try {
            const { data, error } = await supabase.rpc('get_project_financial_summary', { p_project_id: p.id });
            if (error) {
              summariesMap.set(`project:${p.id}`, { state: 'error', data: null, error: error.message || 'RPC error' });
            } else if (data) {
              summariesMap.set(`project:${p.id}`, { state: 'loaded', data: normalizeFinancialSummary(data), error: null });
            } else {
              summariesMap.set(`project:${p.id}`, { state: 'error', data: null, error: 'Empty summary' });
            }
          } catch (err) {
            summariesMap.set(`project:${p.id}`, { state: 'error', data: null, error: err.message || 'RPC error' });
          }
        }, 5);

        // Phase summaries
        await pMap(rawPhases, async (ph) => {
          try {
            const { data, error } = await supabase.rpc('get_phase_financial_summary', { p_phase_id: ph.id });
            if (error) {
              summariesMap.set(`phase:${ph.id}`, { state: 'error', data: null, error: error.message || 'RPC error' });
            } else if (data) {
              summariesMap.set(`phase:${ph.id}`, { state: 'loaded', data: normalizeFinancialSummary(data), error: null });
            } else {
              summariesMap.set(`phase:${ph.id}`, { state: 'error', data: null, error: 'Empty summary' });
            }
          } catch (err) {
            summariesMap.set(`phase:${ph.id}`, { state: 'error', data: null, error: err.message || 'RPC error' });
          }
        }, 5);

        // Task List summaries
        await pMap(rawTaskLists, async (tl) => {
          try {
            const { data, error } = await supabase.rpc('get_task_list_financial_summary', { p_task_list_id: tl.id });
            if (error) {
              summariesMap.set(`task_list:${tl.id}`, { state: 'error', data: null, error: error.message || 'RPC error' });
            } else if (data) {
              summariesMap.set(`task_list:${tl.id}`, { state: 'loaded', data: normalizeFinancialSummary(data), error: null });
            } else {
              summariesMap.set(`task_list:${tl.id}`, { state: 'error', data: null, error: 'Empty summary' });
            }
          } catch (err) {
            summariesMap.set(`task_list:${tl.id}`, { state: 'error', data: null, error: err.message || 'RPC error' });
          }
        }, 5);

        if (fetchId !== activeFetchIdRef.current) return;

        // 4. Build Lookup Indices
        const profilesMap = new Map(rawProfiles.map((pr) => [pr.id, pr.full_name]));
        
        // Resolve PRIMARY active department per user in current workspace (from metadata RPC)
        const userPrimaryDeptMap = new Map(); // userId -> { id, name, code }
        for (const pd of rawPrimaryDepts) {
          if (pd.user_id && pd.department_id) {
            userPrimaryDeptMap.set(pd.user_id, {
              id: pd.department_id,
              name: pd.department_name,
              code: pd.department_code,
            });
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

        // Calculate direct leaf expenses per task (excluding voided) and map expense dates for descendants
        const taskLeafSpendMap = new Map(); // taskId -> total effective spend
        const taskExpensesListMap = new Map(); // taskId -> expense_transactions[]
        const descendantExpenseDatesMap = new Map(); // entityKey -> Set of expense_date strings

        function recordDescendantExpenseDate(key, dateStr) {
          if (!key || !dateStr) return;
          if (!descendantExpenseDatesMap.has(key)) {
            descendantExpenseDatesMap.set(key, new Set());
          }
          descendantExpenseDatesMap.get(key).add(dateStr);
        }

        for (const tx of rawExpenses) {
          if (!taskExpensesListMap.has(tx.task_id)) {
            taskExpensesListMap.set(tx.task_id, []);
          }
          taskExpensesListMap.get(tx.task_id).push(tx);

          if (tx.status !== 'voided') {
            const itemsSum = (tx.expense_items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
            taskLeafSpendMap.set(tx.task_id, (taskLeafSpendMap.get(tx.task_id) || 0) + itemsSum);
          }

          const expDate = tx.expense_date;
          if (expDate) {
            recordDescendantExpenseDate(`task:${tx.task_id}`, expDate);
            const parentT = tasksMap.get(tx.task_id);
            if (parentT) {
              if (parentT.task_list_id) recordDescendantExpenseDate(`task_list:${parentT.task_list_id}`, expDate);
              if (parentT.phase_id) recordDescendantExpenseDate(`phase:${parentT.phase_id}`, expDate);
              if (parentT.project_id) recordDescendantExpenseDate(`project:${parentT.project_id}`, expDate);
            }
          }
        }

        // 5. Generate Normalized Explorer Rows
        const normalizedRows = [];

        // 5.1 Project Rows
        for (const p of rawProjects) {
          const summaryEntry = summariesMap.get(`project:${p.id}`) || null;
          const summary = summaryEntry?.state === 'loaded' ? summaryEntry.data : null;
          const hasSummaryError = summaryEntry?.state === 'error';
          const ownBudget = budgetsMap.get(`project:${p.id}`) || null;
          const ownerDept = userPrimaryDeptMap.get(p.owner_id);

          const baseBudgetVal = summary ? summary.base_budget : (ownBudget?.base_budget ?? null);
          const safetyBufferVal = summary ? summary.safety_buffer : (ownBudget?.safety_buffer ?? null);

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
            ownerId: p.owner_id || null,
            ownerName: profilesMap.get(p.owner_id) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: p.created_by,
            creatorName: profilesMap.get(p.created_by) || 'System',
            status: p.project_status || 'Active',
            normalizedStatus: (p.project_status || 'Active').toLowerCase() === 'active' ? 'Active' : (p.project_status || 'Active'),
            date: p.created_at ? p.created_at.slice(0, 10) : '—',
            descendantExpenseDates: Array.from(descendantExpenseDatesMap.get(`project:${p.id}`) || []),
            budgetSource: ownBudget ? 'Project Budget' : 'Unbudgeted',
            budgetSourceId: summary?.budget_source_id || ownBudget?.id || null,
            budgetSourceType: summary?.budget_source_type || (ownBudget ? 'project' : null),
            isOwnBudget: Boolean(ownBudget),
            baseBudget: hasSummaryError ? (ownBudget?.base_budget ?? null) : baseBudgetVal,
            safetyBuffer: hasSummaryError ? (ownBudget?.safety_buffer ?? null) : safetyBufferVal,
            actualSpend: hasSummaryError ? null : (summary ? summary.actual_spend : 0),
            remainingBase: hasSummaryError ? null : (summary ? summary.remaining_base : (baseBudgetVal ?? 0)),
            overrun: hasSummaryError ? null : (summary ? summary.overrun : 0),
            utilizationPct: hasSummaryError ? null : (summary ? summary.utilization_pct : 0),
            riskBand: hasSummaryError ? null : (summary?.risk_band || (ownBudget ? 'GREEN' : 'UNBUDGETED')),
            isOverBudget: summary ? (summary.overrun > 0 || summary.risk_band === 'ORANGE' || summary.risk_band === 'RED') : false,
            hasSummary: Boolean(summary),
            hasSummaryError,
            searchableText: `${p.name} Project ${p.project_status || 'Active'} ${profilesMap.get(p.owner_id) || ''} ${profilesMap.get(p.created_by) || ''} ${ownerDept?.name || ''}`.toLowerCase(),
            rawEntity: p,
          });
        }

        // 5.2 Phase Rows
        for (const ph of rawPhases) {
          const summaryEntry = summariesMap.get(`phase:${ph.id}`) || null;
          const summary = summaryEntry?.state === 'loaded' ? summaryEntry.data : null;
          const hasSummaryError = summaryEntry?.state === 'error';
          const ownBudget = budgetsMap.get(`phase:${ph.id}`) || null;
          const parentProj = projectsMap.get(ph.project_id);
          
          // Phase canonical owner: ph.owner_id
          const phaseOwnerId = ph.owner_id || null;
          const ownerDept = userPrimaryDeptMap.get(phaseOwnerId);

          const baseBudgetVal = summary ? summary.base_budget : (ownBudget?.base_budget ?? null);
          const safetyBufferVal = summary ? summary.safety_buffer : (ownBudget?.safety_buffer ?? null);

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
            ownerId: phaseOwnerId,
            ownerName: profilesMap.get(phaseOwnerId) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: ph.created_by,
            creatorName: profilesMap.get(ph.created_by) || 'System',
            status: '—', // Phases do not have active/completed status in P6
            normalizedStatus: '—',
            date: ph.created_at ? ph.created_at.slice(0, 10) : '—',
            descendantExpenseDates: Array.from(descendantExpenseDatesMap.get(`phase:${ph.id}`) || []),
            budgetSource: ownBudget
              ? 'Phase Budget'
              : summary?.budget_source_type === 'project'
              ? 'Inherited from Project'
              : 'Unbudgeted',
            budgetSourceId: summary?.budget_source_id || ownBudget?.id || null,
            budgetSourceType: ownBudget ? 'phase' : summary?.budget_source_type || null,
            isOwnBudget: Boolean(ownBudget),
            baseBudget: hasSummaryError ? (ownBudget?.base_budget ?? null) : baseBudgetVal,
            safetyBuffer: hasSummaryError ? (ownBudget?.safety_buffer ?? null) : safetyBufferVal,
            actualSpend: hasSummaryError ? null : (summary ? summary.actual_spend : 0),
            remainingBase: hasSummaryError ? null : (summary ? summary.remaining_base : 0),
            overrun: hasSummaryError ? null : (summary ? summary.overrun : 0),
            utilizationPct: hasSummaryError ? null : (summary ? summary.utilization_pct : 0),
            riskBand: hasSummaryError ? null : (summary?.risk_band || (ownBudget ? 'GREEN' : 'UNBUDGETED')),
            isOverBudget: summary ? (summary.overrun > 0 || summary.risk_band === 'ORANGE' || summary.risk_band === 'RED') : false,
            hasSummary: Boolean(summary),
            hasSummaryError,
            searchableText: `${ph.name} Phase ${parentProj?.name || ''} ${profilesMap.get(phaseOwnerId) || ''} ${profilesMap.get(ph.created_by) || ''} ${ownerDept?.name || ''}`.toLowerCase(),
            rawEntity: ph,
          });
        }

        // 5.3 Task List Rows
        for (const tl of rawTaskLists) {
          const summaryEntry = summariesMap.get(`task_list:${tl.id}`) || null;
          const summary = summaryEntry?.state === 'loaded' ? summaryEntry.data : null;
          const hasSummaryError = summaryEntry?.state === 'error';
          const ownBudget = budgetsMap.get(`task_list:${tl.id}`) || null;
          const parentProj = projectsMap.get(tl.project_id);
          const parentPhase = phasesMap.get(tl.phase_id);
          
          // Task list canonical owner: tl.owner_id
          const taskListOwnerId = tl.owner_id || null;
          const ownerDept = userPrimaryDeptMap.get(taskListOwnerId);

          const baseBudgetVal = summary ? summary.base_budget : (ownBudget?.base_budget ?? null);
          const safetyBufferVal = summary ? summary.safety_buffer : (ownBudget?.safety_buffer ?? null);

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
            ownerId: taskListOwnerId,
            ownerName: profilesMap.get(taskListOwnerId) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: tl.created_by,
            creatorName: profilesMap.get(tl.created_by) || 'System',
            status: tl.completed_at ? 'Completed' : 'Active',
            normalizedStatus: tl.completed_at ? 'Completed' : 'Active',
            date: tl.created_at ? tl.created_at.slice(0, 10) : '—',
            descendantExpenseDates: Array.from(descendantExpenseDatesMap.get(`task_list:${tl.id}`) || []),
            budgetSource: ownBudget
              ? 'Task List Budget'
              : summary?.budget_source_type === 'phase'
              ? 'Inherited from Phase'
              : summary?.budget_source_type === 'project'
              ? 'Inherited from Project'
              : 'Unbudgeted',
            budgetSourceId: summary?.budget_source_id || ownBudget?.id || null,
            budgetSourceType: ownBudget ? 'task_list' : summary?.budget_source_type || null,
            isOwnBudget: Boolean(ownBudget),
            baseBudget: hasSummaryError ? (ownBudget?.base_budget ?? null) : baseBudgetVal,
            safetyBuffer: hasSummaryError ? (ownBudget?.safety_buffer ?? null) : safetyBufferVal,
            actualSpend: hasSummaryError ? null : (summary ? summary.actual_spend : 0),
            remainingBase: hasSummaryError ? null : (summary ? summary.remaining_base : 0),
            overrun: hasSummaryError ? null : (summary ? summary.overrun : 0),
            utilizationPct: hasSummaryError ? null : (summary ? summary.utilization_pct : 0),
            riskBand: hasSummaryError ? null : (summary?.risk_band || (ownBudget ? 'GREEN' : 'UNBUDGETED')),
            isOverBudget: summary ? (summary.overrun > 0 || summary.risk_band === 'ORANGE' || summary.risk_band === 'RED') : false,
            hasSummary: Boolean(summary),
            hasSummaryError,
            searchableText: `${tl.name} Task List ${parentPhase?.name || ''} ${parentProj?.name || ''} ${profilesMap.get(taskListOwnerId) || ''} ${profilesMap.get(tl.created_by) || ''} ${ownerDept?.name || ''}`.toLowerCase(),
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

          // Determine nearest budget-owning ancestor and ancestor summary status
          let nearestBudgetSource = 'Unbudgeted';
          let ancestorSummary = null;
          let ancestorSummaryError = false;

          if (t.task_list_id) {
            const tlEntry = summariesMap.get(`task_list:${t.task_list_id}`);
            if (tlEntry?.state === 'error') {
              ancestorSummaryError = true;
            } else if (tlEntry?.state === 'loaded') {
              ancestorSummary = tlEntry.data;
              nearestBudgetSource = budgetsMap.has(`task_list:${t.task_list_id}`)
                ? 'Inherited from Task List'
                : ancestorSummary.budget_source_type === 'phase'
                ? 'Inherited from Phase'
                : 'Inherited from Project';
            }
          }

          if (!ancestorSummary && !ancestorSummaryError && t.phase_id) {
            const phEntry = summariesMap.get(`phase:${t.phase_id}`);
            if (phEntry?.state === 'error') {
              ancestorSummaryError = true;
            } else if (phEntry?.state === 'loaded') {
              ancestorSummary = phEntry.data;
              nearestBudgetSource = 'Inherited from Phase';
            }
          }

          if (!ancestorSummary && !ancestorSummaryError && t.project_id) {
            const pEntry = summariesMap.get(`project:${t.project_id}`);
            if (pEntry?.state === 'error') {
              ancestorSummaryError = true;
            } else if (pEntry?.state === 'loaded') {
              ancestorSummary = pEntry.data;
              nearestBudgetSource = 'Inherited from Project';
            }
          }

          if (!ancestorSummary && !ancestorSummaryError && isStandalone) {
            nearestBudgetSource = 'Unbudgeted / Standalone';
          }

          const taskSpend = taskLeafSpendMap.get(t.id) || 0;
          const taskOwnerId = t.owner_id || t.assignee_id || null;
          const ownerDept = userPrimaryDeptMap.get(taskOwnerId);

          const sysCode = (t.task_statuses?.system_code || 'todo').toLowerCase();
          const taskStatus = sysCode === 'done' ? 'Completed' : sysCode === 'cancelled' ? 'Cancelled' : 'Active';

          const taskRisk = ancestorSummaryError
            ? null
            : isStandalone
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
            ownerId: taskOwnerId,
            ownerName: profilesMap.get(taskOwnerId) || 'Unassigned',
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: t.created_by,
            creatorName: profilesMap.get(t.created_by) || 'System',
            status: taskStatus,
            normalizedStatus: taskStatus,
            date: t.created_at ? t.created_at.slice(0, 10) : '—',
            descendantExpenseDates: Array.from(descendantExpenseDatesMap.get(`task:${t.id}`) || []),
            budgetSource: ancestorSummaryError ? 'Budget context unavailable' : nearestBudgetSource,
            budgetSourceId: ancestorSummary?.budget_source_id || null,
            budgetSourceType: ancestorSummary?.budget_source_type || null,
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
            hasSummaryError: ancestorSummaryError,
            searchableText: `${t.title} ${taskVariantLabel} ${taskStatus} ${parentProj?.name || ''} ${parentPhase?.name || ''} ${parentTaskList?.name || ''} ${profilesMap.get(taskOwnerId) || ''} ${profilesMap.get(t.created_by) || ''} ${ownerDept?.name || ''}`.toLowerCase(),
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
          const ownerDept = userPrimaryDeptMap.get(taskOwnerId);

          const itemsSum = (tx.expense_items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
          const effectiveSpend = tx.status === 'voided' ? 0 : itemsSum;

          // Find task's budget context
          let taskRisk = 'GREEN';
          let budgetSource = 'Unbudgeted';
          let budgetSourceId = null;
          let budgetSourceType = null;
          let hasSummaryError = false;

          if (parentTask) {
            const taskRow = normalizedRows.find((r) => r.id === `task-${parentTask.id}`);
            if (taskRow) {
              taskRisk = taskRow.riskBand;
              budgetSource = taskRow.budgetSource;
              budgetSourceId = taskRow.budgetSourceId;
              budgetSourceType = taskRow.budgetSourceType;
              hasSummaryError = taskRow.hasSummaryError;
            }
          }

          const primaryDesc = tx.description || tx.expense_items?.[0]?.description || tx.expense_items?.[0]?.category || 'Expense Entry';

          // Searchable text aggregating ALL expense items
          const itemsSearchText = (tx.expense_items || [])
            .map((it) => `${it.category || ''} ${it.description || ''}`)
            .join(' ');

          const expOwnerName = profilesMap.get(taskOwnerId) || 'Unassigned';
          const expCreatorName = profilesMap.get(tx.created_by) || 'System';

          const normalizedExpStatus =
            tx.status === 'active'
              ? 'Active'
              : tx.status === 'corrected'
              ? 'Corrected'
              : tx.status === 'voided'
              ? 'Voided'
              : tx.status;

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
            ownerId: taskOwnerId,
            ownerName: expOwnerName,
            departmentId: ownerDept?.id || null,
            departmentName: ownerDept?.name || 'Unassigned',
            departmentCode: ownerDept?.code || '—',
            createdBy: tx.created_by,
            creatorName: expCreatorName,
            status: tx.status,
            normalizedStatus: normalizedExpStatus,
            date: tx.expense_date || (tx.created_at ? tx.created_at.slice(0, 10) : '—'),
            descendantExpenseDates: [tx.expense_date].filter(Boolean),
            budgetSource: hasSummaryError ? 'Budget context unavailable' : budgetSource,
            budgetSourceId,
            budgetSourceType,
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
            hasSummary: !hasSummaryError,
            hasSummaryError,
            searchableText: `${primaryDesc} ${tx.description || ''} ${parentTask?.title || ''} ${parentProj?.name || ''} ${parentPhase?.name || ''} ${parentTaskList?.name || ''} ${expOwnerName} ${expCreatorName} ${ownerDept?.name || ''} ${itemsSearchText}`.toLowerCase(),
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

        // If cache exists, preserve last known good data and surface non-blocking error
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
