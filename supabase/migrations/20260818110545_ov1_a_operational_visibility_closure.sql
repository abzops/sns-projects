-- SNS Projects Operational V1 Access Closure (OV1-A)
--
-- Workspace membership is a tenancy prerequisite, not a grant of broad
-- operational visibility. Only the four System Roles retain portfolio-wide
-- SELECT access. Everyone else sees directly involved work and the minimum
-- hierarchy required to locate it.

BEGIN;

-- Policy predicates below are all backed by these lookup indexes. Partial
-- indexes keep inactive membership rows out of the hot authorization path.
CREATE INDEX IF NOT EXISTS idx_workspace_members_active_user_workspace
  ON public.workspace_members (user_id, workspace_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_projects_workspace_id
  ON public.projects (workspace_id, id);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_project
  ON public.tasks (assignee_id, project_id)
  WHERE assignee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_raci_user_task
  ON public.task_raci_assignments (user_id, task_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subtasks_assignee_task
  ON public.subtasks (assignee_id, task_id)
  WHERE assignee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_department_memberships_active_user_department
  ON public.department_memberships (user_id, department_id)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION private.has_global_operational_visibility(
  p_workspace_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = p_workspace_id
        AND wm.user_id = auth.uid()
        AND wm.status = 'active'
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_system_roles usr
      WHERE usr.workspace_id = p_workspace_id
        AND usr.user_id = auth.uid()
        AND usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
    );
$$;

CREATE OR REPLACE FUNCTION private.can_view_operational_project(
  p_project_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_project_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.workspace_id
  INTO v_workspace_id
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF private.has_global_operational_visibility(v_workspace_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.project_id = p_project_id
      AND (
        t.assignee_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.task_raci_assignments ra
          WHERE ra.task_id = t.id
            AND (
              ra.user_id = v_user_id
              OR (
                ra.department_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM public.department_memberships dm
                  WHERE dm.department_id = ra.department_id
                    AND dm.user_id = v_user_id
                    AND dm.is_active = true
                )
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.subtasks st
          WHERE st.task_id = t.id
            AND st.assignee_id = v_user_id
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.process_instances pi
    WHERE pi.project_id = p_project_id
      AND (pi.started_by = v_user_id OR pi.owner_id = v_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_operational_phase(
  p_phase_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_phase_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT ph.project_id, p.workspace_id
  INTO v_project_id, v_workspace_id
  FROM public.phases ph
  JOIN public.projects p ON p.id = ph.project_id
  WHERE ph.id = p_phase_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF private.has_global_operational_visibility(v_workspace_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.project_id = v_project_id
      AND t.phase_id = p_phase_id
      AND (
        t.assignee_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.task_raci_assignments ra
          WHERE ra.task_id = t.id
            AND (
              ra.user_id = v_user_id
              OR (
                ra.department_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM public.department_memberships dm
                  WHERE dm.department_id = ra.department_id
                    AND dm.user_id = v_user_id
                    AND dm.is_active = true
                )
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.subtasks st
          WHERE st.task_id = t.id
            AND st.assignee_id = v_user_id
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.process_instances pi
    WHERE pi.project_id = v_project_id
      AND pi.phase_id = p_phase_id
      AND (pi.started_by = v_user_id OR pi.owner_id = v_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_operational_task_list(
  p_task_list_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_task_list_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT tl.project_id, p.workspace_id
  INTO v_project_id, v_workspace_id
  FROM public.task_lists tl
  JOIN public.projects p ON p.id = tl.project_id
  WHERE tl.id = p_task_list_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF private.has_global_operational_visibility(v_workspace_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.project_id = v_project_id
      AND t.task_list_id = p_task_list_id
      AND (
        t.assignee_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.task_raci_assignments ra
          WHERE ra.task_id = t.id
            AND (
              ra.user_id = v_user_id
              OR (
                ra.department_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM public.department_memberships dm
                  WHERE dm.department_id = ra.department_id
                    AND dm.user_id = v_user_id
                    AND dm.is_active = true
                )
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.subtasks st
          WHERE st.task_id = t.id
            AND st.assignee_id = v_user_id
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.process_instances pi
    WHERE pi.project_id = v_project_id
      AND pi.task_list_id = p_task_list_id
      AND (pi.started_by = v_user_id OR pi.owner_id = v_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_operational_task(
  p_task_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_task_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(p.workspace_id, pi.workspace_id)
  INTO v_workspace_id
  FROM public.tasks t
  LEFT JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.process_instances pi ON pi.id = t.process_instance_id
  WHERE t.id = p_task_id;

  IF NOT FOUND OR v_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF private.has_global_operational_visibility(v_workspace_id) THEN
    RETURN true;
  END IF;

  -- A participant on a child Task or materialized Process Step also receives
  -- each parent Task needed to render the operational hierarchy. UNION (not
  -- UNION ALL) makes the traversal safe even if corrupt legacy cycles exist.
  RETURN EXISTS (
    WITH RECURSIVE descendants(id) AS (
      SELECT p_task_id
      UNION
      SELECT child.id
      FROM public.tasks child
      JOIN descendants parent ON parent.id = child.parent_task_id
    )
    SELECT 1
    FROM descendants d
    JOIN public.tasks t ON t.id = d.id
    WHERE
      t.assignee_id = v_user_id
      OR EXISTS (
        SELECT 1
        FROM public.task_raci_assignments ra
        WHERE ra.task_id = t.id
          AND (
            ra.user_id = v_user_id
            OR (
              ra.department_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM public.department_memberships dm
                WHERE dm.department_id = ra.department_id
                  AND dm.user_id = v_user_id
                  AND dm.is_active = true
              )
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.subtasks st
        WHERE st.task_id = t.id
          AND st.assignee_id = v_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.process_instances pi
        WHERE (pi.id = t.process_instance_id OR pi.parent_task_id = t.id)
          AND (pi.started_by = v_user_id OR pi.owner_id = v_user_id)
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_operational_subtask(
  p_subtask_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_assignee_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_subtask_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(p.workspace_id, pi.workspace_id), st.assignee_id
  INTO v_workspace_id, v_assignee_id
  FROM public.subtasks st
  JOIN public.tasks t ON t.id = st.task_id
  LEFT JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.process_instances pi ON pi.id = t.process_instance_id
  WHERE st.id = p_subtask_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  RETURN private.has_global_operational_visibility(v_workspace_id)
    OR v_assignee_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_operational_process_instance(
  p_instance_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.process_instances%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_instance_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_instance
  FROM public.process_instances pi
  WHERE pi.id = p_instance_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_instance.workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF private.has_global_operational_visibility(v_instance.workspace_id) THEN
    RETURN true;
  END IF;

  IF v_instance.started_by = v_user_id OR v_instance.owner_id = v_user_id THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.process_instance_id = p_instance_id
      AND (
        t.assignee_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.task_raci_assignments ra
          WHERE ra.task_id = t.id
            AND (
              ra.user_id = v_user_id
              OR (
                ra.department_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM public.department_memberships dm
                  WHERE dm.department_id = ra.department_id
                    AND dm.user_id = v_user_id
                    AND dm.is_active = true
                )
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.subtasks st
          WHERE st.task_id = t.id
            AND st.assignee_id = v_user_id
        )
      )
  );
END;
$$;

-- Existing public RPCs and legacy policies call these signatures. Keep the
-- signatures stable, but forbid caller-supplied identity substitution.
CREATE OR REPLACE FUNCTION private.can_read_process_instance(
  p_instance_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  RETURN private.can_view_operational_process_instance(p_instance_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_process_instance(
  p_instance_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_actor_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  RETURN private.can_view_operational_process_instance(p_instance_id);
END;
$$;

-- Replace workspace-wide SELECT policies with operationally scoped policies.
DROP POLICY IF EXISTS projects_select_member ON public.projects;
CREATE POLICY projects_select_member ON public.projects
  FOR SELECT TO authenticated
  USING (private.can_view_operational_project(id));

DROP POLICY IF EXISTS phases_select_member ON public.phases;
CREATE POLICY phases_select_member ON public.phases
  FOR SELECT TO authenticated
  USING (private.can_view_operational_phase(id));

DROP POLICY IF EXISTS task_lists_select_member ON public.task_lists;
CREATE POLICY task_lists_select_member ON public.task_lists
  FOR SELECT TO authenticated
  USING (private.can_view_operational_task_list(id));

DROP POLICY IF EXISTS tasks_select_member ON public.tasks;
DROP POLICY IF EXISTS tasks_select_standalone ON public.tasks;
CREATE POLICY tasks_select_member ON public.tasks
  FOR SELECT TO authenticated
  USING (private.can_view_operational_task(id));

DROP POLICY IF EXISTS subtasks_select_member ON public.subtasks;
CREATE POLICY subtasks_select_member ON public.subtasks
  FOR SELECT TO authenticated
  USING (private.can_view_operational_subtask(id));

DROP POLICY IF EXISTS task_raci_select_member ON public.task_raci_assignments;
CREATE POLICY task_raci_select_member ON public.task_raci_assignments
  FOR SELECT TO authenticated
  USING (private.can_view_operational_task(task_id));

DROP POLICY IF EXISTS task_statuses_select_member ON public.task_statuses;
CREATE POLICY task_statuses_select_member ON public.task_statuses
  FOR SELECT TO authenticated
  USING (private.can_view_operational_project(project_id));

DROP POLICY IF EXISTS process_instances_select_policy ON public.process_instances;
CREATE POLICY process_instances_select_policy ON public.process_instances
  FOR SELECT TO authenticated
  USING (private.can_view_operational_process_instance(id));

DROP POLICY IF EXISTS process_audit_select_member ON public.process_audit_events;
CREATE POLICY process_audit_select_member ON public.process_audit_events
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN task_id IS NOT NULL THEN private.can_view_operational_task(task_id)
      WHEN process_instance_id IS NOT NULL
        THEN private.can_view_operational_process_instance(process_instance_id)
      ELSE private.has_global_operational_visibility(workspace_id)
    END
  );

DROP POLICY IF EXISTS task_approval_select_member ON public.task_approval_cycles;
CREATE POLICY task_approval_select_member ON public.task_approval_cycles
  FOR SELECT TO authenticated
  USING (private.can_view_operational_task(task_id));

DROP POLICY IF EXISTS task_consult_resp_select_member ON public.task_consultation_responses;
CREATE POLICY task_consult_resp_select_member ON public.task_consultation_responses
  FOR SELECT TO authenticated
  USING (private.can_view_operational_task(task_id));

DROP POLICY IF EXISTS task_evidence_select_member ON public.task_evidence_submissions;
CREATE POLICY task_evidence_select_member ON public.task_evidence_submissions
  FOR SELECT TO authenticated
  USING (private.can_view_operational_task(task_id));

DROP POLICY IF EXISTS task_resp_comp_select_member ON public.task_responsible_completions;
CREATE POLICY task_resp_comp_select_member ON public.task_responsible_completions
  FOR SELECT TO authenticated
  USING (private.can_view_operational_task(task_id));

-- New functions are not callable by PUBLIC/anon. Authenticated receives only
-- the helpers required by policies; every helper derives identity from
-- auth.uid(). service_role/postgres retain operational and maintenance access.
REVOKE ALL ON FUNCTION private.has_global_operational_visibility(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_operational_project(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_operational_phase(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_operational_task_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_operational_task(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_operational_subtask(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_operational_process_instance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_read_process_instance(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_process_instance(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.has_global_operational_visibility(uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_view_operational_project(uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_view_operational_phase(uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_view_operational_task_list(uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_view_operational_task(uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_view_operational_subtask(uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_view_operational_process_instance(uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_read_process_instance(uuid, uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_view_process_instance(uuid, uuid) TO authenticated, service_role, postgres;

COMMIT;
