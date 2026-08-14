import styles from './MetricCard.module.css';

export default function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  onClick,
  badge = null,
}) {
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      className={`${styles.card} ${styles[variant] || styles.default} ${onClick ? styles.clickable : ''}`}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <div className={styles.topRow}>
        <span className={styles.title}>{title}</span>
        {Icon && (
          <div className={styles.iconBox}>
            <Icon size={18} />
          </div>
        )}
      </div>

      <div className={styles.valueRow}>
        <span className={styles.value}>{value ?? 0}</span>
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>

      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </Component>
  );
}
