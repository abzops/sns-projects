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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TaskRow({ task, onClick, showProjectName = false, showHierarchy = false }) {
  if (!task) return null;

  const isDone = task.task_statuses?.system_code === 'done' || task.task_statuses?.name?.toLowerCase().includes('done');
  const isBlocked = task.task_statuses?.system_code === 'blocked' || task.task_statuses?.name?.toLowerCase().includes('blocked');
  const overdue = isOverdue(task.due_date, isDone);
  const hasSubtasks = (task.subtask_count || 0) > 0;

  return (
    <tr
      className={`${styles.row} ${isBlocked ? styles.blockedRow : ''}`}
      onClick={() => onClick?.(task)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(task)}
    >
      {/* Title & Project & Hierarchy */}
      <td className={styles.titleCell}>
        <div className={styles.titleWrapper}>
          {isBlocked && (
            <span className={styles.blockedBadge} title="Task is blocked">
              <ShieldAlert size={12} />
            </span>
          )}
          <span className={styles.taskTitle}>{task.title}</span>

          {hasSubtasks && (
            <span className={styles.subtaskBadge} title="Subtasks completed">
              <ListTodo size={11} />
              <span>{task.subtasks_completed_count || 0}/{task.subtask_count}</span>
            </span>
          )}

          {showHierarchy && (task.milestones?.name || task.task_lists?.name) && (
            <span className={styles.hierarchyBadge}>
              <Layers size={10} />
              <span>{task.task_lists?.name || task.milestones?.name}</span>
            </span>
          )}

          {showProjectName && task.projects?.name && (
            <span className={styles.projectName}>in {task.projects.name}</span>
          )}
        </div>
      </td>

      {/* Status */}
      <td>
        {task.task_statuses && (
          <StatusBadge status={{ name: task.task_statuses.name, color: task.task_statuses.color }} size="sm" />
        )}
      </td>

      {/* Priority */}
      <td>
        <PriorityIcon priority={task.priority || 'none'} showLabel />
      </td>

      {/* RACI Column */}
      <td>
        {task.raci ? (
          <RaciBadge raci={task.raci} compact />
        ) : task.assignee?.full_name ? (
          <span className={styles.legacyAssignee}>{task.assignee.full_name}</span>
        ) : (
          <span className={styles.unassigned}>—</span>
        )}
      </td>

      {/* Due Date */}
      <td>
        <span
          className={`${styles.date} ${overdue ? styles.overdue : ''}`}
        >
          {formatDate(task.due_date)}
          {overdue && <span className={styles.overdueDot} title="Overdue" />}
        </span>
      </td>
    </tr>
  );
}
