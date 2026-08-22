import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Coins,
  TrendingUp,
  PiggyBank,
  ShieldCheck,
  Activity,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  FolderKanban,
  Building2,
} from 'lucide-react';
import { useFinanceAccess } from '../hooks/useFinanceAccess';
import { useFinanceOverview } from '../hooks/useFinanceOverview';
import { formatCurrency } from '../lib/expenseExecution';
import PageHeader from '../components/PageHeader';
import RoleBadge from '../components/RoleBadge';
import EmptyState from '../components/EmptyState';
import { Skeleton, MetricCardsSkeleton } from '../components/Skeleton';
import FinanceRiskBadge from '../components/finance/FinanceRiskBadge';
import styles from './FinanceOverviewPage.module.css';

function FinanceOverviewSkeleton() {
  return (
    <div className={styles.skeletonContainer}>
      <MetricCardsSkeleton count={5} />
      <div className={styles.analyticsSection}>
        <Skeleton height="200px" radius="var(--radius-sm)" />
        <Skeleton height="200px" radius="var(--radius-sm)" />
        <Skeleton height="200px" radius="var(--radius-sm)" />
      </div>
      <Skeleton height="320px" radius="var(--radius-sm)" />
    </div>
  );
}

export default function FinanceOverviewPage() {
  const { workspaceId } = useParams();
  const financeAccess = useFinanceAccess(workspaceId);
  const {
    canViewWorkspaceFinance,
    canManageBudgets,
    isFinanceOperator,
    financeAccessLoading,
    authorizationScopeKey,
  } = financeAccess;

  const {
    summary,
    projectSummaries,
    isUnauthorized,
    loading: financeLoading,
    refreshing,
    error,
    refetch,
  } = useFinanceOverview({
    workspaceId,
    authorizationScopeKey,
    enabled: canViewWorkspaceFinance,
  });

  // Calculate portfolio health counts (presentation count of canonical project risk states)
  const portfolioHealth = useMemo(() => {
    const counts = { green: 0, yellow: 0, orange: 0, red: 0, unbudgeted: 0 };
    for (const item of projectSummaries) {
      if (item.error || !item.summary) {
        continue;
      }
      if (!item.summary.is_budgeted) {
        counts.unbudgeted++;
      } else {
        const band = (item.summary.risk_band || 'GREEN').toLowerCase();
        if (counts[band] !== undefined) {
          counts[band]++;
        } else {
          counts.green++;
        }
      }
    }
    return counts;
  }, [projectSummaries]);

  // Loading state (context resolving or initial RPC fetch)
  if (financeAccessLoading || (financeLoading && !summary && !isUnauthorized && !error)) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Finance Overview"
          subtitle="Workspace financial command center"
        />
        <FinanceOverviewSkeleton />
      </div>
    );
  }

  // Access Denied / Unauthorized fail-closed state
  if (!canViewWorkspaceFinance || isUnauthorized) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Finance Overview"
          subtitle="Workspace financial command center"
        />
        <div className={styles.deniedContainer}>
          <div className={styles.deniedIconWrap}>
            <ShieldAlert size={36} />
          </div>
          <h2 className={styles.deniedTitle}>Finance Overview Unavailable</h2>
          <p className={styles.deniedDesc}>
            You do not have authorization to view workspace-level financial summaries.
            Access is restricted to active Workspace Owners, Workspace Admins, CEOs, CTOs, and Finance Operators.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !summary) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Finance Overview"
          subtitle="Workspace financial command center"
        />
        <EmptyState
          icon={AlertTriangle}
          title="Failed to Load Finance Overview"
          description={error}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const s = summary || {
    base_budget: 0,
    safety_buffer: 0,
    total_ceiling: 0,
    actual_spend: 0,
    remaining_base: 0,
    buffer_used: 0,
    buffer_remaining: 0,
    overrun: 0,
    utilization_pct: 0,
    risk_band: 'GREEN',
    project_spend: 0,
    standalone_spend: 0,
    is_budgeted: false,
  };

  // Utilization progress bar visual clamping
  const isBudgeted = s.is_budgeted && s.base_budget > 0;
  const baseProgressWidth = isBudgeted
    ? Math.min(100, Math.max(0, s.utilization_pct))
    : 0;
  const bufferProgressWidth = isBudgeted && s.safety_buffer > 0 && s.buffer_used > 0
    ? Math.min(100, Math.max(0, (s.buffer_used / s.safety_buffer) * 100))
    : 0;
  const overrunProgressWidth = s.overrun > 0 ? 100 : 0;

  // Spend composition visual widths
  const totalSpend = s.actual_spend || (s.project_spend + s.standalone_spend);
  const projectSpendPct = totalSpend > 0 ? (s.project_spend / totalSpend) * 100 : 0;
  const standaloneSpendPct = totalSpend > 0 ? (s.standalone_spend / totalSpend) * 100 : 0;

  // Role Badge for header
  const headerBadge = canManageBudgets ? (
    <RoleBadge role="owner" customLabel="Budget Manager" size="sm" />
  ) : isFinanceOperator ? (
    <RoleBadge role="head" customLabel="Finance Operator" size="sm" />
  ) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Finance Overview"
        subtitle="Workspace financial command center"
        badge={headerBadge}
        actions={
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => refetch()}
            disabled={refreshing}
            aria-label="Refresh financial data"
          >
            <RefreshCw size={15} className={refreshing ? styles.spinning : ''} />
            <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
          </button>
        }
      />

      {/* Overrun Warning Callout Banner */}
      {s.overrun > 0 && (
        <div className={styles.overrunBanner} role="alert">
          <AlertTriangle size={24} className={styles.overrunIcon} />
          <div className={styles.overrunText}>
            <strong>Budget Ceiling Exceeded:</strong> Spend exceeds approved Base Budget + Safety Buffer by{' '}
            <strong>{formatCurrency(s.overrun)}</strong>.
            <span className={styles.overrunNotice}>
              Informational alert: Operational tasks and workflow execution continue without interruption.
            </span>
          </div>
        </div>
      )}

      {/* Primary KPI Grid */}
      <section className={styles.kpiGrid} aria-label="Primary Financial Metrics">
        {/* 1. Base Budget Card */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Base Budget</span>
            <div className={styles.kpiIconWrap}><Coins size={18} /></div>
          </div>
          <div className={styles.kpiValue}>
            {formatCurrency(s.base_budget)}
          </div>
          <div className={styles.kpiSubtext}>
            {s.is_budgeted ? (
              `Ceiling: ${formatCurrency(s.total_ceiling)}`
            ) : (
              <span className={styles.unbudgetedPill}>No Budget Configured</span>
            )}
          </div>
        </div>

        {/* 2. Actual Spend Card */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Actual Spend</span>
            <div className={styles.kpiIconWrap}><TrendingUp size={18} /></div>
          </div>
          <div className={styles.kpiValue}>
            {formatCurrency(s.actual_spend)}
          </div>
          <div className={styles.kpiSubtext}>
            {s.is_budgeted && s.base_budget > 0 ? (
              `${s.utilization_pct.toFixed(1)}% of Base Budget`
            ) : s.actual_spend > 0 ? (
              'Unbudgeted actual spend'
            ) : (
              'Zero spend recorded'
            )}
          </div>
        </div>

        {/* 3. Remaining Base Card */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Remaining Base</span>
            <div className={styles.kpiIconWrap}><PiggyBank size={18} /></div>
          </div>
          <div className={styles.kpiValue}>
            {formatCurrency(s.remaining_base)}
          </div>
          <div className={styles.kpiSubtext}>
            {s.overrun > 0 ? (
              <span className={styles.kpiSubtextBad}>Base depleted · Overrun</span>
            ) : s.buffer_used > 0 ? (
              <span className={styles.kpiSubtextWarn}>Buffer in use: {formatCurrency(s.buffer_used)}</span>
            ) : (
              'Available in approved Base'
            )}
          </div>
        </div>

        {/* 4. Safety Buffer Card */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Safety Buffer</span>
            <div className={styles.kpiIconWrap}><ShieldCheck size={18} /></div>
          </div>
          <div className={styles.kpiValue}>
            {formatCurrency(s.safety_buffer)}
          </div>
          <div className={styles.kpiSubtext}>
            Used {formatCurrency(s.buffer_used)} · Rem {formatCurrency(s.buffer_remaining)}
          </div>
        </div>

        {/* 5. Portfolio Risk Card */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Portfolio Risk</span>
            <div className={styles.kpiIconWrap}><Activity size={18} /></div>
          </div>
          <div className={styles.kpiValue}>
            <FinanceRiskBadge
              riskBand={s.risk_band}
              isBudgeted={s.is_budgeted}
              size="md"
            />
          </div>
          <div className={styles.kpiSubtext}>
            {!s.is_budgeted
              ? 'Unbudgeted workspace'
              : s.risk_band === 'GREEN'
              ? '<80% Base Budget'
              : s.risk_band === 'YELLOW'
              ? '80%–100% Base Budget'
              : s.risk_band === 'ORANGE'
              ? 'Consuming Safety Buffer'
              : 'Ceiling Breached'}
          </div>
        </div>
      </section>

      {/* Middle Analytics Section */}
      <section className={styles.analyticsSection} aria-label="Financial Visualizations">
        {/* Utilization Visual Panel */}
        <div className={styles.analyticsCard}>
          <div className={styles.cardTitle}>
            <span>Budget Utilization</span>
            <span className={styles.utilizationStatusText}>
              {isBudgeted ? (s.overrun > 0 ? 'Exceeded' : 'Active') : 'Unbudgeted'}
            </span>
          </div>
          <div className={styles.utilizationContent}>
            <div className={styles.utilizationHeader}>
              <div className={styles.utilizationPct}>
                {isBudgeted ? `${s.utilization_pct.toFixed(1)}%` : '—'}
              </div>
              <div className={styles.utilizationStatusText}>
                {isBudgeted
                  ? `${formatCurrency(s.actual_spend)} of ${formatCurrency(s.base_budget)} Base`
                  : 'No base budget configured'}
              </div>
            </div>

            <div
              className={styles.progressBarTrack}
              role="progressbar"
              aria-valuenow={s.utilization_pct}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="Budget Utilization Progress"
            >
              {baseProgressWidth > 0 && (
                <div
                  className={styles.progressBarBase}
                  style={{ width: `${baseProgressWidth}%` }}
                  title={`Base Budget Used: ${baseProgressWidth.toFixed(1)}%`}
                />
              )}
              {bufferProgressWidth > 0 && (
                <div
                  className={styles.progressBarBuffer}
                  style={{ width: `${bufferProgressWidth}%` }}
                  title={`Safety Buffer Used: ${formatCurrency(s.buffer_used)}`}
                />
              )}
              {overrunProgressWidth > 0 && (
                <div
                  className={styles.progressBarOverrun}
                  style={{ width: '100%' }}
                  title={`Overrun: ${formatCurrency(s.overrun)}`}
                />
              )}
            </div>

            <div className={styles.metricBreakdownList}>
              <div className={styles.breakdownRow}>
                <span>Base Budget:</span>
                <strong>{formatCurrency(s.base_budget)}</strong>
              </div>
              <div className={styles.breakdownRow}>
                <span>Safety Buffer:</span>
                <strong>{formatCurrency(s.safety_buffer)}</strong>
              </div>
              <div className={styles.breakdownRow}>
                <span>Total Approved Ceiling:</span>
                <strong>{formatCurrency(s.total_ceiling)}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Spend Composition Panel */}
        <div className={styles.analyticsCard}>
          <div className={styles.cardTitle}>
            <span>Spend Composition</span>
            <FolderKanban size={16} color="var(--muted-2)" />
          </div>
          <div className={styles.compositionContent}>
            <div className={styles.compositionBar}>
              <div
                className={styles.compBarProject}
                style={{ width: `${projectSpendPct}%` }}
                title={`Projects: ${projectSpendPct.toFixed(1)}%`}
              />
              <div
                className={styles.compBarStandalone}
                style={{ width: `${standaloneSpendPct}%` }}
                title={`Standalone: ${standaloneSpendPct.toFixed(1)}%`}
              />
            </div>

            <div className={styles.compositionRows}>
              <div className={styles.compItem}>
                <div className={styles.compLabelGroup}>
                  <span className={styles.compDotProj} />
                  <span>Project Work</span>
                </div>
                <span className={styles.compValue}>{formatCurrency(s.project_spend)}</span>
              </div>
              <div className={styles.compItem}>
                <div className={styles.compLabelGroup}>
                  <span className={styles.compDotStandalone} />
                  <span>Standalone Processes</span>
                </div>
                <span className={styles.compValue}>{formatCurrency(s.standalone_spend)}</span>
              </div>
              <div className={styles.compTotalRow}>
                <span>Total Company Spend</span>
                <span>{formatCurrency(s.actual_spend)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Portfolio Health Distribution Panel */}
        <div className={`${styles.analyticsCard} ${styles.healthCardCol}`}>
          <div className={styles.cardTitle}>
            <span>Portfolio Health</span>
            <Building2 size={16} color="var(--muted-2)" />
          </div>
          <div className={styles.healthContent}>
            <div className={styles.healthGrid}>
              <div className={styles.healthItem}>
                <div className={styles.healthLabelGroup}>
                  <FinanceRiskBadge riskBand="GREEN" size="xs" />
                </div>
                <span className={styles.healthCount}>{portfolioHealth.green}</span>
              </div>
              <div className={styles.healthItem}>
                <div className={styles.healthLabelGroup}>
                  <FinanceRiskBadge riskBand="YELLOW" size="xs" />
                </div>
                <span className={styles.healthCount}>{portfolioHealth.yellow}</span>
              </div>
              <div className={styles.healthItem}>
                <div className={styles.healthLabelGroup}>
                  <FinanceRiskBadge riskBand="ORANGE" size="xs" />
                </div>
                <span className={styles.healthCount}>{portfolioHealth.orange}</span>
              </div>
              <div className={styles.healthItem}>
                <div className={styles.healthLabelGroup}>
                  <FinanceRiskBadge riskBand="RED" size="xs" />
                </div>
                <span className={styles.healthCount}>{portfolioHealth.red}</span>
              </div>
            </div>
            {portfolioHealth.unbudgeted > 0 && (
              <div className={styles.healthItem}>
                <div className={styles.healthLabelGroup}>
                  <FinanceRiskBadge isBudgeted={false} size="xs" />
                </div>
                <span className={styles.healthCount}>{portfolioHealth.unbudgeted}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Project Financial Portfolio Section */}
      <section className={styles.portfolioSection} aria-label="Project Financial Portfolio">
        <div className={styles.portfolioHeader}>
          <div className={styles.portfolioTitle}>
            <span>Project Financial Portfolio</span>
            <span className={styles.countBadge}>
              {projectSummaries.length} {projectSummaries.length === 1 ? 'Project' : 'Projects'}
            </span>
          </div>
        </div>

        {projectSummaries.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No Projects in Workspace"
            description="Create projects in this workspace to track hierarchical budgets and actual expenditures."
          />
        ) : (
          <>
            {/* Desktop Table View */}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Base Budget</th>
                    <th>Safety Buffer</th>
                    <th>Actual Spend</th>
                    <th>Utilization</th>
                    <th>Remaining Base</th>
                    <th>Risk Band</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSummaries.map(({ project, summary: pSumm, error: pErr }) => {
                    if (pErr || !pSumm) {
                      return (
                        <tr key={project.id}>
                          <td>
                            <Link
                              to={`/workspace/${workspaceId}/project/${project.id}`}
                              className={styles.projectLink}
                            >
                              <span
                                className={styles.projDot}
                                style={{ background: project.color || 'var(--yellow)' }}
                              />
                              <span>{project.name}</span>
                            </Link>
                          </td>
                          <td colSpan={6} style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                            Summary unavailable
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={project.id}>
                        <td>
                          <Link
                            to={`/workspace/${workspaceId}/project/${project.id}`}
                            className={styles.projectLink}
                          >
                            <span
                              className={styles.projDot}
                              style={{ background: project.color || 'var(--yellow)' }}
                            />
                            <span>{project.name}</span>
                          </Link>
                        </td>
                        <td className={styles.currencyCell}>
                          {pSumm.is_budgeted ? (
                            formatCurrency(pSumm.base_budget)
                          ) : (
                            <span className={styles.unbudgetedPill}>Unbudgeted</span>
                          )}
                        </td>
                        <td className={styles.currencyCell}>
                          {pSumm.is_budgeted ? formatCurrency(pSumm.safety_buffer) : '—'}
                        </td>
                        <td className={styles.currencyCell}>
                          {formatCurrency(pSumm.actual_spend)}
                        </td>
                        <td className={styles.currencyCell}>
                          {pSumm.is_budgeted && pSumm.base_budget > 0
                            ? `${pSumm.utilization_pct.toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className={styles.currencyCell}>
                          {pSumm.is_budgeted ? formatCurrency(pSumm.remaining_base) : '—'}
                        </td>
                        <td>
                          <FinanceRiskBadge
                            riskBand={pSumm.risk_band}
                            isBudgeted={pSumm.is_budgeted}
                            size="xs"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Card View */}
            <div className={styles.mobileCardsGrid}>
              {projectSummaries.map(({ project, summary: pSumm, error: pErr }) => {
                if (pErr || !pSumm) {
                  return (
                    <div key={project.id} className={styles.mobileProjectCard}>
                      <Link
                        to={`/workspace/${workspaceId}/project/${project.id}`}
                        className={styles.projectLink}
                      >
                        <span
                          className={styles.projDot}
                          style={{ background: project.color || 'var(--yellow)' }}
                        />
                        <span>{project.name}</span>
                      </Link>
                      <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                        Summary unavailable
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={project.id} className={styles.mobileProjectCard}>
                    <div className={styles.mobCardTop}>
                      <Link
                        to={`/workspace/${workspaceId}/project/${project.id}`}
                        className={styles.projectLink}
                      >
                        <span
                          className={styles.projDot}
                          style={{ background: project.color || 'var(--yellow)' }}
                        />
                        <span>{project.name}</span>
                      </Link>
                      <FinanceRiskBadge
                        riskBand={pSumm.risk_band}
                        isBudgeted={pSumm.is_budgeted}
                        size="xs"
                      />
                    </div>
                    <div className={styles.mobCardGrid}>
                      <div className={styles.mobStatItem}>
                        <span className={styles.mobStatLabel}>Base Budget</span>
                        <span className={styles.mobStatVal}>
                          {pSumm.is_budgeted ? formatCurrency(pSumm.base_budget) : 'Unbudgeted'}
                        </span>
                      </div>
                      <div className={styles.mobStatItem}>
                        <span className={styles.mobStatLabel}>Actual Spend</span>
                        <span className={styles.mobStatVal}>{formatCurrency(pSumm.actual_spend)}</span>
                      </div>
                      <div className={styles.mobStatItem}>
                        <span className={styles.mobStatLabel}>Utilization</span>
                        <span className={styles.mobStatVal}>
                          {pSumm.is_budgeted && pSumm.base_budget > 0
                            ? `${pSumm.utilization_pct.toFixed(1)}%`
                            : '—'}
                        </span>
                      </div>
                      <div className={styles.mobStatItem}>
                        <span className={styles.mobStatLabel}>Remaining</span>
                        <span className={styles.mobStatVal}>
                          {pSumm.is_budgeted ? formatCurrency(pSumm.remaining_base) : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
