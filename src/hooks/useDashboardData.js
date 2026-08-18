import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSupabase } from '../lib/supabase';

const dashboardDataCache = new Map();

const EMPTY_DATA = Object.freeze({
  tasks: [],
  raciRows: [],
  subtasks: [],
  processInstances: [],
  admin: { members: [], systemRoles: [] },
});

function unwrap(result, label) {
  if (result.error) {
    result.error.dashboardSource = label;
    throw result.error;
  }
  return result.data || [];
}

export function useDashboardData({
  workspaceId,
  authorizationScopeKey,
  projects = [],
  projectsLoading = false,
  includeAdministration = false,
}) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const projectIdsKey = projects.map((project) => project.id).sort().join(',');
  const cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`;
  const cached = dashboardDataCache.get(cacheKey);
  const [activeCacheKey, setActiveCacheKey] = useState(cacheKey);
  const [data, setData] = useState(() => cached || EMPTY_DATA);
  const [loading, setLoading] = useState(() => !cached);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchDashboardData = useCallback(async (options = {}) => {
    const silent = options.silent ?? false;
    if (!workspaceId || !userId || !authorizationScopeKey || projectsLoading) {
      if (!projectsLoading) {
        setData(EMPTY_DATA);
        setLoading(false);
      }
      return;
    }

    if (silent || dashboardDataCache.has(cacheKey)) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      const scopedProjectIds = projectIdsKey ? projectIdsKey.split(',') : [];
      const tasksPromise = scopedProjectIds.length > 0
        ? supabase
            .from('tasks')
            .select(`
              id,
              project_id,
              title,
              description,
              status_id,
              priority,
              assignee_id,
              due_date,
              process_instance_id,
              workflow_state,
              created_at,
              projects:project_id (
                id,
                name,
                color,
                workspace_id
              ),
              task_statuses:status_id (
                id,
                name,
                color,
                system_code
              )
            `)
            .in('project_id', scopedProjectIds)
            .order('due_date', { ascending: true })
        : Promise.resolve({ data: [], error: null });

      const processPromise = supabase
        .from('process_instances')
        .select(`
          id,
          workspace_id,
          instance_name,
          owner_id,
          started_by,
          started_at,
          due_date,
          project_id,
          status,
          defined_processes:defined_processes!process_instances_defined_process_id_fkey (
            id,
            name,
            code
          )
        `)
        .eq('workspace_id', workspaceId)
        .order('started_at', { ascending: false });

      const membersPromise = includeAdministration
        ? supabase
            .from('workspace_members')
            .select('id, user_id, role, status')
            .eq('workspace_id', workspaceId)
        : Promise.resolve({ data: [], error: null });
      const systemRolesPromise = includeAdministration
        ? supabase
            .from('user_system_roles')
            .select('id, user_id, role')
            .eq('workspace_id', workspaceId)
        : Promise.resolve({ data: [], error: null });

      const [tasksResult, processResult, membersResult, systemRolesResult] = await Promise.all([
        tasksPromise,
        processPromise,
        membersPromise,
        systemRolesPromise,
      ]);

      const tasks = unwrap(tasksResult, 'tasks');
      const processInstances = unwrap(processResult, 'process_instances');
      const members = unwrap(membersResult, 'workspace_members');
      const systemRoles = unwrap(systemRolesResult, 'user_system_roles');
      const taskIds = tasks.map((task) => task.id);

      const [raciResult, subtasksResult] = taskIds.length > 0
        ? await Promise.all([
            supabase
              .from('task_raci_assignments')
              .select('id, task_id, raci_role, user_id, department_id, response_required')
              .in('task_id', taskIds),
            supabase
              .from('subtasks')
              .select('id, task_id, title, status, assignee_id, due_date')
              .in('task_id', taskIds),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];

      const next = {
        tasks,
        raciRows: unwrap(raciResult, 'task_raci_assignments'),
        subtasks: unwrap(subtasksResult, 'subtasks'),
        processInstances,
        admin: { members, systemRoles },
      };

      dashboardDataCache.set(cacheKey, next);
      setData(next);
    } catch (fetchError) {
      console.error('Error loading role-aware Dashboard data:', fetchError);
      setError(fetchError);
      if (!dashboardDataCache.has(cacheKey)) setData(EMPTY_DATA);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authorizationScopeKey, cacheKey, includeAdministration, projectIdsKey, projectsLoading, userId, workspaceId]);

  useEffect(() => {
    const scopedCache = dashboardDataCache.get(cacheKey);
    setActiveCacheKey(cacheKey);
    setData(scopedCache || EMPTY_DATA);
    setLoading(!scopedCache);
    setError(null);
    fetchDashboardData({ silent: Boolean(scopedCache) });
  }, [cacheKey, fetchDashboardData]);

  const scopeIsCurrent = activeCacheKey === cacheKey;
  const scopedData = scopeIsCurrent ? data : dashboardDataCache.get(cacheKey) || EMPTY_DATA;

  return {
    ...scopedData,
    loading: !scopeIsCurrent || loading,
    refreshing: scopeIsCurrent && refreshing,
    error: scopeIsCurrent ? error : null,
    refetch: fetchDashboardData,
    cacheKey,
  };
}
