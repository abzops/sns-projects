import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Trash2,
  Plus,
  AlertCircle,
  ShieldCheck,
  Users,
  Building,
  CheckCircle2,
  Circle,
  Calendar,
  Layers,
  ListTodo,
} from 'lucide-react';
import Avatar from './Avatar';
import { useAuth } from '../contexts/AuthContext';
import { useRaci } from '../hooks/useRaci';
import { useSubtasks } from '../hooks/useSubtasks';
import { getMemberDisplayName } from '../lib/identity';
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
  departments = [],
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    title: '',
    description: '',
    status_id: '',
    priority: 'none',
    assignee_id: '',
    due_date: '',
    milestone_id: '',
    task_list_id: '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  // RACI hook for this task
  const {
    assignments = [],
    assignRaci,
    removeRaci,
  } = useRaci(task?.id);

  // Subtasks hook for this task
  const {
    subtasks = [],
    createSubtask,
    toggleSubtask,
    deleteSubtask,
    doneCount,
    totalCount,
    progress: subtaskProgress,
  } = useSubtasks(task?.id);

  const responsible = assignments.filter((a) => a.raci_role === 'R');
  const accountable = assignments.find((a) => a.raci_role === 'A');
  const consulted = assignments.filter((a) => a.raci_role === 'C');
  const informed = assignments.filter((a) => a.raci_role === 'I');

  // Form for adding new RACI item
  const [addRaciRole, setAddRaciRole] = useState(null); // 'R' | 'C' | 'I'
  const [selectedTargetType, setSelectedTargetType] = useState('user'); // 'user' | 'dept'
  const [selectedTargetId, setSelectedTargetId] = useState('');

  // Form for adding new subtask
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState('');
  const [newSubtaskDue, setNewSubtaskDue] = useState('');
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);

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
        milestone_id: task.milestone_id || '',
        task_list_id: task.task_list_id || '',
      });
      setConfirmDelete(false);
      setAddRaciRole(null);
      setSelectedTargetId('');
      setNewSubtaskTitle('');
      setNewSubtaskAssignee('');
      setNewSubtaskDue('');
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

  // RACI Management handlers
  const handleSetAccountable = async (userId) => {
    if (!userId) {
      if (accountable) {
        await removeRaci(accountable.id);
      }
      return;
    }

    if (accountable && accountable.user_id === userId) return;

    if (accountable) {
      await removeRaci(accountable.id);
    }

    await assignRaci({
      raciRole: 'A',
      userId,
    });
  };

  const handleAddRaciAssignment = async (e) => {
    e.preventDefault();
    if (!selectedTargetId || !addRaciRole) return;

    const isUser = selectedTargetType === 'user';
    await assignRaci({
      raciRole: addRaciRole,
      userId: isUser ? selectedTargetId : null,
      departmentId: !isUser ? selectedTargetId : null,
    });

    setSelectedTargetId('');
    setAddRaciRole(null);
  };

  // Subtask creation handler
  const handleAddSubtask = async (e) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;

    setIsAddingSubtask(true);
    try {
      await createSubtask({
        title: newSubtaskTitle.trim(),
        assignee_id: newSubtaskAssignee || null,
        due_date: newSubtaskDue || null,
      });
      setNewSubtaskTitle('');
      setNewSubtaskAssignee('');
      setNewSubtaskDue('');
    } finally {
      setIsAddingSubtask(false);
    }
  };

  if (!isOpen || !task) return null;

  const isRaciComplete = responsible.length > 0 && !!accountable;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Task Details"
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.headerLabel}>Task Details</span>
            {/* Hierarchy Path Badge */}
            {(task.milestones?.name || task.task_lists?.name) ? (
              <div className={styles.hierarchyTag}>
                <Layers size={12} />
                <span>{task.milestones?.name || 'Milestone'}</span>
                <span className={styles.hierarchySep}>›</span>
                <span>{task.task_lists?.name || 'Task List'}</span>
              </div>
            ) : (
              <div className={styles.uncategorizedTag}>
                <span>Uncategorized Task</span>
              </div>
            )}
          </div>

          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close panel"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Title Input */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="task-title">
              Title
            </label>
            <input
              id="task-title"
              className={styles.titleInput}
              type="text"
              value={form.title}
              onChange={handleChange('title')}
              placeholder="Task title…"
            />
          </div>

          {/* Description Textarea */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="task-desc">
              Description
            </label>
            <textarea
              id="task-desc"
              className={styles.textarea}
              value={form.description}
              onChange={handleChange('description')}
              placeholder="Add details, notes, or acceptance criteria…"
              rows={4}
            />
          </div>

          {/* Core Properties Row */}
          <div className={styles.propertiesGrid}>
            {/* Status */}
            <div className={styles.propertyItem}>
              <label className={styles.propertyLabel} htmlFor="task-status">
                Status
              </label>
              <select
                id="task-status"
                className={styles.select}
                value={form.status_id}
                onChange={handleChange('status_id')}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div className={styles.propertyItem}>
              <label className={styles.propertyLabel} htmlFor="task-priority">
                Priority
              </label>
              <select
                id="task-priority"
                className={styles.select}
                value={form.priority}
                onChange={handleChange('priority')}
              >
                {priorityOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Due Date */}
            <div className={styles.propertyItem}>
              <label className={styles.propertyLabel} htmlFor="task-due-date">
                Due Date
              </label>
              <input
                id="task-due-date"
                type="date"
                className={styles.dateInput}
                value={form.due_date}
                onChange={handleChange('due_date')}
              />
            </div>
          </div>

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* LEVEL 5: SUBTASKS (Execution Breakdown)                      */}
          {/* ═════════════════════════════════════════════════════════════ */}
          <div className={styles.subtasksSection}>
            <div className={styles.subtasksHeader}>
              <div className={styles.subtasksTitleWrap}>
                <ListTodo size={16} className={styles.subtasksIcon} />
                <h3 className={styles.subtasksTitle}>Subtasks Breakdown</h3>
                <span className={styles.subtasksCount}>
                  {doneCount}/{totalCount} completed
                </span>
              </div>
              {totalCount > 0 && (
                <span className={styles.subtaskPercent}>{subtaskProgress}%</span>
              )}
            </div>

            {/* Subtask Progress Bar */}
            {totalCount > 0 && (
              <div className={styles.subtaskProgressBar}>
                <div
                  className={styles.subtaskProgressFill}
                  style={{ width: `${subtaskProgress}%` }}
                />
              </div>
            )}

            {/* Subtasks List */}
            <div className={styles.subtaskList}>
              {subtasks.map((st) => {
                const isDone = st.status === 'done';
                return (
                  <div
                    key={st.id}
                    className={`${styles.subtaskRow} ${isDone ? styles.subtaskDone : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.subtaskCheckBtn}
                      onClick={() => toggleSubtask(st.id, st.status)}
                      aria-label={isDone ? 'Mark uncompleted' : 'Mark completed'}
                    >
                      {isDone ? (
                        <CheckCircle2 size={16} className={styles.checkedIcon} />
                      ) : (
                        <Circle size={16} className={styles.uncheckedIcon} />
                      )}
                    </button>

                    <div className={styles.subtaskMain}>
                      <span className={styles.subtaskTitle}>{st.title}</span>
                    </div>

                    <div className={styles.subtaskMeta}>
                      {st.assignee && (
                        <Avatar
                          name={st.assignee.full_name || 'Assignee'}
                          src={st.assignee.avatar_url}
                          size="xs"
                        />
                      )}
                      {st.due_date && (
                        <span className={styles.subtaskDueDate}>
                          <Calendar size={11} />
                          {st.due_date}
                        </span>
                      )}
                      <button
                        type="button"
                        className={styles.subtaskDeleteBtn}
                        onClick={() => deleteSubtask(st.id)}
                        title="Delete subtask"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inline Add Subtask Form */}
            <form onSubmit={handleAddSubtask} className={styles.addSubtaskForm}>
              <input
                type="text"
                placeholder="Add execution subtask…"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                className={styles.subtaskInput}
              />
              <select
                value={newSubtaskAssignee}
                onChange={(e) => setNewSubtaskAssignee(e.target.value)}
                className={styles.subtaskAssigneeSelect}
              >
                <option value="">Assignee…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.user_id || ''}>
                    {getMemberDisplayName(m, user)}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newSubtaskDue}
                onChange={(e) => setNewSubtaskDue(e.target.value)}
                className={styles.subtaskDateInput}
                title="Due date"
              />
              <button
                type="submit"
                className={styles.addSubtaskBtn}
                disabled={isAddingSubtask || !newSubtaskTitle.trim()}
              >
                <Plus size={14} /> Add
              </button>
            </form>
          </div>

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* LEVEL 4: RACI GOVERNANCE MATRIX                              */}
          {/* ═════════════════════════════════════════════════════════════ */}
          <div className={styles.raciSection}>
            <div className={styles.raciHeader}>
              <div className={styles.raciTitleWrap}>
                <ShieldCheck size={16} className={styles.raciIcon} />
                <h3 className={styles.raciTitle}>RACI Responsibility Matrix</h3>
              </div>
              <span
                className={`${styles.raciStatusBadge} ${
                  isRaciComplete ? styles.raciValid : styles.raciIncomplete
                }`}
              >
                {isRaciComplete ? 'RACI Complete' : 'RACI Incomplete'}
              </span>
            </div>

            {!isRaciComplete && (
              <div className={styles.raciWarning}>
                <AlertCircle size={14} />
                <span>
                  Mandatory: At least 1 <strong>Responsible</strong> (R) and exactly 1 <strong>Accountable</strong> (A) user.
                </span>
              </div>
            )}

            {/* ── 1. ACCOUNTABLE (A) ── */}
            <div className={styles.raciBlock}>
              <div className={styles.raciBlockHeader}>
                <div className={styles.raciRoleMeta}>
                  <span className={`${styles.raciBadge} ${styles.badgeA}`}>A</span>
                  <div>
                    <strong>ACCOUNTABLE (Owner)</strong>
                    <span className={styles.raciDesc}>Who owns the final outcome? (Single User)</span>
                  </div>
                </div>
              </div>

              <div className={styles.raciContent}>
                <select
                  className={styles.accountableSelect}
                  value={accountable?.user_id || ''}
                  onChange={(e) => handleSetAccountable(e.target.value)}
                >
                  <option value="">Unassigned (Required)</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.user_id || ''}>
                      {getMemberDisplayName(m, user)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── 2. RESPONSIBLE (R) ── */}
            <div className={styles.raciBlock}>
              <div className={styles.raciBlockHeader}>
                <div className={styles.raciRoleMeta}>
                  <span className={`${styles.raciBadge} ${styles.badgeR}`}>R</span>
                  <div>
                    <strong>RESPONSIBLE (Doers)</strong>
                    <span className={styles.raciDesc}>Who executes the work? (Users or Departments)</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.addRaciBtn}
                  onClick={() => setAddRaciRole(addRaciRole === 'R' ? null : 'R')}
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              <div className={styles.raciContent}>
                {responsible.length === 0 ? (
                  <p className={styles.raciEmpty}>At least 1 Responsible user is required.</p>
                ) : (
                  <div className={styles.tagGrid}>
                    {responsible.map((item) => {
                      const pillName = item.departments?.name
                        || item.profiles?.full_name
                        || (item.user_id === user?.id ? user?.email : null)
                        || 'User';
                      return (
                        <div key={item.id} className={styles.raciItemPill}>
                          {item.department_id ? (
                            <span
                              className={styles.deptCode}
                              style={{ background: item.departments?.color || 'var(--yellow)' }}
                            >
                              {item.departments?.code || 'DEPT'}
                            </span>
                          ) : (
                            <Avatar
                              name={pillName}
                              src={item.profiles?.avatar_url}
                              size="xs"
                            />
                          )}
                          <span className={styles.itemName}>
                            {pillName}
                          </span>
                          <button
                            type="button"
                            className={styles.removeTagBtn}
                            onClick={() => removeRaci(item.id)}
                            aria-label="Remove"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── 3. CONSULTED (C) ── */}
            <div className={styles.raciBlock}>
              <div className={styles.raciBlockHeader}>
                <div className={styles.raciRoleMeta}>
                  <span className={`${styles.raciBadge} ${styles.badgeC}`}>C</span>
                  <div>
                    <strong>CONSULTED</strong>
                    <span className={styles.raciDesc}>Who provides input and review?</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.addRaciBtn}
                  onClick={() => setAddRaciRole(addRaciRole === 'C' ? null : 'C')}
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              <div className={styles.raciContent}>
                {consulted.length === 0 ? (
                  <p className={styles.raciEmptyMuted}>None assigned</p>
                ) : (
                  <div className={styles.tagGrid}>
                    {consulted.map((item) => {
                      const pillName = item.departments?.name
                        || item.profiles?.full_name
                        || (item.user_id === user?.id ? user?.email : null)
                        || 'User';
                      return (
                        <div key={item.id} className={styles.raciItemPill}>
                          {item.department_id ? (
                            <span
                              className={styles.deptCode}
                              style={{ background: item.departments?.color || 'var(--yellow)' }}
                            >
                              {item.departments?.code || 'DEPT'}
                            </span>
                          ) : (
                            <Avatar
                              name={pillName}
                              src={item.profiles?.avatar_url}
                              size="xs"
                            />
                          )}
                          <span className={styles.itemName}>
                            {pillName}
                          </span>
                          <button
                            type="button"
                            className={styles.removeTagBtn}
                            onClick={() => removeRaci(item.id)}
                            aria-label="Remove"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── 4. INFORMED (I) ── */}
            <div className={styles.raciBlock}>
              <div className={styles.raciBlockHeader}>
                <div className={styles.raciRoleMeta}>
                  <span className={`${styles.raciBadge} ${styles.badgeI}`}>I</span>
                  <div>
                    <strong>INFORMED</strong>
                    <span className={styles.raciDesc}>Who should stay updated?</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.addRaciBtn}
                  onClick={() => setAddRaciRole(addRaciRole === 'I' ? null : 'I')}
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              <div className={styles.raciContent}>
                {informed.length === 0 ? (
                  <p className={styles.raciEmptyMuted}>None assigned</p>
                ) : (
                  <div className={styles.tagGrid}>
                    {informed.map((item) => {
                      const pillName = item.departments?.name
                        || item.profiles?.full_name
                        || (item.user_id === user?.id ? user?.email : null)
                        || 'User';
                      return (
                        <div key={item.id} className={styles.raciItemPill}>
                          {item.department_id ? (
                            <span
                              className={styles.deptCode}
                              style={{ background: item.departments?.color || 'var(--yellow)' }}
                            >
                              {item.departments?.code || 'DEPT'}
                            </span>
                          ) : (
                            <Avatar
                              name={pillName}
                              src={item.profiles?.avatar_url}
                              size="xs"
                            />
                          )}
                          <span className={styles.itemName}>
                            {pillName}
                          </span>
                          <button
                            type="button"
                            className={styles.removeTagBtn}
                            onClick={() => removeRaci(item.id)}
                            aria-label="Remove"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Add RACI Popover */}
            {addRaciRole && (
              <form onSubmit={handleAddRaciAssignment} className={styles.addRaciBox}>
                <div className={styles.addRaciHeader}>
                  <span>Add to {addRaciRole === 'R' ? 'Responsible' : addRaciRole === 'C' ? 'Consulted' : 'Informed'}</span>
                  <button type="button" onClick={() => setAddRaciRole(null)} className={styles.closeAddBtn}>
                    <X size={14} />
                  </button>
                </div>

                <div className={styles.targetTypeTabs}>
                  <button
                    type="button"
                    className={`${styles.typeTab} ${selectedTargetType === 'user' ? styles.activeTypeTab : ''}`}
                    onClick={() => { setSelectedTargetType('user'); setSelectedTargetId(''); }}
                  >
                    <Users size={13} /> Member
                  </button>
                  <button
                    type="button"
                    className={`${styles.typeTab} ${selectedTargetType === 'dept' ? styles.activeTypeTab : ''}`}
                    onClick={() => { setSelectedTargetType('dept'); setSelectedTargetId(''); }}
                  >
                    <Building size={13} /> Department
                  </button>
                </div>

                <div className={styles.addRaciSelectRow}>
                  {selectedTargetType === 'user' ? (
                    <select
                      value={selectedTargetId}
                      onChange={(e) => setSelectedTargetId(e.target.value)}
                      required
                    >
                      <option value="">Select Team Member…</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.user_id || ''}>
                          {getMemberDisplayName(m, user)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={selectedTargetId}
                      onChange={(e) => setSelectedTargetId(e.target.value)}
                      required
                    >
                      <option value="">Select Department…</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="submit"
                    className={styles.addConfirmBtn}
                    disabled={!selectedTargetId}
                  >
                    Add
                  </button>
                </div>
              </form>
            )}
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
