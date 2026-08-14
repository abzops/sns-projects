import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import styles from './PageHeader.module.css';

export default function PageHeader({
  title,
  subtitle,
  badge = null,
  actions = null,
  backTo = null,
  onBack = null,
}) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backTo) {
      navigate(backTo);
    } else {
      navigate(-1);
    }
  };

  const showBack = Boolean(backTo || onBack);

  return (
    <div className={styles.header}>
      <div className={styles.leftGroup}>
        {showBack && (
          <button
            type="button"
            className={styles.backBtn}
            onClick={handleBack}
            aria-label="Go back"
            title="Go back"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        <div className={styles.titles}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {badge && <div className={styles.badgeWrap}>{badge}</div>}
          </div>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
      </div>

      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
