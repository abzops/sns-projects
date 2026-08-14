-- SNS Projects — DP-1-D: Runtime Provenance, Workflow State & Bypass Protection
-- Integrates Defined Process Engine into live task_lists & tasks execution tables.
-- Preserves all custom task behaviors while enforcing structural provenance and mutation protection.

-- ============================================================================
-- 1. ALTER TABLE: public.task_lists
-- ============================================================================

-- 1.1 Add runtime provenance & lifecycle columns
ALTER TABLE public.task_lists
  ADD COLUMN IF NOT EXISTS task_list_type text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS defined_process_id uuid NULL,
  ADD COLUMN IF NOT EXISTS defined_process_version_id uuid NULL,
  ADD COLUMN IF NOT EXISTS process_state text NULL,
  ADD COLUMN IF NOT EXISTS started_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text NULL;

-- 1.2 Type and state domain constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_lists_task_list_type') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT chk_task_lists_task_list_type CHECK (task_list_type IN ('custom', 'defined'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_lists_process_state') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT chk_task_lists_process_state CHECK (
        process_state IS NULL OR process_state IN ('active', 'completed', 'cancelled')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_lists_process_version') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT fk_task_lists_process_version
        FOREIGN KEY (defined_process_version_id, defined_process_id)
        REFERENCES public.defined_process_versions(id, defined_process_id)
        ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_task_lists_id_version') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT uq_task_lists_id_version UNIQUE (id, defined_process_version_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_lists_provenance_coherence') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT chk_task_lists_provenance_coherence CHECK (
        (
          task_list_type = 'custom'
          AND defined_process_id IS NULL
          AND defined_process_version_id IS NULL
          AND process_state IS NULL
          AND started_by IS NULL
          AND started_at IS NULL
          AND completed_at IS NULL
          AND cancelled_by IS NULL
          AND cancelled_at IS NULL
          AND cancellation_reason IS NULL
        )
        OR
        (
          task_list_type = 'defined'
          AND defined_process_id IS NOT NULL
          AND defined_process_version_id IS NOT NULL
          AND process_state IN ('active', 'completed', 'cancelled')
          AND started_by IS NOT NULL
          AND started_at IS NOT NULL
          AND (
            (
              process_state = 'active'
              AND completed_at IS NULL
              AND cancelled_by IS NULL
              AND cancelled_at IS NULL
              AND cancellation_reason IS NULL
            )
            OR
            (
              process_state = 'completed'
              AND completed_at IS NOT NULL
              AND cancelled_by IS NULL
              AND cancelled_at IS NULL
              AND cancellation_reason IS NULL
            )
            OR
            (
              process_state = 'cancelled'
              AND completed_at IS NULL
              AND cancelled_by IS NOT NULL
              AND cancelled_at IS NOT NULL
              AND cancellation_reason IS NOT NULL
              AND btrim(cancellation_reason) <> ''
            )
          )
        )
      );
  END IF;
END $$;

-- 1.6 Runtime & FK indexes on task_lists
CREATE INDEX IF NOT EXISTS idx_task_lists_defined_process
  ON public.task_lists (defined_process_id, defined_process_version_id)
  WHERE task_list_type = 'defined';

CREATE INDEX IF NOT EXISTS idx_task_lists_project_process_state
  ON public.task_lists (project_id, process_state)
  WHERE task_list_type = 'defined';

CREATE INDEX IF NOT EXISTS idx_task_lists_started_by
  ON public.task_lists (started_by)
  WHERE started_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_lists_cancelled_by
  ON public.task_lists (cancelled_by)
  WHERE cancelled_by IS NOT NULL;


-- ============================================================================
-- 2. ALTER TABLE: public.tasks
-- ============================================================================

-- 2.1 Add runtime step & workflow state columns
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS defined_process_version_id uuid NULL,
  ADD COLUMN IF NOT EXISTS process_step_id uuid NULL,
  ADD COLUMN IF NOT EXISTS workflow_state text NULL,
  ADD COLUMN IF NOT EXISTS current_cycle_number integer NULL,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS workflow_completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS overdue_cycle_notified boolean NULL;

