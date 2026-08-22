import styles from './FinanceRiskBadge.module.css';

const RISK_CONFIGS = {
  GREEN: {
    label: 'GREEN',
    subtext: 'Within Budget',
    className: styles.green,
  },
  YELLOW: {
    label: 'YELLOW',
    subtext: '80%–100% Base',
    className: styles.yellow,
  },
  ORANGE: {
    label: 'ORANGE',
    subtext: 'In Safety Buffer',
    className: styles.orange,
  },
  RED: {
    label: 'RED',
    subtext: 'Ceiling Breached',
    className: styles.red,
  },
  UNBUDGETED: {
    label: 'UNBUDGETED',
    subtext: 'No Budget Set',
    className: styles.unbudgeted,
  },
};

export default function FinanceRiskBadge({ riskBand, isBudgeted = true, size = 'sm', showSubtext = false }) {
  if (!isBudgeted && (!riskBand || riskBand === 'GREEN')) {
    const config = RISK_CONFIGS.UNBUDGETED;
    return (
      <span className={`${styles.badge} ${config.className} ${styles[size] || styles.sm}`}>
        <span className={styles.dot} />
        <span className={styles.labelText}>{config.label}</span>
        {showSubtext && <span className={styles.subtext}>({config.subtext})</span>}
      </span>
    );
  }

  const bandKey = String(riskBand || 'GREEN').toUpperCase();
  const config = RISK_CONFIGS[bandKey] || {
    label: bandKey,
    subtext: '',
    className: styles.default,
  };

  return (
    <span className={`${styles.badge} ${config.className} ${styles[size] || styles.sm}`}>
      <span className={styles.dot} />
      <span className={styles.labelText}>{config.label}</span>
      {showSubtext && config.subtext && <span className={styles.subtext}>({config.subtext})</span>}
    </span>
  );
}
