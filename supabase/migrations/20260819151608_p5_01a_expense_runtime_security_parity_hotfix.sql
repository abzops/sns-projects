-- SNS Projects — Package 5 / P5-01A: Expense Runtime Security & Parity Hotfix
-- Migration: 20260819151608_p5_01a_expense_runtime_security_parity_hotfix.sql
-- Baseline:  20260819131603_p5_01_expense_execution_runtime.sql
--
-- Scope:
-- 1. Restore complete notification type compatibility (including process_consultation_response).
-- 2. Add database-level uniqueness for active/corrected process cycle expenses.
-- 3. Create private.can_mutate_operational_workspace helper (strict Viewer read-only enforcement).
-- 4. Close Viewer mutation loophole on ordinary task completion, complete_responsible_part, approve, reject, consultation, evidence.
-- 5. Refactor complete_responsible_step_with_expense_internal to wrap canonical complete_responsible_part_internal (zero runtime duplication).

-- ============================================================================
-- 1. SCHEMA & CONSTRAINT HARDENING
-- ============================================================================

-- 1.1 Restore all emitted literal notification types to notifications_type_check
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'task_assigned'::text,
      'task_accountable'::text,
      'task_consulted'::text,
      'task_informed'::text,
      'raci_changed'::text,
      'task_status_changed'::text,
      'subtask_assigned'::text,
      'project_status_changed'::text,
      'system'::text,
      'process_task_ready'::text,
      'process_task_completed'::text,
      'consultation_required'::text,
      'process_consultation_response'::text,
      'approval_required'::text,
      'task_rework_required'::text,
      'rework_required'::text,
      'process_rework_requested'::text,
      'process_task_rejected'::text,
      'process_task_review_needed'::text,
      'process_completed'::text
    ])
  );

-- 1.2 Unique active/corrected expense transaction per task and cycle
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_transactions_task_cycle_active
  ON public.expense_transactions (task_id, cycle_number)
  WHERE cycle_number IS NOT NULL AND status IN ('active', 'corrected');

-- ============================================================================
-- 2. OPERATIONAL MUTATION CAPABILITY HELPER
-- ============================================================================

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
    AND (
      EXISTS (
        SELECT 1
        FROM public.workspaces w
        WHERE w.id = p_workspace_id
          AND w.created_by = p_user_id
      )
      OR EXISTS (
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
                AND usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
            )
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION private.can_mutate_operational_workspace(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_mutate_operational_workspace(uuid, uuid) TO authenticated, service_role, postgres;

-- ============================================================================
-- 3. HARDENED ORDINARY TASK COMPLETION (VIEWER PROTECTION)
-- ============================================================================

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

  -- 2. Verify workspace mutation capability (Fail closed for Viewers)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in workspace %', v_workspace_id;
  END IF;

  -- 3. Exact operational Task authorization check (OV1 access model)
  v_is_authorized := (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = v_workspace_id
        AND wm.user_id = v_caller_id
        AND wm.status = 'active'
        AND wm.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_system_roles usr
      WHERE usr.workspace_id = v_workspace_id
        AND usr.user_id = v_caller_id
        AND usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
    )
    OR v_task.assignee_id = v_caller_id
    OR v_task.owner_id = v_caller_id
    OR v_project_owner_id = v_caller_id
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
              WHERE dm.department_id = ra.department_id
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
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'is_replay', true,
        'task_id', p_task_id,
        'status', 'done'
      );
    END IF;
  END IF;

  -- 6. Parse and validate expense payload (if provided)
  SELECT o_expense_date, o_description, o_items, o_total_amount
  INTO v_parsed_date, v_parsed_desc, v_parsed_items, v_total_amount
  FROM private.parse_and_validate_expense_payload(p_expense_payload);

  IF v_parsed_items IS NOT NULL THEN
    -- Leaf task invariant: parent tasks with dependencies cannot capture direct expense (Decision 17)
    v_closure_state := private.get_task_closure_state(p_task_id);
    IF COALESCE((v_closure_state ->> 'has_dependencies')::boolean, false) THEN
      RAISE EXCEPTION 'Parent tasks with child dependencies cannot capture direct expenses.';
    END IF;

    -- Insert expense transaction + items + audit log
    v_tx_id := private.insert_expense_transaction_internal(
      v_workspace_id,
      p_task_id,
      v_parsed_date,
      v_parsed_desc,
      v_parsed_items,
      v_caller_id,
      NULL
    );
  END IF;

  -- 7. Update Task status to Done (triggers existing trg_tasks_parent_completion_reevaluate automatically)
  UPDATE public.tasks
  SET status_id = v_done_status_id,
      updated_at = clock_timestamp()
  WHERE id = p_task_id;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'status', 'done',
    'transaction_id', v_tx_id,
    'total_expense', COALESCE(v_total_amount, 0.00)
  );