-- 2.2 Constraints on tasks
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_workflow_state') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_workflow_state CHECK (
        workflow_state IS NULL OR workflow_state IN (
          'waiting', 'ready', 'active', 'awaiting_consultation',
          'awaiting_approval', 'rework_required', 'completed', 'cancelled'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_step_version') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_step_version
        FOREIGN KEY (process_step_id, defined_process_version_id)
        REFERENCES public.defined_process_steps(id, version_id)
        ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_task_list_version') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_task_list_version
        FOREIGN KEY (task_list_id, defined_process_version_id)
        REFERENCES public.task_lists(id, defined_process_version_id)
        ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_defined_provenance_coherence') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_defined_provenance_coherence CHECK (
        (
          process_step_id IS NULL
          AND defined_process_version_id IS NULL
          AND workflow_state IS NULL
          AND current_cycle_number IS NULL
          AND ready_at IS NULL
          AND activated_at IS NULL
          AND workflow_completed_at IS NULL
          AND overdue_cycle_notified IS NULL
        )
        OR
        (
          process_step_id IS NOT NULL
          AND defined_process_version_id IS NOT NULL
          AND task_list_id IS NOT NULL
          AND milestone_id IS NOT NULL
          AND workflow_state IS NOT NULL
          AND current_cycle_number IS NOT NULL
          AND current_cycle_number >= 1
          AND overdue_cycle_notified IS NOT NULL
          AND assignee_id IS NULL
        )
      );
  END IF;
END $$;

-- 2.5 Unique partial index: 1 runtime task per step in a task list
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_task_list_process_step
  ON public.tasks (task_list_id, process_step_id)
  WHERE process_step_id IS NOT NULL;

-- 2.7 Runtime & FK indexes on tasks
CREATE INDEX IF NOT EXISTS idx_tasks_task_list_workflow_state
  ON public.tasks (task_list_id, workflow_state)
  WHERE process_step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_process_step_version
  ON public.tasks (process_step_id, defined_process_version_id)
  WHERE process_step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_task_list_version
  ON public.tasks (task_list_id, defined_process_version_id)
  WHERE defined_process_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_overdue_scan
  ON public.tasks (due_date, workflow_state)
  WHERE process_step_id IS NOT NULL AND due_date IS NOT NULL;


-- ============================================================================
-- 3. MUTATION GUARD TRIGGERS (SECURITY INVOKER)
-- ============================================================================

-- 3.1 Task mutation guard
CREATE OR REPLACE FUNCTION private.trg_fn_guard_defined_task_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_is_trusted boolean;
  v_parent_list_type text;
BEGIN
  -- Trusted context requires postgres current_user AND transaction-local marker
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
           OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
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

DROP TRIGGER IF EXISTS trg_tasks_guard_defined_mutation ON public.tasks;
CREATE TRIGGER trg_tasks_guard_defined_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_guard_defined_task_mutation();

-- 3.2 Task list mutation guard
CREATE OR REPLACE FUNCTION private.trg_fn_guard_defined_task_list_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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
           OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
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

DROP TRIGGER IF EXISTS trg_task_lists_guard_defined_mutation ON public.task_lists;
CREATE TRIGGER trg_task_lists_guard_defined_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.task_lists
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_guard_defined_task_list_mutation();


-- ============================================================================
-- 4. RLS POLICY HARDENING (task_lists, tasks, task_raci_assignments)
-- ============================================================================

-- 4.1 task_lists RLS: direct creation & deletion restricted to custom task lists
DROP POLICY IF EXISTS "task_lists_insert_member" ON public.task_lists;
CREATE POLICY "task_lists_insert_member"
  ON public.task_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (
    task_list_type = 'custom'
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id)
      )) IN ('owner', 'admin', 'member')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id),
        'system_admin'
      ))
    )
  );

