import styles from './Skeleton.module.css';

export function Skeleton({ width, height, radius = 'var(--radius-xs)', className = '', style = {} }) {
  return (
    <div
      className={`${styles.skeleton} ${className}`}
      style={{
        width: width || '100%',
        height: height || '20px',
        borderRadius: radius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

export function TaskRowSkeleton({ count = 5 }) {
  return (
    <div className={styles.tableSkeleton}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.rowSkeleton}>
          <div className={styles.colTitle}>
            <Skeleton height="16px" width="65%" radius="4px" />
            <Skeleton height="12px" width="40%" radius="4px" style={{ marginTop: '6px' }} />
          </div>
          <div className={styles.colStatus}>
            <Skeleton height="22px" width="80px" radius="999px" />
          </div>
          <div className={styles.colPriority}>
            <Skeleton height="14px" width="60px" radius="4px" />
          </div>
          <div className={styles.colRaci}>
            <Skeleton height="24px" width="120px" radius="6px" />
          </div>
          <div className={styles.colDate}>
            <Skeleton height="14px" width="85px" radius="4px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 4 }) {
  return (
    <div className={styles.cardGrid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.cardSkeleton}>
          <Skeleton height="20px" width="70%" radius="4px" />
          <Skeleton height="14px" width="90%" radius="4px" style={{ marginTop: '12px' }} />
          <Skeleton height="14px" width="50%" radius="4px" style={{ marginTop: '6px' }} />
          <div className={styles.cardFooterSkeleton}>
            <Skeleton height="18px" width="80px" radius="999px" />
            <Skeleton height="18px" width="60px" radius="999px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MetricCardsSkeleton({ count = 4 }) {
  return (
    <div className={styles.metricsGrid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.metricCardSkeleton}>
          <Skeleton height="14px" width="50%" radius="4px" />
          <Skeleton height="32px" width="40%" radius="6px" style={{ marginTop: '10px' }} />
          <Skeleton height="12px" width="70%" radius="4px" style={{ marginTop: '8px' }} />
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
