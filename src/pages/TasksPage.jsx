import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTasks } from '../hooks/useTasks';
import { useTaskStatuses } from '../hooks/useTaskStatuses';
import { useMembers } from '../hooks/useMembers';
import { useProjects } from '../hooks/useProjects';
import { useDepartments } from '../hooks/useDepartments';
import { useMilestones } from '../hooks/useMilestones';
import { useTaskLists } from '../hooks/useTaskLists';
import { useToast } from '../components/Toast';
import {
  DndContext,
  closestCorners,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
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
} from 'lucide-react';

import TaskRow from '../components/TaskRow';
import TaskCard from '../components/TaskCard';
import TaskDetailPanel from '../components/TaskDetailPanel';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
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

/* ───── Sortable Task Card Wrapper (Kanban) ───── */
function SortableTaskCardWrapper({ task, onClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        onClick={() => onClick(task)}
        isDragging={isDragging}
      />
    </div>
  );
}

/* ───── Main TasksPage ───── */
export default function TasksPage() {
  const { projectId, workspaceId } = useParams();
  const navigate = useNavigate();
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

  // Drag state
  const [activeId, setActiveId] = useState(null);

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
      activationConstraint: { distance: 8 },
    })
  );

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

  /* ── Tasks grouped by status (for Kanban) ── */
  const tasksByStatus = useMemo(() => {
    const map = {};
    (statuses || []).forEach((s) => {
      map[s.id] = [];
    });
    filteredTasks.forEach((t) => {
      if (map[t.status_id]) {
        map[t.status_id].push(t);
      } else if (statuses && statuses[0]) {
        map[statuses[0].id]?.push(t);
      }
    });
    Object.keys(map).forEach((k) => {
      map[k].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    });
    return map;
  }, [filteredTasks, statuses]);

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

  /* ── Drag & Drop Handlers (Kanban) ── */
  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event) => {
    const { active, over } = event;
    if (!over) return;

    const activeTaskId = active.id;
    const overId = over.id;

    const activeTask = tasks.find((t) => t.id === activeTaskId);
    if (!activeTask) return;

    let targetStatusId = null;
    const isOverColumn = statuses.some((s) => s.id === overId);
    if (isOverColumn) {
      targetStatusId = overId;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) targetStatusId = overTask.status_id;
    }

    if (targetStatusId && activeTask.status_id !== targetStatusId) {
      const overColumnTasks = tasksByStatus[targetStatusId] || [];
      const newPos = overColumnTasks.length;
      reorderTask(activeTaskId, targetStatusId, newPos);
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeTaskId = active.id;
    const overId = over.id;

    const activeTask = tasks.find((t) => t.id === activeTaskId);
    if (!activeTask) return;

    const isOverColumn = statuses.some((s) => s.id === overId);
    if (isOverColumn) {
      const colTasks = tasksByStatus[overId] || [];
      reorderTask(activeTaskId, overId, colTasks.length);
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) {
        const colTasks = tasksByStatus[overTask.status_id] || [];
        const newIndex = colTasks.findIndex((t) => t.id === overId);
        reorderTask(activeTaskId, overTask.status_id, Math.max(0, newIndex));
      }
    }
  };

  const activeTask = useMemo(
    () => (activeId ? tasks.find((t) => t.id === activeId) : null),
    [activeId, tasks]
  );

  const loading = tasksLoading || statusesLoading || milestonesLoading || taskListsLoading;

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spinner size="lg" />
        <p>Loading project workspace & hierarchy…</p>
      </div>
    );
  }

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
                  {m.profiles?.full_name || m.invited_email}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

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
                                      <span className={styles.taskListTag}>Task List</span>
                                      <h4 className={styles.taskListName}>{taskList.name}</h4>
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
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className={styles.board}>
            {statuses.map((status) => {
              const colTasks = tasksByStatus[status.id] || [];

              return (
                <div key={status.id} className={styles.column}>
                  <div className={styles.colHeader}>
                    <div className={styles.colTitleWrap}>
                      <span
                        className={styles.colDot}
                        style={{ background: status.color }}
                      />
                      <h3 className={styles.colTitle}>{status.name}</h3>
                    </div>
                    <span className={styles.colCount}>{colTasks.length}</span>
                  </div>

                  <SortableContext
                    items={colTasks.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className={styles.taskList}>
                      {colTasks.map((task) => (
                        <SortableTaskCardWrapper
                          key={task.id}
                          task={task}
                          onClick={() => setSelectedTask(task)}
                        />
                      ))}
                    </div>
                  </SortableContext>

                  <button
                    className={styles.colAddBtn}
                    onClick={() => handleOpenAddTask()}
                  >
                    <Plus size={14} />
                    <span>Add Task</span>
                  </button>
                </div>
              );
            })}
          </div>

          <DragOverlay>
            {activeTask ? (
              <TaskCard task={activeTask} isDragging />
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
                    <th onClick={() => handleSort('title')} className={styles.sortableHeader}>
                      Title
                    </th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>RACI Assignment</th>
                    <th onClick={() => handleSort('due_date')} className={styles.sortableHeader}>
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
                      {m.profiles?.full_name || m.invited_email}
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
                      {m.profiles?.full_name || m.invited_email}
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
