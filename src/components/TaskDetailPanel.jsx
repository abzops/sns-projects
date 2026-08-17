import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Trash2,
  Plus,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Users,
  Building,
  CheckCircle2,
  Circle,
  Calendar,
  Layers,
  ListTodo,
  Workflow,
  Lock,
  FileText,
  MessageSquare,
  Sparkles,
  Clock,
} from 'lucide-react';
import Avatar from './Avatar';
import { useAuth } from '../contexts/AuthContext';
import { useRaci } from '../hooks/useRaci';
import { useSubtasks } from '../hooks/useSubtasks';
import { getMemberDisplayName } from '../lib/identity';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
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
  onWorkflowUpdated,
}) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const isDefinedTask = !!task?.process_step_id;

  const [form, setForm] = useState({
    title: '',
    description: '',
    status_id: '',
    priority: 'none',
    assignee_id: '',
    due_date: '',
    phase_id: '',
    task_list_id: '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  // RACI hook for this task
  const {
    assignments = [],
    assignRaci,
    removeRaci,
    refetch: refetchRaci,
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

  // Defined Task Action States
  const [actionLoading, setActionLoading] = useState(false);
  const [completionNote, setCompletionNote] = useState('');
  const [showCompleteForm, setShowCompleteForm] = useState(false);

  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [evidenceType, setEvidenceType] = useState('text');
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceLink, setEvidenceLink] = useState('');

  const [showConsultForm, setShowConsultForm] = useState(false);
  const [consultText, setConsultText] = useState('');

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectDueDate, setRejectDueDate] = useState('');

  // Use task RACI or fetched assignments
  const activeRaci = isDefinedTask && task.raci ? task.raci : assignments;
  const responsible = activeRaci.filter((a) => a.raci_role === 'R');
  const accountable = activeRaci.find((a) => a.raci_role === 'A');
  const consulted = activeRaci.filter((a) => a.raci_role === 'C');
  const informed = activeRaci.filter((a) => a.raci_role === 'I');

  const userIsResponsible = responsible.some((r) => r.user_id === user?.id);
  const userIsAccountable = accountable?.user_id === user?.id;
  const userIsConsulted = consulted.some((r) => r.user_id === user?.id);

  // Form for adding new RACI item (Custom Tasks only)
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
        phase_id: task.phase_id || '',
        task_list_id: task.task_list_id || '',
      });
      setConfirmDelete(false);
      setAddRaciRole(null);
      setSelectedTargetId('');
      setNewSubtaskTitle('');
      setNewSubtaskAssignee('');
      setNewSubtaskDue('');
      setShowCompleteForm(false);
      setShowEvidenceForm(false);
      setShowConsultForm(false);
      setShowRejectForm(false);
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
    if (isDefinedTask) {
      // For Defined Tasks, preserve title, status_id, and due_date from original task
      onSave?.({
        ...task,
        description: form.description,
        priority: form.priority,
      });
    } else {
      onSave?.({ ...task, ...form });
    }
  };

  const handleDelete = () => {
    if (isDefinedTask) return; // Defined Tasks cannot be deleted
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete?.(task.id);
    onClose?.();
  };

  // Defined Task RPC Handlers
  const handleCompleteMyPart = async () => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('complete_responsible_part', {
        p_task_id: task.id,
        p_note: completionNote.trim() || null,
      });
      if (error) throw error;

      showToast(
        data?.completed
          ? 'Step completed!'
          : `Contribution saved (${data?.remaining_responsible} Responsible remaining).`,
        'success'
      );
      setShowCompleteForm(false);
      setCompletionNote('');
      onWorkflowUpdated?.();
    } catch (err) {
      showToast(err.message || 'Failed to complete part.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitEvidence = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const payload =
        evidenceType === 'link'
          ? { url: evidenceLink.trim(), added_by: user?.email }
          : { text: evidenceText.trim(), added_by: user?.email };

      const { data, error } = await supabase.rpc('submit_task_evidence', {
        p_task_id: task.id,
        p_evidence_def_id: null,
        p_evidence_type: evidenceType,
        p_payload: payload,
      });
      if (error) throw error;

      showToast('Evidence recorded successfully!', 'success');
      setShowEvidenceForm(false);
      setEvidenceText('');
      setEvidenceLink('');
      onWorkflowUpdated?.();
    } catch (err) {
      showToast(err.message || 'Failed to submit evidence.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitConsultation = async (e) => {
    e.preventDefault();
    if (!consultText.trim()) return;
    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('submit_task_consultation', {
        p_task_id: task.id,
        p_response: consultText.trim(),
      });
      if (error) throw error;

      showToast('Consultation feedback submitted!', 'success');
      setShowConsultForm(false);
      setConsultText('');
      onWorkflowUpdated?.();
    } catch (err) {
      showToast(err.message || 'Failed to submit consultation.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('approve_process_task', {
        p_task_id: task.id,
      });
      if (error) throw error;

      showToast('Step approved and completed!', 'success');
      onWorkflowUpdated?.();
    } catch (err) {
      showToast(err.message || 'Failed to approve task.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectReason.trim() || !rejectDueDate) {
      showToast('Rejection reason and target due date are required.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('reject_process_task', {
        p_task_id: task.id,
        p_reason: rejectReason.trim(),
        p_new_due_date: rejectDueDate,
      });
      if (error) throw error;

      showToast(`Rework requested (Cycle ${data?.new_cycle_number || 2}).`, 'success');
      setShowRejectForm(false);
      setRejectReason('');
      setRejectDueDate('');
      onWorkflowUpdated?.();
    } catch (err) {
      showToast(err.message || 'Failed to reject task.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Custom RACI Handlers
  const handleSetAccountable = async (userId) => {
    if (isDefinedTask) return;
    if (!userId) {
      if (accountable) await removeRaci(accountable.id);
      return;
    }
    if (accountable && accountable.user_id === userId) return;
    if (accountable) await removeRaci(accountable.id);
    await assignRaci({ raciRole: 'A', userId });
  };

  const handleAddRaciAssignment = async (e) => {
    e.preventDefault();
    if (isDefinedTask || !selectedTargetId || !addRaciRole) return;
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
  const isActionableState = ['ready', 'active', 'rework_required'].includes(task.workflow_state);

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
            <span className={styles.headerLabel}>
              {isDefinedTask ? 'Defined Process Task' : 'Task Details'}
            </span>
            {isDefinedTask ? (
              <div className={styles.definedTaskBadge}>
                <Workflow size={12} />
                <span>Defined Workflow Step</span>
              </div>
            ) : task.phases?.name || task.task_lists?.name ? (
              <div className={styles.hierarchyTag}>
                <Layers size={12} />
                <span>{task.phases?.name || 'Phase'}</span>
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
          {/* DEFINED PROCESS GOVERNANCE BANNER */}
          {isDefinedTask && (
            <div className={styles.definedBanner}>
              <div className={styles.definedBannerHeader}>
                <div className={styles.definedStatePill}>
                  <Clock size={13} />
                  <span>State: <strong>{task.workflow_state || 'waiting'}</strong></span>
                </div>
                {task.current_cycle_number > 1 && (
                  <span className={styles.cycleIndicator}>
                    Cycle {task.current_cycle_number}
                  </span>
                )}
              </div>
              <div className={styles.definedBannerNote}>
                This step is governed by the Defined Process Engine. Workflow transitions occur automatically via RACI actions.
              </div>
            </div>
          )}

          {/* Title Input */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="task-title">
              Title {isDefinedTask && <Lock size={12} className={styles.lockIcon} />}
            </label>
            <input
              id="task-title"
              className={`${styles.titleInput} ${isDefinedTask ? styles.lockedInput : ''}`}
              type="text"
              value={form.title}
              onChange={handleChange('title')}
              placeholder="Task title…"
              disabled={isDefinedTask}
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
              rows={3}
            />
          </div>

          {/* Core Properties Row */}
          <div className={styles.propertiesGrid}>
            {/* Status */}
            <div className={styles.propertyItem}>
              <label className={styles.propertyLabel} htmlFor="task-status">
                Status {isDefinedTask && <Lock size={11} className={styles.lockIcon} />}
              </label>
              <select
                id="task-status"
                className={`${styles.select} ${isDefinedTask ? styles.lockedInput : ''}`}
                value={form.status_id}
                onChange={handleChange('status_id')}
                disabled={isDefinedTask}
              >
                {statuses.length > 0 ? (
                  statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                ) : (
                  <option value="">{task.task_statuses?.name || 'In Progress'}</option>
                )}
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
                Due Date {isDefinedTask && <Lock size={11} className={styles.lockIcon} />}
              </label>
              <input
                id="task-due-date"
                type="date"
                className={`${styles.dateInput} ${isDefinedTask ? styles.lockedInput : ''}`}
                value={form.due_date}
                onChange={handleChange('due_date')}
                disabled={isDefinedTask}
              />
            </div>
          </div>

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* DEFINED PROCESS EXECUTION SECTION (When task is Defined)     */}
          {/* ═════════════════════════════════════════════════════════════ */}
          {isDefinedTask && (
            <div className={styles.executionSection}>
              <div className={styles.execHeader}>
                <Sparkles size={16} className={styles.execIcon} />
                <h3>Process Execution Actions</h3>
              </div>

              {/* Responsible Completion Action */}
              {isActionableState && userIsResponsible && (
                <div className={styles.execBox}>
                  <div className={styles.execBoxTop}>
                    <span className={styles.execBoxTitle}>Responsible Contribution</span>
                    <button
                      type="button"
                      className={styles.execActionBtn}
                      onClick={() => setShowCompleteForm(!showCompleteForm)}
                    >
                      <CheckCircle2 size={14} /> Complete My Part
                    </button>
                  </div>
                  {showCompleteForm && (
                    <div className={styles.inlineForm}>
                      <textarea
                        className={styles.execTextarea}
                        rows={2}
                        placeholder="Optional completion note..."
                        value={completionNote}
                        onChange={(e) => setCompletionNote(e.target.value)}
                      />
                      <button
                        type="button"
                        className={styles.execSubmitBtn}
                        onClick={handleCompleteMyPart}
                        disabled={actionLoading}
                      >
                        {actionLoading ? 'Recording...' : 'Confirm My Part Complete'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Evidence Submission Action */}
              {userIsResponsible && (
                <div className={styles.execBox}>
                  <div className={styles.execBoxTop}>
                    <span className={styles.execBoxTitle}>Evidence & Deliverables</span>
                    <button
                      type="button"
                      className={styles.execActionBtnSec}
                      onClick={() => setShowEvidenceForm(!showEvidenceForm)}
                    >
                      <FileText size={14} /> Add Evidence
                    </button>
                  </div>
                  {showEvidenceForm && (
                    <form onSubmit={handleSubmitEvidence} className={styles.inlineForm}>
                      <div className={styles.typeSelectorRow}>
                        <label>
                          <input
                            type="radio"
                            name="evType"
                            checked={evidenceType === 'text'}
                            onChange={() => setEvidenceType('text')}
                          />{' '}
                          Text Note
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="evType"
                            checked={evidenceType === 'link'}
                            onChange={() => setEvidenceType('link')}
                          />{' '}
                          Document URL
                        </label>
                      </div>
                      {evidenceType === 'link' ? (
                        <input
                          type="url"
                          className={styles.execInput}
                          placeholder="https://..."
                          value={evidenceLink}
                          onChange={(e) => setEvidenceLink(e.target.value)}
                          required
                        />
                      ) : (
                        <textarea
                          className={styles.execTextarea}
                          rows={2}
                          placeholder="Evidence description or deliverable notes..."
                          value={evidenceText}
                          onChange={(e) => setEvidenceText(e.target.value)}
                          required
                        />
                      )}
                      <button
                        type="submit"
                        className={styles.execSubmitBtn}
                        disabled={actionLoading}
                      >
                        {actionLoading ? 'Saving...' : 'Submit Evidence'}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Consultation Response Action */}
              {task.workflow_state === 'awaiting_consultation' && userIsConsulted && (
                <div className={styles.execBox}>
                  <div className={styles.execBoxTop}>
                    <span className={styles.execBoxTitle}>Consultation Feedback</span>
                    <button
                      type="button"
                      className={styles.execActionBtn}
                      onClick={() => setShowConsultForm(!showConsultForm)}
                    >
                      <MessageSquare size={14} /> Submit Feedback
                    </button>
                  </div>
                  {showConsultForm && (
                    <form onSubmit={handleSubmitConsultation} className={styles.inlineForm}>
                      <textarea
                        className={styles.execTextarea}
                        rows={3}
                        placeholder="Provide technical feedback or sign-off..."
                        value={consultText}
                        onChange={(e) => setConsultText(e.target.value)}
                        required
                      />
                      <button
                        type="submit"
                        className={styles.execSubmitBtn}
                        disabled={actionLoading || !consultText.trim()}
                      >
                        {actionLoading ? 'Submitting...' : 'Record Consultation Feedback'}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Accountable Approval Action */}
              {task.workflow_state === 'awaiting_approval' && userIsAccountable && (
                <div className={styles.execBox}>
                  <div className={styles.execBoxTop}>
                    <span className={styles.execBoxTitle}>Accountable Decision</span>
                    <div className={styles.btnRow}>
                      <button
                        type="button"
                        className={styles.approveBtn}
                        onClick={handleApprove}
                        disabled={actionLoading}
                      >
                        <ShieldCheck size={14} /> Approve Step
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => setShowRejectForm(!showRejectForm)}
                      >
                        <ShieldAlert size={14} /> Request Rework
                      </button>
                    </div>
                  </div>
                  {showRejectForm && (
                    <form onSubmit={handleRejectSubmit} className={styles.inlineForm}>
                      <textarea
                        className={styles.execTextarea}
                        rows={3}
                        placeholder="State reason for rework..."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        required
                      />
                      <input
                        type="date"
                        className={styles.execInput}
                        value={rejectDueDate}
                        onChange={(e) => setRejectDueDate(e.target.value)}
                        required
                      />
                      <button
                        type="submit"
                        className={styles.rejectSubmitBtn}
                        disabled={actionLoading || !rejectReason.trim() || !rejectDueDate}
                      >
                        {actionLoading ? 'Processing...' : 'Confirm Request Rework'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

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
          {/* RACI GOVERNANCE SECTION                                      */}
          {/* ═════════════════════════════════════════════════════════════ */}
          <div className={styles.raciSection}>
            <div className={styles.raciHeader}>
              <div className={styles.raciTitleWrap}>
                <ShieldCheck size={16} className={styles.raciIcon} />
                <h3 className={styles.raciTitle}>RACI Responsibility Matrix</h3>
              </div>
              {!isRaciComplete && (
                <span className={styles.raciWarning}>
                  <AlertCircle size={12} /> Requires 1 Accountable & ≥1 Responsible
                </span>
              )}
            </div>

            {/* Accountable (A) Row */}
            <div className={styles.raciRoleBlock}>
              <div className={styles.raciRoleHeader}>
                <div className={styles.raciRoleLabelWrap}>
                  <span className={`${styles.raciPill} ${styles.pillA}`}>A</span>
                  <span className={styles.raciRoleName}>Accountable (Single Owner)</span>
                </div>
              </div>

              <div className={styles.raciAccountableSelectWrap}>
                {isDefinedTask ? (
                  <div className={styles.lockedRaciChip}>
                    <Avatar
                      name={accountable?.profiles?.full_name || 'Unassigned'}
                      src={accountable?.profiles?.avatar_url}
                      size="xs"
                    />
                    <span>{accountable?.profiles?.full_name || 'Defined Accountable'}</span>
                  </div>
                ) : (
                  <select
                    className={styles.accountableSelect}
                    value={accountable?.user_id || ''}
                    onChange={(e) => handleSetAccountable(e.target.value)}
                  >
                    <option value="">Select Accountable owner…</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.user_id || ''}>
                        {getMemberDisplayName(m, user)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Responsible (R) Block */}
            <div className={styles.raciRoleBlock}>
              <div className={styles.raciRoleHeader}>
                <div className={styles.raciRoleLabelWrap}>
                  <span className={`${styles.raciPill} ${styles.pillR}`}>R</span>
                  <span className={styles.raciRoleName}>Responsible (Doers)</span>
                </div>
                {!isDefinedTask && (
                  <button
                    type="button"
                    className={styles.addRaciBtn}
                    onClick={() => { setAddRaciRole('R'); setSelectedTargetId(''); }}
                  >
                    <Plus size={12} /> Add
                  </button>
                )}
              </div>

              <div className={styles.raciItemsList}>
                {responsible.length === 0 ? (
                  <span className={styles.raciEmpty}>No Responsible users assigned.</span>
                ) : (
                  responsible.map((r) => (
                    <div key={r.id} className={styles.raciItemTag}>
                      <Avatar
                        name={r.profiles?.full_name || 'User'}
                        src={r.profiles?.avatar_url}
                        size="xs"
                      />
                      <span>{r.profiles?.full_name || r.departments?.name}</span>
                      {!isDefinedTask && (
                        <button
                          type="button"
                          onClick={() => removeRaci(r.id)}
                          className={styles.removeRaciBtn}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Consulted (C) Block */}
            <div className={styles.raciRoleBlock}>
              <div className={styles.raciRoleHeader}>
                <div className={styles.raciRoleLabelWrap}>
                  <span className={`${styles.raciPill} ${styles.pillC}`}>C</span>
                  <span className={styles.raciRoleName}>Consulted (Advisors)</span>
                </div>
                {!isDefinedTask && (
                  <button
                    type="button"
                    className={styles.addRaciBtn}
                    onClick={() => { setAddRaciRole('C'); setSelectedTargetId(''); }}
                  >
                    <Plus size={12} /> Add
                  </button>
                )}
              </div>

              <div className={styles.raciItemsList}>
                {consulted.length === 0 ? (
                  <span className={styles.raciEmpty}>No Consulted advisors assigned.</span>
                ) : (
                  consulted.map((c) => (
                    <div key={c.id} className={styles.raciItemTag}>
                      <Avatar
                        name={c.profiles?.full_name || 'User'}
                        src={c.profiles?.avatar_url}
                        size="xs"
                      />
                      <span>{c.profiles?.full_name || c.departments?.name}</span>
                      {c.response_required && <span className={styles.reqBadge}>Required</span>}
                      {!isDefinedTask && (
                        <button
                          type="button"
                          onClick={() => removeRaci(c.id)}
                          className={styles.removeRaciBtn}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Informed (I) Block */}
            <div className={styles.raciRoleBlock}>
              <div className={styles.raciRoleHeader}>
                <div className={styles.raciRoleLabelWrap}>
                  <span className={`${styles.raciPill} ${styles.pillI}`}>I</span>
                  <span className={styles.raciRoleName}>Informed (Notified)</span>
                </div>
                {!isDefinedTask && (
                  <button
                    type="button"
                    className={styles.addRaciBtn}
                    onClick={() => { setAddRaciRole('I'); setSelectedTargetId(''); }}
                  >
                    <Plus size={12} /> Add
                  </button>
                )}
              </div>

              <div className={styles.raciItemsList}>
                {informed.length === 0 ? (
                  <span className={styles.raciEmpty}>No Informed participants assigned.</span>
                ) : (
                  informed.map((i) => (
                    <div key={i.id} className={styles.raciItemTag}>
                      <Avatar
                        name={i.profiles?.full_name || 'User'}
                        src={i.profiles?.avatar_url}
                        size="xs"
                      />
                      <span>{i.profiles?.full_name || i.departments?.name}</span>
                      {!isDefinedTask && (
                        <button
                          type="button"
                          onClick={() => removeRaci(i.id)}
                          className={styles.removeRaciBtn}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add RACI Inline Form (Custom Tasks only) */}
            {!isDefinedTask && addRaciRole && (
              <form onSubmit={handleAddRaciAssignment} className={styles.addRaciForm}>
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
            {!isDefinedTask && onDelete && (
              <button
                className={`${styles.deleteBtn} ${confirmDelete ? styles.deleteConfirm : ''}`}
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
              Close
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
