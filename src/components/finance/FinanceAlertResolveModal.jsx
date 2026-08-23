import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Info, Ban } from 'lucide-react';
import Modal from '../Modal.jsx';
import FinanceRiskBadge from './FinanceRiskBadge.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './FinanceAlertResolveModal.module.css';

/**
 * FinanceAlertResolveModal
 *
 * Controlled resolution modal for acknowledged finance alert incidents.
 * Available only to Budget Managers (canManageBudgets) when canonical risk
 * has recovered to GREEN or YELLOW. Includes frontend defense-in-depth guards.
 */
export default function FinanceAlertResolveModal({
  isOpen,
  onClose,
  alert,
  canManageBudgets = true,
  pendingAction = null,
  onResolve,
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState(null);

  if (!alert) return null;

  const isRiskRecovered = alert.current_risk_band === 'GREEN' || alert.current_risk_band === 'YELLOW';
  const isAcknowledged = alert.lifecycle_status === 'acknowledged';
  const canResolveCurrent = isAcknowledged && isRiskRecovered && canManageBudgets;

  const isPending = submitting || pendingAction === 'resolve';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canResolveCurrent || isPending) return;

    setClientError(null);
    try {
      setSubmitting(true);
      await onResolve(alert.id, note);
    } catch (err) {
      console.error('[FinanceAlertResolveModal] Resolution failed:', err);
      setClientError(err.message || 'Failed to resolve finance alert.');
    } finally {
      setSubmitting(false);
    }
  };

  const formattedClearedAt = alert.condition_cleared_at
    ? new Date(alert.condition_cleared_at).toLocaleString()
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resolve Finance Alert"
      size="md"
    >
      <form onSubmit={handleSubmit} className={styles.modalBody}>
        {/* Context Banner */}
        <div className={styles.contextBanner}>
          <div className={styles.contextTitleRow}>
            <span className={styles.contextTitle}>{alert.entity_name}</span>
            <FinanceRiskBadge riskBand={alert.current_risk_band} size="sm" />
          </div>
          <div className={styles.contextMeta}>
            <span>Type: <strong>{alert.entity_type?.replace('_', ' ').toUpperCase()}</strong></span>
            {formattedClearedAt && (
              <span>Condition Cleared: <strong>{formattedClearedAt}</strong></span>
            )}
          </div>
        </div>

        {/* Financial Snapshot */}
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
            <span className={styles.finLabel}>Utilization</span>
            <span className={styles.finValue}>{alert.utilization_pct}%</span>
          </div>
        </div>

        {/* Defense-in-depth Ineligibility Notice */}
        {!canResolveCurrent && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 'var(--radius-xs)',
              padding: '0.75rem 1rem',
              color: 'var(--text)',
              fontSize: '0.8125rem',
              display: 'flex',
              gap: '0.625rem',
              lineHeight: '1.4',
            }}
          >
            <Ban size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Resolution Ineligible:</strong>{' '}
              {!isAcknowledged
                ? `Incident lifecycle is "${alert.lifecycle_status}". Incident must be acknowledged before it can be resolved.`
                : !isRiskRecovered
                ? `Current financial risk is ${alert.current_risk_band}. Incident can only be resolved after budget returns to GREEN or YELLOW.`
                : 'Only authorized Budget Managers may resolve finance alerts.'}
            </div>
          </div>
        )}

        {/* Informational Guidance Notice */}
        {canResolveCurrent && (
          <div className={styles.infoBanner}>
            <Info size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Operational Incident Closure:</strong> Resolving this incident closes the alert record in the workspace. It does <strong>not</strong> delete finance history, budgets, expenses, or alter financial totals.
            </div>
          </div>
        )}

        {/* Error Banner */}
        {clientError && (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{clientError}</span>
          </div>
        )}

        {/* Optional Resolution Note */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel} htmlFor="resolution-note">
            Resolution Note <span className={styles.optionalTag}>(Optional)</span>
          </label>
          <textarea
            id="resolution-note"
            className={styles.textarea}
            placeholder="Optional context on how the budget condition was addressed or cleared..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isPending || !canResolveCurrent}
          />
        </div>

        {/* Modal Footer */}
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.resolveBtn}
            disabled={isPending || !canResolveCurrent}
            title={
              !canResolveCurrent
                ? 'Resolution is disabled because the alert does not meet recovery criteria'
                : 'Confirm resolution of this alert'
            }
          >
            {isPending ? (
              <>
                <Loader2 size={14} className={styles.spinning} />
                <span>Resolving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                <span>Confirm Resolution</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
