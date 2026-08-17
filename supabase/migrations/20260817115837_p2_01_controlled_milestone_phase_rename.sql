-- ============================================================================
-- SNS PROJECTS — PACKAGE 2 / P2-01
-- Migration: 20260817115837_p2_01_controlled_milestone_phase_rename.sql
-- Description: Controlled physical architectural transition from Milestone to Phase:
--              1. Drops compatibility objects (phases view, dual sync triggers/function).
--              2. Drops composite and single foreign keys on milestone_id.
--              3. Drops milestone_id columns on task_lists and tasks.
--              4. Renames table public.milestones to public.phases and updates PK/FK/unique names.
--              5. Rebuilds composite unique constraints and RESTRICT foreign keys on phase_id.
--              6. Rebuilds hierarchy & provenance check constraints (zero milestone_id references).
--              7. Renames RLS policies preserving exact security semantics.
--              8. Explicitly manages table privileges (authenticated/service_role only).
--              9. Refactors internal engines and public start_defined_process RPC to p_phase_id.
-- ============================================================================

-- ── 1. Drop Synchronization Triggers & Functions ─────────────────────────────

DROP TRIGGER IF EXISTS trg_task_lists_sync_milestone_phase ON public.task_lists;
DROP TRIGGER IF EXISTS trg_tasks_sync_milestone_phase ON public.tasks;

ALTER TABLE public.task_lists DROP CONSTRAINT IF EXISTS chk_task_lists_phase_milestone_sync;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS chk_tasks_phase_milestone_sync;

DROP FUNCTION IF EXISTS public.sync_milestone_phase_id();

-- ── 2. Drop Compatibility View ───────────────────────────────────────────────

DROP VIEW IF EXISTS public.phases;

-- ── 3. Drop Foreign Keys & Constraints on milestone_id ───────────────────────

-- Foreign keys on task_lists
ALTER TABLE public.task_lists DROP CONSTRAINT IF EXISTS fk_task_lists_milestone;
ALTER TABLE public.task_lists DROP CONSTRAINT IF EXISTS task_lists_milestone_id_fkey;
ALTER TABLE public.task_lists DROP CONSTRAINT IF EXISTS task_lists_phase_id_fkey;

-- Foreign keys on tasks
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_tasks_milestone;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_tasks_task_list;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_milestone_id_fkey;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_phase_id_fkey;

-- Foreign keys on process_instances
ALTER TABLE public.process_instances DROP CONSTRAINT IF EXISTS process_instances_phase_id_fkey;

-- Unique constraint & indexes on task_lists
ALTER TABLE public.task_lists DROP CONSTRAINT IF EXISTS task_lists_id_milestone_project_unique;
DROP INDEX IF EXISTS public.idx_task_lists_milestone_pos;
DROP INDEX IF EXISTS public.idx_task_lists_milestone_proj;
DROP INDEX IF EXISTS public.idx_task_lists_milestone;

-- Indexes on tasks
DROP INDEX IF EXISTS public.idx_tasks_milestone;
DROP INDEX IF EXISTS public.idx_tasks_milestone_proj;
DROP INDEX IF EXISTS public.idx_tasks_hierarchy_covering;

-- ── 4. Drop milestone_id Columns ─────────────────────────────────────────────

ALTER TABLE public.task_lists DROP COLUMN IF EXISTS milestone_id;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS milestone_id;

-- ── 5. Rename Table public.milestones -> public.phases ───────────────────────

ALTER TABLE public.milestones RENAME TO phases;

-- Rename primary key and project unique constraint on phases
ALTER TABLE public.phases RENAME CONSTRAINT milestones_pkey TO phases_pkey;
ALTER TABLE public.phases RENAME CONSTRAINT milestones_id_project_unique TO phases_id_project_unique;

-- Rename foreign keys on phases
ALTER TABLE public.phases RENAME CONSTRAINT milestones_project_id_fkey TO phases_project_id_fkey;
ALTER TABLE public.phases RENAME CONSTRAINT milestones_created_by_fkey TO phases_created_by_fkey;
ALTER TABLE public.phases RENAME CONSTRAINT milestones_owner_id_fkey TO phases_owner_id_fkey;

