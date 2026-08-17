-- ============================================================================
-- Migration: 20260817111751_p1_02d_process_instance_provenance_schema_parity.sql
-- Package: Package 01 — Core Foundation & Process Architecture
-- Task ID: P1-02D
-- Description:
--   1. Replaces chk_tasks_defined_provenance_coherence to safely support:
--      - Class A: Normal / Custom Tasks
--      - Class B: Standalone Process Container Tasks
--      - Class C1: Legacy Defined Process Step Tasks (process_instance_id IS NULL)
--      - Class C2: New Process Instance Step Tasks (process_instance_id IS NOT NULL)
--   2. Drops composite FK fk_tasks_task_list_version and installs conditional
--      validation trigger trg_validate_legacy_task_list_version for legacy tasks.
--   3. Replaces single uq_tasks_task_list_process_step index with two partial
--      unique indexes (legacy task-list scoped vs process-instance scoped).
--   4. Hardens private.complete_responsible_part_internal (correct evidence table
--      and column references) and provides backward-compatible legacy RPC overloads.
-- ============================================================================

-- ── 1. Tasks Provenance & Hierarchy Coherence CHECK Invariant ───────────────

-- Safely align tasks_hierarchy_check to support phase-level process instances
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_hierarchy_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_hierarchy_check CHECK (
    (milestone_id IS NULL AND task_list_id IS NULL)
    OR
    (milestone_id IS NOT NULL AND task_list_id IS NOT NULL)
    OR
    (process_instance_id IS NOT NULL AND milestone_id IS NOT NULL AND task_list_id IS NULL)
  );

COMMENT ON CONSTRAINT tasks_hierarchy_check ON public.tasks IS
  'Guarantees hierarchy coherence for custom tasks while supporting phase-level process instance placement.';

-- Safely drop old DP-1-D constraint definition
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS chk_tasks_defined_provenance_coherence;

ALTER TABLE public.tasks
  ADD CONSTRAINT chk_tasks_defined_provenance_coherence CHECK (
    -- Class A: Normal / Custom Task (non-process)
    (
      process_step_id IS NULL
      AND defined_process_version_id IS NULL
      AND process_instance_id IS NULL
      AND workflow_state IS NULL
      AND current_cycle_number IS NULL
      AND ready_at IS NULL
      AND activated_at IS NULL
      AND workflow_completed_at IS NULL
      AND overdue_cycle_notified IS NULL
    )
    OR
    -- Class B: Standalone Process Container Task
    (
      process_instance_id IS NOT NULL
      AND process_step_id IS NULL
      AND defined_process_version_id IS NULL
      AND parent_task_id IS NULL
      AND project_id IS NULL
      AND milestone_id IS NULL
      AND phase_id IS NULL
      AND task_list_id IS NULL
    )
    OR
    -- Class C1: Legacy Defined Process Step Task
    (
      process_instance_id IS NULL
      AND process_step_id IS NOT NULL
      AND defined_process_version_id IS NOT NULL
      AND task_list_id IS NOT NULL
      AND milestone_id IS NOT NULL
      AND workflow_state IS NOT NULL
      AND current_cycle_number IS NOT NULL
      AND current_cycle_number >= 1
      AND overdue_cycle_notified IS NOT NULL
      AND assignee_id IS NULL
    )
    OR
    -- Class C2: New Process Instance Step Task
    (
      process_instance_id IS NOT NULL
      AND process_step_id IS NOT NULL
      AND defined_process_version_id IS NOT NULL
      AND workflow_state IS NOT NULL
      AND current_cycle_number IS NOT NULL
      AND current_cycle_number >= 1
      AND assignee_id IS NULL
    )
  );

COMMENT ON CONSTRAINT chk_tasks_defined_provenance_coherence ON public.tasks IS
  'Ensures task field integrity across Normal tasks, Standalone process containers, Legacy step tasks, and Process Instance step tasks.';


-- ── 2. Conditional Task List Version Coherence Trigger ──────────────────────

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS fk_tasks_task_list_version;

CREATE OR REPLACE FUNCTION public.sync_validate_legacy_task_list_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_list_version_id uuid;
BEGIN
  -- Strict version validation ONLY for legacy defined process step tasks
  IF NEW.process_instance_id IS NULL AND NEW.process_step_id IS NOT NULL THEN
    IF NEW.task_list_id IS NULL THEN
      RAISE EXCEPTION 'Legacy defined process step task must have a task_list_id.';
    END IF;

    SELECT defined_process_version_id INTO v_list_version_id
    FROM public.task_lists
    WHERE id = NEW.task_list_id;

    IF v_list_version_id IS NULL OR v_list_version_id <> NEW.defined_process_version_id THEN
      RAISE EXCEPTION 'Version coherence violation: task_list % (version: %) does not match task defined_process_version_id %.',
        NEW.task_list_id, v_list_version_id, NEW.defined_process_version_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_validate_legacy_task_list_version() IS
  'Enforces Defined Process Version coherence between task_lists and tasks strictly for legacy Defined Processes (process_instance_id IS NULL).';

REVOKE ALL ON FUNCTION public.sync_validate_legacy_task_list_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_validate_legacy_task_list_version() TO authenticated, service_role, postgres;

