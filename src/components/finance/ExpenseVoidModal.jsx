import { useState } from 'react';
import { Ban, AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../Modal.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './ExpenseCorrectionModal.module.css';

/**
 * ExpenseVoidModal
 *
 * Modal for confirming voiding an expense transaction.
 * Calls public.void_expense_transaction and enforces mandatory reason.
 */
export default function ExpenseVoidModal({
  isOpen,
  onClose,
  transaction,
  onVoid,
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState(null);

  const totalAmount = (transaction?.expense_items || []).reduce(
    (sum, it) => sum + (Number(it.amount) || 0),
    0
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setClientError(null);
    if (!reason || !reason.trim()) {
      setClientError('A mandatory void reason is required.');
      return;
    }

    try {
      setSubmitting(true);
      await onVoid({
        transactionId: transaction.id,
        reason: reason.trim(),
      });
      onClose();
    } catch (err) {
      setClientError(err.message || 'Failed to void expense.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!transaction) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Void Expense Transaction"
      maxWidth="540px"
    >
      <form onSubmit={handleSubmit} className={styles.modalBody}>
        {/* Context Banner */}
        <div className={styles.contextBanner}>
          <div className={styles.contextTitle}>
            {transaction.tasks?.title || 'Expense Record'}
            {transaction.tasks?.projects && ` · ${transaction.tasks.projects.name}`}
          </div>
          <div className={styles.contextMeta}>
            Amount: <strong>{formatCurrency(totalAmount)}</strong> · Date: {transaction.expense_date}
          </div>
        </div>

        {/* Warning Notice */}
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: 'var(--radius-xs)',
            padding: '0.75rem 1rem',
            color: 'var(--text)',
            fontSize: '0.8125rem',
            display: 'flex',
            gap: '0.5rem',
          }}
        >
          <Ban size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Financial Impact:</strong> Voiding this transaction sets its effective spend contribution to <strong>₹0.00</strong> across all Finance summaries. Historical line items are preserved in the database alongside an immutable audit record.
          </div>
        </div>

        {/* Error Banner */}
        {clientError && (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{clientError}</span>
          </div>
        )}

        {/* Mandatory Void Reason */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            Mandatory Void Reason <span className={styles.required}>*</span>
          </label>
          <textarea
            className={styles.textarea}
            placeholder="Explain why this expense transaction is being voided..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
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
            className={styles.saveBtn}
            style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}
            disabled={submitting || !reason.trim()}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="spinning" />
                <span>Voiding...</span>
              </>
            ) : (
              <span>Confirm Void</span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
