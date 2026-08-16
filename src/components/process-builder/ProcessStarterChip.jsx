import React from 'react';
import { UserRoundPlus, X } from 'lucide-react';
import styles from './ProcessStarterChip.module.css';

export default function ProcessStarterChip({ onRemove, readonly = false }) {
  return (
    <span className={styles.chip} title="Dynamic Actor: Whoever launches this process instance">
      <span className={styles.iconWrapper}>
        <UserRoundPlus size={11} className={styles.icon} />
      </span>
      <span className={styles.name}>Process Starter</span>
      {!readonly && onRemove && (
        <button
          type="button"
          className={styles.removeBtn}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove Process Starter"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
