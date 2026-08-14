import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const membersCache = new Map(); // workspaceId -> members[]

async function attachProfilesFallback(supabase, members) {
  const userIds = [...new Set((members || []).map((member) => member.user_id).filter(Boolean))];

  if (userIds.length === 0) {
    return (members || []).map((m) => ({ ...m, profile: null, profiles: null }));
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', userIds);

  const profilesById = new Map((profiles || []).map((p) => [p.id, p]));

  return (members || []).map((member) => {
    const p = member.user_id ? profilesById.get(member.user_id) || null : null;
    return {
      ...member,
      profile: p,
      profiles: p,
    };
  });
}

function normalizeMemberProfiles(members) {
  return (members || []).map((member) => {
    const rawProfile = member.profile;
    const p = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
    return {
      ...member,
      profile: p || null,
      profiles: p || null,
    };
  });
}

export function useMembers(workspaceId) {
  const { user } = useAuth();
  const [members, setMembers] = useState(() => membersCache.get(workspaceId) || []);
  const [loading, setLoading] = useState(() => !membersCache.has(workspaceId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchMembers = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!workspaceId || !user) {
      setMembers([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!isSilent && !membersCache.has(workspaceId)) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    const supabase = getSupabase();

    try {
      const { data, error: fetchError } = await supabase
        .from('workspace_members')
        .select(`
          id,
          workspace_id,
          user_id,
          invited_email,
          role,
          status,
          invited_by,
          created_at,
          profile:profiles!workspace_members_user_id_fkey(
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });

      if (fetchError) {
        console.warn('Direct FK join returned error, falling back to batch profile lookup:', fetchError);
        const { data: rawMembers, error: rawError } = await supabase
          .from('workspace_members')
          .select('id, workspace_id, user_id, invited_email, role, status, invited_by, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: true });

        if (rawError) throw rawError;

        const resolved = await attachProfilesFallback(supabase, rawMembers || []);
        membersCache.set(workspaceId, resolved);
        setMembers(resolved);
      } else {
        const normalized = normalizeMemberProfiles(data || []);
        membersCache.set(workspaceId, normalized);
        setMembers(normalized);
      }
    } catch (err) {
      console.error('Error fetching workspace members:', err);
      setError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId, user]);

  useEffect(() => {
    if (membersCache.has(workspaceId)) {
      setMembers(membersCache.get(workspaceId));
      setLoading(false);
    }
    fetchMembers();
  }, [fetchMembers, workspaceId]);

  const inviteMember = async (email, role) => {
    const supabase = getSupabase();
    const { error: insertError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspaceId,
        invited_email: email.toLowerCase(),
        role,
        status: 'pending',
        invited_by: user.id,
      });

    if (!insertError) {
      await fetchMembers({ silent: true });
    }

    return { error: insertError };
  };

  const updateRole = async (memberId, newRole) => {
    const supabase = getSupabase();
    const { error: updateError } = await supabase
      .from('workspace_members')
      .update({ role: newRole })
      .eq('id', memberId);

    if (!updateError) {
      await fetchMembers({ silent: true });
    }

    return { error: updateError };
  };

  const removeMember = async (memberId) => {
    const supabase = getSupabase();
    const { error: deleteError } = await supabase
      .from('workspace_members')
      .delete()
      .eq('id', memberId);

    if (!deleteError) {
      await fetchMembers({ silent: true });
    }

    return { error: deleteError };
  };

  return {
    members,
    loading,
    refreshing,
    error,
    inviteMember,
    updateRole,
    removeMember,
    refetch: fetchMembers,
  };
}
