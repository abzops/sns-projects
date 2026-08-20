import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CheckCircle2,
  Receipt,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
  Calendar,
  Layers,
  Coins,
  FileText,
} from 'lucide-react';
import Modal from './Modal';
import { useToast } from './Toast';
import {
  formatCurrency,
  parseExpenseAmount,
  validateExpenseForm,
  getLocalDateString,
  completeTaskWithExpense,
  completeSubtaskWithExpense,
  completeResponsibleStepWithExpense,
  EXPENSE_CATEGORIES,
} from '../lib/expenseExecution';
import styles from './TaskCompletionModal.module.css';

/**
 * TaskCompletionModal
 * Canonical completion and expense capture modal for ordinary tasks, defined process steps, and subtasks.
 */
export default function TaskCompletionModal({
  isOpen,
  onClose,
  task,
  subtask,
  parentTaskTitle,
  entityKind = 'task', // 'task' | 'process_step' | 'subtask'
  isDefinedTask = false,
  onSuccess,
  readOnly = false,
}) {
  const { showToast } = useToast();

  const isSubtask = entityKind === 'subtask' || Boolean(subtask);
  const isDefined = !isSubtask && (isDefinedTask || Boolean(task?.process_step_id || task?.process_instance_id));
  const cycleNumber = task?.current_cycle_number || 1;

  // Form State
  const [hasExpense, setHasExpense] = useState(false);
  const [mode, setMode] = useState('single'); // 'single' | 'itemized'
  const [expenseDate, setExpenseDate] = useState(() => getLocalDateString());
  const [singleAmount, setSingleAmount] = useState('');
  const [singleCategory, setSingleCategory] = useState('');
  const [singleDescription, setSingleDescription] = useState('');
  const [overallDescription, setOverallDescription] = useState('');
  const [items, setItems] = useState([
    { id: 'item-1', amount: '', category: '', description: '' },
  ]);
  const [notes, setNotes] = useState('');

  // Execution State
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const entityId = isSubtask ? subtask?.id : task?.id;

  // Reset form when modal opens with a new task or subtask
  useEffect(() => {
    if (isOpen) {
      setHasExpense(false);
      setMode('single');
      setExpenseDate(getLocalDateString());
      setSingleAmount('');
      setSingleCategory('');
      setSingleDescription('');
      setOverallDescription('');
      setItems([{ id: `item-${Date.now()}-1`, amount: '', category: '', description: '' }]);
      setNotes('');
      setSubmitting(false);
      setErrorMessage(null);
    }
  }, [isOpen, entityId]);

  // Derived calculated total for itemized mode
  const calculatedTotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const parsed = parseExpenseAmount(item.amount);
      return sum + (parsed !== null ? parsed : 0);
    }, 0);
  }, [items]);

  // Add Itemized Line
  const handleAddItem = useCallback(() => {
    setItems((prev) => [
      ...prev,
      { id: `item-${Date.now()}-${prev.length + 1}`, amount: '', category: '', description: '' },
    ]);
  }, []);

  // Remove Itemized Line
  const handleRemoveItem = useCallback((id) => {
    setItems((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  // Update Itemized Line
  const handleItemChange = useCallback((id, field, value) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }, []);

  // Form Submission
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (submitting || readOnly || !entityId) return;

    setErrorMessage(null);

    // Validate form
    const validation = validateExpenseForm({
      hasExpense,
      mode,
      expenseDate,
      singleAmount,
      singleCategory,
      singleDescription,
      overallDescription,
      items,
    });

    if (!validation.isValid) {
      setErrorMessage(validation.error);
      return;
    }

    setSubmitting(true);

    try {
      let res;
      if (isSubtask) {
        res = await completeSubtaskWithExpense(subtask.id, validation.payload, notes);
      } else if (isDefined) {
        res = await completeResponsibleStepWithExpense(
          task.id,
          cycleNumber,
          notes,
          validation.payload
        );
      } else {
        res = await completeTaskWithExpense(task.id, validation.payload, notes);
      }

      if (!res.success) {
        setErrorMessage(res.error || (isSubtask ? 'Failed to complete subtask.' : 'Failed to complete task.'));
        setSubmitting(false);
        return;
      }

      // Defensive contract guard: If expense was requested, verify backend confirmed transaction_id
      if (hasExpense && !res.data?.transaction_id) {
        setErrorMessage(
          'Contract Error: Expense was submitted but backend completion response did not return a confirmed transaction ID.'
        );
        setSubmitting(false);
        return;
      }

      // Success feedback
      if (isSubtask) {
        showToast(
          hasExpense && res.data?.transaction_id
            ? `Subtask "${subtask.title}" completed with expense recorded!`
            : `Subtask "${subtask.title}" completed!`,
          'success'
        );
      } else if (isDefined) {
        const stepStatus = res.data?.status || res.data?.step_result?.status;
        const remainingResp = res.data?.step_result?.remaining_responsible;

        if (remainingResp && remainingResp > 0) {
          showToast(
            `Contribution recorded (${remainingResp} Assignee${remainingResp > 1 ? 's' : ''} remaining).`,
            'success'
          );
        } else if (stepStatus === 'in_review' || stepStatus === 'awaiting_approval') {
          showToast(`Step "${task.title}" submitted for review.`, 'success');
        } else if (stepStatus === 'awaiting_consultation') {
          showToast(`Step "${task.title}" submitted for consultation.`, 'success');
        } else if (stepStatus === 'completed' || res.data?.success) {
          showToast(
            hasExpense
              ? `Step "${task.title}" completed with expense recorded!`
              : `Step "${task.title}" completed successfully!`,
            'success'
          );
        } else {
          showToast(`Step "${task.title}" advanced.`, 'success');
        }
      } else {
        showToast(
          hasExpense
            ? `Task "${task.title}" completed with expense recorded!`
            : `Task "${task.title}" completed!`,
          'success'
        );
      }

      onSuccess?.(res.data);
      onClose();
    } catch (err) {
      console.error('[TaskCompletionModal] submit error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during completion.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || (!task && !subtask)) return null;

  const modalTitle = isSubtask ? 'Complete Subtask' : 'Complete Task';
  const displayTitle = isSubtask ? (subtask?.title || 'Untitled Subtask') : (task?.title || 'Untitled Task');
  const parentTitle = isSubtask ? (parentTaskTitle || task?.title) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? undefined : onClose}
      title={modalTitle}
      size="lg"
    >
      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {/* Header Summary Banner */}
        <div className={styles.taskBanner}>
          <div className={styles.taskBannerHeader}>
            <span className={styles.taskTitleBadge}>
              <CheckCircle2 size={14} className={styles.taskCheckIcon} />
              <span className={styles.taskTitleText}>{displayTitle}</span>
            </span>
            {isDefined && (
              <span className={styles.cycleBadge} title="Defined Process Rework Cycle">
                <Layers size={12} /> Cycle {cycleNumber}
              </span>
            )}
          </div>
          {parentTitle && (
            <span className={styles.taskListMeta}>Task: {parentTitle}</span>
          )}
          {!isSubtask && task?.task_lists?.name && (
            <span className={styles.taskListMeta}>List: {task.task_lists.name}</span>
          )}
        </div>


        {/* Choice Cards: Complete without Expense vs Add Expense & Complete */}
        <div className={styles.choiceGroup}>
          <button
            type="button"
            className={`${styles.choiceCard} ${!hasExpense ? styles.choiceCardActive : ''}`}
            onClick={() => {
              if (!submitting) {
                setHasExpense(false);
                setErrorMessage(null);
              }
            }}
            disabled={submitting}
          >
            <div className={styles.choiceIconWrap}>
              <CheckCircle2 size={20} />
            </div>
            <div className={styles.choiceText}>
              <span className={styles.choiceTitle}>Complete without Expense</span>
              <span className={styles.choiceSub}>
                Mark this work as done with ₹0.00 direct operational expense
              </span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.choiceCard} ${hasExpense ? styles.choiceCardActive : ''}`}
            onClick={() => {
              if (!submitting) {
                setHasExpense(true);
                setErrorMessage(null);
              }
            }}
            disabled={submitting}
          >
            <div className={styles.choiceIconWrap}>
              <Receipt size={20} />
            </div>
            <div className={styles.choiceText}>
              <span className={styles.choiceTitle}>Add Expense & Complete</span>
              <span className={styles.choiceSub}>
                Capture operational costs and line items atomically with completion
              </span>
            </div>
          </button>
        </div>

        {/* Expense Form Section (Shown only when hasExpense is true) */}
        {hasExpense && (
          <div className={styles.expenseSection}>
            <div className={styles.expenseSectionHeader}>
              <div className={styles.modeToggle}>
                <button
                  type="button"
                  className={`${styles.modeBtn} ${mode === 'single' ? styles.modeBtnActive : ''}`}
                  onClick={() => setMode('single')}
                  disabled={submitting}
                >
                  <Coins size={14} /> Single Total
                </button>
                <button
                  type="button"
                  className={`${styles.modeBtn} ${mode === 'itemized' ? styles.modeBtnActive : ''}`}
                  onClick={() => setMode('itemized')}
                  disabled={submitting}
                >
                  <FileText size={14} /> Itemized / Split
                </button>
              </div>

              {/* Expense Date Picker */}
              <div className={styles.datePickerWrap}>
                <label htmlFor="expense-date" className={styles.dateLabel}>
                  <Calendar size={13} /> Expense Date
                </label>
                <input
                  id="expense-date"
                  type="date"
                  className={styles.dateInput}
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {/* Mode A: Single Total */}
            {mode === 'single' && (
              <div className={styles.singleFormGrid}>
                <div className={styles.fieldItem}>
                  <label htmlFor="single-amount" className={styles.label}>
                    Amount (₹) <span className={styles.requiredStar}>*</span>
                  </label>
                  <div className={styles.amountInputWrap}>
                    <span className={styles.currencyPrefix}>₹</span>
                    <input
                      id="single-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      className={styles.amountInput}
                      value={singleAmount}
                      onChange={(e) => setSingleAmount(e.target.value)}
                      disabled={submitting}
                      required
                    />
                  </div>
                </div>

                <div className={styles.fieldItem}>
                  <label htmlFor="single-category" className={styles.label}>
                    Category <span className={styles.optionalTag}>(Optional)</span>
                  </label>
                  <input
                    id="single-category"
                    list="expense-category-list"
                    type="text"
                    placeholder="e.g. Hardware, Materials, Travel..."
                    className={styles.textInput}
                    value={singleCategory}
                    onChange={(e) => setSingleCategory(e.target.value)}
                    disabled={submitting}
                  />
                  <datalist id="expense-category-list">
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </div>

                <div className={`${styles.fieldItem} ${styles.fullWidthField}`}>
                  <label htmlFor="single-desc" className={styles.label}>
                    Description <span className={styles.optionalTag}>(Optional)</span>
                  </label>
                  <input
                    id="single-desc"
                    type="text"
                    placeholder="Brief description of this expense..."
                    className={styles.textInput}
                    value={singleDescription}
                    onChange={(e) => setSingleDescription(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>
            )}

            {/* Mode B: Itemized / Split Lines */}
            {mode === 'itemized' && (
              <div className={styles.itemizedSection}>
                <div className={styles.itemizedHeader}>
                  <span className={styles.colLine}>#</span>
                  <span className={styles.colAmount}>Amount (₹) *</span>
                  <span className={styles.colCat}>Category</span>
                  <span className={styles.colDesc}>Description</span>
                  <span className={styles.colAction}></span>
                </div>

                <div className={styles.itemizedList}>
                  {items.map((item, index) => (
                    <div key={item.id} className={styles.itemizedRow}>
                      <span className={styles.lineBadge}>{index + 1}</span>

                      <div className={styles.itemAmountWrap}>
                        <span className={styles.currencyPrefix}>₹</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="0.00"
                          className={styles.itemAmountInput}
                          value={item.amount}
                          onChange={(e) => handleItemChange(item.id, 'amount', e.target.value)}
                          disabled={submitting}
                          required
                          aria-label={`Line ${index + 1} Amount`}
                        />
                      </div>

                      <div className={styles.itemCatWrap}>
                        <input
                          list="expense-category-list"
                          type="text"
                          placeholder="Category"
                          className={styles.itemCatInput}
                          value={item.category}
                          onChange={(e) => handleItemChange(item.id, 'category', e.target.value)}
                          disabled={submitting}
                          aria-label={`Line ${index + 1} Category`}
                        />
                      </div>

                      <div className={styles.itemDescWrap}>
                        <input
                          type="text"
                          placeholder="Line description"
                          className={styles.itemDescInput}
                          value={item.description}
                          onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                          disabled={submitting}
                          aria-label={`Line ${index + 1} Description`}
                        />
                      </div>

                      <div className={styles.itemActionWrap}>
                        <button
                          type="button"
                          className={styles.removeLineBtn}
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={submitting || items.length <= 1}
                          title={items.length <= 1 ? 'At least one line item is required' : 'Remove line'}
                          aria-label={`Remove line ${index + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.itemizedFooter}>
                  <button
                    type="button"
                    className={styles.addLineBtn}
                    onClick={handleAddItem}
                    disabled={submitting}
                  >
                    <Plus size={14} /> Add Line Item
                  </button>

                  <div className={styles.calculatedTotalCard}>
                    <span className={styles.calculatedLabel}>Calculated Total:</span>
                    <span className={styles.calculatedValue}>
                      {formatCurrency(calculatedTotal)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Completion Notes Section */}
        <div className={styles.notesSection}>
          <label htmlFor="completion-notes" className={styles.label}>
            Completion Notes <span className={styles.optionalTag}>(Optional)</span>
          </label>
          <textarea
            id="completion-notes"
            rows={2}
            className={styles.textarea}
            placeholder={
              isDefined
                ? 'Optional notes regarding your contribution or delivery...'
                : 'Optional notes or comments on work performed...'
            }
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* Error Notice */}
        {errorMessage && (
          <div className={styles.errorNotice} role="alert">
            <AlertCircle size={16} className={styles.errorIcon} />
            <div className={styles.errorText}>
              <strong>Completion Error</strong>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className={styles.footerActions}>
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
            className={styles.submitBtn}
            disabled={submitting || readOnly}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className={styles.spinIcon} />
                {hasExpense ? 'Recording Expense & Completing...' : (isSubtask ? 'Completing Subtask...' : 'Completing Task...')}
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                {hasExpense ? 'Record Expense & Complete' : (isSubtask ? 'Complete Subtask' : 'Complete Task')}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
