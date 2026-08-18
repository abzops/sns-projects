import Avatar from './Avatar';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import styles from './RaciBadge.module.css';

export function RaciRoleTag({ role, count = null, size = 'sm' }) {
  const configs = {
    R: { label: 'Assignee', short: 'R', desc: 'Does the work', className: styles.tagR },
    A: { label: 'Owner', short: 'A', desc: 'Owns outcome', className: styles.tagA },
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
      <span className={styles.incompleteBadge} title="Assignments incomplete: Needs an Owner and Assignee">
        <AlertCircle size={12} />
        <span>Assignments Incomplete</span>
      </span>
    );
  }

  if (compact) {
    const aName = accountable?.profiles?.full_name || accountable?.departments?.name || 'Owner';
    const rNames = responsible.map((r) => r.profiles?.full_name || r.departments?.name || r.departments?.code || 'Assignee').join(', ');
    const cCount = consulted.length;
    const iCount = informed.length;
    const cNames = consulted.map((c) => c.profiles?.full_name || c.departments?.name || c.departments?.code).join(', ');
    const iNames = informed.map((i) => i.profiles?.full_name || i.departments?.name || i.departments?.code).join(', ');

    const tooltipParts = [];
    if (accountable) tooltipParts.push(`Owner (A): ${aName}`);
    if (responsible.length > 0) tooltipParts.push(`Assignees (R): ${rNames}`);
    if (cCount > 0) tooltipParts.push(`Consulted (C): ${cNames}`);
    if (iCount > 0) tooltipParts.push(`Informed (I): ${iNames}`);
    const fullTooltip = tooltipParts.join('\n');

    return (
      <div className={styles.compactRow} title={fullTooltip}>
        {!isComplete && (
          <span className={styles.miniIncomplete} title="Incomplete assignments: Requires 1 Owner and at least 1 Assignee">
            <AlertCircle size={12} />
          </span>
        )}

        {accountable && (
          <div className={styles.compactA} title={`Owner: ${aName}`}>
            <span className={styles.roleLetterA}>A</span>
            <span className={styles.compactName}>{aName}</span>
          </div>
        )}

        {responsible.length > 0 && (
          <div className={styles.compactR} title={`Assignees: ${rNames}`}>
            <span className={styles.roleLetterR}>R</span>
            <RaciAvatarStack items={responsible} max={2} size="xs" />
          </div>
        )}

        {cCount > 0 && (
          <span className={styles.compactC} title={`Consulted (${cCount}): ${cNames}`}>
            <span className={styles.roleLetterC}>C</span>
            <span className={styles.compactCount}>+{cCount}</span>
          </span>
        )}

        {iCount > 0 && (
          <span className={styles.compactI} title={`Informed (${iCount}): ${iNames}`}>
            <span className={styles.roleLetterI}>I</span>
            <span className={styles.compactCount}>+{iCount}</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {!isComplete ? (
        <div className={styles.incompleteBanner}>
          <AlertCircle size={14} className={styles.warnIcon} />
          <span>Assignments Incomplete (Requires 1 Owner & at least 1 Assignee)</span>
        </div>
      ) : (
        <div className={styles.completeBanner}>
          <ShieldCheck size={14} className={styles.checkIcon} />
          <span>Assignments Complete</span>
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
