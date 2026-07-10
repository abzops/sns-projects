import { useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTasks } from '../hooks/useTasks'
import { useTaskStatuses } from '../hooks/useTaskStatuses'
import { useMembers } from '../hooks/useMembers'
import { useProjects } from '../hooks/useProjects'
import {
  DndContext,
  closestCorners,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, List, Kanban, Search, ChevronLeft, ChevronUp, ChevronDown
} from 'lucide-react'

// Import shared components
import TaskRow from '../components/TaskRow'
import TaskCard from '../components/TaskCard'
import TaskDetailPanel from '../components/TaskDetailPanel'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'

import styles from './TasksPage.module.css'

const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none']
const PRIORITY_LABELS = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
}

/* ───── Sortable Task Card Wrapper (Kanban) ───── */
function SortableTaskCardWrapper({ task, onClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <TaskCard 
        task={task} 
        onClick={() => onClick(task)} 
        isDragging={isDragging} 
      />
    </div>
  )
}

/* ───── Main TasksPage ───── */
export default function TasksPage() {
  const { projectId, workspaceId } = useParams()
  const navigate = useNavigate()
  const { tasks, loading, createTask, updateTask, deleteTask, reorderTask } =
    useTasks(projectId)
  const { statuses, loading: statusesLoading } = useTaskStatuses(projectId)
  const { members } = useMembers(workspaceId)
  const { projects } = useProjects(workspaceId)
  const project = projects?.find((p) => p.id === projectId)

  const [view, setView] = useState('kanban')
  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [sortColumn, setSortColumn] = useState('title')
  const [sortDir, setSortDir] = useState('asc')
  const [selectedTask, setSelectedTask] = useState(null)
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  
  // Drag state
  const [activeId, setActiveId] = useState(null)

  // New task form state
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [newAssignee, setNewAssignee] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  /* ── Filtered tasks ── */
  const filteredTasks = useMemo(() => {
    let result = [...(tasks || [])]

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      )
    }
    if (filterPriority) {
      result = result.filter((t) => t.priority === filterPriority)
    }
    if (filterAssignee) {
      result = result.filter((t) => t.assignee_id === filterAssignee)
    }

    return result
  }, [tasks, search, filterPriority, filterAssignee])

  /* ── Sorted tasks (for list view) ── */
  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks]
    sorted.sort((a, b) => {
      let valA = a[sortColumn] || ''
      let valB = b[sortColumn] || ''
      if (typeof valA === 'string') valA = valA.toLowerCase()
      if (typeof valB === 'string') valB = valB.toLowerCase()
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [filteredTasks, sortColumn, sortDir])

  /* ── Grouped tasks by status (for kanban) ── */
  const tasksByStatus = useMemo(() => {
    const map = {}
    for (const s of statuses || []) {
      map[s.id] = filteredTasks.filter((t) => t.status_id === s.id)
    }
    // Also catch tasks with no matching status
    const unmatched = filteredTasks.filter(
      (t) => !statuses?.some((s) => s.id === t.status_id)
    )
    if (unmatched.length > 0) {
      map['__none__'] = unmatched
    }
    return map
  }, [filteredTasks, statuses])

  /* ── Column sort toggle ── */
  const toggleSort = (col) => {
    if (sortColumn === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(col)
      setSortDir('asc')
    }
  }

  const SortIcon = ({ col }) => {
    if (sortColumn !== col) return null
    return sortDir === 'asc' ? (
      <ChevronUp size={12} />
    ) : (
      <ChevronDown size={12} />
    )
  }

  /* ── Drag handlers ── */
  const handleDragStart = (event) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = useCallback(
    (event) => {
      setActiveId(null)
      const { active, over } = event
      if (!over) return

      const activeTask = tasks.find((t) => t.id === active.id)
      if (!activeTask) return

      let targetStatusId = null
      let targetTasks = []

      for (const s of statuses) {
        const tasksInCol = tasksByStatus[s.id] || []
        if (
          s.id === over.id ||
          tasksInCol.some((t) => t.id === over.id)
        ) {
          targetStatusId = s.id
          targetTasks = tasksInCol
          break
        }
      }

      if (!targetStatusId) return

      const overIndex = targetTasks.findIndex((t) => t.id === over.id)
      const newPosition = overIndex >= 0 ? overIndex : targetTasks.length

      if (reorderTask) {
        reorderTask(active.id, targetStatusId, newPosition)
      }
    },
    [tasks, statuses, tasksByStatus, reorderTask]
  )

  /* ── Add task ── */
  const openAddModal = (statusId) => {
    setNewStatus(statusId || statuses?.[0]?.id || '')
    setNewTitle('')
    setNewDesc('')
    setNewPriority('medium')
    setNewAssignee('')
    setNewDueDate('')
    setShowAddModal(true)
  }

  const handleAddTask = async (e) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setAddingTask(true)
    try {
      await createTask({
        title: newTitle.trim(),
        description: newDesc.trim(),
        status_id: newStatus || undefined,
        priority: newPriority,
        assignee_id: newAssignee || undefined,
        due_date: newDueDate || undefined,
      })
      setShowAddModal(false)
    } catch (err) {
      console.error('Failed to add task:', err)
    } finally {
      setAddingTask(false)
    }
  }

  const activeTask = activeId
    ? tasks?.find((t) => t.id === activeId)
    : null

  if (loading || statusesLoading) {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <button
            className={styles.toggleBtn}
            onClick={() => navigate(`/workspace/${workspaceId}`)}
            title="Back to projects"
          >
            <ChevronLeft size={20} />
          </button>
          <div 
            className={styles.colorDot}
            style={{ background: project?.color || '#FDE215' }}
          />
          <h1>{project?.name || 'Tasks'}</h1>
        </div>
        
        <div className={styles.headerActions}>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.toggleBtn} ${view === 'list' ? styles.active : ''}`}
              onClick={() => setView('list')}
              title="List View"
            >
              <List size={18} />
            </button>
            <button
              className={`${styles.toggleBtn} ${view === 'kanban' ? styles.active : ''}`}
              onClick={() => setView('kanban')}
              title="Kanban View"
            >
              <Kanban size={18} />
            </button>
          </div>
          <button className={styles.addBtn} onClick={() => openAddModal()}>
            <Plus size={16} />
            Add Task
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className={styles.filters}>
        <div className={styles.searchWrapper}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
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
          <option value="">All Assignees</option>
          {members?.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.profiles?.full_name || m.invited_email}
            </option>
          ))}
        </select>
      </div>

      {/* List View */}
      {view === 'list' && (
        <div className={styles.listContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableTh}>
                  <button className={styles.th} onClick={() => toggleSort('title')}>
                    Title <SortIcon col="title" />
                  </button>
                </th>
                <th className={styles.tableTh}>
                  <button className={styles.th} onClick={() => toggleSort('status_id')}>
                    Status <SortIcon col="status_id" />
                  </button>
                </th>
                <th className={styles.tableTh}>
                  <button className={styles.th} onClick={() => toggleSort('priority')}>
                    Priority <SortIcon col="priority" />
                  </button>
                </th>
                <th className={styles.tableTh}>
                  <button className={styles.th} onClick={() => toggleSort('assignee_id')}>
                    Assignee <SortIcon col="assignee_id" />
                  </button>
                </th>
                <th className={styles.tableTh}>
                  <button className={styles.th} onClick={() => toggleSort('due_date')}>
                    Due Date <SortIcon col="due_date" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task) => (
                <TaskRow 
                  key={task.id} 
                  task={task} 
                  onClick={() => setSelectedTask(task)} 
                />
              ))}
              {sortedTasks.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
                    No tasks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Kanban View */}
      {view === 'kanban' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className={styles.board}>
            {(statuses || []).map((status) => {
              const columnTasks = tasksByStatus[status.id] || []
              return (
                <div key={status.id} className={styles.column}>
                  <div className={styles.columnHeader}>
                    <div className={styles.columnTitle}>
                      <span
                        className={styles.statusColor}
                        style={{ background: status.color }}
                      />
                      <h3>{status.name}</h3>
                      <span className={styles.taskCount}>{columnTasks.length}</span>
                    </div>
                  </div>

                  <SortableContext
                    id={status.id}
                    items={columnTasks.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className={styles.taskList}>
                      {columnTasks.map((task) => (
                        <SortableTaskCardWrapper
                          key={task.id}
                          task={task}
                          onClick={setSelectedTask}
                        />
                      ))}
                    </div>
                  </SortableContext>

                  <div className={styles.columnFooter}>
                    <button
                      className={styles.addTaskInlineBtn}
                      onClick={() => openAddModal(status.id)}
                    >
                      <Plus size={16} /> Add Task
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <DragOverlay>
            {activeTask ? (
              <div style={{ transform: 'rotate(2deg)' }}>
                <TaskCard task={activeTask} isDragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Task Detail Panel (Slide-in) */}
      <TaskDetailPanel
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        statuses={statuses || []}
        members={members || []}
        onSave={async (updated) => {
          await updateTask(updated.id, updated)
          setSelectedTask(null)
        }}
        onDelete={async (id) => {
          await deleteTask(id)
          setSelectedTask(null)
        }}
      />

      {/* Add Task Modal */}
      <Modal 
        isOpen={showAddModal} 
        onClose={() => setShowAddModal(false)}
        title="Create New Task"
      >
        <form onSubmit={handleAddTask}>
          <div className={styles.formGroup}>
            <label>Task Title</label>
            <input
              type="text"
              className={styles.formControl}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="What needs to be done?"
              required
              autoFocus
            />
          </div>
          
          <div className={styles.formGroup}>
            <label>Description</label>
            <textarea
              className={styles.formControl}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Add more details..."
            />
          </div>
          
          <div style={{ display: 'flex', gap: '16px' }}>
            <div className={styles.formGroup} style={{ flex: 1 }}>
              <label>Status</label>
              <select
                className={styles.formControl}
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                {statuses?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            
            <div className={styles.formGroup} style={{ flex: 1 }}>
              <label>Priority</label>
              <select
                className={styles.formControl}
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '16px' }}>
            <div className={styles.formGroup} style={{ flex: 1 }}>
              <label>Assignee</label>
              <select
                className={styles.formControl}
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {members?.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profiles?.full_name || m.invited_email}
                  </option>
                ))}
              </select>
            </div>
            
            <div className={styles.formGroup} style={{ flex: 1 }}>
              <label>Due Date</label>
              <input
                type="date"
                className={styles.formControl}
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
              />
            </div>
          </div>
          
          <div className={styles.formActions}>
            <button 
              type="button" 
              className={styles.cancelBtn} 
              onClick={() => setShowAddModal(false)}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className={styles.submitBtn}
              disabled={addingTask || !newTitle.trim()}
            >
              {addingTask ? 'Saving...' : 'Create Task'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
