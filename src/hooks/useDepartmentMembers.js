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

  return {
    members,
    loading,
    error,
    refetch: fetchMembers,
  };
}