-- Rename indexes on phases
ALTER INDEX IF EXISTS public.idx_milestones_project_pos RENAME TO idx_phases_project_pos;
ALTER INDEX IF EXISTS public.idx_milestones_owner_id RENAME TO idx_phases_owner_id;

-- ── 6. Rebuild Composite Unique Constraints & Foreign Keys on phase_id ───────

-- Composite uniqueness on task_lists
ALTER TABLE public.task_lists
  ADD CONSTRAINT task_lists_id_phase_project_unique UNIQUE (id, phase_id, project_id);

-- Composite FK: task_lists -> phases (RESTRICT)
ALTER TABLE public.task_lists
  ADD CONSTRAINT fk_task_lists_phase
  FOREIGN KEY (phase_id, project_id)
  REFERENCES public.phases(id, project_id)
  ON DELETE RESTRICT;

-- Composite FK: tasks -> phases (RESTRICT)
ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_phase
  FOREIGN KEY (phase_id, project_id)
  REFERENCES public.phases(id, project_id)
  ON DELETE RESTRICT;

-- Composite FK: tasks -> task_lists (RESTRICT)
ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_task_list
  FOREIGN KEY (task_list_id, phase_id, project_id)
  REFERENCES public.task_lists(id, phase_id, project_id)
  ON DELETE RESTRICT;

-- FK: process_instances -> phases (SET NULL)
ALTER TABLE public.process_instances
  ADD CONSTRAINT process_instances_phase_id_fkey
  FOREIGN KEY (phase_id)
  REFERENCES public.phases(id)
  ON DELETE SET NULL;

-- ── 7. Rebuild Indexes on phase_id ───────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_task_lists_phase_pos
  ON public.task_lists (phase_id, "position");

