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

  const assignRole = async (userId, role) => {
    if (!workspaceId || !userId || !role) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from('user_system_roles')
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          role,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      await fetchRoles();
      return data;
    } catch (err) {
      console.error('Error assigning system role:', err);
      throw err;
    }
  };

  const removeRole = async (roleId) => {
    try {
      const { error: deleteError } = await supabase
        .from('user_system_roles')
        .delete()
        .eq('id', roleId);

      if (deleteError) throw deleteError;
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
    } catch (err) {
      console.error('Error removing system role:', err);
      throw err;
    }
  };

  return {
    roles,
    loading,
    error,
    assignRole,
    removeRole,
    refetch: fetchRoles,
  };
}
