import { useState, useEffect } from 'react';
import { Coins, AlertTriangle, Layers, FolderKanban, CheckSquare, Loader2 } from 'lucide-react';
import Modal from '../Modal.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './BudgetEditModal.module.css';

/**
 * BudgetEditModal
 *
 * Dedicated modal for creating and updating Base Budget & Safety Buffer for
 * Projects, Phases, and Task Lists.
 *
 * Enforces authoritative financial principles:
 * - Base Budget >= 0 and Safety Buffer >= 0
 * - One entity at a time
 * - Explains hierarchy capacity and invariant restrictions
 * - Displays exact backend constraint errors
 */
export default function BudgetEditModal({
  isOpen,
  onClose,
  entity, // { type: 'project' | 'phase' | 'task_list', id, name, parentName, projectId, phaseId, taskListId }
  existingBudget = null, // { id, base_budget, safety_buffer } | null
  currentSummary = null, // { actual_spend, allocated_to_children, unallocated_base, risk_band } | null
  parentSummary = null, // { base_budget, safety_buffer, unallocated_base, allocated_to_children } | null
  onSave, // async ({ baseBudget, safetyBuffer }) => { success, error }
}) {
  const [baseBudget, setBaseBudget] = useState('');
  const [safetyBuffer, setSafetyBuffer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const isEditing = Boolean(existingBudget);
  const entityType = entity?.type || 'project';

  // Initialize form values when modal opens or entity changes
  useEffect(() => {
    if (isOpen) {
      setBaseBudget(
        existingBudget ? String(Number(existingBudget.base_budget) || 0) : ''
      );
      setSafetyBuffer(
        existingBudget ? String(Number(existingBudget.safety_buffer) || 0) : ''
      );
      setErrorMessage(null);
      setSubmitting(false);
    }
  }, [isOpen, existingBudget]);

  if (!isOpen || !entity) return null;

  const entityIcon =
    entityType === 'project' ? (
      <FolderKanban size={18} />
    ) : entityType === 'phase' ? (
      <Layers size={18} />
    ) : (
      <CheckSquare size={18} />
    );

  const entityTypeLabel =
    entityType === 'project'
      ? 'Project Budget'
      : entityType === 'phase'
      ? 'Phase Budget'
      : 'Task List Budget';

  // Compute available capacity from parent
  const parentBase = Number(parentSummary?.base_budget) || 0;
  const parentUnallocated = Number(parentSummary?.unallocated_base) || 0;
  const currentOwnBase = Number(existingBudget?.base_budget) || 0;
  const availableParentCapacity = parentUnallocated + (isEditing ? currentOwnBase : 0);

  // Child allocations if editing parent
  const childAllocations = Number(currentSummary?.allocated_to_children) || 0;
  const actualSpend = Number(currentSummary?.actual_spend) || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    const numBase = parseFloat(baseBudget);
    const numBuffer = safetyBuffer === '' ? 0 : parseFloat(safetyBuffer);

    if (isNaN(numBase) || numBase < 0) {
      setErrorMessage('Please enter a valid non-negative Base Budget amount.');
      return;
    }

    if (isNaN(numBuffer) || numBuffer < 0) {
      setErrorMessage('Please enter a valid non-negative Safety Buffer amount.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await onSave({
        baseBudget: numBase,
        safetyBuffer: numBuffer,
      });

      if (!res.success) {
        setErrorMessage(res.error || 'Failed to save budget configuration.');
      } else {
        onClose();
      }
    } catch (err) {
      setErrorMessage(err.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? undefined : onClose}
      title={isEditing ? `Edit ${entityTypeLabel}` : `Set ${entityTypeLabel}`}
      size="md"
    >
      <form onSubmit={handleSubmit} className={styles.modalContent}>
        {/* Entity Header Banner */}
        <div className={styles.entityHeader}>
          <div className={styles.entityIconWrap}>{entityIcon}</div>
          <div className={styles.entityMeta}>
            <span className={styles.entityTypeTag}>{entityTypeLabel}</span>
            <span className={styles.entityTitle}>{entity.name}</span>
          </div>
        </div>

        {/* Financial Context & Guidance Box */}
        <div className={styles.contextBox}>
          <div className={styles.contextItem}>
            <span className={styles.contextLabel}>Actual Spend</span>
            <span className={styles.contextValue}>{formatCurrency(actualSpend)}</span>
          </div>

          {entityType !== 'project' && parentSummary && (
            <div className={styles.contextItem}>
              <span className={styles.contextLabel}>Parent Capacity</span>
              <span className={`${styles.contextValue} ${styles.capacityHighlight}`}>
                {formatCurrency(availableParentCapacity)}
              </span>
            </div>
          )}

          {childAllocations > 0 && (
            <div className={styles.contextItem}>
              <span className={styles.contextLabel}>Child Allocations</span>
              <span className={styles.contextValue}>{formatCurrency(childAllocations)}</span>
            </div>
          )}
        </div>

        {/* Backend Invariant Hints */}
        {childAllocations > 0 && (
          <div className={styles.inputHint}>
            ℹ️ Base Budget cannot be reduced below current child allocations ({formatCurrency(childAllocations)}).
          </div>
        )}
        {entityType !== 'project' && parentBase > 0 && (
          <div className={styles.inputHint}>
            ℹ️ Allocations are funded exclusively from parent Base Budget ({formatCurrency(parentBase)}). Parent Safety Buffers are not allocatable.
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={16} className={styles.errorIcon} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Base Budget Input */}
        <div className={styles.formGroup}>
          <label htmlFor="baseBudgetInput" className={styles.label}>
            <span>Base Budget</span>
            <span className={styles.optionalTag}>Required (₹)</span>
          </label>
          <div className={styles.inputWrapper}>
            <span className={styles.currencyPrefix}>₹</span>
            <input
              id="baseBudgetInput"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={baseBudget}
              onChange={(e) => setBaseBudget(e.target.value)}
              className={styles.input}
              disabled={submitting}
              required
              autoFocus
            />
          </div>
        </div>

        {/* Safety Buffer Input */}
        <div className={styles.formGroup}>
          <label htmlFor="safetyBufferInput" className={styles.label}>
            <span>Safety Buffer</span>
            <span className={styles.optionalTag}>Optional (₹)</span>
          </label>
          <div className={styles.inputWrapper}>
            <span className={styles.currencyPrefix}>₹</span>
            <input
              id="safetyBufferInput"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={safetyBuffer}
              onChange={(e) => setSafetyBuffer(e.target.value)}
              className={styles.input}
              disabled={submitting}
            />
          </div>
          <span className={styles.inputHint}>
            Safety Buffer is a contingency reserve and is not allocatable to child entities.
          </span>
        </div>

        {/* Modal Action Buttons */}
        <div className={styles.actions}>
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
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={15} className={styles.spinning} />
                <span>Saving...</span>
              </>
            ) : (
              <span>{isEditing ? 'Update Budget' : 'Set Budget'}</span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
