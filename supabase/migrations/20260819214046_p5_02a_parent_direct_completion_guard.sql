-- Migration: 20260819214046_p5_02a_parent_direct_completion_guard.sql
-- Description: P5-02A: Server-side fail-closed guard preventing direct completion of parent tasks
--              (with child tasks or attached process instances) via complete_task_with_expense_internal.
--              Parent tasks must solely auto-complete via canonical P2-03 trigger engine.

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

  -- 6. Evaluate parent task leaf invariants (P2-03 closure model & Decision 17)
  -- Parent tasks with child tasks or attached processes cannot be completed directly.
  -- Parent completion occurs automatically via trg_tasks_parent_completion_reevaluate when all dependencies complete.
  SELECT * INTO v_closure_state
  FROM private.get_task_closure_state(p_task_id);

  IF COALESCE((v_closure_state ->> 'has_dependencies')::boolean, false) THEN
    RAISE EXCEPTION 'Parent tasks with child dependencies cannot be directly completed. Parent completion occurs automatically when all child tasks and attached processes are completed.';
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
  -- Note: trg_tasks_parent_completion_reevaluate on public.tasks handles
  -- parent auto-completion canonically (P2-03 single ownership).
  UPDATE public.tasks
  SET status_id = v_done_status_id,
      updated_at = clock_timestamp()
  WHERE id = p_task_id;

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

COMMENT ON FUNCTION private.complete_task_with_expense_internal(uuid, jsonb, text) IS
  'P5-02A: Server-side fail-closed guard preventing direct completion of parent tasks (with child tasks or attached processes), preserving canonical P2-03 trigger auto-completion ownership.';
