import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2 } from 'lucide-react';
import Avatar from './Avatar';
import styles from './TaskDetailPanel.module.css';

const priorityOptions = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export default function TaskDetailPanel({
  task,
  isOpen,
  onClose,
  onSave,
  onDelete,
  statuses = [],
  members = [],
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    status_id: '',
    priority: 'none',
    assignee_id: '',
    due_date: '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync form with task when opened
  useEffect(() => {
    if (task && isOpen) {
      setForm({
        title: task.title || '',
        description: task.description || '',
        status_id: task.status_id || '',
        priority: task.priority || 'none',
        assignee_id: task.assignee_id || '',
        due_date: task.due_date || '',
      });
      setConfirmDelete(false);
    }
  }, [task, isOpen]);

  // ESC key to close
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = () => {
    onSave?.({ ...task, ...form });
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete?.(task.id);
    onClose?.();
  };

  // Find member assignee info safely
  const selectedMember = members.find((m) => m.user_id === form.assignee_id);
  const selectedMemberName = selectedMember?.profiles?.full_name || selectedMember?.invited_email || '';

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>Task Details</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
            aria-label="Close panel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Title */}
          <div className={styles.field}>
            <label className={styles.label}>Title</label>
            <input
              className={styles.titleInput}
              type="text"
              value={form.title}
              onChange={handleChange('title')}
              placeholder="Task title"
            />
          </div>

          {/* Description */}
          <div className={styles.field}>
            <label className={styles.label}>Description</label>
            <textarea
              className={styles.textarea}
              rows={6}
              value={form.description}
              onChange={handleChange('description')}
              placeholder="Add a description..."
            />
          </div>

          {/* Status & Priority side by side */}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Status</label>
              <select
                value={form.status_id}
                onChange={handleChange('status_id')}
              >
                <option value="">No status</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Priority</label>
              <select
                value={form.priority}
                onChange={handleChange('priority')}
              >
                {priorityOptions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Assignee */}
          <div className={styles.field}>
            <label className={styles.label}>Assignee</label>
            <div className={styles.assigneeSelect}>
              {form.assignee_id && (
                <div className={styles.assigneePreview}>
                  <Avatar
                    name={selectedMemberName}
                    size="sm"
                  />
                </div>
              )}
              <select
                value={form.assignee_id}
                onChange={handleChange('assignee_id')}
                className={styles.selectFull}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.user_id || ''}>
                    {m.profiles?.full_name || m.invited_email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div className={styles.field}>
            <label className={styles.label}>Due Date</label>
            <input
              type="date"
              value={form.due_date}
              onChange={handleChange('due_date')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {onDelete && (
              <button
                className={`${styles.deleteBtn} ${
                  confirmDelete ? styles.deleteConfirm : ''
                }`}
                onClick={handleDelete}
                type="button"
              >
                <Trash2 size={15} />
                {confirmDelete ? 'Confirm Delete' : 'Delete'}
              </button>
            )}
          </div>
          <div className={styles.footerRight}>
            <button
              className={styles.cancelBtn}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              type="button"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
