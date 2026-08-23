import { CheckCircle2, Clock, Calendar, CheckSquare, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import Modal from '../Modal.jsx';
import FinanceRiskBadge from './FinanceRiskBadge.jsx';
import FinanceAlertLifecycleBadge from './FinanceAlertLifecycleBadge.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './FinanceAlertDetailModal.module.css';

/**
 * FinanceAlertDetailModal
 *
 * Full incident snapshot modal showing entity details, risk transitions,
 * financial snapshot metrics, and lifecycle action options.
 */
export default function FinanceAlertDetailModal({
  isOpen,
  onClose,
  alert,
  canManageBudgets,
  canViewWorkspaceFinance,
  pendingAlertActions,
  onAcknowledge,
  onOpenResolve,
}) {
  if (!alert) return null;

  const currentPendingAction = pendingAlertActions?.[alert.id] || null;
  const isPending = Boolean(currentPendingAction);
  const isPendingAck = currentPendingAction === 'acknowledge';

  const isConditionCleared = Boolean(
    alert.condition_cleared_at ||
      (alert.lifecycle_status !== 'resolved' &&
        (alert.current_risk_band === 'GREEN' || alert.current_risk_band === 'YELLOW'))
  );

  const isRiskRecovered = alert.current_risk_band === 'GREEN' || alert.current_risk_band === 'YELLOW';
  const isAcknowledged = alert.lifecycle_status === 'acknowledged';
  const isOpenStatus = alert.lifecycle_status === 'open';
  const isResolved = alert.lifecycle_status === 'resolved';

  const canResolveNow = isAcknowledged && canManageBudgets && isRiskRecovered;

  const formatTimestamp = (ts) => {
    if (!ts) return null;
    return new Date(ts).toLocaleString();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Finance Alert Incident Details"
      size="lg"
    >
      <div className={styles.modalBody}>
        {/* Header Card */}
        <div className={styles.headerCard}>
          <div className={styles.headerTitleRow}>
            <span className={styles.entityName}>{alert.entity_name}</span>
            <div className={styles.badgeGroup}>
              <FinanceRiskBadge riskBand={alert.current_risk_band} size="sm" />
              <FinanceAlertLifecycleBadge
                status={alert.lifecycle_status}
                isConditionCleared={isConditionCleared}
                size="sm"
              />
            </div>
          </div>
          <div className={styles.metaRow}>
            <span>Scope: <strong>{alert.entity_type?.replace('_', ' ').toUpperCase()}</strong></span>
            <span>Initial Breach: <strong>{alert.opened_risk_band}</strong></span>
            <span>Transition Gen: <strong>#{alert.transition_sequence || 1}</strong></span>
          </div>
        </div>

        {/* Financial Snapshot */}
        <div>
          <div className={styles.sectionTitle}>Financial Snapshot at Reconciliation</div>
          <div className={styles.financialGrid}>
            <div className={styles.finItem}>
              <span className={styles.finLabel}>Actual Spend</span>
              <span className={styles.finValue}>{formatCurrency(alert.actual_spend)}</span>
            </div>
            <div className={styles.finItem}>
              <span className={styles.finLabel}>Base Budget</span>
              <span className={styles.finValue}>{formatCurrency(alert.base_budget)}</span>
            </div>
            <div className={styles.finItem}>
              <span className={styles.finLabel}>Safety Buffer</span>
              <span className={styles.finValue}>{formatCurrency(alert.safety_buffer)}</span>
            </div>
            <div className={styles.finItem}>
              <span className={styles.finLabel}>Budget Overrun</span>
              <span className={`${styles.finValue} ${alert.overrun > 0 ? styles.finValueRed : ''}`}>
                {formatCurrency(alert.overrun)}
              </span>
            </div>
            <div className={styles.finItem}>
              <span className={styles.finLabel}>Utilization</span>
              <span className={styles.finValue}>{alert.utilization_pct}%</span>
            </div>
          </div>
        </div>

        {/* Incident Timeline */}
        <div className={styles.timelineSection}>
          <div className={styles.sectionTitle}>Incident Lifecycle & Audit Timeline</div>
          <div className={styles.timelineGrid}>
            <div className={styles.timelineItem}>
              <Clock size={16} className={styles.timelineIcon} />
              <div className={styles.timelineContent}>
                <span className={styles.timelineLabel}>Incident Opened</span>
                <span className={styles.timelineValue}>{formatTimestamp(alert.opened_at)}</span>
              </div>
            </div>

            <div className={styles.timelineItem}>
              <Calendar size={16} className={styles.timelineIcon} />
              <div className={styles.timelineContent}>
                <span className={styles.timelineLabel}>Last Threshold Breach</span>
                <span className={styles.timelineValue}>{formatTimestamp(alert.last_breached_at)}</span>
              </div>
            </div>

            {alert.red_at && (
              <div className={styles.timelineItem}>
                <AlertTriangle size={16} className={styles.timelineIcon} color="var(--red)" />
                <div className={styles.timelineContent}>
                  <span className={styles.timelineLabel}>Escalated to RED</span>
                  <span className={styles.timelineValue}>{formatTimestamp(alert.red_at)}</span>
                </div>
              </div>
            )}

            {alert.condition_cleared_at && (
              <div className={styles.timelineItem}>
                <ShieldCheck size={16} className={styles.timelineIcon} color="var(--green)" />
                <div className={styles.timelineContent}>
                  <span className={styles.timelineLabel}>Condition Cleared</span>
                  <span className={styles.timelineValue}>{formatTimestamp(alert.condition_cleared_at)}</span>
                </div>
              </div>
            )}

            {alert.acknowledged_at && (
              <div className={styles.timelineItem}>
                <CheckSquare size={16} className={styles.timelineIcon} />
                <div className={styles.timelineContent}>
                  <span className={styles.timelineLabel}>Acknowledged At</span>
                  <span className={styles.timelineValue}>{formatTimestamp(alert.acknowledged_at)}</span>
                </div>
              </div>
            )}

            {alert.resolved_at && (
              <div className={styles.timelineItem}>
                <CheckCircle2 size={16} className={styles.timelineIcon} color="var(--green)" />
                <div className={styles.timelineContent}>
                  <span className={styles.timelineLabel}>Resolved At</span>
                  <span className={styles.timelineValue}>{formatTimestamp(alert.resolved_at)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Resolution Note if present */}
        {alert.resolution_note && (
          <div>
            <div className={styles.sectionTitle}>Resolution Note</div>
            <div className={styles.noteBox}>{alert.resolution_note}</div>
          </div>
        )}

        {/* Modal Footer & Actions */}
        <div className={styles.modalFooter}>
          <div className={styles.actionHelpText}>
            {isOpenStatus && 'Acknowledge to record operational awareness of this budget breach.'}
            {isAcknowledged && !isRiskRecovered && 'Risk is still active. Resolution requires budget to recover to GREEN or YELLOW.'}
            {isAcknowledged && isRiskRecovered && !canManageBudgets && 'Condition cleared. Awaiting a Budget Manager to resolve.'}
            {isAcknowledged && isRiskRecovered && canManageBudgets && 'Condition cleared. Ready for Budget Manager resolution.'}
            {isResolved && 'This incident is permanently resolved and preserved for historical audit.'}
          </div>

          <div className={styles.footerButtons}>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
            >
              Close
            </button>

            {/* Acknowledge Action (Available to all authorized finance users on open alerts) */}
            {isOpenStatus && canViewWorkspaceFinance && (
              <button
                type="button"
                className={styles.ackBtn}
                onClick={() => onAcknowledge(alert.id)}
                disabled={isPending}
              >
                {isPendingAck ? (
                  <>
                    <Loader2 size={14} className={styles.spinning} />
                    <span>Acknowledging...</span>
                  </>
                ) : (
                  <>
                    <CheckSquare size={14} />
                    <span>Acknowledge Incident</span>
                  </>
                )}
              </button>
            )}

            {/* Resolve Action (Available to Budget Managers on acknowledged alerts) */}
            {isAcknowledged && canManageBudgets && (
              canResolveNow ? (
                <button
                  type="button"
                  className={styles.resolveBtn}
                  onClick={() => onOpenResolve(alert)}
                  disabled={isPending}
                >
                  <CheckCircle2 size={14} />
                  <span>Resolve Alert</span>
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.resolveDisabledBtn}
                  disabled
                  title="Risk is still active. Resolution is available after the budget returns to GREEN or YELLOW."
                >
                  <CheckCircle2 size={14} />
                  <span>Resolve Disabled</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
