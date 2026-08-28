import { formatCurrency } from '../../../lib/expenseExecution.js';
import FinanceRiskBadge from '../FinanceRiskBadge.jsx';
import styles from './ContainerFinancialDetail.module.css';

/**
 * Maps budget_source_type to human-readable label
 */
function getBudgetSourceLabel(sourceType) {
  switch (sourceType) {
    case 'project':
      return 'Project';
    case 'phase':
      return 'Phase';
    case 'task_list':
      return 'Task List';
    default:
      return 'Ancestor';
  }
}

/**
 * ContainerFinancialDetail
 *
 * Detailed financial popover card for Project, Phase, and Task List containers.
 * Renders authoritative backend data only; handles own-budget, inherited-budget,
 * and unbudgeted semantics explicitly with zero client-side recalculation.
 *
 * @param {Object} props
 * @param {Object} props.summary - Normalized container financial summary
 * @param {('project'|'phase'|'task_list')} [props.entityType='project'] - Container entity type
 * @param {string} [props.title] - Optional display title
 */
export default function ContainerFinancialDetail({
  summary,
  entityType = 'project',
  title,
}) {
  if (!summary) return null;

  const isProject = entityType === 'project';
  const isOwnBudget = summary.is_budgeted === true;
  const isInherited =
    !isProject &&
    !isOwnBudget &&
    Boolean(summary.budget_source_id);
  const sourceLabel = getBudgetSourceLabel(summary.budget_source_type);

  const displayTitle =
    title ||
    (isProject
      ? 'Project Financial Summary'
      : entityType === 'phase'
      ? 'Phase Financial Context'
      : 'Task List Financial Context');

  // 1. OWN-BUDGET CONTAINER (Project, or Phase / Task List with own budget)
  if (isOwnBudget) {
    const hasOverrun = summary.overrun > 0;
    const hasBuffer = summary.safety_buffer > 0;

    return (
      <div className={styles.detailCard} data-testid="container-financial-detail-own">
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.entityTag}>
              {isProject ? 'PROJECT' : entityType === 'phase' ? 'PHASE' : 'TASK LIST'}
            </span>
            <span className={styles.ownershipBadge}>
              {isProject ? 'Project Budget' : 'Budget Owner'}
            </span>
          </div>
          <h4 className={styles.cardTitle}>{displayTitle}</h4>
          <div className={styles.riskRow}>
            <span className={styles.riskLabel}>Financial Risk:</span>
            <FinanceRiskBadge
              riskBand={summary.risk_band}
              isBudgeted={true}
              size="sm"
              showSubtext
            />
          </div>
        </div>

        {/* Section: Budget */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>BUDGET</div>
          <div className={styles.metricsGrid}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Base Budget</span>
              <span className={styles.metricValue}>{formatCurrency(summary.base_budget, false)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Safety Buffer</span>
              <span className={styles.metricValue}>{formatCurrency(summary.safety_buffer, false)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Total Ceiling</span>
              <span className={styles.metricValueHighlight}>{formatCurrency(summary.total_ceiling, false)}</span>
            </div>
          </div>
        </div>

        {/* Section: Spend */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>SPEND</div>
          <div className={styles.metricsGrid}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Actual Spend</span>
              <span className={styles.metricValueActual}>{formatCurrency(summary.actual_spend, false)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Remaining Base</span>
              <span className={styles.metricValue}>{formatCurrency(summary.remaining_base, false)}</span>
            </div>
          </div>
        </div>

        {/* Section: Buffer (if buffer configured) */}
        {hasBuffer && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>BUFFER</div>
            <div className={styles.metricsGrid}>
              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>Buffer Used</span>
                <span className={styles.metricValue}>{formatCurrency(summary.buffer_used, false)}</span>
              </div>
              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>Buffer Remaining</span>
                <span className={styles.metricValue}>{formatCurrency(summary.buffer_remaining, false)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Section: Status */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>STATUS</div>
          <div className={styles.metricsGrid}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Utilization</span>
              <span className={styles.metricValue}>{summary.utilization_pct || 0}%</span>
            </div>
            {hasOverrun && (
              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>Overrun</span>
                <span className={styles.metricValueOverrun}>{formatCurrency(summary.overrun, false)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. INHERITED-BUDGET CONTAINER
  if (isInherited) {
    const inheritedExplanation =
      entityType === 'phase'
        ? 'This Phase does not own an independent budget.'
        : summary.budget_source_type === 'phase'
        ? 'This Task List uses the Phase budget.'
        : 'This Task List uses the Project budget.';

    return (
      <div className={styles.detailCard} data-testid="container-financial-detail-inherited">
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.entityTag}>
              {entityType === 'phase' ? 'PHASE' : 'TASK LIST'}
            </span>
            <span className={styles.inheritedTag}>
              Uses {sourceLabel} Budget
            </span>
          </div>
          <h4 className={styles.cardTitle}>{displayTitle}</h4>
          <p className={styles.contextNotice}>{inheritedExplanation}</p>
        </div>

        {/* Section: Local Spend */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>LOCAL SPEND</div>
          <div className={styles.metricsGrid}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Local Spend</span>
              <span className={styles.metricValueActual}>{formatCurrency(summary.actual_spend, false)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Budget Source</span>
              <span className={styles.metricValue}>{sourceLabel}</span>
            </div>
          </div>
        </div>

        {/* Section: Contextual Budget (Ancestor context) */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>CONTEXTUAL BUDGET ({sourceLabel.toUpperCase()})</div>
          <div className={styles.metricsGrid}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Contextual Base</span>
              <span className={styles.metricValue}>{formatCurrency(summary.base_budget, false)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Contextual Buffer</span>
              <span className={styles.metricValue}>{formatCurrency(summary.safety_buffer, false)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Contextual Ceiling</span>
              <span className={styles.metricValueHighlight}>{formatCurrency(summary.total_ceiling, false)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Contextual Remaining</span>
              <span className={styles.metricValue}>{formatCurrency(summary.remaining_base, false)}</span>
            </div>
          </div>
          <div className={styles.riskRowContextual}>
            <span className={styles.riskLabel}>Contextual Risk:</span>
            <FinanceRiskBadge
              riskBand={summary.risk_band}
              isBudgeted={true}
              size="xs"
              showSubtext
            />
          </div>
        </div>
      </div>
    );
  }

  // 3. TRUE UNBUDGETED CONTAINER (Project, Phase, or Task List without budget or source)
  return (
    <div className={styles.detailCard} data-testid="container-financial-detail-unbudgeted">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.entityTag}>
            {isProject ? 'PROJECT' : entityType === 'phase' ? 'PHASE' : 'TASK LIST'}
          </span>
          <span className={styles.unbudgetedTag}>UNBUDGETED</span>
        </div>
        <h4 className={styles.cardTitle}>{displayTitle}</h4>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>ACTUAL SPEND</div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>Actual Spend</span>
          <span className={styles.metricValueActual}>{formatCurrency(summary.actual_spend, false)}</span>
        </div>
      </div>

      <div className={styles.unbudgetedNotice}>
        <span>No effective budget assigned.</span>
      </div>
    </div>
  );
}
