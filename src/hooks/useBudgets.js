import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { clearFinanceOverviewCache } from './useFinanceOverview.js';

const budgetsCache = new Map(); // cacheKey -> budgets[]

export function clearBudgetsCache() {
  budgetsCache.clear();
}

/**
 * Hook to manage workspace budgets (query, cache, create, and update).
 * 
 * Interacts with public.budgets governed by P4 Row Level Security:
 * - INSERT and UPDATE require private.can_manage_budgets(workspace_id) = true
 * - Database triggers validate hierarchy invariants and write budget_audit_logs
 */
export function useBudgets(workspaceId, { enabled = true } = {}) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anon'}:${workspaceId || 'none'}`;

  const [budgets, setBudgets] = useState(() => (workspaceId ? budgetsCache.get(cacheKey) || [] : []));
  const [loading, setLoading] = useState(() => (enabled && workspaceId ? !budgetsCache.has(cacheKey) : false));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const activeFetchIdRef = useRef(0);

  const fetchBudgets = useCallback(
    async (options = {}) => {
      const isSilent = options?.silent ?? false;
      if (!workspaceId || !userId || !enabled) {
        setBudgets([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const fetchId = ++activeFetchIdRef.current;

      try {
        if (!isSilent && !budgetsCache.has(cacheKey)) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);

        const { data, error: bErr } = await supabase
          .from('budgets')
          .select('*')
          .eq('workspace_id', workspaceId);

        if (fetchId !== activeFetchIdRef.current) return;

        if (bErr) {
          throw bErr;
        }

        const list = data || [];
        budgetsCache.set(cacheKey, list);
        setBudgets(list);
      } catch (err) {
        if (fetchId !== activeFetchIdRef.current) return;
        console.error('[useBudgets] fetchBudgets error:', err);
        setError(err.message || 'Failed to load budgets.');
      } finally {
        if (fetchId === activeFetchIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [workspaceId, userId, enabled, cacheKey]
  );

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  /**
   * Save (create or update) a budget row.
   *
   * @param {Object} params
   * @param {string} params.entityType - 'project' | 'phase' | 'task_list'
   * @param {string} params.projectId - UUID
   * @param {string} [params.phaseId] - UUID (required if entityType is 'phase' or 'task_list')
   * @param {string} [params.taskListId] - UUID (required if entityType is 'task_list')
   * @param {number} params.baseBudget - Non-negative number
   * @param {number} [params.safetyBuffer=0] - Non-negative number
   * @param {string} [params.existingBudgetId] - UUID if editing
   */
  const saveBudget = useCallback(
    async ({
      entityType,
      projectId,
      phaseId = null,
      taskListId = null,
      baseBudget,
      safetyBuffer = 0,
      existingBudgetId = null,
    }) => {
      if (!workspaceId) {
        return { success: false, error: 'No workspace context provided.' };
      }

      const parsedBase = Number(baseBudget);
      const parsedBuffer = Number(safetyBuffer || 0);

      if (isNaN(parsedBase) || parsedBase < 0) {
        return { success: false, error: 'Base Budget must be a non-negative number.' };
      }

      if (isNaN(parsedBuffer) || parsedBuffer < 0) {
        return { success: false, error: 'Safety Buffer must be a non-negative number.' };
      }

      try {
        let resultData = null;

        if (existingBudgetId) {
          // UPDATE authoritative financial amounts only
          const { data, error: uErr } = await supabase
            .from('budgets')
            .update({
              base_budget: parsedBase,
              safety_buffer: parsedBuffer,
            })
            .eq('id', existingBudgetId)
            .eq('workspace_id', workspaceId)
            .select()
            .single();

          if (uErr) throw uErr;
          resultData = data;
        } else {
          // INSERT new authoritative budget row
          const insertPayload = {
            workspace_id: workspaceId,
            entity_type: entityType,
            project_id: projectId,
            phase_id: phaseId || null,
            task_list_id: taskListId || null,
            base_budget: parsedBase,
            safety_buffer: parsedBuffer,
          };

          const { data, error: iErr } = await supabase
            .from('budgets')
            .insert(insertPayload)
            .select()
            .single();

          if (iErr) throw iErr;
          resultData = data;
        }

        // Invalidate caches & refresh
        budgetsCache.delete(cacheKey);
        clearFinanceOverviewCache();
        await fetchBudgets({ silent: true });

        return { success: true, data: resultData };
      } catch (err) {
        console.error('[useBudgets] saveBudget error:', err);
        return {
          success: false,
          error: err.message || 'Failed to save budget.',
        };
      }
    },
    [workspaceId, cacheKey, fetchBudgets]
  );

  return {
    budgets,
    loading,
    refreshing,
    error,
    refetch: fetchBudgets,
    saveBudget,
  };
}
