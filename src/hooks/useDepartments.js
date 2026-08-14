import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useDepartments(workspaceId) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDepartments = useCallback(async () => {
    if (!workspaceId) {
      setDepartments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('departments')
        .select(`
          id,
          workspace_id,
          code,
          name,
          description,
          color,
          is_active,
          created_by,
          created_at,
          updated_at
        `)
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;
      setDepartments(data || []);
    } catch (err) {
      console.error('Error fetching departments:', err);
      setError(err.message || 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const createDepartment = async ({ code, name, description = '', color = '#FDE215' }) => {
    if (!workspaceId || !code || !name) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const normalizedCode = code.trim().toUpperCase();

      const { data, error: insertError } = await supabase
        .from('departments')
        .insert({
          workspace_id: workspaceId,
          code: normalizedCode,
          name: name.trim(),
          description: description?.trim() || null,
          color: color || '#FDE215',
          is_active: true,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      await fetchDepartments();
      return data;
    } catch (err) {
      console.error('Error creating department:', err);
      throw err;
    }
  };

  const updateDepartment = async (id, updates) => {
    try {
      const payload = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      if (payload.code) {
        payload.code = payload.code.trim().toUpperCase();
      }

      const { data, error: updateError } = await supabase
        .from('departments')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;
      setDepartments((prev) => prev.map((d) => (d.id === id ? data : d)));
      return data;
    } catch (err) {
      console.error('Error updating department:', err);
      throw err;
    }
  };

  const deleteDepartment = async (id) => {
    try {
      const { error: deleteError } = await supabase
        .from('departments')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      setDepartments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error('Error deleting department:', err);
      throw err;
    }
  };

  return {
    departments,
    loading,
    error,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    refetch: fetchDepartments,
  };
}
