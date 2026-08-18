import { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Layers3,
  Workflow,
} from 'lucide-react';
import PriorityIcon from './PriorityIcon';
import RaciBadge from './RaciBadge';
import StatusBadge from './StatusBadge';
import { buildHierarchyModel } from '../lib/hierarchy';
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

function ProcessGroup({ instance, model, onTaskOpen, depth = 0, lineage = new Set() }) {
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
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function TaskNode({ task, model, onTaskOpen, depth = 0, lineage = new Set(), processStep = false }) {
  const [expanded, setExpanded] = useState(true);
  const ordinaryChildren = model.ordinaryChildrenByParent.get(task.id) || [];
  const attachedProcesses = model.processesByHostTask.get(task.id) || [];
  const hasChildren = ordinaryChildren.length > 0 || attachedProcesses.length > 0;
  const status = task.task_statuses;
  const dueDate = formatDate(task.due_date);
  const nextLineage = new Set(lineage);
  nextLineage.add(task.id);

  return (
    <div className={`${styles.taskBranch} ${processStep ? styles.processStepBranch : ''}`}>
      <div className={styles.taskNode} style={{ '--tree-depth': Math.min(depth, 8) }}>
        {hasChildren ? (
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
          {status && (
            <StatusBadge status={{ name: status.name, color: status.color }} size="sm" />
          )}
          <PriorityIcon priority={task.priority || 'none'} showLabel />
          {task.raci && <RaciBadge raci={task.raci} compact />}
          {dueDate && <span className={styles.dueDate}><Calendar size={12} /> {dueDate}</span>}
        </div>
      </div>

      {expanded && hasChildren && (
        <div className={styles.branchChildren}>
          {attachedProcesses.map((instance) => (
            <ProcessGroup
              key={instance.id}
              instance={instance}
              model={model}
              onTaskOpen={onTaskOpen}
              depth={depth + 1}
              lineage={nextLineage}
            />
          ))}

          {ordinaryChildren.length > 0 && attachedProcesses.length > 0 && (
            <div className={styles.otherGroupLabel}>Other</div>
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
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

export function HierarchyProcessGroups({ processes = [], tasks = [], onTaskOpen }) {
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
        <TaskNode key={task.id} task={task} model={model} onTaskOpen={onTaskOpen} />
      ))}
    </div>
  );
}
