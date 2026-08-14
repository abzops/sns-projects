import { useState, useRef, useEffect } from 'react';
import { Calendar, ShieldAlert, ListTodo, Layers, GripVertical, MoreVertical } from 'lucide-react';
import PriorityIcon from './PriorityIcon';
import RaciBadge from './RaciBadge';
import styles from './TaskCard.module.css';

function isOverdue(dateStr, isDone) {
  if (!dateStr || isDone) return false;
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

export default function TaskCard({
  task,
  onClick,
  isDragging = false,
  isOverlay = false,
  showStatus = false,
  showHierarchy = false,
  dragHandleProps = null,
  statuses = [],
  onMoveStatus = null,
}) {
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!showStatusMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowStatusMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showStatusMenu]);

  if (!task) return null;

  const isDone = task.task_statuses?.system_code === 'done' || task.task_statuses?.name?.toLowerCase().includes('done');
  const isBlocked = task.task_statuses?.system_code === 'blocked' || task.task_statuses?.name?.toLowerCase().includes('blocked');
  const overdue = isOverdue(task.due_date, isDone);
  const hasSubtasks = (task.subtask_count || 0) > 0;

  const handleCardClick = (e) => {
    // If clicked inside the drag handle or status menu, do not trigger card detail modal
    if (e.target.closest(`.${styles.dragHandle}`) || e.target.closest(`.${styles.menuContainer}`)) {
      return;
    }
    onClick?.(task);
  };

  return (
    <div
      className={`
        ${styles.card}
        ${isDragging ? styles.dragging : ''}
        ${isOverlay ? styles.overlayCard : ''}
        ${isBlocked ? styles.blockedCard : ''}
      `}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleCardClick(e);
      }}
    >
      {/* Top badges & Grip handle row */}
      <div className={styles.topRow}>
        <div className={styles.leftTopGroup}>
          {dragHandleProps && (
            <div
              className={styles.dragHandle}
              title="Drag to reorder or move status"
              tabIndex={-1}
              aria-label="Drag handle"
              {...dragHandleProps}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={14} />
            </div>
          )}

          <div className={styles.statusTags}>
            {showStatus && task.task_statuses && (
              <span
                className={styles.statusPill}
                style={{
                  background: `${task.task_statuses.color}20`,
                  color: task.task_statuses.color,
                  borderColor: `${task.task_statuses.color}40`,
                }}
              >
                {task.task_statuses.name}
              </span>
            )}
            {isBlocked && (
              <span className={styles.blockedPill} title="Task is marked as Blocked">
                <ShieldAlert size={11} /> Blocked
              </span>
            )}
            {showHierarchy && (task.milestones?.name || task.task_lists?.name) && (
              <span className={styles.hierarchyBadge} title={`${task.milestones?.name || ''} › ${task.task_lists?.name || ''}`}>
                <Layers size={10} />
                <span>{task.task_lists?.name || task.milestones?.name}</span>
              </span>
            )}
          </div>
        </div>

        <div className={styles.rightTopGroup}>
          <PriorityIcon priority={task.priority || 'none'} showLabel />

          {/* Quick status change fallback for touch / accessible menu */}
          {onMoveStatus && statuses.length > 0 && !isOverlay && (
            <div className={styles.menuContainer} ref={menuRef}>
              <button
                type="button"
                className={styles.menuTriggerBtn}
                title="Move task to another status"
                aria-label="Move task status"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowStatusMenu((prev) => !prev);
                }}
              >
                <MoreVertical size={13} />
              </button>

              {showStatusMenu && (
                <div className={styles.statusDropdownMenu} onClick={(e) => e.stopPropagation()}>
                  <div className={styles.menuHeader}>Move to…</div>
                  {statuses.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      className={`${styles.menuOption} ${st.id === task.status_id ? styles.menuOptionActive : ''}`}
                      onClick={() => {
                        setShowStatusMenu(false);
                        if (st.id !== task.status_id) {
                          onMoveStatus(task.id, st.id);
                        }
                      }}
                    >
                      <span className={styles.menuStatusDot} style={{ background: st.color }} />
                      <span>{st.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Title */}
      <h4 className={styles.title}>{task.title}</h4>

      {/* Description */}
      {task.description && (
        <p className={styles.description}>{task.description}</p>
      )}

      {/* Meta Footer */}
      <div className={styles.footer}>
        <div className={styles.leftMeta}>
          {task.due_date && (
            <span className={`${styles.date} ${overdue ? styles.overdue : ''}`}>
              <Calendar size={12} />
              {formatDate(task.due_date)}
              {overdue && <span className={styles.overdueTag}>Overdue</span>}
            </span>
          )}
          {hasSubtasks && (
            <span className={styles.subtaskBadge} title="Subtasks completion">
              <ListTodo size={12} />
              <span>{task.subtasks_completed_count || 0}/{task.subtask_count}</span>
            </span>
          )}
        </div>

        {/* Compact RACI Display */}
        <div className={styles.raciWrapper}>
          {task.raci ? (
            <RaciBadge raci={task.raci} compact />
          ) : task.assignee ? (
            <div className={styles.legacyAssignee} title={`Assignee: ${task.assignee.full_name}`}>
              <span className={styles.legacyAvatarText}>
                {task.assignee.full_name?.slice(0, 2).toUpperCase()}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