DROP POLICY IF EXISTS "task_lists_delete_member" ON public.task_lists;
CREATE POLICY "task_lists_delete_member"
  ON public.task_lists
  FOR DELETE
  TO authenticated
  USING (
    task_list_type = 'custom'
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id)
      )) IN ('owner', 'admin', 'member')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id),
        'system_admin'
      ))
    )
  );

-- 4.2 tasks RLS: direct creation & deletion restricted to custom tasks & custom task lists
DROP POLICY IF EXISTS "tasks_insert_member" ON public.tasks;
CREATE POLICY "tasks_insert_member"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    process_step_id IS NULL
    AND defined_process_version_id IS NULL
    AND workflow_state IS NULL
    AND (
      task_list_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.task_lists tl
        WHERE tl.id = tasks.task_list_id AND tl.task_list_type = 'custom'
      )
    )
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id)
      )) IN ('owner', 'admin', 'member')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id),
        'system_admin'
      ))
    )
  );

DROP POLICY IF EXISTS "tasks_delete_member" ON public.tasks;
CREATE POLICY "tasks_delete_member"
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (
    process_step_id IS NULL
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id)
      )) IN ('owner', 'admin', 'member')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id),
        'system_admin'
      ))
    )
  );

-- 4.3 task_raci_assignments RLS: operation-specific policies for custom tasks
DROP POLICY IF EXISTS "task_raci_manage" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_insert_member" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_update_member" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_delete_member" ON public.task_raci_assignments;

CREATE POLICY "task_raci_insert_member"
  ON public.task_raci_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  );

CREATE POLICY "task_raci_update_member"
  ON public.task_raci_assignments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  );

CREATE POLICY "task_raci_delete_member"
  ON public.task_raci_assignments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  );


