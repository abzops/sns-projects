-- SNS Projects — Package 1 / P1-02A: Process Runtime Execution + Security + Idempotency Closure
-- Migration: 20260817072340_p1_02a_process_runtime_execution_security_closure.sql
--
-- Summary of Fixes:
-- 1. Adds start_request_id column and unique constraint (workspace_id, started_by, start_request_id) for true idempotency.
-- 2. Refactors public.start_process_instance to SECURITY INVOKER calling private.start_process_instance_internal (SECURITY DEFINER).
-- 3. Refactors public.get_process_instance_progress to SECURITY INVOKER with explicit read authorization enforcement.
-- 4. Fixes private.complete_task_and_advance with clean process_instance_id branching, isolating multiple instances, preventing host task list mutation, and ensuring step due dates remain NULL.
-- 5. Fixes complete_responsible_part, submit_task_consultation, and reject_process_task for Process Instance runtime context.
-- 6. Drops obsolete P1-02 start_process_instance signature to eliminate all new Security Advisor warnings.

-- ============================================================================
-- 1. SCHEMA HARDENING & IDEMPOTENCY IDENTIFIER
-- ============================================================================

ALTER TABLE public.process_instances
  ADD COLUMN IF NOT EXISTS start_request_id uuid NOT NULL DEFAULT gen_random_uuid();

DROP INDEX IF EXISTS idx_process_instances_start_request_unique;
CREATE UNIQUE INDEX idx_process_instances_start_request_unique
  ON public.process_instances(workspace_id, started_by, start_request_id);

-- ============================================================================
-- 2. DROP OBSOLETE P1-02 SIGNATURES
-- ============================================================================

