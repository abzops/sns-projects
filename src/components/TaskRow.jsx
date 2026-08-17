import StatusBadge from './StatusBadge';
import PriorityIcon from './PriorityIcon';
import RaciBadge from './RaciBadge';
import { ShieldAlert, ListTodo, Layers } from 'lucide-react';
import styles from './TaskRow.module.css';

function isOverdue(dateStr, isDone) {
  if (!dateStr || isDone) return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  // Returns clean "25 Oct 2026"
  const day = d.getDate();
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export default function TaskRow({ task, onClick, showProjectName = false, showHierarchy = true }) {
  if (!task) return null;

  const isDone = task.task_statuses?.system_code === 'done' || task.task_statuses?.name?.toLowerCase().includes('done');
  const isBlocked = task.task_statuses?.system_code === 'blocked' || task.task_statuses?.name?.toLowerCase().includes('blocked');
  const overdue = isOverdue(task.due_date, isDone);
  const hasSubtasks = (task.subtask_count || 0) > 0;
  const hierarchyName = task.task_lists?.name || task.phases?.name;

  return (
    <tr
      className={`${styles.row} ${isBlocked ? styles.blockedRow : ''}`}
      onClick={() => onClick?.(task)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(task)}
    >
      {/* Title & Hierarchy (2 Clean Visual Levels) */}
      <td className={styles.titleCell}>
        <div className={styles.titleContainer}>
          <div className={styles.primaryTitleRow}>
            {isBlocked && (
              <span className={styles.blockedBadge} title="Task is blocked">
                <ShieldAlert size={13} />
              </span>
            )}
            <span className={styles.taskTitle}>{task.title}</span>
            {showProjectName && task.projects?.name && (
              <span className={styles.projectName}>({task.projects.name})</span>
            )}
          </div>

          <div className={styles.secondaryMetaRow}>
            {showHierarchy && hierarchyName && (
              <span className={styles.hierarchyMeta} title={task.phases?.name ? `Phase: ${task.phases.name}` : ''}>
                <Layers size={11} className={styles.metaIcon} />
                <span>{hierarchyName}</span>
              </span>
            )}

            {hasSubtasks && (
              <span className={styles.subtaskMeta} title="Subtask completion">
                {showHierarchy && hierarchyName && <span className={styles.metaDot}>·</span>}
                <ListTodo size={11} className={styles.metaIcon} />
                <span>{task.subtasks_completed_count || 0}/{task.subtask_count} subtasks</span>
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Status */}
      <td className={styles.statusCell}>
        {task.task_statuses ? (
          <StatusBadge status={{ name: task.task_statuses.name, color: task.task_statuses.color }} size="sm" />
        ) : (
          <span className={styles.unassigned}>—</span>
        )}
      </td>

      {/* Priority */}
      <td className={styles.priorityCell}>
        <PriorityIcon priority={task.priority || 'none'} showLabel />
      </td>

      {/* RACI Column */}
      <td className={styles.raciCell}>
        {task.raci ? (
          <RaciBadge raci={task.raci} compact />
        ) : task.assignee?.full_name ? (
          <span className={styles.legacyAssignee}>{task.assignee.full_name}</span>
        ) : (
          <span className={styles.unassigned}>—</span>
        )}
      </td>

      {/* Due Date */}
      <td className={styles.dateCell}>
        <span className={`${styles.date} ${overdue ? styles.overdue : ''}`}>
          {formatDate(task.due_date)}
          {overdue && <span className={styles.overdueDot} title="Overdue" />}
        </span>
      </td>
    </tr>
  );
}
