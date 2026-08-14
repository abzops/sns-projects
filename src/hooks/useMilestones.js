import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useMilestones(projectId) {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMilestones = useCallback(async () => {
    if (!projectId) {
      setMilestones([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 1. Fetch milestones
      const { data: milestoneData, error: mErr } = await supabase
        .from('milestones')
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (mErr) throw mErr;

      // 2. Fetch all descendant tasks for this project to calculate progress
      const { data: taskData, error: tErr } = await supabase
        .from('tasks')
        .select(`
          id,
          milestone_id,
          task_statuses:status_id (
            id,
            system_code,
            name
          )
        `)
        .eq('project_id', projectId)
        .not('milestone_id', 'is', null);

      if (tErr) throw tErr;

      // Group tasks by milestone_id and calculate progress
      const taskStatsByMilestone = new Map();
      for (const t of taskData || []) {
        const mId = t.milestone_id;
        if (!taskStatsByMilestone.has(mId)) {
          taskStatsByMilestone.set(mId, { total: 0, completed: 0 });
        }
        const stats = taskStatsByMilestone.get(mId);
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

      const enriched = (milestoneData || []).map((m) => {
        const stats = taskStatsByMilestone.get(m.id) || { total: 0, completed: 0 };
        const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

        return {
          ...m,
          task_count: stats.total,
          completed_count: stats.completed,
          progress,
        };
      });

      setMilestones(enriched);
    } catch (err) {
      console.error('Error fetching milestones:', err);
      setError(err.message || 'Failed to load milestones');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  const createMilestone = async ({ name, description, start_date, end_date }) => {
    if (!projectId || !name?.trim()) return { data: null, error: new Error('Project ID and Milestone name are required') };

    try {
      const position = milestones.length;
      const { data, error: insertErr } = await supabase
        .from('milestones')
        .insert({
          project_id: projectId,
          name: name.trim(),
          description: description?.trim() || null,
          start_date: start_date || null,
          end_date: end_date || null,
          position,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      await fetchMilestones();
      return { data, error: null };
    } catch (err) {
      console.error('Error creating milestone:', err);
      return { data: null, error: err };
    }
  };

  const updateMilestone = async (id, updates) => {
    try {
      const { data, error: updateErr } = await supabase
        .from('milestones')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      await fetchMilestones();
      return { data, error: null };
    } catch (err) {
      console.error('Error updating milestone:', err);
      return { data: null, error: err };
    }
  };

  const deleteMilestone = async (id) => {
    try {
      const { error: deleteErr } = await supabase
        .from('milestones')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;
      await fetchMilestones();
      return { error: null };
    } catch (err) {
      console.error('Error deleting milestone:', err);
      return { error: err };
    }
  };

  return {
    milestones,
    loading,
    error,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    refetch: fetchMilestones,
  };
}
