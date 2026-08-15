import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const processesCache = new Map(); // workspaceId -> processes[]

export function useDefinedProcesses(workspaceId) {
  const [processes, setProcesses] = useState(() => (workspaceId ? processesCache.get(workspaceId) || [] : []));
  const [loading, setLoading] = useState(() => (workspaceId ? !processesCache.has(workspaceId) : false));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchProcesses = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!workspaceId) {
      setProcesses([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (!isSilent && !processesCache.has(workspaceId)) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      // 1. Fetch defined processes
      const { data: procData, error: pErr } = await supabase
        .from('defined_processes')
        .select(`
          id,
          workspace_id,
          department_id,
          name,
          code,
          description,
          process_owner_id,
          is_active,
          created_at,
          updated_at,
          departments:department_id (
            id,
            name,
            code,
            color
          ),
          profiles:process_owner_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });

      if (pErr) throw pErr;

      if (!procData || procData.length === 0) {
        processesCache.set(workspaceId, []);
        setProcesses([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const procIds = procData.map((p) => p.id);

      // 2. Fetch versions for these processes
      const { data: verData, error: vErr } = await supabase
        .from('defined_process_versions')
        .select(`
          id,
          defined_process_id,
          version_number,
          status,
          change_summary,
          published_by,
          published_at,
          created_at
        `)
        .in('defined_process_id', procIds)
        .order('version_number', { ascending: false });

      if (vErr) throw vErr;

      const verIds = (verData || []).map((v) => v.id);

      // 3. Fetch steps count per version
      let stepCountsByVer = {};
      if (verIds.length > 0) {
        const { data: stepsData, error: sErr } = await supabase
          .from('defined_process_steps')
          .select('id, version_id, sequence_order, approval_required, consultation_required')
          .in('version_id', verIds);

        if (!sErr && stepsData) {
          stepsData.forEach((s) => {
            stepCountsByVer[s.version_id] = (stepCountsByVer[s.version_id] || 0) + 1;
          });
        }
      }

      // Group versions by process
      const enriched = procData.map((proc) => {
        const versions = (verData || [])
          .filter((v) => v.defined_process_id === proc.id)
          .map((v) => ({
            ...v,
            step_count: stepCountsByVer[v.id] || 0,
          }));

        const publishedVersion = versions.find((v) => v.status === 'published') || null;
        const draftVersion = versions.find((v) => v.status === 'draft') || null;
        const activeVersion = publishedVersion || draftVersion || versions[0] || null;

        return {
          ...proc,
          versions,
          published_version: publishedVersion,
          draft_version: draftVersion,
          active_version: activeVersion,
          step_count: activeVersion ? activeVersion.step_count : 0,
        };
      });

      processesCache.set(workspaceId, enriched);
      setProcesses(enriched);
    } catch (err) {
      console.error('[useDefinedProcesses] Error fetching processes:', err);
      setError(err.message || 'Failed to load defined processes.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  // RPC: Publish version
  const publishVersion = async (versionId) => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('publish_defined_process_version', {
        p_version_id: versionId,
      });
      if (rpcErr) throw rpcErr;
      await fetchProcesses({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useDefinedProcesses] publishVersion error:', err);
      return { success: false, error: err.message || 'Failed to publish version.' };
    }
  };

  // RPC: Start process instance
  const startProcess = async ({ versionId, projectId, milestoneId, instanceName, raciOverrides = null }) => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('start_defined_process', {
        p_version_id: versionId,
        p_project_id: projectId,
        p_milestone_id: milestoneId,
        p_instance_name: instanceName,
        p_raci_overrides: raciOverrides,
      });
      if (rpcErr) throw rpcErr;
      await fetchProcesses({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useDefinedProcesses] startProcess error:', err);
      return { success: false, error: err.message || 'Failed to start process.' };
    }
  };

  return {
    processes,
    loading,
    refreshing,
    error,
    refetch: fetchProcesses,
    publishVersion,
    startProcess,
  };
}
