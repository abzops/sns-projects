import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const taskStatusesCache = new Map(); // projectId -> statuses[]

export function useTaskStatuses(projectId) {
  const { user } = useAuth()
  const [statuses, setStatuses] = useState(() => taskStatusesCache.get(projectId) || [])
  const [loading, setLoading] = useState(() => !taskStatusesCache.has(projectId))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchStatuses = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!projectId || !user) {
      setStatuses([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (!isSilent && !taskStatusesCache.has(projectId)) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('task_statuses')
      .select('*')
      .eq('project_id', projectId)
      .order('position', { ascending: true })

    const list = data || [];
    taskStatusesCache.set(projectId, list);
    setStatuses(list)
    setError(fetchError)
    setLoading(false)
    setRefreshing(false)
  }, [projectId, user])

  useEffect(() => {
    if (taskStatusesCache.has(projectId)) {
      setStatuses(taskStatusesCache.get(projectId))
      setLoading(false)
    }
    fetchStatuses()
  }, [fetchStatuses, projectId])

  return { statuses, loading, refreshing, error, refetch: fetchStatuses }
}
