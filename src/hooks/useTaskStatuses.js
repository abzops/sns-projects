import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const taskStatusesCache = new Map(); // projectId -> statuses[]

export function useTaskStatuses(projectId) {
  const { user } = useAuth()
  const userId = user?.id || null
  const cacheKey = `${userId || 'anonymous'}:${projectId || 'none'}`
  const [statuses, setStatuses] = useState(() => taskStatusesCache.get(cacheKey) || [])
  const [loading, setLoading] = useState(() => !taskStatusesCache.has(cacheKey))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchStatuses = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!projectId || !userId) {
      setStatuses([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (!isSilent && !taskStatusesCache.has(cacheKey)) {
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
    taskStatusesCache.set(cacheKey, list);
    setStatuses(list)
    setError(fetchError)
    setLoading(false)
    setRefreshing(false)
  }, [cacheKey, projectId, userId])

  useEffect(() => {
    if (taskStatusesCache.has(cacheKey)) {
      setStatuses(taskStatusesCache.get(cacheKey))
      setLoading(false)
    } else {
      setStatuses([])
    }
    fetchStatuses()
  }, [cacheKey, fetchStatuses])

  return { statuses, loading, refreshing, error, refetch: fetchStatuses }
}