DROP FUNCTION IF EXISTS public.start_process_instance(uuid, text, date, text, uuid, uuid, uuid, uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.get_process_instance_progress(uuid);

-- ============================================================================
-- 3. PRIVATE INTERNAL ENGINE: START PROCESS INSTANCE (SECURITY DEFINER)
-- ============================================================================

CREATE OR REPLACE FUNCTION private.start_process_instance_internal(
  p_version_id       uuid,
  p_instance_name    text,
  p_start_request_id uuid,
  p_overall_due_date date DEFAULT NULL,
  p_placement_type   text DEFAULT 'standalone',
  p_project_id       uuid DEFAULT NULL,
  p_phase_id         uuid DEFAULT NULL,
  p_task_list_id     uuid DEFAULT NULL,
  p_parent_task_id   uuid DEFAULT NULL
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
  v_existing_instance     RECORD;
  v_existing_root_task_id uuid;
  v_existing_task_count   integer;
  v_workspace_id          uuid;
  v_instance_id           uuid;
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

  -- 2. Parameter Validation
  IF p_instance_name IS NULL OR btrim(p_instance_name) = '' THEN
    RAISE EXCEPTION 'Process instance name is required.';
  END IF;

  IF p_start_request_id IS NULL THEN
    RAISE EXCEPTION 'start_request_id is required for process instance creation.';
  END IF;

  IF p_placement_type NOT IN ('standalone', 'project', 'phase', 'task_list', 'task') THEN
    RAISE EXCEPTION 'Invalid placement type: %. Must be standalone, project, phase, task_list, or task.', p_placement_type;
  END IF;

  -- 3. Validate Version & Fetch Process
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

  -- 4. Server-Side Placement Validation & Hierarchy Resolution
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
    v_project_id := v_parent_task.project_id;
    v_phase_id := COALESCE(v_parent_task.phase_id, v_parent_task.milestone_id);
    v_task_list_id := v_parent_task.task_list_id;
    v_parent_task_id := p_parent_task_id;
    v_step_parent_task_id := p_parent_task_id;
  END IF;

  -- 5. Starter Authorization Check
  IF NOT private.can_start_process_version(p_version_id, v_caller_id, v_workspace_id) THEN
    RAISE EXCEPTION 'Caller is not authorized to start this process version.';
  END IF;

  -- 6. Find Root Step
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

  -- 7. IDEMPOTENCY CHECK & DETERMINISTIC REPLAY
  SELECT * INTO v_existing_instance
  FROM public.process_instances
  WHERE workspace_id = v_workspace_id
    AND started_by = v_caller_id
    AND start_request_id = p_start_request_id;

  IF FOUND THEN
    -- Verify payload consistency
    IF v_existing_instance.defined_process_version_id <> p_version_id
       OR v_existing_instance.instance_name <> p_instance_name
       OR v_existing_instance.placement_type <> p_placement_type
       OR v_existing_instance.project_id IS DISTINCT FROM v_project_id
       OR v_existing_instance.phase_id IS DISTINCT FROM v_phase_id
       OR v_existing_instance.task_list_id IS DISTINCT FROM v_task_list_id
       OR v_existing_instance.parent_task_id IS DISTINCT FROM v_parent_task_id
       OR v_existing_instance.due_date IS DISTINCT FROM p_overall_due_date THEN
      RAISE EXCEPTION 'Idempotency conflict: start_request_id was previously used with different parameters.';
    END IF;

    -- Fetch existing root task and task count
    SELECT id INTO v_existing_root_task_id
    FROM public.tasks
    WHERE process_instance_id = v_existing_instance.id
      AND process_step_id = v_root_step.id
    LIMIT 1;

    SELECT count(*) INTO v_existing_task_count
    FROM public.tasks
    WHERE process_instance_id = v_existing_instance.id
      AND process_step_id IS NOT NULL;

    RETURN jsonb_build_object(
      'process_instance_id', v_existing_instance.id,
      'placement_type', v_existing_instance.placement_type,
      'root_task_id', v_existing_root_task_id,
      'parent_task_id', v_existing_instance.parent_task_id,
      'task_count', v_existing_task_count,
      'is_replay', true
    );
  END IF;

  -- 8. Resolve default Todo status if project-attached
  IF v_project_id IS NOT NULL THEN
    SELECT id INTO v_todo_status_id
    FROM public.task_statuses
    WHERE project_id = v_project_id AND (system_code = 'todo' OR lower(name) = 'to do')
    ORDER BY position ASC LIMIT 1;

    IF v_todo_status_id IS NULL THEN
      SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_project_id ORDER BY position ASC LIMIT 1;
    END IF;
  END IF;

  -- 9. Enable bypass marker for trusted process creation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 10. Insert Process Instance Row (Owner = Starter, start_request_id enforced)
  INSERT INTO public.process_instances (
    workspace_id,
    defined_process_id,
    defined_process_version_id,
    start_request_id,
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
    p_start_request_id,
    p_instance_name,
    v_caller_id,
    v_caller_id, -- owner_id = starter strictly
    now(),
    p_overall_due_date,
    p_placement_type,
    v_project_id,
    v_phase_id,
    v_task_list_id,
    v_parent_task_id,
    'running'
  ) RETURNING id INTO v_instance_id;

  -- 11. If Standalone, Create Standalone Parent Task (Decision 1 & 8)
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

    UPDATE public.process_instances
    SET parent_task_id = v_standalone_parent_id
    WHERE id = v_instance_id;

    v_step_parent_task_id := v_standalone_parent_id;
  END IF;

  -- 12. Materialize Step Tasks
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

  -- 13. Audit Events & Notifications
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
      'overall_due_date', p_overall_due_date,
      'start_request_id', p_start_request_id
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

  -- 14. Return JSON Contract
  RETURN jsonb_build_object(
    'process_instance_id', v_instance_id,
    'placement_type', p_placement_type,
    'root_task_id', v_root_task_id,
    'parent_task_id', v_step_parent_task_id,
    'task_count', v_task_count,
    'is_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.start_process_instance_internal(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.start_process_instance_internal(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) TO authenticated, service_role, postgres;

-- ============================================================================
-- 4. CANONICAL PUBLIC RPC: START PROCESS INSTANCE (SECURITY INVOKER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_process_instance(
  p_version_id       uuid,
  p_instance_name    text,
  p_start_request_id uuid,
  p_overall_due_date date DEFAULT NULL,
  p_placement_type   text DEFAULT 'standalone',
  p_project_id       uuid DEFAULT NULL,
  p_phase_id         uuid DEFAULT NULL,
  p_task_list_id     uuid DEFAULT NULL,
  p_parent_task_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN private.start_process_instance_internal(
    p_version_id,
    p_instance_name,
    p_start_request_id,
    p_overall_due_date,
    p_placement_type,
    p_project_id,
    p_phase_id,
    p_task_list_id,
    p_parent_task_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_process_instance(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_process_instance(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) TO authenticated;

-- ============================================================================
-- 5. CANONICAL PUBLIC RPC: GET PROGRESS (SECURITY INVOKER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_process_instance_progress(p_instance_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_total     integer;
  v_completed integer;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_instance_id IS NULL THEN
    RETURN 0.00;
  END IF;

  -- Explicit Process Instance visibility check
  IF NOT private.can_read_process_instance(p_instance_id, v_caller_id) THEN
    RAISE EXCEPTION 'Access denied to process instance.';
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
GRANT EXECUTE ON FUNCTION public.get_process_instance_progress(uuid) TO authenticated;

-- ============================================================================
-- 6. REFACTOR private.complete_task_and_advance (PROCESS_INSTANCE AWARE)
-- ============================================================================

CREATE OR REPLACE FUNCTION private.complete_task_and_advance(
  p_task_id   uuid,
  p_actor_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task           RECORD;
  v_instance       RECORD;
  v_task_list      RECORD;
  v_workspace_id   uuid;
  v_process_name   text;
  v_done_status_id uuid;
  v_todo_status_id uuid;
  v_recipient      RECORD;
  v_downstream     RECORD;
  v_all_preds_done boolean;
  v_due_date       date;
  v_pending_tasks  integer;
BEGIN
  -- Enable bypass marker for trusted workflow mutation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- =========================================================================
  -- BRANCH 1: NEW PROCESS INSTANCE RUNTIME
  -- =========================================================================
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;

    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;

    -- Resolve project Done status if project-attached
    IF v_task.project_id IS NOT NULL THEN
      SELECT id INTO v_done_status_id
      FROM public.task_statuses
      WHERE project_id = v_task.project_id AND (system_code = 'done' OR lower(name) = 'done')
      ORDER BY position DESC LIMIT 1;

      IF v_done_status_id IS NULL THEN
        SELECT id INTO v_done_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position DESC LIMIT 1;
      END IF;

      SELECT id INTO v_todo_status_id
      FROM public.task_statuses
      WHERE project_id = v_task.project_id AND (system_code = 'todo' OR lower(name) = 'to do')
      ORDER BY position ASC LIMIT 1;

      IF v_todo_status_id IS NULL THEN
        SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position ASC LIMIT 1;
      END IF;
    END IF;

    -- 1. Complete the current task
    UPDATE public.tasks
    SET workflow_state = 'completed',
        workflow_completed_at = now(),
        status_id = COALESCE(v_done_status_id, status_id)
    WHERE id = p_task_id;

    -- Record audit event
    INSERT INTO public.process_audit_events (
      workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
    ) VALUES (
      v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_COMPLETED', p_actor_id,
      jsonb_build_object(
        'instance_id', v_instance.id,
        'step_id', v_task.process_step_id,
        'cycle_number', v_task.current_cycle_number
      )
    );

    -- Notify completed Task RACI
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL AND (p_actor_id IS NULL OR u_id <> p_actor_id)
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'process_task_completed',
        'Task completed: ' || v_task.title,
        'Step has been completed in process "' || v_process_name || '".',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    -- 2. Evaluate all downstream tasks in the process instance (ISOLATED BY process_instance_id)
    FOR v_downstream IN
      SELECT
        t.id AS downstream_task_id,
        t.title AS downstream_title,
        s.id AS step_id
      FROM public.defined_process_step_dependencies d
      JOIN public.defined_process_steps s ON s.id = d.step_id
      JOIN public.tasks t ON t.process_step_id = s.id AND t.process_instance_id = v_instance.id
      WHERE d.depends_on_step_id = v_task.process_step_id
        AND t.workflow_state = 'waiting'
    LOOP
      -- Check if ALL predecessor tasks are completed in THIS process instance
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.defined_process_step_dependencies pred_dep
        JOIN public.tasks pred_task ON pred_task.process_step_id = pred_dep.depends_on_step_id
          AND pred_task.process_instance_id = v_instance.id
        WHERE pred_dep.step_id = v_downstream.step_id
          AND pred_task.workflow_state <> 'completed'
      ) INTO v_all_preds_done;

      IF v_all_preds_done THEN
        -- Decisions 33 & 42: No per-step contractual due dates
        UPDATE public.tasks
        SET workflow_state = 'ready',
            ready_at = now(),
            due_date = NULL,
            status_id = COALESCE(v_todo_status_id, status_id)
        WHERE id = v_downstream.downstream_task_id;

        -- Audit TASK_READY
        INSERT INTO public.process_audit_events (
          workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
        ) VALUES (
          v_workspace_id, v_task.project_id, v_task.task_list_id, v_downstream.downstream_task_id, 'TASK_READY', p_actor_id,
          jsonb_build_object('instance_id', v_instance.id, 'step_id', v_downstream.step_id)
        );

        -- Notify activated task RACI
        FOR v_recipient IN
          SELECT DISTINCT u_id FROM (
            SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_downstream.downstream_task_id AND ra.user_id IS NOT NULL
            UNION
            SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
            JOIN public.department_memberships dm ON dm.department_id = ra.department_id
            WHERE ra.task_id = v_downstream.downstream_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
          ) sub WHERE u_id IS NOT NULL
        LOOP
          PERFORM private.emit_notification(
            v_workspace_id,
            v_recipient.u_id,
            'process_task_ready',
            'Task ready: ' || v_downstream.downstream_title,
            'Dependencies cleared. Task is now ready in process "' || v_process_name || '".',
            'task',
            v_downstream.downstream_task_id,
            v_task.project_id,
            v_downstream.downstream_task_id
          );
        END LOOP;
      END IF;
    END LOOP;

    -- 3. Automatic Process Instance Completion Check
    SELECT count(*) INTO v_pending_tasks
    FROM public.tasks
    WHERE process_instance_id = v_instance.id
      AND process_step_id IS NOT NULL
      AND workflow_state NOT IN ('completed', 'cancelled');

    IF v_pending_tasks = 0 THEN
      UPDATE public.process_instances
      SET status = 'completed',
          completed_at = now()
      WHERE id = v_instance.id;

      INSERT INTO public.process_audit_events (
        workspace_id, project_id, task_list_id, event_type, actor_id, payload
      ) VALUES (
        v_workspace_id, v_task.project_id, v_task.task_list_id, 'PROCESS_COMPLETED', p_actor_id,
        jsonb_build_object('instance_id', v_instance.id, 'instance_name', v_instance.instance_name)
      );

      -- Notify process starter and all participants
      FOR v_recipient IN
        SELECT DISTINCT u_id FROM (
          SELECT v_instance.started_by AS u_id WHERE v_instance.started_by IS NOT NULL
          UNION
          SELECT v_instance.owner_id AS u_id WHERE v_instance.owner_id IS NOT NULL
          UNION
          SELECT ra.user_id AS u_id
          FROM public.tasks t
          JOIN public.task_raci_assignments ra ON ra.task_id = t.id
          WHERE t.process_instance_id = v_instance.id AND ra.user_id IS NOT NULL
        ) sub WHERE u_id IS NOT NULL
      LOOP
        PERFORM private.emit_notification(
          v_workspace_id,
          v_recipient.u_id,
          'process_completed',
          'Process completed: ' || v_process_name,
          'All tasks in process "' || v_process_name || '" have been completed.',
          'process_instance',
          v_instance.id,
          v_task.project_id,
          NULL
        );
      END LOOP;
    END IF;

  -- =========================================================================
  -- BRANCH 2: LEGACY TASK LIST DEFINED PROCESS RUNTIME
  -- =========================================================================
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;

    -- Resolve project Done status
    SELECT id INTO v_done_status_id
    FROM public.task_statuses
    WHERE project_id = v_task.project_id AND (system_code = 'done' OR lower(name) = 'done')
    ORDER BY position DESC LIMIT 1;

    IF v_done_status_id IS NULL THEN
      SELECT id INTO v_done_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position DESC LIMIT 1;
    END IF;

    SELECT id INTO v_todo_status_id
    FROM public.task_statuses
    WHERE project_id = v_task.project_id AND (system_code = 'todo' OR lower(name) = 'to do')
    ORDER BY position ASC LIMIT 1;

    IF v_todo_status_id IS NULL THEN
      SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position ASC LIMIT 1;
    END IF;

    -- 1. Complete the current task
    UPDATE public.tasks
    SET workflow_state = 'completed',
        workflow_completed_at = now(),
        status_id = COALESCE(v_done_status_id, status_id)
    WHERE id = p_task_id;

    -- Record audit event
    INSERT INTO public.process_audit_events (
      workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
    ) VALUES (
      v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_COMPLETED', p_actor_id,
      jsonb_build_object('step_id', v_task.process_step_id, 'cycle_number', v_task.current_cycle_number)
    );

    -- Notify completed Task R/A/C/I
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL AND (p_actor_id IS NULL OR u_id <> p_actor_id)
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'process_task_completed',
        'Task completed: ' || v_task.title,
        'Step has been completed in process "' || v_task_list.name || '".',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    -- 2. Evaluate all downstream tasks in the task list
    FOR v_downstream IN
      SELECT
        t.id AS downstream_task_id,
        t.title AS downstream_title,
        s.id AS step_id,
        s.expected_duration_days
      FROM public.defined_process_step_dependencies d
      JOIN public.defined_process_steps s ON s.id = d.step_id
      JOIN public.tasks t ON t.process_step_id = s.id AND t.task_list_id = v_task.task_list_id
      WHERE d.depends_on_step_id = v_task.process_step_id
        AND t.workflow_state = 'waiting'
    LOOP
      -- Check if ALL predecessor tasks are completed
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.defined_process_step_dependencies pred_dep
        JOIN public.tasks pred_task ON pred_task.process_step_id = pred_dep.depends_on_step_id
          AND pred_task.task_list_id = v_task.task_list_id
        WHERE pred_dep.step_id = v_downstream.step_id
          AND pred_task.workflow_state <> 'completed'
      ) INTO v_all_preds_done;

      IF v_all_preds_done THEN
        v_due_date := private.add_working_days(v_workspace_id, CURRENT_DATE, v_downstream.expected_duration_days);

        UPDATE public.tasks
        SET workflow_state = 'ready',
            ready_at = now(),
            due_date = v_due_date,
            status_id = COALESCE(v_todo_status_id, status_id)
        WHERE id = v_downstream.downstream_task_id;

        -- Audit TASK_READY
        INSERT INTO public.process_audit_events (
          workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
        ) VALUES (
          v_workspace_id, v_task.project_id, v_task.task_list_id, v_downstream.downstream_task_id, 'TASK_READY', p_actor_id,
          jsonb_build_object('step_id', v_downstream.step_id, 'due_date', v_due_date)
        );

        -- Notify activated task RACI
        FOR v_recipient IN
          SELECT DISTINCT u_id FROM (
            SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_downstream.downstream_task_id AND ra.user_id IS NOT NULL
            UNION
            SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
            JOIN public.department_memberships dm ON dm.department_id = ra.department_id
            WHERE ra.task_id = v_downstream.downstream_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
          ) sub WHERE u_id IS NOT NULL
        LOOP
          PERFORM private.emit_notification(
            v_workspace_id,
            v_recipient.u_id,
            'process_task_ready',
            'Task ready: ' || v_downstream.downstream_title,
            'Dependencies cleared. Task is now ready in process "' || v_task_list.name || '".',
            'task',
            v_downstream.downstream_task_id,
            v_task.project_id,
            v_downstream.downstream_task_id
          );
        END LOOP;
      END IF;
    END LOOP;

    -- 3. Automatic Process Completion Check
    SELECT count(*) INTO v_pending_tasks
    FROM public.tasks
    WHERE task_list_id = v_task.task_list_id
      AND process_step_id IS NOT NULL
      AND workflow_state NOT IN ('completed', 'cancelled');

    IF v_pending_tasks = 0 THEN
      UPDATE public.task_lists
      SET process_state = 'completed',
          completed_at = now()
      WHERE id = v_task.task_list_id;

      INSERT INTO public.process_audit_events (
        workspace_id, project_id, task_list_id, event_type, actor_id, payload
      ) VALUES (
        v_workspace_id, v_task.project_id, v_task.task_list_id, 'PROCESS_COMPLETED', p_actor_id,
        jsonb_build_object('task_list_id', v_task.task_list_id)
      );

      -- Notify process starter and all participants
      FOR v_recipient IN
        SELECT DISTINCT u_id FROM (
          SELECT v_task_list.started_by AS u_id WHERE v_task_list.started_by IS NOT NULL
          UNION
          SELECT ra.user_id AS u_id
          FROM public.tasks t
          JOIN public.task_raci_assignments ra ON ra.task_id = t.id
          WHERE t.task_list_id = v_task.task_list_id AND ra.user_id IS NOT NULL
        ) sub WHERE u_id IS NOT NULL
      LOOP
        PERFORM private.emit_notification(
          v_workspace_id,
          v_recipient.u_id,
          'process_completed',
          'Process completed: ' || v_task_list.name,
          'All tasks in process "' || v_task_list.name || '" have been completed.',
          'task_list',
          v_task.task_list_id,
          v_task.project_id,
          NULL
        );
      END LOOP;
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- 7. REFACTOR public.complete_responsible_part (PROCESS_INSTANCE AWARE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_responsible_part(
  p_task_id      uuid,
  p_cycle_number integer,
  p_notes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id     uuid;
  v_task          RECORD;
  v_step          RECORD;
  v_instance      RECORD;
  v_task_list     RECORD;
  v_project       RECORD;
  v_workspace_id  uuid;
  v_process_name  text;
  v_is_r          boolean;
  v_unresponded_c integer;
  v_missing_e     integer;
  v_accountable_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'ready' THEN
    RAISE EXCEPTION 'Task is not in ready state for completion.';
  END IF;

  IF v_task.current_cycle_number <> p_cycle_number THEN
    RAISE EXCEPTION 'Cycle number mismatch. Expected % but got %.', v_task.current_cycle_number, p_cycle_number;
  END IF;

  -- Context resolution
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;
    v_process_name := v_task_list.name;
  END IF;

  -- Check Caller is assigned Responsible (R)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'R'
      AND (
        ra.user_id = v_caller_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_caller_id
            AND dm.is_active = true
        )
      )
  ) INTO v_is_r;

  IF NOT v_is_r THEN
    RAISE EXCEPTION 'Caller is not an assigned Responsible user for this task.';
  END IF;

  SELECT * INTO v_step FROM public.defined_process_steps WHERE id = v_task.process_step_id;

  -- Preflight: Consultation requirements
  IF v_step.consultation_required THEN
    SELECT count(*) INTO v_unresponded_c
    FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'C'
      AND ra.response_required = true
      AND NOT EXISTS (
        SELECT 1 FROM public.task_consultation_responses cr
        WHERE cr.task_id = p_task_id
          AND cr.cycle_number = p_cycle_number
          AND cr.user_id = ra.user_id
      );

    IF v_unresponded_c > 0 THEN
      RAISE EXCEPTION 'Cannot complete: % required consultation response(s) are pending.', v_unresponded_c;
    END IF;
  END IF;

  -- Preflight: Evidence requirements
  SELECT count(*) INTO v_missing_e
  FROM public.step_evidence_definitions ed
  WHERE ed.step_id = v_step.id
    AND ed.is_mandatory = true
    AND NOT EXISTS (
      SELECT 1 FROM public.task_evidence_submissions es
      WHERE es.task_id = p_task_id
        AND es.cycle_number = p_cycle_number
        AND es.evidence_definition_id = ed.id
    );

  IF v_missing_e > 0 THEN
    RAISE EXCEPTION 'Cannot complete: % mandatory evidence item(s) have not been submitted.', v_missing_e;
  END IF;

  -- Record Responsible Completion
  INSERT INTO public.task_responsible_completions (
    task_id, cycle_number, user_id, notes
  ) VALUES (
    p_task_id, p_cycle_number, v_caller_id, p_notes
  )
  ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET notes = p_notes, completed_at = now();

  -- Enable bypass marker for workflow mutation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- Branch: Approval required vs direct advance
  IF v_step.approval_required THEN
    UPDATE public.tasks
    SET workflow_state = 'in_review'
    WHERE id = p_task_id;

    -- Record Audit Event
    INSERT INTO public.process_audit_events (
      workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
    ) VALUES (
      v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_SUBMITTED_FOR_REVIEW', v_caller_id,
      jsonb_build_object('step_id', v_step.id, 'cycle_number', p_cycle_number)
    );

    -- Notify Accountable (A) user
    SELECT ra.user_id INTO v_accountable_id
    FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'A'
    LIMIT 1;

    IF v_accountable_id IS NOT NULL THEN
      PERFORM private.emit_notification(
        v_workspace_id,
        v_accountable_id,
        'process_task_review_needed',
        'Review Needed: ' || v_task.title,
        'Task in process "' || v_process_name || '" has been submitted for your approval.',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'in_review',
      'task_id', p_task_id,
      'cycle_number', p_cycle_number
    );
  ELSE
    -- Directly advance the task and DAG
    PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

    RETURN jsonb_build_object(
      'status', 'completed',
      'task_id', p_task_id,
      'cycle_number', p_cycle_number
    );
  END IF;
END;
$$;

-- ============================================================================
-- 8. REFACTOR public.submit_task_consultation (PROCESS_INSTANCE AWARE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_task_consultation(
  p_task_id       uuid,
  p_response_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id     uuid;
  v_task          RECORD;
  v_instance      RECORD;
  v_task_list     RECORD;
  v_project       RECORD;
  v_workspace_id  uuid;
  v_process_name  text;
  v_is_c          boolean;
  v_recipient     RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_response_text IS NULL OR btrim(p_response_text) = '' THEN
    RAISE EXCEPTION 'Response text cannot be empty.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state NOT IN ('ready', 'in_progress', 'waiting') THEN
    RAISE EXCEPTION 'Cannot submit consultation response in % state.', v_task.workflow_state;
  END IF;

  -- Context resolution
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;
    v_process_name := v_task_list.name;
  END IF;

  -- Check Caller is assigned Consulted (C)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'C'
      AND (
        ra.user_id = v_caller_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_caller_id
            AND dm.is_active = true
        )
      )
  ) INTO v_is_c;

  IF NOT v_is_c THEN
    RAISE EXCEPTION 'Caller is not an assigned Consulted participant for this task.';
  END IF;

  -- Record consultation response
  INSERT INTO public.task_consultation_responses (
    task_id, cycle_number, user_id, response_text
  ) VALUES (
    p_task_id, v_task.current_cycle_number, v_caller_id, p_response_text
  )
  ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET response_text = p_response_text, responded_at = now();

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_CONSULTATION_SUBMITTED', v_caller_id,
    jsonb_build_object('cycle_number', v_task.current_cycle_number)
  );

  -- Notify Responsible users
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL AND u_id <> v_caller_id
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_consultation_response',
      'Consultation Response: ' || v_task.title,
      'A consultation response was submitted for task in process "' || v_process_name || '".',
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'cycle_number', v_task.current_cycle_number
  );
END;
$$;

-- ============================================================================
-- 9. REFACTOR public.reject_process_task (DUE DATE INTEGRITY & BRANCHING)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_process_task(
  p_task_id              uuid,
  p_cycle_number         integer,
  p_rejection_reason     text,
  p_rework_instructions  text DEFAULT NULL,
  p_new_due_date         date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id     uuid;
  v_task          RECORD;
  v_instance      RECORD;
  v_task_list     RECORD;
  v_project       RECORD;
  v_workspace_id  uuid;
  v_process_name  text;
  v_is_a          boolean;
  v_recipient     RECORD;
  v_todo_status_id uuid;
  v_target_due_date date;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_rejection_reason IS NULL OR btrim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'in_review' THEN
    RAISE EXCEPTION 'Task must be in review state to be rejected.';
  END IF;

  IF v_task.current_cycle_number <> p_cycle_number THEN
    RAISE EXCEPTION 'Cycle number mismatch. Expected % but got %.', v_task.current_cycle_number, p_cycle_number;
  END IF;

  -- Check Caller is assigned Accountable (A)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'A'
      AND (
        ra.user_id = v_caller_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_caller_id
            AND dm.is_active = true
        )
      )
  ) INTO v_is_a;

  IF NOT v_is_a THEN
    RAISE EXCEPTION 'Caller is not an assigned Accountable user for this task.';
  END IF;

  -- Context resolution & Due date contract enforcement
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;

    -- Decisions 33 & 42: Process Instance steps do not have individual due dates
    IF p_new_due_date IS NOT NULL THEN
      RAISE EXCEPTION 'Process Instance steps do not have individual due dates.';
    END IF;
    v_target_due_date := NULL;
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;
    v_process_name := v_task_list.name;

    -- Legacy runtime requires new due date
    IF p_new_due_date IS NULL THEN
      RAISE EXCEPTION 'New due date is required for rework.';
    END IF;
    v_target_due_date := p_new_due_date;
  END IF;

  -- Resolve Todo status if project-attached
  IF v_task.project_id IS NOT NULL THEN
    SELECT id INTO v_todo_status_id
    FROM public.task_statuses
    WHERE project_id = v_task.project_id AND (system_code = 'todo' OR lower(name) = 'to do')
    ORDER BY position ASC LIMIT 1;

    IF v_todo_status_id IS NULL THEN
      SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position ASC LIMIT 1;
    END IF;
  END IF;

  -- Record Approval Cycle (Rejected)
  INSERT INTO public.task_approval_cycles (
    task_id, cycle_number, accountable_user_id, status, rejection_reason, rework_instructions
  ) VALUES (
    p_task_id, p_cycle_number, v_caller_id, 'rejected', p_rejection_reason, p_rework_instructions
  );

  -- Enable bypass marker for workflow mutation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- Transition task back to ready with incremented cycle number
  UPDATE public.tasks
  SET workflow_state = 'ready',
      current_cycle_number = current_cycle_number + 1,
      due_date = v_target_due_date,
      overdue_cycle_notified = false,
      status_id = COALESCE(v_todo_status_id, status_id)
  WHERE id = p_task_id;

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_REWORK_REQUESTED', v_caller_id,
    jsonb_build_object(
      'cycle_number', p_cycle_number,
      'next_cycle_number', p_cycle_number + 1,
      'rejection_reason', p_rejection_reason,
      'rework_instructions', p_rework_instructions
    )
  );

  -- Notify Responsible participants of rework
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL AND u_id <> v_caller_id
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_rework_requested',
      'Rework Requested: ' || v_task.title,
      'Rework requested for task in process "' || v_process_name || '": ' || p_rejection_reason,
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ready',
    'task_id', p_task_id,
    'next_cycle_number', p_cycle_number + 1
  );
END;
$$;
