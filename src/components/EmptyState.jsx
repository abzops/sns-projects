import styles from './EmptyState.module.css';

export default function EmptyState({ icon: Icon, title, description, actionLabel, onAction }) {
  return (
    <div className={styles.container}>
      {Icon && (
        <div className={styles.iconWrap}>
          <Icon size={48} strokeWidth={1.5} />
        </div>
      )}
      {title && <h3 className={styles.title}>{title}</h3>}
      {description && <p className={styles.description}>{description}</p>}
      {actionLabel && onAction && (
        <button className={styles.action} onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
