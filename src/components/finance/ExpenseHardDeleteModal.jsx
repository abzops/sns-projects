import { useState } from 'react';
import { Trash2, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import Modal from '../Modal.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './ExpenseCorrectionModal.module.css';

/**
 * ExpenseHardDeleteModal
 *
 * Destructive modal for permanently deleting an expense transaction.
 * Available strictly to users with canManageBudgets authority (Owner, Admin, CEO, CTO).
 * Calls public.hard_delete_expense_transaction and creates an immutable audit tombstone.
 */
export default function ExpenseHardDeleteModal({
  isOpen,
  onClose,
  transaction,
  onHardDelete,
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
      setClientError('A mandatory hard-delete reason is required.');
      return;
    }

    try {
      setSubmitting(true);
      await onHardDelete({
        transactionId: transaction.id,
        reason: reason.trim(),
      });
      onClose();
    } catch (err) {
      setClientError(err.message || 'Failed to hard-delete expense.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!transaction) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Permanent Hard-Delete Expense"
      maxWidth="540px"
    >
      <form onSubmit={handleSubmit} className={styles.modalBody}>
        {/* Destructive Warning Box */}
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 'var(--radius-xs)',
            padding: '0.875rem 1rem',
            color: 'var(--text)',
            fontSize: '0.8125rem',
            display: 'flex',
            gap: '0.625rem',
          }}
        >
          <ShieldAlert size={22} color="var(--red)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ color: 'var(--red)' }}>High-Privilege Destructive Action:</strong>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text)' }}>
              This will permanently delete transaction <code style={{ fontFamily: 'monospace' }}>{transaction.id}</code> and its {transaction.expense_items?.length || 0} line items ({formatCurrency(totalAmount)}) from active database tables.
            </p>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)' }}>
              An immutable audit tombstone with a full JSON snapshot will be permanently preserved in <code style={{ fontFamily: 'monospace' }}>expense_audit_logs</code>.
            </p>
          </div>
        </div>

        {/* Error Banner */}
        {clientError && (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{clientError}</span>
          </div>
        )}

        {/* Mandatory Reason */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            Mandatory Hard-Delete Reason <span className={styles.required}>*</span>
          </label>
          <textarea
            className={styles.textarea}
            placeholder="Explain why this transaction is being permanently hard-deleted (saved in permanent tombstone)..."
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
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 size={14} />
                <span>Permanently Delete</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
