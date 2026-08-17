-- =========================================================================
-- SNS Projects — Package 2 / P2-02
-- Process Instance Movement, Cancellation, Authorization & Audit
-- Migration: 20260817123556_p2_02_process_instance_movement_cancellation.sql
-- =========================================================================

-- 1. Schema Extensions on public.tasks and public.process_audit_events
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS owner_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_owner_id ON public.tasks(owner_id);

ALTER TABLE public.process_audit_events
  ADD COLUMN IF NOT EXISTS process_instance_id uuid NULL REFERENCES public.process_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_process_audit_events_instance ON public.process_audit_events(process_instance_id);

-- Ensure cancel columns exist on public.process_instances
ALTER TABLE public.process_instances
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text NULL;

CREATE INDEX IF NOT EXISTS idx_process_instances_cancelled_by ON public.process_instances(cancelled_by);

-- -------------------------------------------------------------------------
-- 2. Authorization Helper Functions (private schema)
-- -------------------------------------------------------------------------

-- 2.0 Hardened can_start_process_version
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
  v_version   RECORD;
  v_root_step RECORD;
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

  RETURN EXISTS (
    SELECT 1 FROM public.defined_process_step_raci r
    WHERE r.step_id = v_root_step.id
      AND r.raci_role = 'R'
      AND (
        (r.actor_type = 'user' AND r.user_id = p_caller_id)
        OR (r.actor_type = 'process_starter')
      )
  );
END;
$$;

-- 2.1 Override Authority Check (Admin, CEO, CTO, Workspace Owner/Admin)
CREATE OR REPLACE FUNCTION private.is_process_override_actor(
  p_workspace_id uuid,
  p_actor_id    uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_actor_id
      AND wm.status = 'active'
      AND wm.role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM public.user_system_roles usr
    WHERE usr.workspace_id = p_workspace_id
      AND usr.user_id = p_actor_id
      AND usr.role IN ('system_admin', 'project_admin', 'ceo', 'cto')
  );
$$;

