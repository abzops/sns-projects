-- ==============================================================================
-- P4-01B: Finance Active-Tenancy Authorization Closure
-- 
-- Removes historical workspace creator bypass from private.can_manage_budgets.
-- Budget management strictly requires ACTIVE workspace tenancy with:
--   - Workspace role in ('owner', 'admin') OR
--   - Workspace-scoped system role in ('ceo', 'cto')
-- Historical workspace creation (workspaces.created_by) alone grants ZERO
-- budget authority.
-- ==============================================================================

CREATE OR REPLACE FUNCTION private.can_manage_budgets(
  p_workspace_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = p_workspace_id
        AND wm.user_id = p_user_id
        AND wm.status = 'active'
        AND (
          wm.role IN ('owner', 'admin')
          OR EXISTS (
            SELECT 1
            FROM public.user_system_roles usr
            WHERE usr.workspace_id = p_workspace_id
              AND usr.user_id = p_user_id
              AND usr.role IN ('ceo', 'cto')
          )
        )
    );
$$;

-- Ensure hardened ACL is maintained
REVOKE ALL ON FUNCTION private.can_manage_budgets(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_budgets(uuid, uuid) TO authenticated;