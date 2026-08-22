import { useState, useMemo, useEffect } from 'react';
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
import { formatCurrency } from '../lib/expenseExecution.js';
import PageHeader from '../components/PageHeader.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { MetricCardsSkeleton, Skeleton } from '../components/Skeleton.jsx';
import ExpenseDetailModal from '../components/finance/ExpenseDetailModal.jsx';
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

      // 8. Status (Tasks, Projects, Task Lists, Expenses)
      if (selectedStatus !== 'all') {
        if (r.rowType === 'phase') return false; // Phases excluded from status filtering
        if (r.status !== selectedStatus) return false;
      }

      // 9. Risk Band
      if (selectedRisk !== 'all') {
        if (r.riskBand !== selectedRisk) return false;
      }

      // 10. Over-Budget Only
      if (overBudgetOnly) {
        if (!r.isOverBudget) return false;
      }

      // 11. Creator
      if (selectedCreator !== 'all') {
        if (r.createdBy !== selectedCreator) return false;
      }

      // 12. Date Range (Financial activity date)
      if (dateFrom && r.date !== '—' && r.date < dateFrom) return false;
      if (dateTo && r.date !== '—' && r.date > dateTo) return false;

      // 13. Amount Min / Max
      const minNum = parseFloat(amountMin);
      if (!isNaN(minNum)) {
        if (r.actualSpend < minNum) return false;
      }
      const maxNum = parseFloat(amountMax);
      if (!isNaN(maxNum)) {
        if (r.actualSpend > maxNum) return false;
      }

      // 14. Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = (r.name || '').toLowerCase().includes(q);
        const descMatch = (r.description || '').toLowerCase().includes(q);
        const projMatch = (r.projectName || '').toLowerCase().includes(q);
        const phaseMatch = (r.phaseName || '').toLowerCase().includes(q);
        const listMatch = (r.taskListName || '').toLowerCase().includes(q);
        const taskMatch = (r.taskTitle || '').toLowerCase().includes(q);
        const ownerMatch = (r.ownerName || '').toLowerCase().includes(q);
        const creatorMatch = (r.creatorName || '').toLowerCase().includes(q);

        if (
          !nameMatch &&
          !descMatch &&
          !projMatch &&
          !phaseMatch &&
          !listMatch &&
          !taskMatch &&
          !ownerMatch &&
          !creatorMatch
        ) {
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

  // Sorting
  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const riskPriority = { RED: 5, ORANGE: 4, YELLOW: 3, GREEN: 2, UNBUDGETED: 1 };

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'actualSpend') {
        cmp = (a.actualSpend || 0) - (b.actualSpend || 0);
      } else if (sortBy === 'utilizationPct') {
        cmp = (a.utilizationPct || 0) - (b.utilizationPct || 0);
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
        key = r.status;
        title = r.status;
      } else if (groupBy === 'riskBand') {
        key = r.riskBand;
        title = `Risk: ${r.riskBand}`;
      }

      if (!groupsMap.has(key)) {
        groupsMap.set(key, { groupKey: key, groupTitle: title, rows: [] });
      }
      groupsMap.get(key).rows.push(r);
    }

    return Array.from(groupsMap.values());
  }, [sortedRows, groupBy]);

  // Zero Double-Counting Summary Strip Metrics
  const summaryStrip = useMemo(() => {
    // 1. Matched rows count
    const totalMatchedRows = filteredRows.length;

    // 2. Effective spend: sum solely from matching physical expense rows (or leaf spend)
    const matchingExpenses = filteredRows.filter((r) => r.rowType === 'expense');
    let effectiveLeafSpend = 0;
    for (const exp of matchingExpenses) {
      effectiveLeafSpend += exp.actualSpend || 0;
    }

    // 3. Unique projects count
    const uniqueProjectIds = new Set(
      filteredRows.filter((r) => r.projectId).map((r) => r.projectId)
    );

    // 4. High Risk Count: Unique budget-owning entities in ORANGE or RED
    const highRiskBudgetEntities = new Set();
    for (const r of filteredRows) {
      if (
        (r.rowType === 'project' || r.rowType === 'phase' || r.rowType === 'task_list') &&
        (r.riskBand === 'ORANGE' || r.riskBand === 'RED')
      ) {
        highRiskBudgetEntities.add(`${r.rowType}:${r.entityId}`);
      }
    }

    return {
      totalMatchedRows,
      effectiveLeafSpend,
      expenseEntriesCount: matchingExpenses.length,
      projectsCount: uniqueProjectIds.size,
      highRiskCount: highRiskBudgetEntities.size,
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
        r.baseBudget !== null ? r.baseBudget.toFixed(2) : '""',
        r.safetyBuffer !== null ? r.safetyBuffer.toFixed(2) : '""',
        r.actualSpend.toFixed(2),
        r.remainingBase !== null ? r.remainingBase.toFixed(2) : '""',
        r.overrun !== null ? r.overrun.toFixed(2) : '""',
        r.utilizationPct !== null ? r.utilizationPct.toFixed(2) : '""',
        `"${r.riskBand || 'GREEN'}"`,
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

  // 4. Error State with Retry
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

      {/* Summary Strip (Zero Double Counting) */}
      <div className={styles.summaryStrip}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Matched Records</span>
          <span className={styles.summaryValue}>{summaryStrip.totalMatchedRows}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Effective Spend</span>
          <span className={styles.summaryValue} style={{ color: 'var(--yellow)' }}>
            {formatCurrency(summaryStrip.effectiveLeafSpend)}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Expense Entries</span>
          <span className={styles.summaryValue}>{summaryStrip.expenseEntriesCount}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Projects Scope</span>
          <span className={styles.summaryValue}>{summaryStrip.projectsCount}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>High Risk Units</span>
          <span
            className={styles.summaryValue}
            style={{ color: summaryStrip.highRiskCount > 0 ? 'var(--red)' : 'var(--green)' }}
          >
            {summaryStrip.highRiskCount}
          </span>
        </div>
      </div>

      {/* Filter & Grouping Toolbar */}
      <div className={styles.toolbarCard}>
        <div className={styles.topFilterRow}>
          {/* Text Search */}
          <div className={styles.searchBox}>
            <Search size={16} color="var(--muted)" />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by name, project, phase, task, owner, creator..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
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
              <span className={styles.controlLabel}>Sort:</span>
              <select
                className={styles.controlSelect}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="name">Name</option>
                <option value="actualSpend">Actual Spend</option>
                <option value="utilizationPct">Utilization %</option>
                <option value="riskBand">Risk Band</option>
                <option value="date">Date</option>
                <option value="ownerName">Owner</option>
              </select>
              <select
                className={styles.controlSelect}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                style={{ width: '70px' }}
              >
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
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
              <option value="project">Projects Only</option>
              <option value="phase">Phases Only</option>
              <option value="task_list">Task Lists Only</option>
              <option value="task">Tasks Only</option>
              <option value="expense">Expenses Only</option>
              <option value="standalone">Standalone Work Only</option>
            </select>
          </div>

          {/* 2. Cascading Project */}
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

          {/* 3. Cascading Phase */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Phase:</span>
            <select
              className={styles.filterSelect}
              value={selectedPhase}
              onChange={(e) => handlePhaseChange(e.target.value)}
              disabled={availablePhases.length === 0}
            >
              <option value="all">All Phases</option>
              {availablePhases.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {ph.name}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Cascading Task List */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Task List:</span>
            <select
              className={styles.filterSelect}
              value={selectedTaskList}
              onChange={(e) => handleTaskListChange(e.target.value)}
              disabled={availableTaskLists.length === 0}
            >
              <option value="all">All Task Lists</option>
              {availableTaskLists.map((tl) => (
                <option key={tl.id} value={tl.id}>
                  {tl.name}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Cascading Task */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Task:</span>
            <select
              className={styles.filterSelect}
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              disabled={availableTasks.length === 0}
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

          {/* 7. Department (Owner primary active department) */}
          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Department:</span>
            <select
              className={styles.filterSelect}
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
            >
              <option value="all">All Departments</option>
              {(hierarchyData.departments || []).map((d) => (
                <option key={d.id || d.name} value={d.name}>
                  {d.name} ({d.code})
                </option>
              ))}
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
              <option value="corrected">Corrected (Expense)</option>
              <option value="voided">Voided (Expense)</option>
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

          {/* Reset Filters */}
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

      {/* Main Results Table & Groups */}
      {sortedRows.length > 0 ? (
        <>
          <div className={styles.tableContainer}>
            <table className={styles.explorerTable}>
              <thead>
                <tr>
                  <th style={{ width: '90px' }}>Type</th>
                  <th style={{ minWidth: '220px' }}>Name / Description</th>
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
              <tbody>
                {groupedData.map((group) => {
                  const groupLeafSpend = computeGroupLeafSpend(group.rows);

                  return (
                    <tbody key={group.groupKey}>
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

                        const riskClass = styles[`risk${r.riskBand}`] || styles.riskGREEN;
                        const statusClass =
                          r.status === 'Active'
                            ? styles.statusActive
                            : r.status === 'Completed'
                            ? styles.statusCompleted
                            : r.status === 'voided'
                            ? styles.statusVoided
                            : r.status === 'corrected'
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
                              <span className={r.budgetSource.includes('Unbudgeted') ? styles.dimText : ''}>
                                {r.budgetSource}
                              </span>
                            </td>

                            {/* Base Budget */}
                            <td className={styles.amountCol}>
                              {r.baseBudget !== null ? formatCurrency(r.baseBudget) : <span className={styles.dimText}>—</span>}
                            </td>

                            {/* Safety Buffer */}
                            <td className={styles.amountCol}>
                              {r.safetyBuffer !== null ? formatCurrency(r.safetyBuffer) : <span className={styles.dimText}>—</span>}
                            </td>

                            {/* Actual Spend */}
                            <td
                              className={styles.amountCol}
                              style={{
                                color: r.status === 'voided' ? 'var(--muted)' : 'var(--yellow)',
                                textDecoration: r.status === 'voided' ? 'line-through' : 'none',
                              }}
                            >
                              {formatCurrency(r.actualSpend)}
                            </td>

                            {/* Remaining Base */}
                            <td className={styles.amountCol}>
                              {r.remainingBase !== null ? (
                                <span style={{ color: r.remainingBase < 0 ? 'var(--red)' : 'inherit' }}>
                                  {formatCurrency(r.remainingBase)}
                                </span>
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Overrun */}
                            <td className={styles.amountCol}>
                              {r.overrun !== null ? (
                                <span className={r.overrun > 0 ? styles.overrunText : styles.dimText}>
                                  {formatCurrency(r.overrun)}
                                </span>
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Utilization % */}
                            <td className={styles.amountCol}>
                              {r.utilizationPct !== null ? (
                                <span>{r.utilizationPct.toFixed(1)}%</span>
                              ) : (
                                <span className={styles.dimText}>—</span>
                              )}
                            </td>

                            {/* Risk Band */}
                            <td>
                              <span className={`${styles.riskBadge} ${riskClass}`}>
                                {r.riskBand}
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
                    </tbody>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards */}
          <div className={styles.mobileCardsContainer}>
            {sortedRows.map((r) => {
              const riskClass = styles[`risk${r.riskBand}`] || styles.riskGREEN;
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

              return (
                <div
                  key={r.id}
                  className={styles.mobileCard}
                  onClick={() => {
                    if (r.rowType === 'expense') setSelectedExpenseForDetail(r.rawEntity);
                  }}
                >
                  <div className={styles.mobileCardHeader}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.25rem' }}>
                        <span className={`${styles.typeBadge} ${typeClass}`}>
                          {r.rowType}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                          {r.projectName || 'Standalone'}
                        </span>
                      </div>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {r.name}
                      </div>
                    </div>
                    <span className={`${styles.riskBadge} ${riskClass}`}>
                      {r.riskBand}
                    </span>
                  </div>

                  <div className={styles.mobileCardGrid}>
                    <div>
                      <span style={{ color: 'var(--muted)' }}>Spend: </span>
                      <strong style={{ color: 'var(--yellow)' }}>{formatCurrency(r.actualSpend)}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--muted)' }}>Budget: </span>
                      <span>{r.baseBudget !== null ? formatCurrency(r.baseBudget) : '—'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--muted)' }}>Owner: </span>
                      <span>{r.ownerName}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--muted)' }}>Dept: </span>
                      <span>{r.departmentName}</span>
                    </div>
                  </div>

                  <div className={styles.mobileCardFooter}>
                    <span>{r.date}</span>
                    <span>Source: {r.budgetSource}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <EmptyState
          icon={Compass}
          title={hasActiveFilters ? 'No Matching Financial Records' : 'No Financial Data Available'}
          description={
            hasActiveFilters
              ? 'No projects, tasks, or expenses match your current multi-dimensional filter criteria.'
              : 'No financial entities or transactions were found in this workspace.'
          }
          actionLabel={hasActiveFilters ? 'Reset Filters' : undefined}
          onAction={hasActiveFilters ? handleResetFilters : undefined}
        />
      )}

      {/* Reusable Expense Detail Modal */}
      {selectedExpenseForDetail && (
        <ExpenseDetailModal
          isOpen={Boolean(selectedExpenseForDetail)}
          onClose={() => setSelectedExpenseForDetail(null)}
          transaction={selectedExpenseForDetail}
          workspaceId={workspaceId}
          canManageBudgets={false} // Explorer is read-only
          canViewWorkspaceFinance={canViewWorkspaceFinance}
          fetchTransactionAudit={fetchTransactionAudit}
          onOpenCorrect={() => {}}
          onOpenVoid={() => {}}
          onOpenHardDelete={() => {}}
        />
      )}
    </div>
  );
}
