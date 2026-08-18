import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSupabase } from '../lib/supabase';

export function useProjectProcessInstances(projectId) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [processInstances, setProcessInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProcessInstances = useCallback(async () => {
    if (!projectId || !userId) {
      setProcessInstances([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: fetchError } = await supabase
      .from('process_instances')
      .select(`
        id,
        workspace_id,
        defined_process_id,
        defined_process_version_id,
        instance_name,
        owner_id,
        started_at,
        due_date,
        placement_type,
        project_id,
        phase_id,
        task_list_id,
        parent_task_id,
        status,
        completed_at,
        cancelled_at,
        defined_processes:defined_processes!process_instances_defined_process_id_fkey (
          id,
          name,
          code
        ),
        defined_process_versions:defined_process_versions!process_instances_defined_process_version_id_fkey (
          id,
          version_number
        )
      `)
      .eq('project_id', projectId)
      .order('started_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching project process instances:', fetchError);
      setError(fetchError);
      setProcessInstances([]);
      setLoading(false);
      return;
    }

    const progressResults = await Promise.all(
      (data || []).map(async (instance) => {
        const { data: progress, error: progressError } = await supabase.rpc(
          'get_process_instance_progress',
          { p_instance_id: instance.id }
        );
        return { instance, progress, progressError };
      })
    );

    const firstProgressError = progressResults.find((result) => result.progressError)?.progressError;
    if (firstProgressError) {
      console.error('Error fetching process progress:', firstProgressError);
      setError(firstProgressError);
    }

    setProcessInstances(
      progressResults.map(({ instance, progress, progressError }) => ({
        ...instance,
        progress: progressError ? null : Number(progress ?? 0),
      }))
    );
    setLoading(false);
  }, [projectId, userId]);

  useEffect(() => {
    fetchProcessInstances();
  }, [fetchProcessInstances]);

  return {
    processInstances,
    loading,
    error,
    refetch: fetchProcessInstances,
  };
}
