-- SNS Projects — Package 1 / P1-02: Placement-Aware Process Runtime Engine
-- Migration: 20260817070924_p1_02_placement_aware_process_runtime.sql
--
-- Summary:
-- 1. Introduces private.can_read_process_instance() security helper.
-- 2. Introduces private.can_start_process_version() starter authorization helper.
-- 3. Implements public.get_process_instance_progress() equal-weight step-count progress calculation RPC.
-- 4. Implements public.start_process_instance() placement-aware process execution runtime RPC.
-- 5. Configures selective RLS policies for process_instances and standalone tasks in public.tasks.
-- 6. Configures strict grants: authenticated SELECT only on process_instances, EXECUTE on runtime RPCs, zero direct DML.

-- ============================================================================
-- 1. PROCESS INSTANCE READ AUTHORIZATION HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION private.can_read_process_instance(
  p_instance_id uuid,
  p_user_id     uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance RECORD;
  v_user_id  uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_instance FROM public.process_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 1. Direct Starter or Process Owner match
  IF v_instance.started_by = v_user_id OR v_instance.owner_id = v_user_id THEN
    RETURN true;
  END IF;

  -- 2. Workspace Executive / Admin oversight
  IF (SELECT private.can_administer_workspace(v_instance.workspace_id))
     OR (SELECT private.has_system_role(v_instance.workspace_id, 'ceo'))
     OR (SELECT private.has_system_role(v_instance.workspace_id, 'cto')) THEN
    RETURN true;
  END IF;

  -- 3. RACI Participant on ANY task belonging to this process instance
  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.task_raci_assignments ra ON ra.task_id = t.id
    WHERE t.process_instance_id = p_instance_id
      AND (
        ra.user_id = v_user_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_user_id
            AND dm.is_active = true
        )
      )
  ) THEN
    RETURN true;
  END IF;

  -- 4. Placement-specific visibility for attached Project hierarchy processes
  -- (Standalone processes do NOT have general workspace visibility)
  IF v_instance.placement_type <> 'standalone' AND v_instance.project_id IS NOT NULL THEN
    IF (SELECT private.is_workspace_active_member(v_instance.workspace_id)) THEN
      IF EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = v_instance.project_id
          AND (
            p.owner_id = v_user_id
            OR EXISTS (
              SELECT 1 FROM public.project_members pm
              WHERE pm.project_id = p.id AND pm.user_id = v_user_id
            )
            OR (SELECT private.get_user_workspace_role(v_instance.workspace_id)) IN ('owner', 'admin')
          )
      ) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.can_read_process_instance(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_read_process_instance(uuid, uuid) TO authenticated, service_role, postgres;

-- ============================================================================
-- 2. STARTER AUTHORIZATION HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION private.can_start_process_version(
  p_version_id   uuid,
  p_caller_id    uuid,
  p_workspace_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version          RECORD;
  v_root_step        RECORD;
  v_caller_is_root_r boolean := false;
BEGIN
  IF p_caller_id IS NULL OR p_workspace_id IS NULL OR p_version_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Validate version status is published
  SELECT * INTO v_version FROM public.defined_process_versions WHERE id = p_version_id;
  IF NOT FOUND OR v_version.status <> 'published' THEN
    RETURN false;
  END IF;

  -- 2. Executive Override: Workspace Owner/Admin or System Admin / CEO / CTO
  IF (SELECT private.can_administer_workspace(p_workspace_id))
     OR (SELECT private.has_system_role(p_workspace_id, 'ceo'))
     OR (SELECT private.has_system_role(p_workspace_id, 'cto')) THEN
    RETURN true;
  END IF;

  -- 3. Workspace Role Gate: Viewers can NEVER start processes
  IF (SELECT private.get_user_workspace_role(p_workspace_id)) NOT IN ('owner', 'admin', 'member') THEN
    RETURN false;
  END IF;

  -- 4. Normal Starter Check: Must be in resolved Responsible (R) set on Root Step
  SELECT s.* INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.defined_process_step_raci r
    WHERE r.step_id = v_root_step.id
      AND r.raci_role = 'R'
      AND (
        (r.actor_type = 'user' AND r.user_id = p_caller_id)
        OR (r.actor_type = 'process_starter')
        OR (
          r.actor_type = 'department' AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = r.department_id
              AND dm.user_id = p_caller_id
              AND dm.is_active = true
          )
        )
      )
  ) INTO v_caller_is_root_r;

  IF NOT v_caller_is_root_r THEN
    RETURN false;
  END IF;

  -- 5. Dynamic R/A Separation on Approval-Required Steps
  IF EXISTS (
    SELECT 1
    FROM public.defined_process_steps s
    JOIN public.defined_process_step_raci r_ps
      ON r_ps.step_id = s.id AND r_ps.actor_type = 'process_starter' AND r_ps.raci_role = 'R'
    JOIN public.defined_process_step_raci a_usr
      ON a_usr.step_id = s.id AND a_usr.raci_role = 'A'
    WHERE s.version_id = p_version_id
      AND s.approval_required = true
      AND (
        a_usr.user_id = p_caller_id
        OR (
          a_usr.actor_type = 'department' AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = a_usr.department_id
              AND dm.user_id = p_caller_id
              AND dm.is_active = true
          )
        )
      )
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.can_start_process_version(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_start_process_version(uuid, uuid, uuid) TO authenticated, service_role, postgres;

-- ============================================================================
-- 3. EQUAL-WEIGHT PROCESS PROGRESS CALCULATION RPC (Decision 31)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_process_instance_progress(p_instance_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total     integer;
  v_completed integer;
BEGIN
  IF p_instance_id IS NULL THEN
    RETURN 0.00;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE workflow_state = 'completed')
  INTO v_total, v_completed
  FROM public.tasks
  WHERE process_instance_id = p_instance_id
    AND process_step_id IS NOT NULL;

  IF v_total = 0 THEN
    RETURN 0.00;
  END IF;

  RETURN ROUND((v_completed::numeric / v_total::numeric) * 100.0, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.get_process_instance_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_process_instance_progress(uuid) TO authenticated, service_role, postgres;

-- ============================================================================
-- 4. PLACEMENT-AWARE PROCESS RUNTIME ENGINE (start_process_instance)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_process_instance(
  p_version_id       uuid,
  p_instance_name    text,
  p_overall_due_date date DEFAULT NULL,
  p_placement_type   text DEFAULT 'standalone',
  p_project_id       uuid DEFAULT NULL,
  p_phase_id         uuid DEFAULT NULL,
  p_task_list_id     uuid DEFAULT NULL,
  p_parent_task_id   uuid DEFAULT NULL,
  p_raci_overrides   jsonb DEFAULT NULL,
  p_owner_id         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id             uuid;
  v_version               RECORD;
  v_process               RECORD;
  v_project               RECORD;
  v_parent_task           RECORD;
  v_workspace_id          uuid;
  v_instance_id           uuid;
  v_owner_id              uuid;
  v_root_step             RECORD;
  v_step                  RECORD;
  v_standalone_parent_id  uuid := NULL;
  v_step_parent_task_id   uuid := NULL;
  v_root_task_id          uuid := NULL;
  v_task_id               uuid;
  v_todo_status_id        uuid := NULL;
  v_is_root               boolean;
  v_task_count            integer := 0;
  v_pos                   integer := 1000;
  v_recipient             RECORD;
  v_project_id            uuid := p_project_id;
  v_phase_id              uuid := p_phase_id;
  v_task_list_id          uuid := p_task_list_id;
  v_parent_task_id        uuid := p_parent_task_id;
BEGIN
  -- 1. Authentication Check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Instance Name Check
  IF p_instance_name IS NULL OR btrim(p_instance_name) = '' THEN
    RAISE EXCEPTION 'Process instance name is required.';
  END IF;

  -- 3. Placement Type Domain Check
  IF p_placement_type NOT IN ('standalone', 'project', 'phase', 'task_list', 'task') THEN
    RAISE EXCEPTION 'Invalid placement type: %. Must be standalone, project, phase, task_list, or task.', p_placement_type;
  END IF;

  -- 4. Validate Version & Fetch Process
  SELECT * INTO v_version FROM public.defined_process_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'published' THEN
    RAISE EXCEPTION 'Process version must be published to be started.';
  END IF;

  SELECT * INTO v_process FROM public.defined_processes WHERE id = v_version.defined_process_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process container not found.';
  END IF;
  v_workspace_id := v_process.workspace_id;

  -- 5. Server-Side Placement Validation & Hierarchy Resolution
  IF p_placement_type = 'standalone' THEN
    IF p_project_id IS NOT NULL OR p_phase_id IS NOT NULL OR p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Standalone process cannot have project_id, phase_id, task_list_id, or parent_task_id.';
    END IF;
    v_project_id := NULL;
    v_phase_id := NULL;
    v_task_list_id := NULL;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'project' THEN
    IF p_project_id IS NULL THEN
      RAISE EXCEPTION 'project_id is required for project placement.';
    END IF;
    IF p_phase_id IS NOT NULL OR p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Project placement must not specify phase_id, task_list_id, or parent_task_id.';
    END IF;
    SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target project not found.';
    END IF;
    IF v_project.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'Target project belongs to a different workspace.';
    END IF;
    v_phase_id := NULL;
    v_task_list_id := NULL;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'phase' THEN
    IF p_project_id IS NULL OR p_phase_id IS NULL THEN
      RAISE EXCEPTION 'project_id and phase_id are required for phase placement.';
    END IF;
    IF p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Phase placement must not specify task_list_id or parent_task_id.';
    END IF;
    SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target project not found.';
    END IF;
    IF v_project.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'Target project belongs to a different workspace.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = p_phase_id AND m.project_id = p_project_id) THEN
      RAISE EXCEPTION 'Phase does not belong to the target project.';
    END IF;
    v_task_list_id := NULL;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'task_list' THEN
    IF p_project_id IS NULL OR p_phase_id IS NULL OR p_task_list_id IS NULL THEN
      RAISE EXCEPTION 'project_id, phase_id, and task_list_id are required for task_list placement.';
    END IF;
    IF p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Task list placement must not specify parent_task_id.';
    END IF;
    SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target project not found.';
    END IF;
    IF v_project.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'Target project belongs to a different workspace.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = p_phase_id AND m.project_id = p_project_id) THEN
      RAISE EXCEPTION 'Phase does not belong to the target project.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.task_lists tl
      WHERE tl.id = p_task_list_id
        AND tl.project_id = p_project_id
        AND (tl.phase_id = p_phase_id OR tl.milestone_id = p_phase_id)
    ) THEN
      RAISE EXCEPTION 'Task list does not belong to the specified phase and project.';
    END IF;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'task' THEN
    IF p_parent_task_id IS NULL THEN
      RAISE EXCEPTION 'parent_task_id is required for task placement.';
    END IF;
    -- Read authoritatively from parent task
    SELECT * INTO v_parent_task FROM public.tasks WHERE id = p_parent_task_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent task not found.';
    END IF;
    IF v_parent_task.project_id IS NOT NULL THEN
      SELECT * INTO v_project FROM public.projects WHERE id = v_parent_task.project_id;
      IF NOT FOUND OR v_project.workspace_id <> v_workspace_id THEN
        RAISE EXCEPTION 'Parent task project belongs to a different workspace.';
      END IF;
    END IF;
    -- Derive hierarchy authoritatively from parent task
    v_project_id := v_parent_task.project_id;
    v_phase_id := COALESCE(v_parent_task.phase_id, v_parent_task.milestone_id);
    v_task_list_id := v_parent_task.task_list_id;
    v_parent_task_id := p_parent_task_id;
    v_step_parent_task_id := p_parent_task_id;
  END IF;

  -- 6. Starter Authorization Check
  IF NOT private.can_start_process_version(p_version_id, v_caller_id, v_workspace_id) THEN
    RAISE EXCEPTION 'Caller is not authorized to start this process version.';
  END IF;

  -- 7. Owner Resolution
  v_owner_id := COALESCE(p_owner_id, v_caller_id);
  IF NOT private.is_workspace_active_member(v_workspace_id) THEN
    RAISE EXCEPTION 'Caller is not an active member of this workspace.';
  END IF;

  -- 8. Find Root Step
  SELECT s.* INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Root step not found for process version.';
  END IF;

  -- 9. Resolve default Todo status if project-attached
  IF v_project_id IS NOT NULL THEN
    SELECT id INTO v_todo_status_id
    FROM public.task_statuses
    WHERE project_id = v_project_id AND (system_code = 'todo' OR lower(name) = 'to do')
    ORDER BY position ASC LIMIT 1;

    IF v_todo_status_id IS NULL THEN
      SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_project_id ORDER BY position ASC LIMIT 1;
    END IF;
  END IF;

  -- 10. Enable bypass marker for trusted process creation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 11. Insert Process Instance Row (Single atomic container)
  INSERT INTO public.process_instances (
    workspace_id,
    defined_process_id,
    defined_process_version_id,
    instance_name,
    started_by,
    owner_id,
    started_at,
    due_date,
    placement_type,
    project_id,
    phase_id,
    task_list_id,
    parent_task_id,
    status
  ) VALUES (
    v_workspace_id,
    v_process.id,
    p_version_id,
    p_instance_name,
    v_caller_id,
    v_owner_id,
    now(),
    p_overall_due_date,
    p_placement_type,
    v_project_id,
    v_phase_id,
    v_task_list_id,
    v_parent_task_id,
    'running'
  ) RETURNING id INTO v_instance_id;

  -- 12. If Standalone, Create Standalone Parent Task (Decision 1 & 8)
  IF p_placement_type = 'standalone' THEN
    INSERT INTO public.tasks (
      project_id,
      phase_id,
      milestone_id,
      task_list_id,
      parent_task_id,
      process_instance_id,
      title,
      description,
      status_id,
      workflow_state,
      current_cycle_number,
      ready_at,
      due_date,
      position,
      created_by
    ) VALUES (
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      v_instance_id,
      p_instance_name,
      'Standalone Defined Process container: ' || p_instance_name,
      NULL,
      'ready',
      1,
      now(),
      p_overall_due_date,
      1000,
      v_caller_id
    ) RETURNING id INTO v_standalone_parent_id;

    -- Update process_instance parent_task_id
    UPDATE public.process_instances
    SET parent_task_id = v_standalone_parent_id
    WHERE id = v_instance_id;

    v_step_parent_task_id := v_standalone_parent_id;
  END IF;

  -- 13. Materialize Step Tasks
  FOR v_step IN
    SELECT * FROM public.defined_process_steps
    WHERE version_id = p_version_id
    ORDER BY sequence_order ASC
  LOOP
    v_is_root := (v_step.id = v_root_step.id);
    v_task_count := v_task_count + 1;
    v_pos := v_pos + 1000;

    INSERT INTO public.tasks (
      project_id,
      phase_id,
      milestone_id,
      task_list_id,
      parent_task_id,
      process_instance_id,
      title,
      description,
      status_id,
      defined_process_version_id,
      process_step_id,
      workflow_state,
      current_cycle_number,
      ready_at,
      due_date,
      overdue_cycle_notified,
      position,
      created_by
    ) VALUES (
      v_project_id,
      v_phase_id,
      v_phase_id,
      v_task_list_id,
      v_step_parent_task_id,
      v_instance_id,
      v_step.title,
      v_step.description,
      v_todo_status_id,
      p_version_id,
      v_step.id,
      CASE WHEN v_is_root THEN 'ready'::text ELSE 'waiting'::text END,
      1,
      CASE WHEN v_is_root THEN now() ELSE NULL END,
      NULL, -- Decisions 33 & 42: No per-step contractual due dates
      false,
      v_pos,
      v_caller_id
    ) RETURNING id INTO v_task_id;

    IF v_is_root THEN
      v_root_task_id := v_task_id;
    END IF;

    -- Copy Step RACI with Dynamic process_starter Resolution (Decision 12 & 39)
    INSERT INTO public.task_raci_assignments (
      task_id,
      raci_role,
      user_id,
      department_id,
      response_required
    )
    SELECT DISTINCT ON (raci_role, resolved_user_id, department_id)
      v_task_id,
      raci_role,
      resolved_user_id,
      department_id,
      response_required
    FROM (
      SELECT
        r.raci_role,
        CASE
          WHEN r.actor_type = 'process_starter' THEN v_caller_id
          WHEN r.actor_type = 'user' THEN r.user_id
          ELSE NULL
        END AS resolved_user_id,
        CASE
          WHEN r.actor_type = 'department' THEN r.department_id
          ELSE NULL
        END AS department_id,
        COALESCE(r.response_required, false) AS response_required
      FROM public.defined_process_step_raci r
      WHERE r.step_id = v_step.id
    ) sub
    WHERE resolved_user_id IS NOT NULL OR department_id IS NOT NULL
    ORDER BY raci_role, resolved_user_id, department_id, response_required DESC;
  END LOOP;

  -- 14. Audit Events & Notifications
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_project_id, v_task_list_id, v_root_task_id, 'PROCESS_STARTED', v_caller_id,
    jsonb_build_object(
      'instance_id', v_instance_id,
      'instance_name', p_instance_name,
      'version_id', p_version_id,
      'placement_type', p_placement_type,
      'task_count', v_task_count,
      'overall_due_date', p_overall_due_date
    )
  );

  -- Notify Root Step RACI Participants
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_root_task_id AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = v_root_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_task_ready',
      'Process Task Ready: ' || v_root_step.title,
      'Process "' || p_instance_name || '" has started and root step is ready.',
      'task',
      v_root_task_id,
      v_project_id,
      v_root_task_id
    );
  END LOOP;

  -- 15. Return JSON Contract
  RETURN jsonb_build_object(
    'process_instance_id', v_instance_id,
    'placement_type', p_placement_type,
    'root_task_id', v_root_task_id,
    'parent_task_id', v_step_parent_task_id,
    'task_count', v_task_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_process_instance(uuid, text, date, text, uuid, uuid, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_process_instance(uuid, text, date, text, uuid, uuid, uuid, uuid, jsonb, uuid) TO authenticated, service_role, postgres;

-- ============================================================================
-- 5. RLS POLICIES & TABLE GRANTS FOR PROCESS INSTANCES & STANDALONE TASKS
-- ============================================================================

-- Process Instances: Grant SELECT to authenticated, revoke direct DML
GRANT SELECT ON TABLE public.process_instances TO authenticated;
GRANT ALL ON TABLE public.process_instances TO service_role, postgres;
REVOKE ALL ON TABLE public.process_instances FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.process_instances FROM authenticated;

ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "process_instances_select_policy" ON public.process_instances;
CREATE POLICY "process_instances_select_policy" ON public.process_instances
  FOR SELECT TO authenticated
  USING (private.can_read_process_instance(id, auth.uid()));

-- Tasks: Standalone task SELECT policy
DROP POLICY IF EXISTS "tasks_select_standalone" ON public.tasks;
CREATE POLICY "tasks_select_standalone" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    project_id IS NULL
    AND process_instance_id IS NOT NULL
    AND private.can_read_process_instance(process_instance_id, auth.uid())
  );
