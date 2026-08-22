import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Info } from 'lucide-react';
import Modal from '../Modal.jsx';
import FinanceRiskBadge from './FinanceRiskBadge.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './FinanceAlertResolveModal.module.css';

/**
 * FinanceAlertResolveModal
 *
 * Controlled resolution modal for acknowledged finance alert incidents.
 * Available only to Budget Managers (canManageBudgets) when canonical risk
 * has recovered to GREEN or YELLOW.
 */
export default function FinanceAlertResolveModal({
  isOpen,
  onClose,
  alert,
  onResolve,
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState(null);

  if (!alert) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setClientError(null);
    try {
      setSubmitting(true);
      await onResolve(alert.id, note);
      onClose();
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

        {/* Informational Guidance Notice */}
        <div className={styles.infoBanner}>
          <Info size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Operational Incident Closure:</strong> Resolving this incident closes the alert record in the workspace. It does <strong>not</strong> delete finance history, budgets, expenses, or alter financial totals.
          </div>
        </div>

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
            disabled={submitting}
          />
        </div>

        {/* Modal Footer */}
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.resolveBtn}
            disabled={submitting}
          >
            {submitting ? (
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
