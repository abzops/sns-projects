import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const taskListsCache = new Map(); // `${projectId}:${phaseId || 'all'}` -> taskLists[]

export function useTaskLists(projectId, phaseId = null) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anonymous'}:${projectId || 'none'}:${phaseId || 'all'}`;
  const [taskLists, setTaskLists] = useState(() => taskListsCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(() => !taskListsCache.has(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchTaskLists = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!projectId || !userId) {
      setTaskLists([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (!isSilent && !taskListsCache.has(cacheKey)) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      // 1. Query task lists
      let query = supabase
        .from('task_lists')
        .select('*')
        .eq('project_id', projectId);

      if (phaseId) {
        query = query.eq('phase_id', phaseId);
      }

      const { data: listData, error: lErr } = await query
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (lErr) throw lErr;

      // 2. Fetch tasks under these task lists to compute progress
      const { data: taskData, error: tErr } = await supabase
        .from('tasks')
        .select(`
          id,
          task_list_id,
          task_statuses:status_id (
            id,
            system_code,
            name
          )
        `)
        .eq('project_id', projectId)
        .not('task_list_id', 'is', null);

      if (tErr) throw tErr;

      // Group tasks by task_list_id
      const statsByList = new Map();
      for (const t of taskData || []) {
        const tlId = t.task_list_id;
        if (!statsByList.has(tlId)) {
          statsByList.set(tlId, { total: 0, completed: 0 });
        }
        const stats = statsByList.get(tlId);
        const sysCode = t.task_statuses?.system_code || '';
        const isCancelled = sysCode === 'cancelled';
        const isDone = sysCode === 'done';

        if (!isCancelled) {
          stats.total += 1;
          if (isDone) {
            stats.completed += 1;
          }
        }
      }

      const enriched = (listData || []).map((tl) => {
        const stats = statsByList.get(tl.id) || { total: 0, completed: 0 };
        const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

        return {
          ...tl,
          task_count: stats.total,
          completed_count: stats.completed,
          progress,
        };
      });

      taskListsCache.set(cacheKey, enriched);
      setTaskLists(enriched);
    } catch (err) {
      console.error('Error fetching task lists:', err);
      setError(err.message || 'Failed to load task lists');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, phaseId, cacheKey, userId]);

  useEffect(() => {
    if (taskListsCache.has(cacheKey)) {
      setTaskLists(taskListsCache.get(cacheKey));
      setLoading(false);
    }
    fetchTaskLists();
  }, [fetchTaskLists, cacheKey]);

  const createTaskList = async ({ phaseId: targetPhaseId, name, description }) => {
    const finalPhaseId = targetPhaseId || phaseId;
    if (!projectId || !finalPhaseId || !name?.trim()) {
      return { data: null, error: new Error('Project ID, Phase ID, and Task List name are required') };
    }

    try {
      const position = taskLists.length;
      const { data, error: insertErr } = await supabase
        .from('task_lists')
        .insert({
          project_id: projectId,
          phase_id: finalPhaseId,
          name: name.trim(),
          description: description?.trim() || null,
          position,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      await fetchTaskLists({ silent: true });
      return { data, error: null };
    } catch (err) {
      console.error('Error creating task list:', err);
      return { data: null, error: err };
    }
  };

  const updateTaskList = async (id, updates) => {
    try {
      const { data, error: updateErr } = await supabase
        .from('task_lists')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      await fetchTaskLists({ silent: true });
      return { data, error: null };
    } catch (err) {
      console.error('Error updating task list:', err);
      return { data: null, error: err };
    }
  };

  const deleteTaskList = async (id) => {
    try {
      const { error: deleteErr } = await supabase
        .from('task_lists')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;
      await fetchTaskLists({ silent: true });
      return { error: null };
    } catch (err) {
      console.error('Error deleting task list:', err);
      return { error: err };
    }
  };

  return {
    taskLists,
    loading,
    refreshing,
    error,
    createTaskList,
    updateTaskList,
    deleteTaskList,
    refetch: fetchTaskLists,
  };
}
