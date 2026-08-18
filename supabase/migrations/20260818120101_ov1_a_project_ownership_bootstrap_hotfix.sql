-- OV1-A production-acceptance hotfix: Project ownership is direct operational
-- involvement. Keep the existing System Role and descendant-involvement SELECT
-- branches intact, then add a narrow, active-membership-gated ownership branch.

BEGIN;

CREATE OR REPLACE FUNCTION private.has_owned_project_visibility(
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_project_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.workspace_members wm
        ON wm.workspace_id = p.workspace_id
       AND wm.user_id = auth.uid()
       AND wm.status = 'active'
      WHERE p.id = p_project_id
        AND p.owner_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION private.has_owned_project_visibility_for_task(
  p_task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_task_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      LEFT JOIN public.process_instances pi ON pi.id = t.process_instance_id
      JOIN public.projects p ON p.id = COALESCE(t.project_id, pi.project_id)
      JOIN public.workspace_members wm
        ON wm.workspace_id = p.workspace_id
       AND wm.user_id = auth.uid()
       AND wm.status = 'active'
      WHERE t.id = p_task_id
        AND p.owner_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION private.has_owned_project_visibility_for_process_instance(
  p_instance_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_instance_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.process_instances pi
      JOIN public.projects p ON p.id = pi.project_id
      JOIN public.workspace_members wm
        ON wm.workspace_id = p.workspace_id
       AND wm.user_id = auth.uid()
       AND wm.status = 'active'
      WHERE pi.id = p_instance_id
        AND p.owner_id = auth.uid()
    );
$$;

-- Multiple SELECT policies are permissive (OR). These ownership policies add
-- only the owned-Project branch; the original OV1-A policies continue to
-- enforce System Role and scoped descendant-involvement visibility.
DROP POLICY IF EXISTS projects_select_project_owner ON public.projects;
CREATE POLICY projects_select_project_owner ON public.projects
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND owner_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = (SELECT auth.uid())
        AND wm.status = 'active'
    )
  );

DROP POLICY IF EXISTS phases_select_project_owner ON public.phases;
CREATE POLICY phases_select_project_owner ON public.phases
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility(project_id));

DROP POLICY IF EXISTS task_lists_select_project_owner ON public.task_lists;
CREATE POLICY task_lists_select_project_owner ON public.task_lists
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility(project_id));

DROP POLICY IF EXISTS tasks_select_project_owner ON public.tasks;
CREATE POLICY tasks_select_project_owner ON public.tasks
  FOR SELECT TO authenticated
  USING (
    private.has_owned_project_visibility(project_id)
    OR private.has_owned_project_visibility_for_process_instance(process_instance_id)
  );

DROP POLICY IF EXISTS subtasks_select_project_owner ON public.subtasks;
CREATE POLICY subtasks_select_project_owner ON public.subtasks
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility_for_task(task_id));

DROP POLICY IF EXISTS task_raci_select_project_owner ON public.task_raci_assignments;
CREATE POLICY task_raci_select_project_owner ON public.task_raci_assignments
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility_for_task(task_id));

DROP POLICY IF EXISTS task_statuses_select_project_owner ON public.task_statuses;
CREATE POLICY task_statuses_select_project_owner ON public.task_statuses
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility(project_id));

DROP POLICY IF EXISTS process_instances_select_project_owner ON public.process_instances;
CREATE POLICY process_instances_select_project_owner ON public.process_instances
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility(project_id));

DROP POLICY IF EXISTS process_audit_select_project_owner ON public.process_audit_events;
CREATE POLICY process_audit_select_project_owner ON public.process_audit_events
  FOR SELECT TO authenticated
  USING (
    private.has_owned_project_visibility(project_id)
    OR private.has_owned_project_visibility_for_task(task_id)
    OR private.has_owned_project_visibility_for_process_instance(process_instance_id)
  );

DROP POLICY IF EXISTS task_approval_select_project_owner ON public.task_approval_cycles;
CREATE POLICY task_approval_select_project_owner ON public.task_approval_cycles
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility_for_task(task_id));

DROP POLICY IF EXISTS task_consult_resp_select_project_owner ON public.task_consultation_responses;
CREATE POLICY task_consult_resp_select_project_owner ON public.task_consultation_responses
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility_for_task(task_id));

DROP POLICY IF EXISTS task_evidence_select_project_owner ON public.task_evidence_submissions;
CREATE POLICY task_evidence_select_project_owner ON public.task_evidence_submissions
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility_for_task(task_id));

DROP POLICY IF EXISTS task_resp_comp_select_project_owner ON public.task_responsible_completions;
CREATE POLICY task_resp_comp_select_project_owner ON public.task_responsible_completions
  FOR SELECT TO authenticated
  USING (private.has_owned_project_visibility_for_task(task_id));

REVOKE ALL ON FUNCTION private.has_owned_project_visibility(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_owned_project_visibility_for_task(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_owned_project_visibility_for_process_instance(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.has_owned_project_visibility(uuid)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.has_owned_project_visibility_for_task(uuid)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.has_owned_project_visibility_for_process_instance(uuid)
  TO authenticated, service_role, postgres;

COMMIT;