END;
$$;

-- ============================================================================
-- 4. HARDENED PROCESS MUTATION RPCS (VIEWER PROTECTION)
-- ============================================================================

-- 4.1 complete_responsible_part_internal
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

  -- Check workspace mutation capability (Fail closed for Viewers)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in this workspace.';
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
    DO UPDATE SET status = 'pending', decided_at = NULL, decided_by = NULL, rejection_reason = NULL;

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

-- 4.2 reject_process_task_internal
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

  -- Check workspace mutation capability (Fail closed for Viewers)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in this workspace.';
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
    'status', 'rework_required',
    'task_id', p_task_id,
    'cycle_number', v_task.current_cycle_number + 1
  );
END;
$$;

-- 4.3 approve_process_task
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

  IF v_task.workflow_state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Task is not awaiting approval (current state: %).', v_task.workflow_state;
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

-- 4.4 submit_task_consultation
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

  IF p_response IS NULL OR btrim(p_response) = '' THEN
    RAISE EXCEPTION 'Response text cannot be empty.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state NOT IN ('ready', 'in_progress', 'waiting', 'active', 'rework_required') THEN
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

  -- Check workspace mutation capability (Fail closed for Viewers)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in this workspace.';
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

-- 4.5 submit_task_evidence
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

-- ============================================================================
-- 5. REFACTORED STEP COMPLETION WITH EXPENSE (ZERO RUNTIME DUPLICATION)
-- ============================================================================

CREATE OR REPLACE FUNCTION private.complete_responsible_step_with_expense_internal(
  p_task_id         uuid,
  p_cycle_number    integer,
  p_notes           text DEFAULT NULL,
  p_expense_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id        uuid;
  v_task             record;
  v_instance         record;
  v_project          record;
  v_workspace_id     uuid;
  v_parsed_date      date;
  v_parsed_desc      text;
  v_parsed_items     jsonb;
  v_total_amount     numeric(15,2);
  v_comp_res         jsonb;
  v_tx_id            uuid := NULL;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_task_id IS NULL THEN
    RAISE EXCEPTION 'task_id is required.';
  END IF;

  -- 2. Lock & resolve Task FOR UPDATE
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- 3. Resolve context and workspace_id
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    v_workspace_id := v_instance.workspace_id;
  ELSE
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Project not found for task.';
    END IF;
    v_workspace_id := v_project.workspace_id;
  END IF;

  -- Enforce workspace mutation capability (Viewer cannot mutate)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in this workspace.';
  END IF;

  -- 4. Verify requested cycle number
  IF v_task.current_cycle_number <> p_cycle_number THEN
    RAISE EXCEPTION 'Cycle number mismatch. Expected % but got %.', v_task.current_cycle_number, p_cycle_number;
  END IF;

  -- 5. Parse and validate expense payload if provided
  SELECT o_expense_date, o_description, o_items, o_total_amount
  INTO v_parsed_date, v_parsed_desc, v_parsed_items, v_total_amount
  FROM private.parse_and_validate_expense_payload(p_expense_payload);

  -- 6. Enforce Process-cycle expense idempotency check
  IF v_parsed_items IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.expense_transactions
      WHERE task_id = p_task_id
        AND cycle_number = p_cycle_number
        AND status IN ('active', 'corrected')
    ) THEN
      RAISE EXCEPTION 'An active or corrected expense transaction already exists for task % cycle %.', p_task_id, p_cycle_number;
    END IF;
  END IF;

  -- 7. Call canonical complete_responsible_part_internal (owns R check, evidence, consultation, DAG advance)
  v_comp_res := private.complete_responsible_part_internal(
    p_task_id,
    p_cycle_number,
    p_notes
  );

  -- 8. If canonical completion succeeded, insert expense if payload provided
  IF v_parsed_items IS NOT NULL THEN
    v_tx_id := private.insert_expense_transaction_internal(
      v_workspace_id,
      p_task_id,
      v_parsed_date,
      v_parsed_desc,
      v_parsed_items,
      v_caller_id,
      p_cycle_number
    );
  END IF;

  -- 9. Return combined result
  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'cycle_number', p_cycle_number,
    'status', v_comp_res ->> 'status',
    'step_result', v_comp_res,
    'transaction_id', v_tx_id,
    'total_expense', COALESCE(v_total_amount, 0.00)
  );
