import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTasks } from '../hooks/useTasks';
import { useTaskStatuses } from '../hooks/useTaskStatuses';
import { useMembers } from '../hooks/useMembers';
import { useProjects } from '../hooks/useProjects';
import { useDepartments } from '../hooks/useDepartments';
import { usePhases } from '../hooks/usePhases';
import { useTaskLists } from '../hooks/useTaskLists';
import { useProjectProcessInstances } from '../hooks/useProjectProcessInstances';
import { useUserContext } from '../hooks/useUserContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { getMemberDisplayName } from '../lib/identity';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus,
  List,
  Kanban,
  Search,
  ChevronLeft,
  Calendar,
  User,
  Layers,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  BookmarkPlus,
  AlertCircle,
  Workflow,
  LockKeyhole,
} from 'lucide-react';

import TaskRow from '../components/TaskRow';
import TaskCard from '../components/TaskCard';
import TaskDetailPanel from '../components/TaskDetailPanel';
import HierarchyTaskTree, { HierarchyProcessGroups } from '../components/HierarchyTaskTree';
import Modal from '../components/Modal';
import { TaskRowSkeleton, CardGridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { getPlacementProcesses } from '../lib/hierarchy';
import {
  createTaskCreationContext,
  createTaskListCreationContext,
  resolveTaskListParentId,
  resolveTaskParentIds,
} from '../utils/hierarchyCreationContext';

import styles from './TasksPage.module.css';

const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];
const PRIORITY_LABELS = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

/* ───── Canonical Status Resolution Helper ───── */
function getStatusSystemCode(status) {
  if (!status) return 'todo';
  if (status.system_code) return status.system_code;
  const name = (status.name || '').toLowerCase().trim();
  if (name.includes('progress')) return 'in_progress';
  if (name.includes('review')) return 'in_review';
  if (name.includes('blocked') || name.includes('hold')) return 'blocked';
  if (name.includes('done') || name.includes('complete')) return 'done';
  return 'todo';
}

function getErrorMessage(error) {
  if (!error) return null;
  return error.message || error.details || String(error);
}

/* ───── Canonical Board State Builder ───── */
function buildBoardState(tasks, statuses) {
  const map = {
    todo: [],
    in_progress: [],
    in_review: [],
    blocked: [],
    done: [],
  };

  (statuses || []).forEach((s) => {
    const code = getStatusSystemCode(s);
    if (!map[code]) map[code] = [];
  });

  const statusesById = new Map((statuses || []).map((s) => [s.id, s]));

  (tasks || []).forEach((t) => {
    const st = statusesById.get(t.status_id) || t.task_statuses;
    const code = getStatusSystemCode(st);
    if (!map[code]) map[code] = [];
    map[code].push(t);
  });

  Object.keys(map).forEach((code) => {
    map[code].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  });

  return map;
}

/* ───── Sortable Task Card Wrapper (Kanban) ───── */
function SortableTaskCardWrapper({ task, onClick, disabled = false, statuses = [], onMoveStatus = null }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: 'task',
      task,
    },
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandleProps = disabled
    ? null
    : {
        ref: setActivatorNodeRef,
        ...attributes,
        ...listeners,
      };

  const isDefined = !!task?.process_step_id;

  return (
    <div ref={setNodeRef} style={style} className={styles.sortableCardContainer}>
      <TaskCard
        task={task}
        onClick={() => onClick(task)}
        isDragging={isDragging}
        dragHandleProps={dragHandleProps}
        statuses={statuses}
        onMoveStatus={isDefined ? null : onMoveStatus}
      />
    </div>
  );
}

