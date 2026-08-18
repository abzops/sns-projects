import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const projectsCache = new Map();

function computeTaskMetrics(taskRows = []) {
  const counts = {};
  const completed = {};
  const overdue = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const task of taskRows) {
    const pid = task.project_id;
    const systemCode = task.task_statuses?.system_code || '';

    if (systemCode === 'cancelled') continue;

    counts[pid] = (counts[pid] || 0) + 1;

    if (systemCode === 'done') {
      completed[pid] = (completed[pid] || 0) + 1;
    } else if (task.due_date) {
      const dueDate = new Date(task.due_date);
      if (dueDate < today) {
        overdue[pid] = (overdue[pid] || 0) + 1;
      }
    }
  }

  return { counts, completed, overdue };
}

export function useProjects(workspaceId, authorizationScopeKey = 'default') {
  const { user } = useAuth()
  const userId = user?.id || null
  const cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`
  const [projects, setProjects] = useState(() => projectsCache.get(cacheKey) || [])
  const [loading, setLoading] = useState(() => !projectsCache.has(cacheKey))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchProjects = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!workspaceId || !userId || !authorizationScopeKey) {
      setProjects([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (!isSilent && !projectsCache.has(cacheKey)) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('projects')
      .select(`
        id,
        workspace_id,
        name,
        description,
        color,
        owner_id,
        start_date,
        target_end_date,
        project_status,
        project_priority,
        created_by,
        created_at,
        updated_at,
        owner:owner_id (
          id,
          full_name,
          avatar_url
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('Error fetching projects:', fetchError)
      setError(fetchError)
      setLoading(false)
      setRefreshing(false)
      return
    }

    const projectIds = (data || []).map((project) => project.id)
    let metrics = { counts: {}, completed: {}, overdue: {} }

    if (projectIds.length > 0) {
      const { data: taskRows } = await supabase
        .from('tasks')
        .select(`
          id,
          project_id,
          due_date,
          task_statuses:status_id (
            name,
            system_code
          )
        `)
        .in('project_id', projectIds)

      metrics = computeTaskMetrics(taskRows || [])
    }

    const enriched = (data || []).map((project) => {
      const taskCount = metrics.counts[project.id] || 0
      const completedCount = metrics.completed[project.id] || 0
      const overdueCount = metrics.overdue[project.id] || 0
      const progress = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0

      return {
        ...project,
        task_count: taskCount,
        completed_count: completedCount,
        overdue_count: overdueCount,
        progress,
      }
    })

    projectsCache.set(cacheKey, enriched)
    setProjects(enriched)
    setLoading(false)
    setRefreshing(false)
  }, [authorizationScopeKey, cacheKey, workspaceId, userId])

  useEffect(() => {
    // If workspace changed, pick up cache or set empty
    if (projectsCache.has(cacheKey)) {
      setProjects(projectsCache.get(cacheKey))
      setLoading(false)
    } else {
      setProjects([])
      setLoading(true)
    }
    fetchProjects()
  }, [cacheKey, fetchProjects])

  const createProject = async (input) => {
    const supabase = getSupabase()
    const payload = {
      workspace_id: workspaceId,
      name: input?.name?.trim(),
      description: input?.description?.trim() || null,
      color: input?.color || '#FDE215',
      owner_id: input?.owner_id || userId,
      start_date: input?.start_date || null,
      target_end_date: input?.target_end_date || null,
      project_status: input?.project_status || 'active',
      project_priority: input?.project_priority || 'medium',
      created_by: userId,
    }

    if (!payload.name) {
      return { data: null, error: new Error('Project name is required') }
    }

    const { data, error: insertError } = await supabase
      .from('projects')
      .insert(payload)
      .select(`
        id,
        workspace_id,
        name,
        description,
        color,
        owner_id,
        start_date,
        target_end_date,
        project_status,
        project_priority,
        created_by,
        created_at,
        updated_at,
        owner:owner_id (
          id,
          full_name,
          avatar_url
        )
      `)
      .single()

    if (!insertError) {
      await fetchProjects({ silent: true })
    }

    return { data, error: insertError }
  }

  const updateProject = async (id, updates) => {
    const supabase = getSupabase()
    const payload = {
      ...updates,
      updated_at: new Date().toISOString(),
    }

    const { data, error: updateError } = await supabase
      .from('projects')
      .update(payload)
      .eq('id', id)
      .select(`
        id,
        workspace_id,
        name,
        description,
        color,
        owner_id,
        start_date,
        target_end_date,
        project_status,
        project_priority,
        created_by,
        created_at,
        updated_at,
        owner:owner_id (
          id,
          full_name,
          avatar_url
        )
      `)
      .single()

    if (!updateError) {
      await fetchProjects({ silent: true })
    }

    return { data, error: updateError }
  }

  const deleteProject = async (id) => {
    const supabase = getSupabase()
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)

    if (!deleteError) {
      await fetchProjects({ silent: true })
    }

    return { error: deleteError }
  }

  return {
    projects,
    loading,
    refreshing,
    error,
    createProject,
    updateProject,
    deleteProject,
    refetch: fetchProjects,
  }
}
