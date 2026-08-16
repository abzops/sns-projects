-- SNS Projects — V1-03A: Dynamic RACI Process Builder Foundation
-- Scope:
-- 1. Extend public.defined_process_step_raci with actor_type ('user', 'process_starter') & nullable user_id
-- 2. Update publish_defined_process_version to validate Process Starter
-- 3. Update start_defined_process for Process Starter authorization, dynamic R/A preflight, and deduplicated runtime task_raci_assignments
-- 4. Create public.save_defined_process_draft (SECURITY INVOKER, service_role-only execution) for atomic draft saves, optimistic concurrency, and custom DAG protection

-- ============================================================================
-- 1. EXTEND defined_process_step_raci (actor_type, nullable user_id, constraints)
-- ============================================================================

-- Safely drop old unique constraint on (step_id, raci_role, user_id)
ALTER TABLE public.defined_process_step_raci
  DROP CONSTRAINT IF EXISTS uq_step_raci_step_role_user;

-- Add actor_type column
ALTER TABLE public.defined_process_step_raci
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'user';

-- Enforce actor_type allowed values
ALTER TABLE public.defined_process_step_raci
  DROP CONSTRAINT IF EXISTS chk_step_raci_actor_type;
ALTER TABLE public.defined_process_step_raci
  ADD CONSTRAINT chk_step_raci_actor_type CHECK (actor_type IN ('user', 'process_starter'));

-- Make user_id nullable for process_starter
ALTER TABLE public.defined_process_step_raci
  ALTER COLUMN user_id DROP NOT NULL;

-- Enforce actor constraint:
-- - user: actor_type = 'user' AND user_id IS NOT NULL
-- - process_starter: actor_type = 'process_starter' AND user_id IS NULL AND raci_role = 'R'
ALTER TABLE public.defined_process_step_raci
  DROP CONSTRAINT IF EXISTS chk_step_raci_actor;
ALTER TABLE public.defined_process_step_raci
  ADD CONSTRAINT chk_step_raci_actor CHECK (
    (actor_type = 'user' AND user_id IS NOT NULL)
    OR
    (actor_type = 'process_starter' AND user_id IS NULL AND raci_role = 'R')
  );

-- Create partial unique indexes for user and process_starter
DROP INDEX IF EXISTS public.uq_step_raci_step_role_user;
CREATE UNIQUE INDEX uq_step_raci_step_role_user
  ON public.defined_process_step_raci (step_id, raci_role, user_id)
  WHERE actor_type = 'user';

DROP INDEX IF EXISTS public.uq_step_raci_step_process_starter;
CREATE UNIQUE INDEX uq_step_raci_step_process_starter
  ON public.defined_process_step_raci (step_id, raci_role)
  WHERE actor_type = 'process_starter';

-- Single Accountable per step constraint
DROP INDEX IF EXISTS public.uq_step_raci_single_accountable;
CREATE UNIQUE INDEX uq_step_raci_single_accountable
  ON public.defined_process_step_raci (step_id)
  WHERE raci_role = 'A';