CREATE INDEX IF NOT EXISTS idx_task_lists_phase_proj
  ON public.task_lists (phase_id, project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_phase_proj
  ON public.tasks (phase_id, project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_hierarchy_covering
  ON public.tasks (task_list_id, phase_id, project_id);

-- ── 8. Rebuild Hierarchy & Provenance Check Constraints ───────────────────────

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_hierarchy_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_hierarchy_check CHECK (
  -- Standalone Task (null project, null phase, null task_list)
  (project_id IS NULL AND phase_id IS NULL AND task_list_id IS NULL)
  OR
  -- Process Instance step task under phase directly (no task_list)
  (process_instance_id IS NOT NULL AND phase_id IS NOT NULL AND task_list_id IS NULL)
  OR
  -- Project-level / Phase-level Task bound to task_list
  (project_id IS NOT NULL AND task_list_id IS NOT NULL)
  OR
  -- Project-level custom task without task list
  (project_id IS NOT NULL AND task_list_id IS NULL)
);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS chk_tasks_defined_provenance_coherence;
ALTER TABLE public.tasks ADD CONSTRAINT chk_tasks_defined_provenance_coherence CHECK (
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
    AND phase_id IS NOT NULL
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

-- ── 9. Rename RLS Policies on public.phases ──────────────────────────────────

ALTER POLICY "milestones_select_member" ON public.phases RENAME TO "phases_select_member";
ALTER POLICY "milestones_insert_member" ON public.phases RENAME TO "phases_insert_member";
ALTER POLICY "milestones_update_member" ON public.phases RENAME TO "phases_update_member";
ALTER POLICY "milestones_delete_member" ON public.phases RENAME TO "phases_delete_member";

-- ── 10. Table Privileges & Grants ────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.phases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phases TO service_role;
REVOKE ALL ON public.phases FROM anon, PUBLIC;

-- ── 11. Refactor Live Stored Functions ────────────────────────────────────────

-- 11.1 Start Process Instance Internal Engine
CREATE OR REPLACE FUNCTION private.start_process_instance_internal(
  p_version_id uuid,
  p_instance_name text,
  p_start_request_id uuid,
  p_overall_due_date date DEFAULT NULL::date,
  p_placement_type text DEFAULT 'standalone'::text,
  p_project_id uuid DEFAULT NULL::uuid,
  p_phase_id uuid DEFAULT NULL::uuid,
  p_task_list_id uuid DEFAULT NULL::uuid,
  p_parent_task_id uuid DEFAULT NULL::uuid
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
    IF NOT EXISTS (SELECT 1 FROM public.phases ph WHERE ph.id = p_phase_id AND ph.project_id = p_project_id) THEN
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
    IF NOT EXISTS (SELECT 1 FROM public.phases ph WHERE ph.id = p_phase_id AND ph.project_id = p_project_id) THEN
      RAISE EXCEPTION 'Phase does not belong to the target project.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.task_lists tl
      WHERE tl.id = p_task_list_id
        AND tl.project_id = p_project_id
        AND tl.phase_id = p_phase_id
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
    v_phase_id := v_parent_task.phase_id;
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

  -- 7. Idempotency Check & Deterministic Replay
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
    v_caller_id,
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

-- 11.2 Defined Task List Mutation Guard
CREATE OR REPLACE FUNCTION private.trg_fn_guard_defined_task_list_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_is_trusted boolean;
BEGIN
  v_is_trusted := (
    current_user = 'postgres'
    AND current_setting('sns.process_engine_write', true) = 'on'
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_trusted THEN
      IF NEW.task_list_type = 'defined' THEN
        RAISE EXCEPTION 'Defined Process task lists cannot be created directly.';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.task_list_type = 'defined' THEN
      IF NOT v_is_trusted THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
           OR NEW.task_list_type IS DISTINCT FROM OLD.task_list_type
           OR NEW.defined_process_id IS DISTINCT FROM OLD.defined_process_id
           OR NEW.defined_process_version_id IS DISTINCT FROM OLD.defined_process_version_id
           OR NEW.process_state IS DISTINCT FROM OLD.process_state
           OR NEW.started_by IS DISTINCT FROM OLD.started_by
           OR NEW.started_at IS DISTINCT FROM OLD.started_at
           OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
           OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
           OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
           OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'Direct modification of Defined Process task list lifecycle fields is prohibited.';
        END IF;
      END IF;
    ELSE
      -- Custom task list
      IF NOT v_is_trusted THEN
        IF NEW.task_list_type = 'defined' THEN
          RAISE EXCEPTION 'Cannot convert a custom task list into a Defined Process task list directly.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.task_list_type = 'defined' THEN
      IF NOT v_is_trusted THEN
        RAISE EXCEPTION 'Defined Process task lists cannot be deleted directly.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- 11.3 Defined Task Mutation Guard
CREATE OR REPLACE FUNCTION private.trg_fn_guard_defined_task_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_is_trusted boolean;
  v_parent_list_type text;
BEGIN
  v_is_trusted := (
    current_user = 'postgres'
    AND current_setting('sns.process_engine_write', true) = 'on'
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_trusted THEN
      IF NEW.process_step_id IS NOT NULL OR NEW.defined_process_version_id IS NOT NULL OR NEW.workflow_state IS NOT NULL THEN
        RAISE EXCEPTION 'Defined Process tasks cannot be created directly.';
      END IF;

      IF NEW.task_list_id IS NOT NULL THEN
        SELECT tl.task_list_type INTO v_parent_list_type
        FROM public.task_lists tl
        WHERE tl.id = NEW.task_list_id;

        IF v_parent_list_type = 'defined' THEN
          RAISE EXCEPTION 'Cannot insert custom tasks into a Defined Process task list.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.process_step_id IS NOT NULL THEN
      IF NOT v_is_trusted THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.status_id IS DISTINCT FROM OLD.status_id
           OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
           OR NEW.due_date IS DISTINCT FROM OLD.due_date
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
           OR NEW.task_list_id IS DISTINCT FROM OLD.task_list_id
           OR NEW.defined_process_version_id IS DISTINCT FROM OLD.defined_process_version_id
           OR NEW.process_step_id IS DISTINCT FROM OLD.process_step_id
           OR NEW.workflow_state IS DISTINCT FROM OLD.workflow_state
           OR NEW.current_cycle_number IS DISTINCT FROM OLD.current_cycle_number
           OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
           OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
           OR NEW.workflow_completed_at IS DISTINCT FROM OLD.workflow_completed_at
           OR NEW.overdue_cycle_notified IS DISTINCT FROM OLD.overdue_cycle_notified THEN
          RAISE EXCEPTION 'Direct modification of Defined Process task workflow fields is prohibited.';
        END IF;
      END IF;
    ELSE
      -- Custom task
      IF NOT v_is_trusted THEN
        IF NEW.process_step_id IS NOT NULL OR NEW.defined_process_version_id IS NOT NULL OR NEW.workflow_state IS NOT NULL THEN
          RAISE EXCEPTION 'Cannot convert a custom task into a Defined Process task directly.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.process_step_id IS NOT NULL THEN
      IF NOT v_is_trusted THEN
        RAISE EXCEPTION 'Defined Process tasks cannot be deleted directly.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- 11.4 RACI Assigned Trigger Function
CREATE OR REPLACE FUNCTION private.trg_fn_raci_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task_title      text;
  v_project_id      uuid;
  v_workspace_id    uuid;
  v_project_name    text;
  v_phase_name      text;
  v_task_list_name  text;
  v_hierarchy_path  text;
  v_title           text;
  v_type            text;
  v_message         text;
  v_dept_member     RECORD;
BEGIN
  SELECT 
    t.title,
    t.project_id,
    p.workspace_id,
    p.name,
    ph.name,
    tl.name
  INTO 
    v_task_title,
    v_project_id,
    v_workspace_id,
    v_project_name,
    v_phase_name,
    v_task_list_name
  FROM public.tasks t
  JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.phases ph ON ph.id = t.phase_id
  LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
  WHERE t.id = NEW.task_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_phase_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_phase_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  IF NEW.raci_role = 'R' THEN
    v_title := 'Task assigned to you';
    v_type  := 'task_assigned';
  ELSIF NEW.raci_role = 'A' THEN
    v_title := 'You are accountable for a task';
    v_type  := 'task_accountable';
  ELSIF NEW.raci_role = 'C' THEN
    v_title := 'Your input is requested';
    v_type  := 'task_consulted';
  ELSIF NEW.raci_role = 'I' THEN
    v_title := 'You are following a task';
    v_type  := 'task_informed';
  ELSE
    v_title := 'Task updated';
    v_type  := 'task_raci_update';
  END IF;

  v_message := '"' || v_task_title || '" in ' || v_hierarchy_path;

  IF NEW.user_id IS NOT NULL THEN
    PERFORM private.emit_notification(
      v_workspace_id,
      NEW.user_id,
      v_type,
      v_title,
      v_message,
      'task',
      NEW.task_id,
      v_project_id,
      NEW.task_id
    );
  END IF;

  IF NEW.department_id IS NOT NULL THEN
    FOR v_dept_member IN
      SELECT dm.user_id
      FROM public.department_memberships dm
      WHERE dm.department_id = NEW.department_id
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_dept_member.user_id,
        v_type,
        v_title,
        v_message || ' (via Department assignment)',
        'task',
        NEW.task_id,
        v_project_id,
        NEW.task_id
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- 11.5 Subtask Assigned Trigger Function
CREATE OR REPLACE FUNCTION private.trg_fn_subtask_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_task_title text;
  v_project_id        uuid;
  v_workspace_id      uuid;
  v_project_name      text;
  v_phase_name        text;
  v_task_list_name    text;
  v_hierarchy_path    text;
  v_title             text;
  v_message           text;
  v_actor_id          uuid;
BEGIN
  IF NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN
    RETURN NEW;
  END IF;

  SELECT 
    t.title,
    t.project_id,
    p.workspace_id,
    p.name,
    ph.name,
    tl.name
  INTO 
    v_parent_task_title,
    v_project_id,
    v_workspace_id,
    v_project_name,
    v_phase_name,
    v_task_list_name
  FROM public.tasks t
  JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.phases ph ON ph.id = t.phase_id
  LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
  WHERE t.id = NEW.task_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_phase_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_phase_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  v_title   := 'Subtask assigned to you';
  v_message := '"' || NEW.title || '" under task "' || v_parent_task_title || '" in ' || v_hierarchy_path;

  PERFORM private.emit_notification(
    v_workspace_id,
    NEW.assignee_id,
    'subtask_assigned',
    v_title,
    v_message,
    'subtask',
    NEW.id,
    v_project_id,
    NEW.task_id
  );

  RETURN NEW;
END;
$$;

-- 11.6 Task Status Changed Trigger Function
CREATE OR REPLACE FUNCTION private.trg_fn_task_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id    uuid;
  v_project_name    text;
  v_phase_name      text;
  v_task_list_name  text;
  v_status_name     text;
  v_hierarchy_path  text;
  v_title           text;
  v_message         text;
  v_recipient       RECORD;
  v_actor_id        uuid;
BEGIN
  IF OLD.status_id IS NOT DISTINCT FROM NEW.status_id THEN
    RETURN NEW;
  END IF;

  IF NEW.process_step_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_status_name FROM public.task_statuses WHERE id = NEW.status_id;

  SELECT 
    p.workspace_id,
    p.name,
    ph.name,
    tl.name
  INTO 
    v_workspace_id,
    v_project_name,
    v_phase_name,
    v_task_list_name
  FROM public.projects p
  LEFT JOIN public.phases ph ON ph.id = NEW.phase_id
  LEFT JOIN public.task_lists tl ON tl.id = NEW.task_list_id
  WHERE p.id = NEW.project_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_phase_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_phase_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  v_title   := 'Task status updated: ' || COALESCE(v_status_name, 'Updated');
  v_message := '"' || NEW.title || '" moved to ' || COALESCE(v_status_name, 'new status') || ' in ' || v_hierarchy_path;

  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id
      FROM public.task_raci_assignments ra
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'A', 'I')
        AND ra.user_id IS NOT NULL

      UNION

      SELECT dm.user_id AS u_id
      FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'I')
        AND ra.department_id IS NOT NULL
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true

      UNION

      SELECT NEW.assignee_id AS u_id
      WHERE NEW.assignee_id IS NOT NULL
    ) sub
    WHERE u_id IS NOT NULL
      AND (v_actor_id IS NULL OR u_id <> v_actor_id)
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'task_status_changed',
      v_title,
      v_message,
      'task',
      NEW.id,
      NEW.project_id,
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- 11.7 Reorder Kanban Tasks RPC
CREATE OR REPLACE FUNCTION public.reorder_kanban_tasks(
  p_task_id uuid,
  p_new_status_id uuid,
  p_source_task_ids uuid[],
  p_destination_task_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_task RECORD;
  v_dest_status RECORD;
  v_project_id uuid;
  v_old_status_id uuid;
  v_ordered_ids uuid[];
  v_db_source_ids uuid[];
  v_db_dest_ids uuid[];
  v_db_same_ids uuid[];
  v_diff_count integer;
  v_index integer;
  v_target_id uuid;
  v_source_len integer;
  v_dest_len integer;
BEGIN
  -- 1. Validate the moved task exists and retrieve project_id, status_id & process_step_id (under RLS)
  SELECT id, project_id, status_id, phase_id, task_list_id, process_step_id
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found or caller lacks permission', p_task_id;
  END IF;

  v_project_id := v_task.project_id;
  v_old_status_id := v_task.status_id;

  -- 2. Validate destination status exists and belongs to the same project
  SELECT id, project_id, name, system_code
  INTO v_dest_status
  FROM public.task_statuses
  WHERE id = p_new_status_id AND project_id = v_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target status % not found in project %', p_new_status_id, v_project_id;
  END IF;

  -- 3. Check for duplicates in source array
  IF p_source_task_ids IS NOT NULL AND array_length(p_source_task_ids, 1) > 0 THEN
    SELECT count(*) - count(DISTINCT tid)
    INTO v_diff_count
    FROM unnest(p_source_task_ids) AS tid;

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'Duplicate task ID found in source task array';
    END IF;
  END IF;

  -- 4. Check for duplicates in destination array
  IF p_destination_task_ids IS NOT NULL AND array_length(p_destination_task_ids, 1) > 0 THEN
    SELECT count(*) - count(DISTINCT tid)
    INTO v_diff_count
    FROM unnest(p_destination_task_ids) AS tid;

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'Duplicate task ID found in destination task array';
    END IF;
  END IF;

  -- CASE A: SAME-COLUMN REORDER
  IF v_old_status_id = p_new_status_id THEN
    v_ordered_ids := COALESCE(p_destination_task_ids, p_source_task_ids);

    IF v_ordered_ids IS NULL OR array_length(v_ordered_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Same-column reorder requires non-empty ordered task array';
    END IF;

    IF NOT (p_task_id = ANY(v_ordered_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in reorder array', p_task_id;
    END IF;

    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = v_old_status_id
      FOR UPDATE
    ) INTO v_db_same_ids;

    IF array_length(v_ordered_ids, 1) <> array_length(v_db_same_ids, 1) THEN
      RAISE EXCEPTION 'Submitted task list count (%) does not match database count (%) for status %',
        array_length(v_ordered_ids, 1), array_length(v_db_same_ids, 1), v_old_status_id;
    END IF;

    SELECT count(*)
    INTO v_diff_count
    FROM unnest(v_ordered_ids) AS tid
    WHERE NOT (tid = ANY(v_db_same_ids));

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'One or more task IDs in reorder array do not belong to status % in project %',
        v_old_status_id, v_project_id;
    END IF;

    FOR v_index IN 1..array_length(v_ordered_ids, 1) LOOP
      v_target_id := v_ordered_ids[v_index];
      UPDATE public.tasks
      SET position = v_index * 1000,
          updated_at = now()
      WHERE id = v_target_id;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'source_status_id', v_old_status_id,
      'destination_status_id', p_new_status_id,
      'project_id', v_project_id,
      'same_column', true,
      'reordered_count', array_length(v_ordered_ids, 1)
    );

  -- CASE B: CROSS-COLUMN REORDER
  ELSE
    IF v_task.process_step_id IS NOT NULL THEN
      RAISE EXCEPTION 'Defined Process task status is controlled by the process workflow.';
    END IF;

    IF p_destination_task_ids IS NULL OR array_length(p_destination_task_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Cross-column move requires non-empty destination task array containing moved task';
    END IF;

    IF p_source_task_ids IS NOT NULL AND p_task_id = ANY(p_source_task_ids) THEN
      RAISE EXCEPTION 'Moved task % must not be present in final source task array', p_task_id;
    END IF;

    IF NOT (p_task_id = ANY(p_destination_task_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in destination task array', p_task_id;
    END IF;

    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = v_old_status_id
      FOR UPDATE
    ) INTO v_db_source_ids;

    v_source_len := COALESCE(array_length(p_source_task_ids, 1), 0);

    IF v_source_len <> (array_length(v_db_source_ids, 1) - 1) THEN
      RAISE EXCEPTION 'Source task count mismatch: expected %, got %',
        (array_length(v_db_source_ids, 1) - 1), v_source_len;
    END IF;

    IF v_source_len > 0 THEN
      SELECT count(*)
      INTO v_diff_count
      FROM unnest(p_source_task_ids) AS tid
      WHERE NOT (tid = ANY(v_db_source_ids));

      IF v_diff_count > 0 THEN
        RAISE EXCEPTION 'Source array contains task IDs not belonging to source status % in project %',
          v_old_status_id, v_project_id;
      END IF;
    END IF;

    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = p_new_status_id
      FOR UPDATE
    ) INTO v_db_dest_ids;

    v_dest_len := COALESCE(array_length(v_db_dest_ids, 1), 0);

    IF array_length(p_destination_task_ids, 1) <> (v_dest_len + 1) THEN
      RAISE EXCEPTION 'Destination task count mismatch: expected %, got %',
        (v_dest_len + 1), array_length(p_destination_task_ids, 1);
    END IF;

    IF v_dest_len > 0 THEN
      SELECT count(*)
      INTO v_diff_count
      FROM unnest(p_destination_task_ids) AS tid
      WHERE tid <> p_task_id AND NOT (tid = ANY(v_db_dest_ids));

      IF v_diff_count > 0 THEN
        RAISE EXCEPTION 'Destination array contains invalid task IDs for target status % in project %',
          p_new_status_id, v_project_id;
      END IF;
    END IF;

    UPDATE public.tasks
    SET status_id = p_new_status_id,
        updated_at = now()
    WHERE id = p_task_id;

    IF v_source_len > 0 THEN
      FOR v_index IN 1..v_source_len LOOP
        v_target_id := p_source_task_ids[v_index];
        UPDATE public.tasks
        SET position = v_index * 1000,
            updated_at = now()
        WHERE id = v_target_id;
      END LOOP;
    END IF;

    FOR v_index IN 1..array_length(p_destination_task_ids, 1) LOOP
      v_target_id := p_destination_task_ids[v_index];
      UPDATE public.tasks
      SET position = v_index * 1000,
          updated_at = now()
      WHERE id = v_target_id;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'source_status_id', v_old_status_id,
      'destination_status_id', p_new_status_id,
      'project_id', v_project_id,
      'same_column', false,
      'source_reordered_count', v_source_len,
      'destination_reordered_count', array_length(p_destination_task_ids, 1)
    );
  END IF;
END;
$$;

-- 11.8 Controlled Drop & Recreate for Legacy start_defined_process RPC
DROP FUNCTION IF EXISTS public.start_defined_process(uuid, uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.start_defined_process(
  p_version_id uuid,
  p_project_id uuid,
  p_phase_id uuid,
  p_instance_name text,
  p_raci_overrides jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id       uuid;
  v_version         RECORD;
  v_process         RECORD;
  v_project         RECORD;
  v_workspace_id    uuid;
  v_root_step       RECORD;
  v_step            RECORD;
  v_task_list_id    uuid;
  v_root_task_id    uuid;
  v_task_id         uuid;
  v_todo_status_id  uuid;
  v_task_count      integer := 0;
  v_raci_count      integer := 0;
  v_dep_count       integer := 0;
  v_is_root         boolean;
  v_pos             integer := 1000;
  v_recipient       RECORD;
  v_today           date;
  v_due_date        date;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Validate project & phase hierarchy
  SELECT * INTO v_project
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  v_workspace_id := v_project.workspace_id;

  IF NOT private.is_workspace_active_member(v_workspace_id) THEN
    RAISE EXCEPTION 'Caller is not an active member of this workspace.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.phases ph
    WHERE ph.id = p_phase_id AND ph.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Phase % does not belong to project %.', p_phase_id, p_project_id;
  END IF;

  -- 3. Validate version status is published
  SELECT * INTO v_version
  FROM public.defined_process_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'published' THEN
    RAISE EXCEPTION 'Process version is % (must be published).', v_version.status;
  END IF;

  -- 4. Load process container
  SELECT * INTO v_process
  FROM public.defined_processes
  WHERE id = v_version.defined_process_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process container not found.';
  END IF;

  IF v_process.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'Process workspace mismatch.';
  END IF;

  -- 5. Find the root step
  SELECT s.* INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No root step found for version %.', p_version_id;
  END IF;

  -- 6. Starter authorization check
  IF NOT private.can_start_process_version(p_version_id, v_caller_id, v_workspace_id) THEN
    RAISE EXCEPTION 'Caller % is not authorized to start process % (version %).',
      v_caller_id, v_process.code, v_version.version_number;
  END IF;

  -- 7. Validate instance name
  IF p_instance_name IS NULL OR trim(p_instance_name) = '' THEN
    RAISE EXCEPTION 'Instance name cannot be blank.';
  END IF;

  -- 8. Get default "Todo" status
  SELECT id INTO v_todo_status_id
  FROM public.task_statuses
  WHERE project_id = p_project_id AND (system_code = 'todo' OR lower(name) = 'to do')
  ORDER BY position ASC
  LIMIT 1;

  IF v_todo_status_id IS NULL THEN
    SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = p_project_id ORDER BY position ASC LIMIT 1;
  END IF;

  IF v_todo_status_id IS NULL THEN
    RAISE EXCEPTION 'No open task status found in project %.', p_project_id;
  END IF;

  -- 9. Enable write marker
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 10. Create the defined task list
  INSERT INTO public.task_lists (
    project_id,
    phase_id,
    name,
    description,
    position,
    created_by,
    task_list_type,
    defined_process_id,
    defined_process_version_id,
    process_state,
    started_by,
    started_at
  ) VALUES (
    p_project_id,
    p_phase_id,
    p_instance_name,
    'Instantiated from ' || v_process.name || ' v' || v_version.version_number,
    0,
    v_caller_id,
    'defined',
    v_process.id,
    p_version_id,
    'active',
    v_caller_id,
    now()
  ) RETURNING id INTO v_task_list_id;

  v_today := CURRENT_DATE;

  -- 11. Materialize Step Tasks
  FOR v_step IN
    SELECT s.*
    FROM public.defined_process_steps s
    WHERE s.version_id = p_version_id
    ORDER BY s.sequence_order ASC
  LOOP
    v_is_root := (v_step.id = v_root_step.id);
    v_task_count := v_task_count + 1;
    v_pos := v_pos + 1000;

    IF v_is_root AND v_step.expected_duration_days IS NOT NULL AND v_step.expected_duration_days > 0 THEN
      v_due_date := private.add_working_days(v_workspace_id, v_today, v_step.expected_duration_days);
    ELSE
      v_due_date := NULL;
    END IF;

    INSERT INTO public.tasks (
      project_id,
      phase_id,
      task_list_id,
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
      p_project_id,
      p_phase_id,
      v_task_list_id,
      v_step.title,
      v_step.description,
      v_todo_status_id,
      p_version_id,
      v_step.id,
      CASE WHEN v_is_root THEN 'ready'::text ELSE 'waiting'::text END,
      1,
      CASE WHEN v_is_root THEN now() ELSE NULL END,
      v_due_date,
      false,
      v_pos,
      v_caller_id
    ) RETURNING id INTO v_task_id;

    IF v_is_root THEN
      v_root_task_id := v_task_id;
    END IF;

    -- Copy Step RACI
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

    GET DIAGNOSTICS v_raci_count = ROW_COUNT;
  END LOOP;

  -- 12. Audit event
  INSERT INTO public.process_audit_events (
    workspace_id,
    project_id,
    task_list_id,
    task_id,
    event_type,
    actor_id,
    payload
  ) VALUES (
    v_workspace_id,
    p_project_id,
    v_task_list_id,
    v_root_task_id,
    'PROCESS_STARTED',
    v_caller_id,
    jsonb_build_object(
      'process_code', v_process.code,
      'process_name', v_process.name,
      'version_number', v_version.version_number,
      'instance_name', p_instance_name,
      'task_list_id', v_task_list_id,
      'root_task_id', v_root_task_id,
      'task_count', v_task_count
    )
  );

  -- 13. Notifications
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
      p_project_id,
      v_root_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'task_list_id', v_task_list_id,
    'root_task_id', v_root_task_id,
    'task_count', v_task_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_defined_process(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_defined_process(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role, postgres;
