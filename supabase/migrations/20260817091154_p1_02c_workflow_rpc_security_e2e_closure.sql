-- ============================================================================
-- SNS PROJECTS — PACKAGE 1 / P1-02C
-- WORKFLOW RPC SECURITY + SEARCH PATH HARDENING + ZERO ADVISOR WARNS
--
-- Migration: 20260817091154_p1_02c_workflow_rpc_security_e2e_closure.sql
-- Baseline:  20260817072340_p1_02a_process_runtime_execution_security_closure.sql
-- ============================================================================

-- ============================================================================
-- 1. PUBLIC START PROCESS INSTANCE: FIX SEARCH_PATH (SECURITY INVOKER)
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
SET search_path = ''
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
-- 2. PUBLIC GET PROGRESS: FIX SEARCH_PATH (SECURITY INVOKER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_process_instance_progress(p_instance_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
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
-- 3. PRIVATE COMPLETE RESPONSIBLE PART INTERNAL (SECURITY DEFINER)
-- ============================================================================

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
  v_caller_id      uuid;
  v_task           RECORD;
  v_step           RECORD;
  v_instance       RECORD;
  v_task_list      RECORD;
  v_project        RECORD;
  v_workspace_id   uuid;
  v_process_name   text;
  v_is_r           boolean;
  v_unresponded_c  integer;
  v_missing_e      integer;
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
    RAISE EXCEPTION 'Cannot complete: % mandatory evidence item(s) are missing.', v_missing_e;
  END IF;

  -- Record responsible completion
  INSERT INTO public.task_responsible_completions (
    task_id, cycle_number, user_id, notes
  ) VALUES (
    p_task_id, p_cycle_number, v_caller_id, p_notes
  )
  ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET notes = p_notes, completed_at = now();

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

REVOKE ALL ON FUNCTION private.complete_responsible_part_internal(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_responsible_part_internal(uuid, integer, text) TO authenticated, service_role, postgres;

-- ============================================================================
-- 4. PUBLIC COMPLETE RESPONSIBLE PART WRAPPER (SECURITY INVOKER)
-- ============================================================================

DROP FUNCTION IF EXISTS public.complete_responsible_part(uuid, integer, text);

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

-- ============================================================================
-- 5. PRIVATE REJECT PROCESS TASK INTERNAL (SECURITY DEFINER)
-- ============================================================================

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

  IF v_task.workflow_state <> 'in_review' THEN
    RAISE EXCEPTION 'Task must be in review state to be rejected.';
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

  -- Increment cycle number and transition state to rework_required
  UPDATE public.tasks
  SET workflow_state = 'rework_required',
      current_cycle_number = current_cycle_number + 1,
      due_date = v_target_due_date,
      status_id = COALESCE(v_todo_status_id, status_id)
  WHERE id = p_task_id;

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_REJECTED', v_caller_id,
    jsonb_build_object(
      'step_id', v_task.process_step_id,
      'cycle_number', p_cycle_number,
      'reason', p_rejection_reason,
      'new_due_date', v_target_due_date
    )
  );

  -- Notify Responsible (R) users of rework requirement
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
      'process_task_rejected',
      'Rework Required: ' || v_task.title,
      'Task was rejected during review in process "' || v_process_name || '". Reason: ' || p_rejection_reason,
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'rework_required',
    'task_id', p_task_id,
    'new_cycle_number', v_task.current_cycle_number + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION private.reject_process_task_internal(uuid, integer, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.reject_process_task_internal(uuid, integer, text, text, date) TO authenticated, service_role, postgres;

-- ============================================================================
-- 6. PUBLIC REJECT PROCESS TASK WRAPPER (SECURITY INVOKER)
-- ============================================================================

DROP FUNCTION IF EXISTS public.reject_process_task(uuid, integer, text, text, date);

CREATE OR REPLACE FUNCTION public.reject_process_task(
  p_task_id              uuid,
  p_cycle_number         integer,
  p_rejection_reason     text,
  p_rework_instructions  text DEFAULT NULL,
  p_new_due_date         date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.reject_process_task_internal(
    p_task_id,
    p_cycle_number,
    p_rejection_reason,
    p_rework_instructions,
    p_new_due_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_process_task(uuid, integer, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_process_task(uuid, integer, text, text, date) TO authenticated;

-- ============================================================================
-- 7. SUBMIT TASK CONSULTATION GRANT HARDENING
-- ============================================================================

REVOKE ALL ON FUNCTION public.submit_task_consultation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_consultation(uuid, text) TO authenticated;
