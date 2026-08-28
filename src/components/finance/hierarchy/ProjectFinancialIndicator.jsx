import React from 'react';
import { formatCompactCurrency } from '../../../lib/finance.js';
import FinanceRiskBadge from '../FinanceRiskBadge.jsx';
import FinancialDetailPopover from './FinancialDetailPopover.jsx';
import ContainerFinancialDetail from './ContainerFinancialDetail.jsx';
import styles from './ProjectFinancialIndicator.module.css';

/**
 * ProjectFinancialIndicator
 *
 * Renders a compact, accessible financial utilization indicator in the Project header
 * and serves as a trigger for the P7-02B detailed financial context card.
 * Pure presentation: consumes authoritative P7-01 project_summary fields directly.
 *
 * @param {Object} props
 * @param {Object|null} props.summary - Normalized project financial summary
 * @param {boolean} [props.loading] - Whether financial data is currently loading
 * @param {any} [props.scopeKey] - Key representing active scope (closes popover on change)
 */
export default function ProjectFinancialIndicator({ summary, loading = false, scopeKey }) {
  if (loading && !summary) {
    return (
      <div className={styles.skeletonWrap} aria-hidden="true">
        <div className={styles.skeletonPill} />
        <div className={styles.skeletonBar} />
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const isBudgeted = summary.is_budgeted === true || Boolean(summary.base_budget > 0);
  const actualSpendFormatted = formatCompactCurrency(summary.actual_spend);
  const baseBudgetFormatted = formatCompactCurrency(summary.base_budget);
  const utilizationPct = summary.utilization_pct || 0;
  const clampedWidth = Math.min(100, Math.max(0, utilizationPct));
  const riskBand = summary.risk_band || 'GREEN';

  const triggerPill = (
    <div
      className={styles.projectFinanceSection}
      data-testid="project-financial-indicator"
    >
      <div className={styles.headerRow}>
        <span className={styles.financeTag}>FINANCE</span>
        {isBudgeted ? (
          <span className={styles.amounts}>
            <strong className={styles.actualAmount}>{actualSpendFormatted}</strong>
            <span className={styles.slash}> / </span>
            <span className={styles.baseAmount}>{baseBudgetFormatted}</span>
          </span>
        ) : (
          <span className={styles.amounts}>
            <strong className={styles.actualAmount}>{actualSpendFormatted}</strong>
            <span className={styles.unbudgetedSub}> spent</span>
          </span>
        )}
        {isBudgeted && (
          <span className={styles.utilizationText}>{utilizationPct}%</span>
        )}
        <FinanceRiskBadge
          riskBand={riskBand}
          isBudgeted={isBudgeted}
          size="xs"
        />
      </div>

      {isBudgeted && (
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label="Project financial utilization"
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
      )}
    </div>
  );

  return (
    <FinancialDetailPopover
      trigger={triggerPill}
      content={<ContainerFinancialDetail summary={summary} entityType="project" />}
      title="Project Financial Details"
      scopeKey={scopeKey}
    />
  );
}
