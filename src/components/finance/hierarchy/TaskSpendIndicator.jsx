import React from 'react';
import { formatCompactCurrency } from '../../../lib/finance.js';
import FinancialDetailPopover from './FinancialDetailPopover.jsx';
import TaskFinancialDetail from './TaskFinancialDetail.jsx';
import styles from './TaskSpendIndicator.module.css';

/**
 * Maps budget_source_type to compact human-readable indicator
 */
function getBudgetSourceLabel(sourceType) {
  switch (sourceType) {
    case 'task_list':
      return 'Task List';
    case 'phase':
      return 'Phase';
    case 'project':
      return 'Project';
    default:
      return null;
  }
}

/**
 * TaskSpendIndicator
 *
 * Renders a compact spend pill in the task meta section of HierarchyTaskTree
 * and serves as a trigger for the P7-02B TaskFinancialDetail popover card.
 * Pure presentation: consumes authoritative P7-01 task financial read model object.
 * Tasks never own budgets, so this component displays direct spend and ancestor budget source only.
 *
 * @param {Object} props
 * @param {Object|null} props.financial - Normalized task financial summary { direct_spend, budget_source_type, ... }
 * @param {string} [props.taskTitle] - Optional task title for accessible label
 * @param {any} [props.scopeKey] - Key representing active scope (closes popover on change)
 */
export default function TaskSpendIndicator({ financial, taskTitle, scopeKey }) {
  if (!financial) {
    return null;
  }

  const spendFormatted = formatCompactCurrency(financial.direct_spend);
  const sourceLabel = getBudgetSourceLabel(financial.budget_source_type);
  const accessibleTitle = taskTitle ? `Spend details for ${taskTitle}` : 'Task Spend Details';

  const triggerPill = (
    <span
      className={styles.taskSpendPill}
      data-testid="task-spend-indicator"
    >
      <span className={styles.amount}>{spendFormatted}</span>
      {sourceLabel ? (
        <span className={styles.sourceTag}>
          <span className={styles.arrow}>↑</span>
          <span className={styles.sourceText}>{sourceLabel}</span>
        </span>
      ) : (
        <span className={styles.spentTag}>spent</span>
      )}
    </span>
  );

  return (
    <FinancialDetailPopover
      trigger={triggerPill}
      content={<TaskFinancialDetail financial={financial} title={taskTitle} />}
      title={accessibleTitle}
      scopeKey={scopeKey}
    />
  );
}
