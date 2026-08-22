import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronRight,
  ChevronDown,
  Coins,
  ShieldCheck,
  TrendingUp,
  FolderKanban,
  Layers,
  CheckSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  ArrowLeft,
} from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useFinanceAccess } from '../hooks/useFinanceAccess.js';
import { useProjects } from '../hooks/useProjects.js';
import { useBudgets } from '../hooks/useBudgets.js';
import { normalizeFinancialSummary, hasEffectiveBudget } from '../lib/finance.js';
import { formatCurrency } from '../lib/expenseExecution.js';
import PageHeader from '../components/PageHeader.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FinanceRiskBadge from '../components/finance/FinanceRiskBadge.jsx';
import BudgetEditModal from '../components/finance/BudgetEditModal.jsx';
import { useToast } from '../components/Toast.jsx';
import styles from './BudgetManagementPage.module.css';

/**
 * BudgetManagementPage
 *
 * Central Budget Configuration UI for SNS Projects.
 * Authoritative entry point for Workspace Owners, Workspace Admins, CEOs, and CTOs
 * with active workspace tenancy to set and edit Project, Phase, and Task List budgets.
 *
 * Enforces fail-closed authorization, canonical backend contracts, fail-safe loading,
 * and zero client-side business calculation duplication.
 */
export default function BudgetManagementPage() {
  const { workspaceId } = useParams();
  const { showToast } = useToast();

  const activeWorkspaceRef = useRef(workspaceId);

  const {
    canManageBudgets,
    financeAccessLoading,
    financeAccessError,
  } = useFinanceAccess(workspaceId);

  const {
    projects = [],
    loading: projectsLoading,
    error: projectsError,
    refetch: refetchProjects,
  } = useProjects(workspaceId);

  const {
    budgets = [],
    loading: budgetsLoading,
    refreshing: budgetsRefreshing,
    error: budgetsError,
    refetch: refetchBudgets,
    saveBudget,
  } = useBudgets(workspaceId, { enabled: canManageBudgets });

  // Expansion State
  const [expandedProjects, setExpandedProjects] = useState(() => new Set());
  const [expandedPhases, setExpandedPhases] = useState(() => new Set());

  // Entity Data State (Phases and Task Lists fetched on expansion)
  const [phasesByProject, setPhasesByProject] = useState(() => new Map());
  const [taskListsByPhase, setTaskListsByPhase] = useState(() => new Map());

  // Financial Summaries State: key -> normalized summary
  const [summaries, setSummaries] = useState(() => new Map());
  // Summary Status State: key -> { loading: boolean, error: string | null }
  const [summaryStatus, setSummaryStatus] = useState(() => new Map());

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [editingEntity, setEditingEntity] = useState(null);

  // ── Workspace Context Switch Reset ─────────────────────────────────────────
  useEffect(() => {
    activeWorkspaceRef.current = workspaceId;
    setExpandedProjects(new Set());
    setExpandedPhases(new Set());
    setPhasesByProject(new Map());
    setTaskListsByPhase(new Map());
    setSummaries(new Map());
    setSummaryStatus(new Map());
    setEditingEntity(null);
    setSearchQuery('');
  }, [workspaceId]);

  // ── Fetch Summaries Helper ──────────────────────────────────────────────────
  const fetchSummary = useCallback(
    async (type, id) => {
      const key = `${type}:${id}`;
      const currentWs = workspaceId;

      setSummaryStatus((prev) => new Map(prev).set(key, { loading: true, error: null }));

      try {
        let rpcName = 'get_project_financial_summary';
        let paramKey = 'p_project_id';

        if (type === 'phase') {
          rpcName = 'get_phase_financial_summary';
          paramKey = 'p_phase_id';
        } else if (type === 'task_list') {
          rpcName = 'get_task_list_financial_summary';
          paramKey = 'p_task_list_id';
        }

        const { data, error } = await supabase.rpc(rpcName, { [paramKey]: id });

        if (activeWorkspaceRef.current !== currentWs) return null;

        if (error) throw error;

        const normalized = normalizeFinancialSummary(data);

        setSummaries((prev) => {
          const next = new Map(prev);
          next.set(key, normalized);
          return next;
        });

        setSummaryStatus((prev) => {
          const next = new Map(prev);
          next.set(key, { loading: false, error: null });
          return next;
        });

        return normalized;
      } catch (err) {
        if (activeWorkspaceRef.current !== currentWs) return null;
        console.error(`[BudgetManagementPage] fetchSummary error for ${type}:${id}:`, err);

        setSummaryStatus((prev) => {
          const next = new Map(prev);
          next.set(key, { loading: false, error: err.message || 'Summary unavailable' });
          return next;
        });

        return null;
      }
    },
    [workspaceId]
  );

  // Fetch summaries for all visible projects when projects list changes
  useEffect(() => {
    if (!projects || projects.length === 0 || !canManageBudgets) return;

    projects.forEach((proj) => {
      fetchSummary('project', proj.id);
    });
  }, [projects, canManageBudgets, fetchSummary]);

  // ── Project Expansion & Phase Fetching ──────────────────────────────────────
  const toggleProjectExpand = useCallback(
    async (projectId) => {
      const currentWs = workspaceId;
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        if (next.has(projectId)) {
          next.delete(projectId);
        } else {
          next.add(projectId);
          // Fetch phases for this project if not already loaded
          if (!phasesByProject.has(projectId)) {
            supabase
              .from('phases')
              .select('*')
              .eq('project_id', projectId)
              .order('position', { ascending: true })
              .then(({ data, error }) => {
                if (activeWorkspaceRef.current !== currentWs) return;
                if (!error && data) {
                  setPhasesByProject((pMap) => new Map(pMap).set(projectId, data));
                  data.forEach((phase) => fetchSummary('phase', phase.id));
                }
              });
          }
        }
        return next;
      });
    },
    [workspaceId, phasesByProject, fetchSummary]
  );

  // ── Phase Expansion & Task List Fetching ────────────────────────────────────
  const togglePhaseExpand = useCallback(
    async (phaseId) => {
      const currentWs = workspaceId;
      setExpandedPhases((prev) => {
        const next = new Set(prev);
        if (next.has(phaseId)) {
          next.delete(phaseId);
        } else {
          next.add(phaseId);
          // Fetch task lists for this phase if not already loaded
          if (!taskListsByPhase.has(phaseId)) {
            supabase
              .from('task_lists')
              .select('*')
              .eq('phase_id', phaseId)
              .order('position', { ascending: true })
              .then(({ data, error }) => {
                if (activeWorkspaceRef.current !== currentWs) return;
                if (!error && data) {
                  setTaskListsByPhase((tMap) => new Map(tMap).set(phaseId, data));
                  data.forEach((taskList) => fetchSummary('task_list', taskList.id));
                }
              });
          }
        }
        return next;
      });
    },
    [workspaceId, taskListsByPhase, fetchSummary]
  );

  // ── Global Refresh ─────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    await Promise.all([refetchProjects(), refetchBudgets()]);
    // Refresh all loaded summaries
    for (const proj of projects) {
      fetchSummary('project', proj.id);
    }
    for (const [, phases] of phasesByProject.entries()) {
      phases.forEach((ph) => fetchSummary('phase', ph.id));
    }
    for (const [, taskLists] of taskListsByPhase.entries()) {
      taskLists.forEach((tl) => fetchSummary('task_list', tl.id));
    }
  };

  // ── Workspace Aggregates ───────────────────────────────────────────────────
  const workspaceStats = useMemo(() => {
    const projectBudgets = budgets.filter((b) => b.entity_type === 'project');
    const totalBaseBudget = projectBudgets.reduce(
      (sum, b) => sum + (Number(b.base_budget) || 0),
      0
    );
    const totalSafetyBuffer = projectBudgets.reduce(
      (sum, b) => sum + (Number(b.safety_buffer) || 0),
      0
    );

    let totalSpend = 0;
    projects.forEach((p) => {
      const s = summaries.get(`project:${p.id}`);
      if (s) totalSpend += s.actual_spend || 0;
    });

    return {
      totalBaseBudget,
      totalSafetyBuffer,
      totalSpend,
      totalProjects: projects.length,
      budgetedProjects: projectBudgets.length,
    };
  }, [budgets, projects, summaries]);

  // ── Filtered Projects ──────────────────────────────────────────────────────
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.project_code?.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  // ── Open Edit Modal Helper ─────────────────────────────────────────────────
  const openEditModal = (type, entity, parentEntity = null) => {
    let existingBudget = null;
    let currentSummary = null;
    let parentSummary = null;

    if (type === 'project') {
      existingBudget = budgets.find(
        (b) => b.entity_type === 'project' && b.project_id === entity.id
      );
      currentSummary = summaries.get(`project:${entity.id}`) || null;
    } else if (type === 'phase') {
      existingBudget = budgets.find(
        (b) => b.entity_type === 'phase' && b.phase_id === entity.id
      );
      currentSummary = summaries.get(`phase:${entity.id}`) || null;
      if (parentEntity) {
        parentSummary = summaries.get(`project:${parentEntity.id}`) || null;
      }
    } else if (type === 'task_list') {
      existingBudget = budgets.find(
        (b) => b.entity_type === 'task_list' && b.task_list_id === entity.id
      );
      currentSummary = summaries.get(`task_list:${entity.id}`) || null;
      if (parentEntity) {
        parentSummary = summaries.get(`phase:${parentEntity.id}`) || null;
      }
    }

    setEditingEntity({
      type,
      id: entity.id,
      name: entity.name,
      projectId: type === 'project' ? entity.id : entity.project_id,
      phaseId: type === 'phase' ? entity.id : entity.phase_id || null,
      taskListId: type === 'task_list' ? entity.id : null,
      existingBudget,
      currentSummary,
      parentSummary,
    });
  };

  // ── Handle Save Modal ──────────────────────────────────────────────────────
  const handleSaveModal = async ({ baseBudget, safetyBuffer }) => {
    if (!editingEntity) return { success: false, error: 'No entity selected.' };

    const res = await saveBudget({
      entityType: editingEntity.type,
      projectId: editingEntity.projectId,
      phaseId: editingEntity.phaseId,
      taskListId: editingEntity.taskListId,
      baseBudget,
      safetyBuffer,
      existingBudgetId: editingEntity.existingBudget?.id || null,
    });

    if (res.success) {
      showToast(
        `${editingEntity.name} budget ${
          editingEntity.existingBudget ? 'updated' : 'configured'
        } successfully.`,
        'success'
      );
      // Refetch summary for this entity and its parent
      fetchSummary(editingEntity.type, editingEntity.id);
      if (editingEntity.type === 'phase' && editingEntity.projectId) {
        fetchSummary('project', editingEntity.projectId);
      } else if (editingEntity.type === 'task_list') {
        if (editingEntity.phaseId) fetchSummary('phase', editingEntity.phaseId);
        if (editingEntity.projectId) fetchSummary('project', editingEntity.projectId);
      }
    }

    return res;
  };

  // ── 1. Fail-Safe Initial Loading State ─────────────────────────────────────
  const initialLoading =
    financeAccessLoading || (canManageBudgets && (projectsLoading || budgetsLoading));

  if (initialLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.breadcrumbNav}>
          <Link to={`/workspace/${workspaceId}/finance`} className={styles.breadcrumbLink}>
            <ArrowLeft size={14} /> Back to Finance Overview
          </Link>
        </div>
        <PageHeader
          title="Budget Configuration"
          subtitle="Loading workspace budget hierarchy..."
        />
        <EmptyState
          icon={Coins}
          title="Loading Budgets"
          description="Fetching workspace budget allocations and financial summaries..."
        />
      </div>
    );
  }

  // ── 2. Fail-Closed Access Denied State ─────────────────────────────────────
  if (!canManageBudgets || financeAccessError) {
    return (
      <div className={styles.page}>
        <div className={styles.breadcrumbNav}>
          <Link to={`/workspace/${workspaceId}/finance`} className={styles.breadcrumbLink}>
            <ArrowLeft size={14} /> Back to Finance Overview
          </Link>
        </div>
        <div className={styles.accessDeniedContainer} role="alert">
          <ShieldAlert size={48} className={styles.accessDeniedIcon} />
          <h2 className={styles.accessDeniedTitle}>Budget Management Restricted</h2>
          <p className={styles.accessDeniedDesc}>
            Only active Workspace Owners, Workspace Admins, CEOs, and CTOs with active workspace
            tenancy can set or edit financial budgets.
          </p>
          <Link to={`/workspace/${workspaceId}/finance`} className={styles.backBtn}>
            Return to Finance Overview
          </Link>
        </div>
      </div>
    );
  }

  // ── 3. Budget / Projects Fetch Error State ─────────────────────────────────
  if (budgetsError || projectsError) {
    return (
      <div className={styles.page}>
        <div className={styles.breadcrumbNav}>
          <Link to={`/workspace/${workspaceId}/finance`} className={styles.breadcrumbLink}>
            <ArrowLeft size={14} /> Back to Finance Overview
          </Link>
        </div>
        <PageHeader
          title="Budget Configuration"
          subtitle="Error loading workspace budget hierarchy"
        />
        <div className={styles.errorContainer} role="alert">
          <ShieldAlert size={48} className={styles.errorIcon} />
          <h2 className={styles.errorTitle}>Failed to Load Budgets</h2>
          <p className={styles.errorDesc}>
            {budgetsError || projectsError || 'Unable to retrieve workspace financial budgets.'}
          </p>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              refetchBudgets();
              refetchProjects();
            }}
          >
            <RefreshCw size={14} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // ── 4. Main Budget Management View ────────────────────────────────────────
  return (
    <div className={styles.page}>
      {/* Breadcrumb Navigation */}
      <div className={styles.breadcrumbNav}>
        <Link to={`/workspace/${workspaceId}/finance`} className={styles.breadcrumbLink}>
          <ArrowLeft size={14} /> Back to Finance Overview
        </Link>
      </div>

      {/* Page Header */}
      <PageHeader
        title="Budget Configuration"
        subtitle="Manage project, phase, and task list budget allocations"
        badge={<RoleBadge role="owner" customLabel="Budget Manager" size="sm" />}
        actions={
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={handleRefresh}
              disabled={budgetsRefreshing}
              aria-label="Refresh budgets and summaries"
            >
              <RefreshCw size={14} className={budgetsRefreshing ? styles.spinning : ''} />
              <span>{budgetsRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        }
      />

      {/* Workspace Summary Bar */}
      <section className={styles.summaryBar} aria-label="Workspace Budget Summary">
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>
            <span className={styles.summaryLabel}>Total Base Budget</span>
            <div className={styles.summaryIconWrap}><Coins size={16} /></div>
          </div>
          <div className={styles.summaryValue}>
            {formatCurrency(workspaceStats.totalBaseBudget)}
          </div>
          <div className={styles.summarySubtext}>
            {workspaceStats.budgetedProjects} of {workspaceStats.totalProjects} projects budgeted
          </div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>
            <span className={styles.summaryLabel}>Safety Buffers</span>
            <div className={styles.summaryIconWrap}><ShieldCheck size={16} /></div>
          </div>
          <div className={styles.summaryValue}>
            {formatCurrency(workspaceStats.totalSafetyBuffer)}
          </div>
          <div className={styles.summarySubtext}>Contingency reserve</div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>
            <span className={styles.summaryLabel}>Project Spend</span>
            <div className={styles.summaryIconWrap}><TrendingUp size={16} /></div>
          </div>
          <div className={styles.summaryValue}>
            {formatCurrency(workspaceStats.totalSpend)}
          </div>
          <div className={styles.summarySubtext}>Cumulative approved spend</div>
        </div>
      </section>

      {/* Hierarchy Explorer Section */}
      <section className={styles.sectionTitleGroup}>
        <div className={styles.sectionHeader}>
          <div>
            <h3 className={styles.sectionTitle}>Project Budget Portfolio</h3>
            <p className={styles.sectionSubtitle}>
              Expand projects to manage child Phase and Task List budget allocations.
            </p>
          </div>

          <div className={styles.searchBox}>
            <Search size={15} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
          </div>
        </div>
      </section>

      {/* Hierarchy Tree Container */}
      <div className={styles.treeContainer}>
        {filteredProjects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No Projects Found"
            description={
              searchQuery
                ? 'No projects match your search criteria.'
                : 'No projects exist in this workspace.'
            }
          />
        ) : (
          filteredProjects.map((project) => {
            const isExpanded = expandedProjects.has(project.id);
            const projectBudget = budgets.find(
              (b) => b.entity_type === 'project' && b.project_id === project.id
            );
            const summaryKey = `project:${project.id}`;
            const summary = summaries.get(summaryKey);
            const status = summaryStatus.get(summaryKey);
            const isOwnBudget = Boolean(projectBudget);
            const phases = phasesByProject.get(project.id) || [];

            return (
              <div key={project.id} className={styles.projectCard}>
                {/* Project Header Row */}
                <div className={styles.projectHeaderRow}>
                  <div className={styles.entityInfo}>
                    <button
                      type="button"
                      className={styles.expandBtn}
                      onClick={() => toggleProjectExpand(project.id)}
                      aria-label={isExpanded ? 'Collapse phases' : 'Expand phases'}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div
                      className={styles.projectDot}
                      style={{ backgroundColor: project.color || 'var(--yellow)' }}
                    />
                    <div className={styles.entityTitleBox}>
                      <div className={styles.entityNameRow}>
                        <span className={styles.entityName}>{project.name}</span>
                        {project.project_code && (
                          <span className={styles.entityCode}>{project.project_code}</span>
                        )}
                        {isOwnBudget ? (
                          <span className={`${styles.budgetBadge} ${styles.badgeOwn}`}>
                            Own Budget
                          </span>
                        ) : (
                          <span className={`${styles.budgetBadge} ${styles.badgeUnbudgeted}`}>
                            No Project Budget
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Project Financial Metrics Columns */}
                  <div className={styles.metricsGroup}>
                    <div className={styles.metricCell}>
                      <span className={styles.metricCellLabel}>Base Budget</span>
                      <span className={styles.metricCellValue}>
                        {isOwnBudget
                          ? formatCurrency(projectBudget.base_budget)
                          : '—'}
                      </span>
                    </div>

                    <div className={styles.metricCell}>
                      <span className={styles.metricCellLabel}>Safety Buffer</span>
                      <span className={styles.metricCellValue}>
                        {isOwnBudget
                          ? formatCurrency(projectBudget.safety_buffer)
                          : '—'}
                      </span>
                    </div>

                    <div className={styles.metricCell}>
                      <span className={styles.metricCellLabel}>Spend</span>
                      <span className={styles.metricCellValue}>
                        {status?.loading ? (
                          <span className={styles.metricCellPending}>—</span>
                        ) : status?.error ? (
                          <span className={styles.metricCellError}>—</span>
                        ) : summary ? (
                          formatCurrency(summary.actual_spend)
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>

                    <div className={styles.metricCell}>
                      <span className={styles.metricCellLabel}>Phases Alloc.</span>
                      {status?.loading ? (
                        <span className={styles.metricCellPending}>—</span>
                      ) : status?.error ? (
                        <span className={styles.metricCellError}>—</span>
                      ) : summary ? (
                        <>
                          <span className={styles.metricCellValue}>
                            {formatCurrency(summary.allocated_to_children)}
                          </span>
                          <span className={styles.metricCellSub}>
                            {formatCurrency(summary.unallocated_base)} free
                          </span>
                        </>
                      ) : (
                        <span className={styles.metricCellValue}>—</span>
                      )}
                    </div>

                    <div className={styles.metricCell}>
                      <span className={styles.metricCellLabel}>Risk</span>
                      {status?.loading ? (
                        <span className={styles.metricCellPending}>—</span>
                      ) : status?.error ? (
                        <span className={styles.metricCellError} title={status.error}>
                          Unavailable
                        </span>
                      ) : summary ? (
                        <FinanceRiskBadge
                          riskBand={summary.risk_band || 'GREEN'}
                          isBudgeted={hasEffectiveBudget(summary)}
                          size="sm"
                        />
                      ) : (
                        <span className={styles.metricCellPending}>—</span>
                      )}
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className={styles.actionCell}>
                    {isOwnBudget ? (
                      <button
                        type="button"
                        className={styles.editBudgetBtn}
                        onClick={() => openEditModal('project', project)}
                      >
                        Edit Budget
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.setBudgetBtn}
                        onClick={() => openEditModal('project', project)}
                      >
                        Set Budget
                      </button>
                    )}
                  </div>
                </div>

                {/* Nested Phase Section */}
                {isExpanded && (
                  <div className={styles.nestedContainer}>
                    <span className={styles.nestedHeader}>Project Phases</span>
                    {phases.length === 0 ? (
                      <div className={styles.emptyNestedState}>
                        No phases defined for this project.
                      </div>
                    ) : (
                      phases.map((phase) => {
                        const isPhaseExpanded = expandedPhases.has(phase.id);
                        const phaseBudget = budgets.find(
                          (b) => b.entity_type === 'phase' && b.phase_id === phase.id
                        );
                        const phaseSummaryKey = `phase:${phase.id}`;
                        const phaseSummary = summaries.get(phaseSummaryKey);
                        const phaseStatus = summaryStatus.get(phaseSummaryKey);
                        const isPhaseOwnBudget = Boolean(phaseBudget);
                        const taskLists = taskListsByPhase.get(phase.id) || [];

                        // Determine budget origin badge
                        let badgeType = styles.badgeUnbudgeted;
                        let badgeLabel = 'Unbudgeted';
                        if (isPhaseOwnBudget) {
                          badgeType = styles.badgeOwn;
                          badgeLabel = 'Own Budget';
                        } else if (isOwnBudget) {
                          badgeType = styles.badgeInherited;
                          badgeLabel = 'Inherited from Project';
                        }

                        return (
                          <div key={phase.id} className={styles.phaseCard}>
                            <div className={styles.phaseHeaderRow}>
                              <div className={styles.entityInfo}>
                                <button
                                  type="button"
                                  className={styles.expandBtn}
                                  onClick={() => togglePhaseExpand(phase.id)}
                                  aria-label={
                                    isPhaseExpanded
                                      ? 'Collapse task lists'
                                      : 'Expand task lists'
                                  }
                                >
                                  {isPhaseExpanded ? (
                                    <ChevronDown size={14} />
                                  ) : (
                                    <ChevronRight size={14} />
                                  )}
                                </button>
                                <Layers size={16} color="#60a5fa" />
                                <div className={styles.entityTitleBox}>
                                  <div className={styles.entityNameRow}>
                                    <span className={styles.entityName}>{phase.name}</span>
                                    <span className={`${styles.budgetBadge} ${badgeType}`}>
                                      {badgeLabel}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Phase Financial Metrics Columns */}
                              <div className={styles.metricsGroup}>
                                <div className={styles.metricCell}>
                                  <span className={styles.metricCellLabel}>Base Budget</span>
                                  <span className={styles.metricCellValue}>
                                    {isPhaseOwnBudget
                                      ? formatCurrency(phaseBudget.base_budget)
                                      : '—'}
                                  </span>
                                </div>

                                <div className={styles.metricCell}>
                                  <span className={styles.metricCellLabel}>Safety Buffer</span>
                                  <span className={styles.metricCellValue}>
                                    {isPhaseOwnBudget
                                      ? formatCurrency(phaseBudget.safety_buffer)
                                      : '—'}
                                  </span>
                                </div>

                                <div className={styles.metricCell}>
                                  <span className={styles.metricCellLabel}>Spend</span>
                                  <span className={styles.metricCellValue}>
                                    {phaseStatus?.loading ? (
                                      <span className={styles.metricCellPending}>—</span>
                                    ) : phaseStatus?.error ? (
                                      <span className={styles.metricCellError}>—</span>
                                    ) : phaseSummary ? (
                                      formatCurrency(phaseSummary.actual_spend)
                                    ) : (
                                      '—'
                                    )}
                                  </span>
                                </div>

                                <div className={styles.metricCell}>
                                  <span className={styles.metricCellLabel}>Task Lists Alloc.</span>
                                  {phaseStatus?.loading ? (
                                    <span className={styles.metricCellPending}>—</span>
                                  ) : phaseStatus?.error ? (
                                    <span className={styles.metricCellError}>—</span>
                                  ) : phaseSummary ? (
                                    <>
                                      <span className={styles.metricCellValue}>
                                        {formatCurrency(phaseSummary.allocated_to_children)}
                                      </span>
                                      <span className={styles.metricCellSub}>
                                        {formatCurrency(phaseSummary.unallocated_base)} free
                                      </span>
                                    </>
                                  ) : (
                                    <span className={styles.metricCellValue}>—</span>
                                  )}
                                </div>

                                <div className={styles.metricCell}>
                                  <span className={styles.metricCellLabel}>Risk</span>
                                  {phaseStatus?.loading ? (
                                    <span className={styles.metricCellPending}>—</span>
                                  ) : phaseStatus?.error ? (
                                    <span
                                      className={styles.metricCellError}
                                      title={phaseStatus.error}
                                    >
                                      Unavailable
                                    </span>
                                  ) : phaseSummary ? (
                                    <FinanceRiskBadge
                                      riskBand={phaseSummary.risk_band || 'GREEN'}
                                      isBudgeted={hasEffectiveBudget(phaseSummary)}
                                      size="sm"
                                    />
                                  ) : (
                                    <span className={styles.metricCellPending}>—</span>
                                  )}
                                </div>
                              </div>

                              {/* Phase Actions */}
                              <div className={styles.actionCell}>
                                {isPhaseOwnBudget ? (
                                  <button
                                    type="button"
                                    className={styles.editBudgetBtn}
                                    onClick={() => openEditModal('phase', phase, project)}
                                  >
                                    Edit Budget
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.setBudgetBtn}
                                    onClick={() => openEditModal('phase', phase, project)}
                                  >
                                    Set Budget
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Nested Task List Section */}
                            {isPhaseExpanded && (
                              <div className={styles.taskListNestedContainer}>
                                <span className={styles.nestedHeader}>Task Lists</span>
                                {taskLists.length === 0 ? (
                                  <div className={styles.emptyNestedState}>
                                    No task lists defined for this phase.
                                  </div>
                                ) : (
                                  taskLists.map((taskList) => {
                                    const taskListBudget = budgets.find(
                                      (b) =>
                                        b.entity_type === 'task_list' &&
                                        b.task_list_id === taskList.id
                                    );
                                    const tlSummaryKey = `task_list:${taskList.id}`;
                                    const tlSummary = summaries.get(tlSummaryKey);
                                    const tlStatus = summaryStatus.get(tlSummaryKey);
                                    const isTlOwnBudget = Boolean(taskListBudget);

                                    // Determine Task List budget origin badge
                                    let tlBadgeType = styles.badgeUnbudgeted;
                                    let tlBadgeLabel = 'Unbudgeted';
                                    if (isTlOwnBudget) {
                                      tlBadgeType = styles.badgeOwn;
                                      tlBadgeLabel = 'Own Budget';
                                    } else if (isPhaseOwnBudget) {
                                      tlBadgeType = styles.badgeInherited;
                                      tlBadgeLabel = 'Inherited from Phase';
                                    } else if (isOwnBudget) {
                                      tlBadgeType = styles.badgeInherited;
                                      tlBadgeLabel = 'Inherited from Project';
                                    }

                                    return (
                                      <div key={taskList.id} className={styles.taskListCard}>
                                        <div className={styles.entityInfo}>
                                          <CheckSquare size={15} color="#a78bfa" />
                                          <div className={styles.entityTitleBox}>
                                            <div className={styles.entityNameRow}>
                                              <span className={styles.entityName}>
                                                {taskList.name}
                                              </span>
                                              <span
                                                className={`${styles.budgetBadge} ${tlBadgeType}`}
                                              >
                                                {tlBadgeLabel}
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Task List Metrics */}
                                        <div className={styles.metricsGroup}>
                                          <div className={styles.metricCell}>
                                            <span className={styles.metricCellLabel}>
                                              Base Budget
                                            </span>
                                            <span className={styles.metricCellValue}>
                                              {isTlOwnBudget
                                                ? formatCurrency(taskListBudget.base_budget)
                                                : '—'}
                                            </span>
                                          </div>

                                          <div className={styles.metricCell}>
                                            <span className={styles.metricCellLabel}>
                                              Safety Buffer
                                            </span>
                                            <span className={styles.metricCellValue}>
                                              {isTlOwnBudget
                                                ? formatCurrency(taskListBudget.safety_buffer)
                                                : '—'}
                                            </span>
                                          </div>

                                          <div className={styles.metricCell}>
                                            <span className={styles.metricCellLabel}>
                                              Spend
                                            </span>
                                            <span className={styles.metricCellValue}>
                                              {tlStatus?.loading ? (
                                                <span className={styles.metricCellPending}>—</span>
                                              ) : tlStatus?.error ? (
                                                <span className={styles.metricCellError}>—</span>
                                              ) : tlSummary ? (
                                                formatCurrency(tlSummary.actual_spend)
                                              ) : (
                                                '—'
                                              )}
                                            </span>
                                          </div>

                                          <div className={styles.metricCell}>
                                            <span className={styles.metricCellLabel}>
                                              Risk
                                            </span>
                                            {tlStatus?.loading ? (
                                              <span className={styles.metricCellPending}>—</span>
                                            ) : tlStatus?.error ? (
                                              <span
                                                className={styles.metricCellError}
                                                title={tlStatus.error}
                                              >
                                                Unavailable
                                              </span>
                                            ) : tlSummary ? (
                                              <FinanceRiskBadge
                                                riskBand={tlSummary.risk_band || 'GREEN'}
                                                isBudgeted={hasEffectiveBudget(tlSummary)}
                                                size="sm"
                                              />
                                            ) : (
                                              <span className={styles.metricCellPending}>—</span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Task List Action */}
                                        <div className={styles.actionCell}>
                                          {isTlOwnBudget ? (
                                            <button
                                              type="button"
                                              className={styles.editBudgetBtn}
                                              onClick={() =>
                                                openEditModal('task_list', taskList, phase)
                                              }
                                            >
                                              Edit Budget
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              className={styles.setBudgetBtn}
                                              onClick={() =>
                                                openEditModal('task_list', taskList, phase)
                                              }
                                            >
                                              Set Budget
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Budget Set/Edit Modal */}
      {editingEntity && (
        <BudgetEditModal
          isOpen={Boolean(editingEntity)}
          onClose={() => setEditingEntity(null)}
          entity={editingEntity}
          existingBudget={editingEntity.existingBudget}
          currentSummary={editingEntity.currentSummary}
          parentSummary={editingEntity.parentSummary}
          onSave={handleSaveModal}
        />
      )}
    </div>
  );
}
