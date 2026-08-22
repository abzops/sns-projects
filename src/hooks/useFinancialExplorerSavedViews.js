/**
 * SNS PROJECTS — HOOK FOR FINANCIAL EXPLORER SAVED VIEWS
 *
 * Provides authenticated, workspace-scoped, user-isolated Saved Views CRUD.
 *
 * Security & Invariants:
 * - Scoped by userId, workspaceId, authorizationScopeKey, enabled
 * - Direct PostgREST queries against public.finance_explorer_saved_views under RLS
 * - Fails closed on unauthorized access or network errors
 * - Error states are explicitly surfaced and NOT disguised as empty views
 * - Generation token (activeFetchIdRef) prevents stale async fetch race conditions
 * - Synchronous state flush on scope change or when enabled becomes false
 * - Zero direct mutation of finance facts/ledgers
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  serializeSavedViewState,
  normalizeSavedViewState,
  isSavedViewDirty,
} from '../lib/financialExplorerSavedViews';

export function useFinancialExplorerSavedViews(
  workspaceId,
  authorizationScopeKey = 'default',
  { enabled = true } = {}
) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const activeScopeKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`;
  const [activeCacheKey, setActiveCacheKey] = useState(activeScopeKey);

  const [savedViews, setSavedViews] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(enabled && userId && workspaceId));
  const [error, setError] = useState(null);

  // Active saved view tracking
  const [activeSavedViewId, setActiveSavedViewId] = useState(null);
  const [activeBaselineState, setActiveBaselineState] = useState(null);

  // Mutation states
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState(null);

  const activeFetchIdRef = useRef(0);

  // Synchronously isolate state when scope key shifts or when enabled becomes false
  useEffect(() => {
    if (activeScopeKey !== activeCacheKey || !enabled) {
      activeFetchIdRef.current++;
      setActiveCacheKey(activeScopeKey);
      setSavedViews([]);
      setActiveSavedViewId(null);
      setActiveBaselineState(null);
      setActionError(null);
      setError(null);
      setLoading(Boolean(enabled && userId && workspaceId));
    }
  }, [activeScopeKey, activeCacheKey, enabled, userId, workspaceId]);

  // 1. Fetch saved views
  const fetchSavedViews = useCallback(async () => {
    if (!userId || !workspaceId || !enabled) {
      setSavedViews([]);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchId = ++activeFetchIdRef.current;
    setLoading(true);
    setError(null);
    setActionError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('finance_explorer_saved_views')
        .select('id, workspace_id, user_id, name, view_state, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true });

      if (fetchId !== activeFetchIdRef.current) return;

      if (queryError) {
        throw queryError;
      }

      setSavedViews(Array.isArray(data) ? data : []);
    } catch (err) {
      if (fetchId !== activeFetchIdRef.current) return;
      console.error('[useFinancialExplorerSavedViews] Failed to fetch saved views:', err);
      setError(err?.message || 'Failed to load saved views');
      setSavedViews([]);
    } finally {
      if (fetchId === activeFetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [userId, workspaceId, enabled]);

  // 2. Trigger fetch on scope change when enabled
  useEffect(() => {
    if (enabled && userId && workspaceId) {
      fetchSavedViews();
    }
  }, [activeScopeKey, enabled, userId, workspaceId, fetchSavedViews]);

  // 3. Select / Apply a Saved View
  const selectSavedView = useCallback(
    (savedViewId, metadata) => {
      if (!savedViewId) {
        setActiveSavedViewId(null);
        setActiveBaselineState(null);
        return null;
      }

      const view = savedViews.find((v) => v.id === savedViewId);
      if (!view) {
        setActiveSavedViewId(null);
        setActiveBaselineState(null);
        return null;
      }

      const normalized = normalizeSavedViewState(view.view_state, metadata);
      setActiveSavedViewId(view.id);
      setActiveBaselineState(normalized);
      return normalized;
    },
    [savedViews]
  );

  // 4. Create a new Saved View
  const createSavedView = useCallback(
    async (name, currentState, metadata) => {
      const trimmedName = (name || '').trim();
      if (!trimmedName) {
        throw new Error('Saved View name is required');
      }
      if (trimmedName.length > 100) {
        throw new Error('Saved View name must not exceed 100 characters');
      }

      setIsSaving(true);
      setActionError(null);

      try {
        const payloadState = serializeSavedViewState(currentState);
        const { data, error: insertError } = await supabase
          .from('finance_explorer_saved_views')
          .insert({
            workspace_id: workspaceId,
            name: trimmedName,
            view_state: payloadState,
          })
          .select('id, workspace_id, user_id, name, view_state, created_at, updated_at')
          .single();

        if (insertError) {
          if (insertError.code === '23505' || insertError.message?.includes('duplicate key')) {
            throw new Error(`A saved view named "${trimmedName}" already exists in this workspace.`);
          }
          throw insertError;
        }

        const newView = data;
        setSavedViews((prev) => {
          const next = [...prev.filter((v) => v.id !== newView.id), newView];
          return next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        });

        const normalized = normalizeSavedViewState(newView.view_state, metadata);
        setActiveSavedViewId(newView.id);
        setActiveBaselineState(normalized);
        return newView;
      } catch (err) {
        console.error('[useFinancialExplorerSavedViews] Failed to create saved view:', err);
        setActionError(err.message || 'Failed to save view');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [workspaceId]
  );

  // 5. Update / Overwrite an existing Saved View
  const updateSavedView = useCallback(
    async (savedViewId, currentState, metadata) => {
      if (!savedViewId) {
        throw new Error('No Saved View selected to update');
      }

      setIsSaving(true);
      setActionError(null);

      try {
        const payloadState = serializeSavedViewState(currentState);
        const { data, error: updateError } = await supabase
          .from('finance_explorer_saved_views')
          .update({
            view_state: payloadState,
          })
          .eq('id', savedViewId)
          .select('id, workspace_id, user_id, name, view_state, created_at, updated_at')
          .single();

        if (updateError) {
          throw updateError;
        }

        const updatedView = data;
        setSavedViews((prev) =>
          prev.map((v) => (v.id === updatedView.id ? updatedView : v))
        );

        const normalized = normalizeSavedViewState(updatedView.view_state, metadata);
        setActiveBaselineState(normalized);
        return updatedView;
      } catch (err) {
        console.error('[useFinancialExplorerSavedViews] Failed to update saved view:', err);
        setActionError(err.message || 'Failed to update view');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // 6. Rename a Saved View
  const renameSavedView = useCallback(
    async (savedViewId, newName) => {
      const trimmedName = (newName || '').trim();
      if (!trimmedName) {
        throw new Error('Saved View name is required');
      }
      if (trimmedName.length > 100) {
        throw new Error('Saved View name must not exceed 100 characters');
      }

      setIsSaving(true);
      setActionError(null);

      try {
        const { data, error: renameError } = await supabase
          .from('finance_explorer_saved_views')
          .update({
            name: trimmedName,
          })
          .eq('id', savedViewId)
          .select('id, workspace_id, user_id, name, view_state, created_at, updated_at')
          .single();

        if (renameError) {
          if (renameError.code === '23505' || renameError.message?.includes('duplicate key')) {
            throw new Error(`A saved view named "${trimmedName}" already exists in this workspace.`);
          }
          throw renameError;
        }

        const updatedView = data;
        setSavedViews((prev) => {
          const next = prev.map((v) => (v.id === updatedView.id ? updatedView : v));
          return next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        });

        return updatedView;
      } catch (err) {
        console.error('[useFinancialExplorerSavedViews] Failed to rename saved view:', err);
        setActionError(err.message || 'Failed to rename view');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // 7. Delete a Saved View
  const deleteSavedView = useCallback(
    async (savedViewId) => {
      if (!savedViewId) {
        throw new Error('No Saved View selected to delete');
      }

      setIsSaving(true);
      setActionError(null);

      try {
        const { error: deleteError } = await supabase
          .from('finance_explorer_saved_views')
          .delete()
          .eq('id', savedViewId);

        if (deleteError) {
          throw deleteError;
        }

        setSavedViews((prev) => prev.filter((v) => v.id !== savedViewId));
        if (activeSavedViewId === savedViewId) {
          setActiveSavedViewId(null);
          setActiveBaselineState(null);
        }
      } catch (err) {
        console.error('[useFinancialExplorerSavedViews] Failed to delete saved view:', err);
        setActionError(err.message || 'Failed to delete view');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [activeSavedViewId]
  );

  // 8. Check if current active view has unsaved changes
  const hasUnsavedChanges = useCallback(
    (currentState) => {
      if (!activeSavedViewId || !activeBaselineState) return false;
      return isSavedViewDirty(currentState, activeBaselineState);
    },
    [activeSavedViewId, activeBaselineState]
  );

  return {
    savedViews,
    loading,
    error,
    actionError,
    activeSavedViewId,
    activeSavedView: savedViews.find((v) => v.id === activeSavedViewId) || null,
    isSaving,
    fetchSavedViews,
    selectSavedView,
    createSavedView,
    updateSavedView,
    renameSavedView,
    deleteSavedView,
    hasUnsavedChanges,
  };
}
