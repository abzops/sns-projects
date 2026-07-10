import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function countTasks(rows = []) {
  return rows.reduce((counts, row) => {
    counts[row.project_id] = (counts[row.project_id] || 0) + 1
    return counts
  }, {})
}

export function useProjects(workspaceId) {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchProjects = useCallback(async () => {
    if (!workspaceId || !user) {
      setProjects([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('projects')
      .select('id, workspace_id, name, description, color, created_by, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError)
      setProjects([])
      setLoading(false)
      return
    }

    const projectIds = (data || []).map((project) => project.id)
    let taskCounts = {}

    if (projectIds.length > 0) {
      const { data: taskRows } = await supabase
        .from('tasks')
        .select('project_id')
        .in('project_id', projectIds)

      taskCounts = countTasks(taskRows || [])
    }

    setProjects(
      (data || []).map((project) => ({
        ...project,
        task_count: taskCounts[project.id] || 0,
      }))
    )
    setLoading(false)
  }, [workspaceId, user])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const createProject = async (input) => {
    const supabase = getSupabase()
    const payload = {
      workspace_id: workspaceId,
      name: input?.name?.trim(),
      description: input?.description || null,
      color: input?.color || '#FDE215',
      created_by: user.id,
    }

    if (!payload.name) {
      return { data: null, error: new Error('Project name is required') }
    }

    const { data, error: insertError } = await supabase
      .from('projects')
      .insert(payload)
      .select('id, workspace_id, name, description, color, created_by, created_at, updated_at')
      .single()

    if (!insertError) {
      await fetchProjects()
    }

    return { data, error: insertError }
  }

  const updateProject = async (id, updates) => {
    const supabase = getSupabase()
    const { error: updateError } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)

    if (!updateError) {
      await fetchProjects()
    }

    return { error: updateError }
  }

  const deleteProject = async (id) => {
    const supabase = getSupabase()
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)

    if (!deleteError) {
      await fetchProjects()
    }

    return { error: deleteError }
  }

  return { projects, loading, error, createProject, updateProject, deleteProject, refetch: fetchProjects }
}
