import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Hash,
  UserCheck,
  ShieldAlert,
} from 'lucide-react';
import Modal from '../Modal';
import styles from './ProcessValidationPanel.module.css';

export default function ProcessValidationPanel({
  isOpen,
  onClose,
  validationResult,
  onSelectIssue,
}) {
  if (!validationResult) return null;

  const { isValid, summary, issues = [] } = validationResult;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Process Ownership & Assignment Validation"
      size="md"
    >
      <div className={styles.container}>
        {/* Status Header Banner */}
        <div className={`${styles.statusBanner} ${isValid ? styles.bannerValid : styles.bannerInvalid}`}>
          {isValid ? (
            <>
              <CheckCircle2 size={24} className={styles.validIcon} />
              <div>
                <h4 className={styles.bannerTitle}>Matrix is Valid & Ready for Publication</h4>
                <p className={styles.bannerSubtext}>
                  All {summary.totalSteps} steps have a single Owner, required Assignees, and active members.
                </p>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle size={24} className={styles.invalidIcon} />
              <div>
                <h4 className={styles.bannerTitle}>
                  {summary.issueCount} {summary.issueCount === 1 ? 'Issue' : 'Issues'} Detected
                </h4>
                <p className={styles.bannerSubtext}>
                  Review the discrepancies below before finalizing or publishing this process.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Metrics Summary */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Total Steps</span>
            <span className={styles.statValue}>{summary.totalSteps}</span>
          </div>

          <div className={styles.statCard}>
            <span className={styles.statLabel}>Valid Codes</span>
            <span className={`${styles.statValue} ${summary.validCodes === summary.totalSteps && summary.totalSteps > 0 ? styles.statGood : styles.statWarn}`}>
              {summary.validCodes}/{summary.totalSteps}
            </span>
          </div>

          <div className={styles.statCard}>
            <span className={styles.statLabel}>Assignees (R)</span>
            <span className={`${styles.statValue} ${summary.withResponsible === summary.totalSteps && summary.totalSteps > 0 ? styles.statGood : styles.statWarn}`}>
              {summary.withResponsible}/{summary.totalSteps}
            </span>
          </div>

          <div className={styles.statCard}>
            <span className={styles.statLabel}>Owner (A)</span>
            <span className={`${styles.statValue} ${summary.withAccountable === summary.totalSteps && summary.totalSteps > 0 ? styles.statGood : styles.statWarn}`}>
              {summary.withAccountable}/{summary.totalSteps}
            </span>
          </div>
        </div>

        {/* Detailed Issues List */}
        {issues.length > 0 && (
          <div className={styles.issuesSection}>
            <h5 className={styles.issuesTitle}>Discrepancies & Recommendations</h5>
            <div className={styles.issuesList}>
              {issues.map((issue, idx) => (
                <div
                  key={idx}
                  className={styles.issueCard}
                  onClick={() => {
                    if (onSelectIssue) onSelectIssue(issue);
                    onClose();
                  }}
                >
                  <div className={styles.issueHeader}>
                    {issue.type === 'process' ? (
                      <span className={styles.issueBadgeProcess}>Process Details</span>
                    ) : (
                      <span className={styles.issueBadgeStep}>
                        Step {issue.stepNum || idx + 1} ({issue.stepCode || 'STP'})
                      </span>
                    )}
                    {issue.title && <span className={styles.issueStepTitle}>{issue.title}</span>}
                  </div>
                  <p className={styles.issueMessage}>{issue.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            Close Validation
          </button>
        </div>
      </div>
    </Modal>
  );
}
