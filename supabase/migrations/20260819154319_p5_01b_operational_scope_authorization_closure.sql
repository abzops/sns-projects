-- ============================================================================
-- P5-01B: OPERATIONAL SCOPE AUTHORIZATION CLOSURE
--
-- 1. Remove workspaces.created_by bypass in can_mutate_operational_workspace:
--    Active workspace membership is the strict tenancy prerequisite.
--    Matches canonical frontend capability contract:
--    canMutateOperationalData = (workspace_role IN ('owner', 'admin', 'member'))
--                               OR (system_role IN ('project_admin', 'system_admin'))
--
-- 2. Hardened Ordinary Task Exact-Scope Authorization:
--    complete_task_with_expense_internal enforces:
--    a) Workspace mutation capability (can_mutate_operational_workspace)
--    b) Exact Task authorization (System Role, Project Owner, Assignee, Task Owner, RACI R)
--    Workspace Owner/Admin membership alone no longer authorizes completing arbitrary Tasks.
--
-- 3. Post-cancellation guards on process mutation RPCs:
--    Explicit checks preventing mutation on cancelled process instance tasks.
-- ============================================================================

-- ── 1. CANONICAL OPERATIONAL MUTATION CAPABILITY HELPER ───────────────────────

CREATE OR REPLACE FUNCTION private.can_mutate_operational_workspace(
  p_workspace_id uuid,
  p_user_id      uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = p_workspace_id
        AND wm.user_id = p_user_id
        AND wm.status = 'active'
        AND (
          wm.role IN ('owner', 'admin', 'member')
          OR EXISTS (
            SELECT 1
            FROM public.user_system_roles usr
            WHERE usr.workspace_id = p_workspace_id
              AND usr.user_id = p_user_id
              AND usr.role IN ('project_admin', 'system_admin')
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION private.can_mutate_operational_workspace(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_mutate_operational_workspace(uuid, uuid) TO authenticated, service_role, postgres;

-- ── 2. EXACT-SCOPE ORDINARY TASK COMPLETION ENGINE ────────────────────────────

CREATE OR REPLACE FUNCTION private.complete_task_with_expense_internal(
  p_task_id         uuid,
  p_expense_payload jsonb DEFAULT NULL,
  p_notes           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id        uuid;
  v_task             record;
  v_project          record;
  v_workspace_id     uuid;
  v_project_owner_id uuid;
  v_done_status_id   uuid;
  v_is_authorized    boolean;
  v_closure_state    jsonb;
  v_parsed_date      date;
  v_parsed_desc      text;
  v_parsed_items     jsonb;
  v_total_amount     numeric(15,2);
  v_tx_id            uuid := NULL;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_task_id IS NULL THEN
    RAISE EXCEPTION 'task_id is required.';
  END IF;

  -- 1. Look up task FOR UPDATE
  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  IF v_task.process_step_id IS NOT NULL OR v_task.process_instance_id IS NOT NULL THEN
    RAISE EXCEPTION 'Defined Process step tasks must be completed via complete_responsible_step_with_expense.';
  END IF;

  -- Projectless ordinary task fail closed
  IF v_task.project_id IS NULL THEN
    RAISE EXCEPTION 'Ordinary task completion with finance requires a valid project_id.';
  END IF;

  -- Look up authoritative project
  SELECT p.workspace_id, p.owner_id AS project_owner_id
  INTO v_project
  FROM public.projects p
  WHERE p.id = v_task.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found for task %', p_task_id;
  END IF;

  v_workspace_id := v_project.workspace_id;
  v_project_owner_id := v_project.project_owner_id;

  -- 2. Verify workspace mutation capability (Active tenant + Owner/Admin/Member/ProjectAdmin/SysAdmin)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in workspace %', v_workspace_id;
  END IF;

  -- 3. Exact operational Task authorization check (OV1 access model)
  -- Note: Workspace Owner/Admin membership alone does NOT authorize completing arbitrary tasks.
  v_is_authorized := (
    -- Global operational visibility through approved System Role
    EXISTS (
      SELECT 1 FROM public.user_system_roles usr
      WHERE usr.workspace_id = v_workspace_id
        AND usr.user_id = v_caller_id
        AND usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
    )
    -- Project Owner for this Project
    OR (v_project_owner_id IS NOT NULL AND v_project_owner_id = v_caller_id)
    -- Task direct assignee
    OR (v_task.assignee_id IS NOT NULL AND v_task.assignee_id = v_caller_id)
    -- Task owner
    OR (v_task.owner_id IS NOT NULL AND v_task.owner_id = v_caller_id)
    -- Task RACI Responsible (R), direct or active department-targeted
    OR EXISTS (
      SELECT 1 FROM public.task_raci_assignments ra
      WHERE ra.task_id = p_task_id
        AND ra.raci_role = 'R'
        AND (
          ra.user_id = v_caller_id
          OR (
            ra.department_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.department_memberships dm
              WHERE dm.workspace_id = v_workspace_id
                AND dm.department_id = ra.department_id
                AND dm.user_id = v_caller_id
                AND dm.is_active = true
            )
          )
        )
    )
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Caller is not authorized to complete task %', p_task_id;
  END IF;

  -- 4. Canonical Done status resolution
  v_done_status_id := private.resolve_project_done_status(v_task.project_id);

  -- 5. Retry / Idempotency check
  IF v_task.status_id = v_done_status_id THEN
    IF p_expense_payload IS NOT NULL AND p_expense_payload <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Cannot record expense on an already completed task.';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'status', 'done',
      'is_retry', true,
      'transaction_id', NULL,
      'total_expense', 0.00
    );
  END IF;

  -- 6. Evaluate parent task leaf invariants (Decision 17: direct expenses on parent blocked)
  SELECT * INTO v_closure_state
  FROM private.get_task_closure_state(p_task_id);

  IF COALESCE((v_closure_state ->> 'has_dependencies')::boolean, false) THEN
    IF p_expense_payload IS NOT NULL AND p_expense_payload <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Parent tasks with child dependencies cannot capture direct expenses.';
    END IF;
  END IF;

  -- 7. Parse and validate expense payload if provided
  SELECT o_expense_date, o_description, o_items, o_total_amount
  INTO v_parsed_date, v_parsed_desc, v_parsed_items, v_total_amount
  FROM private.parse_and_validate_expense_payload(p_expense_payload);

  -- 8. Insert expense transaction if payload provided
  IF v_parsed_items IS NOT NULL THEN
    v_tx_id := private.insert_expense_transaction_internal(
      v_workspace_id,
      p_task_id,
      v_parsed_date,
      v_parsed_desc,
      v_parsed_items,
      v_caller_id,
      NULL -- ordinary tasks have NULL cycle_number
    );
  END IF;

  -- 9. Update task status to Done
  UPDATE public.tasks
  SET status_id = v_done_status_id,
      updated_at = clock_timestamp()
  WHERE id = p_task_id;

  -- 10. Trigger auto-completion on parent hierarchy if applicable
  IF v_task.parent_task_id IS NOT NULL THEN
    PERFORM private.try_auto_complete_parent_task(v_task.parent_task_id, v_caller_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'status', 'done',
    'is_retry', false,
    'transaction_id', v_tx_id,
    'total_expense', COALESCE(v_total_amount, 0.00)
  );
END;
$$;

REVOKE ALL ON FUNCTION private.complete_task_with_expense_internal(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_task_with_expense_internal(uuid, jsonb, text) TO authenticated, service_role, postgres;

-- ── 3. HARDENED PROCESS MUTATION RPCS (CANCELLATION & VIEWER GUARDS) ──────────

CREATE OR REPLACE FUNCTION public.approve_process_task(
  p_task_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id      uuid;
  v_task           RECORD;
  v_workspace_id   uuid;
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

  -- Context resolution
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id FROM public.process_instances WHERE id = v_task.process_instance_id;
  ELSE
    SELECT workspace_id INTO v_workspace_id FROM public.projects WHERE id = v_task.project_id;
  END IF;

  -- Check workspace mutation capability (Fail closed for Viewers)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in this workspace.';
  END IF;

  -- Guard against cancelled state
  IF v_task.workflow_state = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot approve task: task belongs to a cancelled process instance.';
  END IF;

  IF v_task.workflow_state NOT IN ('awaiting_approval', 'in_review') THEN
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
    RAISE EXCEPTION 'Caller is not an assigned Accountable user for this task.';
  END IF;

  -- Mark approval cycle as approved
  UPDATE public.task_approval_cycles
  SET status = 'approved',
      decided_by = v_caller_id,
      decided_at = now()
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  -- Record audit event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, process_instance_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, v_task.process_instance_id,
    'TASK_APPROVED', v_caller_id,
    jsonb_build_object('cycle_number', v_task.current_cycle_number)
  );

  -- Complete and advance DAG
  PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'cycle_number', v_task.current_cycle_number,
    'workflow_state', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_process_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_process_task(uuid) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.submit_task_consultation(
  p_task_id  uuid,
  p_response text
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
  v_instance         RECORD;
  v_task_list        RECORD;
  v_project          RECORD;
  v_workspace_id     uuid;
  v_process_name     text;
  v_is_c             boolean;
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

  -- Context resolution
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

  -- Check workspace mutation capability (Fail closed for Viewers)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in this workspace.';
  END IF;

  -- Guard against invalid or cancelled state
  IF v_task.workflow_state NOT IN ('ready', 'in_progress', 'waiting', 'active', 'rework_required', 'awaiting_consultation') THEN
    RAISE EXCEPTION 'Cannot submit consultation response in % state.', v_task.workflow_state;
  END IF;

  SELECT * INTO v_step FROM public.defined_process_steps WHERE id = v_task.process_step_id;

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
    p_task_id, v_task.current_cycle_number, v_caller_id, p_response
  )
  ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET response_text = p_response, responded_at = now();

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

REVOKE ALL ON FUNCTION public.submit_task_consultation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_consultation(uuid, text) TO authenticated, service_role, postgres;

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
  v_workspace_id   uuid;
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

  -- Guard against cancelled state
  IF v_task.workflow_state = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot submit evidence: task belongs to a cancelled process instance.';
  END IF;

  -- Context resolution
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id FROM public.process_instances WHERE id = v_task.process_instance_id;
  ELSE
    SELECT workspace_id INTO v_workspace_id FROM public.projects WHERE id = v_task.project_id;
  END IF;

  -- Check workspace mutation capability (Fail closed for Viewers)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in this workspace.';
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
GRANT EXECUTE ON FUNCTION public.submit_task_evidence(uuid, uuid, text, jsonb) TO authenticated, service_role, postgres;