-- ============================================================================
-- 5. KANBAN REORDER: DEFINED TASK SAFETY (SECURITY INVOKER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reorder_kanban_tasks(
  p_task_id uuid,
  p_new_status_id uuid,
  p_source_task_ids uuid[],
  p_destination_task_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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
  SELECT id, project_id, status_id, milestone_id, task_list_id, process_step_id
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

  -- =========================================================================
  -- CASE A: SAME-COLUMN REORDER (v_old_status_id = p_new_status_id)
  -- =========================================================================
  IF v_old_status_id = p_new_status_id THEN
    v_ordered_ids := COALESCE(p_destination_task_ids, p_source_task_ids);

    IF v_ordered_ids IS NULL OR array_length(v_ordered_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Same-column reorder requires non-empty ordered task array';
    END IF;

    -- Validate moved task is in array
    IF NOT (p_task_id = ANY(v_ordered_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in reorder array', p_task_id;
    END IF;

    -- Lock and retrieve all existing tasks in this status
    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = v_old_status_id
      FOR UPDATE
    ) INTO v_db_same_ids;

    -- Validate count equality
    IF array_length(v_ordered_ids, 1) <> array_length(v_db_same_ids, 1) THEN
      RAISE EXCEPTION 'Submitted task list count (%) does not match database count (%) for status %',
        array_length(v_ordered_ids, 1), array_length(v_db_same_ids, 1), v_old_status_id;
    END IF;

    -- Validate set equality (every submitted id must belong to the same project & status)
    SELECT count(*)
    INTO v_diff_count
    FROM unnest(v_ordered_ids) AS tid
    WHERE NOT (tid = ANY(v_db_same_ids));

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'One or more task IDs in reorder array do not belong to status % in project %',
        v_old_status_id, v_project_id;
    END IF;

    -- Atomically assign positions 1000, 2000, 3000...
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

  -- =========================================================================
  -- CASE B: CROSS-COLUMN REORDER (v_old_status_id <> p_new_status_id)
  -- =========================================================================
  ELSE
    -- Defined Process tasks cannot be cross-status moved via Kanban DnD
    IF v_task.process_step_id IS NOT NULL THEN
      RAISE EXCEPTION 'Defined Process task status is controlled by the process workflow.';
    END IF;

    IF p_destination_task_ids IS NULL OR array_length(p_destination_task_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Cross-column move requires non-empty destination task array containing moved task';
    END IF;

    -- Moved task MUST NOT appear in final source array
    IF p_source_task_ids IS NOT NULL AND p_task_id = ANY(p_source_task_ids) THEN
      RAISE EXCEPTION 'Moved task % must not be present in final source task array', p_task_id;
    END IF;

    -- Moved task MUST appear in final destination array
    IF NOT (p_task_id = ANY(p_destination_task_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in destination task array', p_task_id;
    END IF;

    -- Lock and retrieve current source tasks in DB
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

    -- Lock and retrieve current destination tasks in DB
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
        RAISE EXCEPTION 'Destination array contains foreign task IDs not belonging to destination status % in project %',
          p_new_status_id, v_project_id;
      END IF;
    END IF;

    -- 1. Renumber remaining source tasks
    IF v_source_len > 0 THEN
      FOR v_index IN 1..v_source_len LOOP
        v_target_id := p_source_task_ids[v_index];
        UPDATE public.tasks
        SET position = v_index * 1000,
            updated_at = now()
        WHERE id = v_target_id;
      END LOOP;
    END IF;

    -- 2. Update status and renumber destination tasks
    FOR v_index IN 1..array_length(p_destination_task_ids, 1) LOOP
      v_target_id := p_destination_task_ids[v_index];
      IF v_target_id = p_task_id THEN
        UPDATE public.tasks
        SET status_id = p_new_status_id,
            position = v_index * 1000,
            updated_at = now()
        WHERE id = v_target_id;
      ELSE
        UPDATE public.tasks
        SET position = v_index * 1000,
            updated_at = now()
        WHERE id = v_target_id;
      END IF;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'source_status_id', v_old_status_id,
      'destination_status_id', p_new_status_id,
      'project_id', v_project_id,
      'same_column', false,
      'source_count', v_source_len,
      'destination_count', array_length(p_destination_task_ids, 1)
    );
  END IF;
END;
$$;


-- ============================================================================
-- 6. STATUS NOTIFICATION TRIGGER: DEFINED TASK SUPPRESSION
-- ============================================================================

CREATE OR REPLACE FUNCTION private.trg_fn_task_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id    uuid;
  v_project_name    text;
  v_milestone_name  text;
  v_task_list_name  text;
  v_status_name     text;
  v_hierarchy_path  text;
  v_title           text;
  v_message         text;
  v_recipient       RECORD;
  v_actor_id        uuid;
BEGIN
  -- Check if status actually changed
  IF OLD.status_id IS NOT DISTINCT FROM NEW.status_id THEN
    RETURN NEW;
  END IF;

  -- Suppress generic task status notifications for Defined Process tasks
  IF NEW.process_step_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get status name
  SELECT name INTO v_status_name FROM public.task_statuses WHERE id = NEW.status_id;

  -- Resolve project and hierarchy
  SELECT 
    p.workspace_id,
    p.name,
    m.name,
    tl.name
  INTO 
    v_workspace_id,
    v_project_name,
    v_milestone_name,
    v_task_list_name
  FROM public.projects p
  LEFT JOIN public.milestones m ON m.id = NEW.milestone_id
  LEFT JOIN public.task_lists tl ON tl.id = NEW.task_list_id
  WHERE p.id = NEW.project_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_milestone_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_milestone_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  v_title   := 'Task status updated: ' || COALESCE(v_status_name, 'Updated');
  v_message := '"' || NEW.title || '" moved to ' || COALESCE(v_status_name, 'new status') || ' in ' || v_hierarchy_path;

  -- Optional actor exclusion
  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  -- Notify all distinct Responsible (R), Accountable (A), and Informed (I) users
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      -- Direct user RACI assignments
      SELECT ra.user_id AS u_id
      FROM public.task_raci_assignments ra
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'A', 'I')
        AND ra.user_id IS NOT NULL

      UNION

      -- Department RACI assignments (active members)
      SELECT dm.user_id AS u_id
      FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'I')
        AND ra.department_id IS NOT NULL
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true

      UNION

      -- Primary task assignee if set
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
