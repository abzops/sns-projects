-- ==============================================================================
-- P6-04B: Finance Explorer Metadata Authorization Closure
--
-- Production blocker: Finance Operator is authorized (Decision 56) to use
-- the Financial Explorer and view all workspace financials. However, the
-- operational phases_select_member and task_lists_select_member RLS policies
-- use private.can_view_operational_phase / can_view_operational_task_list,
-- which implement Operational V1 involvement visibility. This legitimately
-- hides uninvolved Phases and Task Lists from Finance Operators in all
-- operational screens — but incorrectly prevents Financial Explorer from
-- loading complete workspace hierarchy metadata.
--
-- Architectural Rule:
--   DO NOT broaden any Operational RLS policy.
--   DO NOT grant Finance Operator global operational visibility.
--   INSTEAD: create a dedicated, read-only Finance Explorer metadata API
--   that queries hierarchy tables directly inside a SECURITY DEFINER
--   private helper, delegated from an SECURITY INVOKER public wrapper.
--   The public wrapper checks Finance authorization before delegating.
--
-- New objects:
--   private.get_workspace_finance_explorer_metadata_internal(uuid, uuid)
--     SECURITY DEFINER — validates auth, validates finance authority, then
--     queries all workspace hierarchy tables without RLS filtering (because
--     SECURITY DEFINER runs as the function owner, bypassing client RLS).
--
--   public.get_workspace_finance_explorer_metadata(uuid)
--     SECURITY INVOKER — callable by authenticated users. Delegates to
--     private internal helper. Grants only to authenticated; anon revoked.
--
-- No Operational RLS policies are modified.
-- No SECURITY DEFINER functions are added to public schema.
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Private SECURITY DEFINER internal implementation
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.get_workspace_finance_explorer_metadata_internal(
  p_workspace_id uuid,
  p_user_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_authorized boolean;
  v_result     jsonb;
BEGIN
  -- 1. Authentication guard
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Finance Explorer metadata: authentication required';
  END IF;

  -- 2. Authorization: must be Finance-authorized in this workspace
  --    Accepts: active Workspace Owner, Admin, CEO, CTO, Finance Operator
  --    Rejects: Project Admin only, System Admin only, Member, Viewer,
  --             inactive tenancy, cross-workspace callers, anonymous
  v_authorized :=
    private.can_manage_budgets(p_workspace_id, p_user_id)
    OR
    private.is_finance_operator(p_workspace_id, p_user_id);

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Finance Explorer metadata: access denied for user % in workspace %',
      p_user_id, p_workspace_id;
  END IF;

  -- 3. Build metadata payload (SECURITY DEFINER bypasses client RLS so all
  --    workspace hierarchy rows are visible regardless of operational policies)
  WITH
  ws_projects AS (
    SELECT id, name, color, owner_id, created_by, created_at, project_status
    FROM public.projects
    WHERE workspace_id = p_workspace_id
    ORDER BY name
  ),
  ws_phases AS (
    SELECT ph.id, ph.project_id, ph.name, ph.owner_id, ph.created_by, ph.created_at, ph.position
    FROM public.phases ph
    JOIN public.projects p ON p.id = ph.project_id
    WHERE p.workspace_id = p_workspace_id
    ORDER BY ph.project_id, ph.position
  ),
  ws_task_lists AS (
    SELECT tl.id, tl.project_id, tl.phase_id, tl.name, tl.owner_id,
           tl.created_by, tl.created_at, tl.completed_at, tl.position
    FROM public.task_lists tl
    JOIN public.projects p ON p.id = tl.project_id
    WHERE p.workspace_id = p_workspace_id
    ORDER BY tl.project_id, tl.phase_id, tl.position
  ),
  ws_tasks AS (
    SELECT t.id, t.project_id, t.phase_id, t.task_list_id, t.parent_task_id,
           t.process_step_id, t.process_instance_id, t.title,
           t.owner_id, t.created_by, t.created_at, t.updated_at, t.due_date, t.status_id
    FROM public.tasks t
    WHERE (
      -- A. Tasks in workspace projects
      t.project_id IN (SELECT id FROM public.projects WHERE workspace_id = p_workspace_id)
      OR
      -- B. Standalone tasks via process instance scoped to this workspace
      t.process_instance_id IN (
        SELECT id FROM public.process_instances WHERE workspace_id = p_workspace_id
      )
      OR
      -- C. Standalone tasks with an expense transaction in this workspace
      t.id IN (
        SELECT task_id FROM public.expense_transactions
        WHERE workspace_id = p_workspace_id AND task_id IS NOT NULL
      )
    )
    ORDER BY t.created_at DESC
  ),
  ws_task_statuses AS (
    SELECT DISTINCT ts.id, ts.name, ts.color, ts.system_code
    FROM public.task_statuses ts
    WHERE ts.project_id IN (SELECT id FROM public.projects WHERE workspace_id = p_workspace_id)
  ),
  referenced_users AS (
    -- All user IDs referenced as owners or creators in this workspace's Finance Explorer rows
    SELECT DISTINCT u FROM (
      SELECT owner_id   AS u FROM ws_projects WHERE owner_id   IS NOT NULL UNION ALL
      SELECT created_by AS u FROM ws_projects WHERE created_by IS NOT NULL UNION ALL
      SELECT owner_id   AS u FROM ws_phases   WHERE owner_id   IS NOT NULL UNION ALL
      SELECT created_by AS u FROM ws_phases   WHERE created_by IS NOT NULL UNION ALL
      SELECT owner_id   AS u FROM ws_task_lists WHERE owner_id IS NOT NULL UNION ALL
      SELECT created_by AS u FROM ws_task_lists WHERE created_by IS NOT NULL UNION ALL
      SELECT owner_id   AS u FROM ws_tasks     WHERE owner_id  IS NOT NULL UNION ALL
      SELECT created_by AS u FROM ws_tasks     WHERE created_by IS NOT NULL UNION ALL
      SELECT created_by AS u
        FROM public.expense_transactions
        WHERE workspace_id = p_workspace_id AND created_by IS NOT NULL
    ) sub
  )
  SELECT jsonb_build_object(
    'projects',     COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', id, 'name', name, 'color', color,
                      'owner_id', owner_id, 'created_by', created_by,
                      'created_at', created_at, 'project_status', project_status
                    )) FROM ws_projects), '[]'::jsonb),
    'phases',       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', id, 'project_id', project_id, 'name', name,
                      'owner_id', owner_id, 'created_by', created_by,
                      'created_at', created_at, 'position', position
                    )) FROM ws_phases), '[]'::jsonb),
    'task_lists',   COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', id, 'project_id', project_id, 'phase_id', phase_id,
                      'name', name, 'owner_id', owner_id, 'created_by', created_by,
                      'created_at', created_at, 'completed_at', completed_at,
                      'position', position
                    )) FROM ws_task_lists), '[]'::jsonb),
    'tasks',        COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', id, 'project_id', project_id, 'phase_id', phase_id,
                      'task_list_id', task_list_id, 'parent_task_id', parent_task_id,
                      'process_step_id', process_step_id,
                      'process_instance_id', process_instance_id,
                      'title', title, 'owner_id', owner_id, 'created_by', created_by,
                      'created_at', created_at, 'updated_at', updated_at,
                      'due_date', due_date, 'status_id', status_id
                    )) FROM ws_tasks), '[]'::jsonb),
    'task_statuses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', id, 'name', name, 'color', color, 'system_code', system_code
                    )) FROM ws_task_statuses), '[]'::jsonb),
    'profiles',     COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', pr.id, 'full_name', pr.full_name
                    )) FROM public.profiles pr
                    WHERE pr.id IN (SELECT u FROM referenced_users)), '[]'::jsonb),
    'primary_departments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'user_id', dm.user_id,
                      'department_id', dm.department_id,
                      'department_name', d.name,
                      'department_code', d.code
                    )) FROM public.department_memberships dm
                    JOIN public.departments d ON d.id = dm.department_id
                    WHERE dm.workspace_id = p_workspace_id
                      AND dm.is_active   = true
                      AND dm.is_primary  = true
                      AND d.is_active    = true
                      AND dm.user_id IN (SELECT u FROM referenced_users)), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- Private helper: revoke from PUBLIC and anon; grant to authenticated, service_role, postgres
REVOKE ALL ON FUNCTION private.get_workspace_finance_explorer_metadata_internal(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_workspace_finance_explorer_metadata_internal(uuid, uuid)
  TO authenticated, service_role, postgres;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Public SECURITY INVOKER wrapper
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_workspace_finance_explorer_metadata(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_workspace_finance_explorer_metadata_internal(
    p_workspace_id,
    auth.uid()
  );
$$;

-- Grant authenticated; revoke anon and PUBLIC
REVOKE ALL ON FUNCTION public.get_workspace_finance_explorer_metadata(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_finance_explorer_metadata(uuid) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Verify: SECURITY DEFINER count in public schema must not have increased
--    (this is a documentation note — verified externally by Security Advisor)
-- ──────────────────────────────────────────────────────────────────────────────
-- public.get_workspace_finance_explorer_metadata is SECURITY INVOKER ✓
-- private.get_workspace_finance_explorer_metadata_internal is SECURITY DEFINER
--   but lives in the private schema — not exposed via PostgREST Data API ✓
-- Zero changes to phases_select_member or task_lists_select_member policies ✓
