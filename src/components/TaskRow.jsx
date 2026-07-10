import Avatar from './Avatar';
import StatusBadge from './StatusBadge';
import PriorityIcon from './PriorityIcon';
import styles from './TaskRow.module.css';

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TaskRow({ task, onClick }) {
  if (!task) return null;

  const overdue = isOverdue(task.due_date);
  const today = isToday(task.due_date);
  const assigneeName = task.assignee?.full_name || task.assignee?.email;

  return (
    <tr
      className={styles.row}
      onClick={() => onClick?.(task)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(task)}
    >
      <td className={styles.titleCell}>
        <span className={styles.taskTitle}>{task.title}</span>
      </td>
      <td>
        {task.task_statuses && (
          <StatusBadge status={{ name: task.task_statuses.name, color: task.task_statuses.color }} size="sm" />
        )}
      </td>
      <td>
        <PriorityIcon priority={task.priority || 'none'} showLabel />
      </td>
      <td>
        {assigneeName ? (
          <div className={styles.assignee}>
            <Avatar name={assigneeName} src={task.assignee?.avatar_url} size="sm" />
            <span className={styles.assigneeName}>{assigneeName}</span>
          </div>
        ) : (
          <span className={styles.unassigned}>—</span>
        )}
      </td>
      <td>
        <span
          className={`${styles.date} ${overdue ? styles.overdue : ''} ${
            today ? styles.today : ''
          }`}
        >
          {formatDate(task.due_date)}
        </span>
      </td>
    </tr>
  );
}
