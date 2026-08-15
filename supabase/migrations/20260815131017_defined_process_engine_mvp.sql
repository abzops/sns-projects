-- SNS Projects — Defined Process Engine MVP (Complete Backend Vertical Slice)
-- Implements:
-- 1. Runtime history tables (completions, consultations, evidence, approval cycles, audit events)
-- 2. Live task RACI response_required support
-- 3. Working-day due-date calculation helper
-- 4. Process publication validation RPC (publish_defined_process_version)
-- 5. Start Defined Process RPC (start_defined_process)
-- 6. Responsible completion RPC (complete_responsible_part)
-- 7. Consultation submission RPC (submit_task_consultation)
-- 8. Evidence submission RPC (submit_task_evidence)
-- 9. Accountable approval RPC (approve_process_task)
-- 10. Rejection / rework RPC (reject_process_task)
-- 11. Centralized completion helper & DAG dependency activation (complete_task_and_advance)
-- 12. Automatic process completion & workflow notifications
-- 13. Baseline working calendar seed

-- ============================================================================
-- 0. EXPAND NOTIFICATION TYPES
-- ============================================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'task_assigned',
    'task_accountable',
    'task_consulted',
    'task_informed',
    'raci_changed',
    'task_status_changed',
    'subtask_assigned',
    'project_status_changed',
    'system',
    'process_task_ready',
    'process_task_completed',
    'consultation_required',
    'approval_required',
    'task_rework_required',
    'process_completed'
  ));

-- ============================================================================
-- 1. RUNTIME HISTORY TABLES
-- ============================================================================

