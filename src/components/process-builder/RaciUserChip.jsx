import React from 'react';
import { X } from 'lucide-react';
import Avatar from '../Avatar';
import styles from './RaciUserChip.module.css';

export default function RaciUserChip({ user, onRemove, readonly = false }) {
  if (!user) return null;

  const displayName = user.full_name || user.email || 'User';

  return (
    <span className={styles.chip} title={`${displayName} (${user.email || ''})`}>
      <Avatar name={displayName} src={user.avatar_url} size="xs" />
      <span className={styles.name}>{displayName}</span>
      {!readonly && onRemove && (
        <button
          type="button"
          className={styles.removeBtn}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${displayName}`}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
