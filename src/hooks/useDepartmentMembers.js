import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useDepartmentMembers(departmentId) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMembers = useCallback(async () => {
    if (!departmentId) {
      setMembers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('department_memberships')
        .select(`
          id,
          workspace_id,
          department_id,
          user_id,
          role,
          is_primary,
          is_active,
          created_at,
          updated_at,
          profiles:user_id (
            id,
            full_name,
            avatar_url
          ),
          departments:department_id (
            id,
            code,
            name,
            color
          )
        `)
        .eq('department_id', departmentId)
        .order('role', { ascending: true });

      if (fetchError) throw fetchError;
      setMembers(data || []);
    } catch (err) {
      console.error('Error fetching department members:', err);
      setError(err.message || 'Failed to load department members');
    } finally {
      setLoading(false);
    }
  }, [departmentId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const addMember = async ({ workspaceId, userId, role = 'member', isPrimary = false }) => {
    if (!departmentId || !userId || !workspaceId) return null;
    try {
      const { data, error: insertError } = await supabase
        .from('department_memberships')
        .insert({
          workspace_id: workspaceId,
          department_id: departmentId,
          user_id: userId,
          role,
          is_primary: isPrimary,
          is_active: true,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      await fetchMembers();
      return data;
    } catch (err) {
      console.error('Error adding department member:', err);
      throw err;
    }
  };

  const updateMember = async (id, updates) => {
    try {
      const { data, error: updateError } = await supabase
        .from('department_memberships')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;
      setMembers((prev) => prev.map((m) => (m.id === id ? data : m)));
      return data;
    } catch (err) {
      console.error('Error updating department member:', err);
      throw err;
    }
  };

  const removeMember = async (id) => {
    try {
      const { error: deleteError } = await supabase
        .from('department_memberships')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error('Error removing department member:', err);
      throw err;
    }
  };

  return {
    members,
    loading,
    error,
    addMember,
    updateMember,
    removeMember,
    refetch: fetchMembers,
  };
}
