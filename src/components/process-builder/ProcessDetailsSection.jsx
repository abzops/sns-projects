import React from 'react';
import {
  FileText,
  Hash,
  Building2,
  UserCheck,
  AlignLeft,
} from 'lucide-react';
import styles from './ProcessDetailsSection.module.css';

export default function ProcessDetailsSection({
  processMeta,
  onChange,
  departments = [],
  activeMembers = [],
  readonly = false,
}) {
  const handleFieldChange = (field, value) => {
    onChange({ [field]: value });
  };

  return (
    <div className={styles.card}>
      <div className={styles.grid}>
        {/* Process Name */}
        <div className={styles.formGroup}>
          <label className={styles.label}>
            <FileText size={14} className={styles.icon} />
            <span>Process Name <span className={styles.required}>*</span></span>
          </label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Purchase Order Execution Procedure"
            value={processMeta.name || ''}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            disabled={readonly}
            required
          />
        </div>

        {/* Process Code */}
        <div className={styles.formGroup}>
          <label className={styles.label}>
            <Hash size={14} className={styles.icon} />
            <span>Process Code <span className={styles.required}>*</span></span>
          </label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. PRC-PROC-01"
            value={processMeta.code || ''}
            onChange={(e) => handleFieldChange('code', e.target.value.toUpperCase())}
            disabled={readonly}
            required
          />
        </div>

        {/* Owning Department */}
        <div className={styles.formGroup}>
          <label className={styles.label}>
            <Building2 size={14} className={styles.icon} />
            <span>Department <span className={styles.required}>*</span></span>
          </label>
          <select
            className={styles.select}
            value={processMeta.department_id || ''}
            onChange={(e) => handleFieldChange('department_id', e.target.value)}
            disabled={readonly}
            required
          >
            <option value="" disabled>Select Department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name} ({dept.code})
              </option>
            ))}
          </select>
        </div>

        {/* Process Owner */}
        <div className={styles.formGroup}>
          <label className={styles.label}>
            <UserCheck size={14} className={styles.icon} />
            <span>Process Owner <span className={styles.required}>*</span></span>
          </label>
          <select
            className={styles.select}
            value={processMeta.process_owner_id || ''}
            onChange={(e) => handleFieldChange('process_owner_id', e.target.value)}
            disabled={readonly}
            required
          >
            <option value="" disabled>Select Active Workspace Member</option>
            {activeMembers
              .filter((m) => m.status === 'active')
              .map((m) => {
                const userId = m.user_id || m.id;
                const name = m.full_name || m.profiles?.full_name || m.email || 'Member';
                return (
                  <option key={userId} value={userId}>
                    {name} ({m.email || m.profiles?.email || 'Active'})
                  </option>
                );
              })}
          </select>
        </div>
      </div>

      {/* Description */}
      <div className={styles.descriptionGroup}>
        <label className={styles.label}>
          <AlignLeft size={14} className={styles.icon} />
          <span>Description</span>
        </label>
        <textarea
          className={styles.textarea}
          placeholder="Brief summary of what this standardized process accomplishes and when to use it..."
          rows={2}
          value={processMeta.description || ''}
          onChange={(e) => handleFieldChange('description', e.target.value)}
          disabled={readonly}
        />
      </div>
    </div>
  );
}
