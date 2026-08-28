import { formatCurrency } from '../../../lib/expenseExecution.js';
import styles from './TaskFinancialDetail.module.css';

/**
 * Maps budget_source_type to human-readable budget context
 */
function getTaskBudgetContext(sourceType) {
  switch (sourceType) {
    case 'task_list':
      return 'Uses Task List Budget';
    case 'phase':
      return 'Uses Phase Budget';
    case 'project':
      return 'Uses Project Budget';
    default:
      return 'No inherited budget';
  }
}

/**
 * TaskFinancialDetail
 *
 * Popover detail card for Tasks, Child Tasks, and Process Step Tasks.
 * Tasks never own budgets; this component renders Direct Spend, security-filtered
 * Visible Subtree Spend (if different), and ancestor Budget Context only.
 *
 * @param {Object} props
 * @param {Object} props.financial - Normalized task financial summary { direct_spend, visible_rollup_spend, budget_source_type, ... }
 * @param {string} [props.title] - Optional task title
 */
export default function TaskFinancialDetail({ financial, title }) {
  if (!financial) return null;

  const directSpend = financial.direct_spend || 0;
  const visibleRollup = financial.visible_rollup_spend || 0;
  const hasDifferentSubtree = visibleRollup !== directSpend;
  const budgetContext = getTaskBudgetContext(financial.budget_source_type);

  return (
    <div className={styles.detailCard} data-testid="task-financial-detail">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.taskTag}>TASK SPEND</span>
        </div>
        <h4 className={styles.cardTitle}>{title || 'Task Spend Context'}</h4>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>SPEND BREAKDOWN</div>
        <div className={styles.metricsGrid}>
          <div className={styles.metricItem}>
            <span className={styles.metricLabel}>Direct Spend</span>
            <span className={styles.metricValueActual}>{formatCurrency(directSpend, false)}</span>
          </div>

          {hasDifferentSubtree && (
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Visible Subtree Spend</span>
              <span className={styles.metricValueSubtree}>{formatCurrency(visibleRollup, false)}</span>
              <span className={styles.helpText}>Includes spend from work visible to you.</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>BUDGET CONTEXT</div>
        <div className={styles.contextBox}>
          <span className={styles.contextText}>{budgetContext}</span>
        </div>
      </div>
    </div>
  );
}