DROP TRIGGER IF EXISTS trg_validate_legacy_task_list_version ON public.tasks;
CREATE TRIGGER trg_validate_legacy_task_list_version
  BEFORE INSERT OR UPDATE OF task_list_id, process_step_id, defined_process_version_id, process_instance_id
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_validate_legacy_task_list_version();


-- ── 3. Split Unique Step Indexes (Legacy vs Process Instance) ───────────────

DROP INDEX IF EXISTS public.uq_tasks_task_list_process_step;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS uq_tasks_task_list_process_step;

DROP INDEX IF EXISTS public.uq_tasks_legacy_task_list_step;
DROP INDEX IF EXISTS public.uq_tasks_instance_process_step;
DROP INDEX IF EXISTS public.uq_tasks_instance_step;

-- Legacy partial unique index: exactly 1 step per task list for legacy process tasks
CREATE UNIQUE INDEX uq_tasks_legacy_task_list_step
  ON public.tasks (task_list_id, process_step_id)
  WHERE process_step_id IS NOT NULL AND process_instance_id IS NULL;

COMMENT ON INDEX public.uq_tasks_legacy_task_list_step IS
  'Enforces exactly 1 materialized task per process step inside a legacy Defined Process Task List.';

-- New Process Instance partial unique index: exactly 1 step per process instance
CREATE UNIQUE INDEX uq_tasks_instance_process_step
  ON public.tasks (process_instance_id, process_step_id)
  WHERE process_step_id IS NOT NULL AND process_instance_id IS NOT NULL;

COMMENT ON INDEX public.uq_tasks_instance_process_step IS
  'Enforces exactly 1 materialized task per process step inside each discrete Process Instance, supporting multiple instances in the same task list.';


-- ── 4. Process Workflow Internal Engine & Canonical RPC Hardening ────────────

-- 4.0 Internal start_process_instance engine (SECURITY DEFINER in private schema)
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
       OR (p_placement_type <> 'standalone' AND v_existing_instance.parent_task_id IS DISTINCT FROM v_parent_task_id)
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
      NULL,
      false,
      v_pos,
      v_caller_id
    ) RETURNING id INTO v_task_id;

    IF v_is_root THEN
      v_root_task_id := v_task_id;
    END IF;

    -- Copy Step RACI with Dynamic process_starter Resolution
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
        NULL::uuid AS department_id,
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

  -- 14. Return Instance Summary
  RETURN jsonb_build_object(
    'process_instance_id', v_instance_id,
    'placement_type', p_placement_type,
    'root_task_id', v_root_task_id,
    'parent_task_id', v_standalone_parent_id,
    'task_count', v_task_count,
    'is_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.start_process_instance_internal(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.start_process_instance_internal(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) TO service_role, postgres;

-- 4.1 Internal complete_responsible_part engine (SECURITY DEFINER in private schema)
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

  IF v_task.workflow_state NOT IN ('ready', 'active', 'rework_required') THEN
    RAISE EXCEPTION 'Task is not in an actionable state (current state: %).', v_task.workflow_state;
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
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_RESPONSIBLE_COMPLETED', v_caller_id,
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


-- 4.2 Canonical Public 3-argument complete_responsible_part wrapper (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.complete_responsible_part(
  p_task_id      uuid,
  p_cycle_number integer,
  p_notes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.complete_responsible_part_internal(
    p_task_id,
    p_cycle_number,
    p_notes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_responsible_part(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_responsible_part(uuid, integer, text) TO authenticated;


-- 4.3 Backward-compatible Legacy 2-argument complete_responsible_part wrapper (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.complete_responsible_part(
  p_task_id uuid,
  p_note    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_cycle integer;
BEGIN
  SELECT current_cycle_number INTO v_cycle FROM public.tasks WHERE id = p_task_id;
  IF v_cycle IS NULL THEN
    v_cycle := 1;
  END IF;

  RETURN private.complete_responsible_part_internal(
    p_task_id,
    v_cycle,
    p_note
  );
END;
$$;

COMMENT ON FUNCTION public.complete_responsible_part(uuid, text) IS
  'Legacy 2-argument backward-compatible wrapper resolving current cycle automatically.';

REVOKE ALL ON FUNCTION public.complete_responsible_part(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_responsible_part(uuid, text) TO authenticated;


-- 4.4 Backward-compatible Legacy 3-argument reject_process_task wrapper (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.reject_process_task(
  p_task_id      uuid,
  p_reason       text,
  p_new_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_cycle integer;
BEGIN
  SELECT current_cycle_number INTO v_cycle FROM public.tasks WHERE id = p_task_id;
  IF v_cycle IS NULL THEN
    v_cycle := 1;
  END IF;

  RETURN private.reject_process_task_internal(
    p_task_id             => p_task_id,
    p_cycle_number        => v_cycle,
    p_rejection_reason    => p_reason,
    p_rework_instructions => NULL,
    p_new_due_date        => p_new_due_date
  );
END;
$$;

COMMENT ON FUNCTION public.reject_process_task(uuid, text, date) IS
  'Legacy 3-argument backward-compatible wrapper resolving current cycle automatically.';

REVOKE ALL ON FUNCTION public.reject_process_task(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_process_task(uuid, text, date) TO authenticated;
