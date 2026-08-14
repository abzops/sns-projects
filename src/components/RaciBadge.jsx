import Avatar from './Avatar';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import styles from './RaciBadge.module.css';

export function RaciRoleTag({ role, count = null, size = 'sm' }) {
  const configs = {
    R: { label: 'Responsible', short: 'R', desc: 'Does the work', className: styles.tagR },
    A: { label: 'Accountable', short: 'A', desc: 'Owns outcome', className: styles.tagA },
    C: { label: 'Consulted', short: 'C', desc: 'Provides input', className: styles.tagC },
    I: { label: 'Informed', short: 'I', desc: 'Kept updated', className: styles.tagI },
  };

  const config = configs[role] || { label: role, short: role, className: styles.default };

  return (
    <span
      className={`${styles.roleTag} ${config.className} ${styles[size] || styles.sm}`}
      title={`${config.label} — ${config.desc}`}
    >
      <strong className={styles.letter}>{config.short}</strong>
      {count !== null && <span className={styles.count}>{count}</span>}
    </span>
  );
}

export function RaciAvatarStack({ items = [], max = 3, size = 'xs' }) {
  if (!items || items.length === 0) return null;
  const visible = items.slice(0, max);
  const overflow = items.length - max;

  return (
    <div className={styles.avatarStack}>
      {visible.map((item, index) => {
        const name = item.profiles?.full_name || item.departments?.name || 'User';
        const isDept = !!item.department_id;
        const color = item.departments?.color;

        return (
          <div
            key={item.id || index}
            className={styles.stackItem}
            style={{ zIndex: visible.length - index }}
            title={`${name}${isDept ? ' (Department)' : ''}`}
          >
            {isDept ? (
              <span
                className={styles.deptCircle}
                style={{ background: color || 'var(--yellow)', color: '#000' }}
              >
                {item.departments?.code?.slice(0, 2) || 'DP'}
              </span>
            ) : (
              <Avatar
                name={name}
                src={item.profiles?.avatar_url}
                size={size === 'xs' ? 'sm' : size}
              />
            )}
          </div>
        );
      })}
      {overflow > 0 && (
        <span className={styles.overflowBadge}>+{overflow}</span>
      )}
    </div>
  );
}

export default function RaciBadge({ raci, compact = false, showDetails = false }) {
  if (!raci) return null;

  const { responsible = [], accountable = null, consulted = [], informed = [], isComplete } = raci;
  const hasAny = responsible.length > 0 || accountable || consulted.length > 0 || informed.length > 0;

  if (!hasAny) {
    return (
      <span className={styles.incompleteBadge} title="RACI incomplete: Needs Responsible & Accountable">
        <AlertCircle size={12} />
        <span>RACI Incomplete</span>
      </span>
    );
  }

  if (compact) {
    return (
      <div className={styles.compactRow}>
        {!isComplete && (
          <span className={styles.miniIncomplete} title="Incomplete RACI: Requires 1 Accountable and ≥1 Responsible">
            <AlertCircle size={12} />
          </span>
        )}

        {accountable && (
          <div className={styles.compactA} title={`Accountable: ${accountable.profiles?.full_name || 'Assigned'}`}>
            <span className={styles.roleLetterA}>A</span>
            <Avatar
              name={accountable.profiles?.full_name || 'Accountable'}
              src={accountable.profiles?.avatar_url}
              size="sm"
            />
          </div>
        )}

        {responsible.length > 0 && (
          <div className={styles.compactR}>
            <span className={styles.roleLetterR}>R</span>
            <RaciAvatarStack items={responsible} max={2} size="xs" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {!isComplete ? (
        <div className={styles.incompleteBanner}>
          <AlertCircle size={14} className={styles.warnIcon} />
          <span>RACI Incomplete (Requires 1 Accountable & ≥1 Responsible)</span>
        </div>
      ) : (
        <div className={styles.completeBanner}>
          <ShieldCheck size={14} className={styles.checkIcon} />
          <span>RACI Assigned</span>
        </div>
      )}

      {showDetails && (
        <div className={styles.detailsGrid}>
          <div className={styles.roleBox}>
            <div className={styles.roleHeader}>
              <RaciRoleTag role="R" count={responsible.length} />
              <small>Who does the work?</small>
            </div>
            <RaciAvatarStack items={responsible} max={5} />
          </div>

          <div className={styles.roleBox}>
            <div className={styles.roleHeader}>
              <RaciRoleTag role="A" count={accountable ? 1 : 0} />
              <small>Who owns the outcome?</small>
            </div>
            {accountable ? (
              <div className={styles.singleUser}>
                <Avatar name={accountable.profiles?.full_name || 'User'} size="sm" />
                <span>{accountable.profiles?.full_name || 'Assigned'}</span>
              </div>
            ) : (
              <span className={styles.unassigned}>Unassigned</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