-- ============================================================================
-- 2. UPDATE publish_defined_process_version RPC
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

    -- Count R and A (R includes both concrete users and Process Starter)
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

    -- approval_required => Accountable concrete user cannot be in concrete Responsible set
    IF v_step.approval_required THEN
      IF EXISTS (
        SELECT 1 FROM public.defined_process_step_raci r
        WHERE r.step_id = v_step.id AND r.raci_role = 'R' AND r.actor_type = 'user' AND r.user_id = (
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

  -- 5. Validate that all concrete RACI users are active workspace members
  SELECT r.user_id, p.full_name INTO v_invalid_raci
  FROM public.defined_process_step_raci r
  JOIN public.defined_process_steps s ON s.id = r.step_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE s.version_id = p_version_id
    AND r.actor_type = 'user'
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
  UPDATE public.defined_process_versions
  SET status = 'archived'
  WHERE defined_process_id = v_process.id AND status = 'published';

  UPDATE public.defined_process_versions
  SET status = 'published',
      published_by = v_caller_id,
      published_at = now()
  WHERE id = p_version_id;

  INSERT INTO public.process_audit_events (
    workspace_id, event_type, actor_id, payload
  ) VALUES (
    v_process.workspace_id, 'VERSION_PUBLISHED', v_caller_id,
    jsonb_build_object(
      'process_id', v_process.id,
      'version_id', p_version_id,
      'version_number', v_version.version_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'process_id', v_process.id,
    'version_id', p_version_id,
    'status', 'published'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_defined_process_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_defined_process_version(uuid) TO authenticated;


-- ============================================================================
-- 3. UPDATE start_defined_process RPC
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
  v_chk_step        RECORD;
  v_step_acct_user  uuid;
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

  -- 4. DYNAMIC RACI PREFLIGHT: Process Starter + Approval Dynamic R/A Rule
  -- If approval_required = true AND Process Starter is assigned as R:
  -- Resolving Process Starter to caller must not equal the Accountable user for that step.
  FOR v_chk_step IN
    SELECT s.id, s.step_code, s.title
    FROM public.defined_process_steps s
    WHERE s.version_id = p_version_id AND s.approval_required = true
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.defined_process_step_raci r
      WHERE r.step_id = v_chk_step.id AND r.raci_role = 'R' AND r.actor_type = 'process_starter'
    ) THEN
      SELECT r.user_id INTO v_step_acct_user
      FROM public.defined_process_step_raci r
      WHERE r.step_id = v_chk_step.id AND r.raci_role = 'A';

      IF v_step_acct_user = v_caller_id THEN
        RAISE EXCEPTION 'Cannot start this process. You are Accountable for an approval-required step where Process Starter is Responsible. Responsible and Accountable must be different.';
      END IF;
    END IF;
  END LOOP;

  -- 5. Find root step
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

  -- 6. ROOT START AUTHORIZATION:
  -- Caller is explicitly assigned concrete R OR (Root R is Process Starter AND caller is active non-viewer)
  SELECT (
    EXISTS (
      SELECT 1 FROM public.defined_process_step_raci r
      WHERE r.step_id = v_root_step.id AND r.raci_role = 'R' AND r.actor_type = 'user' AND r.user_id = v_caller_id
    )
    OR
    (
      EXISTS (
        SELECT 1 FROM public.defined_process_step_raci r
        WHERE r.step_id = v_root_step.id AND r.raci_role = 'R' AND r.actor_type = 'process_starter'
      )
      AND EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = v_workspace_id
          AND wm.user_id = v_caller_id
          AND wm.status = 'active'
          AND wm.role <> 'viewer'
      )
    )
  ) INTO v_caller_is_root_r;

  IF NOT v_caller_is_root_r THEN
    RAISE EXCEPTION 'Caller is not authorized to start the root step of this process.';
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

  -- 7. Insert live task_lists instance
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

  -- 8. Insert all defined tasks in this version
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

    -- Instantiate task_raci_assignments with explicit deduplication:
    -- Resolves actor_type = 'process_starter' -> v_caller_id
    -- Resolves actor_type = 'user' -> user_id
    -- Deduplicates on (v_task_id, raci_role, resolved_user_id)
    FOR v_raci IN
      SELECT DISTINCT ON (raci_role, resolved_user_id)
        r.raci_role,
        CASE
          WHEN r.actor_type = 'process_starter' THEN v_caller_id
          ELSE r.user_id
        END AS resolved_user_id,
        COALESCE(r.response_required, false) AS response_required
      FROM public.defined_process_step_raci r
      WHERE r.step_id = v_step.id
      ORDER BY raci_role, resolved_user_id, r.response_required DESC
    LOOP
      INSERT INTO public.task_raci_assignments (
        task_id,
        raci_role,
        user_id,
        response_required
      ) VALUES (
        v_task_id,
        v_raci.raci_role,
        v_raci.resolved_user_id,
        v_raci.response_required
      );
    END LOOP;
  END LOOP;

  -- 9. Audit events & notifications for root task
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
-- 4. CREATE save_defined_process_draft (SECURITY INVOKER, service_role ONLY)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_defined_process_draft(
  p_workspace_id    uuid,
  p_actor_id        uuid,
  p_payload         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_caller_role          text;
  v_is_admin             boolean;
  v_is_dept_head         boolean;
  v_process_id           uuid;
  v_version_id           uuid;
  v_proc_name            text;
  v_proc_code            text;
  v_proc_desc            text;
  v_dept_id              uuid;
  v_owner_id             uuid;
  v_base_updated_at      timestamptz;
  v_steps_json           jsonb;
  v_process_record       RECORD;
  v_version_record       RECORD;
  v_existing_step_count  integer := 0;
  v_existing_edge_count  integer := 0;
  v_is_sequential_chain  boolean := true;
  v_step_elem            jsonb;
  v_step_id              uuid;
  v_step_code            text;
  v_step_title           text;
  v_seq_order            integer;
  v_duration             integer;
  v_approval_req         boolean;
  v_consultation_req     boolean;
  v_evidence_req         boolean;
  v_raci_array           jsonb;
  v_raci_elem            jsonb;
  v_raci_role            text;
  v_actor_type           text;
  v_user_id              uuid;
  v_resp_req             boolean;
  v_new_updated_at       timestamptz;
  v_prev_step_id         uuid := NULL;
  v_curr_step_id         uuid;
  v_dup_id               uuid;
  v_incoming_step_ids    uuid[];
  v_existing_step_ids    uuid[];
BEGIN
  -- 1. Caller verification
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Caller identity is required.';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = p_actor_id
    AND status = 'active';

  IF v_caller_role IS NULL OR v_caller_role = 'viewer' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: Caller is not authorized to edit or create process drafts in this workspace.';
  END IF;

  -- 2. Extract payload
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Payload is missing.';
  END IF;

  v_process_id      := NULLIF(p_payload->>'process_id', '')::uuid;
  v_version_id      := NULLIF(p_payload->>'version_id', '')::uuid;
  v_proc_name       := btrim(COALESCE(p_payload->'process'->>'name', ''));
  v_proc_code       := btrim(COALESCE(p_payload->'process'->>'code', ''));
  v_proc_desc       := p_payload->'process'->>'description';
  v_dept_id         := NULLIF(p_payload->'process'->>'department_id', '')::uuid;
  v_owner_id        := NULLIF(p_payload->'process'->>'process_owner_id', '')::uuid;
  v_base_updated_at := NULLIF(p_payload->>'base_updated_at', '')::timestamptz;
  v_steps_json      := COALESCE(p_payload->'steps', '[]'::jsonb);

  -- 3. Validate metadata
  IF v_proc_name = '' THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Process name is required.';
  END IF;

  IF v_proc_code = '' THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Process code is required.';
  END IF;

  IF v_dept_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.departments WHERE id = v_dept_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Selected department is invalid or does not belong to this workspace.';
  END IF;

  IF v_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = v_owner_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Process owner must be an active member of this workspace.';
  END IF;

  -- 4. Authorization check
  v_is_admin := (
    v_caller_role IN ('owner', 'admin')
    OR (SELECT private.has_system_role(p_workspace_id, 'project_admin'))
    OR (SELECT private.has_system_role(p_workspace_id, 'system_admin'))
  );

  SELECT EXISTS (
    SELECT 1 FROM public.department_memberships dm
    WHERE dm.department_id = v_dept_id
      AND dm.user_id = p_actor_id
      AND dm.role = 'head'
      AND dm.is_active = true
  ) INTO v_is_dept_head;

  -- Check unique name & code conflicts in workspace
  SELECT id INTO v_dup_id
  FROM public.defined_processes
  WHERE workspace_id = p_workspace_id
    AND code = v_proc_code
    AND (v_process_id IS NULL OR id <> v_process_id);

  IF v_dup_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_CONFLICT_CODE: Process code already exists in this workspace.';
  END IF;

  SELECT id INTO v_dup_id
  FROM public.defined_processes
  WHERE workspace_id = p_workspace_id
    AND name = v_proc_name
    AND (v_process_id IS NULL OR id <> v_process_id);

  IF v_dup_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_CONFLICT_NAME: Process name already exists in this workspace.';
  END IF;

  -- 5. Process & Version Creation / Updating
  IF v_process_id IS NULL THEN
    -- Creating a new process
    IF NOT (v_is_admin OR v_is_dept_head) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: You do not have permission to create processes for this department.';
    END IF;

    INSERT INTO public.defined_processes (
      workspace_id,
      department_id,
      name,
      code,
      description,
      process_owner_id,
      is_active
    ) VALUES (
      p_workspace_id,
      v_dept_id,
      v_proc_name,
      v_proc_code,
      v_proc_desc,
      v_owner_id,
      true
    ) RETURNING id INTO v_process_id;

    INSERT INTO public.defined_process_versions (
      defined_process_id,
      version_number,
      status,
      change_summary
    ) VALUES (
      v_process_id,
      1,
      'draft',
      'Initial draft'
    ) RETURNING id INTO v_version_id;

  ELSE
    -- Updating existing process
    SELECT * INTO v_process_record
    FROM public.defined_processes
    WHERE id = v_process_id AND workspace_id = p_workspace_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: Defined process not found in this workspace.';
    END IF;

    -- If moving department, caller must head both or be admin
    IF v_process_record.department_id <> v_dept_id THEN
      IF NOT (v_is_admin OR (v_is_dept_head AND EXISTS (
        SELECT 1 FROM public.department_memberships dm
        WHERE dm.department_id = v_process_record.department_id
          AND dm.user_id = p_actor_id
          AND dm.role = 'head'
          AND dm.is_active = true
      ))) THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: You cannot move this process to a department you do not head.';
      END IF;
    END IF;

    -- Caller must be admin, owning dept head, or process owner
    IF NOT (
      v_is_admin
      OR v_is_dept_head
      OR EXISTS (
        SELECT 1 FROM public.department_memberships dm
        WHERE dm.department_id = v_process_record.department_id
          AND dm.user_id = p_actor_id
          AND dm.role = 'head'
          AND dm.is_active = true
      )
      OR v_process_record.process_owner_id = p_actor_id
    ) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: You do not have permission to edit this process draft.';
    END IF;

    UPDATE public.defined_processes
    SET department_id = v_dept_id,
        name = v_proc_name,
        code = v_proc_code,
        description = v_proc_desc,
        process_owner_id = v_owner_id,
        updated_at = now()
    WHERE id = v_process_id;

    -- Resolve draft version
    IF v_version_id IS NULL THEN
      SELECT id, status, updated_at INTO v_version_record
      FROM public.defined_process_versions
      WHERE defined_process_id = v_process_id AND status = 'draft'
      ORDER BY version_number DESC
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.defined_process_versions (
          defined_process_id,
          version_number,
          status,
          change_summary
        ) VALUES (
          v_process_id,
          1,
          'draft',
          'Initial draft'
        ) RETURNING id INTO v_version_id;
      ELSE
        v_version_id := v_version_record.id;
      END IF;
    ELSE
      -- Lock draft version for concurrency check
      SELECT * INTO v_version_record
      FROM public.defined_process_versions
      WHERE id = v_version_id AND defined_process_id = v_process_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: Process version not found.';
      END IF;

      IF v_version_record.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: Cannot edit a published or archived process version.';
      END IF;

      -- Optimistic concurrency check
      IF v_base_updated_at IS NOT NULL AND v_version_record.updated_at > v_base_updated_at THEN
        RAISE EXCEPTION 'DRAFT_CONCURRENCY_CONFLICT: This draft changed since you opened it. Reload before saving.';
      END IF;
    END IF;
  END IF;

  -- 6. Custom DAG Detection
  SELECT count(*) INTO v_existing_step_count
  FROM public.defined_process_steps
  WHERE version_id = v_version_id;

  SELECT count(*) INTO v_existing_edge_count
  FROM public.defined_process_step_dependencies
  WHERE version_id = v_version_id;

  IF v_existing_step_count <= 1 THEN
    v_is_sequential_chain := true;
  ELSE
    -- Graph is strictly sequential if exactly (step_count - 1) edges exist AND every edge connects sequence N to sequence N-1
    v_is_sequential_chain := (
      v_existing_edge_count = (v_existing_step_count - 1)
      AND NOT EXISTS (
        SELECT 1
        FROM public.defined_process_step_dependencies d
        JOIN public.defined_process_steps s ON s.id = d.step_id
        JOIN public.defined_process_steps p ON p.id = d.depends_on_step_id
        WHERE d.version_id = v_version_id
          AND s.sequence_order <> (p.sequence_order + 1)
      )
    );
  END IF;

  -- If CUSTOM FLOW, verify that incoming steps do not attempt structural mutations
  IF NOT v_is_sequential_chain THEN
    SELECT array_agg(id ORDER BY sequence_order) INTO v_existing_step_ids
    FROM public.defined_process_steps
    WHERE version_id = v_version_id;

    SELECT array_agg((elem->>'id')::uuid) INTO v_incoming_step_ids
    FROM jsonb_array_elements(v_steps_json) elem;

    IF array_length(v_incoming_step_ids, 1) <> v_existing_step_count
       OR v_incoming_step_ids IS DISTINCT FROM v_existing_step_ids THEN
      RAISE EXCEPTION 'ERR_CUSTOM_DAG_STRUCTURAL_LOCK: This process uses a custom dependency flow. Structural step addition, deletion, or reordering cannot be performed in V1-03A.';
    END IF;
  END IF;

  -- 7. Two-Phase Safe Step Synchronization
  -- Phase A: Shift existing steps sequence_order by +100000 to avoid unique constraint collisions during reordering
  UPDATE public.defined_process_steps
  SET sequence_order = sequence_order + 100000
  WHERE version_id = v_version_id;

  -- Phase B: Delete steps that were intentionally removed in the client
  IF jsonb_array_length(v_steps_json) > 0 THEN
    DELETE FROM public.defined_process_steps
    WHERE version_id = v_version_id
      AND id NOT IN (
        SELECT (elem->>'id')::uuid
        FROM jsonb_array_elements(v_steps_json) elem
        WHERE (elem->>'id') IS NOT NULL AND (elem->>'id') <> ''
      );
  ELSE
    DELETE FROM public.defined_process_steps
    WHERE version_id = v_version_id;
  END IF;

  -- Phase C: Upsert steps and synchronize RACI
  v_seq_order := 0;
  FOR v_step_elem IN SELECT * FROM jsonb_array_elements(v_steps_json)
  LOOP
    v_seq_order := v_seq_order + 1;
    v_step_id          := NULLIF(v_step_elem->>'id', '')::uuid;
    v_step_code        := btrim(COALESCE(v_step_elem->>'step_code', 'STP-' || lpad(v_seq_order::text, 3, '0')));
    v_step_title       := btrim(COALESCE(v_step_elem->>'title', ''));
    v_duration         := GREATEST(1, COALESCE((v_step_elem->>'expected_duration_days')::integer, 1));
    v_approval_req     := COALESCE((v_step_elem->>'approval_required')::boolean, false);
    v_consultation_req := COALESCE((v_step_elem->>'consultation_required')::boolean, false);
    v_evidence_req     := COALESCE((v_step_elem->>'evidence_required')::boolean, false);

    IF v_step_id IS NULL THEN
      v_step_id := gen_random_uuid();
    END IF;

    -- Upsert step record
    INSERT INTO public.defined_process_steps (
      id,
      version_id,
      step_code,
      title,
      description,
      sequence_order,
      expected_duration_days,
      approval_required,
      consultation_required,
      evidence_required
    ) VALUES (
      v_step_id,
      v_version_id,
      v_step_code,
      v_step_title,
      v_step_elem->>'description',
      v_seq_order,
      v_duration,
      v_approval_req,
      v_consultation_req,
      v_evidence_req
    )
    ON CONFLICT (id) DO UPDATE SET
      step_code              = EXCLUDED.step_code,
      title                  = EXCLUDED.title,
      description            = EXCLUDED.description,
      sequence_order         = EXCLUDED.sequence_order,
      expected_duration_days = EXCLUDED.expected_duration_days,
      approval_required      = EXCLUDED.approval_required,
      consultation_required  = EXCLUDED.consultation_required,
      evidence_required      = EXCLUDED.evidence_required,
      updated_at             = now();

    -- Synchronize RACI for this step
    DELETE FROM public.defined_process_step_raci WHERE step_id = v_step_id;

    v_raci_array := COALESCE(v_step_elem->'raci', '[]'::jsonb);
    FOR v_raci_elem IN SELECT * FROM jsonb_array_elements(v_raci_array)
    LOOP
      v_raci_role  := v_raci_elem->>'raci_role';
      v_actor_type := COALESCE(v_raci_elem->>'actor_type', 'user');
      v_user_id    := NULLIF(v_raci_elem->>'user_id', '')::uuid;
      v_resp_req   := COALESCE((v_raci_elem->>'response_required')::boolean, false);

      IF v_raci_role NOT IN ('R', 'A', 'C', 'I') THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Invalid RACI role %', v_raci_role;
      END IF;

      IF v_actor_type = 'process_starter' THEN
        IF v_raci_role <> 'R' THEN
          RAISE EXCEPTION 'ERR_VALIDATION: Process Starter can only be assigned to Responsible (R).';
        END IF;
        v_user_id := NULL;
        v_resp_req := false;
      ELSIF v_actor_type = 'user' THEN
        IF v_user_id IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE workspace_id = p_workspace_id AND user_id = v_user_id AND status = 'active'
          ) THEN
            RAISE EXCEPTION 'ERR_VALIDATION: Assigned RACI user % is not an active workspace member.', v_user_id;
          END IF;
        END IF;
      ELSE
        RAISE EXCEPTION 'ERR_VALIDATION: Invalid actor_type %', v_actor_type;
      END IF;

      IF v_actor_type = 'process_starter' OR v_user_id IS NOT NULL THEN
        INSERT INTO public.defined_process_step_raci (
          step_id,
          raci_role,
          actor_type,
          user_id,
          response_required
        ) VALUES (
          v_step_id,
          v_raci_role,
          v_actor_type,
          v_user_id,
          CASE WHEN v_raci_role = 'C' THEN v_resp_req ELSE false END
        );
      END IF;
    END LOOP;
  END LOOP;

  -- 8. Dependency Synchronization
  -- If sequential chain, regenerate linear dependencies (Step 1 = root, Step N depends on Step N-1)
  IF v_is_sequential_chain THEN
    DELETE FROM public.defined_process_step_dependencies WHERE version_id = v_version_id;

    v_prev_step_id := NULL;
    FOR v_curr_step_id IN
      SELECT id FROM public.defined_process_steps
      WHERE version_id = v_version_id
      ORDER BY sequence_order ASC
    LOOP
      IF v_prev_step_id IS NOT NULL THEN
        INSERT INTO public.defined_process_step_dependencies (
          version_id,
          step_id,
          depends_on_step_id
        ) VALUES (
          v_version_id,
          v_curr_step_id,
          v_prev_step_id
        );
      END IF;
      v_prev_step_id := v_curr_step_id;
    END LOOP;
  END IF;

  -- 9. Touch version to advance authoritative updated_at revision token
  UPDATE public.defined_process_versions
  SET updated_at = now()
  WHERE id = v_version_id
  RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object(
    'success', true,
    'process_id', v_process_id,
    'version_id', v_version_id,
    'updated_at', v_new_updated_at
  );
END;
$$;

-- Security hardening: Invoker-only, revoked from public/anon/authenticated, service_role only
REVOKE ALL ON FUNCTION public.save_defined_process_draft(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_defined_process_draft(uuid, uuid, jsonb) TO service_role, postgres;
