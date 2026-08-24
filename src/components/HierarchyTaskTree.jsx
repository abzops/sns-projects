import { useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock,
  Layers3,
  ListTodo,
  User,
  Workflow,
  XCircle,
} from 'lucide-react';
import PriorityIcon from './PriorityIcon';
import RaciBadge from './RaciBadge';
import StatusBadge from './StatusBadge';
import TaskSpendIndicator from './finance/hierarchy/TaskSpendIndicator.jsx';
import { buildHierarchyModel, getTaskDescendants } from '../lib/hierarchy';
import styles from './HierarchyTaskTree.module.css';

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function statusLabel(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Running';
}

function getSubtaskStatus(status) {
  switch (status) {
    case 'in_progress':
      return { label: 'In progress', icon: Clock };
    case 'done':
      return { label: 'Done', icon: CheckCircle2 };
    case 'cancelled':
      return { label: 'Cancelled', icon: XCircle };
    default:
      return { label: 'To do', icon: Circle };
  }
}

function SubtaskGroup({ subtasks }) {
  const eligibleSubtasks = subtasks.filter((subtask) => subtask.status !== 'cancelled');
  const doneCount = eligibleSubtasks.filter((subtask) => subtask.status === 'done').length;
  const cancelledCount = subtasks.length - eligibleSubtasks.length;

  return (
    <section className={styles.subtaskGroup} aria-label="Subtasks">
      <div className={styles.descendantGroupLabel}>
        <ListTodo size={13} />
        <span>Subtasks</span>
        <span className={styles.groupCount}>
          {doneCount}/{eligibleSubtasks.length} complete
          {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ''}
        </span>
      </div>
      <div className={styles.subtaskList}>
        {subtasks.map((subtask) => {
          const status = getSubtaskStatus(subtask.status);
          const StatusIcon = status.icon;
          const dueDate = formatDate(subtask.due_date);
          const assigneeName = subtask.assignee?.full_name;

          return (
            <div
              key={subtask.id}
              className={`${styles.subtaskRow} ${styles[`subtaskStatus_${subtask.status}`]}`}
            >
              <StatusIcon size={14} className={styles.subtaskStatusIcon} aria-hidden="true" />
              <span className={styles.subtaskTitle}>{subtask.title}</span>
              <span className={styles.subtaskStatusLabel}>{status.label}</span>
              <div className={styles.subtaskMeta}>
                {assigneeName && (
                  <span className={styles.subtaskMetaItem}>
                    <User size={12} /> {assigneeName}
                  </span>
                )}
                {dueDate && (
                  <span className={styles.subtaskMetaItem}>
                    <Calendar size={12} /> {dueDate}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProcessGroup({ instance, model, onTaskOpen, depth = 0, lineage = new Set(), taskFinancials = {} }) {
  const [expanded, setExpanded] = useState(true);
  const steps = model.processStepsByInstance.get(instance.id) || [];
  const processName = instance.defined_processes?.name || 'Process';
  const version = instance.defined_process_versions?.version_number;
  const dueDate = formatDate(instance.due_date);

  return (
    <section className={styles.processGroup} aria-label={`${instance.instance_name} process`}>
      <div className={styles.processHeader}>
        <button
          type="button"
          className={styles.chevronButton}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${instance.instance_name}`}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Workflow size={16} className={styles.processIcon} />
        <div className={styles.processIdentity}>
          <strong>{instance.instance_name}</strong>
          <span>
            {processName}{version ? ` · v${version}` : ''}
          </span>
        </div>
        <span className={`${styles.processStatus} ${styles[`processStatus_${instance.status}`]}`}>
          {statusLabel(instance.status)}
        </span>
        <div className={styles.processProgress}>
          <span>{instance.progress == null ? 'Progress unavailable' : `${instance.progress}% complete`}</span>
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressFill}
              style={{ width: `${Math.min(100, Math.max(0, instance.progress ?? 0))}%` }}
            />
          </div>
        </div>
        {dueDate && (
          <span className={styles.dueDate}><Calendar size={12} /> {dueDate}</span>
        )}
      </div>

      {expanded && (
        <div className={styles.processSteps}>
          {steps.length === 0 ? (
            <p className={styles.emptyProcess}>No visible process steps.</p>
          ) : (
            steps.map((step) => (
              <TaskNode
                key={step.id}
                task={step}
                model={model}
                onTaskOpen={onTaskOpen}
                depth={depth + 1}
                lineage={lineage}
                processStep
                taskFinancials={taskFinancials}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function TaskNode({ task, model, onTaskOpen, depth = 0, lineage = new Set(), processStep = false, taskFinancials = {} }) {
  const [expanded, setExpanded] = useState(true);
  const {
    subtasks,
    attachedProcesses,
    ordinaryChildren,
    hasDescendants,
  } = getTaskDescendants(task.id, model);
  const status = task.task_statuses;
  const dueDate = formatDate(task.due_date);
  const financial = taskFinancials?.[task.id] || null;
  const nextLineage = new Set(lineage);
  nextLineage.add(task.id);

  return (
    <div className={`${styles.taskBranch} ${processStep ? styles.processStepBranch : ''}`}>
      <div className={styles.taskNode} style={{ '--tree-depth': Math.min(depth, 8) }}>
        {hasDescendants ? (
          <button
            type="button"
            className={styles.chevronButton}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${task.title}`}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className={styles.chevronSpacer} aria-hidden="true" />
        )}
        {processStep ? (
          <CircleDot size={14} className={styles.stepIcon} aria-hidden="true" />
        ) : (
          <Layers3 size={14} className={styles.taskIcon} aria-hidden="true" />
        )}
        <button type="button" className={styles.taskTitle} onClick={() => onTaskOpen?.(task)}>
          {task.title}
        </button>
        {processStep && <span className={styles.stepTag}>Process step</span>}
        <div className={styles.taskMeta}>
          {financial && <TaskSpendIndicator financial={financial} />}
          {status && (
            <StatusBadge status={{ name: status.name, color: status.color }} size="sm" />
          )}
          <PriorityIcon priority={task.priority || 'none'} showLabel />
          {task.raci && <RaciBadge raci={task.raci} compact />}
          {dueDate && <span className={styles.dueDate}><Calendar size={12} /> {dueDate}</span>}
        </div>
      </div>

      {expanded && hasDescendants && (
        <div className={styles.branchChildren}>
          {subtasks.length > 0 && <SubtaskGroup subtasks={subtasks} />}

          {attachedProcesses.length > 0 && (
            <div className={styles.descendantGroupLabel}>
              <Workflow size={13} />
              <span>Processes</span>
              <span className={styles.groupCount}>{attachedProcesses.length}</span>
            </div>
          )}

          {attachedProcesses.map((instance) => (
            <ProcessGroup
              key={instance.id}
              instance={instance}
              model={model}
              onTaskOpen={onTaskOpen}
              depth={depth + 1}
              lineage={nextLineage}
              taskFinancials={taskFinancials}
            />
          ))}

          {ordinaryChildren.length > 0 && attachedProcesses.length > 0 && (
            <div className={styles.otherGroupLabel}>Other</div>
          )}

          {ordinaryChildren.length > 0 && attachedProcesses.length === 0 && subtasks.length > 0 && (
            <div className={styles.otherGroupLabel}>Child Tasks</div>
          )}

          {ordinaryChildren.map((child) => (
            nextLineage.has(child.id) ? null : (
              <TaskNode
                key={child.id}
                task={child}
                model={model}
                onTaskOpen={onTaskOpen}
                depth={depth + 1}
                lineage={nextLineage}
                taskFinancials={taskFinancials}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

export function HierarchyProcessGroups({ processes = [], tasks = [], onTaskOpen, taskFinancials = {} }) {
  const model = useMemo(() => buildHierarchyModel(tasks, processes), [tasks, processes]);
  if (processes.length === 0) return null;

  return (
    <div className={styles.placementProcesses}>
      {processes.map((instance) => (
        <ProcessGroup
          key={instance.id}
          instance={instance}
          model={model}
          onTaskOpen={onTaskOpen}
          taskFinancials={taskFinancials}
        />
      ))}
    </div>
  );
}

export default function HierarchyTaskTree({
  tasks = [],
  processInstances = [],
  onTaskOpen,
  emptyMessage = 'No tasks in this list.',
  taskFinancials = {},
}) {
  const model = useMemo(
    () => buildHierarchyModel(tasks, processInstances),
    [tasks, processInstances]
  );

  if (model.rootTasks.length === 0) {
    return <p className={styles.emptyTree}>{emptyMessage}</p>;
  }

  return (
    <div className={styles.tree} role="tree" aria-label="Task hierarchy">
      {model.rootTasks.map((task) => (
        <TaskNode
          key={task.id}
          task={task}
          model={model}
          onTaskOpen={onTaskOpen}
          taskFinancials={taskFinancials}
        />
      ))}
    </div>
  );
}
