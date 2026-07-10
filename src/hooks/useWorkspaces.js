import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function countByWorkspace(rows = []) {
  return rows.reduce((counts, row) => {
    counts[row.workspace_id] = (counts[row.workspace_id] || 0) + 1
    return counts
  }, {})
}

export function useWorkspaces() {
  const { user } = useAuth()
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('workspaces')
      .select('id, name, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError)
      setWorkspaces([])
      setLoading(false)
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

    setWorkspaces(
      (data || []).map((workspace) => ({
        ...workspace,
        member_count: memberCounts[workspace.id] || 0,
        project_count: projectCounts[workspace.id] || 0,
      }))
    )
    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

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
        created_by: user.id,
      })

    if (workspaceError) {
      return { data: null, error: workspaceError }
    }

    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: id,
        user_id: user.id,
        role: 'owner',
        status: 'active',
        invited_by: user.id,
      })

    if (memberError) {
      return { data: null, error: memberError }
    }

    await fetchWorkspaces()
    return { data: { id, name: name.trim() }, error: null }
  }

  const updateWorkspace = async (id, updates) => {
    const supabase = getSupabase()
    const { error: updateError } = await supabase
      .from('workspaces')
      .update(updates)
      .eq('id', id)

    if (!updateError) {
      await fetchWorkspaces()
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
      await fetchWorkspaces()
    }

    return { error: deleteError }
  }

  return { workspaces, loading, error, createWorkspace, updateWorkspace, deleteWorkspace, refetch: fetchWorkspaces }
}
