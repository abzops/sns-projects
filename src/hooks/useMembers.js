import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

async function attachProfiles(supabase, members) {
  const userIds = [...new Set((members || []).map((member) => member.user_id).filter(Boolean))]

  if (userIds.length === 0) {
    return members || []
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', userIds)

  const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]))

  return (members || []).map((member) => ({
    ...member,
    profiles: member.user_id ? profilesById.get(member.user_id) || null : null,
  }))
}

export function useMembers(workspaceId) {
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchMembers = useCallback(async () => {
    if (!workspaceId || !user) {
      setMembers([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('workspace_members')
      .select('id, workspace_id, user_id, invited_email, role, status, invited_by, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(fetchError)
      setMembers([])
      setLoading(false)
      return
    }

    setMembers(await attachProfiles(supabase, data || []))
    setLoading(false)
  }, [workspaceId, user])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  const inviteMember = async (email, role) => {
    const supabase = getSupabase()
    const { error: insertError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspaceId,
        invited_email: email.toLowerCase(),
        role,
        status: 'pending',
        invited_by: user.id,
      })

    if (!insertError) {
      await fetchMembers()
    }

    return { error: insertError }
  }

  const updateRole = async (memberId, newRole) => {
    const supabase = getSupabase()
    const { error: updateError } = await supabase
      .from('workspace_members')
      .update({ role: newRole })
      .eq('id', memberId)

    if (!updateError) {
      await fetchMembers()
    }

    return { error: updateError }
  }

  const removeMember = async (memberId) => {
    const supabase = getSupabase()
    const { error: deleteError } = await supabase
      .from('workspace_members')
      .delete()
      .eq('id', memberId)

    if (!deleteError) {
      await fetchMembers()
    }

    return { error: deleteError }
  }

  return { members, loading, error, inviteMember, updateRole, removeMember, refetch: fetchMembers }
}