/* ───── Droppable Kanban Column (Kanban) ───── */
function KanbanColumn({
  status,
  tasks: columnTasks,
  onTaskClick,
  onAddTask,
  disabled = false,
  statuses = [],
  onMoveStatus = null,
}) {
  const statusCode = getStatusSystemCode(status);
  const { setNodeRef, isOver } = useDroppable({
    id: statusCode,
    data: {
      type: 'column',
      status,
      statusCode,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`${styles.column} ${isOver ? styles.columnOver : ''}`}
      data-status-code={statusCode}
    >
      <div className={styles.colHeader}>
        <div className={styles.colTitleWrap}>
          <span
            className={styles.colDot}
            style={{ background: status.color }}
          />
          <h3 className={styles.colTitle}>{status.name}</h3>
        </div>
        <span className={styles.colCount}>{columnTasks.length}</span>
      </div>

      <SortableContext
        items={columnTasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={styles.taskList}>
          {columnTasks.length === 0 ? (
            <div className={styles.emptyDropZone}>
              <span>Drop task here</span>
            </div>
          ) : (
            columnTasks.map((task) => (
              <SortableTaskCardWrapper
                key={task.id}
                task={task}
                onClick={onTaskClick}
                disabled={disabled}
                statuses={statuses}
                onMoveStatus={onMoveStatus}
              />
            ))
          )}
        </div>
      </SortableContext>

      <button
        className={styles.colAddBtn}
        onClick={() => onAddTask(status.id)}
        disabled={disabled}
        type="button"
      >
        <Plus size={14} />
        <span>Add Task</span>
      </button>
    </div>
  );
}

/* ───── Main TasksPage ───── */
export default function TasksPage() {
  const { projectId, workspaceId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const {
    tasks = [],
    loading: tasksLoading,
    error: tasksError,
    createTask,
    updateTask,
    deleteTask,
    reorderTask,
    refetch: refetchTasks,
  } = useTasks(projectId, workspaceId);
  const { statuses = [], loading: statusesLoading } = useTaskStatuses(projectId);
  const { members = [] } = useMembers(workspaceId);
  const { projects = [] } = useProjects(workspaceId);
  const { departments = [] } = useDepartments(workspaceId);
  const {
    phases = [],
    loading: phasesLoading,
    error: phasesError,
    createPhase,
    deletePhase,
  } = usePhases(projectId);
  const {
    taskLists = [],
    loading: taskListsLoading,
    error: taskListsError,
    createTaskList,
    deleteTaskList,
  } = useTaskLists(projectId);
  const {
    processInstances = [],
    loading: processInstancesLoading,
    error: processInstancesError,
  } = useProjectProcessInstances(projectId);

  const project = projects?.find((p) => p.id === projectId);

  // User context & task mutation permissions
  const {
    canMutateOperationalData,
    loading: userContextLoading,
  } = useUserContext(workspaceId);

  const canMutateTasks =
    !userContextLoading &&
    canMutateOperationalData;

  // View state: 'hierarchy' | 'kanban' | 'list'
  const [view, setView] = useState('hierarchy');
  const [search, setSearch] = useState('');
  const [filterPhase, setFilterPhase] = useState('');
  const [filterTaskList, setFilterTaskList] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [sortColumn, setSortColumn] = useState('title');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedTask, setSelectedTask] = useState(null);

  // Collapsed state for Hierarchy accordion
  const [collapsedPhases, setCollapsedPhases] = useState(new Set());
  const [collapsedTaskLists, setCollapsedTaskLists] = useState(new Set());

  // Modals state
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddPhaseModal, setShowAddPhaseModal] = useState(false);
  const [showAddTaskListModal, setShowAddTaskListModal] = useState(false);
  const [taskCreationContext, setTaskCreationContext] = useState(null);
  const [taskListCreationContext, setTaskListCreationContext] = useState(null);

  // Kanban local board state & dragging refs
  const [activeId, setActiveId] = useState(null);
  const [boardTasks, setBoardTasks] = useState({});
  const boardSnapshotRef = useRef(null);
  const initialContainerRef = useRef(null);
  const boardScrollRef = useRef(null);
  const autoScrollAnimationRef = useRef(null);

  // New task form state
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPhaseId, setNewTaskPhaseId] = useState('');
  const [newTaskTaskListId, setNewTaskTaskListId] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAccountable, setNewTaskAccountable] = useState('');
  const [newTaskResponsible, setNewTaskResponsible] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  // New phase form state
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseDesc, setNewPhaseDesc] = useState('');
  const [newPhaseStart, setNewPhaseStart] = useState('');
  const [newPhaseEnd, setNewPhaseEnd] = useState('');
  const [addingPhase, setAddingPhase] = useState(false);

  // New task list form state
  const [newTaskListPhaseId, setNewTaskListPhaseId] = useState('');
  const [newTaskListName, setNewTaskListName] = useState('');
  const [newTaskListDesc, setNewTaskListDesc] = useState('');
  const [addingTaskList, setAddingTaskList] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Custom collision strategy: pointer intersection first, fallback to closest corners
  const customCollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    const rectCollisions = rectIntersection(args);
    if (rectCollisions.length > 0) {
      return rectCollisions;
    }
    return closestCorners(args);
  }, []);

  // Accordion toggle helpers
  const togglePhaseCollapse = (phaseId) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  const toggleTaskListCollapse = (taskListId) => {
    setCollapsedTaskLists((prev) => {
      const next = new Set(prev);
      if (next.has(taskListId)) next.delete(taskListId);
      else next.add(taskListId);
      return next;
    });
  };

  /* ── Filtered Task Lists based on selected phase (for cascading pickers) ── */
  const availableTaskListsForSelectedPhase = useMemo(() => {
    if (!newTaskPhaseId) return [];
    return taskLists.filter((tl) => tl.phase_id === newTaskPhaseId);
  }, [taskLists, newTaskPhaseId]);

  const kanbanAvailableTaskLists = useMemo(() => {
    if (!filterPhase) return taskLists;
    return taskLists.filter((tl) => tl.phase_id === filterPhase);
  }, [taskLists, filterPhase]);

  /* ── Filtered tasks ── */
  const filteredTasks = useMemo(() => {
    let result = [...(tasks || [])];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      );
    }
    if (filterPhase) {
      result = result.filter((t) => t.phase_id === filterPhase);
    }
    if (filterTaskList) {
      result = result.filter((t) => t.task_list_id === filterTaskList);
    }
    if (filterPriority) {
      result = result.filter((t) => t.priority === filterPriority);
    }
    if (filterAssignee) {
      result = result.filter(
        (t) =>
          t.assignee_id === filterAssignee ||
          t.raci?.accountable?.user_id === filterAssignee ||
          t.raci?.responsible?.some((r) => r.user_id === filterAssignee)
      );
    }

    return result;
  }, [tasks, search, filterPhase, filterTaskList, filterPriority, filterAssignee]);

  /* ── Sorted tasks (for list view) ── */
  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks];
    sorted.sort((a, b) => {
      let valA = a[sortColumn] || '';
      let valB = b[sortColumn] || '';
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredTasks, sortColumn, sortDir]);

  /* ── Legacy Uncategorized Tasks ── */
  const uncategorizedTasks = useMemo(() => {
    return tasks.filter(
      (task) =>
        !task.phase_id &&
        !task.task_list_id &&
        !task.process_instance_id &&
        !task.process_step_id
    );
  }, [tasks]);

  const projectProcesses = useMemo(
    () => getPlacementProcesses(processInstances, 'project', projectId),
    [processInstances, projectId]
  );

  const hierarchyError =
    getErrorMessage(tasksError) ||
    getErrorMessage(phasesError) ||
    getErrorMessage(taskListsError) ||
    getErrorMessage(processInstancesError);

  /* ── Handlers ── */
  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  const handleOpenAddTask = ({ phase = null, taskList = null } = {}) => {
    const context = phase && taskList
      ? createTaskCreationContext({
          projectId,
          projectName: project?.name,
          phase,
          taskList,
        })
      : null;

    setTaskCreationContext(context);
    setNewTaskTitle('');
    setNewTaskDesc('');
    setNewTaskPhaseId(context?.phaseId || (phases[0]?.id ?? ''));
    setNewTaskTaskListId(context?.taskListId || '');
    setNewTaskStatus(statuses?.[0]?.id ?? '');
    setNewTaskPriority('medium');
    setNewTaskAccountable('');
    setNewTaskResponsible('');
    setNewTaskDueDate('');
    setShowAddTaskModal(true);
  };

  const handleCloseAddTask = () => {
    setShowAddTaskModal(false);
    setTaskCreationContext(null);
  };

  const handleOpenAddTaskList = (phase = null) => {
    const context = phase ? createTaskListCreationContext(phase) : null;
    setTaskListCreationContext(context);
    setNewTaskListPhaseId(context?.phaseId || phases[0]?.id || '');
    setNewTaskListName('');
    setNewTaskListDesc('');
    setShowAddTaskListModal(true);
  };

  const handleCloseAddTaskList = () => {
    setShowAddTaskListModal(false);
    setTaskListCreationContext(null);
  };

  const handleCreateTaskSubmit = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    if (!newTaskAccountable) {
      showToast('An Owner is required.', 'error');
      return;
    }

    setAddingTask(true);
    try {
      const target = resolveTaskParentIds(
        taskCreationContext,
        newTaskPhaseId,
        newTaskTaskListId
      );
      const { error: createErr } = await createTask({
        title: newTaskTitle.trim(),
        description: newTaskDesc.trim(),
        phase_id: target.phaseId || null,
        task_list_id: target.taskListId || null,
        status_id: newTaskStatus || statuses?.[0]?.id,
        priority: newTaskPriority,
        accountable_id: newTaskAccountable,
        responsible_id: newTaskResponsible || newTaskAccountable,
        due_date: newTaskDueDate || null,
      });

      if (createErr) throw createErr;

      showToast('Task created successfully with ownership and assignments', 'success');
      handleCloseAddTask();
    } catch (err) {
      console.error('Failed to create task:', err);
      showToast(err.message || 'Failed to create task', 'error');
    } finally {
      setAddingTask(false);
    }
  };

  const handleCreatePhaseSubmit = async (e) => {
    e.preventDefault();
    if (!newPhaseName.trim()) return;

    setAddingPhase(true);
    try {
      const { error: pErr } = await createPhase({
        name: newPhaseName.trim(),
        description: newPhaseDesc.trim(),
        start_date: newPhaseStart || null,
        end_date: newPhaseEnd || null,
      });

      if (pErr) throw pErr;
      showToast('Phase created', 'success');
      setNewPhaseName('');
      setNewPhaseDesc('');
      setNewPhaseStart('');
      setNewPhaseEnd('');
      setShowAddPhaseModal(false);
    } catch (err) {
      showToast(err.message || 'Failed to create phase', 'error');
    } finally {
      setAddingPhase(false);
    }
  };

  const handleCreateTaskListSubmit = async (e) => {
    e.preventDefault();
    if (!newTaskListName.trim() || !newTaskListPhaseId) return;

    setAddingTaskList(true);
    try {
      const targetPhaseId = resolveTaskListParentId(
        taskListCreationContext,
        newTaskListPhaseId
      );
      const { error: tlErr } = await createTaskList({
        phaseId: targetPhaseId,
        name: newTaskListName.trim(),
        description: newTaskListDesc.trim(),
      });

      if (tlErr) throw tlErr;
      showToast('Task list created', 'success');
      setNewTaskListName('');
      setNewTaskListDesc('');
      handleCloseAddTaskList();
    } catch (err) {
      showToast(err.message || 'Failed to create task list', 'error');
    } finally {
      setAddingTaskList(false);
    }
  };

  const handleDeletePhaseClick = async (phase) => {
    if (confirm(`Delete phase "${phase.name}"? This is only allowed if it contains no tasks or task lists.`)) {
      const { error: delErr } = await deletePhase(phase.id);
      if (delErr) {
        showToast(delErr.message || 'Cannot delete phase with existing task lists or tasks', 'error');
      } else {
        showToast('Phase deleted', 'success');
      }
    }
  };

  const handleDeleteTaskListClick = async (taskList) => {
    if (confirm(`Delete task list "${taskList.name}"? This is only allowed if it contains no tasks.`)) {
      const { error: delErr } = await deleteTaskList(taskList.id);
      if (delErr) {
        showToast(delErr.message || 'Cannot delete task list with existing tasks', 'error');
      } else {
        showToast('Task list deleted', 'success');
      }
    }
  };

  /* ── Synchronize normalized board tasks from filtered tasks ── */
  useEffect(() => {
    if (activeId) return;
    setBoardTasks(buildBoardState(filteredTasks, statuses));
  }, [filteredTasks, statuses, activeId, projectId]);

  const findContainer = useCallback(
    (id, currentBoard = boardTasks) => {
      if (!id || !currentBoard) return null;
      if (id in currentBoard) return id;
      return (
        Object.keys(currentBoard).find((key) =>
          (currentBoard[key] || []).some((t) => t.id === id)
        ) || null
      );
    },
    [boardTasks]
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }
  }, []);

  /* ── Drag & Drop Handlers (Kanban) ── */
  const handleDragStart = useCallback(
    (event) => {
      if (!canMutateTasks) return;
      const { active } = event;
      setActiveId(active.id);
      boardSnapshotRef.current = JSON.parse(JSON.stringify(boardTasks));
      initialContainerRef.current = findContainer(active.id, boardTasks);
    },
    [boardTasks, canMutateTasks, findContainer]
  );

  const handleDragMove = useCallback((event) => {
    const container = boardScrollRef.current;
    if (!container) return;

    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }

    const pointerX = event.pointerCoordinates?.x;
    if (pointerX == null) return;

    const rect = container.getBoundingClientRect();
    const leftEdgeZone = rect.left + 90;
    const rightEdgeZone = rect.right - 90;

    let speed = 0;
    if (pointerX < leftEdgeZone) {
      const intensity = Math.min(1, Math.max(0.1, (leftEdgeZone - pointerX) / 90));
      speed = -Math.round(18 * intensity);
    } else if (pointerX > rightEdgeZone) {
      const intensity = Math.min(1, Math.max(0.1, (pointerX - rightEdgeZone) / 90));
      speed = Math.round(18 * intensity);
    }

    if (speed !== 0) {
      const scrollStep = () => {
        if (boardScrollRef.current) {
          boardScrollRef.current.scrollLeft += speed;
          autoScrollAnimationRef.current = requestAnimationFrame(scrollStep);
        }
      };
      autoScrollAnimationRef.current = requestAnimationFrame(scrollStep);
    }
  }, []);

  const handleDragOver = useCallback(
    (event) => {
      const { active, over } = event;
      if (!over || !canMutateTasks) return;

      const activeTaskId = active.id;
      const overId = over.id;

      if (activeTaskId === overId) return;

      setBoardTasks((prev) => {
        const activeContainer = findContainer(activeTaskId, prev);
        const overContainer = findContainer(overId, prev);

        if (!activeContainer || !overContainer || activeContainer === overContainer) {
          return prev;
        }

        const activeItems = prev[activeContainer] || [];
        const overItems = prev[overContainer] || [];

        const activeIndex = activeItems.findIndex((t) => t.id === activeTaskId);
        if (activeIndex === -1) return prev;

        const activeTask = activeItems[activeIndex];

        // Defined Process Task cross-column DnD guard
        if (activeTask?.process_step_id && activeContainer !== overContainer) {
          return prev; // Do not visually drag cross-column for defined tasks
        }

        let newIndex;
        if (overId in prev) {
          // Dropped directly on column droppable / empty zone
          newIndex = overItems.length;
        } else {
          const overIndex = overItems.findIndex((t) => t.id === overId);
          if (overIndex === -1) {
            newIndex = overItems.length;
          } else {
            const isBelowOverItem =
              active.rect.current.translated &&
              over.rect &&
              active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
            newIndex = isBelowOverItem ? overIndex + 1 : overIndex;
          }
        }

        return {
          ...prev,
          [activeContainer]: activeItems.filter((t) => t.id !== activeTaskId),
          [overContainer]: [
            ...overItems.slice(0, newIndex),
            activeTask,
            ...overItems.slice(newIndex),
          ],
        };
      });
    },
    [canMutateTasks, findContainer]
  );

  const handleDragEnd = useCallback(
    async (event) => {
      stopAutoScroll();
      const { active, over } = event;
      setActiveId(null);

      if (!over || !canMutateTasks) {
        if (boardSnapshotRef.current) {
          setBoardTasks(boardSnapshotRef.current);
        }
        return;
      }

      const activeTaskId = active.id;
      const overId = over.id;

      setBoardTasks((currentBoard) => {
        const activeContainer = findContainer(activeTaskId, currentBoard);
        const overContainer = findContainer(overId, currentBoard);

        if (!activeContainer || !overContainer) {
          if (boardSnapshotRef.current) return boardSnapshotRef.current;
          return currentBoard;
        }

        let finalBoard = { ...currentBoard };

        if (activeContainer === overContainer) {
          const items = currentBoard[activeContainer] || [];
          const activeIndex = items.findIndex((t) => t.id === activeTaskId);
          const overIndex = items.findIndex((t) => t.id === overId);

          if (activeIndex !== overIndex && activeIndex !== -1 && overIndex !== -1) {
            finalBoard = {
              ...currentBoard,
              [activeContainer]: arrayMove(items, activeIndex, overIndex),
            };
          }
        }

        const destStatus = statuses.find((s) => {
          const code = getStatusSystemCode(s);
          return code === activeContainer || s.id === activeContainer;
        });

        if (!destStatus) {
          if (boardSnapshotRef.current) return boardSnapshotRef.current;
          return currentBoard;
        }

        const initialSnapshot = boardSnapshotRef.current;
        const initialContainer = initialContainerRef.current;
        const initialItems = initialSnapshot?.[initialContainer] || [];
        const initialIndex = initialItems.findIndex((t) => t.id === activeTaskId);

        const currentItems = finalBoard[activeContainer] || [];
        const currentIndex = currentItems.findIndex((t) => t.id === activeTaskId);

        const hasChanged = initialContainer !== activeContainer || initialIndex !== currentIndex;

        if (hasChanged) {
          const movedTask = tasks.find((t) => t.id === activeTaskId);
          const initialStatusId = movedTask ? movedTask.status_id : destStatus.id;
          const isSameColumn = initialStatusId === destStatus.id;

          // Reject cross-status drag for Defined tasks
          if (movedTask?.process_step_id && !isSameColumn) {
            showToast('Status controlled by Defined Process workflow', 'error');
            if (boardSnapshotRef.current) return boardSnapshotRef.current;
            return currentBoard;
          }

          let fullSourceTaskIds = [];
          let fullDestinationTaskIds = [];

          if (isSameColumn) {
            const allInStatus = tasks
              .filter((t) => t.status_id === destStatus.id)
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            const visibleOrderedIds = currentItems.map((t) => t.id);
            const visibleSet = new Set(visibleOrderedIds);
            let vIdx = 0;
            for (const t of allInStatus) {
              if (visibleSet.has(t.id)) {
                fullDestinationTaskIds.push(visibleOrderedIds[vIdx++]);
              } else {
                fullDestinationTaskIds.push(t.id);
              }
            }
            while (vIdx < visibleOrderedIds.length) {
              fullDestinationTaskIds.push(visibleOrderedIds[vIdx++]);
            }
            fullSourceTaskIds = fullDestinationTaskIds;
          } else {
            // Cross-column move
            // 1. Source column (remaining tasks)
            const allInSource = tasks
              .filter((t) => t.status_id === initialStatusId && t.id !== activeTaskId)
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            const initialVisibleItems = finalBoard[initialContainer] || [];
            const visibleSourceOrderedIds = initialVisibleItems
              .filter((t) => t.id !== activeTaskId)
              .map((t) => t.id);
            const visibleSourceSet = new Set(visibleSourceOrderedIds);
            let vsIdx = 0;
            for (const t of allInSource) {
              if (visibleSourceSet.has(t.id)) {
                fullSourceTaskIds.push(visibleSourceOrderedIds[vsIdx++]);
              } else {
                fullSourceTaskIds.push(t.id);
              }
            }
            while (vsIdx < visibleSourceOrderedIds.length) {
              fullSourceTaskIds.push(visibleSourceOrderedIds[vsIdx++]);
            }

            // 2. Destination column (with moved task included)
            const allInDest = tasks
              .filter((t) => t.status_id === destStatus.id && t.id !== activeTaskId)
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            const visibleDestOrderedIds = currentItems.map((t) => t.id);

            const destResult = [];
            for (const vId of visibleDestOrderedIds) {
              destResult.push(vId);
            }
            const destSet = new Set(destResult);
            for (const t of allInDest) {
              if (!destSet.has(t.id)) {
                destResult.push(t.id);
              }
            }
            fullDestinationTaskIds = destResult;
          }

          (async () => {
            try {
              const { error: rpcErr } = await reorderTask(
                activeTaskId,
                destStatus.id,
                fullSourceTaskIds,
                fullDestinationTaskIds
              );
              if (rpcErr) throw rpcErr;
            } catch (err) {
              console.error('Failed to persist task reorder:', err);
              if (boardSnapshotRef.current) {
                setBoardTasks(boardSnapshotRef.current);
              }
              showToast('Unable to move task. Changes were restored.', 'error');
            }
          })();
        }

        return finalBoard;
      });
    },
    [canMutateTasks, findContainer, reorderTask, showToast, statuses, stopAutoScroll, tasks]
  );

  const handleDragCancel = useCallback(() => {
    stopAutoScroll();
    setActiveId(null);
    if (boardSnapshotRef.current) {
      setBoardTasks(boardSnapshotRef.current);
    }
  }, [stopAutoScroll]);

  const handleMoveStatus = useCallback(
    async (taskId, targetStatusId) => {
      if (!canMutateTasks) return;
      const targetStatus = statuses.find((s) => s.id === targetStatusId);
      if (!targetStatus) return;

      const movedTask = tasks.find((t) => t.id === taskId);
      if (!movedTask || movedTask.status_id === targetStatusId) return;

      const sourceTasks = tasks
        .filter((t) => t.status_id === movedTask.status_id && t.id !== taskId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((t) => t.id);

      const destTasks = [
        ...tasks
          .filter((t) => t.status_id === targetStatusId && t.id !== taskId)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((t) => t.id),
        taskId,
      ];

      try {
        const { error: rpcErr } = await reorderTask(taskId, targetStatusId, sourceTasks, destTasks);
        if (rpcErr) throw rpcErr;
        showToast(`Task moved to ${targetStatus.name}`, 'success');
      } catch (err) {
        console.error('Failed to move task status:', err);
        showToast('Failed to update task status', 'error');
      }
    },
    [canMutateTasks, reorderTask, showToast, statuses, tasks]
  );

  const activeTask = useMemo(
    () => (activeId ? tasks.find((t) => t.id === activeId) : null),
    [activeId, tasks]
  );

  const isInitialLoading =
    (tasksLoading && tasks.length === 0) ||
    (statusesLoading && statuses.length === 0) ||
    (phasesLoading && phases.length === 0) ||
    (taskListsLoading && taskLists.length === 0) ||
    (processInstancesLoading && processInstances.length === 0);

  return (
    <div className={styles.page}>
      {/* Project Command Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            className={styles.backBtn}
            onClick={() => navigate(`/workspace/${workspaceId}/projects`)}
            aria-label="Back to projects"
          >
            <ChevronLeft size={18} />
          </button>

          <div className={styles.titleWrap}>
            <div className={styles.titleRow}>
              <span
                className={styles.colorDot}
                style={{ background: project?.color || 'var(--yellow)' }}
              />
              <h1 className={styles.projectName}>{project?.name || 'Project'}</h1>
              {project?.project_status && (
                <span className={`${styles.statusPill} ${styles[`status_${project.project_status}`]}`}>
                  {project.project_status}
                </span>
              )}
              {project?.project_priority && (
                <span className={`${styles.priorityPill} ${styles[`priority_${project.project_priority}`]}`}>
                  {project.project_priority}
                </span>
              )}
            </div>

            {project?.description && (
              <p className={styles.projectDesc}>{project.description}</p>
            )}

            <div className={styles.projectMetaRow}>
              {project?.owner && (
                <div className={styles.metaItem}>
                  <User size={13} />
                  <span>Owner: <strong>{project.owner.full_name}</strong></span>
                </div>
              )}
              {project?.target_end_date && (
                <div className={styles.metaItem}>
                  <Calendar size={13} />
                  <span>Target: <strong>{project.target_end_date}</strong></span>
                </div>
              )}
              <div className={styles.metaItem}>
                <span>Project Progress: <strong>{project?.progress || 0}%</strong></span>
              </div>
              <div className={styles.metaItem}>
                <Layers size={13} />
                <span>{phases.length} Phases, {taskLists.length} Task Lists</span>
              </div>
            </div>
          </div>
        </div>

        {/* View Toggle & Actions */}
        <div className={styles.headerRight}>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${view === 'hierarchy' ? styles.viewActive : ''}`}
              onClick={() => setView('hierarchy')}
              aria-label="Hierarchy view"
            >
              <Layers size={15} />
              <span>Hierarchy</span>
            </button>
            <button
              className={`${styles.viewBtn} ${view === 'kanban' ? styles.viewActive : ''}`}
              onClick={() => setView('kanban')}
              aria-label="Kanban view"
            >
              <Kanban size={15} />
              <span>Board</span>
            </button>
            <button
              className={`${styles.viewBtn} ${view === 'list' ? styles.viewActive : ''}`}
              onClick={() => setView('list')}
              aria-label="List view"
            >
              <List size={15} />
              <span>List</span>
            </button>
          </div>

          <div className={styles.actionButtons}>
            <button
              className={styles.secondaryActionBtn}
              onClick={() => setShowAddPhaseModal(true)}
              title="Create Phase"
            >
              <BookmarkPlus size={15} />
              <span>+ Phase</span>
            </button>
            <button
              className={styles.secondaryActionBtn}
              onClick={() => handleOpenAddTaskList()}
              title="Create Task List"
              disabled={phases.length === 0}
            >
              <FolderPlus size={15} />
              <span>+ Task List</span>
            </button>
            <button
              className={styles.addBtn}
              onClick={() => handleOpenAddTask()}
            >
              <Plus size={16} />
              <span>Add Task</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter / Search Bar (For Kanban and List views) */}
      {view !== 'hierarchy' && (
        <div className={styles.filterBar}>
          <div className={styles.searchBox}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search tasks in this project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.filters}>
            <select
              className={styles.filterSelect}
              value={filterPhase}
              onChange={(e) => {
                setFilterPhase(e.target.value);
                setFilterTaskList('');
              }}
            >
              <option value="">All Phases</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              className={styles.filterSelect}
              value={filterTaskList}
              onChange={(e) => setFilterTaskList(e.target.value)}
            >
              <option value="">All Task Lists</option>
              {kanbanAvailableTaskLists.map((tl) => (
                <option key={tl.id} value={tl.id}>
                  {tl.name}
                </option>
              ))}
            </select>

            <select
              className={styles.filterSelect}
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              <option value="">All Priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>

            <select
              className={styles.filterSelect}
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
            >
              <option value="">All Personnel</option>
              {members.map((m) => (
                <option key={m.id} value={m.user_id || ''}>
                  {getMemberDisplayName(m, user)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {hierarchyError && (
        <div className={styles.errorBanner} role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>Some project data could not be loaded.</strong>
            <span>{hierarchyError}</span>
          </div>
        </div>
      )}

      {isInitialLoading ? (
        view === 'kanban' ? <CardGridSkeleton count={5} /> : <TaskRowSkeleton count={5} />
      ) : (
        <>
          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* 1. HIERARCHY / TREE VIEW (Canonical Business View)               */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {view === 'hierarchy' && (
        <div className={styles.hierarchyView}>
          {projectProcesses.length > 0 && (
            <section className={styles.placementProcessSection}>
              <div className={styles.placementProcessHeading}>
                <Workflow size={15} />
                <span>Project Processes</span>
              </div>
              <HierarchyProcessGroups
                processes={projectProcesses}
                tasks={tasks.filter(
                  (task) => task.process_instance_id && projectProcesses.some((item) => item.id === task.process_instance_id)
                )}
                onTaskOpen={setSelectedTask}
              />
            </section>
          )}

          {/* Phases Tree */}
          {phases.length === 0 && uncategorizedTasks.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No Phases configured"
              description="Create phases and task lists to organize project execution into structured deliverables."
              actionLabel="Create First Phase"
              onAction={() => setShowAddPhaseModal(true)}
            />
          ) : (
            <div className={styles.phasesList}>
              {phases.map((phase) => {
                const isPhaseCollapsed = collapsedPhases.has(phase.id);
                const phaseTaskLists = taskLists.filter((tl) => tl.phase_id === phase.id);
                const phaseProcesses = getPlacementProcesses(processInstances, 'phase', phase.id);
                const phaseProcessTasks = tasks.filter(
                  (task) => task.process_instance_id && phaseProcesses.some((item) => item.id === task.process_instance_id)
                );

                return (
                  <div key={phase.id} className={styles.phaseCard}>
                    {/* Phase Accordion Header */}
                    <div className={styles.phaseHeader}>
                      <button
                        type="button"
                        className={styles.collapseToggle}
                        onClick={() => togglePhaseCollapse(phase.id)}
                      >
                        {isPhaseCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>

                      <div className={styles.phaseMain}>
                        <div className={styles.phaseTitleRow}>
                          <span className={styles.phaseTag}>Phase</span>
                          <h3 className={styles.phaseName}>{phase.name}</h3>
                          {phase.end_date && (
                            <span className={styles.phaseDate}>
                              <Calendar size={12} />
                              Target: {phase.end_date}
                            </span>
                          )}
                        </div>
                        {phase.description && (
                          <p className={styles.phaseDesc}>{phase.description}</p>
                        )}
                      </div>

                      {/* Phase Progress Bar */}
                      <div className={styles.phaseProgressWrap}>
                        <div className={styles.progressTop}>
                          <span className={styles.progressLabel}>Progress</span>
                          <span className={styles.progressPercent}>{phase.progress}%</span>
                        </div>
                        <div className={styles.progressBar}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${phase.progress}%` }}
                          />
                        </div>
                        <span className={styles.taskCountSubtitle}>
                          {phase.completed_count}/{phase.task_count} tasks
                        </span>
                      </div>

                      {/* Actions */}
                      <div className={styles.phaseActions}>
                        <button
                          type="button"
                          className={styles.contextAddBtn}
                          onClick={() => handleOpenAddTaskList(phase)}
                          title="Add Task List"
                          aria-label="Add Task List"
                        >
                          <Plus size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={styles.deletePhaseBtn}
                          onClick={() => handleDeletePhaseClick(phase)}
                          title="Delete Phase (if empty)"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Phase Body: Task Lists */}
                    {!isPhaseCollapsed && (
                      <div className={styles.phaseBody}>
                        {phaseProcesses.length > 0 && (
                          <section className={styles.nestedProcessSection}>
                            <div className={styles.placementProcessHeading}>
                              <Workflow size={14} />
                              <span>Phase Processes</span>
                            </div>
                            <HierarchyProcessGroups
                              processes={phaseProcesses}
                              tasks={phaseProcessTasks}
                              onTaskOpen={setSelectedTask}
                            />
                          </section>
                        )}
                        {phaseTaskLists.length === 0 ? (
                          <div className={styles.emptyTaskListNotice}>
                            <span>No task lists in this phase.</span>
                            <button
                              type="button"
                              onClick={() => handleOpenAddTaskList(phase)}
                              className={styles.inlineAddLink}
                            >
                              + Create Task List
                            </button>
                          </div>
                        ) : (
                          phaseTaskLists.map((taskList) => {
                            const isTaskListCollapsed = collapsedTaskLists.has(taskList.id);
                            const listTasks = tasks.filter((t) => t.task_list_id === taskList.id);
                            const taskListProcesses = getPlacementProcesses(
                              processInstances,
                              'task_list',
                              taskList.id
                            );

                            return (
                              <div key={taskList.id} className={styles.taskListCard}>
                                {/* Task List Header */}
                                <div className={styles.taskListHeader}>
                                  <button
                                    type="button"
                                    className={styles.collapseToggle}
                                    onClick={() => toggleTaskListCollapse(taskList.id)}
                                  >
                                    {isTaskListCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                  </button>

                                  <div className={styles.taskListMain}>
                                    <div className={styles.taskListTitleRow}>
                                      {taskList.task_list_type === 'defined' ? (
                                        <span className={styles.definedListTag}>
                                          <Workflow size={11} /> Defined Process
                                        </span>
                                      ) : (
                                        <span className={styles.taskListTag}>Task List</span>
                                      )}
                                      <h4 className={styles.taskListName}>{taskList.name}</h4>
                                      {taskList.task_list_type === 'defined' && (
                                        <span
                                          className={
                                            taskList.process_state === 'completed'
                                              ? styles.procDonePill
                                              : styles.procActivePill
                                          }
                                        >
                                          {taskList.process_state === 'completed' ? 'Completed' : 'Active'}
                                        </span>
                                      )}
                                      <span className={styles.taskListTaskCount}>
                                        ({taskList.completed_count}/{taskList.task_count} completed)
                                      </span>
                                    </div>
                                    {taskList.description && (
                                      <p className={styles.taskListDesc}>{taskList.description}</p>
                                    )}
                                  </div>

                                  <div className={styles.taskListProgressBar}>
                                    <div
                                      className={styles.taskListProgressFill}
                                      style={{ width: `${taskList.progress}%` }}
                                    />
                                  </div>
                                  <span className={styles.taskListPercent}>{taskList.progress}%</span>

                                  <div className={styles.taskListActions}>
                                    {taskList.task_list_type === 'defined' ? (
                                      <button
                                        type="button"
                                        className={styles.viewProcessBtn}
                                        onClick={() =>
                                          navigate(
                                            `/workspace/${workspaceId}/project/${projectId}/process/${taskList.id}`
                                          )
                                        }
                                      >
                                        <Workflow size={13} /> View Process
                                      </button>
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          className={styles.contextAddBtn}
                                          onClick={() => handleOpenAddTask({ phase, taskList })}
                                          title="Add Task"
                                          aria-label="Add Task"
                                        >
                                          <Plus size={15} aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          className={styles.deleteTaskListBtn}
                                          onClick={() => handleDeleteTaskListClick(taskList)}
                                          title="Delete Task List (if empty)"
                                        >
                                          Delete
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* Task List Tasks Table */}
                                {!isTaskListCollapsed && (
                                  <div className={styles.taskListBody}>
                                    <HierarchyProcessGroups
                                      processes={taskListProcesses}
                                      tasks={listTasks}
                                      onTaskOpen={setSelectedTask}
                                    />
                                    <HierarchyTaskTree
                                      tasks={listTasks}
                                      processInstances={processInstances}
                                      onTaskOpen={setSelectedTask}
                                      emptyMessage={
                                        taskListProcesses.length > 0
                                          ? 'No ordinary tasks in this list.'
                                          : 'No tasks in this list. Use the + button above to create one.'
                                      }
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* UNCATEGORIZED TASKS (Legacy Compatibility Section)           */}
          {/* ═════════════════════════════════════════════════════════════ */}
          {uncategorizedTasks.length > 0 && (
            <div className={styles.uncategorizedCard}>
              <div className={styles.uncategorizedHeader}>
                <div className={styles.uncategorizedTitleWrap}>
                  <AlertCircle size={16} className={styles.uncategorizedIcon} />
                  <h3 className={styles.uncategorizedTitle}>Uncategorized Tasks</h3>
                  <span className={styles.uncategorizedBadge}>
                    {uncategorizedTasks.length} legacy task{uncategorizedTasks.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className={styles.uncategorizedHint}>
                  Legacy tasks without phase assignments. Open task details to categorize into phases and task lists.
                </p>
              </div>

              <HierarchyTaskTree
                tasks={tasks.filter((task) => !task.phase_id && !task.task_list_id)}
                processInstances={processInstances}
                onTaskOpen={setSelectedTask}
              />
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* 2. KANBAN BOARD VIEW                                             */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      {view === 'kanban' && (
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          autoScroll={false}
        >
          <div className={styles.board} ref={boardScrollRef}>
            {statuses.map((status) => {
              const code = getStatusSystemCode(status);
              const colTasks = boardTasks[code] || [];

              return (
                <KanbanColumn
                  key={status.id}
                  status={status}
                  tasks={colTasks}
                  onTaskClick={(task) => setSelectedTask(task)}
                  onAddTask={(statusId) => handleOpenAddTask('', '', statusId)}
                  disabled={!canMutateTasks}
                  statuses={statuses}
                  onMoveStatus={handleMoveStatus}
                />
              );
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <div style={{ width: 280 }}>
                <TaskCard
                  task={activeTask}
                  isDragging={false}
                  isOverlay={true}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* 3. TABULAR LIST VIEW                                             */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      {view === 'list' && (
        <div className={styles.listView}>
          {sortedTasks.length === 0 ? (
            <EmptyState
              icon={List}
              title="No tasks found"
              description="Adjust your phase/task list filters or create a new task."
            />
          ) : (
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th onClick={() => handleSort('title')} className={`${styles.sortableHeader} ${styles.colHeaderTitle}`}>
                      Title
                    </th>
                    <th className={styles.colHeaderStatus}>Status</th>
                    <th className={styles.colHeaderPriority}>Priority</th>
                    <th className={styles.colHeaderRaci}>Ownership & Assignment</th>
                    <th onClick={() => handleSort('due_date')} className={`${styles.sortableHeader} ${styles.colHeaderDate}`}>
                      Due Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onClick={() => setSelectedTask(task)}
                      showHierarchy
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )}

      {/* ───── Task Detail Slide-in Panel with Subtasks & RACI ───── */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onSave={async (updatedTask) => {
            const { error: uErr } = await updateTask(updatedTask.id, updatedTask);
            if (uErr) {
              showToast(uErr.message || 'Failed to update task', 'error');
            } else {
              showToast('Task updated', 'success');
              setSelectedTask(null);
            }
          }}
          onDelete={async (taskId) => {
            const { error: deleteError } = await deleteTask(taskId);
            if (deleteError) {
              showToast(deleteError.message || 'Failed to delete task', 'error');
              return;
            }
            showToast('Task deleted', 'success');
            setSelectedTask(null);
          }}
          statuses={statuses}
          members={members}
          departments={departments}
          onSubtasksChange={() => refetchTasks({ silent: true })}
        />
      )}

      {/* ───── Create Phase Modal ───── */}
      <Modal
        isOpen={showAddPhaseModal}
        onClose={() => setShowAddPhaseModal(false)}
        title="Create Phase"
      >
        <form onSubmit={handleCreatePhaseSubmit}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="phaseName">
              Phase Name
            </label>
            <input
              id="phaseName"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Design Freeze & Mechanical Sign-off"
              value={newPhaseName}
              onChange={(e) => setNewPhaseName(e.target.value)}
              required
              autoFocus
              disabled={addingPhase}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="phaseDesc">
              Description & Key Objectives
            </label>
            <textarea
              id="phaseDesc"
              className={styles.modalTextarea}
              placeholder="Define phase scope, deliverables, and completion criteria…"
              value={newPhaseDesc}
              onChange={(e) => setNewPhaseDesc(e.target.value)}
              rows={3}
              disabled={addingPhase}
            />
          </div>

          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="phaseStart">
                Start Date
              </label>
              <input
                id="phaseStart"
                type="date"
                className={styles.modalInput}
                value={newPhaseStart}
                onChange={(e) => setNewPhaseStart(e.target.value)}
                disabled={addingPhase}
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="phaseEnd">
                Target End Date
              </label>
              <input
                id="phaseEnd"
                type="date"
                className={styles.modalInput}
                value={newPhaseEnd}
                onChange={(e) => setNewPhaseEnd(e.target.value)}
                disabled={addingPhase}
              />
            </div>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setShowAddPhaseModal(false)}
              disabled={addingPhase}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={addingPhase || !newPhaseName.trim()}
            >
              {addingPhase ? 'Creating…' : 'Create Phase'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ───── Create Task List Modal ───── */}
      <Modal
        isOpen={showAddTaskListModal}
        onClose={handleCloseAddTaskList}
        title="Create Task List"
      >
        <form onSubmit={handleCreateTaskListSubmit}>
          {taskListCreationContext ? (
            <div className={styles.contextSummary} role="note" aria-label="Locked creation context">
              <div className={styles.contextSummaryHeader}>
                <LockKeyhole size={14} aria-hidden="true" />
                <span>Creating inside selected Phase</span>
              </div>
              <div className={styles.contextPath}>
                <span className={styles.contextKind}>Phase</span>
                <strong>{taskListCreationContext.phaseName}</strong>
              </div>
            </div>
          ) : (
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="parentPhase">
                Parent Phase
              </label>
              <select
                id="parentPhase"
                className={styles.modalSelect}
                value={newTaskListPhaseId}
                onChange={(e) => setNewTaskListPhaseId(e.target.value)}
                required
                disabled={addingTaskList}
              >
                <option value="">Select Phase…</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="taskListName">
              Task List Name
            </label>
            <input
              id="taskListName"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Mechanical Drawings & BOM"
              value={newTaskListName}
              onChange={(e) => setNewTaskListName(e.target.value)}
              required
              autoFocus
              disabled={addingTaskList}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="taskListDesc">
              Description
            </label>
            <textarea
              id="taskListDesc"
              className={styles.modalTextarea}
              placeholder="Task list scope and grouping notes…"
              value={newTaskListDesc}
              onChange={(e) => setNewTaskListDesc(e.target.value)}
              rows={2}
              disabled={addingTaskList}
            />
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={handleCloseAddTaskList}
              disabled={addingTaskList}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={addingTaskList || !newTaskListName.trim() || !newTaskListPhaseId}
            >
              {addingTaskList ? 'Creating…' : 'Create Task List'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ───── Create Task Modal (with Cascading Hierarchy & Mandatory RACI) ───── */}
      <Modal isOpen={showAddTaskModal} onClose={handleCloseAddTask} title="New Task" size="lg">
        <form onSubmit={handleCreateTaskSubmit}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="taskTitle">
              Task Title
            </label>
            <input
              id="taskTitle"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Design CAD layout for conveyor assembly"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              required
              autoFocus
              disabled={addingTask}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="taskDesc">
              Description
            </label>
            <textarea
              id="taskDesc"
              className={styles.modalTextarea}
              placeholder="Task deliverables, acceptance criteria, and notes…"
              value={newTaskDesc}
              onChange={(e) => setNewTaskDesc(e.target.value)}
              rows={2}
              disabled={addingTask}
            />
          </div>

          {/* Cascading Hierarchy Selection */}
          {taskCreationContext ? (
            <div className={styles.contextSummary} role="note" aria-label="Locked creation context">
              <div className={styles.contextSummaryHeader}>
                <LockKeyhole size={14} aria-hidden="true" />
                <span>Creating inside selected Task List</span>
              </div>
              <div className={styles.contextPath}>
                <span><span className={styles.contextKind}>Project</span>{taskCreationContext.projectName}</span>
                <ChevronRight size={14} aria-hidden="true" />
                <span><span className={styles.contextKind}>Phase</span>{taskCreationContext.phaseName}</span>
                <ChevronRight size={14} aria-hidden="true" />
                <span><span className={styles.contextKind}>Task List</span>{taskCreationContext.taskListName}</span>
              </div>
            </div>
          ) : (
          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="taskPhase">
                Phase
              </label>
              <select
                id="taskPhase"
                className={styles.modalSelect}
                value={newTaskPhaseId}
                onChange={(e) => {
                  setNewTaskPhaseId(e.target.value);
                  setNewTaskTaskListId('');
                }}
                disabled={addingTask}
              >
                <option value="">None (Uncategorized Task)</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="taskTaskList">
                Task List
              </label>
              <select
                id="taskTaskList"
                className={styles.modalSelect}
                value={newTaskTaskListId}
                onChange={(e) => setNewTaskTaskListId(e.target.value)}
                disabled={addingTask || !newTaskPhaseId}
                required={!!newTaskPhaseId}
              >
                <option value="">
                  {!newTaskPhaseId ? 'Select Phase first…' : 'Select Task List…'}
                </option>
                {availableTaskListsForSelectedPhase.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          )}

          {/* Mandatory RACI Selection */}
          <div className={styles.raciInputBox}>
            <span className={styles.raciBoxTitle}>Ownership & Assignment</span>
            <div className={styles.modalRow}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel} htmlFor="taskAccountable">
                  Owner <span className={styles.reqStar}>*</span>
                </label>
                <select
                  id="taskAccountable"
                  className={styles.modalSelect}
                  value={newTaskAccountable}
                  onChange={(e) => {
                    setNewTaskAccountable(e.target.value);
                    if (!newTaskResponsible) setNewTaskResponsible(e.target.value);
                  }}
                  required
                  disabled={addingTask}
                >
                  <option value="">Select Owner…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.user_id || ''}>
                      {getMemberDisplayName(m, user)}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.modalField}>
                <label className={styles.modalLabel} htmlFor="taskResponsible">
                  Assignee <span className={styles.reqStar}>*</span>
                </label>
                <select
                  id="taskResponsible"
                  className={styles.modalSelect}
                  value={newTaskResponsible}
                  onChange={(e) => setNewTaskResponsible(e.target.value)}
                  required
                  disabled={addingTask}
                >
                  <option value="">Select Assignee…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.user_id || ''}>
                      {getMemberDisplayName(m, user)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Status, Priority & Due Date */}
          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="taskStatus">
                Status
              </label>
              <select
                id="taskStatus"
                className={styles.modalSelect}
                value={newTaskStatus}
                onChange={(e) => setNewTaskStatus(e.target.value)}
                disabled={addingTask}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="taskPriority">
                Priority
              </label>
              <select
                id="taskPriority"
                className={styles.modalSelect}
                value={newTaskPriority}
                onChange={(e) => setNewTaskPriority(e.target.value)}
                disabled={addingTask}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="taskDue">
                Due Date
              </label>
              <input
                id="taskDue"
                type="date"
                className={styles.modalInput}
                value={newTaskDueDate}
                onChange={(e) => setNewTaskDueDate(e.target.value)}
                disabled={addingTask}
              />
            </div>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={handleCloseAddTask}
              disabled={addingTask}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={addingTask || !newTaskTitle.trim() || !newTaskAccountable}
            >
              {addingTask ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
