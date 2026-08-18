import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const workspacesCache = new Map();

function countByWorkspace(rows = []) {
  return rows.reduce((counts, row) => {
    counts[row.workspace_id] = (counts[row.workspace_id] || 0) + 1
    return counts
  }, {})
}

export function useWorkspaces() {
  const { user } = useAuth()
  const userId = user?.id || null
  const cacheKey = userId || 'anonymous'
  const [workspaces, setWorkspaces] = useState(() => workspacesCache.get(cacheKey) || [])
  const [loading, setLoading] = useState(() => !workspacesCache.has(cacheKey))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchWorkspaces = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!userId) {
      setWorkspaces([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (!isSilent && !workspacesCache.has(cacheKey)) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('workspaces')
      .select('id, name, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError)
      setLoading(false)
      setRefreshing(false)
      return
    }

    const workspaceIds = (data || []).map((workspace) => workspace.id)
    let memberCounts = {}
    let projectCounts = {}

    if (workspaceIds.length > 0) {
      const [{ data: members }, { data: projects }] = await Promise.all([
        supabase
          .from('workspace_members')
          .select('workspace_id')
          .in('workspace_id', workspaceIds),
        supabase
          .from('projects')
          .select('workspace_id')
          .in('workspace_id', workspaceIds),
      ])

      memberCounts = countByWorkspace(members || [])
      projectCounts = countByWorkspace(projects || [])
    }

    const enriched = (data || []).map((workspace) => ({
      ...workspace,
      member_count: memberCounts[workspace.id] || 0,
      project_count: projectCounts[workspace.id] || 0,
    }))

    workspacesCache.set(cacheKey, enriched)
    setWorkspaces(enriched)
    setLoading(false)
    setRefreshing(false)
  }, [cacheKey, userId])

  useEffect(() => {
    if (workspacesCache.has(cacheKey)) {
      setWorkspaces(workspacesCache.get(cacheKey))
      setLoading(false)
    } else {
      setWorkspaces([])
    }
    fetchWorkspaces()
  }, [cacheKey, fetchWorkspaces])

  const createWorkspace = async (input) => {
    const name = typeof input === 'string' ? input : input?.name
    if (!name?.trim()) {
      return { data: null, error: new Error('Workspace name is required') }
    }

    const supabase = getSupabase()
    const id = crypto.randomUUID()

    const { error: workspaceError } = await supabase
      .from('workspaces')
      .insert({
        id,
        name: name.trim(),
        created_by: userId,
      })

    if (workspaceError) {
      return { data: null, error: workspaceError }
    }

    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: id,
        user_id: userId,
        role: 'owner',
        status: 'active',
        invited_by: userId,
      })

    if (memberError) {
      return { data: null, error: memberError }
    }

    await fetchWorkspaces({ silent: true })
    return { data: { id, name: name.trim() }, error: null }
  }

  const updateWorkspace = async (id, updates) => {
    const supabase = getSupabase()
    const { error: updateError } = await supabase
      .from('workspaces')
      .update(updates)
      .eq('id', id)

    if (!updateError) {
      await fetchWorkspaces({ silent: true })
    }

    return { error: updateError }
  }

  const deleteWorkspace = async (id) => {
    const supabase = getSupabase()
    const { error: deleteError } = await supabase
      .from('workspaces')
      .delete()
      .eq('id', id)

    if (!deleteError) {
      await fetchWorkspaces({ silent: true })
    }

    return { error: deleteError }
  }

  return {
    workspaces,
    loading,
    refreshing,
    error,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    refetch: fetchWorkspaces,
  }
}
