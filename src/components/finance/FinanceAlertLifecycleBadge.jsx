import styles from './FinanceAlertLifecycleBadge.module.css';

/**
 * FinanceAlertLifecycleBadge
 *
 * Displays authoritative incident lifecycle status (OPEN, ACKNOWLEDGED, RESOLVED)
 * and optional contextual CONDITION CLEARED status.
 */
export default function FinanceAlertLifecycleBadge({
  status,
  isConditionCleared = false,
  size = 'sm',
}) {
  const normalizedStatus = String(status || 'open').toLowerCase();

  const config = {
    open: { label: 'OPEN', className: styles.open },
    acknowledged: { label: 'ACKNOWLEDGED', className: styles.acknowledged },
    resolved: { label: 'RESOLVED', className: styles.resolved },
  }[normalizedStatus] || { label: normalizedStatus.toUpperCase(), className: styles.open };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
      <span className={`${styles.badge} ${config.className} ${styles[size] || styles.sm}`}>
        <span className={styles.dot} />
        <span>{config.label}</span>
      </span>
      {isConditionCleared && normalizedStatus !== 'resolved' && (
        <span
          className={`${styles.badge} ${styles.cleared} ${styles[size] || styles.sm}`}
          title="Underlying financial risk has dropped to GREEN or YELLOW. Incident is ready for review/resolution."
        >
          <span className={styles.dot} />
          <span>CONDITION CLEARED</span>
        </span>
      )}
    </div>
  );
}
