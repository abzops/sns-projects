import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const userContextCache = new Map();

export function clearUserContextCache() {
  userContextCache.clear();
}

const UNRESOLVED_CONTEXT = Object.freeze({
  workspaceRole: null,
  systemRoles: Object.freeze([]),
  departmentMemberships: Object.freeze([]),
  primaryDepartment: null,
  isOwner: false,
  isWorkspaceAdmin: false,
  isCEO: false,
  isCTO: false,
  isProjectAdmin: false,
  isSystemAdmin: false,
  hasSystemRole: false,
  hasGlobalOperationalVisibility: false,
  canAdministerWorkspace: false,
  canMutateOperationalData: false,
  isViewer: false,
  isReadOnly: true,
  authorizationScopeKey: null,
});

function computeResolvedContext({ user, memberRole, roles, depts }) {
  const workspaceRole = memberRole || null;
  const systemRoles = roles || [];
  const departmentMemberships = depts || [];
  const primaryDepartment =
    departmentMemberships.find((d) => d.is_primary)?.departments ||
    departmentMemberships[0]?.departments ||
    null;

  const isOwner = workspaceRole === 'owner';
  const isWorkspaceAdmin = workspaceRole === 'admin';
  const isCEO = systemRoles.includes('ceo');
  const isCTO = systemRoles.includes('cto');
  const isProjectAdmin = systemRoles.includes('project_admin');
  const isSystemAdmin = systemRoles.includes('system_admin');
  const isViewer = workspaceRole === 'viewer';
  const hasSystemRole = isCEO || isCTO || isProjectAdmin || isSystemAdmin;
  const hasGlobalOperationalVisibility = hasSystemRole;
  const canAdministerWorkspace = isOwner || isWorkspaceAdmin || isSystemAdmin;
  const canMutateOperationalData =
    isProjectAdmin ||
    isSystemAdmin ||
    workspaceRole === 'owner' ||
    workspaceRole === 'admin' ||
    workspaceRole === 'member';
  const isReadOnly = !canMutateOperationalData;
  const authorizationScopeKey = `${workspaceRole || 'none'}:${[...systemRoles].sort().join(',') || 'no-system-role'}`;

  return {
    user,
    workspaceRole,
    systemRoles,
    departmentMemberships,
    primaryDepartment,
    isOwner,
    isWorkspaceAdmin,
    isCEO,
    isCTO,
    isProjectAdmin,
    isSystemAdmin,
    hasSystemRole,
    hasGlobalOperationalVisibility,
    canAdministerWorkspace,
    canMutateOperationalData,
    isViewer,
    isReadOnly,
    authorizationScopeKey,
  };
}

export function useUserContext(workspaceId) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}`;
  const cached = userId && workspaceId ? userContextCache.get(cacheKey) || null : null;

  const [activeCacheKey, setActiveCacheKey] = useState(cacheKey);
  const [contextData, setContextData] = useState(() => (cached ? { ...cached, user } : UNRESOLVED_CONTEXT));
  const [loading, setLoading] = useState(() => !cached);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const activeFetchIdRef = useRef(0);

  const fetchContext = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    const fetchId = ++activeFetchIdRef.current;

    if (!userId || !workspaceId) {
      setContextData(UNRESOLVED_CONTEXT);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!isSilent && !userContextCache.has(cacheKey)) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      // Execute all authorization sub-queries concurrently
      const [memberResult, rolesResult, deptResult] = await Promise.all([
        supabase
          .from('workspace_members')
          .select('role, status')
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle(),
        supabase
          .from('user_system_roles')
          .select('role')
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId),
        supabase
          .from('department_memberships')
          .select(`
            id,
            role,
            is_primary,
            is_active,
            departments:department_id (
              id,
              code,
              name,
              color
            )
          `)
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId)
          .eq('is_active', true),
      ]);

      if (memberResult.error) throw memberResult.error;
      if (rolesResult.error) throw rolesResult.error;
      if (deptResult.error) throw deptResult.error;

      // Discard stale in-flight responses
      if (fetchId !== activeFetchIdRef.current) return;

      const memberRole = memberResult.data?.role || null;
      const roles = (rolesResult.data || []).map((r) => r.role);
      const depts = deptResult.data || [];

      const resolved = computeResolvedContext({
        user,
        memberRole,
        roles,
        depts,
      });

      userContextCache.set(cacheKey, resolved);
      setContextData(resolved);
    } catch (err) {
      if (fetchId !== activeFetchIdRef.current) return;
      console.error('Error fetching user context:', err);
      setError(err.message || 'Failed to load user context');
      if (!userContextCache.has(cacheKey)) {
        setContextData(UNRESOLVED_CONTEXT);
      }
    } finally {
      if (fetchId === activeFetchIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [cacheKey, user, userId, workspaceId]);

  useEffect(() => {
    const isSameScope = activeCacheKey === cacheKey;
    const scopedCached = userId && workspaceId ? userContextCache.get(cacheKey) || null : null;

    if (!isSameScope) {
      setActiveCacheKey(cacheKey);
      if (scopedCached) {
        setContextData({ ...scopedCached, user });
        setLoading(false);
      } else {
        setContextData(UNRESOLVED_CONTEXT);
        setLoading(true);
      }
    }

    fetchContext({ silent: Boolean(scopedCached) });
  }, [activeCacheKey, cacheKey, fetchContext, user, userId, workspaceId]);

  const scopeIsCurrent = activeCacheKey === cacheKey;
  const currentScopeData = scopeIsCurrent ? contextData : userContextCache.get(cacheKey) || UNRESOLVED_CONTEXT;

  return {
    ...currentScopeData,
    user: user || currentScopeData.user || null,
    loading: !scopeIsCurrent || loading,
    refreshing: scopeIsCurrent && refreshing,
    error: scopeIsCurrent ? error : null,
    refetch: fetchContext,
  };
}
