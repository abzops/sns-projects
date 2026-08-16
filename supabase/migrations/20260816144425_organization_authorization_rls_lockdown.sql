-- ============================================================================
-- Migration: 20260816144425_organization_authorization_rls_lockdown.sql
-- Description: V1-01 Organization RLS & Grants Lockdown
--              1. Removes obsolete pending-user self-update and invited_email logic
--              2. Locks down direct Data API mutations on workspace_members,
--                 department_memberships, and user_system_roles
--              3. Restricts workspace_members INSERT to first-owner bootstrap only
--              4. Ensures all privileged organization administration mutations
--                 must flow exclusively through admin-manage-workspace-user
--              5. Enforces least-privilege table grants on anon & authenticated
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WORKSPACE_MEMBERS RLS LOCKDOWN
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "workspace_members_insert_admin_owner" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_update_admin_owner" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_delete_admin_owner" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_select_active" ON public.workspace_members;

-- SELECT: Active members can view members of their workspace
CREATE POLICY "workspace_members_select_active"
  ON public.workspace_members
  FOR SELECT
  TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

-- INSERT: First-owner bootstrap ONLY (strictly when workspace has 0 members)
-- Normal member/admin provisioning must go through admin-manage-workspace-user
CREATE POLICY "workspace_members_insert_bootstrap"
  ON public.workspace_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_members.workspace_id
    )
  );

-- Direct UPDATE and DELETE on workspace_members are intentionally NOT granted
-- to authenticated or anon. All role updates, status changes, and removals
-- must execute via admin-manage-workspace-user (service_role client).


-- ----------------------------------------------------------------------------
-- 2. DEPARTMENT_MEMBERSHIPS RLS LOCKDOWN
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "dept_memberships_manage" ON public.department_memberships;
DROP POLICY IF EXISTS "dept_memberships_select_member" ON public.department_memberships;

-- SELECT: Active workspace members can view department memberships
CREATE POLICY "dept_memberships_select_member"
  ON public.department_memberships
  FOR SELECT
  TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

-- Direct INSERT, UPDATE, DELETE on department_memberships are intentionally NOT
-- granted to authenticated or anon. All department assignments and role changes
-- must execute via admin-manage-workspace-user (service_role client).


-- ----------------------------------------------------------------------------
-- 3. USER_SYSTEM_ROLES RLS LOCKDOWN
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "user_system_roles_manage" ON public.user_system_roles;
DROP POLICY IF EXISTS "user_system_roles_select" ON public.user_system_roles;

-- SELECT: Active workspace members can view executive system roles
CREATE POLICY "user_system_roles_select"
  ON public.user_system_roles
  FOR SELECT
  TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

-- Direct INSERT, UPDATE, DELETE on user_system_roles are intentionally NOT
-- granted to authenticated or anon. All system role assignments must execute
-- via admin-manage-workspace-user (service_role client).


-- ----------------------------------------------------------------------------
-- 4. TABLE GRANTS LEAST-PRIVILEGE LOCKDOWN
-- ----------------------------------------------------------------------------

-- workspace_members
REVOKE ALL ON TABLE public.workspace_members FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.workspace_members FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.workspace_members TO authenticated;

-- department_memberships
REVOKE ALL ON TABLE public.department_memberships FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.department_memberships FROM authenticated;
GRANT SELECT ON TABLE public.department_memberships TO authenticated;

-- user_system_roles
REVOKE ALL ON TABLE public.user_system_roles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.user_system_roles FROM authenticated;
GRANT SELECT ON TABLE public.user_system_roles TO authenticated;
