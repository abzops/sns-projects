import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useSubtasks(taskId) {
  const [subtasks, setSubtasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSubtasks = useCallback(async () => {
    if (!taskId) {
      setSubtasks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: stErr } = await supabase
        .from('subtasks')
        .select(`
          *,
          assignee:assignee_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('task_id', taskId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (stErr) throw stErr;
      setSubtasks(data || []);
    } catch (err) {
      console.error('Error fetching subtasks:', err);
      setError(err.message || 'Failed to load subtasks');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchSubtasks();
  }, [fetchSubtasks]);

  const createSubtask = async ({ title, description, assignee_id, due_date, start_date }) => {
    if (!taskId || !title?.trim()) {
      return { data: null, error: new Error('Task ID and Subtask title are required') };
    }

    try {
      const position = subtasks.length;
      const { data, error: insertErr } = await supabase
        .from('subtasks')
        .insert({
          task_id: taskId,
          title: title.trim(),
          description: description?.trim() || null,
          assignee_id: assignee_id || null,
          due_date: due_date || null,
          start_date: start_date || null,
          status: 'todo',
          position,
        })
        .select(`
          *,
          assignee:assignee_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .single();

      if (insertErr) throw insertErr;
      await fetchSubtasks();
      return { data, error: null };
    } catch (err) {
      console.error('Error creating subtask:', err);
      return { data: null, error: err };
    }
  };

  const updateSubtask = async (id, updates) => {
    try {
      const { data, error: updateErr } = await supabase
        .from('subtasks')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(`
          *,
          assignee:assignee_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .single();

      if (updateErr) throw updateErr;
      await fetchSubtasks();
      return { data, error: null };
    } catch (err) {
      console.error('Error updating subtask:', err);
      return { data: null, error: err };
    }
  };

  const reopenSubtask = async (id) => {
    return updateSubtask(id, { status: 'todo' });
  };

  const toggleSubtask = async (id, currentStatus) => {
    if (currentStatus === 'done') {
      return reopenSubtask(id);
    }
    // Note: Transitions to 'done' must route through completeSubtaskWithExpense RPC
    return { data: null, error: new Error('Subtask completion requires the completion runtime.') };
  };

  const deleteSubtask = async (id) => {
    try {
      const { error: deleteErr } = await supabase
        .from('subtasks')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;
      await fetchSubtasks();
      return { error: null };
    } catch (err) {
      console.error('Error deleting subtask:', err);
      return { error: err };
    }
  };

  const eligibleSubtasks = subtasks.filter((st) => st.status !== 'cancelled');
  const doneSubtasks = eligibleSubtasks.filter((st) => st.status === 'done');
  const totalCount = eligibleSubtasks.length;
  const doneCount = doneSubtasks.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return {
    subtasks,
    loading,
    error,
    doneCount,
    totalCount,
    progress,
    createSubtask,
    updateSubtask,
    reopenSubtask,
    toggleSubtask,
    deleteSubtask,
    refetch: fetchSubtasks,
  };
}

