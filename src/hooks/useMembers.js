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
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}`;
  const [members, setMembers] = useState(() => membersCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(() => !membersCache.has(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchMembers = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!workspaceId || !userId) {
      setMembers([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!isSilent && !membersCache.has(cacheKey)) {
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
        membersCache.set(cacheKey, resolved);
        setMembers(resolved);
      } else {
        const normalized = normalizeMemberProfiles(data || []);
        membersCache.set(cacheKey, normalized);
        setMembers(normalized);
      }
    } catch (err) {
      console.error('Error fetching workspace members:', err);
      setError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey, workspaceId, userId]);

  useEffect(() => {
    if (membersCache.has(cacheKey)) {
      setMembers(membersCache.get(cacheKey));
      setLoading(false);
    } else {
      setMembers([]);
    }
    fetchMembers();
  }, [cacheKey, fetchMembers]);

  const removeMember = async (memberId) => {
    const supabase = getSupabase();
    const { data: edgeData, error: edgeErr } = await supabase.functions.invoke(
      'admin-manage-workspace-user',
      {
        body: {
          action: 'remove',
          workspace_id: workspaceId,
          member_id: memberId,
        },
      }
    );

    if (edgeErr || !edgeData?.success) {
      const errMsg = edgeData?.error || edgeErr?.message || 'Failed to remove member';
      return { error: new Error(errMsg) };
    }

    await fetchMembers({ silent: true });
    return { error: null };
  };

  return {
    members,
    loading,
    refreshing,
    error,
    removeMember,
    refetch: fetchMembers,
  };
}
