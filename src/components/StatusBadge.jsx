import styles from './StatusBadge.module.css';

export default function StatusBadge({ status, size = 'md' }) {
  if (!status) return null;

  const color = status.color || '#a0a0a0';

  return (
    <span
      className={`${styles.badge} ${size === 'sm' ? styles.sm : styles.md}`}
      style={{
        '--status-color': color,
        backgroundColor: `${color}18`,
      }}
    >
      <span className={styles.dot} style={{ backgroundColor: color }} />
      <span className={styles.label}>{status.name}</span>
    </span>
  );
}
