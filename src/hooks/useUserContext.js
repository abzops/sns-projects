import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useUserContext(workspaceId) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [workspaceRole, setWorkspaceRole] = useState(null);
  const [systemRoles, setSystemRoles] = useState([]);
  const [departmentMemberships, setDepartmentMemberships] = useState([]);
  const [primaryDepartment, setPrimaryDepartment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchContext = useCallback(async () => {
    if (!userId || !workspaceId) {
      setWorkspaceRole(null);
      setSystemRoles([]);
      setDepartmentMemberships([]);
      setPrimaryDepartment(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 1. Fetch Workspace Role
      const { data: memberData, error: memberError } = await supabase
        .from('workspace_members')
        .select('role, status')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (memberError) throw memberError;
      setWorkspaceRole(memberData?.role || null);

      // 2. Fetch System Roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('user_system_roles')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId);

      if (rolesError) throw rolesError;
      const roles = (rolesData || []).map((r) => r.role);
      setSystemRoles(roles);

      // 3. Fetch Department Memberships
      const { data: deptData, error: deptError } = await supabase
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
        .eq('is_active', true);

      if (deptError) throw deptError;
      const depts = deptData || [];
      setDepartmentMemberships(depts);

      const primary = depts.find((d) => d.is_primary)?.departments || depts[0]?.departments || null;
      setPrimaryDepartment(primary);

    } catch (err) {
      console.error('Error fetching user context:', err);
      setError(err.message || 'Failed to load user context');
    } finally {
      setLoading(false);
    }
  }, [userId, workspaceId]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

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
  const authorizationScopeKey = loading
    ? null
    : `${workspaceRole || 'none'}:${[...systemRoles].sort().join(',') || 'no-system-role'}`;

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
    loading,
    error,
    refetch: fetchContext,
  };
}
