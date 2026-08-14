import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const departmentsCache = new Map(); // workspaceId -> departments[]

export function useDepartments(workspaceId) {
  const [departments, setDepartments] = useState(() => departmentsCache.get(workspaceId) || []);
  const [loading, setLoading] = useState(() => !departmentsCache.has(workspaceId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchDepartments = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!workspaceId) {
      setDepartments([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (!isSilent && !departmentsCache.has(workspaceId)) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
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
      const list = data || [];
      departmentsCache.set(workspaceId, list);
      setDepartments(list);
    } catch (err) {
      console.error('Error fetching departments:', err);
      setError(err.message || 'Failed to load departments');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (departmentsCache.has(workspaceId)) {
      setDepartments(departmentsCache.get(workspaceId));
      setLoading(false);
    }
    fetchDepartments();
  }, [fetchDepartments, workspaceId]);

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
      await fetchDepartments({ silent: true });
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
      setDepartments((prev) => {
        const next = prev.map((d) => (d.id === id ? data : d));
        departmentsCache.set(workspaceId, next);
        return next;
      });
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
      setDepartments((prev) => {
        const next = prev.filter((d) => d.id !== id);
        departmentsCache.set(workspaceId, next);
        return next;
      });
    } catch (err) {
      console.error('Error deleting department:', err);
      throw err;
    }
  };

  return {
    departments,
    loading,
    refreshing,
    error,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    refetch: fetchDepartments,
  };
}
