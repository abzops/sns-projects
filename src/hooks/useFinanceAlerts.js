/**
 * SNS PROJECTS — USE FINANCE ALERTS HOOK
 *
 * Provides authenticated, workspace-scoped, realtime-synchronized Finance Alert
 * state management and authoritative RPC mutation triggers.
 *
 * Invariants & Access Control:
 * - Scoped by (userId, workspaceId, authorizationScopeKey, enabled)
 * - Queries public.finance_alerts directly under RLS
 * - Render-time current-scope invariant prevents old workspace alert exposure before effects run
 * - Synchronous state flush on scope shift prevents stale persona/workspace data leaks
 * - Generation token (activeFetchIdRef) eliminates async fetch race conditions
 * - Realtime Postgres Changes subscription (INSERT, UPDATE, DELETE) with deduplication
 * - Manual refresh fallback preserves rendered list during background sync & surfaces errors
 * - Zero direct client table DML; mutations delegate strictly to SECURITY INVOKER RPCs
 * - Unique lock token ownership (pendingAlertActionsRef) prevents stale mutation finally blocks from releasing newer locks
 * - In-flight scope check (activeScopeRef) prevents stale mutation responses from leaking into new scopes
 * - Authoritative RPC return merging without fabricating client timestamps
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
  const [initialFetchCompleted, setInitialFetchCompleted] = useState(false);

  // React state for rendering pending button / spinner states
  const [pendingAlertActions, setPendingAlertActions] = useState({});

  // Unique token counter and authoritative synchronous runtime mutex ref
  const mutationTokenRef = useRef(0);
  const pendingAlertActionsRef = useRef({});
  const activeScopeRef = useRef(activeScopeKey);
  activeScopeRef.current = activeScopeKey;

  const activeFetchIdRef = useRef(0);
  const channelRef = useRef(null);

  // Synchronous atomic lock acquire helper with opaque unique ownership token
  const acquireAlertActionLock = useCallback((alertId, action) => {
    if (!alertId || pendingAlertActionsRef.current[alertId]) {
      return null;
    }
    const token = ++mutationTokenRef.current;
    pendingAlertActionsRef.current[alertId] = {
      action,
      scopeKey: activeScopeRef.current,
      token,
    };
    setPendingAlertActions((prev) => ({
      ...prev,
      [alertId]: action,
    }));
    return token;
  }, []);

  // Synchronous atomic lock release helper verifying token ownership
  const releaseAlertActionLock = useCallback((alertId, token) => {
    if (!alertId || !token) return;
    const currentLock = pendingAlertActionsRef.current[alertId];
    if (currentLock && currentLock.token === token) {
      delete pendingAlertActionsRef.current[alertId];
      setPendingAlertActions((prev) => {
        const next = { ...prev };
        delete next[alertId];
        return next;
      });
    }
  }, []);

  // 1. Synchronously isolate state when scope key shifts or when enabled becomes false
  useEffect(() => {
    if (activeScopeKey !== activeCacheKey || !enabled) {
      activeFetchIdRef.current++;
      setActiveCacheKey(activeScopeKey);
      activeScopeRef.current = activeScopeKey;
      setAlerts([]);
      setError(null);
      setRefreshing(false);
      pendingAlertActionsRef.current = {};
      setPendingAlertActions({});
      setInitialFetchCompleted(false);
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
        setInitialFetchCompleted(false);
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
        setInitialFetchCompleted(true);
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
      if (!alertId || !enabled) {
        return { success: false, reason: 'invalid_request' };
      }

      // Atomic synchronous lock acquisition with token ownership
      const token = acquireAlertActionLock(alertId, 'acknowledge');
      if (!token) {
        return { success: false, reason: 'already_pending' };
      }

      const scopeAtStart = activeScopeRef.current;
      try {
        const { data, error: rpcError } = await supabase.rpc('acknowledge_finance_alert', {
          p_alert_id: alertId,
        });

        if (rpcError) {
          throw rpcError;
        }

        // Stale mutation response safety: verify scope hasn't changed in flight
        if (activeScopeRef.current !== scopeAtStart) {
          return { success: true, staleScope: true, data };
        }

        const returnedAlert = data?.alert || data || {};

        // Authoritative merge of server-returned fields (without client-side timestamp fabrication)
        setAlerts((prev) =>
          prev.map((a) => {
            if (a.id === alertId) {
              return {
                ...a,
                ...returnedAlert,
                lifecycle_status: returnedAlert.lifecycle_status || a.lifecycle_status,
              };
            }
            return a;
          })
        );

        // If returned fields were unexpectedly missing, trigger background refetch
        if (!returnedAlert.lifecycle_status) {
          fetchAlerts({ isRefresh: true });
        }

        return { success: true, data };
      } catch (err) {
        console.error('[useFinanceAlerts] acknowledge_finance_alert failed:', err);
        if (activeScopeRef.current === scopeAtStart) {
          fetchAlerts({ isRefresh: true });
        }
        throw err;
      } finally {
        releaseAlertActionLock(alertId, token);
      }
    },
    [acquireAlertActionLock, releaseAlertActionLock, fetchAlerts, enabled]
  );

  // 5. Resolve Alert Mutation (Calls public.resolve_finance_alert)
  const resolveAlert = useCallback(
    async (alertId, resolutionNote = null) => {
      if (!alertId || !enabled) {
        return { success: false, reason: 'invalid_request' };
      }

      // Atomic synchronous lock acquisition with token ownership
      const token = acquireAlertActionLock(alertId, 'resolve');
      if (!token) {
        return { success: false, reason: 'already_pending' };
      }

      const scopeAtStart = activeScopeRef.current;
      try {
        const { data, error: rpcError } = await supabase.rpc('resolve_finance_alert', {
          p_alert_id: alertId,
          p_resolution_note: resolutionNote?.trim() || null,
        });

        if (rpcError) {
          throw rpcError;
        }

        // Stale mutation response safety: verify scope hasn't changed in flight
        if (activeScopeRef.current !== scopeAtStart) {
          return { success: true, staleScope: true, data };
        }

        const returnedAlert = data?.alert || data || {};

        // Authoritative merge of server-returned fields (without client-side timestamp fabrication)
        setAlerts((prev) =>
          prev.map((a) => {
            if (a.id === alertId) {
              return {
                ...a,
                ...returnedAlert,
                lifecycle_status: returnedAlert.lifecycle_status || a.lifecycle_status,
              };
            }
            return a;
          })
        );

        // If returned fields were unexpectedly missing, trigger background refetch
        if (!returnedAlert.lifecycle_status) {
          fetchAlerts({ isRefresh: true });
        }

        return { success: true, data };
      } catch (err) {
        console.error('[useFinanceAlerts] resolve_finance_alert failed:', err);
        if (activeScopeRef.current === scopeAtStart) {
          fetchAlerts({ isRefresh: true });
        }
        throw err;
      } finally {
        releaseAlertActionLock(alertId, token);
      }
    },
    [acquireAlertActionLock, releaseAlertActionLock, fetchAlerts, enabled]
  );

  // Render-time scope isolation: guarantee stale scope alerts are never exposed on render
  const isCurrentScope = Boolean(
    enabled && userId && workspaceId && activeCacheKey === activeScopeKey
  );
  const safeAlerts = isCurrentScope ? alerts : [];
  const safePendingAlertActions = isCurrentScope ? pendingAlertActions : {};
  const safeLoading = loading || !isCurrentScope;
  const safeRefreshing = isCurrentScope ? refreshing : false;
  const safeError = isCurrentScope ? error : null;
  const safeInitialFetchCompleted = isCurrentScope ? initialFetchCompleted : false;

  return {
    alerts: safeAlerts,
    loading: safeLoading,
    refreshing: safeRefreshing,
    error: safeError,
    initialFetchCompleted: safeInitialFetchCompleted,
    pendingAlertActions: safePendingAlertActions,
    getPendingAction: (alertId) => safePendingAlertActions[alertId] || null,
    acknowledgeAlert,
    resolveAlert,
    refetch: () => fetchAlerts({ isRefresh: true }),
  };
}
