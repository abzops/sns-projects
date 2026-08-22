/**
 * SNS PROJECTS — USE FINANCE ALERTS HOOK
 *
 * Provides authenticated, workspace-scoped, realtime-synchronized Finance Alert
 * state management and authoritative RPC mutation triggers.
 *
 * Invariants & Access Control:
 * - Scoped by (userId, workspaceId, authorizationScopeKey, enabled)
 * - Queries public.finance_alerts directly under RLS
 * - Synchronous state flush on scope shift prevents stale persona/workspace data leaks
 * - Generation token (activeFetchIdRef) eliminates async fetch race conditions
 * - Realtime Postgres Changes subscription (INSERT, UPDATE, DELETE) with deduplication
 * - Manual refresh fallback preserves rendered list during background sync
 * - Zero direct client table DML; mutations delegate strictly to SECURITY INVOKER RPCs
 * - Per-alert mutation pending tracking prevents double submission
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useFinanceAlerts(
  workspaceId,
  authorizationScopeKey = 'default',
  { enabled = true } = {}
) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const activeScopeKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`;
  const [activeCacheKey, setActiveCacheKey] = useState(activeScopeKey);

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(enabled && userId && workspaceId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Track pending mutation per alert: { alertId, action: 'acknowledge' | 'resolve' }
  const [pendingAlertAction, setPendingAlertAction] = useState(null);

  const activeFetchIdRef = useRef(0);
  const channelRef = useRef(null);

  // 1. Synchronously isolate state when scope key shifts or when enabled becomes false
  useEffect(() => {
    if (activeScopeKey !== activeCacheKey || !enabled) {
      activeFetchIdRef.current++;
      setActiveCacheKey(activeScopeKey);
      setAlerts([]);
      setError(null);
      setRefreshing(false);
      setPendingAlertAction(null);
      setLoading(Boolean(enabled && userId && workspaceId));

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    }
  }, [activeScopeKey, activeCacheKey, enabled, userId, workspaceId]);

  // 2. Authoritative Fetch from public.finance_alerts under RLS
  const fetchAlerts = useCallback(
    async ({ isRefresh = false } = {}) => {
      if (!userId || !workspaceId || !enabled) {
        setAlerts([]);
        setLoading(false);
        setRefreshing(false);
        setError(null);
        return;
      }

      const fetchId = ++activeFetchIdRef.current;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const { data, error: queryError } = await supabase
          .from('finance_alerts')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('last_breached_at', { ascending: false });

        if (fetchId !== activeFetchIdRef.current) return;

        if (queryError) {
          throw queryError;
        }

        setAlerts(Array.isArray(data) ? data : []);
      } catch (err) {
        if (fetchId !== activeFetchIdRef.current) return;
        console.error('[useFinanceAlerts] Failed to fetch finance alerts:', err);
        setError(err?.message || 'Failed to load Finance Alerts');
        if (!isRefresh) {
          setAlerts([]);
        }
      } finally {
        if (fetchId === activeFetchIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [userId, workspaceId, enabled]
  );

  // Initial fetch on mount or scope change
  useEffect(() => {
    if (enabled && userId && workspaceId) {
      fetchAlerts();
    }
  }, [enabled, userId, workspaceId, activeScopeKey, fetchAlerts]);

  // 3. Realtime Postgres Changes Subscription
  useEffect(() => {
    if (!userId || !workspaceId || !enabled) return;

    const channelName = `finance-alerts-${userId}-${workspaceId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'finance_alerts',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newAlert = payload.new;
            if (newAlert && newAlert.workspace_id === workspaceId) {
              setAlerts((prev) => {
                const exists = prev.some((a) => a.id === newAlert.id);
                if (exists) {
                  return prev.map((a) => (a.id === newAlert.id ? { ...a, ...newAlert } : a));
                }
                return [newAlert, ...prev];
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new;
            if (updated && updated.workspace_id === workspaceId) {
              setAlerts((prev) =>
                prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
              );
            }
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old?.id;
            if (deletedId) {
              setAlerts((prev) => prev.filter((a) => a.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, workspaceId, enabled]);

  // 4. Acknowledge Alert Mutation (Calls public.acknowledge_finance_alert)
  const acknowledgeAlert = useCallback(
    async (alertId) => {
      if (!alertId || pendingAlertAction) return { success: false };

      setPendingAlertAction({ alertId, action: 'acknowledge' });
      try {
        const { data, error: rpcError } = await supabase.rpc('acknowledge_finance_alert', {
          p_alert_id: alertId,
        });

        if (rpcError) {
          throw rpcError;
        }

        // Authoritative immediate merge + realtime convergence
        setAlerts((prev) =>
          prev.map((a) => {
            if (a.id === alertId) {
              const returnedAlert = data?.alert || data || {};
              return {
                ...a,
                lifecycle_status: 'acknowledged',
                acknowledged_at: returnedAlert.acknowledged_at || new Date().toISOString(),
                ...returnedAlert,
              };
            }
            return a;
          })
        );

        return { success: true, data };
      } catch (err) {
        console.error('[useFinanceAlerts] acknowledge_finance_alert failed:', err);
        // If state desynchronized, trigger background refresh
        fetchAlerts({ isRefresh: true });
        throw err;
      } finally {
        setPendingAlertAction(null);
      }
    },
    [pendingAlertAction, fetchAlerts]
  );

  // 5. Resolve Alert Mutation (Calls public.resolve_finance_alert)
  const resolveAlert = useCallback(
    async (alertId, resolutionNote = null) => {
      if (!alertId || pendingAlertAction) return { success: false };

      setPendingAlertAction({ alertId, action: 'resolve' });
      try {
        const { data, error: rpcError } = await supabase.rpc('resolve_finance_alert', {
          p_alert_id: alertId,
          p_resolution_note: resolutionNote?.trim() || null,
        });

        if (rpcError) {
          throw rpcError;
        }

        // Authoritative immediate merge + realtime convergence
        setAlerts((prev) =>
          prev.map((a) => {
            if (a.id === alertId) {
              const returnedAlert = data?.alert || data || {};
              return {
                ...a,
                lifecycle_status: 'resolved',
                resolution_note: resolutionNote?.trim() || null,
                resolved_at: returnedAlert.resolved_at || new Date().toISOString(),
                ...returnedAlert,
              };
            }
            return a;
          })
        );

        return { success: true, data };
      } catch (err) {
        console.error('[useFinanceAlerts] resolve_finance_alert failed:', err);
        // If state desynchronized, trigger background refresh
        fetchAlerts({ isRefresh: true });
        throw err;
      } finally {
        setPendingAlertAction(null);
      }
    },
    [pendingAlertAction, fetchAlerts]
  );

  return {
    alerts,
    loading,
    refreshing,
    error,
    pendingAlertAction,
    acknowledgeAlert,
    resolveAlert,
    refetch: () => fetchAlerts({ isRefresh: true }),
  };
}