END;
$$;

-- ============================================================================
-- 6. CONTROLLED EXPENSE CORRECTION (FLEXIBLE PAYLOAD & VIEWER PROTECTION)
-- ============================================================================

CREATE OR REPLACE FUNCTION private.correct_expense_transaction_internal(
  p_transaction_id uuid,
  p_items          jsonb,
  p_reason         text,
  p_description    text DEFAULT NULL,
  p_expense_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id          uuid;
  v_tx                 record;
  v_prev_total         numeric(15,2);
  v_old_items_snapshot jsonb;
  v_parsed_date        date;
  v_parsed_desc        text;
  v_new_items          jsonb;
  v_new_total          numeric(15,2);
  v_item               jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'transaction_id is required.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Correction reason is required and cannot be empty.';
  END IF;

  -- 1. Look up transaction
  SELECT * INTO v_tx
  FROM public.expense_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense transaction % not found.', p_transaction_id;
  END IF;

  IF v_tx.status = 'voided' THEN
    RAISE EXCEPTION 'Cannot correct a voided expense transaction.';
  END IF;

  -- 2. Authorization check: Budget Manager or Finance Operator
  IF NOT (
    private.can_manage_budgets(v_tx.workspace_id, v_caller_id)
    OR private.is_finance_operator(v_tx.workspace_id, v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Caller is not authorized to correct expenses in this workspace.';
  END IF;

  -- 3. Capture previous item snapshot & total
  SELECT
    COALESCE(SUM(amount), 0.00),
    jsonb_agg(row_to_json(ei) ORDER BY line_number)
  INTO v_prev_total, v_old_items_snapshot
  FROM public.expense_items ei
  WHERE ei.transaction_id = p_transaction_id;

  -- 4. Parse & validate corrected items payload (supports both array and object payloads)
  IF jsonb_typeof(p_items) = 'array' THEN
    SELECT o_expense_date, o_description, o_items, o_total_amount
    INTO v_parsed_date, v_parsed_desc, v_new_items, v_new_total
    FROM private.parse_and_validate_expense_payload(jsonb_build_object('items', p_items, 'description', p_description, 'expense_date', p_expense_date));
  ELSE
    SELECT o_expense_date, o_description, o_items, o_total_amount
    INTO v_parsed_date, v_parsed_desc, v_new_items, v_new_total
    FROM private.parse_and_validate_expense_payload(p_items);
  END IF;

  IF v_new_items IS NULL OR v_new_total <= 0 THEN
    RAISE EXCEPTION 'Corrected expense must have at least one line item with a positive amount.';
  END IF;

  -- 5. Delete old items and insert corrected items
  DELETE FROM public.expense_items WHERE transaction_id = p_transaction_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_new_items) LOOP
    INSERT INTO public.expense_items (
      transaction_id,
      line_number,
      amount,
      category,
      description,
      created_at
    ) VALUES (
      p_transaction_id,
      (v_item ->> 'line_number')::int,
      (v_item ->> 'amount')::numeric,
      v_item ->> 'category',
      v_item ->> 'description',
      clock_timestamp()
    );
  END LOOP;

  -- 6. Update transaction header
  UPDATE public.expense_transactions
  SET status = 'corrected',
      updated_by = v_caller_id,
      updated_at = clock_timestamp(),
      expense_date = COALESCE(v_parsed_date, p_expense_date, expense_date),
      description = COALESCE(v_parsed_desc, p_description, description)
  WHERE id = p_transaction_id;

  -- 7. Insert immutable audit log entry
  INSERT INTO public.expense_audit_logs (
    workspace_id,
    transaction_id,
    original_transaction_id,
    action,
    previous_status,
    new_status,
    previous_total_amount,
    new_total_amount,
    reason,
    actor_id,
    metadata,
    created_at
  ) VALUES (
    v_tx.workspace_id,
    p_transaction_id,
    p_transaction_id,
    'corrected',
    v_tx.status,
    'corrected',
    v_prev_total,
    v_new_total,
    p_reason,
    v_caller_id,
    jsonb_build_object(
      'old_items', v_old_items_snapshot,
      'new_items', v_new_items
    ),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'status', 'corrected',
    'previous_total_amount', v_prev_total,
    'new_total_amount', v_new_total,
    'items_count', jsonb_array_length(v_new_items)
  );
END;
$$;
