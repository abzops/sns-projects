import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const phasesCache = new Map(); // projectId -> phases[]

export function usePhases(projectId) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anonymous'}:${projectId || 'none'}`;
  const [phases, setPhases] = useState(() => phasesCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(() => !phasesCache.has(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchPhases = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!projectId || !userId) {
      setPhases([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (!isSilent && !phasesCache.has(cacheKey)) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      // 1. Fetch phases
      const { data: phaseData, error: pErr } = await supabase
        .from('phases')
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (pErr) throw pErr;

      // 2. Fetch all descendant tasks for this project to calculate progress
      const { data: taskData, error: tErr } = await supabase
        .from('tasks')
        .select(`
          id,
          phase_id,
          task_statuses:status_id (
            id,
            system_code,
            name
          )
        `)
        .eq('project_id', projectId)
        .not('phase_id', 'is', null);

      if (tErr) throw tErr;

      // Group tasks by phase_id and calculate progress
      const taskStatsByPhase = new Map();
      for (const t of taskData || []) {
        const pId = t.phase_id;
        if (!taskStatsByPhase.has(pId)) {
          taskStatsByPhase.set(pId, { total: 0, completed: 0 });
        }
        const stats = taskStatsByPhase.get(pId);
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

      const enriched = (phaseData || []).map((p) => {
        const stats = taskStatsByPhase.get(p.id) || { total: 0, completed: 0 };
        const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

        return {
          ...p,
          task_count: stats.total,
          completed_count: stats.completed,
          progress,
        };
      });

      phasesCache.set(cacheKey, enriched);
      setPhases(enriched);
    } catch (err) {
      console.error('Error fetching phases:', err);
      setError(err.message || 'Failed to load phases');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey, projectId, userId]);

  useEffect(() => {
    if (phasesCache.has(cacheKey)) {
      setPhases(phasesCache.get(cacheKey));
      setLoading(false);
    } else {
      setPhases([]);
    }
    fetchPhases();
  }, [cacheKey, fetchPhases]);

  const createPhase = async ({ name, description, start_date, end_date }) => {
    if (!projectId || !name?.trim()) return { data: null, error: new Error('Project ID and Phase name are required') };

    try {
      const position = phases.length;
      const { data, error: insertErr } = await supabase
        .from('phases')
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
      await fetchPhases({ silent: true });
      return { data, error: null };
    } catch (err) {
      console.error('Error creating phase:', err);
      return { data: null, error: err };
    }
  };

  const updatePhase = async (id, updates) => {
    try {
      const { data, error: updateErr } = await supabase
        .from('phases')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      await fetchPhases({ silent: true });
      return { data, error: null };
    } catch (err) {
      console.error('Error updating phase:', err);
      return { data: null, error: err };
    }
  };

  const deletePhase = async (id) => {
    try {
      const { error: deleteErr } = await supabase
        .from('phases')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;
      await fetchPhases({ silent: true });
      return { error: null };
    } catch (err) {
      console.error('Error deleting phase:', err);
      return { error: err };
    }
  };

  return {
    phases,
    loading,
    refreshing,
    error,
    createPhase,
    updatePhase,
    deletePhase,
    refetch: fetchPhases,
  };
}
