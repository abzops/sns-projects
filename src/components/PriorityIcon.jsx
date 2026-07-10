import styles from './PriorityIcon.module.css';

const priorityConfig = {
  urgent: { color: '#ff6666', label: 'Urgent' },
  high:   { color: '#ffb020', label: 'High' },
  medium: { color: '#8cc9ff', label: 'Medium' },
  low:    { color: '#60d394', label: 'Low' },
  none:   { color: '#666',    label: 'None' },
};

export default function PriorityIcon({ priority = 'none', showLabel = false }) {
  const config = priorityConfig[priority] || priorityConfig.none;

  return (
    <span className={styles.wrapper}>
      <span
        className={`${styles.dot} ${priority === 'urgent' ? styles.pulse : ''}`}
        style={{ backgroundColor: config.color }}
      />
      {showLabel && (
        <span className={styles.label} style={{ color: config.color }}>
          {config.label}
        </span>
      )}
    </span>
  );
}
