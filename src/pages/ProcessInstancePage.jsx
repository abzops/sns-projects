import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Workflow,
  CheckCircle2,
  Lock,
  Play,
  Clock,
  Calendar,
  AlertCircle,
  FileText,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  ArrowLeft,
  User,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import TaskDetailPanel from '../components/TaskDetailPanel';
import TaskCompletionModal from '../components/TaskCompletionModal';
import Avatar from '../components/Avatar';
import { CardGridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useProcessInstance } from '../hooks/useProcessInstance';
import { useAuth } from '../contexts/AuthContext';
import { useUserContext } from '../hooks/useUserContext';
import { useToast } from '../components/Toast';
import { getRaciRoleLabel } from '../utils/raciPresentation';
import styles from './ProcessInstancePage.module.css';

function formatDate(d) {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getWorkflowStateBadge(state) {
  switch (state) {
    case 'waiting':
      return { label: 'Waiting', className: styles.stateWaiting, icon: Lock };
    case 'ready':
      return { label: 'Ready', className: styles.stateReady, icon: Play };
    case 'active':
      return { label: 'Active', className: styles.stateActive, icon: Clock };
    case 'awaiting_consultation':
      return { label: 'Awaiting Consultation', className: styles.stateConsult, icon: MessageSquare };
    case 'awaiting_approval':
      return { label: 'Awaiting Approval', className: styles.stateApproval, icon: ShieldCheck };
    case 'rework_required':
      return { label: 'Rework Required', className: styles.stateRework, icon: AlertCircle };
    case 'completed':
      return { label: 'Completed', className: styles.stateCompleted, icon: CheckCircle2 };
    case 'cancelled':
      return { label: 'Cancelled', className: styles.stateCancelled, icon: AlertCircle };
    default:
      return { label: state || 'Pending', className: styles.stateWaiting, icon: Clock };
  }
}

export default function ProcessInstancePage() {
  const { workspaceId, taskListId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isReadOnly, authorizationScopeKey } = useUserContext(workspaceId);
  const { showToast } = useToast();

  const {
    instance,
    tasks = [],
    loading,
    refreshing,
    error,
    completeResponsiblePart,
    submitEvidence,
    submitConsultation,
    approveTask,
    rejectTask,
  } = useProcessInstance(taskListId, authorizationScopeKey);

  // Selected task for detail panel
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  // Quick Action Modal states
  const [evidenceModalTask, setEvidenceModalTask] = useState(null);
  const [evidenceType, setEvidenceType] = useState('text');
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceLink, setEvidenceLink] = useState('');

  const [consultModalTask, setConsultModalTask] = useState(null);
  const [consultText, setConsultText] = useState('');

  const [rejectModalTask, setRejectModalTask] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectDueDate, setRejectDueDate] = useState('');

  const [completionModalTask, setCompletionModalTask] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;

  // Handler: Complete My Part
  const handleCompletePart = async (task, note = null) => {
    if (isReadOnly) return;
    setActionLoading(true);
    try {
      const res = await completeResponsiblePart(task.id, note);
      if (res.success) {
        const stepStatus = res.data?.status || res.data?.step_result?.status;
        const remainingResp = res.data?.step_result?.remaining_responsible;

        if (remainingResp && remainingResp > 0) {
          showToast(
            `Your contribution was recorded. (${remainingResp} Assignee${remainingResp > 1 ? 's' : ''} remaining)`,
            'success'
          );
        } else if (stepStatus === 'in_review' || stepStatus === 'awaiting_approval') {
          showToast(`Step "${task.title}" submitted for review.`, 'success');
        } else if (stepStatus === 'awaiting_consultation') {
          showToast(`Step "${task.title}" submitted for consultation.`, 'success');
        } else if (stepStatus === 'completed' || res.data?.success) {
          showToast(`Step "${task.title}" completed!`, 'success');
        } else {
          showToast(`Step advanced to ${stepStatus || 'next state'}!`, 'success');
        }
      } else {
        showToast(res.error || 'Failed to complete part.', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Add Evidence Submit
  const handleEvidenceSubmit = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (!evidenceModalTask) return;

    setActionLoading(true);
    try {
      const payload =
        evidenceType === 'link'
          ? { url: evidenceLink.trim(), added_by: user?.email }
          : { text: evidenceText.trim(), added_by: user?.email };

      const res = await submitEvidence(evidenceModalTask.id, null, evidenceType, payload);
      if (res.success) {
        showToast('Evidence submitted successfully!', 'success');
        setEvidenceModalTask(null);
        setEvidenceText('');
        setEvidenceLink('');
      } else {
        showToast(res.error || 'Failed to submit evidence.', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Consultation Submit
  const handleConsultSubmit = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (!consultModalTask || !consultText.trim()) return;

    setActionLoading(true);
    try {
      const res = await submitConsultation(consultModalTask.id, consultText.trim());
      if (res.success) {
        showToast('Consultation feedback recorded!', 'success');
        setConsultModalTask(null);
        setConsultText('');
      } else {
        showToast(res.error || 'Failed to submit consultation.', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Approve Task
  const handleApprove = async (task) => {
    if (isReadOnly) return;
    setActionLoading(true);
    try {
      const res = await approveTask(task.id);
      if (res.success) {
        showToast(`Step "${task.title}" approved and completed!`, 'success');
      } else {
        showToast(res.error || 'Failed to approve task.', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Reject Task Submit
  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (!rejectModalTask || !rejectReason.trim() || !rejectDueDate) {
      showToast('Rejection reason and new due date are required.', 'error');
      return;
    }

    setActionLoading(true);
    try {
      const res = await rejectTask(rejectModalTask.id, rejectReason.trim(), rejectDueDate);
      if (res.success) {
        showToast(`Rework requested for cycle ${res.data?.new_cycle_number || 2}.`, 'success');
        setRejectModalTask(null);
        setRejectReason('');
        setRejectDueDate('');
      } else {
        showToast(res.error || 'Failed to request rework.', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !instance) {
    return (
      <div className={styles.page}>
        <CardGridSkeleton count={3} />
      </div>
    );
  }

  if (error || !instance) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={AlertCircle}
          title="Process Instance Not Found"
          description="The requested process instance is unavailable or you do not have access."
          actionLabel="Back to Projects"
          onAction={() => navigate(`/workspace/${workspaceId}/projects`)}
        />
      </div>
    );
  }

  const isCompleted = instance.process_state === 'completed';
  const startedByName = instance.profiles?.full_name || 'System';

  return (
    <div className={styles.page}>
      {/* Top Breadcrumb Header */}
      <div className={styles.breadcrumbBar}>
        <Link
          to={`/workspace/${workspaceId}/project/${instance.project_id}`}
          className={styles.backLink}
        >
          <ArrowLeft size={16} /> Back to Project Tasks
        </Link>
        <div className={styles.breadcrumbPath}>
          <span>{instance.projects?.name}</span>
          <ChevronRight size={14} />
          <span>{instance.phases?.name}</span>
          <ChevronRight size={14} />
          <span className={styles.activeBreadcrumb}>{instance.name}</span>
        </div>
      </div>

      {/* Instance Summary Header Card */}
      <div className={styles.instanceHero}>
        <div className={styles.heroMain}>
          <div className={styles.heroBadgeRow}>
            <span className={styles.procCodeBadge}>
              <Workflow size={13} /> {instance.defined_processes?.code}
            </span>
            <span className={styles.versionPill}>
              v{instance.defined_process_versions?.version_number}
            </span>
            <span
              className={`${styles.procStateBadge} ${
                isCompleted ? styles.procStateCompleted : styles.procStateActive
              }`}
            >
              {isCompleted ? 'Process Completed' : 'Active Execution'}
            </span>
          </div>

          <h1 className={styles.instanceTitle}>{instance.name}</h1>
          <p className={styles.procSubText}>
            Template: <strong>{instance.defined_processes?.name}</strong> •{' '}
            {instance.defined_processes?.description}
          </p>
        </div>

        <div className={styles.heroMeta}>
          <div className={styles.metaStat}>
            <span className={styles.metaStatLabel}>Progress</span>
            <span className={styles.metaStatValue}>
              {instance.completed_tasks} / {instance.total_tasks} Steps ({instance.progress_percent}%)
            </span>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${instance.progress_percent}%` }}
              />
            </div>
          </div>

          <div className={styles.metaMetaDetails}>
            <div className={styles.metaDetailItem}>
              <User size={13} />
              <span>Started by: <strong>{startedByName}</strong></span>
            </div>
            <div className={styles.metaDetailItem}>
              <Calendar size={13} />
              <span>Started at: {formatDateTime(instance.started_at)}</span>
            </div>
            {isCompleted && (
              <div className={`${styles.metaDetailItem} ${styles.completedAtItem}`}>
                <CheckCircle2 size={13} />
                <span>Completed at: {formatDateTime(instance.completed_at)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Completion Banner */}
      {isCompleted && (
        <div className={styles.completedCelebrationBanner}>
          <Sparkles size={20} className={styles.celebrationIcon} />
          <div className={styles.celebrationText}>
            <h3>Process Completed Successfully</h3>
            <p>
              All {instance.total_tasks} sequential steps and governance requirements have been fulfilled and recorded.
            </p>
          </div>
        </div>
      )}

      {/* Vertical Steps Flow */}
      <div className={styles.stepFlowContainer}>
        <div className={styles.stepFlowHeader}>
          <h2>Workflow Execution Steps</h2>
          <span className={styles.refreshHint}>
            {refreshing ? 'Updating state...' : 'Live DAG state synced'}
          </span>
        </div>

        <div className={styles.stepsList}>
          {tasks.map((task, idx) => {
            const badge = getWorkflowStateBadge(task.workflow_state);
            const StateIcon = badge.icon;
            const isWaiting = task.workflow_state === 'waiting';
            const isTaskDone = task.workflow_state === 'completed';
            const isActionable = ['ready', 'active', 'rework_required'].includes(task.workflow_state);
            const isAwaitingApproval = task.workflow_state === 'awaiting_approval';
            const isAwaitingConsultation = task.workflow_state === 'awaiting_consultation';

            const userIsResponsible = (task.raci || []).some(
              (r) => r.raci_role === 'R' && r.user_id === user?.id
            );
            const userIsAccountable = (task.raci || []).some(
              (r) => r.raci_role === 'A' && r.user_id === user?.id
            );
            const userIsConsulted = (task.raci || []).some(
              (r) => r.raci_role === 'C' && r.user_id === user?.id
            );

            return (
              <div
                key={task.id}
                className={`${styles.stepCard} ${
                  isWaiting ? styles.stepCardWaiting : isTaskDone ? styles.stepCardDone : styles.stepCardActive
                }`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                {/* Left Sequence Marker */}
                <div className={styles.seqCol}>
                  <div
                    className={`${styles.seqMarker} ${
                      isTaskDone
                        ? styles.seqMarkerDone
                        : isWaiting
                        ? styles.seqMarkerWaiting
                        : styles.seqMarkerActive
                    }`}
                  >
                    {isTaskDone ? (
                      <CheckCircle2 size={18} />
                    ) : isWaiting ? (
                      <Lock size={15} />
                    ) : (
                      <span>{task.sequence_order || idx + 1}</span>
                    )}
                  </div>
                  {idx < tasks.length - 1 && <div className={styles.seqLine} />}
                </div>

                {/* Main Step Card Body */}
                <div className={styles.stepBody}>
                  {/* Step Top Row */}
                  <div className={styles.stepTopRow}>
                    <div className={styles.stepCodeTitle}>
                      <span className={styles.stepCode}>{task.step_def?.step_code || `STEP-${idx + 1}`}</span>
                      <h3 className={styles.stepTitle}>{task.title}</h3>
                    </div>

                    <div className={styles.stepBadges}>
                      <span className={`${styles.stateBadge} ${badge.className}`}>
                        <StateIcon size={13} /> {badge.label}
                      </span>
                      {task.current_cycle_number > 1 && (
                        <span className={styles.cycleBadge}>
                          Cycle {task.current_cycle_number}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Step Description */}
                  {task.description && (
                    <p className={styles.stepDescription}>{task.description}</p>
                  )}

                  {/* Step Metrics & RACI Bar */}
                  <div className={styles.stepMetadataBar}>
                    {/* Due Date */}
                    <div className={styles.metaItem}>
                      <Calendar size={13} className={styles.metaIcon} />
                      <span>
                        {isWaiting ? (
                          <em className={styles.mutedText}>Waiting for predecessor</em>
                        ) : task.due_date ? (
                          `Due: ${formatDate(task.due_date)}`
                        ) : (
                          'No due date'
                        )}
                      </span>
                    </div>

                    {/* Responsible Progress */}
                    {task.responsible_count > 0 && (
                      <div className={styles.metaItem}>
                        <User size={13} className={styles.metaIcon} />
                        <span>
                          Assignees: {task.responsible_completed_count} / {task.responsible_count} completed
                        </span>
                      </div>
                    )}

                    {/* Evidence count */}
                    {task.evidence_submissions?.length > 0 && (
                      <div className={styles.metaItem}>
                        <FileText size={13} className={styles.metaIcon} />
                        <span>{task.evidence_submissions.length} Evidence submitted</span>
                      </div>
                    )}
                  </div>

                  {/* RACI Avatars Row */}
                  <div className={styles.raciRow}>
                    <span className={styles.raciLabel}>Assignments:</span>
                    <div className={styles.raciChips}>
                      {(task.raci || []).map((r) => (
                        <span key={r.id} className={styles.raciChip} title={`${getRaciRoleLabel(r.raci_role)} (${r.raci_role}): ${r.profiles?.full_name}`}>
                          <span className={styles.raciRoleTag}>{r.raci_role}</span>
                          <Avatar
                            name={r.profiles?.full_name || 'User'}
                            size="xs"
                            src={r.profiles?.avatar_url}
                          />
                          <span className={styles.raciName}>{r.profiles?.full_name}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Inline Execution Actions (if applicable to current user) */}
                  {!isCompleted && !isReadOnly && (
                    <div className={styles.actionsBar} onClick={(e) => e.stopPropagation()}>
                      {/* Responsible Actions */}
                      {isActionable && userIsResponsible && (
                        <div className={styles.actionButtonGroup}>
                          <button
                            type="button"
                            className={styles.completePartBtn}
                            onClick={() => setCompletionModalTask(task)}
                            disabled={actionLoading}
                          >
                            <CheckCircle2 size={14} /> Complete My Part
                          </button>
                          <button
                            type="button"
                            className={styles.addEvidenceBtn}
                            onClick={() => setEvidenceModalTask(task)}
                            disabled={actionLoading}
                          >
                            <FileText size={14} /> Add Evidence
                          </button>
                        </div>
                      )}

                      {/* Consultation Action */}
                      {isAwaitingConsultation && userIsConsulted && (
                        <button
                          type="button"
                          className={styles.consultBtn}
                          onClick={() => setConsultModalTask(task)}
                          disabled={actionLoading}
                        >
                          <MessageSquare size={14} /> Submit Consultation
                        </button>
                      )}

                      {/* Accountable Approval Actions */}
                      {isAwaitingApproval && userIsAccountable && (
                        <div className={styles.actionButtonGroup}>
                          <button
                            type="button"
                            className={styles.approveBtn}
                            onClick={() => handleApprove(task)}
                            disabled={actionLoading}
                          >
                            <ShieldCheck size={14} /> Approve Step
                          </button>
                          <button
                            type="button"
                            className={styles.rejectBtn}
                            onClick={() => setRejectModalTask(task)}
                            disabled={actionLoading}
                          >
                            <ShieldAlert size={14} /> Request Rework
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task Detail Panel Drawer */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onSave={() => {}}
          onDelete={() => {}}
          statuses={[]}
          members={[]}
          departments={[]}
          readOnly={isReadOnly}
        />
      )}

      {/* Evidence Submission Modal */}
      {evidenceModalTask && (
        <div className={styles.modalOverlay} onClick={() => setEvidenceModalTask(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Add Evidence — {evidenceModalTask.title}</h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setEvidenceModalTask(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleEvidenceSubmit} className={styles.modalForm}>
              <div className={styles.typeSelector}>
                <button
                  type="button"
                  className={`${styles.typeBtn} ${evidenceType === 'text' ? styles.typeBtnActive : ''}`}
                  onClick={() => setEvidenceType('text')}
                >
                  Text Notes / Summary
                </button>
                <button
                  type="button"
                  className={`${styles.typeBtn} ${evidenceType === 'link' ? styles.typeBtnActive : ''}`}
                  onClick={() => setEvidenceType('link')}
                >
                  Document URL / Link
                </button>
              </div>

              {evidenceType === 'link' ? (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Reference URL</label>
                  <input
                    type="url"
                    className={styles.modalInput}
                    placeholder="https://..."
                    value={evidenceLink}
                    onChange={(e) => setEvidenceLink(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Evidence Text / Description</label>
                  <textarea
                    className={styles.modalTextarea}
                    rows={4}
                    placeholder="Provide evidence summary, deliverables or sign-off notes..."
                    value={evidenceText}
                    onChange={(e) => setEvidenceText(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setEvidenceModalTask(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Submitting...' : 'Submit Evidence'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Consultation Response Modal */}
      {consultModalTask && (
        <div className={styles.modalOverlay} onClick={() => setConsultModalTask(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Submit Consultation Feedback — {consultModalTask.title}</h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setConsultModalTask(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleConsultSubmit} className={styles.modalForm}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Consultation Feedback</label>
                <textarea
                  className={styles.modalTextarea}
                  rows={5}
                  placeholder="Provide technical feedback, recommendations or approval confirmation..."
                  value={consultText}
                  onChange={(e) => setConsultText(e.target.value)}
                  required
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setConsultModalTask(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={actionLoading || !consultText.trim()}
                >
                  {actionLoading ? 'Recording...' : 'Submit Feedback'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accountable Rejection / Rework Modal */}
      {rejectModalTask && (
        <div className={styles.modalOverlay} onClick={() => setRejectModalTask(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Request Rework — {rejectModalTask.title}</h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setRejectModalTask(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleRejectSubmit} className={styles.modalForm}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Rejection Reason / Required Changes</label>
                <textarea
                  className={styles.modalTextarea}
                  rows={4}
                  placeholder="Specify what needs to be changed or corrected..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  required
                />
              </div>

              <div className={styles.modalField}>
                <label className={styles.modalLabel}>New Target Due Date</label>
                <input
                  type="date"
                  className={styles.modalInput}
                  value={rejectDueDate}
                  onChange={(e) => setRejectDueDate(e.target.value)}
                  required
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setRejectModalTask(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.rejectSubmitBtn}
                  disabled={actionLoading || !rejectReason.trim() || !rejectDueDate}
                >
                  {actionLoading ? 'Requesting...' : 'Request Rework'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Completion Modal */}
      {completionModalTask && (
        <TaskCompletionModal
          isOpen={!!completionModalTask}
          task={completionModalTask}
          isDefinedTask={true}
          onClose={() => setCompletionModalTask(null)}
          onSuccess={() => {
            fetchInstance({ silent: true });
            setCompletionModalTask(null);
          }}
          readOnly={isReadOnly}
        />
      )}
    </div>
  );
}
