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
  XCircle,
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
import TaskCompletionModal from './TaskCompletionModal';
import styles from './TaskDetailPanel.module.css';

function RaciAssignmentIdentity({ assignment }) {
  const profile = assignment?.profiles;
  const department = assignment?.departments;
  const displayName = profile?.full_name || department?.name || 'Unassigned';

  return (
    <>
      {profile ? (
        <Avatar
          name={displayName}
          src={profile.avatar_url}
          size="xs"
        />
      ) : department ? (
        <span
          className={styles.deptCode}
          style={{ backgroundColor: department.color || 'var(--yellow)' }}
          title={department.name}
        >
          {department.code || 'DEPT'}
        </span>
      ) : (
        <Avatar name={displayName} size="xs" />
      )}
      <span className={styles.raciItemName} title={displayName}>{displayName}</span>
      {profile && department && (
        <span
          className={styles.deptCode}
          style={{ backgroundColor: department.color || 'var(--yellow)' }}
          title={department.name}
        >
          {department.code || 'DEPT'}
        </span>
      )}
    </>
  );
}

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
  onSubtasksChange,
  readOnly = false,
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
    reopenSubtask,
    deleteSubtask,
    doneCount,
    totalCount,
    progress: subtaskProgress,
    refetch: refetchSubtasks,
  } = useSubtasks(task?.id);

  // Defined Task Action States
  const [actionLoading, setActionLoading] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [selectedSubtaskForCompletion, setSelectedSubtaskForCompletion] = useState(null);

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

  // Sync form with task when opened or when canonical task updates
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
    }
  }, [task, isOpen]);

  // Reset transient forms and subtask modals only when opening or switching tasks
  useEffect(() => {
    if (isOpen && task?.id) {
      setConfirmDelete(false);
      setAddRaciRole(null);
      setSelectedTargetId('');
      setNewSubtaskTitle('');
      setNewSubtaskAssignee('');
      setNewSubtaskDue('');
      setShowEvidenceForm(false);
      setShowConsultForm(false);
      setShowRejectForm(false);
    }
  }, [task?.id, isOpen]);

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
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = () => {
    if (readOnly) return;
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
    if (isDefinedTask || readOnly) return; // Defined Tasks and read-only viewers cannot delete
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete?.(task.id);
  };

  const isTaskDone = Boolean(
    task?.task_statuses?.system_code === 'done' ||
    task?.task_statuses?.name?.toLowerCase() === 'done' ||
    statuses.find((s) => s.id === form.status_id)?.system_code === 'done' ||
    (task?.status_id && statuses.find((s) => s.id === task.status_id)?.system_code === 'done')
  );

  const activeSubtasks = subtasks.filter((st) => st.status !== 'cancelled');
  const hasActiveSubtasks = activeSubtasks.length > 0;

  const isParentOrHostTask = Boolean(
    task?.child_task_count > 0 ||
    task?.has_children ||
    task?.is_parent ||
    task?.attached_process_count > 0 ||
    task?.attached_processes?.length > 0 ||
    task?.process_instances?.length > 0 ||
    hasActiveSubtasks ||
    task?.subtask_count > 0
  );

  const handleStatusChange = (e) => {
    const newStatusId = e.target.value;
    const selectedStatus = statuses.find((s) => s.id === newStatusId);
    const isDone = selectedStatus && (selectedStatus.system_code === 'done' || selectedStatus.name?.toLowerCase() === 'done');

    if (isDone && !isDefinedTask) {
      if (isParentOrHostTask) {
        showToast('This task completes automatically when all subtasks, child tasks and attached processes are complete.', 'info');
        return;
      }
      setShowCompletionModal(true);
      return;
    }

    setForm((prev) => ({ ...prev, status_id: newStatusId }));
  };

  const handleCompletionSuccess = async () => {
    setShowCompletionModal(false);
    await refetchSubtasks?.();
    await onSubtasksChange?.();
    if (isDefinedTask) {
      onWorkflowUpdated?.();
    } else {
      const doneStatus = statuses.find((s) => s.system_code === 'done' || s.name?.toLowerCase() === 'done');
      if (doneStatus) {
        setForm((prev) => ({ ...prev, status_id: doneStatus.id }));
      }
      onWorkflowUpdated?.();
    }
  };

  const handleSubmitEvidence = async (e) => {
    e.preventDefault();
    if (readOnly) return;
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
    if (readOnly) return;
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
    if (readOnly) return;
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
    if (readOnly) return;
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
    if (isDefinedTask || readOnly) return;
    try {
      if (!userId) {
        if (accountable) await removeRaci(accountable.id);
        return;
      }
      if (accountable && accountable.user_id === userId) return;
      if (accountable) await removeRaci(accountable.id);
      await assignRaci({ raciRole: 'A', userId });
    } catch (err) {
      showToast(err.message || 'Failed to update Accountable assignment', 'error');
      await refetchRaci();
    }
  };

  const handleAddRaciAssignment = async (e) => {
    e.preventDefault();
    if (isDefinedTask || readOnly || !selectedTargetId || !addRaciRole) return;
    const isUser = selectedTargetType === 'user';
    try {
      await assignRaci({
        raciRole: addRaciRole,
        userId: isUser ? selectedTargetId : null,
        departmentId: !isUser ? selectedTargetId : null,
      });
      setSelectedTargetId('');
      setAddRaciRole(null);
    } catch (err) {
      showToast(err.message || 'Failed to add RACI assignment', 'error');
    }
  };

  // Subtask creation handler
  const handleAddSubtask = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!newSubtaskTitle.trim()) return;
    setIsAddingSubtask(true);
    try {
      const { error } = await createSubtask({
        title: newSubtaskTitle.trim(),
        assignee_id: newSubtaskAssignee || null,
        due_date: newSubtaskDue || null,
      });
      if (error) {
        showToast(error.message || 'Failed to create subtask', 'error');
        return;
      }
      setNewSubtaskTitle('');
      setNewSubtaskAssignee('');
      setNewSubtaskDue('');
      await refetchSubtasks?.();
      await onSubtasksChange?.();
      onWorkflowUpdated?.();
    } finally {
      setIsAddingSubtask(false);
    }
  };

  const handleToggleSubtask = async (subtask) => {
    if (readOnly) return;
    if (subtask.status === 'cancelled') return;
    if (subtask.status === 'done') {
      const { error } = await reopenSubtask(subtask.id);
      if (error) {
        showToast(error.message || 'Failed to reopen subtask', 'error');
        return;
      }
      await refetchSubtasks?.();
      await onSubtasksChange?.();
      onWorkflowUpdated?.();
      return;
    }
    setSelectedSubtaskForCompletion(subtask);
  };

  const handleDeleteSubtask = async (subtaskId) => {
    if (readOnly) return;
    const { error } = await deleteSubtask(subtaskId);
    if (error) {
      if (
        error.message?.includes('foreign key') ||
        error.message?.includes('expense') ||
        error.message?.includes('RESTRICT')
      ) {
        showToast('Cannot delete subtask with existing expense transactions. Void or correct the expense first.', 'error');
      } else {
        showToast(error.message || 'Failed to delete subtask', 'error');
      }
      return;
    }
    await refetchSubtasks?.();
    await onSubtasksChange?.();
    onWorkflowUpdated?.();
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
                This step is governed by the Defined Process Engine. Workflow transitions occur automatically through participant actions.
              </div>
            </div>
          )}

          {/* Title Input */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="task-title">
              Title {(isDefinedTask || readOnly) && <Lock size={12} className={styles.lockIcon} />}
            </label>
            <input
              id="task-title"
              className={`${styles.titleInput} ${isDefinedTask || readOnly ? styles.lockedInput : ''}`}
              type="text"
              value={form.title}
              onChange={handleChange('title')}
              placeholder="Task title…"
              disabled={isDefinedTask || readOnly}
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
              disabled={readOnly}
            />
          </div>

          {/* Core Properties Row */}
          <div className={styles.propertiesGrid}>
            {/* Status */}
            <div className={styles.propertyItem}>
              <label className={styles.propertyLabel} htmlFor="task-status">
                Status {(isDefinedTask || readOnly) && <Lock size={11} className={styles.lockIcon} />}
              </label>
              <select
                id="task-status"
                className={`${styles.select} ${isDefinedTask || readOnly ? styles.lockedInput : ''}`}
                value={form.status_id}
                onChange={handleStatusChange}
                disabled={isDefinedTask || readOnly}
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
              {!isTaskDone && !readOnly && !isDefinedTask && (
                <button
                  type="button"
                  className={styles.execActionBtn}
                  style={{ marginTop: '8px', width: 'fit-content' }}
                  onClick={() => {
                    if (isParentOrHostTask) {
                      showToast('This task completes automatically when all subtasks, child tasks and attached processes are complete.', 'info');
                      return;
                    }
                    setShowCompletionModal(true);
                  }}
                >
                  <CheckCircle2 size={13} /> Complete Task
                </button>
              )}
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
                disabled={readOnly}
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
                Due Date {(isDefinedTask || readOnly) && <Lock size={11} className={styles.lockIcon} />}
              </label>
              <input
                id="task-due-date"
                type="date"
                className={`${styles.dateInput} ${isDefinedTask || readOnly ? styles.lockedInput : ''}`}
                value={form.due_date}
                onChange={handleChange('due_date')}
                disabled={isDefinedTask || readOnly}
              />
            </div>
          </div>

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* DEFINED PROCESS EXECUTION SECTION (When task is Defined)     */}
          {/* ═════════════════════════════════════════════════════════════ */}
          {isDefinedTask && !readOnly && (
            <div className={styles.executionSection}>
              <div className={styles.execHeader}>
                <Sparkles size={16} className={styles.execIcon} />
                <h3>Process Execution Actions</h3>
              </div>

              {/* Responsible Completion Action */}
              {isActionableState && userIsResponsible && (
                <div className={styles.execBox}>
                  <div className={styles.execBoxTop}>
                    <span className={styles.execBoxTitle}>Complete My Assigned Work</span>
                    <button
                      type="button"
                      className={styles.execActionBtn}
                      onClick={() => setShowCompletionModal(true)}
                    >
                      <CheckCircle2 size={14} /> Complete My Part
                    </button>
                  </div>
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
                    <span className={styles.execBoxTitle}>Owner Decision</span>
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
                const isCancelled = st.status === 'cancelled';
                return (
                  <div
                    key={st.id}
                    className={`${styles.subtaskRow} ${isDone ? styles.subtaskDone : ''} ${isCancelled ? styles.subtaskCancelled : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.subtaskCheckBtn}
                      onClick={() => handleToggleSubtask(st)}
                      aria-label={
                        isCancelled
                          ? 'Cancelled subtask'
                          : isDone
                            ? 'Mark uncompleted'
                            : 'Mark completed'
                      }
                      disabled={readOnly || isCancelled}
                    >
                      {isCancelled ? (
                        <XCircle size={16} className={styles.cancelledIcon} />
                      ) : isDone ? (
                        <CheckCircle2 size={16} className={styles.checkedIcon} />
                      ) : (
                        <Circle size={16} className={styles.uncheckedIcon} />
                      )}
                    </button>

                    <div className={styles.subtaskMain}>
                      <span className={styles.subtaskTitle}>{st.title}</span>
                      <span className={`${styles.subtaskState} ${styles[`subtaskState_${st.status}`]}`}>
                        {st.status === 'in_progress'
                          ? 'In progress'
                          : st.status === 'done'
                            ? 'Done'
                            : st.status === 'cancelled'
                              ? 'Cancelled'
                              : 'To do'}
                      </span>
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
                      {!readOnly && (
                        <button
                          type="button"
                          className={styles.subtaskDeleteBtn}
                          onClick={() => handleDeleteSubtask(st.id)}
                          title="Delete subtask"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inline Add Subtask Form */}
            {!readOnly && <form onSubmit={handleAddSubtask} className={styles.addSubtaskForm}>
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
            </form>}
          </div>

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* RACI GOVERNANCE SECTION                                      */}
          {/* ═════════════════════════════════════════════════════════════ */}
          <div className={styles.raciSection}>
            <div className={styles.raciHeader}>
              <div className={styles.raciTitleWrap}>
                <ShieldCheck size={16} className={styles.raciIcon} />
                <h3 className={styles.raciTitle}>Ownership & Assignments</h3>
              </div>
              {!isRaciComplete && (
                <span className={styles.raciWarning}>
                  <AlertCircle size={12} /> Requires 1 Owner & at least 1 Assignee
                </span>
              )}
            </div>

            {/* Accountable (A) Row */}
            <div className={styles.raciRoleBlock}>
              <div className={styles.raciRoleHeader}>
                <div className={styles.raciRoleLabelWrap}>
                  <span className={`${styles.raciPill} ${styles.pillA}`}>A</span>
                  <span className={styles.raciRoleName}>Owner</span>
                </div>
              </div>

              <div className={styles.raciAccountableSelectWrap}>
                {isDefinedTask || readOnly ? (
                  <div className={styles.lockedRaciChip}>
                    <Avatar
                      name={accountable?.profiles?.full_name || 'Unassigned'}
                      src={accountable?.profiles?.avatar_url}
                      size="xs"
                    />
                    <span>{accountable?.profiles?.full_name || 'Defined Owner'}</span>
                  </div>
                ) : (
                  <select
                    className={styles.accountableSelect}
                    value={accountable?.user_id || ''}
                    onChange={(e) => handleSetAccountable(e.target.value)}
                  >
                    <option value="">Select Owner…</option>
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
                  <span className={styles.raciRoleName}>Assignees</span>
                </div>
                {!isDefinedTask && !readOnly && (
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
                  <span className={styles.raciEmpty}>No Assignees assigned.</span>
                ) : (
                  responsible.map((r) => (
                    <div key={r.id} className={styles.raciItemTag}>
                      <RaciAssignmentIdentity assignment={r} />
                      {!isDefinedTask && !readOnly && (
                        <button
                          type="button"
                          onClick={() => removeRaci(r.id)}
                          className={styles.removeRaciBtn}
                          aria-label={`Remove ${r.profiles?.full_name || r.departments?.name || 'Assignee'}`}
                          title="Remove assignment"
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
                {!isDefinedTask && !readOnly && (
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
                      <RaciAssignmentIdentity assignment={c} />
                      {c.response_required && <span className={styles.reqBadge}>Required</span>}
                      {!isDefinedTask && !readOnly && (
                        <button
                          type="button"
                          onClick={() => removeRaci(c.id)}
                          className={styles.removeRaciBtn}
                          aria-label={`Remove ${c.profiles?.full_name || c.departments?.name || 'Consulted assignment'}`}
                          title="Remove assignment"
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
                {!isDefinedTask && !readOnly && (
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
                      <RaciAssignmentIdentity assignment={i} />
                      {!isDefinedTask && !readOnly && (
                        <button
                          type="button"
                          onClick={() => removeRaci(i.id)}
                          className={styles.removeRaciBtn}
                          aria-label={`Remove ${i.profiles?.full_name || i.departments?.name || 'Informed assignment'}`}
                          title="Remove assignment"
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
            {!isDefinedTask && !readOnly && addRaciRole && (
              <form onSubmit={handleAddRaciAssignment} className={styles.addRaciForm}>
                <div className={styles.addRaciHeader}>
                  <span>Add to {addRaciRole === 'R' ? 'Assignees' : addRaciRole === 'C' ? 'Consulted' : 'Informed'}</span>
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
            {!isDefinedTask && !readOnly && onDelete && (
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
            {!readOnly && (
              <button
                className={styles.saveBtn}
                onClick={handleSave}
                type="button"
              >
                Save Changes
              </button>
            )}
          </div>
        </div>
      </div>

      {showCompletionModal && (
        <TaskCompletionModal
          isOpen={showCompletionModal}
          onClose={() => setShowCompletionModal(false)}
          task={task}
          isDefinedTask={isDefinedTask}
          onSuccess={handleCompletionSuccess}
          readOnly={readOnly}
        />
      )}

      {selectedSubtaskForCompletion && (
        <TaskCompletionModal
          isOpen={!!selectedSubtaskForCompletion}
          subtask={selectedSubtaskForCompletion}
          parentTaskTitle={task.title}
          entityKind="subtask"
          onClose={() => setSelectedSubtaskForCompletion(null)}
          onSuccess={async () => {
            setSelectedSubtaskForCompletion(null);
            await refetchSubtasks?.();
            await onSubtasksChange?.();
            onWorkflowUpdated?.();
          }}
          readOnly={readOnly}
        />
      )}
    </div>,
    document.body
  );
}
