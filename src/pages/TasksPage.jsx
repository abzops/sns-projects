import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTasks } from '../hooks/useTasks';
import { useTaskStatuses } from '../hooks/useTaskStatuses';
import { useMembers } from '../hooks/useMembers';
import { useProjects } from '../hooks/useProjects';
import { useDepartments } from '../hooks/useDepartments';
import { useMilestones } from '../hooks/useMilestones';
import { useTaskLists } from '../hooks/useTaskLists';
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
} from 'lucide-react';

import TaskRow from '../components/TaskRow';
import TaskCard from '../components/TaskCard';
import TaskDetailPanel from '../components/TaskDetailPanel';
import Modal from '../components/Modal';
import { TaskRowSkeleton, CardGridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

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

  const { tasks = [], loading: tasksLoading, createTask, updateTask, deleteTask, reorderTask } =
    useTasks(projectId, workspaceId);
  const { statuses = [], loading: statusesLoading } = useTaskStatuses(projectId);
  const { members = [] } = useMembers(workspaceId);
  const { projects = [] } = useProjects(workspaceId);
  const { departments = [] } = useDepartments(workspaceId);
  const {
    milestones = [],
    loading: milestonesLoading,
    createMilestone,
    deleteMilestone,
  } = useMilestones(projectId);
  const {
    taskLists = [],
    loading: taskListsLoading,
    createTaskList,
    deleteTaskList,
  } = useTaskLists(projectId);

  const project = projects?.find((p) => p.id === projectId);

  // User context & task mutation permissions
  const {
    workspaceRole,
    isAdmin,
    isProjectAdmin,
    isCEO,
    isCTO,
    loading: userContextLoading,
  } = useUserContext(workspaceId);

  const canMutateTasks =
    !userContextLoading &&
    (isAdmin ||
      isProjectAdmin ||
      isCEO ||
      isCTO ||
      workspaceRole === 'member' ||
      workspaceRole === 'owner' ||
      workspaceRole === 'admin');

  // View state: 'hierarchy' | 'kanban' | 'list'
  const [view, setView] = useState('hierarchy');
  const [search, setSearch] = useState('');
  const [filterMilestone, setFilterMilestone] = useState('');
  const [filterTaskList, setFilterTaskList] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [sortColumn, setSortColumn] = useState('title');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedTask, setSelectedTask] = useState(null);

  // Collapsed state for Hierarchy accordion
  const [collapsedMilestones, setCollapsedMilestones] = useState(new Set());
  const [collapsedTaskLists, setCollapsedTaskLists] = useState(new Set());

  // Modals state
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddMilestoneModal, setShowAddMilestoneModal] = useState(false);
  const [showAddTaskListModal, setShowAddTaskListModal] = useState(false);

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
  const [newTaskMilestoneId, setNewTaskMilestoneId] = useState('');
  const [newTaskTaskListId, setNewTaskTaskListId] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAccountable, setNewTaskAccountable] = useState('');
  const [newTaskResponsible, setNewTaskResponsible] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  // New milestone form state
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneDesc, setNewMilestoneDesc] = useState('');
  const [newMilestoneStart, setNewMilestoneStart] = useState('');
  const [newMilestoneEnd, setNewMilestoneEnd] = useState('');
  const [addingMilestone, setAddingMilestone] = useState(false);

  // New task list form state
  const [newTaskListMilestoneId, setNewTaskListMilestoneId] = useState('');
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
  const toggleMilestoneCollapse = (milestoneId) => {
    setCollapsedMilestones((prev) => {
      const next = new Set(prev);
      if (next.has(milestoneId)) next.delete(milestoneId);
      else next.add(milestoneId);
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

  /* ── Filtered Task Lists based on selected milestone (for cascading pickers) ── */
  const availableTaskListsForSelectedMilestone = useMemo(() => {
    if (!newTaskMilestoneId) return [];
    return taskLists.filter((tl) => tl.milestone_id === newTaskMilestoneId);
  }, [taskLists, newTaskMilestoneId]);

  const kanbanAvailableTaskLists = useMemo(() => {
    if (!filterMilestone) return taskLists;
    return taskLists.filter((tl) => tl.milestone_id === filterMilestone);
  }, [taskLists, filterMilestone]);

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
    if (filterMilestone) {
      result = result.filter((t) => t.milestone_id === filterMilestone);
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
  }, [tasks, search, filterMilestone, filterTaskList, filterPriority, filterAssignee]);

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
    return tasks.filter((t) => !t.milestone_id && !t.task_list_id);
  }, [tasks]);

  /* ── Handlers ── */
  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  const handleOpenAddTask = (presetMilestoneId = '', presetTaskListId = '') => {
    setNewTaskTitle('');
    setNewTaskDesc('');
    setNewTaskMilestoneId(presetMilestoneId || (milestones[0]?.id ?? ''));
    setNewTaskTaskListId(presetTaskListId || '');
    setNewTaskStatus(statuses?.[0]?.id ?? '');
    setNewTaskPriority('medium');
    setNewTaskAccountable('');
    setNewTaskResponsible('');
    setNewTaskDueDate('');
    setShowAddTaskModal(true);
  };

  const handleCreateTaskSubmit = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    if (!newTaskAccountable) {
      showToast('Mandatory: Exactly 1 Accountable (A) user is required.', 'error');
      return;
    }

    setAddingTask(true);
    try {
      const { error: createErr } = await createTask({
        title: newTaskTitle.trim(),
        description: newTaskDesc.trim(),
        milestone_id: newTaskMilestoneId || null,
        task_list_id: newTaskTaskListId || null,
        status_id: newTaskStatus || statuses?.[0]?.id,
        priority: newTaskPriority,
        accountable_id: newTaskAccountable,
        responsible_id: newTaskResponsible || newTaskAccountable,
        due_date: newTaskDueDate || null,
      });

      if (createErr) throw createErr;

      showToast('Task created successfully with RACI assignment', 'success');
      setShowAddTaskModal(false);
    } catch (err) {
      console.error('Failed to create task:', err);
      showToast(err.message || 'Failed to create task', 'error');
    } finally {
      setAddingTask(false);
    }
  };

  const handleCreateMilestoneSubmit = async (e) => {
    e.preventDefault();
    if (!newMilestoneName.trim()) return;

    setAddingMilestone(true);
    try {
      const { error: mErr } = await createMilestone({
        name: newMilestoneName.trim(),
        description: newMilestoneDesc.trim(),
        start_date: newMilestoneStart || null,
        end_date: newMilestoneEnd || null,
      });

      if (mErr) throw mErr;
      showToast('Milestone created', 'success');
      setNewMilestoneName('');
      setNewMilestoneDesc('');
      setNewMilestoneStart('');
      setNewMilestoneEnd('');
      setShowAddMilestoneModal(false);
    } catch (err) {
      showToast(err.message || 'Failed to create milestone', 'error');
    } finally {
      setAddingMilestone(false);
    }
  };

  const handleCreateTaskListSubmit = async (e) => {
    e.preventDefault();
    if (!newTaskListName.trim() || !newTaskListMilestoneId) return;

    setAddingTaskList(true);
    try {
      const { error: tlErr } = await createTaskList({
        milestoneId: newTaskListMilestoneId,
        name: newTaskListName.trim(),
        description: newTaskListDesc.trim(),
      });

      if (tlErr) throw tlErr;
      showToast('Task list created', 'success');
      setNewTaskListName('');
      setNewTaskListDesc('');
      setShowAddTaskListModal(false);
    } catch (err) {
      showToast(err.message || 'Failed to create task list', 'error');
    } finally {
      setAddingTaskList(false);
    }
  };

  const handleDeleteMilestoneClick = async (milestone) => {
    if (confirm(`Delete milestone "${milestone.name}"? This is only allowed if it contains no tasks or task lists.`)) {
      const { error: delErr } = await deleteMilestone(milestone.id);
      if (delErr) {
        showToast(delErr.message || 'Cannot delete milestone with existing task lists or tasks', 'error');
      } else {
        showToast('Milestone deleted', 'success');
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
    (milestonesLoading && milestones.length === 0) ||
    (taskListsLoading && taskLists.length === 0);

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
                <span>{milestones.length} Milestones, {taskLists.length} Task Lists</span>
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
              onClick={() => setShowAddMilestoneModal(true)}
              title="Create Milestone"
            >
              <BookmarkPlus size={15} />
              <span>+ Milestone</span>
            </button>
            <button
              className={styles.secondaryActionBtn}
              onClick={() => {
                setNewTaskListMilestoneId(milestones[0]?.id || '');
                setShowAddTaskListModal(true);
              }}
              title="Create Task List"
              disabled={milestones.length === 0}
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
              value={filterMilestone}
              onChange={(e) => {
                setFilterMilestone(e.target.value);
                setFilterTaskList('');
              }}
            >
              <option value="">All Milestones</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
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

      {isInitialLoading ? (
        view === 'kanban' ? <CardGridSkeleton count={5} /> : <TaskRowSkeleton count={5} />
      ) : (
        <>
          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* 1. HIERARCHY / TREE VIEW (Canonical Business View)               */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {view === 'hierarchy' && (
        <div className={styles.hierarchyView}>
          {/* Milestones Tree */}
          {milestones.length === 0 && uncategorizedTasks.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No Milestones configured"
              description="Create milestones and task lists to organize project execution into structured deliverables."
              actionLabel="Create First Milestone"
              onAction={() => setShowAddMilestoneModal(true)}
            />
          ) : (
            <div className={styles.milestonesList}>
              {milestones.map((milestone) => {
                const isMilestoneCollapsed = collapsedMilestones.has(milestone.id);
                const milestoneTaskLists = taskLists.filter((tl) => tl.milestone_id === milestone.id);

                return (
                  <div key={milestone.id} className={styles.milestoneCard}>
                    {/* Milestone Accordion Header */}
                    <div className={styles.milestoneHeader}>
                      <button
                        type="button"
                        className={styles.collapseToggle}
                        onClick={() => toggleMilestoneCollapse(milestone.id)}
                      >
                        {isMilestoneCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>

                      <div className={styles.milestoneMain}>
                        <div className={styles.milestoneTitleRow}>
                          <span className={styles.milestoneTag}>Milestone</span>
                          <h3 className={styles.milestoneName}>{milestone.name}</h3>
                          {milestone.end_date && (
                            <span className={styles.milestoneDate}>
                              <Calendar size={12} />
                              Target: {milestone.end_date}
                            </span>
                          )}
                        </div>
                        {milestone.description && (
                          <p className={styles.milestoneDesc}>{milestone.description}</p>
                        )}
                      </div>

                      {/* Milestone Progress Bar */}
                      <div className={styles.milestoneProgressWrap}>
                        <div className={styles.progressTop}>
                          <span className={styles.progressLabel}>Progress</span>
                          <span className={styles.progressPercent}>{milestone.progress}%</span>
                        </div>
                        <div className={styles.progressBar}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${milestone.progress}%` }}
                          />
                        </div>
                        <span className={styles.taskCountSubtitle}>
                          {milestone.completed_count}/{milestone.task_count} tasks
                        </span>
                      </div>

                      {/* Actions */}
                      <div className={styles.milestoneActions}>
                        <button
                          type="button"
                          className={styles.addTaskListBtn}
                          onClick={() => {
                            setNewTaskListMilestoneId(milestone.id);
                            setShowAddTaskListModal(true);
                          }}
                          title="Add Task List under this Milestone"
                        >
                          <Plus size={13} /> Task List
                        </button>
                        <button
                          type="button"
                          className={styles.deleteMilestoneBtn}
                          onClick={() => handleDeleteMilestoneClick(milestone)}
                          title="Delete Milestone (if empty)"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Milestone Body: Task Lists */}
                    {!isMilestoneCollapsed && (
                      <div className={styles.milestoneBody}>
                        {milestoneTaskLists.length === 0 ? (
                          <div className={styles.emptyTaskListNotice}>
                            <span>No task lists in this milestone.</span>
                            <button
                              type="button"
                              onClick={() => {
                                setNewTaskListMilestoneId(milestone.id);
                                setShowAddTaskListModal(true);
                              }}
                              className={styles.inlineAddLink}
                            >
                              + Create Task List
                            </button>
                          </div>
                        ) : (
                          milestoneTaskLists.map((taskList) => {
                            const isTaskListCollapsed = collapsedTaskLists.has(taskList.id);
                            const listTasks = tasks.filter((t) => t.task_list_id === taskList.id);

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
                                          className={styles.addTaskInlineBtn}
                                          onClick={() => handleOpenAddTask(milestone.id, taskList.id)}
                                        >
                                          <Plus size={13} /> Add Task
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
                                    {listTasks.length === 0 ? (
                                      <p className={styles.emptyTasksNotice}>
                                        No tasks in this list. Click <strong>+ Add Task</strong> above.
                                      </p>
                                    ) : (
                                      <table className={styles.hierarchyTable}>
                                        <thead>
                                          <tr>
                                            <th>Task Name</th>
                                            <th>Status</th>
                                            <th>Priority</th>
                                            <th>RACI Responsibility</th>
                                            <th>Due Date</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {listTasks.map((task) => (
                                            <TaskRow
                                              key={task.id}
                                              task={task}
                                              onClick={() => setSelectedTask(task)}
                                            />
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
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
                  Legacy tasks without milestone assignments. Open task details to categorize into milestones and task lists.
                </p>
              </div>

              <table className={styles.hierarchyTable}>
                <thead>
                  <tr>
                    <th>Task Name</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>RACI Responsibility</th>
                    <th>Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {uncategorizedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onClick={() => setSelectedTask(task)}
                    />
                  ))}
                </tbody>
              </table>
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
              description="Adjust your milestone/task list filters or create a new task."
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
                    <th className={styles.colHeaderRaci}>RACI Assignment</th>
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
            await deleteTask(taskId);
            setSelectedTask(null);
          }}
          statuses={statuses}
          members={members}
          departments={departments}
        />
      )}

      {/* ───── Create Milestone Modal ───── */}
      <Modal
        isOpen={showAddMilestoneModal}
        onClose={() => setShowAddMilestoneModal(false)}
        title="Create Milestone"
      >
        <form onSubmit={handleCreateMilestoneSubmit}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="milestoneName">
              Milestone Name
            </label>
            <input
              id="milestoneName"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Design Freeze & Mechanical Sign-off"
              value={newMilestoneName}
              onChange={(e) => setNewMilestoneName(e.target.value)}
              required
              autoFocus
              disabled={addingMilestone}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="milestoneDesc">
              Description & Key Objectives
            </label>
            <textarea
              id="milestoneDesc"
              className={styles.modalTextarea}
              placeholder="Define milestone scope, deliverables, and completion criteria…"
              value={newMilestoneDesc}
              onChange={(e) => setNewMilestoneDesc(e.target.value)}
              rows={3}
              disabled={addingMilestone}
            />
          </div>

          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="milestoneStart">
                Start Date
              </label>
              <input
                id="milestoneStart"
                type="date"
                className={styles.modalInput}
                value={newMilestoneStart}
                onChange={(e) => setNewMilestoneStart(e.target.value)}
                disabled={addingMilestone}
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="milestoneEnd">
                Target End Date
              </label>
              <input
                id="milestoneEnd"
                type="date"
                className={styles.modalInput}
                value={newMilestoneEnd}
                onChange={(e) => setNewMilestoneEnd(e.target.value)}
                disabled={addingMilestone}
              />
            </div>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setShowAddMilestoneModal(false)}
              disabled={addingMilestone}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={addingMilestone || !newMilestoneName.trim()}
            >
              {addingMilestone ? 'Creating…' : 'Create Milestone'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ───── Create Task List Modal ───── */}
      <Modal
        isOpen={showAddTaskListModal}
        onClose={() => setShowAddTaskListModal(false)}
        title="Create Task List"
      >
        <form onSubmit={handleCreateTaskListSubmit}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="parentMilestone">
              Parent Milestone
            </label>
            <select
              id="parentMilestone"
              className={styles.modalSelect}
              value={newTaskListMilestoneId}
              onChange={(e) => setNewTaskListMilestoneId(e.target.value)}
              required
              disabled={addingTaskList}
            >
              <option value="">Select Milestone…</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

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
              onClick={() => setShowAddTaskListModal(false)}
              disabled={addingTaskList}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={addingTaskList || !newTaskListName.trim() || !newTaskListMilestoneId}
            >
              {addingTaskList ? 'Creating…' : 'Create Task List'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ───── Create Task Modal (with Cascading Hierarchy & Mandatory RACI) ───── */}
      <Modal isOpen={showAddTaskModal} onClose={() => setShowAddTaskModal(false)} title="New Task" size="lg">
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
          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="taskMilestone">
                Milestone
              </label>
              <select
                id="taskMilestone"
                className={styles.modalSelect}
                value={newTaskMilestoneId}
                onChange={(e) => {
                  setNewTaskMilestoneId(e.target.value);
                  setNewTaskTaskListId('');
                }}
                disabled={addingTask}
              >
                <option value="">None (Uncategorized Task)</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
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
                disabled={addingTask || !newTaskMilestoneId}
                required={!!newTaskMilestoneId}
              >
                <option value="">
                  {!newTaskMilestoneId ? 'Select Milestone first…' : 'Select Task List…'}
                </option>
                {availableTaskListsForSelectedMilestone.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Mandatory RACI Selection */}
          <div className={styles.raciInputBox}>
            <span className={styles.raciBoxTitle}>Mandatory RACI Assignment</span>
            <div className={styles.modalRow}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel} htmlFor="taskAccountable">
                  Accountable Owner (A) <span className={styles.reqStar}>*</span>
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
                  <option value="">Select Accountable User…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.user_id || ''}>
                      {getMemberDisplayName(m, user)}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.modalField}>
                <label className={styles.modalLabel} htmlFor="taskResponsible">
                  Responsible Doer (R) <span className={styles.reqStar}>*</span>
                </label>
                <select
                  id="taskResponsible"
                  className={styles.modalSelect}
                  value={newTaskResponsible}
                  onChange={(e) => setNewTaskResponsible(e.target.value)}
                  required
                  disabled={addingTask}
                >
                  <option value="">Select Responsible User…</option>
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
              onClick={() => setShowAddTaskModal(false)}
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
