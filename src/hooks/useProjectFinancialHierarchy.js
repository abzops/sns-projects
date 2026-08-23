import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { normalizeProjectFinancialHierarchy } from '../lib/finance.js';

export { normalizeProjectFinancialHierarchy };

const projectFinancialHierarchyCache = new Map(); // scopeKey -> normalizedHierarchy

export function clearProjectFinancialHierarchyCache() {
  projectFinancialHierarchyCache.clear();
}

/**
 * Hook to retrieve and cache canonical Project Financial Hierarchy Read Model.
 *
 * Enforces:
 * - Single bounded project RPC (public.get_project_financial_hierarchy)
 * - Strict userId + workspaceId + projectId + authorizationScopeKey cache isolation
 * - Render-time scope invariant: immediately yields null on scope mismatch (zero stale frame flash)
 * - Request generation token to discard in-flight stale responses
 * - Fail-closed on disabled, missing scope, or unauthorized access
 */
export function useProjectFinancialHierarchy(
  workspaceId,
  projectId,
  authorizationScopeKey = 'default',
  { enabled = true } = {}
) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const hasPrerequisites = Boolean(
    enabled &&
    userId &&
    workspaceId &&
    projectId
  );

  const currentScopeKey = hasPrerequisites
    ? `${userId}:${workspaceId}:${projectId}:${authorizationScopeKey || 'default'}`
    : null;

  const cached = currentScopeKey ? projectFinancialHierarchyCache.get(currentScopeKey) || null : null;

  const [activeCacheKey, setActiveCacheKey] = useState(currentScopeKey);
  const [dataState, setDataState] = useState(() => cached);
  const [loading, setLoading] = useState(() => hasPrerequisites && !cached);
  const [error, setError] = useState(null);

  const activeFetchIdRef = useRef(0);

  // Render-time scope invariant
  const isCurrentScope = Boolean(
    hasPrerequisites &&
    activeCacheKey === currentScopeKey
  );

  // Synchronous cache flush on scope shift during render
  if (hasPrerequisites && activeCacheKey !== currentScopeKey) {
    setActiveCacheKey(currentScopeKey);
    const existingCache = projectFinancialHierarchyCache.get(currentScopeKey) || null;
    setDataState(existingCache);
    setLoading(!existingCache);
    setError(null);
  } else if (!hasPrerequisites && activeCacheKey !== null) {
    setActiveCacheKey(null);
    setDataState(null);
    setLoading(false);
    setError(null);
  }

  const fetchHierarchy = useCallback(async () => {
    if (!hasPrerequisites || !currentScopeKey) {
      setDataState(null);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchId = ++activeFetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'get_project_financial_hierarchy',
        { p_project_id: projectId }
      );

      // Stale token / scope rejection
      if (fetchId !== activeFetchIdRef.current || currentScopeKey !== `${userId}:${workspaceId}:${projectId}:${authorizationScopeKey || 'default'}`) {
        return;
      }

      if (rpcError) {
        throw rpcError;
      }

      const normalized = normalizeProjectFinancialHierarchy(data);
      projectFinancialHierarchyCache.set(currentScopeKey, normalized);

      setDataState(normalized);
      setActiveCacheKey(currentScopeKey);
      setError(null);
    } catch (err) {
      if (fetchId !== activeFetchIdRef.current) return;
      setError(err);
      setDataState(null);
    } finally {
      if (fetchId === activeFetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [hasPrerequisites, currentScopeKey, userId, workspaceId, projectId, authorizationScopeKey]);

  useEffect(() => {
    if (hasPrerequisites) {
      fetchHierarchy();
    }
  }, [fetchHierarchy, hasPrerequisites]);

  const safeLoading = hasPrerequisites ? (!isCurrentScope || loading) : false;
  const safeHierarchy = isCurrentScope ? dataState : null;
  const safeError = isCurrentScope ? error : null;

  return {
    loading: safeLoading,
    error: safeError,
    financialHierarchy: safeHierarchy,
    refetch: fetchHierarchy,
  };
}
