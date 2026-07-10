import { Calendar } from 'lucide-react';
import Avatar from './Avatar';
import PriorityIcon from './PriorityIcon';
import styles from './TaskCard.module.css';

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TaskCard({ task, onClick, isDragging = false }) {
  if (!task) return null;

  const overdue = isOverdue(task.due_date);
  const assigneeName = task.assignee?.full_name || task.assignee?.email;

  return (
    <div
      className={`${styles.card} ${isDragging ? styles.dragging : ''}`}
      onClick={() => onClick?.(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(task)}
    >
      <h4 className={styles.title}>{task.title}</h4>

      {task.description && (
        <p className={styles.description}>{task.description}</p>
      )}

      <div className={styles.meta}>
        <div className={styles.leftMeta}>
          <PriorityIcon priority={task.priority || 'none'} showLabel />

          {task.due_date && (
            <span className={`${styles.date} ${overdue ? styles.overdue : ''}`}>
              <Calendar size={13} />
              {formatDate(task.due_date)}
            </span>
          )}
        </div>

        {assigneeName && (
          <div className={styles.assignee}>
            <Avatar 
              name={assigneeName} 
              src={task.assignee?.avatar_url} 
              size="sm" 
            />
          </div>
        )}
      </div>
    </div>
  );
}