-- 1.1 task_responsible_completions
CREATE TABLE IF NOT EXISTS public.task_responsible_completions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number    integer NOT NULL CHECK (cycle_number >= 1),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  completion_note text NULL,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_resp_completion UNIQUE (task_id, cycle_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_resp_comp_task_cycle
  ON public.task_responsible_completions (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_resp_comp_user
  ON public.task_responsible_completions (user_id);

ALTER TABLE public.task_responsible_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_resp_comp_select_member" ON public.task_responsible_completions;
CREATE POLICY "task_resp_comp_select_member"
  ON public.task_responsible_completions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_responsible_completions.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.2 task_consultation_responses
CREATE TABLE IF NOT EXISTS public.task_consultation_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number    integer NOT NULL CHECK (cycle_number >= 1),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  response_text   text NOT NULL CHECK (btrim(response_text) <> ''),
  responded_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_consult_resp UNIQUE (task_id, cycle_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_consult_resp_task_cycle
  ON public.task_consultation_responses (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_consult_resp_user
  ON public.task_consultation_responses (user_id);

ALTER TABLE public.task_consultation_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_consult_resp_select_member" ON public.task_consultation_responses;
CREATE POLICY "task_consult_resp_select_member"
  ON public.task_consultation_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_consultation_responses.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.3 task_evidence_submissions
CREATE TABLE IF NOT EXISTS public.task_evidence_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number    integer NOT NULL CHECK (cycle_number >= 1),
  evidence_def_id uuid NULL REFERENCES public.defined_process_step_evidence_defs(id) ON DELETE RESTRICT,
  evidence_type   text NOT NULL CHECK (evidence_type IN ('text', 'link')),
  payload         jsonb NOT NULL,
  submitted_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_evidence_task_cycle
  ON public.task_evidence_submissions (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_evidence_def
  ON public.task_evidence_submissions (evidence_def_id);

CREATE INDEX IF NOT EXISTS idx_task_evidence_submitted_by
  ON public.task_evidence_submissions (submitted_by);

ALTER TABLE public.task_evidence_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_evidence_select_member" ON public.task_evidence_submissions;
CREATE POLICY "task_evidence_select_member"
  ON public.task_evidence_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_evidence_submissions.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.4 task_approval_cycles
CREATE TABLE IF NOT EXISTS public.task_approval_cycles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number     integer NOT NULL CHECK (cycle_number >= 1),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by       uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decided_at       timestamptz NULL,
  rejection_reason text NULL,
  new_due_date     date NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_approval_cycle UNIQUE (task_id, cycle_number),
  CONSTRAINT chk_task_approval_cycle_decision CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND rejection_reason IS NULL AND new_due_date IS NULL)
    OR
    (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NULL AND new_due_date IS NULL)
    OR
    (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '' AND new_due_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_task_approval_task_cycle
  ON public.task_approval_cycles (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_approval_decided_by
  ON public.task_approval_cycles (decided_by);

ALTER TABLE public.task_approval_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_approval_select_member" ON public.task_approval_cycles;
CREATE POLICY "task_approval_select_member"
  ON public.task_approval_cycles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_approval_cycles.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.5 process_audit_events
CREATE TABLE IF NOT EXISTS public.process_audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  project_id   uuid NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  task_list_id uuid NULL REFERENCES public.task_lists(id) ON DELETE RESTRICT,
  task_id      uuid NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  event_type   text NOT NULL,
  actor_id     uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_process_audit_ws_created
  ON public.process_audit_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_process_audit_project
  ON public.process_audit_events (project_id);

CREATE INDEX IF NOT EXISTS idx_process_audit_task_list
  ON public.process_audit_events (task_list_id);

CREATE INDEX IF NOT EXISTS idx_process_audit_task
  ON public.process_audit_events (task_id);

CREATE INDEX IF NOT EXISTS idx_process_audit_actor
  ON public.process_audit_events (actor_id);

ALTER TABLE public.process_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "process_audit_select_member" ON public.process_audit_events;
CREATE POLICY "process_audit_select_member"
  ON public.process_audit_events
  FOR SELECT
  TO authenticated
  USING (
    private.is_workspace_active_member(workspace_id)
  );


-- ============================================================================
-- 2. ALTER task_raci_assignments (response_required)
-- ============================================================================

ALTER TABLE public.task_raci_assignments
  ADD COLUMN IF NOT EXISTS response_required boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_raci_response_required') THEN
    ALTER TABLE public.task_raci_assignments
      ADD CONSTRAINT chk_task_raci_response_required CHECK (response_required = false OR raci_role = 'C');
  END IF;
END $$;


-- ============================================================================
-- 3. WORKING DAY CALCULATION HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION private.add_working_days(
  p_workspace_id   uuid,
  p_start_date     date,
  p_duration_days  integer
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cal RECORD;
  v_curr_date date;
  v_working_counted integer := 0;
  v_dow integer;
  v_is_working boolean;
  v_is_holiday boolean;
BEGIN
  IF p_duration_days IS NULL OR p_duration_days < 1 THEN
    RAISE EXCEPTION 'Duration must be at least 1 working day.';
  END IF;

  SELECT * INTO v_cal
  FROM public.workspace_working_calendars
  WHERE workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Working calendar is not configured for this workspace.';
  END IF;

  v_curr_date := p_start_date;

  WHILE v_working_counted < p_duration_days LOOP
    -- Extract day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    v_dow := EXTRACT(DOW FROM v_curr_date);

    v_is_working := CASE v_dow
      WHEN 0 THEN v_cal.sunday_working
      WHEN 1 THEN v_cal.monday_working
      WHEN 2 THEN v_cal.tuesday_working
      WHEN 3 THEN v_cal.wednesday_working
      WHEN 4 THEN v_cal.thursday_working
      WHEN 5 THEN v_cal.friday_working
      WHEN 6 THEN v_cal.saturday_working
      ELSE false
    END;

    IF v_is_working THEN
      SELECT EXISTS (
        SELECT 1 FROM public.workspace_holidays
        WHERE workspace_id = p_workspace_id AND holiday_date = v_curr_date
      ) INTO v_is_holiday;

      IF NOT v_is_holiday THEN
        v_working_counted := v_working_counted + 1;
        IF v_working_counted = p_duration_days THEN
          RETURN v_curr_date;
        END IF;
      END IF;
    END IF;

    v_curr_date := v_curr_date + 1;
  END LOOP;

  RETURN v_curr_date;
END;
$$;


-- ============================================================================
-- 4. PUBLISH DEFINED PROCESS VERSION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_defined_process_version(
  p_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id    uuid;
  v_version      RECORD;
  v_process      RECORD;
  v_step_count   integer;
  v_root_count   integer;
  v_root_step    RECORD;
  v_invalid_raci RECORD;
  v_step         RECORD;
  v_r_count      integer;
  v_a_count      integer;
  v_req_c_count  integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_version
  FROM public.defined_process_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft process versions can be published.';
  END IF;

  SELECT * INTO v_process
  FROM public.defined_processes
  WHERE id = v_version.defined_process_id;

  -- Verify publication authorization:
  -- Department Head of owning department OR project_admin / system_admin OR workspace owner/admin
  IF NOT (
    (SELECT private.get_user_workspace_role(v_process.workspace_id)) IN ('owner', 'admin')
    OR
    (SELECT private.has_system_role(v_process.workspace_id, 'project_admin'))
    OR
    (SELECT private.has_system_role(v_process.workspace_id, 'system_admin'))
    OR
    EXISTS (
      SELECT 1 FROM public.department_memberships dm
      WHERE dm.department_id = v_process.department_id
        AND dm.user_id = v_caller_id
        AND dm.role = 'head'
        AND dm.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Insufficient authority to publish this process version.';
  END IF;

  -- 1. Step count check (>= 1)
  SELECT count(*) INTO v_step_count
  FROM public.defined_process_steps
  WHERE version_id = p_version_id;

  IF v_step_count < 1 THEN
    RAISE EXCEPTION 'Process version must contain at least one step.';
  END IF;

  -- 2. Root step check (exactly 1 root with sequence_order = 1)
  SELECT count(*) INTO v_root_count
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF v_root_count <> 1 THEN
    RAISE EXCEPTION 'Process version must have exactly one root step (found %)', v_root_count;
  END IF;

  SELECT * INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF v_root_step.sequence_order <> 1 THEN
    RAISE EXCEPTION 'Root step must have sequence_order = 1.';
  END IF;

  -- 3. Reachability & DAG cycle check
  -- Reachable steps from root using BFS/DFS
  WITH RECURSIVE reachable AS (
    SELECT v_root_step.id AS step_id
    UNION
    SELECT d.step_id
    FROM public.defined_process_step_dependencies d
    JOIN reachable r ON r.step_id = d.depends_on_step_id
    WHERE d.version_id = p_version_id
  )
  SELECT count(DISTINCT step_id) INTO v_root_count FROM reachable;

  IF v_root_count <> v_step_count THEN
    RAISE EXCEPTION 'Every step in the process must be reachable from the root step without cycles.';
  END IF;

  -- 4. Check each step's RACI, durations, approvals, consultations
  FOR v_step IN
    SELECT * FROM public.defined_process_steps WHERE version_id = p_version_id
  LOOP
    IF v_step.expected_duration_days < 1 THEN
      RAISE EXCEPTION 'Step % (%) duration must be >= 1 working day.', v_step.step_code, v_step.title;
    END IF;

    -- Count R and A
    SELECT
      count(*) FILTER (WHERE raci_role = 'R'),
      count(*) FILTER (WHERE raci_role = 'A'),
      count(*) FILTER (WHERE raci_role = 'C' AND response_required = true)
    INTO v_r_count, v_a_count, v_req_c_count
    FROM public.defined_process_step_raci
    WHERE step_id = v_step.id;

    IF v_r_count < 1 THEN
      RAISE EXCEPTION 'Step % (%) must have at least one Responsible (R) assignment.', v_step.step_code, v_step.title;
    END IF;

    IF v_a_count <> 1 THEN
      RAISE EXCEPTION 'Step % (%) must have exactly one Accountable (A) assignment (found %).', v_step.step_code, v_step.title, v_a_count;
    END IF;

    -- approval_required => Accountable user cannot be in Responsible set
    IF v_step.approval_required THEN
      IF EXISTS (
        SELECT 1 FROM public.defined_process_step_raci r
        WHERE r.step_id = v_step.id AND r.raci_role = 'R' AND r.user_id = (
          SELECT a.user_id FROM public.defined_process_step_raci a
          WHERE a.step_id = v_step.id AND a.raci_role = 'A'
        )
      ) THEN
        RAISE EXCEPTION 'Step % requires approval, so Accountable cannot be in the Responsible set.', v_step.step_code;
      END IF;
    END IF;

    -- consultation_required => >= 1 C with response_required = true
    IF v_step.consultation_required AND v_req_c_count < 1 THEN
      RAISE EXCEPTION 'Step % requires consultation, so at least one Consulted (C) must have response_required = true.', v_step.step_code;
    END IF;
  END LOOP;

  -- 5. Validate that all RACI users are active workspace members
  SELECT r.user_id, p.full_name INTO v_invalid_raci
  FROM public.defined_process_step_raci r
  JOIN public.defined_process_steps s ON s.id = r.step_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE s.version_id = p_version_id
    AND r.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = v_process.workspace_id
        AND wm.user_id = r.user_id
        AND wm.status = 'active'
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'RACI user % is not an active workspace member.', COALESCE(v_invalid_raci.full_name, v_invalid_raci.user_id::text);
  END IF;

  -- 6. Perform atomic publication
  -- Archive previously published versions
  UPDATE public.defined_process_versions
  SET status = 'archived'
  WHERE defined_process_id = v_process.id AND status = 'published';

  -- Publish target version
  UPDATE public.defined_process_versions
  SET status = 'published',
      published_by = v_caller_id,
      published_at = now()
  WHERE id = p_version_id;

  -- Record audit event
  INSERT INTO public.process_audit_events (
    workspace_id,
    event_type,
    actor_id,
    payload
  ) VALUES (
    v_process.workspace_id,
    'PROCESS_VERSION_PUBLISHED',
    v_caller_id,
    jsonb_build_object(
      'process_id', v_process.id,
      'version_id', p_version_id,
      'version_number', v_version.version_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'version_id', p_version_id,
    'status', 'published'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_defined_process_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_defined_process_version(uuid) TO authenticated;


-- ============================================================================
-- 5. CENTRALIZED COMPLETION & DAG PROPAGATION HELPER (PRIVATE)
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
  v_task_list      RECORD;
  v_workspace_id   uuid;
  v_project        RECORD;
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

  -- Resolve project To Do status
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

  -- 2. Evaluate all downstream tasks in the process instance
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
END;
$$;


-- ============================================================================
-- 6. START DEFINED PROCESS RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_defined_process(
  p_version_id      uuid,
  p_project_id      uuid,
  p_milestone_id    uuid,
  p_instance_name   text,
  p_raci_overrides  jsonb DEFAULT NULL
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
  v_due_date        date;
  v_is_root         boolean;
  v_task_count      integer := 0;
  v_caller_is_root_r boolean := false;
  v_recipient       RECORD;
  v_raci            RECORD;
  v_pos             integer := 1000;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_instance_name IS NULL OR btrim(p_instance_name) = '' THEN
    RAISE EXCEPTION 'Process instance name is required.';
  END IF;

  -- 1. Validate version and process
  SELECT * INTO v_version FROM public.defined_process_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'published' THEN
    RAISE EXCEPTION 'Process version must be published to be started.';
  END IF;

  SELECT * INTO v_process FROM public.defined_processes WHERE id = v_version.defined_process_id;

  -- 2. Validate project & milestone hierarchy
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target project not found.';
  END IF;

  IF v_project.workspace_id <> v_process.workspace_id THEN
    RAISE EXCEPTION 'Project workspace does not match defined process workspace.';
  END IF;
  v_workspace_id := v_project.workspace_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.milestones m
    WHERE m.id = p_milestone_id AND m.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Milestone does not belong to target project.';
  END IF;

  -- 3. Check workspace calendar exists
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_working_calendars WHERE workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'Working calendar is not configured for this workspace.';
  END IF;

  -- 4. Find root step
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

  -- 5. CRITICAL START RULE: Caller MUST be in resolved Responsible (R) set for Root Step
  SELECT EXISTS (
    SELECT 1 FROM public.defined_process_step_raci r
    WHERE r.step_id = v_root_step.id AND r.raci_role = 'R' AND r.user_id = v_caller_id
  ) INTO v_caller_is_root_r;

  IF NOT v_caller_is_root_r THEN
    RAISE EXCEPTION 'Caller must be an assigned Responsible user for the root step of this process.';
  END IF;

  -- Resolve default Todo status
  SELECT id INTO v_todo_status_id
  FROM public.task_statuses
  WHERE project_id = p_project_id AND (system_code = 'todo' OR lower(name) = 'to do')
  ORDER BY position ASC LIMIT 1;

  IF v_todo_status_id IS NULL THEN
    SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = p_project_id ORDER BY position ASC LIMIT 1;
  END IF;

  -- Enable trusted bypass for creation of defined process instance
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 6. Insert live task_lists instance
  INSERT INTO public.task_lists (
    project_id,
    milestone_id,
    name,
    task_list_type,
    defined_process_id,
    defined_process_version_id,
    process_state,
    started_by,
    started_at
  ) VALUES (
    p_project_id,
    p_milestone_id,
    p_instance_name,
    'defined',
    v_process.id,
    p_version_id,
    'active',
    v_caller_id,
    now()
  ) RETURNING id INTO v_task_list_id;

  -- 7. Insert all defined tasks in this version
  FOR v_step IN
    SELECT * FROM public.defined_process_steps
    WHERE version_id = p_version_id
    ORDER BY sequence_order ASC
  LOOP
    v_is_root := (v_step.id = v_root_step.id);
    v_task_count := v_task_count + 1;
    v_pos := v_pos + 1000;

    IF v_is_root THEN
      v_due_date := private.add_working_days(v_workspace_id, CURRENT_DATE, v_step.expected_duration_days);

      INSERT INTO public.tasks (
        project_id,
        milestone_id,
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
        p_milestone_id,
        v_task_list_id,
        v_step.title,
        v_step.description,
        v_todo_status_id,
        p_version_id,
        v_step.id,
        'ready',
        1,
        now(),
        v_due_date,
        false,
        v_pos,
        v_caller_id
      ) RETURNING id INTO v_task_id;

      v_root_task_id := v_task_id;
    ELSE
      INSERT INTO public.tasks (
        project_id,
        milestone_id,
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
        p_milestone_id,
        v_task_list_id,
        v_step.title,
        v_step.description,
        v_todo_status_id,
        p_version_id,
        v_step.id,
        'waiting',
        1,
        NULL,
        NULL,
        false,
        v_pos,
        v_caller_id
      ) RETURNING id INTO v_task_id;
    END IF;

    -- Instantiate task_raci_assignments for this task from template
    FOR v_raci IN
      SELECT * FROM public.defined_process_step_raci WHERE step_id = v_step.id
    LOOP
      INSERT INTO public.task_raci_assignments (
        task_id,
        raci_role,
        user_id,
        response_required
      ) VALUES (
        v_task_id,
        v_raci.raci_role,
        v_raci.user_id,
        COALESCE(v_raci.response_required, false)
      );
    END LOOP;
  END LOOP;

  -- 8. Audit events & notifications for root task
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, p_project_id, v_task_list_id, 'PROCESS_STARTED', v_caller_id,
    jsonb_build_object('instance_name', p_instance_name, 'version_id', p_version_id, 'task_count', v_task_count)
  );

  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, p_project_id, v_task_list_id, v_root_task_id, 'TASK_READY', v_caller_id,
    jsonb_build_object('step_id', v_root_step.id, 'due_date', v_due_date)
  );

  -- Notify root task participants only
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
GRANT EXECUTE ON FUNCTION public.start_defined_process(uuid, uuid, uuid, text, jsonb) TO authenticated;


-- ============================================================================
-- 7. RESPONSIBLE COMPLETION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_responsible_part(
  p_task_id uuid,
  p_note    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id       uuid;
  v_task            RECORD;
  v_step            RECORD;
  v_task_list       RECORD;
  v_workspace_id    uuid;
  v_is_responsible  boolean := false;
  v_total_r_count   integer;
  v_done_r_count    integer;
  v_pending_subtasks integer;
  v_missing_evidence integer;
  v_pending_c_count integer;
  v_recipient       RECORD;
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

  SELECT * INTO v_step FROM public.defined_process_steps WHERE id = v_task.process_step_id;
  SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p WHERE p.id = v_task.project_id;

  -- Verify caller has R assignment
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'R'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_responsible;

  IF NOT v_is_responsible THEN
    RAISE EXCEPTION 'Caller is not an assigned Responsible user for this task.';
  END IF;

  -- Check if already completed this cycle
  IF EXISTS (
    SELECT 1 FROM public.task_responsible_completions
    WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Responsible completion already submitted for this cycle.';
  END IF;

  -- Insert completion record
  INSERT INTO public.task_responsible_completions (
    task_id, cycle_number, user_id, completion_note
  ) VALUES (
    p_task_id, v_task.current_cycle_number, v_caller_id, p_note
  );

  -- Count total assigned R users vs completed R users for this cycle
  WITH distinct_r_users AS (
    SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.user_id IS NOT NULL
    UNION
    SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
    JOIN public.department_memberships dm ON dm.department_id = ra.department_id
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.department_id IS NOT NULL AND dm.is_active = true
  )
  SELECT count(*) INTO v_total_r_count FROM distinct_r_users;

  SELECT count(DISTINCT user_id) INTO v_done_r_count
  FROM public.task_responsible_completions
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  IF v_done_r_count < v_total_r_count THEN
    -- Transition to active if was ready/rework_required
    IF v_task.workflow_state <> 'active' THEN
      PERFORM set_config('sns.process_engine_write', 'on', true);
      UPDATE public.tasks SET workflow_state = 'active', activated_at = COALESCE(activated_at, now()) WHERE id = p_task_id;
    END IF;

    RETURN jsonb_build_object(
      'completed', false,
      'workflow_state', 'active',
      'remaining_responsible', v_total_r_count - v_done_r_count
    );
  END IF;

  -- All Responsible users completed! Check subtasks & evidence
  -- Check non-cancelled subtasks
  SELECT count(*) INTO v_pending_subtasks
  FROM public.subtasks
  WHERE task_id = p_task_id AND status NOT IN ('done', 'cancelled');

  IF v_pending_subtasks > 0 THEN
    RAISE EXCEPTION 'All subtasks must be completed before completing the task (% pending).', v_pending_subtasks;
  END IF;

  -- Check required evidence definitions
  SELECT count(*) INTO v_missing_evidence
  FROM public.defined_process_step_evidence_defs ed
  WHERE ed.step_id = v_step.id AND ed.is_mandatory = true
    AND NOT EXISTS (
      SELECT 1 FROM public.task_evidence_submissions es
      WHERE es.task_id = p_task_id AND es.evidence_def_id = ed.id AND es.cycle_number = v_task.current_cycle_number
    );

  IF v_missing_evidence > 0 THEN
    RAISE EXCEPTION 'Required evidence submission missing (% definitions pending).', v_missing_evidence;
  END IF;

  -- Check Consultation requirement
  IF v_step.consultation_required THEN
    SELECT count(*) INTO v_pending_c_count
    FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true
      AND NOT EXISTS (
        SELECT 1 FROM public.task_consultation_responses cr
        WHERE cr.task_id = p_task_id AND cr.cycle_number = v_task.current_cycle_number
          AND (cr.user_id = ra.user_id OR (ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm WHERE dm.department_id = ra.department_id AND dm.user_id = cr.user_id AND dm.is_active = true
          )))
      );

    IF v_pending_c_count > 0 THEN
      PERFORM set_config('sns.process_engine_write', 'on', true);
      UPDATE public.tasks SET workflow_state = 'awaiting_consultation' WHERE id = p_task_id;

      -- Notify Consulted users
      FOR v_recipient IN
        SELECT DISTINCT u_id FROM (
          SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true AND ra.user_id IS NOT NULL
          UNION
          SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
          JOIN public.department_memberships dm ON dm.department_id = ra.department_id
          WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true AND ra.department_id IS NOT NULL AND dm.is_active = true
        ) sub WHERE u_id IS NOT NULL
      LOOP
        PERFORM private.emit_notification(
          v_workspace_id,
          v_recipient.u_id,
          'consultation_required',
          'Consultation required: ' || v_task.title,
          'Your input is required for task "' || v_task.title || '" in process "' || v_task_list.name || '".',
          'task',
          p_task_id,
          v_task.project_id,
          p_task_id
        );
      END LOOP;

      RETURN jsonb_build_object(
        'completed', false,
        'workflow_state', 'awaiting_consultation',
        'pending_consultations', v_pending_c_count
      );
    END IF;
  END IF;

  -- Check Approval requirement
  IF v_step.approval_required THEN
    PERFORM set_config('sns.process_engine_write', 'on', true);
    UPDATE public.tasks SET workflow_state = 'awaiting_approval' WHERE id = p_task_id;

    -- Create pending approval cycle
    INSERT INTO public.task_approval_cycles (
      task_id, cycle_number, status
    ) VALUES (
      p_task_id, v_task.current_cycle_number, 'pending'
    ) ON CONFLICT (task_id, cycle_number) DO NOTHING;

    -- Notify Accountable (A)
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
      'completed', false,
      'workflow_state', 'awaiting_approval'
    );
  END IF;

  -- No consultation or approval pending: complete task directly
  PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

  RETURN jsonb_build_object(
    'completed', true,
    'workflow_state', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_responsible_part(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_responsible_part(uuid, text) TO authenticated;


-- ============================================================================
-- 8. CONSULTATION SUBMISSION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_task_consultation(
  p_task_id   uuid,
  p_response  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id        uuid;
  v_task             RECORD;
  v_step             RECORD;
  v_task_list        RECORD;
  v_workspace_id     uuid;
  v_is_consulted     boolean := false;
  v_pending_c_count  integer;
  v_recipient        RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_response IS NULL OR btrim(p_response) = '' THEN
    RAISE EXCEPTION 'Response text cannot be empty.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'awaiting_consultation' THEN
    RAISE EXCEPTION 'Task is not awaiting consultation (current state: %).', v_task.workflow_state;
  END IF;

  SELECT * INTO v_step FROM public.defined_process_steps WHERE id = v_task.process_step_id;
  SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p WHERE p.id = v_task.project_id;

  -- Verify caller has C assignment
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'C'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_consulted;

  IF NOT v_is_consulted THEN
    RAISE EXCEPTION 'Caller is not an assigned Consulted user for this task.';
  END IF;

  -- Insert consultation response
  INSERT INTO public.task_consultation_responses (
    task_id, cycle_number, user_id, response_text
  ) VALUES (
    p_task_id, v_task.current_cycle_number, v_caller_id, p_response
  ) ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET response_text = EXCLUDED.response_text, responded_at = now();

  -- Check if all required C have responded
  SELECT count(*) INTO v_pending_c_count
  FROM public.task_raci_assignments ra
  WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true
    AND NOT EXISTS (
      SELECT 1 FROM public.task_consultation_responses cr
      WHERE cr.task_id = p_task_id AND cr.cycle_number = v_task.current_cycle_number
        AND (cr.user_id = ra.user_id OR (ra.department_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.department_memberships dm WHERE dm.department_id = ra.department_id AND dm.user_id = cr.user_id AND dm.is_active = true
        )))
    );

  IF v_pending_c_count > 0 THEN
    RETURN jsonb_build_object(
      'consultation_complete', false,
      'remaining_consultations', v_pending_c_count
    );
  END IF;

  -- All required consultations completed!
  IF v_step.approval_required THEN
    PERFORM set_config('sns.process_engine_write', 'on', true);
    UPDATE public.tasks SET workflow_state = 'awaiting_approval' WHERE id = p_task_id;

    INSERT INTO public.task_approval_cycles (
      task_id, cycle_number, status
    ) VALUES (
      p_task_id, v_task.current_cycle_number, 'pending'
    ) ON CONFLICT (task_id, cycle_number) DO NOTHING;

    -- Notify Accountable
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
        'Consultations finished. Task "' || v_task.title || '" is awaiting your approval.',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    RETURN jsonb_build_object(
      'consultation_complete', true,
      'workflow_state', 'awaiting_approval'
    );
  ELSE
    PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

    RETURN jsonb_build_object(
      'consultation_complete', true,
      'workflow_state', 'completed'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_task_consultation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_consultation(uuid, text) TO authenticated;


-- ============================================================================
-- 9. EVIDENCE SUBMISSION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_task_evidence(
  p_task_id         uuid,
  p_evidence_def_id uuid DEFAULT NULL,
  p_evidence_type   text DEFAULT 'text',
  p_payload         jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id      uuid;
  v_task           RECORD;
  v_is_responsible boolean := false;
  v_submission_id  uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_evidence_type NOT IN ('text', 'link') THEN
    RAISE EXCEPTION 'Only text and link evidence types are supported in MVP.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- Verify caller is Responsible (R)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'R'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_responsible;

  IF NOT v_is_responsible THEN
    RAISE EXCEPTION 'Caller is not an assigned Responsible user for this task.';
  END IF;

  -- If evidence_def_id supplied, ensure it belongs to this step
  IF p_evidence_def_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_evidence_defs ed
      WHERE ed.id = p_evidence_def_id AND ed.step_id = v_task.process_step_id
    ) THEN
      RAISE EXCEPTION 'Evidence definition does not belong to this process step.';
    END IF;
  END IF;

  INSERT INTO public.task_evidence_submissions (
    task_id, cycle_number, evidence_def_id, evidence_type, payload, submitted_by
  ) VALUES (
    p_task_id, v_task.current_cycle_number, p_evidence_def_id, p_evidence_type, p_payload, v_caller_id
  ) RETURNING id INTO v_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_task_evidence(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_evidence(uuid, uuid, text, jsonb) TO authenticated;


-- ============================================================================
-- 10. ACCOUNTABLE APPROVAL RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_process_task(
  p_task_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id     uuid;
  v_task          RECORD;
  v_is_accountable boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Task is not awaiting approval (current state: %).', v_task.workflow_state;
  END IF;

  -- Verify caller is Accountable (A)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'A'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_accountable;

  IF NOT v_is_accountable THEN
    RAISE EXCEPTION 'Caller is not the assigned Accountable user for this task.';
  END IF;

  -- Update approval cycle
  UPDATE public.task_approval_cycles
  SET status = 'approved',
      decided_by = v_caller_id,
      decided_at = now()
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  -- Complete task and advance workflow
  PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

  RETURN jsonb_build_object(
    'success', true,
    'workflow_state', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_process_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_process_task(uuid) TO authenticated;


-- ============================================================================
-- 11. ACCOUNTABLE REJECTION / REWORK RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_process_task(
  p_task_id      uuid,
  p_reason       text,
  p_new_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id      uuid;
  v_task           RECORD;
  v_task_list      RECORD;
  v_workspace_id   uuid;
  v_is_accountable boolean := false;
  v_new_cycle      integer;
  v_recipient      RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required.';
  END IF;

  IF p_new_due_date IS NULL OR p_new_due_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'New due date must be today or a future date.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Task is not awaiting approval (current state: %).', v_task.workflow_state;
  END IF;

  SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p WHERE p.id = v_task.project_id;

  -- Verify caller is Accountable (A)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'A'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_accountable;

  IF NOT v_is_accountable THEN
    RAISE EXCEPTION 'Caller is not the assigned Accountable user for this task.';
  END IF;

  v_new_cycle := v_task.current_cycle_number + 1;

  -- Enable bypass marker
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- Update current approval cycle to rejected
  UPDATE public.task_approval_cycles
  SET status = 'rejected',
      decided_by = v_caller_id,
      decided_at = now(),
      rejection_reason = p_reason,
      new_due_date = p_new_due_date
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  -- Update task state to rework_required and increment cycle
  UPDATE public.tasks
  SET current_cycle_number = v_new_cycle,
      workflow_state = 'rework_required',
      due_date = p_new_due_date,
      overdue_cycle_notified = false
  WHERE id = p_task_id;

  -- Audit event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_REWORK_REQUIRED', v_caller_id,
    jsonb_build_object(
      'previous_cycle', v_task.current_cycle_number,
      'new_cycle', v_new_cycle,
      'reason', p_reason,
      'new_due_date', p_new_due_date
    )
  );

  -- Notify RACI
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = p_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL AND u_id <> v_caller_id
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'task_rework_required',
      'Rework required: ' || v_task.title,
      'Task "' || v_task.title || '" was rejected. Reason: ' || p_reason,
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'workflow_state', 'rework_required',
    'new_cycle_number', v_new_cycle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_process_task(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_process_task(uuid, text, date) TO authenticated;


-- ============================================================================
-- 12. SEED WORKSPACE WORKING CALENDAR
-- ============================================================================

INSERT INTO public.workspace_working_calendars (
  workspace_id,
  timezone,
  monday_working,
  tuesday_working,
  wednesday_working,
  thursday_working,
  friday_working,
  saturday_working,
  sunday_working,
  created_by
)
SELECT
  w.id,
  'Asia/Kolkata',
  true, true, true, true, true, false, false,
  w.created_by
FROM public.workspaces w
WHERE w.id = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea'
  AND NOT EXISTS (
    SELECT 1 FROM public.workspace_working_calendars cal WHERE cal.workspace_id = w.id
  );
