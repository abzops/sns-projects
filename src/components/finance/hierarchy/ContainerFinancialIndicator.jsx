import React from 'react';
import { formatCompactCurrency } from '../../../lib/finance.js';
import FinanceRiskBadge from '../FinanceRiskBadge.jsx';
import FinancialDetailPopover from './FinancialDetailPopover.jsx';
import ContainerFinancialDetail from './ContainerFinancialDetail.jsx';
import styles from './ContainerFinancialIndicator.module.css';

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
      return '';
  }
}

/**
 * ContainerFinancialIndicator
 *
 * Renders compact, accessible financial utilization indicator inside Phase and Task List headers
 * and serves as a trigger for the P7-02B detailed container context card.
 * Pure presentation: consumes authoritative P7-01 container summary objects directly.
 * Handles own-budget and inherited-budget semantics explicitly.
 *
 * @param {Object} props
 * @param {Object|null} props.summary - Normalized container financial summary
 * @param {('phase'|'task_list')} [props.entityType='phase'] - Type of the container
 * @param {string} [props.title] - Container name or label for accessible title
 * @param {any} [props.scopeKey] - Key representing active scope (closes popover on change)
 */
export default function ContainerFinancialIndicator({
  summary,
  entityType = 'phase',
  title,
  scopeKey,
}) {
  if (!summary) {
    return null;
  }

  const isOwnBudget = summary.is_budgeted === true;
  const isInherited = !isOwnBudget && Boolean(summary.budget_source_id);
  const actualSpendFormatted = formatCompactCurrency(summary.actual_spend);
  const baseBudgetFormatted = formatCompactCurrency(summary.base_budget);
  const utilizationPct = summary.utilization_pct || 0;
  const clampedWidth = Math.min(100, Math.max(0, utilizationPct));
  const riskBand = summary.risk_band || 'GREEN';
  const sourceLabel = getBudgetSourceLabel(summary.budget_source_type);
  const ariaLabel = `${entityType === 'phase' ? 'Phase' : 'Task List'} financial utilization`;
  const accessibleTitle = `${entityType === 'phase' ? 'Phase' : 'Task List'} Financial Details`;

  let triggerContent = null;

  // 1. Own Budget Display
  if (isOwnBudget) {
    triggerContent = (
      <div
        className={`${styles.containerFinance} ${styles[entityType]}`}
        data-testid={`${entityType}-financial-indicator`}
      >
        <div className={styles.topRow}>
          <span className={styles.financeLabel}>FINANCE</span>
          <span className={styles.amounts}>
            <strong className={styles.actual}>{actualSpendFormatted}</strong>
            <span className={styles.slash}> / </span>
            <span className={styles.base}>{baseBudgetFormatted}</span>
          </span>
          <span className={styles.utilizationText}>{utilizationPct}%</span>
          <FinanceRiskBadge riskBand={riskBand} isBudgeted={true} size="xs" />
        </div>

        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clampedWidth}
          aria-valuetext={`${utilizationPct}% financial utilization`}
        >
          <div
            className={`${styles.progressFill} ${styles[`risk_${riskBand.toLowerCase()}`] || styles.risk_green}`}
            style={{ width: `${clampedWidth}%` }}
          />
        </div>
      </div>
    );
  } else if (isInherited) {
    // 2. Inherited Budget Display (explicit ancestry attribution)
    triggerContent = (
      <div
        className={`${styles.containerFinance} ${styles.inherited} ${styles[entityType]}`}
        data-testid={`${entityType}-financial-indicator-inherited`}
      >
        <div className={styles.inheritedRow}>
          <span className={styles.amounts}>
            <strong className={styles.actual}>{actualSpendFormatted}</strong>
            <span className={styles.spentLabel}> spent</span>
          </span>
          <span className={styles.inheritedBadge} title={`Inheriting budget context from parent ${sourceLabel}`}>
            <span className={styles.arrowIcon}>↑</span>
            <span>{sourceLabel} budget</span>
          </span>
        </div>
      </div>
    );
  } else {
    // 3. Truly Unbudgeted Display
    triggerContent = (
      <div
        className={`${styles.containerFinance} ${styles.unbudgeted} ${styles[entityType]}`}
        data-testid={`${entityType}-financial-indicator-unbudgeted`}
      >
        <div className={styles.unbudgetedRow}>
          <span className={styles.amounts}>
            <strong className={styles.actual}>{actualSpendFormatted}</strong>
            <span className={styles.spentLabel}> spent</span>
          </span>
          <FinanceRiskBadge isBudgeted={false} size="xs" />
        </div>
      </div>
    );
  }

  return (
    <FinancialDetailPopover
      trigger={triggerContent}
      content={
        <ContainerFinancialDetail
          summary={summary}
          entityType={entityType}
          title={title}
        />
      }
      title={accessibleTitle}
      scopeKey={scopeKey}
    />
  );
}
