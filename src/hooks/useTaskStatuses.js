import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export function useTaskStatuses(projectId) {
  const { user } = useAuth()
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchStatuses = useCallback(async () => {
    if (!projectId || !user) {
      setStatuses([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('task_statuses')
      .select('id, project_id, name, color, position, created_at')
      .eq('project_id', projectId)
      .order('position', { ascending: true })

    setStatuses(data || [])
    setError(fetchError)
    setLoading(false)
  }, [projectId, user])

  useEffect(() => {
    fetchStatuses()
  }, [fetchStatuses])

  return { statuses, loading, error, refetch: fetchStatuses }
}
