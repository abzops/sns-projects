import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../Modal.jsx';
import { formatCurrency, EXPENSE_CATEGORIES, parseExpenseAmount } from '../../lib/expenseExecution.js';
import styles from './ExpenseCorrectionModal.module.css';

/**
 * ExpenseCorrectionModal
 *
 * Dedicated modal for correcting an existing expense transaction.
 * Calls public.correct_expense_transaction and enforces mandatory reason and positive amounts.
 */
export default function ExpenseCorrectionModal({
  isOpen,
  onClose,
  transaction,
  onSave,
}) {
  const [expenseDate, setExpenseDate] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState(null);

  useEffect(() => {
    if (!isOpen || !transaction) {
      setExpenseDate('');
      setDescription('');
      setReason('');
      setItems([]);
      setClientError(null);
      setSubmitting(false);
      return;
    }

    setExpenseDate(transaction.expense_date || '');
    setDescription(transaction.description || '');
    setReason('');
    setClientError(null);
    setSubmitting(false);

    if (transaction.expense_items && transaction.expense_items.length > 0) {
      setItems(
        transaction.expense_items.map((item, idx) => ({
          id: item.id || `temp-${idx}`,
          line_number: item.line_number || idx + 1,
          category: item.category || 'Materials',
          description: item.description || '',
          amount: String(item.amount ?? ''),
        }))
      );
    } else {
      setItems([
        {
          id: 'item-1',
          line_number: 1,
          category: 'Materials',
          description: '',
          amount: '',
        },
      ]);
    }
  }, [isOpen, transaction]);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${prev.length + 1}`,
        line_number: prev.length + 1,
        category: 'Materials',
        description: '',
        amount: '',
      },
    ]);
  };

  const handleRemoveItem = (index) => {
    if (items.length <= 1) return;
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((item, i) => ({ ...item, line_number: i + 1 }));
    });
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const calculatedNewTotal = useMemo(() => {
    return items.reduce((sum, it) => {
      const val = parseExpenseAmount(it.amount);
      return sum + (val || 0);
    }, 0);
  }, [items]);

  const previousTotal = useMemo(() => {
    if (!transaction?.expense_items) return 0;
    return transaction.expense_items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  }, [transaction]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setClientError(null);

    if (!reason || !reason.trim()) {
      setClientError('A mandatory correction reason is required for audit history.');
      return;
    }

    if (!expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      setClientError('Please provide a valid expense date (YYYY-MM-DD).');
      return;
    }

    if (!items.length) {
      setClientError('At least one line item is required.');
      return;
    }

    const normalizedItems = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const parsedAmt = parseExpenseAmount(it.amount);
      if (parsedAmt === null || parsedAmt <= 0) {
        setClientError(`Line item #${i + 1} must have a valid positive amount greater than ₹0.00.`);
        return;
      }
      normalizedItems.push({
        line_number: i + 1,
        amount: parsedAmt,
        category: it.category?.trim() || null,
        description: it.description?.trim() || null,
      });
    }

    try {
      setSubmitting(true);
      await onSave({
        transactionId: transaction.id,
        items: normalizedItems,
        reason: reason.trim(),
        description: description ? description.trim() : null,
        expenseDate,
      });
      onClose();
    } catch (err) {
      setClientError(err.message || 'Failed to apply correction.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!transaction) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Correct Expense Transaction"
      maxWidth="680px"
    >
      <form onSubmit={handleSubmit} className={styles.modalBody}>
        {/* Context Banner */}
        <div className={styles.contextBanner}>
          <div className={styles.contextTitle}>
            {transaction.tasks?.title || 'Expense Record'}
            {transaction.tasks?.projects && ` · ${transaction.tasks.projects.name}`}
          </div>
          <div className={styles.contextMeta}>
            Transaction ID: <code style={{ fontFamily: 'monospace' }}>{transaction.id}</code>
          </div>
        </div>

        {/* Error Banner */}
        {clientError && (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{clientError}</span>
          </div>
        )}

        {/* Form Controls */}
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              Expense Date <span className={styles.required}>*</span>
            </label>
            <input
              type="date"
              className={styles.input}
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Transaction Description</label>
            <input
              type="text"
              className={styles.input}
              placeholder="Optional summary note"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {/* Items Section */}
        <div className={styles.itemsSection}>
          <div className={styles.itemsHeader}>
            <span className={styles.itemsTitle}>Corrected Line Items ({items.length})</span>
            <button
              type="button"
              className={styles.addItemBtn}
              onClick={handleAddItem}
              disabled={submitting}
            >
              <Plus size={14} />
              <span>Add Item</span>
            </button>
          </div>

          <div className={styles.itemsList}>
            {items.map((item, idx) => (
              <div key={item.id} className={styles.itemRow}>
                <select
                  className={styles.itemSelect}
                  value={item.category}
                  onChange={(e) => handleItemChange(idx, 'category', e.target.value)}
                  disabled={submitting}
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  className={styles.itemInput}
                  placeholder="Item description (optional)"
                  value={item.description}
                  onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                  disabled={submitting}
                />

                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={styles.itemInput}
                  placeholder="₹ Amount"
                  value={item.amount}
                  onChange={(e) => handleItemChange(idx, 'amount', e.target.value)}
                  disabled={submitting}
                  required
                />

                <button
                  type="button"
                  className={styles.removeItemBtn}
                  onClick={() => handleRemoveItem(idx)}
                  disabled={submitting || items.length <= 1}
                  title={items.length <= 1 ? 'Must have at least one line item' : 'Remove item'}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Summary Bar */}
        <div className={styles.totalSummaryBar}>
          <span className={styles.totalChangeLabel}>
            Previous Total: <strong>{formatCurrency(previousTotal)}</strong>
          </span>
          <div>
            <span className={styles.totalChangeLabel}>Corrected Total: </span>
            <span className={styles.totalAmountNew}>{formatCurrency(calculatedNewTotal)}</span>
          </div>
        </div>

        {/* Mandatory Correction Reason */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            Mandatory Correction Reason <span className={styles.required}>*</span>
          </label>
          <textarea
            className={styles.textarea}
            placeholder="Explain why this expense transaction is being corrected (stored permanently in immutable audit ledger)..."
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
            disabled={submitting || !reason.trim() || calculatedNewTotal <= 0}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="spinning" />
                <span>Applying Correction...</span>
              </>
            ) : (
              <span>Save Correction</span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