-- 2.2 Nearest Placement Owner Resolution
CREATE OR REPLACE FUNCTION private.get_nearest_placement_owner(
  p_placement_type text,
  p_project_id     uuid DEFAULT NULL,
  p_phase_id       uuid DEFAULT NULL,
  p_task_list_id   uuid DEFAULT NULL,
  p_parent_task_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id      uuid;
  v_task_list_id  uuid := p_task_list_id;
  v_phase_id      uuid := p_phase_id;
  v_project_id    uuid := p_project_id;
BEGIN
  -- Task Placement: Check Task Owner -> Task Responsible (R) -> ascend
  IF p_placement_type = 'task' AND p_parent_task_id IS NOT NULL THEN
    SELECT COALESCE(t.owner_id, (
      SELECT ra.user_id FROM public.task_raci_assignments ra
      WHERE ra.task_id = p_parent_task_id AND ra.raci_role = 'R'
      LIMIT 1
    )), t.task_list_id, t.phase_id, t.project_id
    INTO v_owner_id, v_task_list_id, v_phase_id, v_project_id
    FROM public.tasks t
    WHERE t.id = p_parent_task_id;

    IF v_owner_id IS NOT NULL THEN
      RETURN v_owner_id;
    END IF;
  END IF;

  -- Task List Level
  IF v_task_list_id IS NOT NULL THEN
    SELECT tl.owner_id, tl.phase_id, tl.project_id
    INTO v_owner_id, v_phase_id, v_project_id
    FROM public.task_lists tl
    WHERE tl.id = v_task_list_id;

    IF v_owner_id IS NOT NULL THEN
      RETURN v_owner_id;
    END IF;
  END IF;

  -- Phase Level
  IF v_phase_id IS NOT NULL THEN
    SELECT ph.owner_id, ph.project_id
    INTO v_owner_id, v_project_id
    FROM public.phases ph
    WHERE ph.id = v_phase_id;

    IF v_owner_id IS NOT NULL THEN
      RETURN v_owner_id;
    END IF;
  END IF;

  -- Project Level
  IF v_project_id IS NOT NULL THEN
    SELECT p.owner_id
    INTO v_owner_id
    FROM public.projects p
    WHERE p.id = v_project_id;

    IF v_owner_id IS NOT NULL THEN
      RETURN v_owner_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- 2.3 Can Move Process Instance Check
CREATE OR REPLACE FUNCTION private.can_move_process_instance(
  p_instance_id uuid,
  p_actor_id    uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inst record;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, workspace_id, owner_id, placement_type, project_id, phase_id, task_list_id, parent_task_id, status
  INTO v_inst
  FROM public.process_instances
  WHERE id = p_instance_id;

  IF NOT FOUND OR v_inst.status <> 'running' THEN
    RETURN false;
  END IF;

  -- Active workspace membership required
  IF NOT private.is_workspace_active_member(v_inst.workspace_id) THEN
    -- Check if explicitly active member
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = v_inst.workspace_id AND wm.user_id = p_actor_id AND wm.status = 'active'
    ) THEN
      RETURN false;
    END IF;
  END IF;

  -- 1. Process Instance Owner
  IF v_inst.owner_id = p_actor_id THEN
    RETURN true;
  END IF;

  -- 2. Nearest Current Placement Owner / Responsible
  IF p_actor_id = private.get_nearest_placement_owner(
    v_inst.placement_type, v_inst.project_id, v_inst.phase_id, v_inst.task_list_id, v_inst.parent_task_id
  ) THEN
    RETURN true;
  END IF;

  -- If placement is task, check if actor is assigned Responsible on parent task
  IF v_inst.placement_type = 'task' AND v_inst.parent_task_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.task_raci_assignments ra
      WHERE ra.task_id = v_inst.parent_task_id AND ra.raci_role = 'R' AND ra.user_id = p_actor_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  -- 3. Executive / Admin Override
  IF private.is_process_override_actor(v_inst.workspace_id, p_actor_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 2.4 Can Cancel Process Instance Check
CREATE OR REPLACE FUNCTION private.can_cancel_process_instance(
  p_instance_id uuid,
  p_actor_id    uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inst record;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, workspace_id, started_by, owner_id, status
  INTO v_inst
  FROM public.process_instances
  WHERE id = p_instance_id;

  IF NOT FOUND OR v_inst.status <> 'running' THEN
    RETURN false;
  END IF;

  -- Active workspace membership required
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = v_inst.workspace_id AND wm.user_id = p_actor_id AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  -- 1. Process Starter
  IF v_inst.started_by = p_actor_id THEN
    RETURN true;
  END IF;

  -- 2. Process Owner
  IF v_inst.owner_id = p_actor_id THEN
    RETURN true;
  END IF;

  -- 3. Executive / Admin Override
  IF private.is_process_override_actor(v_inst.workspace_id, p_actor_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 2.5 Can View Process Instance Check
CREATE OR REPLACE FUNCTION private.can_view_process_instance(
  p_instance_id uuid,
  p_actor_id    uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inst record;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, workspace_id, started_by, owner_id, placement_type, project_id
  INTO v_inst
  FROM public.process_instances
  WHERE id = p_instance_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Must be an active member of the workspace
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = v_inst.workspace_id AND wm.user_id = p_actor_id AND wm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  -- 1. Executive / Admin Override
  IF private.is_process_override_actor(v_inst.workspace_id, p_actor_id) THEN
    RETURN true;
  END IF;

  -- 2. Process Starter or Owner
  IF v_inst.started_by = p_actor_id OR v_inst.owner_id = p_actor_id THEN
    RETURN true;
  END IF;

  -- 3. Explicit Process Step RACI participant (R, A, C, I)
  IF EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.task_raci_assignments ra ON ra.task_id = t.id
    WHERE t.process_instance_id = v_inst.id
      AND ra.user_id = p_actor_id
  ) THEN
    RETURN true;
  END IF;

  -- 4. Attached Process Instance: visible to active workspace members who can view the host project
  IF v_inst.placement_type <> 'standalone' AND v_inst.project_id IS NOT NULL THEN
    RETURN true;
  END IF;

  -- Standalone instance not matching starter/owner/RACI/admin is hidden
  RETURN false;
END;
$$;

-- -------------------------------------------------------------------------
-- 3. Process Instance Movement Engine
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.move_process_instance_internal(
  p_instance_id           uuid,
  p_target_placement_type text,
  p_target_phase_id       uuid DEFAULT NULL,
  p_target_task_list_id   uuid DEFAULT NULL,
  p_target_parent_task_id uuid DEFAULT NULL,
  p_reason                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id             uuid;
  v_instance              RECORD;
  v_target_phase_id       uuid := p_target_phase_id;
  v_target_task_list_id   uuid := p_target_task_list_id;
  v_target_parent_task_id uuid := p_target_parent_task_id;
  v_target_phase          RECORD;
  v_target_task_list      RECORD;
  v_target_task           RECORD;
  v_old_placement         jsonb;
  v_new_placement         jsonb;
  v_moved_tasks_count     integer := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Move reason is required and cannot be empty.';
  END IF;

  SELECT * INTO v_instance FROM public.process_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Process instance not found.';
  END IF;

  IF v_instance.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot move completed process instance.';
  END IF;

  IF v_instance.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot move cancelled process instance.';
  END IF;

  IF v_instance.status <> 'running' THEN
    RAISE EXCEPTION 'Process instance is not running (current status: %).', v_instance.status;
  END IF;

  IF v_instance.placement_type = 'standalone' THEN
    RAISE EXCEPTION 'Standalone instance cannot be moved.';
  END IF;

  IF p_target_placement_type = 'standalone' THEN
    RAISE EXCEPTION 'Attached instance cannot be converted to standalone.';
  END IF;

  IF p_target_placement_type NOT IN ('project', 'phase', 'task_list', 'task') THEN
    RAISE EXCEPTION 'Invalid target placement type: %.', p_target_placement_type;
  END IF;

  -- Authorization check
  IF NOT private.can_move_process_instance(p_instance_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller not authorized to move process instance.';
  END IF;

  -- Validate target placement within SAME project
  IF p_target_placement_type = 'project' THEN
    v_target_phase_id := NULL;
    v_target_task_list_id := NULL;
    v_target_parent_task_id := NULL;

  ELSIF p_target_placement_type = 'phase' THEN
    IF v_target_phase_id IS NULL THEN
      RAISE EXCEPTION 'Target phase ID required for phase placement.';
    END IF;
    SELECT * INTO v_target_phase FROM public.phases WHERE id = v_target_phase_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid placement target hierarchy: phase not found.';
    END IF;
    IF v_target_phase.project_id <> v_instance.project_id THEN
      RAISE EXCEPTION 'Cross-project movement is prohibited: target phase belongs to a different project.';
    END IF;
    v_target_task_list_id := NULL;
    v_target_parent_task_id := NULL;

  ELSIF p_target_placement_type = 'task_list' THEN
    IF v_target_task_list_id IS NULL THEN
      RAISE EXCEPTION 'Target task list ID required for task_list placement.';
    END IF;
    SELECT * INTO v_target_task_list FROM public.task_lists WHERE id = v_target_task_list_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid placement target hierarchy: task list not found.';
    END IF;
    IF v_target_task_list.project_id <> v_instance.project_id THEN
      RAISE EXCEPTION 'Cross-project movement is prohibited: target task list belongs to a different project.';
    END IF;
    -- Authoritative phase from task list
    v_target_phase_id := v_target_task_list.phase_id;
    v_target_parent_task_id := NULL;

  ELSIF p_target_placement_type = 'task' THEN
    IF v_target_parent_task_id IS NULL THEN
      RAISE EXCEPTION 'Target parent task ID required for task placement.';
    END IF;

    -- Cycle Prevention: target task cannot be a step task of this process instance
    IF EXISTS (
      SELECT 1 FROM public.tasks WHERE id = v_target_parent_task_id AND process_instance_id = p_instance_id
    ) THEN
      RAISE EXCEPTION 'Circular hierarchy detected: cannot move process instance under its own step task.';
    END IF;

    -- Descendant check: target task cannot be any descendant of this instance's step tasks
    IF EXISTS (
      WITH RECURSIVE task_tree AS (
        SELECT id FROM public.tasks WHERE process_instance_id = p_instance_id
        UNION ALL
        SELECT t.id FROM public.tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT 1 FROM task_tree WHERE id = v_target_parent_task_id
    ) THEN
      RAISE EXCEPTION 'Circular hierarchy detected: cannot move process instance under a descendant of its step tasks.';
    END IF;

    SELECT * INTO v_target_task FROM public.tasks WHERE id = v_target_parent_task_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid placement target hierarchy: target parent task not found.';
    END IF;
    IF v_target_task.project_id IS DISTINCT FROM v_instance.project_id THEN
      RAISE EXCEPTION 'Cross-project movement is prohibited: target task belongs to a different project.';
    END IF;

    -- Authoritative hierarchy from target parent task
    v_target_phase_id := v_target_task.phase_id;
    v_target_task_list_id := v_target_task.task_list_id;
  END IF;

  -- Detect No-op
  IF v_instance.placement_type = p_target_placement_type
     AND v_instance.phase_id IS NOT DISTINCT FROM v_target_phase_id
     AND v_instance.task_list_id IS NOT DISTINCT FROM v_target_task_list_id
     AND v_instance.parent_task_id IS NOT DISTINCT FROM v_target_parent_task_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_noop', true,
      'process_instance_id', p_instance_id,
      'placement_type', v_instance.placement_type,
      'project_id', v_instance.project_id,
      'phase_id', v_instance.phase_id,
      'task_list_id', v_instance.task_list_id,
      'parent_task_id', v_instance.parent_task_id
    );
  END IF;

  v_old_placement := jsonb_build_object(
    'placement_type', v_instance.placement_type,
    'project_id', v_instance.project_id,
    'phase_id', v_instance.phase_id,
    'task_list_id', v_instance.task_list_id,
    'parent_task_id', v_instance.parent_task_id
  );

  v_new_placement := jsonb_build_object(
    'placement_type', p_target_placement_type,
    'project_id', v_instance.project_id,
    'phase_id', v_target_phase_id,
    'task_list_id', v_target_task_list_id,
    'parent_task_id', v_target_parent_task_id
  );

  -- Set engine write context
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- Update Process Instance row
  UPDATE public.process_instances
  SET placement_type = p_target_placement_type,
      phase_id       = v_target_phase_id,
      task_list_id   = v_target_task_list_id,
      parent_task_id = v_target_parent_task_id,
      updated_at     = now()
  WHERE id = p_instance_id;

  -- Update materialized step tasks
  -- Root step tasks get parent_task_id = v_target_parent_task_id
  -- (NULL for project/phase/task_list, host task ID for task placement)
  WITH updated AS (
    UPDATE public.tasks
    SET phase_id       = v_target_phase_id,
        task_list_id   = v_target_task_list_id,
        parent_task_id = v_target_parent_task_id,
        updated_at     = now()
    WHERE process_instance_id = p_instance_id
      AND process_step_id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_moved_tasks_count FROM updated;

  -- Write immutable PROCESS_MOVED audit event
  INSERT INTO public.process_audit_events (
    workspace_id,
    project_id,
    task_list_id,
    process_instance_id,
    event_type,
    actor_id,
    payload,
    created_at
  ) VALUES (
    v_instance.workspace_id,
    v_instance.project_id,
    v_target_task_list_id,
    p_instance_id,
    'PROCESS_MOVED',
    v_caller_id,
    jsonb_build_object(
      'process_instance_id', p_instance_id,
      'actor_id', v_caller_id,
      'reason', trim(p_reason),
      'old_placement', v_old_placement,
      'new_placement', v_new_placement,
      'moved_tasks_count', v_moved_tasks_count,
      'timestamp', now()
    ),
    now()
  );

  PERFORM set_config('sns.process_engine_write', '', true);

  RETURN jsonb_build_object(
    'success', true,
    'is_noop', false,
    'process_instance_id', p_instance_id,
    'placement_type', p_target_placement_type,
    'project_id', v_instance.project_id,
    'phase_id', v_target_phase_id,
    'task_list_id', v_target_task_list_id,
    'parent_task_id', v_target_parent_task_id,
    'moved_tasks_count', v_moved_tasks_count
  );
END;
$$;

-- 3.2 Public Move Invoker Wrapper
CREATE OR REPLACE FUNCTION public.move_process_instance(
  p_instance_id           uuid,
  p_target_placement_type text,
  p_target_phase_id       uuid DEFAULT NULL,
  p_target_task_list_id   uuid DEFAULT NULL,
  p_target_parent_task_id uuid DEFAULT NULL,
  p_reason                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.move_process_instance_internal(
    p_instance_id,
    p_target_placement_type,
    p_target_phase_id,
    p_target_task_list_id,
    p_target_parent_task_id,
    p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_process_instance(uuid, text, uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_process_instance(uuid, text, uuid, uuid, uuid, text) TO authenticated;

-- -------------------------------------------------------------------------
-- 4. Process Instance Cancellation Engine
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.cancel_process_instance_internal(
  p_instance_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id            uuid;
  v_instance             RECORD;
  v_cancelled_step_count integer := 0;
  v_completed_step_count integer := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Cancel reason is required and cannot be empty.';
  END IF;

  SELECT * INTO v_instance FROM public.process_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Process instance not found.';
  END IF;

  -- Idempotency: Replay if already cancelled
  IF v_instance.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_replay', true,
      'process_instance_id', p_instance_id,
      'status', 'cancelled',
      'cancelled_by', v_instance.cancelled_by,
      'cancelled_at', v_instance.cancelled_at,
      'cancel_reason', v_instance.cancel_reason
    );
  END IF;

  IF v_instance.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot cancel completed process instance.';
  END IF;

  -- Authorization check
  IF NOT private.can_cancel_process_instance(p_instance_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller not authorized to cancel process instance.';
  END IF;

  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 1. Update Process Instance status
  UPDATE public.process_instances
  SET status        = 'cancelled',
      cancelled_by  = v_caller_id,
      cancelled_at  = now(),
      cancel_reason = trim(p_reason),
      updated_at    = now()
  WHERE id = p_instance_id;

  -- 2. Materialized Step Tasks: Unfinished step tasks become 'cancelled'
  WITH updated_tasks AS (
    UPDATE public.tasks
    SET workflow_state = 'cancelled',
        updated_at     = now()
    WHERE process_instance_id = p_instance_id
      AND process_step_id IS NOT NULL
      AND workflow_state NOT IN ('completed', 'cancelled')
    RETURNING id
  )
  SELECT count(*) INTO v_cancelled_step_count FROM updated_tasks;

  -- Count completed step tasks preserved
  SELECT count(*) INTO v_completed_step_count
  FROM public.tasks
  WHERE process_instance_id = p_instance_id
    AND process_step_id IS NOT NULL
    AND workflow_state = 'completed';

  -- If standalone parent container task exists and not completed, cancel it
  IF v_instance.placement_type = 'standalone' THEN
    UPDATE public.tasks
    SET workflow_state = 'cancelled',
        updated_at     = now()
    WHERE process_instance_id = p_instance_id
      AND process_step_id IS NULL
      AND workflow_state NOT IN ('completed', 'cancelled');
  END IF;

  -- 3. Write immutable PROCESS_CANCELLED audit event
  INSERT INTO public.process_audit_events (
    workspace_id,
    project_id,
    task_list_id,
    process_instance_id,
    event_type,
    actor_id,
    payload,
    created_at
  ) VALUES (
    v_instance.workspace_id,
    v_instance.project_id,
    v_instance.task_list_id,
    p_instance_id,
    'PROCESS_CANCELLED',
    v_caller_id,
    jsonb_build_object(
      'process_instance_id', p_instance_id,
      'actor_id', v_caller_id,
      'reason', trim(p_reason),
      'completed_step_count', v_completed_step_count,
      'cancelled_step_count', v_cancelled_step_count,
      'timestamp', now(),
      'placement', jsonb_build_object(
        'placement_type', v_instance.placement_type,
        'project_id', v_instance.project_id,
        'phase_id', v_instance.phase_id,
        'task_list_id', v_instance.task_list_id,
        'parent_task_id', v_instance.parent_task_id
      )
    ),
    now()
  );

  PERFORM set_config('sns.process_engine_write', '', true);

  RETURN jsonb_build_object(
    'success', true,
    'is_replay', false,
    'process_instance_id', p_instance_id,
    'status', 'cancelled',
    'completed_step_count', v_completed_step_count,
    'cancelled_step_count', v_cancelled_step_count,
    'cancelled_at', now()
  );
END;
$$;

-- 4.2 Public Cancel Invoker Wrapper
CREATE OR REPLACE FUNCTION public.cancel_process_instance(
  p_instance_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.cancel_process_instance_internal(p_instance_id, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_process_instance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_process_instance(uuid, text) TO authenticated;

--- -------------------------------------------------------------------------
-- 5. Post-Cancellation Runtime Guards on Workflow Functions
-- -------------------------------------------------------------------------

-- 5.1 Hardened complete_responsible_part_internal (SECURITY DEFINER in private schema)
CREATE OR REPLACE FUNCTION private.complete_responsible_part_internal(
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
  v_caller_id        uuid;
  v_task             RECORD;
  v_instance         RECORD;
  v_task_list        RECORD;
  v_project          RECORD;
  v_step             RECORD;
  v_workspace_id     uuid;
  v_process_name     text;
  v_is_r             boolean;
  v_unresponded_c    integer;
  v_missing_e        integer;
  v_recipient        RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- Post-cancellation task state guard
  IF v_task.workflow_state = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot modify task: task belongs to a cancelled process instance.';
  END IF;

  IF v_task.workflow_state NOT IN ('ready', 'active', 'rework_required') THEN
    RAISE EXCEPTION 'Task is not in an actionable state (current state: %).', v_task.workflow_state;
  END IF;

  IF v_task.current_cycle_number <> p_cycle_number THEN
    RAISE EXCEPTION 'Cycle number mismatch. Expected % but got %.', v_task.current_cycle_number, p_cycle_number;
  END IF;

  -- Context resolution & parent process instance status guard
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    IF v_instance.status <> 'running' THEN
      RAISE EXCEPTION 'Process instance is % (must be running to perform workflow actions).', v_instance.status;
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
  FROM public.defined_process_step_evidence_defs ed
  WHERE ed.step_id = v_step.id
    AND ed.is_mandatory = true
    AND NOT EXISTS (
      SELECT 1 FROM public.task_evidence_submissions es
      WHERE es.task_id = p_task_id
        AND es.cycle_number = p_cycle_number
        AND es.evidence_def_id = ed.id
    );

  IF v_missing_e > 0 THEN
    RAISE EXCEPTION 'Cannot complete: % mandatory evidence item(s) are missing.', v_missing_e;
  END IF;

  -- Record responsible completion
  INSERT INTO public.task_responsible_completions (
    task_id, cycle_number, user_id, completion_note
  ) VALUES (
    p_task_id, p_cycle_number, v_caller_id, p_notes
  )
  ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET completion_note = p_notes, completed_at = now();

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, process_instance_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, v_task.process_instance_id,
    'TASK_RESPONSIBLE_COMPLETED', v_caller_id,
    jsonb_build_object('step_id', v_step.id, 'cycle_number', p_cycle_number)
  );

  -- Branch: Approval Required vs Direct Advance
  IF v_step.approval_required THEN
    PERFORM set_config('sns.process_engine_write', 'on', true);
    UPDATE public.tasks
    SET workflow_state = 'awaiting_approval',
        updated_at = now()
    WHERE id = p_task_id;

    -- Ensure approval cycle record exists
    INSERT INTO public.task_approval_cycles (
      task_id, cycle_number, status
    ) VALUES (
      p_task_id, p_cycle_number, 'pending'
    )
    ON CONFLICT (task_id, cycle_number)
    DO UPDATE SET status = 'pending', decided_at = NULL, decided_by = NULL, decision_reason = NULL;

    -- Notify Accountable users
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'approval_required',
        'Approval required: ' || v_task.title,
        'Task "' || v_task.title || '" has completed work and is awaiting your approval.',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

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

REVOKE ALL ON FUNCTION private.complete_responsible_part_internal(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_responsible_part_internal(uuid, integer, text) TO authenticated, service_role, postgres;

-- 5.2 Hardened reject_process_task_internal (SECURITY DEFINER in private schema)
CREATE OR REPLACE FUNCTION private.reject_process_task_internal(
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
  v_caller_id       uuid;
  v_task            RECORD;
  v_instance        RECORD;
  v_task_list       RECORD;
  v_project         RECORD;
  v_workspace_id    uuid;
  v_process_name    text;
  v_is_a            boolean;
  v_recipient       RECORD;
  v_todo_status_id  uuid;
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

  -- Post-cancellation task state guard
  IF v_task.workflow_state = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot modify task: task belongs to a cancelled process instance.';
  END IF;

  IF v_task.workflow_state NOT IN ('awaiting_approval', 'in_review') THEN
    RAISE EXCEPTION 'Task must be in review state to be rejected (current state: %).', v_task.workflow_state;
  END IF;

  IF v_task.current_cycle_number <> p_cycle_number THEN
    RAISE EXCEPTION 'Cycle number mismatch. Expected % but got %.', v_task.current_cycle_number, p_cycle_number;
  END IF;

  -- Context resolution & parent process instance status guard
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    IF v_instance.status <> 'running' THEN
      RAISE EXCEPTION 'Process instance is % (must be running to perform workflow actions).', v_instance.status;
    END IF;
    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;

    -- Decisions 33 & 42: Steps in a Process Instance must NOT have individual due dates
    IF p_new_due_date IS NOT NULL THEN
      RAISE EXCEPTION 'Process Instance steps do not have individual due dates.';
    END IF;
    v_target_due_date := NULL;
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;
    v_process_name := v_task_list.name;

    -- Legacy runtime requires due date for rework
    IF p_new_due_date IS NULL THEN
      RAISE EXCEPTION 'New due date is required for rework.';
    END IF;
    v_target_due_date := p_new_due_date;
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

  -- Record rejection in approval cycle
  INSERT INTO public.task_approval_cycles (
    task_id, cycle_number, status, rejection_reason, rework_instructions, decided_by, decided_at
  ) VALUES (
    p_task_id, p_cycle_number, 'rejected', p_rejection_reason, p_rework_instructions, v_caller_id, now()
  )
  ON CONFLICT (task_id, cycle_number)
  DO UPDATE SET
    status = 'rejected',
    rejection_reason = p_rejection_reason,
    rework_instructions = p_rework_instructions,
    decided_by = v_caller_id,
    decided_at = now();

  -- Enable bypass marker for workflow mutation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- Transition task back to ready for rework
  UPDATE public.tasks
  SET workflow_state = 'ready',
      current_cycle_number = v_task.current_cycle_number + 1,
      status_id = COALESCE(v_todo_status_id, status_id),
      due_date = COALESCE(v_target_due_date, due_date),
      ready_at = now(),
      updated_at = now()
  WHERE id = p_task_id;

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, process_instance_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, v_task.process_instance_id,
    'TASK_REJECTED', v_caller_id,
    jsonb_build_object(
      'step_id', v_task.process_step_id,
      'cycle_number', p_cycle_number,
      'new_cycle_number', v_task.current_cycle_number + 1,
      'reason', p_rejection_reason
    )
  );

  -- Notify Responsible users of rework requirement
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'rework_required',
      'Rework required: ' || v_task.title,
      'Task "' || v_task.title || '" was rejected and requires rework. Reason: ' || p_rejection_reason,
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ready',
    'task_id', p_task_id,
    'new_cycle_number', v_task.current_cycle_number + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION private.reject_process_task_internal(uuid, integer, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.reject_process_task_internal(uuid, integer, text, text, date) TO authenticated, service_role, postgres;

-- -------------------------------------------------------------------------
-- 6. Permissions RPC for Frontend & Package 3
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_process_instance_permissions(
  p_instance_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_caller_id    uuid;
  v_inst         RECORD;
  v_can_view     boolean;
  v_can_move     boolean;
  v_can_cancel   boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'can_view', false,
      'can_move', false,
      'can_cancel', false,
      'error', 'Authentication required'
    );
  END IF;

  SELECT * INTO v_inst FROM public.process_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'can_view', false,
      'can_move', false,
      'can_cancel', false,
      'error', 'Process instance not found'
    );
  END IF;

  v_can_view := private.can_view_process_instance(p_instance_id, v_caller_id);
  IF NOT v_can_view THEN
    RETURN jsonb_build_object(
      'can_view', false,
      'can_move', false,
      'can_cancel', false
    );
  END IF;

  v_can_move := private.can_move_process_instance(p_instance_id, v_caller_id);
  v_can_cancel := private.can_cancel_process_instance(p_instance_id, v_caller_id);

  RETURN jsonb_build_object(
    'can_view', true,
    'can_move', v_can_move,
    'can_cancel', v_can_cancel,
    'placement_type', v_inst.placement_type,
    'status', v_inst.status,
    'project_id', v_inst.project_id,
    'phase_id', v_inst.phase_id,
    'task_list_id', v_inst.task_list_id,
    'parent_task_id', v_inst.parent_task_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_process_instance_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_process_instance_permissions(uuid) TO authenticated;

-- -------------------------------------------------------------------------
-- 7. Row-Level Security on public.process_instances
-- -------------------------------------------------------------------------

ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS process_instances_select_policy ON public.process_instances;
CREATE POLICY process_instances_select_policy ON public.process_instances
  FOR SELECT
  TO authenticated
  USING (
    private.can_view_process_instance(id, auth.uid())
  );

-- Revoke direct DML from authenticated, anon, PUBLIC
REVOKE ALL ON TABLE public.process_instances FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.process_instances FROM authenticated;
GRANT SELECT ON TABLE public.process_instances TO authenticated;
GRANT ALL ON TABLE public.process_instances TO service_role, postgres;
