import React, { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Compass,
  Sliders,
  Receipt,
  Search,
  RefreshCw,
  Download,
  AlertTriangle,
  ShieldAlert,
  Layers,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { useFinanceAccess } from '../hooks/useFinanceAccess.js';
import { useFinancialExplorer } from '../hooks/useFinancialExplorer.js';
import { useExpenseLedger } from '../hooks/useExpenseLedger.js';
import { useFinancialExplorerSavedViews } from '../hooks/useFinancialExplorerSavedViews.js';
import { formatCurrency } from '../lib/expenseExecution.js';
import PageHeader from '../components/PageHeader.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { MetricCardsSkeleton, Skeleton } from '../components/Skeleton.jsx';
import ExpenseDetailModal from '../components/finance/ExpenseDetailModal.jsx';
import FinancialExplorerSavedViewsBar from '../components/finance/FinancialExplorerSavedViewsBar.jsx';
import styles from './FinancialExplorerPage.module.css';

function ExplorerSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0' }}>
      <MetricCardsSkeleton count={5} />
      <Skeleton height="80px" radius="var(--radius-sm)" />
      <Skeleton height="360px" radius="var(--radius-sm)" />
    </div>
  );
}

export default function FinancialExplorerPage() {
  const { workspaceId } = useParams();

  const financeAccess = useFinanceAccess(workspaceId);
  const {
    canViewWorkspaceFinance,
    canManageBudgets,
    isFinanceOperator,
    financeAccessLoading,
    financeAccessError,
    authorizationScopeKey,
  } = financeAccess;

  const {
    rows,
    hierarchyData,
    loading: explorerLoading,
    refreshing,
    error: explorerError,
    refetch,
  } = useFinancialExplorer(workspaceId, authorizationScopeKey, {
    enabled: canViewWorkspaceFinance && !financeAccessError,
  });

  // Reusable ledger methods for expense inspection
  const { fetchTransactionAudit } = useExpenseLedger(workspaceId, authorizationScopeKey, {
    enabled: canViewWorkspaceFinance && !financeAccessError,
  });

  // Filter States
  const [entityType, setEntityType] = useState('all');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedPhase, setSelectedPhase] = useState('all');
  const [selectedTaskList, setSelectedTaskList] = useState('all');
  const [selectedTask, setSelectedTask] = useState('all');
  const [selectedOwner, setSelectedOwner] = useState('all');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedRisk, setSelectedRisk] = useState('all');
  const [overBudgetOnly, setOverBudgetOnly] = useState(false);
  const [selectedCreator, setSelectedCreator] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Grouping & Sorting States
  const [groupBy, setGroupBy] = useState('none'); // 'none' | 'project' | 'phase' | 'task_list' | 'owner' | 'department' | 'rowType' | 'status' | 'riskBand'
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'actualSpend' | 'utilizationPct' | 'riskBand' | 'date' | 'ownerName'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'

  // Selected Expense for Detail Inspection
  const [selectedExpenseForDetail, setSelectedExpenseForDetail] = useState(null);

  // Saved Views hook
  const {
    savedViews,
    loading: savedViewsLoading,
    error: savedViewsError,
    activeSavedViewId,
    isSaving: savedViewsSaving,
    fetchSavedViews,
    selectSavedView,
    createSavedView,
    updateSavedView,
    renameSavedView,
    deleteSavedView,
    hasUnsavedChanges,
  } = useFinancialExplorerSavedViews(workspaceId);

  // Clear local filters on workspace change
  useEffect(() => {
    setEntityType('all');
    setSelectedProject('all');
    setSelectedPhase('all');
    setSelectedTaskList('all');
    setSelectedTask('all');
    setSelectedOwner('all');
    setSelectedDepartment('all');
    setSelectedStatus('all');
    setSelectedRisk('all');
    setOverBudgetOnly(false);
    setSelectedCreator('all');
    setDateFrom('');
    setDateTo('');
    setAmountMin('');
    setAmountMax('');
    setSearchQuery('');
    setGroupBy('none');
    setSortBy('name');
    setSortOrder('asc');
    setSelectedExpenseForDetail(null);
  }, [workspaceId]);

  // Current Explorer Configuration State Bundle
  const currentExplorerState = useMemo(
    () => ({
      entityType,
      selectedProject,
      selectedPhase,
      selectedTaskList,
      selectedTask,
      selectedOwner,
      selectedDepartment,
      selectedStatus,
      selectedRisk,
      overBudgetOnly,
      selectedCreator,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      searchQuery,
      groupBy,
      sortBy,
      sortOrder,
    }),
    [
      entityType,
      selectedProject,
      selectedPhase,
      selectedTaskList,
      selectedTask,
      selectedOwner,
      selectedDepartment,
      selectedStatus,
      selectedRisk,
      overBudgetOnly,
      selectedCreator,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      searchQuery,
      groupBy,
      sortBy,
      sortOrder,
    ]
  );

  // Metadata bundle for hierarchy validation
  const metadataBundle = useMemo(
    () => ({
      projects: hierarchyData.projects,
      phases: hierarchyData.phases,
      task_lists: hierarchyData.taskLists,
      tasks: hierarchyData.tasks,
      profiles: hierarchyData.profiles,
      primary_departments: hierarchyData.primaryDepartments,
    }),
    [hierarchyData]
  );

  const isCurrentViewDirty = hasUnsavedChanges(currentExplorerState);

  const handleApplySavedView = (viewId) => {
    if (!viewId) {
      selectSavedView(null);
      return;
    }
    const normalized = selectSavedView(viewId, metadataBundle);
    if (normalized) {
      setEntityType(normalized.entityType);
      setSelectedProject(normalized.selectedProject);
      setSelectedPhase(normalized.selectedPhase);
      setSelectedTaskList(normalized.selectedTaskList);
      setSelectedTask(normalized.selectedTask);
      setSelectedOwner(normalized.selectedOwner);
      setSelectedDepartment(normalized.selectedDepartment);
      setSelectedStatus(normalized.selectedStatus);
      setSelectedRisk(normalized.selectedRisk);
      setOverBudgetOnly(normalized.overBudgetOnly);
      setSelectedCreator(normalized.selectedCreator);
      setDateFrom(normalized.dateFrom);
      setDateTo(normalized.dateTo);
      setAmountMin(normalized.amountMin);
      setAmountMax(normalized.amountMax);
      setSearchQuery(normalized.searchQuery);
      setGroupBy(normalized.groupBy);
      setSortBy(normalized.sortBy);
      setSortOrder(normalized.sortOrder);
    }
  };

  const handleSaveCurrentView = async (name) => {
    await createSavedView(name, currentExplorerState, metadataBundle);
  };

  const handleUpdateCurrentView = async (viewId) => {
    await updateSavedView(viewId, currentExplorerState, metadataBundle);
  };

  const handleRenameView = async (viewId, newName) => {
    await renameSavedView(viewId, newName);
  };

  const handleDeleteView = async (viewId) => {
    await deleteSavedView(viewId);
  };

  // Cascading Filter Option Lists
  const availablePhases = useMemo(() => {
    if (selectedProject === 'all') return hierarchyData.phases || [];
    return (hierarchyData.phases || []).filter((ph) => ph.project_id === selectedProject);
  }, [hierarchyData.phases, selectedProject]);

  const availableTaskLists = useMemo(() => {
    let lists = hierarchyData.taskLists || [];
    if (selectedProject !== 'all') {
      lists = lists.filter((tl) => tl.project_id === selectedProject);
    }
    if (selectedPhase !== 'all') {
      lists = lists.filter((tl) => tl.phase_id === selectedPhase);
    }
    return lists;
  }, [hierarchyData.taskLists, selectedProject, selectedPhase]);

  const availableTasks = useMemo(() => {
    let ts = hierarchyData.tasks || [];
    if (selectedProject !== 'all') {
      ts = ts.filter((t) => t.project_id === selectedProject);
    }
    if (selectedPhase !== 'all') {
      ts = ts.filter((t) => t.phase_id === selectedPhase);
    }
    if (selectedTaskList !== 'all') {
      ts = ts.filter((t) => t.task_list_id === selectedTaskList);
    }
    return ts;
  }, [hierarchyData.tasks, selectedProject, selectedPhase, selectedTaskList]);

  // Handle Cascading Filter Changes
  const handleProjectChange = (val) => {
    setSelectedProject(val);
    if (val === 'all') {
      setSelectedPhase('all');
      setSelectedTaskList('all');
      setSelectedTask('all');
    } else {
      if (selectedPhase !== 'all') {
        const ph = availablePhases.find((p) => p.id === selectedPhase);
        if (!ph || ph.project_id !== val) setSelectedPhase('all');
      }
      setSelectedTaskList('all');
      setSelectedTask('all');
    }
  };

  const handlePhaseChange = (val) => {
    setSelectedPhase(val);
    if (val === 'all') {
      setSelectedTaskList('all');
      setSelectedTask('all');
    } else {
      if (selectedTaskList !== 'all') {
        const tl = availableTaskLists.find((t) => t.id === selectedTaskList);
        if (!tl || tl.phase_id !== val) setSelectedTaskList('all');
      }
      setSelectedTask('all');
    }
  };

  const handleTaskListChange = (val) => {
    setSelectedTaskList(val);
    if (val === 'all') {
      setSelectedTask('all');
    } else {
      if (selectedTask !== 'all') {
        const t = availableTasks.find((item) => item.id === selectedTask);
        if (!t || t.task_list_id !== val) setSelectedTask('all');
      }
    }
  };

  const handleResetFilters = () => {
    setEntityType('all');
    setSelectedProject('all');
    setSelectedPhase('all');
    setSelectedTaskList('all');
    setSelectedTask('all');
    setSelectedOwner('all');
    setSelectedDepartment('all');
    setSelectedStatus('all');
    setSelectedRisk('all');
    setOverBudgetOnly(false);
    setSelectedCreator('all');
    setDateFrom('');
    setDateTo('');
    setAmountMin('');
    setAmountMax('');
    setSearchQuery('');
  };

  const hasActiveFilters =
    entityType !== 'all' ||
    selectedProject !== 'all' ||
    selectedPhase !== 'all' ||
    selectedTaskList !== 'all' ||
    selectedTask !== 'all' ||
    selectedOwner !== 'all' ||
    selectedDepartment !== 'all' ||
    selectedStatus !== 'all' ||
    selectedRisk !== 'all' ||
    overBudgetOnly ||
    selectedCreator !== 'all' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    amountMin !== '' ||
    amountMax !== '' ||
    searchQuery.trim() !== '';

  // Filter Execution
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // 1. Entity Type
      if (entityType !== 'all') {
        if (entityType === 'standalone') {
          if (!r.isStandalone) return false;
        } else if (r.rowType !== entityType) {
          return false;
        }
      }

      // 2. Project
      if (selectedProject !== 'all') {
        if (r.projectId !== selectedProject) return false;
      }

      // 3. Phase
      if (selectedPhase !== 'all') {
        if (r.phaseId !== selectedPhase) return false;
      }

      // 4. Task List
      if (selectedTaskList !== 'all') {
        if (r.taskListId !== selectedTaskList) return false;
      }

      // 5. Task
      if (selectedTask !== 'all') {
        if (r.taskId !== selectedTask) return false;
      }

      // 6. Owner
      if (selectedOwner !== 'all') {
        if (r.ownerId !== selectedOwner) return false;
      }

      // 7. Department (Owner's primary active department)
      if (selectedDepartment !== 'all') {
        if (r.departmentName !== selectedDepartment) return false;
      }

      // 8. Status (Normalized across Projects, Tasks, Task Lists, Expenses)
      if (selectedStatus !== 'all') {
        if (r.rowType === 'phase') return false; // Phases excluded from status filtering per Req 17
        const matchStatus = r.normalizedStatus === selectedStatus || r.status === selectedStatus;
        if (!matchStatus) return false;
      }

      // 9. Risk Band (summary-error rows should NOT match GREEN or UNBUDGETED)
      if (selectedRisk !== 'all') {
        if (r.hasSummaryError) return false;
        if (r.riskBand !== selectedRisk) return false;
      }

      // 10. Over-Budget Only
      if (overBudgetOnly) {
        if (r.hasSummaryError || !r.isOverBudget) return false;
      }

      // 11. Creator
      if (selectedCreator !== 'all') {
        if (r.createdBy !== selectedCreator) return false;
      }

      // 12. Date Range (Financial activity semantics)
      if (dateFrom || dateTo) {
        if (r.rowType === 'expense') {
          if (dateFrom && (r.date === '—' || r.date < dateFrom)) return false;
          if (dateTo && (r.date === '—' || r.date > dateTo)) return false;
        } else if (r.rowType === 'task') {
          const selfMatch = (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo) && r.date !== '—';
          const childExpenseMatch = (r.descendantExpenseDates || []).some(
            (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
          );
          if (!selfMatch && !childExpenseMatch) return false;
        } else {
          // Project / Phase / Task List: retain if descendant expense matches, or if 0 expenses exist and container created_at matches
          const hasDescendantExpenses = (r.descendantExpenseDates || []).length > 0;
          if (hasDescendantExpenses) {
            const childExpenseMatch = r.descendantExpenseDates.some(
              (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
            );
            if (!childExpenseMatch) return false;
          } else {
            const selfMatch = (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo) && r.date !== '—';
            if (!selfMatch) return false;
          }
        }
      }

      // 13. Amount Min / Max
      const minNum = parseFloat(amountMin);
      if (!isNaN(minNum)) {
        if (r.actualSpend === null || r.actualSpend < minNum) return false;
      }
      const maxNum = parseFloat(amountMax);
      if (!isNaN(maxNum)) {
        if (r.actualSpend === null || r.actualSpend > maxNum) return false;
      }

      // 14. Text Search (Matches all expense items and normalized entity fields)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (r.searchableText && !r.searchableText.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [
    rows,
    entityType,
    selectedProject,
    selectedPhase,
    selectedTaskList,
    selectedTask,
    selectedOwner,
    selectedDepartment,
    selectedStatus,
    selectedRisk,
    overBudgetOnly,
    selectedCreator,
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
    searchQuery,
  ]);

  // Sorting: Unavailable/null values sort last
  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const riskPriority = { RED: 5, ORANGE: 4, YELLOW: 3, GREEN: 2, UNBUDGETED: 1 };

    list.sort((a, b) => {
      // If one has summary error and sorting by financial metric, push error to bottom
      if (sortBy === 'actualSpend' || sortBy === 'utilizationPct' || sortBy === 'riskBand') {
        const aNull = a.hasSummaryError || a[sortBy] === null;
        const bNull = b.hasSummaryError || b[sortBy] === null;
        if (aNull && !bNull) return 1;
        if (!aNull && bNull) return -1;
        if (aNull && bNull) return 0;
      }

      let cmp = 0;
      if (sortBy === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'actualSpend') {
        cmp = (a.actualSpend ?? 0) - (b.actualSpend ?? 0);
      } else if (sortBy === 'utilizationPct') {
        cmp = (a.utilizationPct ?? 0) - (b.utilizationPct ?? 0);
      } else if (sortBy === 'riskBand') {
        cmp = (riskPriority[a.riskBand] || 0) - (riskPriority[b.riskBand] || 0);
      } else if (sortBy === 'date') {
        cmp = (a.date || '').localeCompare(b.date || '');
      } else if (sortBy === 'ownerName') {
        cmp = (a.ownerName || '').localeCompare(b.ownerName || '');
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [filteredRows, sortBy, sortOrder]);

  // Grouping
  const groupedData = useMemo(() => {
    if (groupBy === 'none') {
      return [{ groupKey: 'all', groupTitle: 'All Entities', rows: sortedRows }];
    }

    const groupsMap = new Map();

    for (const r of sortedRows) {
      let key = 'Unassigned';
      let title = 'Unassigned';

      if (groupBy === 'project') {
        key = r.projectId || 'standalone';
        title = r.projectName || 'Standalone Work';
      } else if (groupBy === 'phase') {
        key = r.phaseId || 'no_phase';
        title = r.phaseName !== '—' ? r.phaseName : 'No Phase';
      } else if (groupBy === 'task_list') {
        key = r.taskListId || 'no_list';
        title = r.taskListName !== '—' ? r.taskListName : 'No Task List';
      } else if (groupBy === 'owner') {
        key = r.ownerId || 'unassigned';
        title = r.ownerName || 'Unassigned';
      } else if (groupBy === 'department') {
        key = r.departmentName || 'Unassigned';
        title = r.departmentName || 'Unassigned';
      } else if (groupBy === 'rowType') {
        key = r.rowType;
        title = r.rowType.toUpperCase();
      } else if (groupBy === 'status') {
        key = r.normalizedStatus || r.status;
        title = r.normalizedStatus || r.status;
      } else if (groupBy === 'riskBand') {
        key = r.hasSummaryError ? 'Unavailable' : (r.riskBand || 'UNBUDGETED');
        title = r.hasSummaryError ? 'Risk: Unavailable' : `Risk: ${r.riskBand || 'UNBUDGETED'}`;
      }

      if (!groupsMap.has(key)) {
        groupsMap.set(key, { groupKey: key, groupTitle: title, rows: [] });
      }
      groupsMap.get(key).rows.push(r);
    }

    return Array.from(groupsMap.values());
  }, [sortedRows, groupBy]);

  // Zero Double-Counting Summary Strip Metrics & Canonical High Risk Unit Deduplication
  const summaryStrip = useMemo(() => {
    const totalMatchedRows = filteredRows.length;

    // Effective spend: sum solely from matching physical leaf expense transactions
    const matchingExpenses = filteredRows.filter((r) => r.rowType === 'expense');
    let effectiveLeafSpend = 0;
    for (const exp of matchingExpenses) {
      effectiveLeafSpend += exp.actualSpend || 0;
    }

    // Unique projects count
    const uniqueProjectIds = new Set(
      filteredRows.filter((r) => r.projectId).map((r) => r.projectId)
    );

    // High Risk Count: Deduplicate by canonical budget source ID and type
    const highRiskBudgetSources = new Set();
    for (const r of filteredRows) {
      if (
        (r.rowType === 'project' || r.rowType === 'phase' || r.rowType === 'task_list') &&
        !r.hasSummaryError &&
        (r.riskBand === 'ORANGE' || r.riskBand === 'RED')
      ) {
        const sourceKey = r.budgetSourceId
          ? `${r.budgetSourceType || r.rowType}:${r.budgetSourceId}`
          : `${r.rowType}:${r.entityId}`;
        highRiskBudgetSources.add(sourceKey);
      }
    }

    return {
      totalMatchedRows,
      effectiveLeafSpend,
      expenseEntriesCount: matchingExpenses.length,
      projectsCount: uniqueProjectIds.size,
      highRiskCount: highRiskBudgetSources.size,
    };
  }, [filteredRows]);

  // Helper for computing group leaf spend (Zero double-counting)
  const computeGroupLeafSpend = (groupRows) => {
    return groupRows
      .filter((r) => r.rowType === 'expense')
      .reduce((sum, r) => sum + (r.actualSpend || 0), 0);
  };

  // CSV Export Handler
  const handleExportCSV = () => {
    if (!filteredRows.length) return;

    const headers = [
      'Type',
      'Name / Description',
      'Project',
      'Phase',
      'Task List',
      'Task',
      'Status',
      'Budget Source',
      'Base Budget (INR)',
      'Safety Buffer (INR)',
      'Actual Spend (INR)',
      'Remaining Base (INR)',
      'Overrun (INR)',
      'Utilization (%)',
      'Risk Band',
      'Date',
      'Owner',
      'Department',
      'Creator',
    ];

    const csvRows = [headers.join(',')];

    for (const r of sortedRows) {
      const rowData = [
        `"${(r.rowType || '').toUpperCase()}"`,
        `"${(r.name || '').replace(/"/g, '""')}"`,
        `"${(r.projectName || '').replace(/"/g, '""')}"`,
        `"${(r.phaseName || '').replace(/"/g, '""')}"`,
        `"${(r.taskListName || '').replace(/"/g, '""')}"`,
        `"${(r.taskTitle || '').replace(/"/g, '""')}"`,
        `"${r.status || '—'}"`,
        `"${r.budgetSource || 'Unbudgeted'}"`,
        r.baseBudget !== null && !r.hasSummaryError ? r.baseBudget.toFixed(2) : '""',
        r.safetyBuffer !== null && !r.hasSummaryError ? r.safetyBuffer.toFixed(2) : '""',
        r.actualSpend !== null && !r.hasSummaryError ? r.actualSpend.toFixed(2) : '""',
        r.remainingBase !== null && !r.hasSummaryError ? r.remainingBase.toFixed(2) : '""',
        r.overrun !== null && !r.hasSummaryError ? r.overrun.toFixed(2) : '""',
        r.utilizationPct !== null && !r.hasSummaryError ? r.utilizationPct.toFixed(2) : '""',
        `"${r.hasSummaryError ? 'Unavailable' : (r.riskBand || 'GREEN')}"`,
        `"${r.date || '—'}"`,
        `"${(r.ownerName || 'Unassigned').replace(/"/g, '""')}"`,
        `"${(r.departmentName || 'Unassigned').replace(/"/g, '""')}"`,
        `"${(r.creatorName || 'System').replace(/"/g, '""')}"`,
      ];
      csvRows.push(rowData.join(','));
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvRows.join('\n'));
    const link = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `sns-financial-explorer-${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 1. Loading State
  if (financeAccessLoading || (explorerLoading && rows.length === 0 && !explorerError)) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Financial Explorer"
          subtitle="Multi-dimensional financial drill-down & operational search"
        />
        <ExplorerSkeleton />
      </div>
    );
  }

  // 2. Authorization Error (Fail-Closed)
  if (financeAccessError) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Financial Explorer"
          subtitle="Multi-dimensional financial drill-down & operational search"
        />
        <EmptyState
          icon={ShieldAlert}
          title="Authorization Context Error"
          description="Failed to resolve your workspace financial authorization context. Access is restricted."
        />
      </div>
    );
  }

  // 3. Unauthorized / Access Restricted (Fail-Closed)
  if (!canViewWorkspaceFinance) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Financial Explorer"
          subtitle="Multi-dimensional financial drill-down & operational search"
        />
        <EmptyState
          icon={ShieldAlert}
          title="Access Restricted"
          description="You do not have authorization to access the Workspace Financial Explorer. Access is restricted to active Workspace Owners, Workspace Admins, Executives, and Finance Operators."
        />
      </div>
    );
  }

  // 4. Initial Error State with Retry
  if (explorerError && rows.length === 0) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Financial Explorer"
          subtitle="Multi-dimensional financial drill-down & operational search"
        />
        <div className={styles.errorContainer} role="alert">
          <AlertTriangle size={32} className={styles.errorIcon} />
          <div className={styles.errorTitle}>Failed to Load Financial Explorer</div>
          <div className={styles.errorDesc}>{explorerError}</div>
          <button type="button" className={styles.retryBtn} onClick={() => refetch()}>
            <RefreshCw size={14} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  const headerBadge = canManageBudgets ? (
    <RoleBadge role="owner" customLabel="Budget Manager" size="sm" />
  ) : isFinanceOperator ? (
    <RoleBadge role="head" customLabel="Finance Operator" size="sm" />
  ) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Financial Explorer"
        subtitle="Multi-dimensional financial drill-down & operational search"
        badge={headerBadge}
        actions={
          <div className={styles.headerActions}>
            <Link
              to={`/workspace/${workspaceId}/finance`}
              className={styles.actionBtn}
              aria-label="Back to Finance Overview"
            >
              <Sliders size={14} />
              <span>Finance Overview</span>
            </Link>
            <Link
              to={`/workspace/${workspaceId}/finance/expenses`}
              className={styles.actionBtn}
              aria-label="View Expense Ledger"
            >
              <Receipt size={14} />
              <span>Expense Ledger</span>
            </Link>
            <button
              type="button"
              className={styles.exportBtn}
              onClick={handleExportCSV}
              disabled={filteredRows.length === 0}
              title="Export filtered records to CSV"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => refetch()}
              disabled={refreshing}
              aria-label="Refresh explorer data"
            >
              <RefreshCw size={14} className={refreshing ? styles.spinning : ''} />
              <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
            </button>
          </div>
        }
      />

      {/* Non-blocking refresh error notice if cached data exists */}
      {explorerError && rows.length > 0 && (
        <div className={styles.refreshNotice} role="alert">
          <AlertTriangle size={14} />
          <span>Notice: Failed to update latest data ({explorerError}). Displaying cached state.</span>
        </div>
      )}

      {/* Summary Metrics Strip (Strictly Derived from Leaf Expenses, Zero Double-Counting) */}
      <div className={styles.summaryStrip}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Matched Records</div>
          <div className={styles.summaryCardValue}>{summaryStrip.totalMatchedRows}</div>
          <div className={styles.summaryCardSub}>Filtered entities</div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Effective Leaf Spend</div>
          <div className={styles.summaryCardValue} style={{ color: 'var(--yellow)' }}>
            {formatCurrency(summaryStrip.effectiveLeafSpend)}
          </div>
          <div className={styles.summaryCardSub}>Zero double-counting</div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Expense Entries</div>
          <div className={styles.summaryCardValue}>{summaryStrip.expenseEntriesCount}</div>
          <div className={styles.summaryCardSub}>Physical transactions</div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Projects In Scope</div>
          <div className={styles.summaryCardValue}>{summaryStrip.projectsCount}</div>
          <div className={styles.summaryCardSub}>Containers</div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>High Risk Units</div>
          <div
            className={styles.summaryCardValue}
            style={{ color: summaryStrip.highRiskCount > 0 ? 'var(--red)' : 'inherit' }}
          >
            {summaryStrip.highRiskCount}
          </div>
          <div className={styles.summaryCardSub}>Unique Orange / Red sources</div>
        </div>
      </div>

      {/* Saved Views Bar */}
      <FinancialExplorerSavedViewsBar
        savedViews={savedViews}
        loading={savedViewsLoading}
        error={savedViewsError}
        activeSavedViewId={activeSavedViewId}
        isDirty={isCurrentViewDirty}
        isSaving={savedViewsSaving}
        onSelectView={handleApplySavedView}
        onSaveCurrentView={handleSaveCurrentView}
        onUpdateCurrentView={handleUpdateCurrentView}
        onRenameView={handleRenameView}
        onDeleteView={handleDeleteView}
        onRetryFetch={fetchSavedViews}
      />

      {/* Control Toolbar: Search, Grouping, Sorting, Multi-Dimensional Filters */}
      <div className={styles.controlsPanel}>
        <div className={styles.searchAndControls}>
          {/* Text Search Input */}
          <div className={styles.searchContainer}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search by title, description, category, project, phase, task, owner..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            {searchQuery && (
              <button
                type="button"
                className={styles.clearSearchBtn}
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Grouping & Sorting Controls */}
          <div className={styles.groupSortControls}>
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Group By:</span>
              <select
                className={styles.controlSelect}
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                <option value="none">None (Flat Table)</option>
                <option value="project">Project</option>
                <option value="phase">Phase</option>
                <option value="task_list">Task List</option>
                <option value="owner">Owner</option>
                <option value="department">Department</option>
                <option value="rowType">Entity Type</option>
                <option value="status">Status</option>
                <option value="riskBand">Risk Band</option>
              </select>
            </div>

            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Sort By:</span>
              <select
                className={styles.controlSelect}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="name">Name / Title</option>
                <option value="actualSpend">Actual Spend</option>
                <option value="utilizationPct">Utilization %</option>
                <option value="riskBand">Risk Band</option>
                <option value="date">Financial Date</option>
                <option value="ownerName">Owner</option>
              </select>
              <button
                type="button"
                className={styles.sortOrderBtn}
                onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                title={`Sorting ${sortOrder.toUpperCase()}`}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Dimensional Cascading Filter Grid */}
        <div className={styles.filtersGrid}>
          {/* 1. Entity Type */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Entity Type:</span>
            <select
              className={styles.filterSelect}
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="project">Project</option>
              <option value="phase">Phase</option>
              <option value="task_list">Task List</option>
              <option value="task">Task</option>
              <option value="expense">Expense</option>
              <option value="standalone">Standalone Work</option>
            </select>
          </div>

          {/* 2. Project (Cascading Root) */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Project:</span>
            <select
              className={styles.filterSelect}
              value={selectedProject}
              onChange={(e) => handleProjectChange(e.target.value)}
            >
              <option value="all">All Projects</option>
              {(hierarchyData.projects || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Phase (Cascading Child) */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Phase:</span>
            <select
              className={styles.filterSelect}
              value={selectedPhase}
              onChange={(e) => handlePhaseChange(e.target.value)}
            >
              <option value="all">All Phases</option>
              {availablePhases.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {ph.name}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Task List (Cascading Child) */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Task List:</span>
            <select
              className={styles.filterSelect}
              value={selectedTaskList}
              onChange={(e) => handleTaskListChange(e.target.value)}
            >
              <option value="all">All Task Lists</option>
              {availableTaskLists.map((tl) => (
                <option key={tl.id} value={tl.id}>
                  {tl.name}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Task (Cascading Child) */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Task:</span>
            <select
              className={styles.filterSelect}
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
            >
              <option value="all">All Tasks</option>
              {availableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>

          {/* 6. Owner */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Owner:</span>
            <select
              className={styles.filterSelect}
              value={selectedOwner}
              onChange={(e) => setSelectedOwner(e.target.value)}
            >
              <option value="all">All Owners</option>
              {(hierarchyData.owners || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          {/* 7. Department */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Department:</span>
            <select
              className={styles.filterSelect}
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
            >
              <option value="all">All Departments</option>
              {(hierarchyData.departments || []).map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.code})
                </option>
              ))}
              <option value="Unassigned">Unassigned</option>
            </select>
          </div>

          {/* 8. Operational Status */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Status:</span>
            <select
              className={styles.filterSelect}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Corrected">Corrected (Expense)</option>
              <option value="Voided">Voided (Expense)</option>
            </select>
          </div>

          {/* 9. Risk Band */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Risk Band:</span>
            <select
              className={styles.filterSelect}
              value={selectedRisk}
              onChange={(e) => setSelectedRisk(e.target.value)}
            >
              <option value="all">All Risk Bands</option>
              <option value="GREEN">GREEN (&lt; 80%)</option>
              <option value="YELLOW">YELLOW (80–100%)</option>
              <option value="ORANGE">ORANGE (Buffer)</option>
              <option value="RED">RED (Overrun)</option>
              <option value="UNBUDGETED">UNBUDGETED</option>
            </select>
          </div>

          {/* 10. Creator */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Creator:</span>
            <select
              className={styles.filterSelect}
              value={selectedCreator}
              onChange={(e) => setSelectedCreator(e.target.value)}
            >
              <option value="all">All Creators</option>
              {(hierarchyData.creators || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* 11. Date From */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Date From:</span>
            <input
              type="date"
              className={styles.filterInput}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          {/* 12. Date To */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Date To:</span>
            <input
              type="date"
              className={styles.filterInput}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {/* 13. Over Budget Only Toggle */}
          <label className={styles.filterCheckboxLabel}>
            <input
              type="checkbox"
              checked={overBudgetOnly}
              onChange={(e) => setOverBudgetOnly(e.target.checked)}
            />
            <span>Over-Budget Only</span>
          </label>

          {/* 14. Clear All Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              className={styles.clearFiltersBtn}
              onClick={handleResetFilters}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Results Table & Mobile Cards */}
      {filteredRows.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No Financial Records Found"
          description={
            hasActiveFilters
              ? 'No entities or transactions matched your active filter criteria. Try adjusting or clearing filters.'
              : 'No project, phase, task list, task, or expense records found in this workspace.'
          }
          action={
            hasActiveFilters ? (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleResetFilters}
              >
                Clear Filters
              </button>
            ) : null
          }
        />
      ) : (
        <>
          {/* Desktop High-Density Table (Single <tbody>, Zero Nested <tbody>) */}
          <div className={styles.tableContainer}>
            <table className={styles.explorerTable}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name / Description</th>
                  <th>Project</th>
                  <th>Phase</th>
                  <th>Task List</th>
                  <th>Status</th>
                  <th>Budget Source</th>
                  <th style={{ textAlign: 'right' }}>Base Budget</th>
                  <th style={{ textAlign: 'right' }}>Safety Buffer</th>
                  <th style={{ textAlign: 'right' }}>Actual Spend</th>
                  <th style={{ textAlign: 'right' }}>Remaining Base</th>
                  <th style={{ textAlign: 'right' }}>Overrun</th>
                  <th style={{ textAlign: 'right' }}>Util %</th>
                  <th>Risk</th>
                  <th>Date</th>
                  <th>Owner</th>
                  <th>Department</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody className={styles.tableBody}>
                {groupedData.map((group) => {
                  const groupLeafSpend = computeGroupLeafSpend(group.rows);

                  return (
                    <React.Fragment key={group.groupKey}>
                      {groupBy !== 'none' && (
                        <tr className={styles.groupHeaderRow}>
                          <td colSpan={18} className={styles.groupHeaderCell}>
                            <div className={styles.groupHeaderContent}>
                              <div className={styles.groupTitle}>
                                <Layers size={14} color="var(--yellow)" />
                                <span>{group.groupTitle}</span>
                              </div>
                              <div className={styles.groupMeta}>
                                <span>{group.rows.length} record(s)</span>
                                <span>
                                  Leaf Spend:{' '}
                                  <span className={styles.groupSpendVal}>
                                    {formatCurrency(groupLeafSpend)}
                                  </span>
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {group.rows.map((r) => {
                        const typeClass =
                          r.rowType === 'project'
                            ? styles.typeProject
                            : r.rowType === 'phase'
                            ? styles.typePhase
                            : r.rowType === 'task_list'
                            ? styles.typeTaskList
                            : r.rowType === 'task'
                            ? styles.typeTask
                            : r.rowType === 'expense'
                            ? styles.typeExpense
                            : styles.typeStandalone;

                        const riskClass = r.hasSummaryError
                          ? styles.riskUNAVAILABLE
                          : styles[`risk${r.riskBand}`] || styles.riskGREEN;

                        const statusClass =
                          r.normalizedStatus === 'Active'
                            ? styles.statusActive
                            : r.normalizedStatus === 'Completed'
                            ? styles.statusCompleted
                            : r.normalizedStatus === 'Voided'
                            ? styles.statusVoided
                            : r.normalizedStatus === 'Corrected'
                            ? styles.statusCorrected
                            : '';

                        return (
                          <tr
                            key={r.id}
                            className={styles.explorerRow}
                            onClick={() => {
                              if (r.rowType === 'expense') {
                                setSelectedExpenseForDetail(r.rawEntity);
                              }
                            }}
                          >
                            {/* Type Badge */}
                            <td>
                              <span className={`${styles.typeBadge} ${typeClass}`}>
                                {r.rowType === 'task' && r.taskVariant ? r.taskVariant : r.rowType}
                              </span>
                            </td>

                            {/* Name / Description */}
                            <td>
                              <div className={styles.nameCell}>
                                <span className={styles.primaryName} title={r.name}>
                                  {r.name}
                                </span>
                                <span className={styles.secondaryDesc} title={r.description}>
                                  {r.description}
                                </span>
                              </div>
                            </td>

                            {/* Project */}
                            <td>
                              {r.projectName && r.projectName !== 'Standalone' && r.projectName !== 'Unassigned' ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', whiteSpace: 'nowrap' }}>
                                  <span
                                    className={styles.projectDot}
                                    style={{ background: r.projectColor || 'var(--yellow)' }}
                                  />
                                  <span>{r.projectName}</span>
                                </div>
                              ) : (
                                <span className={styles.dimText}>{r.projectName || '—'}</span>
                              )}
                            </td>

                            {/* Phase */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className={r.phaseName === '—' ? styles.dimText : ''}>
                                {r.phaseName}
                              </span>
                            </td>

                            {/* Task List */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className={r.taskListName === '—' ? styles.dimText : ''}>
                                {r.taskListName}
                              </span>
                            </td>

                            {/* Status */}
                            <td>
                              {r.status !== '—' ? (
                                <span className={`${styles.statusBadge} ${statusClass}`}>
                                  {r.status}
                                </span>
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Budget Source */}
                            <td style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                              <span className={r.budgetSource.includes('Unbudgeted') || r.hasSummaryError ? styles.dimText : ''}>
                                {r.budgetSource}
                              </span>
                            </td>

                            {/* Base Budget */}
                            <td className={styles.amountCol}>
                              {r.baseBudget !== null && !r.hasSummaryError ? (
                                formatCurrency(r.baseBudget)
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Safety Buffer */}
                            <td className={styles.amountCol}>
                              {r.safetyBuffer !== null && !r.hasSummaryError ? (
                                formatCurrency(r.safetyBuffer)
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Actual Spend */}
                            <td
                              className={styles.amountCol}
                              style={{
                                color: r.status === 'voided' || r.normalizedStatus === 'Voided' ? 'var(--muted)' : 'var(--yellow)',
                                textDecoration: r.status === 'voided' || r.normalizedStatus === 'Voided' ? 'line-through' : 'none',
                              }}
                            >
                              {r.hasSummaryError && r.actualSpend === null ? (
                                <span className={styles.dimText}>Summary unavailable</span>
                              ) : (
                                formatCurrency(r.actualSpend ?? 0)
                              )}
                            </td>

                            {/* Remaining Base */}
                            <td className={styles.amountCol}>
                              {r.remainingBase !== null && !r.hasSummaryError ? (
                                <span style={{ color: r.remainingBase < 0 ? 'var(--red)' : 'inherit' }}>
                                  {formatCurrency(r.remainingBase)}
                                </span>
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Overrun */}
                            <td className={styles.amountCol}>
                              {r.overrun !== null && !r.hasSummaryError ? (
                                <span className={r.overrun > 0 ? styles.overrunText : styles.dimText}>
                                  {formatCurrency(r.overrun)}
                                </span>
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Utilization % */}
                            <td className={styles.amountCol}>
                              {r.utilizationPct !== null && !r.hasSummaryError ? (
                                <span>{r.utilizationPct.toFixed(1)}%</span>
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Risk Band */}
                            <td>
                              <span className={`${styles.riskBadge} ${riskClass}`}>
                                {r.hasSummaryError
                                  ? (r.rowType === 'task' || r.rowType === 'expense' ? 'Budget context unavailable' : 'Summary unavailable')
                                  : r.riskBand}
                              </span>
                            </td>

                            {/* Date */}
                            <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                              {r.date}
                            </td>

                            {/* Owner */}
                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                              <span className={r.ownerName === 'Unassigned' ? styles.dimText : ''}>
                                {r.ownerName}
                              </span>
                            </td>

                            {/* Department */}
                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                              <span className={r.departmentName === 'Unassigned' ? styles.dimText : ''}>
                                {r.departmentName}
                              </span>
                            </td>

                            {/* Drill-down / Action */}
                            <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                              {r.rowType === 'project' && (
                                <Link
                                  to={`/workspace/${workspaceId}/project/${r.entityId}`}
                                  className={styles.actionBtn}
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                  title="Open Project Tasks"
                                >
                                  <ExternalLink size={12} />
                                </Link>
                              )}
                              {r.rowType === 'expense' && (
                                <button
                                  type="button"
                                  className={styles.actionBtn}
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                  onClick={() => setSelectedExpenseForDetail(r.rawEntity)}
                                  title="Inspect Expense Details & Audit"
                                >
                                  <Eye size={12} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards */}
          <div className={styles.mobileCardsContainer}>
            {sortedRows.map((r) => {
              const riskClass = r.hasSummaryError
                ? styles.riskUNAVAILABLE
                : styles[`risk${r.riskBand}`] || styles.riskGREEN;

              const typeClass =
                r.rowType === 'project'
                  ? styles.typeProject
                  : r.rowType === 'phase'
                  ? styles.typePhase
                  : r.rowType === 'task_list'
                  ? styles.typeTaskList
                  : r.rowType === 'task'
                  ? styles.typeTask
                  : r.rowType === 'expense'
                  ? styles.typeExpense
                  : styles.typeStandalone;

              const statusClass =
                r.normalizedStatus === 'Active'
                  ? styles.statusActive
                  : r.normalizedStatus === 'Completed'
                  ? styles.statusCompleted
                  : r.normalizedStatus === 'Voided'
                  ? styles.statusVoided
                  : r.normalizedStatus === 'Corrected'
                  ? styles.statusCorrected
                  : '';

              return (
                <div
                  key={r.id}
                  className={styles.mobileCard}
                  onClick={() => {
                    if (r.rowType === 'expense') {
                      setSelectedExpenseForDetail(r.rawEntity);
                    }
                  }}
                >
                  <div className={styles.mobileCardHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                      <span className={`${styles.typeBadge} ${typeClass}`}>
                        {r.rowType === 'task' && r.taskVariant ? r.taskVariant : r.rowType}
                      </span>
                      <span className={styles.mobileCardTitle}>{r.name}</span>
                    </div>
                    <span className={`${styles.riskBadge} ${riskClass}`}>
                      {r.hasSummaryError ? 'Unavailable' : r.riskBand}
                    </span>
                  </div>

                  <div className={styles.mobileCardDesc}>{r.description}</div>

                  <div className={styles.mobileCardGrid}>
                    <div className={styles.mobileField}>
                      <span className={styles.mobileFieldLabel}>Project</span>
                      <span className={styles.mobileFieldValue}>{r.projectName || '—'}</span>
                    </div>
                    <div className={styles.mobileField}>
                      <span className={styles.mobileFieldLabel}>Phase / List</span>
                      <span className={styles.mobileFieldValue}>
                        {r.phaseName !== '—' ? r.phaseName : r.taskListName !== '—' ? r.taskListName : '—'}
                      </span>
                    </div>
                    <div className={styles.mobileField}>
                      <span className={styles.mobileFieldLabel}>Actual Spend</span>
                      <span className={styles.mobileFieldValue} style={{ color: 'var(--yellow)', fontWeight: 600 }}>
                        {r.hasSummaryError && r.actualSpend === null ? 'Unavailable' : formatCurrency(r.actualSpend ?? 0)}
                      </span>
                    </div>
                    <div className={styles.mobileField}>
                      <span className={styles.mobileFieldLabel}>Status</span>
                      <span className={`${styles.statusBadge} ${statusClass}`}>
                        {r.status || '—'}
                      </span>
                    </div>
                  </div>

                  <div className={styles.mobileCardFooter}>
                    <span>{r.date}</span>
                    <span>{r.ownerName}</span>
                    <span>{r.departmentName}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Reusable Expense Detail & Audit Inspection Modal */}
      {selectedExpenseForDetail && (
        <ExpenseDetailModal
          expense={selectedExpenseForDetail}
          onClose={() => setSelectedExpenseForDetail(null)}
          onFetchAudit={fetchTransactionAudit}
          canManageBudgets={canManageBudgets}
        />
      )}
    </div>
  );
}
