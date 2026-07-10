import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useTaskStatuses } from './useTaskStatuses'
import { useMembers } from './useMembers'

function enrichTasks(tasks, statuses, members) {
  const statusesById = new Map((statuses || []).map((status) => [status.id, status]))
  const membersByUserId = new Map((members || []).filter((member) => member.user_id).map((member) => [member.user_id, member]))

  return (tasks || []).map((task) => {
    const status = statusesById.get(task.status_id)
    const assigneeMember = task.assignee_id ? membersByUserId.get(task.assignee_id) : null

    return {
      ...task,
      task_statuses: status ? { name: status.name, color: status.color } : null,
      assignee: assigneeMember?.profiles || null,
    }
  })
}

function buildReorderUpdates(tasks, taskId, newStatusId, newPosition) {
  const task = tasks.find((candidate) => candidate.id === taskId)
  if (!task) return []

  const oldStatusId = task.status_id

  if (oldStatusId === newStatusId) {
    const column = tasks
      .filter((candidate) => candidate.status_id === newStatusId && candidate.id !== taskId)
      .sort((a, b) => a.position - b.position)

    column.splice(newPosition, 0, { ...task, status_id: newStatusId })

    return column.map((candidate, index) => ({
      id: candidate.id,
      status_id: newStatusId,
      position: index,
    }))
  }

  const oldColumn = tasks
    .filter((candidate) => candidate.status_id === oldStatusId && candidate.id !== taskId)
    .sort((a, b) => a.position - b.position)
    .map((candidate, index) => ({
      id: candidate.id,
      status_id: oldStatusId,
      position: index,
    }))

  const newColumn = tasks
    .filter((candidate) => candidate.status_id === newStatusId && candidate.id !== taskId)
    .sort((a, b) => a.position - b.position)

  newColumn.splice(newPosition, 0, { ...task, status_id: newStatusId })

  return [
    ...oldColumn,
    ...newColumn.map((candidate, index) => ({
      id: candidate.id,
      status_id: newStatusId,
      position: index,
    })),
  ]
}

export function useTasks(projectId, workspaceId) {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const { statuses } = useTaskStatuses(projectId)
  const { members } = useMembers(workspaceId)

  const fetchTasks = useCallback(async () => {
    if (!projectId || !user) {
      setTasks([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('tasks')
      .select('id, project_id, title, description, status_id, priority, assignee_id, due_date, position, created_by, created_at, updated_at')
      .eq('project_id', projectId)
      .order('position', { ascending: true })

    if (fetchError) {
      setError(fetchError)
      setTasks([])
      setLoading(false)
      return
    }

    setTasks(enrichTasks(data || [], statuses, members))
    setLoading(false)
  }, [projectId, user, statuses, members])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const createTask = async (taskData) => {
    const supabase = getSupabase()
    const targetStatusId = taskData.status_id || statuses?.[0]?.id || null
    const maxPosition = tasks
      .filter((task) => task.status_id === targetStatusId)
      .reduce((max, task) => Math.max(max, task.position ?? 0), -1)

    const { data, error: insertError } = await supabase
      .from('tasks')
      .insert({
        project_id: projectId,
        ...taskData,
        status_id: targetStatusId,
        assignee_id: taskData.assignee_id || null,
        due_date: taskData.due_date || null,
        position: maxPosition + 1,
        created_by: user.id,
      })
      .select('id, project_id, title, description, status_id, priority, assignee_id, due_date, position, created_by, created_at, updated_at')
      .single()

    if (!insertError) {
      await fetchTasks()
    }

    return { data, error: insertError }
  }

  const updateTask = async (id, updates) => {
    const supabase = getSupabase()
    const payload = {
      title: updates.title,
      description: updates.description || null,
      status_id: updates.status_id || null,
      priority: updates.priority || 'none',
      assignee_id: updates.assignee_id || null,
      due_date: updates.due_date || null,
      position: updates.position ?? 0,
    }

    const { error: updateError } = await supabase
      .from('tasks')
      .update(payload)
      .eq('id', id)

    if (!updateError) {
      await fetchTasks()
    }

    return { error: updateError }
  }

  const deleteTask = async (id) => {
    const supabase = getSupabase()
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)

    if (!deleteError) {
      await fetchTasks()
    }

    return { error: deleteError }
  }

  const reorderTask = async (taskId, newStatusId, newPosition) => {
    const updates = buildReorderUpdates(tasks, taskId, newStatusId, newPosition)

    if (updates.length === 0) {
      return { error: new Error('Task not found') }
    }

    const supabase = getSupabase()
    const results = await Promise.all(
      updates.map((update) =>
        supabase
          .from('tasks')
          .update({
            status_id: update.status_id,
            position: update.position,
          })
          .eq('id', update.id)
      )
    )

    const failed = results.find((result) => result.error)

    if (!failed) {
      await fetchTasks()
    }

    return { error: failed?.error || null }
  }

  return { tasks, loading, error, createTask, updateTask, deleteTask, reorderTask, refetch: fetchTasks }
}
