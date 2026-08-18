import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useRaci(taskId) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRaci = useCallback(async () => {
    if (!taskId) {
      setAssignments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('task_raci_assignments')
        .select(`
          id,
          task_id,
          raci_role,
          user_id,
          department_id,
          created_by,
          created_at,
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
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      setAssignments(data || []);
    } catch (err) {
      console.error('Error fetching RACI assignments:', err);
      setError(err.message || 'Failed to load ownership and assignments');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchRaci();
  }, [fetchRaci]);

  const assignRaci = async ({ raciRole, userId = null, departmentId = null }) => {
    if (!taskId || !raciRole || (!userId && !departmentId)) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error: insertError } = await supabase
        .from('task_raci_assignments')
        .insert({
          task_id: taskId,
          raci_role: raciRole,
          user_id: userId || null,
          department_id: departmentId || null,
          created_by: user?.id || null,
        })
        .select(`
          id,
          task_id,
          raci_role,
          user_id,
          department_id,
          created_by,
          created_at,
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
        .single();

      if (insertError) throw insertError;
      setAssignments((prev) => [...prev, data]);
      return data;
    } catch (err) {
      console.error('Error assigning RACI:', err);
      throw err;
    }
  };

  const removeRaci = async (id) => {
    try {
      const { error: deleteError } = await supabase
        .from('task_raci_assignments')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      setAssignments((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Error removing RACI assignment:', err);
      throw err;
    }
  };

  // Helper groupings
  const responsible = assignments.filter((a) => a.raci_role === 'R');
  const accountable = assignments.find((a) => a.raci_role === 'A') || null;
  const consulted = assignments.filter((a) => a.raci_role === 'C');
  const informed = assignments.filter((a) => a.raci_role === 'I');

  return {
    assignments,
    responsible,
    accountable,
    consulted,
    informed,
    loading,
    error,
    assignRaci,
    removeRaci,
    refetch: fetchRaci,
  };
}
