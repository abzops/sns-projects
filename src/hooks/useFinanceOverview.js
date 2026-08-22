import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { normalizeFinancialSummary } from '../lib/finance.js';

const financeOverviewCache = new Map();

export function clearFinanceOverviewCache() {
  financeOverviewCache.clear();
}

/**
 * Hook to fetch workspace financial summary and project portfolio summaries.
 * 
 * Uses canonical P4 RPCs:
 * - public.get_workspace_financial_summary(p_workspace_id)
 * - public.get_project_financial_summary(p_project_id)
 * 
 * Implements strict user/workspace cache isolation and stale response discard.
 */
export function useFinanceOverview({ workspaceId, authorizationScopeKey, enabled = true }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`;
  const cached = userId && workspaceId ? financeOverviewCache.get(cacheKey) || null : null;

  const [activeCacheKey, setActiveCacheKey] = useState(cacheKey);
  const [summary, setSummary] = useState(() => cached?.summary || null);
  const [projectSummaries, setProjectSummaries] = useState(() => cached?.projectSummaries || []);
  const [isUnauthorized, setIsUnauthorized] = useState(() => cached?.isUnauthorized || false);
  const [loading, setLoading] = useState(() => !cached && enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const activeFetchIdRef = useRef(0);

  // Synchronize state when cache key shifts (e.g. workspace switch or user switch)
  useEffect(() => {
    if (cacheKey !== activeCacheKey) {
      setActiveCacheKey(cacheKey);
      const nextCached = financeOverviewCache.get(cacheKey) || null;
      if (nextCached) {
        setSummary(nextCached.summary);
        setProjectSummaries(nextCached.projectSummaries);
        setIsUnauthorized(nextCached.isUnauthorized);
        setLoading(false);
      } else {
        setSummary(null);
        setProjectSummaries([]);
        setIsUnauthorized(false);
        setLoading(enabled && Boolean(workspaceId && userId));
      }
      setError(null);
    }
  }, [cacheKey, activeCacheKey, enabled, workspaceId, userId]);

  const fetchFinanceData = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    const fetchId = ++activeFetchIdRef.current;

    if (!workspaceId || !userId || !enabled) {
      setSummary(null);
      setProjectSummaries([]);
      setIsUnauthorized(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (isSilent || financeOverviewCache.has(cacheKey)) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Fetch workspace financial summary
      const { data: wsSummaryData, error: wsError } = await supabase.rpc(
        'get_workspace_financial_summary',
        { p_workspace_id: workspaceId }
      );

      if (wsError) {
        throw wsError;
      }

      // Check authorization: backend returns NULL for unauthorized callers
      if (wsSummaryData === null) {
        if (fetchId !== activeFetchIdRef.current) return;
        const result = {
          summary: null,
          projectSummaries: [],
          isUnauthorized: true,
        };
        financeOverviewCache.set(cacheKey, result);
        setSummary(null);
        setProjectSummaries([]);
        setIsUnauthorized(true);
        return;
      }

      const normalizedWsSummary = normalizeFinancialSummary(wsSummaryData);

      // 2. Fetch workspace projects
      const { data: projectsData, error: projError } = await supabase
        .from('projects')
        .select(`
          id,
          name,
          color,
          project_status,
          created_at
        `)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });

      if (projError) {
        throw projError;
      }

      // 3. Fetch canonical project financial summaries in parallel
      const projects = projectsData || [];
      const projectSummaryResults = await Promise.all(
        projects.map(async (project) => {
          try {
            const { data: projSummaryData, error: pSummError } = await supabase.rpc(
              'get_project_financial_summary',
              { p_project_id: project.id }
            );

            if (pSummError) {
              console.warn(`Failed to fetch financial summary for project ${project.id}:`, pSummError);
              return {
                project,
                summary: null,
                error: true,
                errorMessage: pSummError.message,
              };
            }

            return {
              project,
              summary: normalizeFinancialSummary(projSummaryData),
              error: false,
            };
          } catch (pErr) {
            console.warn(`Exception fetching financial summary for project ${project.id}:`, pErr);
            return {
              project,
              summary: null,
              error: true,
              errorMessage: pErr.message || 'Error',
            };
          }
        })
      );

      // Discard stale in-flight responses
      if (fetchId !== activeFetchIdRef.current) return;

      const result = {
        summary: normalizedWsSummary,
        projectSummaries: projectSummaryResults,
        isUnauthorized: false,
      };

      financeOverviewCache.set(cacheKey, result);
      setSummary(normalizedWsSummary);
      setProjectSummaries(projectSummaryResults);
      setIsUnauthorized(false);
    } catch (err) {
      if (fetchId !== activeFetchIdRef.current) return;
      console.error('Error fetching finance overview:', err);
      setError(err.message || 'Failed to load finance data');
      if (!financeOverviewCache.has(cacheKey)) {
        setSummary(null);
        setProjectSummaries([]);
      }
    } finally {
      if (fetchId === activeFetchIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [cacheKey, enabled, userId, workspaceId]);

  useEffect(() => {
    fetchFinanceData({ silent: Boolean(cached) });
  }, [fetchFinanceData, cached]);

  const refetch = useCallback(() => {
    return fetchFinanceData({ silent: true });
  }, [fetchFinanceData]);

  return {
    summary,
    projectSummaries,
    isUnauthorized,
    loading,
    refreshing,
    error,
    refetch,
    cacheKey,
  };
}
