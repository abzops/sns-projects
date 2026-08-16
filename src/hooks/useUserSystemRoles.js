import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useUserSystemRoles(workspaceId) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRoles = useCallback(async () => {
    if (!workspaceId) {
      setRoles([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('user_system_roles')
        .select(`
          id,
          workspace_id,
          user_id,
          role,
          created_by,
          created_at,
          profiles:user_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      setRoles(data || []);
    } catch (err) {
      console.error('Error fetching user system roles:', err);
      setError(err.message || 'Failed to load system roles');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  return {
    roles,
    loading,
    error,
    refetch: fetchRoles,
  };
}
