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

      const [{ data: deptData, error: fetchError }, { data: memData, error: memError }] = await Promise.all([
        supabase
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
          .order('name', { ascending: true }),
        supabase
          .from('department_memberships')
          .select(`
            id,
            department_id,
            user_id,
            role,
            is_primary,
            is_active,
            profiles:user_id (
              id,
              full_name,
              avatar_url
            )
          `)
          .eq('workspace_id', workspaceId)
          .eq('is_active', true)
      ]);

      if (fetchError) throw fetchError;
      if (memError) console.warn('Department memberships fetch error:', memError);

      const memsByDept = new Map();
      for (const m of memData || []) {
        if (!memsByDept.has(m.department_id)) memsByDept.set(m.department_id, []);
        memsByDept.get(m.department_id).push(m);
      }

      const enriched = (deptData || []).map((dept) => {
        const deptMems = memsByDept.get(dept.id) || [];
        const heads = deptMems.filter((m) => m.role === 'head');
        const leads = deptMems.filter((m) => m.role === 'lead');
        return {
          ...dept,
          members: deptMems,
          member_count: deptMems.length,
          heads,
          leads,
          head: heads[0] || null,
        };
      });

      departmentsCache.set(workspaceId, enriched);
      setDepartments(enriched);
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
