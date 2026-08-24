import React from 'react';
import { formatCompactCurrency } from '../../../lib/finance.js';
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
 * Renders a compact spend pill in the task meta section of HierarchyTaskTree.
 * Pure presentation: consumes authoritative P7-01 task financial read model object.
 * Tasks never own budgets, so this component displays direct spend and ancestor budget source only.
 *
 * @param {Object} props
 * @param {Object|null} props.financial - Normalized task financial summary { direct_spend, budget_source_type, ... }
 */
export default function TaskSpendIndicator({ financial }) {
  if (!financial) {
    return null;
  }

  const spendFormatted = formatCompactCurrency(financial.direct_spend);
  const sourceLabel = getBudgetSourceLabel(financial.budget_source_type);
  const tooltip = `Direct Spend: ${spendFormatted}${sourceLabel ? ` (Funded by ${sourceLabel})` : ''}`;

  return (
    <span
      className={styles.taskSpendPill}
      title={tooltip}
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
}
