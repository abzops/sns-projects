/**
 * SNS PROJECTS — FINANCE ALERT CENTER PAGE
 *
 * Production central interface for persistent budget risk alerts, active incident
 * monitoring, operational awareness acknowledgment, and controlled resolution.
 *
 * Invariants & Guarantees:
 * - Read-only query directly against public.finance_alerts under RLS
 * - Realtime Postgres Changes synchronization for live operational awareness
 * - Fail-closed access control via useFinanceAccess (canViewWorkspaceFinance)
 * - Deep linking support via ?alert=<uuid> with safe fallback for invalid IDs across zero/non-zero alerts
 * - Zero direct DML mutations; delegating strictly to acknowledge_finance_alert & resolve_finance_alert RPCs
 * - Resolution authority strictly gated by canManageBudgets and current risk recovery (GREEN/YELLOW)
 * - Reactive Resolve modal state tracking by alert ID (live updates, auto-close on disappearance)
 * - Per-alert mutation locks prevent concurrent double submissions
 * - Informational side-effect only: alerts do not block operational execution
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Search,
  CheckSquare,
  CheckCircle2,
  Compass,
  Coins,
  Info,
  Filter,
} from 'lucide-react';
import { useFinanceAccess } from '../hooks/useFinanceAccess';
import { useFinanceAlerts } from '../hooks/useFinanceAlerts';
import PageHeader from '../components/PageHeader';
import RoleBadge from '../components/RoleBadge';
import EmptyState from '../components/EmptyState';
import { Skeleton, MetricCardsSkeleton } from '../components/Skeleton';
import FinanceRiskBadge from '../components/finance/FinanceRiskBadge';
import FinanceAlertLifecycleBadge from '../components/finance/FinanceAlertLifecycleBadge';
import FinanceAlertDetailModal from '../components/finance/FinanceAlertDetailModal';
import FinanceAlertResolveModal from '../components/finance/FinanceAlertResolveModal';
import { formatCurrency } from '../lib/expenseExecution';
import { useToast } from '../components/Toast';
import styles from './FinanceAlertCenterPage.module.css';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function FinanceAlertCenterPage() {
  const { workspaceId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

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
    alerts = [],
    loading,
    refreshing,
    error,
    initialFetchCompleted,
    pendingAlertActions,
    acknowledgeAlert,
    resolveAlert,
    refetch,
  } = useFinanceAlerts(workspaceId, authorizationScopeKey, {
    enabled: canViewWorkspaceFinance && !financeAccessError,
  });

  // Modal / Selected Item State (tracked strictly by ID for realtime state convergence)
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [resolveTargetAlertId, setResolveTargetAlertId] = useState(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('active'); // 'active' | 'open' | 'acknowledged' | 'resolved' | 'all'
  const [riskFilter, setRiskFilter] = useState('all'); // 'all' | 'RED' | 'ORANGE' | 'YELLOW' | 'GREEN'
  const [entityTypeFilter, setEntityTypeFilter] = useState('all'); // 'all' | 'project' | 'phase' | 'task_list'
  const [conditionFilter, setConditionFilter] = useState('all'); // 'all' | 'active_breach' | 'cleared'

  // Deep Link Handling (?alert=<uuid>)
  const deepLinkAlertId = searchParams.get('alert');

  useEffect(() => {
    if (!deepLinkAlertId || loading || !initialFetchCompleted) return;

    const matched = alerts.find((a) => a.id === deepLinkAlertId);
    if (matched) {
      setSelectedAlertId(matched.id);
    } else {
      // Completed fetch and alert not found (handles both alerts.length === 0 and alerts.length > 0)
      showToast('That Finance Alert is not available.', 'error');
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('alert');
      setSearchParams(nextParams, { replace: true });
    }
  }, [deepLinkAlertId, alerts, loading, initialFetchCompleted, searchParams, setSearchParams, showToast]);

  const handleCloseDetail = useCallback(() => {
    setSelectedAlertId(null);
    if (searchParams.has('alert')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('alert');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Selected Alert Object derived dynamically from live alerts array
  const selectedAlert = useMemo(() => {
    if (!selectedAlertId) return null;
    return alerts.find((a) => a.id === selectedAlertId) || null;
  }, [alerts, selectedAlertId]);

  // Resolve Target Alert derived dynamically from live alerts array
  const resolveTargetAlert = useMemo(() => {
    if (!resolveTargetAlertId) return null;
    return alerts.find((a) => a.id === resolveTargetAlertId) || null;
  }, [alerts, resolveTargetAlertId]);

  // Auto-close resolve modal safely if target alert disappears or becomes inaccessible
  useEffect(() => {
    if (resolveTargetAlertId && !resolveTargetAlert && !loading) {
      setResolveTargetAlertId(null);
    }
  }, [resolveTargetAlertId, resolveTargetAlert, loading]);

  // 1. KPI presentation counts from ALL authorized workspace alerts
  const kpiStats = useMemo(() => {
    let active = 0;
    let red = 0;
    let orange = 0;
    let recovered = 0;
    let resolved = 0;

    for (const a of alerts) {
      const isUnresolved = a.lifecycle_status !== 'resolved';
      if (isUnresolved) {
        active++;
        if (a.current_risk_band === 'RED') red++;
        else if (a.current_risk_band === 'ORANGE') orange++;
        else if (a.current_risk_band === 'GREEN' || a.current_risk_band === 'YELLOW') recovered++;
      } else {
        resolved++;
      }
    }

    return { active, red, orange, recovered, resolved };
  }, [alerts]);

  // 2. Filter and Priority Sort
  const filteredAlerts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return alerts
      .filter((a) => {
        // Lifecycle filter
        if (lifecycleFilter === 'active' && a.lifecycle_status === 'resolved') return false;
        if (lifecycleFilter === 'open' && a.lifecycle_status !== 'open') return false;
        if (lifecycleFilter === 'acknowledged' && a.lifecycle_status !== 'acknowledged') return false;
        if (lifecycleFilter === 'resolved' && a.lifecycle_status !== 'resolved') return false;

        // Current Risk filter
        if (riskFilter !== 'all' && a.current_risk_band !== riskFilter) return false;

        // Entity Type filter
        if (entityTypeFilter !== 'all' && a.entity_type !== entityTypeFilter) return false;

        // Condition filter
        const isCleared = Boolean(
          a.condition_cleared_at ||
            (a.lifecycle_status !== 'resolved' &&
              (a.current_risk_band === 'GREEN' || a.current_risk_band === 'YELLOW'))
        );
        if (conditionFilter === 'active_breach' && isCleared) return false;
        if (conditionFilter === 'cleared' && !isCleared) return false;

        // Search text matching across entity_name, entity_type, and resolution_note
        if (query) {
          const matchName = (a.entity_name || '').toLowerCase().includes(query);
          const matchType = (a.entity_type || '').toLowerCase().includes(query);
          const matchNote = (a.resolution_note || '').toLowerCase().includes(query);
          if (!matchName && !matchType && !matchNote) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Priority Rule 1: Unresolved before resolved
        const aUnresolved = a.lifecycle_status !== 'resolved';
        const bUnresolved = b.lifecycle_status !== 'resolved';
        if (aUnresolved !== bUnresolved) return aUnresolved ? -1 : 1;

        if (aUnresolved) {
          // Priority Rule 2: RED before ORANGE before YELLOW before GREEN
          const riskWeight = { RED: 4, ORANGE: 3, YELLOW: 2, GREEN: 1 };
          const aWeight = riskWeight[a.current_risk_band] || 0;
          const bWeight = riskWeight[b.current_risk_band] || 0;
          if (aWeight !== bWeight) return bWeight - aWeight;

          // Priority Rule 3: OPEN before ACKNOWLEDGED when same risk
          if (a.lifecycle_status !== b.lifecycle_status) {
            return a.lifecycle_status === 'open' ? -1 : 1;
          }

          // Priority Rule 4: Most recent last_breached_at first
          return new Date(b.last_breached_at) - new Date(a.last_breached_at);
        }

        // Resolved history sorts by resolved_at DESC
        return new Date(b.resolved_at || b.updated_at) - new Date(a.resolved_at || a.updated_at);
      });
  }, [alerts, searchQuery, lifecycleFilter, riskFilter, entityTypeFilter, conditionFilter]);

  const hasActiveFilters = Boolean(
    searchQuery ||
      lifecycleFilter !== 'active' ||
      riskFilter !== 'all' ||
      entityTypeFilter !== 'all' ||
      conditionFilter !== 'all'
  );

  const handleResetFilters = () => {
    setSearchQuery('');
    setLifecycleFilter('active');
    setRiskFilter('all');
    setEntityTypeFilter('all');
    setConditionFilter('all');
  };

  // Acknowledge Action Handler
  const handleAcknowledge = async (alertId) => {
    try {
      const res = await acknowledgeAlert(alertId);
      if (res?.success && !res?.staleScope) {
        showToast('Finance Alert acknowledged.', 'success');
      }
    } catch (err) {
      showToast(err.message || 'Failed to acknowledge alert', 'error');
    }
  };

  // Resolve Action Handler
  const handleResolve = async (alertId, note) => {
    try {
      const res = await resolveAlert(alertId, note);
      if (res?.success && !res?.staleScope) {
        showToast('Finance Alert resolved successfully.', 'success');
        setResolveTargetAlertId(null);
      }
    } catch (err) {
      showToast(err.message || 'Failed to resolve alert', 'error');
      throw err;
    }
  };

  // Role Badge for header
  const headerBadge = canManageBudgets ? (
    <RoleBadge role="owner" customLabel="Budget Manager" size="sm" />
  ) : isFinanceOperator ? (
    <RoleBadge role="head" customLabel="Finance Operator" size="sm" />
  ) : null;

  // 1. Finance Authorization Resolving
  if (financeAccessLoading) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Finance Alert Center"
          subtitle="Persistent budget risk incidents & lifecycle management"
        />
        <MetricCardsSkeleton count={5} />
        <Skeleton height="360px" radius="var(--radius-sm)" />
      </div>
    );
  }

  // 2. Unauthorized / Access Denied
  if (!canViewWorkspaceFinance || financeAccessError) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Finance Alert Center"
          subtitle="Persistent budget risk incidents & lifecycle management"
        />
        <EmptyState
          icon={ShieldAlert}
          title="Access Restricted"
          description={
            financeAccessError ||
            'Finance Alert Center is restricted to authorized executive and finance roles.'
          }
        />
      </div>
    );
  }

  // 3. Authorized Finance Alert Query Initial Loading
  if (loading && alerts.length === 0 && !error) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Finance Alert Center"
          subtitle="Persistent budget risk incidents & lifecycle management"
          badge={headerBadge}
        />
        <MetricCardsSkeleton count={5} />
        <Skeleton height="360px" radius="var(--radius-sm)" />
      </div>
    );
  }

  // 4. Initial Load Error (Zero cached rows)
  if (error && alerts.length === 0) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Finance Alert Center"
          subtitle="Persistent budget risk incidents & lifecycle management"
          badge={headerBadge}
        />
        <EmptyState
          icon={AlertTriangle}
          title="Failed to Load Finance Alerts"
          description={error}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Finance Alert Center"
        subtitle="Persistent budget risk incidents & lifecycle management"
        badge={headerBadge}
        actions={
          <div className={styles.headerActions}>
            <Link
              to={`/workspace/${workspaceId}/finance`}
              className={styles.actionBtn}
              title="Return to Finance Overview"
            >
              <Coins size={14} />
              <span>Finance Overview</span>
            </Link>
            <Link
              to={`/workspace/${workspaceId}/finance/explorer`}
              className={styles.actionBtn}
              title="Open Financial Explorer"
            >
              <Compass size={14} />
              <span>Financial Explorer</span>
            </Link>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => refetch()}
              disabled={refreshing}
              aria-label="Refresh alerts"
            >
              <RefreshCw size={14} className={refreshing ? styles.spinning : ''} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        }
      />

      {/* Operational Information Banner */}
      <div className={styles.infoBanner} role="status">
        <Info size={18} color="var(--accent)" style={{ flexShrink: 0 }} />
        <span>
          <strong>Operational Governance:</strong> Finance alerts provide financial risk visibility and do not block operational task or process execution.
        </span>
      </div>

      {/* Background Refresh Failure Notice (preserves loaded rows) */}
      {error && alerts.length > 0 && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-xs)',
            padding: '0.625rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'var(--red)',
            fontSize: '0.8125rem',
            gap: '0.5rem',
          }}
          role="alert"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>Failed to refresh alerts: {error}</span>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            style={{
              background: 'transparent',
              border: '1px solid var(--red)',
              color: 'var(--red)',
              borderRadius: 'var(--radius-xs)',
              padding: '0.25rem 0.5rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Retry Refresh
          </button>
        </div>
      )}

      {/* KPI Summary Cards Strip */}
      <div className={styles.kpiStrip}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabelRow}>
            <span className={styles.kpiLabel}>Active Incidents</span>
            <ShieldAlert size={16} color="var(--accent)" />
          </div>
          <div className={styles.kpiValue}>{kpiStats.active}</div>
          <span className={styles.kpiSubtext}>Open or Acknowledged</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabelRow}>
            <span className={styles.kpiLabel}>RED Breaches</span>
            <AlertTriangle size={16} color="var(--red)" />
          </div>
          <div className={styles.kpiValue} style={{ color: 'var(--red)' }}>
            {kpiStats.red}
          </div>
          <span className={styles.kpiSubtext}>Safety Buffer Exceeded</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabelRow}>
            <span className={styles.kpiLabel}>ORANGE Breaches</span>
            <AlertTriangle size={16} color="var(--orange)" />
          </div>
          <div className={styles.kpiValue} style={{ color: 'var(--orange)' }}>
            {kpiStats.orange}
          </div>
          <span className={styles.kpiSubtext}>In Safety Buffer</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabelRow}>
            <span className={styles.kpiLabel}>Recovered</span>
            <ShieldCheck size={16} color="var(--green)" />
          </div>
          <div className={styles.kpiValue} style={{ color: 'var(--green)' }}>
            {kpiStats.recovered}
          </div>
          <span className={styles.kpiSubtext}>Ready for Resolution</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabelRow}>
            <span className={styles.kpiLabel}>Resolved</span>
            <CheckCircle2 size={16} color="var(--muted)" />
          </div>
          <div className={styles.kpiValue}>{kpiStats.resolved}</div>
          <span className={styles.kpiSubtext}>Historical Archive</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className={styles.filterBar}>
        <div className={styles.filterRow}>
          {/* Search Box */}
          <div className={styles.searchBox}>
            <Search size={15} color="var(--muted)" />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by entity name, type, or note..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search alerts"
            />
          </div>

          <div className={styles.selectGroup}>
            {/* Lifecycle Filter */}
            <select
              className={styles.filterSelect}
              value={lifecycleFilter}
              onChange={(e) => setLifecycleFilter(e.target.value)}
              aria-label="Filter by lifecycle"
            >
              <option value="active">Lifecycle: Active (Open & Ack)</option>
              <option value="open">Lifecycle: Open Only</option>
              <option value="acknowledged">Lifecycle: Acknowledged Only</option>
              <option value="resolved">Lifecycle: Resolved Only</option>
              <option value="all">Lifecycle: All Incidents</option>
            </select>

            {/* Risk Band Filter */}
            <select
              className={styles.filterSelect}
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              aria-label="Filter by current risk"
            >
              <option value="all">Risk: All Bands</option>
              <option value="RED">Risk: RED</option>
              <option value="ORANGE">Risk: ORANGE</option>
              <option value="YELLOW">Risk: YELLOW</option>
              <option value="GREEN">Risk: GREEN</option>
            </select>

            {/* Entity Type Filter */}
            <select
              className={styles.filterSelect}
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              aria-label="Filter by entity type"
            >
              <option value="all">Type: All Entities</option>
              <option value="project">Type: Project</option>
              <option value="phase">Type: Phase</option>
              <option value="task_list">Type: Task List</option>
            </select>

            {/* Condition Filter */}
            <select
              className={styles.filterSelect}
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
              aria-label="Filter by condition"
            >
              <option value="all">Condition: All</option>
              <option value="active_breach">Condition: Active Breach</option>
              <option value="cleared">Condition: Cleared</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                className={styles.resetBtn}
                onClick={handleResetFilters}
                title="Reset all filters to defaults"
              >
                Reset Filters
              </button>
            )}
          </div>

          <span className={styles.filterCountText}>
            Showing {filteredAlerts.length} of {alerts.length} alerts
          </span>
        </div>
      </div>

      {/* Main List Presentation */}
      {alerts.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No finance alerts"
          description="There are currently no active or historical financial risk alerts in this workspace."
        />
      ) : filteredAlerts.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="No alerts match these filters"
          description="Try relaxing your search query or dropdown filter selections."
          actionLabel="Reset Filters"
          onAction={handleResetFilters}
        />
      ) : (
        <>
          {/* Desktop Table View */}
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>Entity</th>
                  <th>Lifecycle</th>
                  <th>Actual Spend</th>
                  <th>Base Budget</th>
                  <th>Overrun</th>
                  <th>Utilization</th>
                  <th>Last Breach</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((alert) => {
                  const currentPendingAction = pendingAlertActions[alert.id] || null;
                  const isPending = Boolean(currentPendingAction);
                  const isPendingAck = currentPendingAction === 'acknowledge';

                  const isConditionCleared = Boolean(
                    alert.condition_cleared_at ||
                      (alert.lifecycle_status !== 'resolved' &&
                        (alert.current_risk_band === 'GREEN' || alert.current_risk_band === 'YELLOW'))
                  );
                  const isRiskRecovered = alert.current_risk_band === 'GREEN' || alert.current_risk_band === 'YELLOW';
                  const isOpenStatus = alert.lifecycle_status === 'open';
                  const isAckStatus = alert.lifecycle_status === 'acknowledged';
                  const isResolvedStatus = alert.lifecycle_status === 'resolved';

                  return (
                    <tr
                      key={alert.id}
                      className={styles.tableRow}
                      onClick={() => setSelectedAlertId(alert.id)}
                    >
                      <td>
                        <FinanceRiskBadge riskBand={alert.current_risk_band} size="sm" />
                      </td>
                      <td>
                        <div className={styles.entityCell}>
                          <span className={styles.entityNameText}>{alert.entity_name}</span>
                          <span className={styles.entityTypeText}>
                            {alert.entity_type?.replace('_', ' ')}
                          </span>
                        </div>
                      </td>
                      <td>
                        <FinanceAlertLifecycleBadge
                          status={alert.lifecycle_status}
                          isConditionCleared={isConditionCleared}
                          size="sm"
                        />
                      </td>
                      <td className={styles.moneyCell}>{formatCurrency(alert.actual_spend)}</td>
                      <td className={styles.moneyCell}>{formatCurrency(alert.base_budget)}</td>
                      <td className={styles.moneyCell}>
                        {alert.overrun > 0 ? (
                          <span className={styles.overrunText}>{formatCurrency(alert.overrun)}</span>
                        ) : (
                          '₹0.00'
                        )}
                      </td>
                      <td className={styles.moneyCell}>{alert.utilization_pct}%</td>
                      <td>
                        <span className={styles.timeText} title={new Date(alert.last_breached_at).toLocaleString()}>
                          {formatRelativeTime(alert.last_breached_at)}
                        </span>
                      </td>
                      <td className={styles.actionCell} onClick={(e) => e.stopPropagation()}>
                        {isOpenStatus && (
                          <button
                            type="button"
                            className={styles.tableAckBtn}
                            onClick={() => handleAcknowledge(alert.id)}
                            disabled={isPending}
                            title="Record operational awareness"
                          >
                            <CheckSquare size={13} />
                            <span>{isPendingAck ? 'Acknowledging...' : 'Acknowledge'}</span>
                          </button>
                        )}

                        {isAckStatus && !isRiskRecovered && (
                          <span className={styles.tableStatusText}>Waiting for Recovery</span>
                        )}

                        {isAckStatus && isRiskRecovered && canManageBudgets && (
                          <button
                            type="button"
                            className={styles.tableResolveBtn}
                            onClick={() => setResolveTargetAlertId(alert.id)}
                            disabled={isPending}
                            title="Resolve cleared incident"
                          >
                            <CheckCircle2 size={13} />
                            <span>Resolve</span>
                          </button>
                        )}

                        {isAckStatus && isRiskRecovered && !canManageBudgets && (
                          <span className={styles.tableStatusText}>Awaiting Budget Manager</span>
                        )}

                        {isResolvedStatus && (
                          <button
                            type="button"
                            className={styles.tableAckBtn}
                            onClick={() => setSelectedAlertId(alert.id)}
                            title="Inspect resolved incident snapshot"
                          >
                            <span>View</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className={styles.mobileCardsContainer}>
            {filteredAlerts.map((alert) => {
              const currentPendingAction = pendingAlertActions[alert.id] || null;
              const isPending = Boolean(currentPendingAction);
              const isConditionCleared = Boolean(
                alert.condition_cleared_at ||
                  (alert.lifecycle_status !== 'resolved' &&
                    (alert.current_risk_band === 'GREEN' || alert.current_risk_band === 'YELLOW'))
              );
              const isRiskRecovered = alert.current_risk_band === 'GREEN' || alert.current_risk_band === 'YELLOW';
              const isOpenStatus = alert.lifecycle_status === 'open';
              const isAckStatus = alert.lifecycle_status === 'acknowledged';

              return (
                <div
                  key={alert.id}
                  className={styles.mobileCard}
                  onClick={() => setSelectedAlertId(alert.id)}
                >
                  <div className={styles.mobileCardHeader}>
                    <div className={styles.mobileCardEntity}>{alert.entity_name}</div>
                    <FinanceRiskBadge riskBand={alert.current_risk_band} size="sm" />
                  </div>

                  <div className={styles.mobileCardGrid}>
                    <div className={styles.mobileGridItem}>
                      <span className={styles.mobileGridLabel}>Type</span>
                      <span>{alert.entity_type?.replace('_', ' ').toUpperCase()}</span>
                    </div>
                    <div className={styles.mobileGridItem}>
                      <span className={styles.mobileGridLabel}>Lifecycle</span>
                      <FinanceAlertLifecycleBadge
                        status={alert.lifecycle_status}
                        isConditionCleared={isConditionCleared}
                        size="sm"
                      />
                    </div>
                    <div className={styles.mobileGridItem}>
                      <span className={styles.mobileGridLabel}>Actual Spend</span>
                      <span className={styles.moneyCell}>{formatCurrency(alert.actual_spend)}</span>
                    </div>
                    <div className={styles.mobileGridItem}>
                      <span className={styles.mobileGridLabel}>Overrun</span>
                      <span className={`${styles.moneyCell} ${alert.overrun > 0 ? styles.overrunText : ''}`}>
                        {formatCurrency(alert.overrun)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.mobileCardFooter}>
                    <span>Last breach: {formatRelativeTime(alert.last_breached_at)}</span>
                    <div onClick={(e) => e.stopPropagation()}>
                      {isOpenStatus && (
                        <button
                          type="button"
                          className={styles.tableAckBtn}
                          onClick={() => handleAcknowledge(alert.id)}
                          disabled={isPending}
                        >
                          <CheckSquare size={13} />
                          <span>Acknowledge</span>
                        </button>
                      )}
                      {isAckStatus && isRiskRecovered && canManageBudgets && (
                        <button
                          type="button"
                          className={styles.tableResolveBtn}
                          onClick={() => setResolveTargetAlertId(alert.id)}
                          disabled={isPending}
                        >
                          <CheckCircle2 size={13} />
                          <span>Resolve</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Incident Detail Modal */}
      {selectedAlert && (
        <FinanceAlertDetailModal
          isOpen={Boolean(selectedAlert)}
          onClose={handleCloseDetail}
          alert={selectedAlert}
          canManageBudgets={canManageBudgets}
          canViewWorkspaceFinance={canViewWorkspaceFinance}
          pendingAlertActions={pendingAlertActions}
          onAcknowledge={handleAcknowledge}
          onOpenResolve={(target) => {
            handleCloseDetail();
            setResolveTargetAlertId(target?.id || target);
          }}
        />
      )}

      {/* Controlled Resolve Modal */}
      {resolveTargetAlert && (
        <FinanceAlertResolveModal
          isOpen={Boolean(resolveTargetAlert)}
          onClose={() => setResolveTargetAlertId(null)}
          alert={resolveTargetAlert}
          canManageBudgets={canManageBudgets}
          pendingAction={pendingAlertActions[resolveTargetAlert.id]}
          onResolve={handleResolve}
        />
      )}
    </div>
  );
}
