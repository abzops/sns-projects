-- ============================================================================
-- Migration: 20260819131603_p5_01_expense_execution_runtime.sql
-- Description: P5-01 Expense Execution Runtime & Audit APIs
--   1. Schema extensions: cycle_number on expense_transactions,
--      original_transaction_id + metadata on expense_audit_logs.
--   2. Atomic ordinary task completion with optional expense.
--   3. Defined Process step completion with optional expense & rework accumulation.
--   4. Controlled Expense Correction, Void, and Admin Hard-Delete Tombstone APIs.
--   5. Public SECURITY INVOKER wrappers with zero Security Advisor warnings.
-- ============================================================================

-- ── 1. SCHEMA EXTENSIONS ─────────────────────────────────────────────────────

-- 1.1 Process cycle provenance on expense_transactions
ALTER TABLE public.expense_transactions
  ADD COLUMN IF NOT EXISTS cycle_number integer NULL;

CREATE INDEX IF NOT EXISTS idx_expense_transactions_cycle
  ON public.expense_transactions (task_id, cycle_number);

-- 1.2 Original transaction identity & immutable metadata on expense_audit_logs
ALTER TABLE public.expense_audit_logs
  ADD COLUMN IF NOT EXISTS original_transaction_id uuid NULL;

ALTER TABLE public.expense_audit_logs
  ADD COLUMN IF NOT EXISTS metadata jsonb NULL DEFAULT '{}'::jsonb;

-- 1.3 Add rework_instructions column to task_approval_cycles if missing
ALTER TABLE public.task_approval_cycles
  ADD COLUMN IF NOT EXISTS rework_instructions text NULL;

-- 1.4 Update chk_task_approval_cycle_decision to allow process instance steps without individual due dates
ALTER TABLE public.task_approval_cycles
  DROP CONSTRAINT IF EXISTS chk_task_approval_cycle_decision;

ALTER TABLE public.task_approval_cycles
  ADD CONSTRAINT chk_task_approval_cycle_decision CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND rejection_reason IS NULL AND new_due_date IS NULL)
    OR
    (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NULL AND new_due_date IS NULL)
    OR
    (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '')
  );

-- 1.5 Update notifications_type_check to include rework_required
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'task_assigned'::text, 'task_accountable'::text, 'task_consulted'::text, 'task_informed'::text,
      'raci_changed'::text, 'task_status_changed'::text, 'subtask_assigned'::text, 'project_status_changed'::text,
      'system'::text, 'process_task_ready'::text, 'process_task_completed'::text, 'consultation_required'::text,
      'approval_required'::text, 'task_rework_required'::text, 'rework_required'::text, 'process_completed'::text
    ])
  );

-- Backfill existing audit rows
UPDATE public.expense_audit_logs
SET original_transaction_id = transaction_id
WHERE original_transaction_id IS NULL AND transaction_id IS NOT NULL;

-- Default fallback if any exist without transaction_id
UPDATE public.expense_audit_logs
SET original_transaction_id = id
WHERE original_transaction_id IS NULL;

ALTER TABLE public.expense_audit_logs
  ALTER COLUMN original_transaction_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_audit_logs_orig_tx
  ON public.expense_audit_logs (original_transaction_id);

-- ── 2. PRIVATE PAYLOAD PARSER & VALIDATOR ────────────────────────────────────

CREATE OR REPLACE FUNCTION private.parse_and_validate_expense_payload(
  p_payload jsonb,
  OUT o_expense_date date,
  OUT o_description text,
  OUT o_items jsonb,
  OUT o_total_amount numeric(15,2)
)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_amount numeric(15,2);
  v_cat text;
  v_desc text;
  v_line_no int := 0;
  v_normalized jsonb := '[]'::jsonb;
  v_sum numeric(15,2) := 0.00;
  v_date_str text;
BEGIN
  IF p_payload IS NULL OR p_payload = '{}'::jsonb THEN
    o_expense_date := NULL;
    o_description := NULL;
    o_items := NULL;
    o_total_amount := 0.00;
    RETURN;
  END IF;

  -- 1. Parse & validate expense_date
  v_date_str := p_payload ->> 'expense_date';
  IF v_date_str IS NOT NULL AND btrim(v_date_str) <> '' THEN
    BEGIN
      o_expense_date := v_date_str::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid expense_date "%": must be a valid date formatted YYYY-MM-DD', v_date_str;
    END;
  ELSE
    o_expense_date := CURRENT_DATE;
  END IF;

  o_description := p_payload ->> 'description';

  -- 2. Parse & validate line items (Mode A: single total OR Mode B: itemized array)
  IF p_payload ? 'items' AND jsonb_typeof(p_payload -> 'items') = 'array' THEN
    IF jsonb_array_length(p_payload -> 'items') = 0 THEN
      RAISE EXCEPTION 'Expense items array cannot be empty';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload -> 'items') LOOP
      v_line_no := v_line_no + 1;
      BEGIN
        v_amount := (v_item ->> 'amount')::numeric;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Expense item at line % has non-numeric amount "%"', v_line_no, (v_item ->> 'amount');
      END;

      IF v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION 'Expense item amount must be a positive number (> 0) at line %', v_line_no;
      END IF;

      v_cat := v_item ->> 'category';
      v_desc := v_item ->> 'description';

      v_normalized := v_normalized || jsonb_build_object(
        'line_number', v_line_no,
        'amount', v_amount,
        'category', v_cat,
        'description', v_desc
      );
      v_sum := v_sum + v_amount;
    END LOOP;

  ELSIF p_payload ? 'amount' THEN
    BEGIN
      v_amount := (p_payload ->> 'amount')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Expense amount "%" is not a valid number', (p_payload ->> 'amount');
    END;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Expense amount must be a positive number (> 0)';
    END IF;

    v_cat := p_payload ->> 'category';
    v_desc := COALESCE(p_payload ->> 'item_description', o_description);

    v_normalized := jsonb_build_array(
      jsonb_build_object(
        'line_number', 1,
        'amount', v_amount,
        'category', v_cat,
        'description', v_desc
      )
    );
    v_sum := v_amount;

  ELSE
    RAISE EXCEPTION 'Invalid expense payload: must provide either "amount" or "items" array with positive amounts';
  END IF;

  o_items := v_normalized;
  o_total_amount := v_sum;
END;
$$;

-- ── 3. PRIVATE EXPENSE INSERTION HELPER ──────────────────────────────────────

CREATE OR REPLACE FUNCTION private.insert_expense_transaction_internal(
  p_workspace_id uuid,
  p_task_id      uuid,
  p_expense_date date,
  p_description  text,
  p_items        jsonb,
  p_actor_id     uuid,
  p_cycle_number integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx_id uuid;
  v_item jsonb;
  v_total_amount numeric(15,2) := 0.00;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot insert expense transaction with zero items';
  END IF;

  -- 1. Insert transaction header
  INSERT INTO public.expense_transactions (
    workspace_id,
    task_id,
    expense_date,
    description,
    status,
    created_by,
    updated_by,
    cycle_number,
    created_at,
    updated_at
  ) VALUES (
    p_workspace_id,
    p_task_id,
    COALESCE(p_expense_date, CURRENT_DATE),
    p_description,
    'active',
    p_actor_id,
    p_actor_id,
    p_cycle_number,
    clock_timestamp(),
    clock_timestamp()
  ) RETURNING id INTO v_tx_id;

  -- 2. Insert normalized expense items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.expense_items (
      transaction_id,
      line_number,
      amount,
      category,
      description,
      created_at
    ) VALUES (
      v_tx_id,
      (v_item ->> 'line_number')::int,
      (v_item ->> 'amount')::numeric,
      v_item ->> 'category',
      v_item ->> 'description',
      clock_timestamp()
    );
    v_total_amount := v_total_amount + (v_item ->> 'amount')::numeric;
  END LOOP;

  -- 3. Insert immutable audit log entry
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
    p_workspace_id,
    v_tx_id,
    v_tx_id,
    'created',
    NULL,
    'active',
    NULL,
    v_total_amount,
    NULL,
    p_actor_id,
    jsonb_build_object('items', p_items),
    clock_timestamp()
  );

  RETURN v_tx_id;
END;
$$;

-- ── 4. ORDINARY TASK COMPLETION + EXPENSE API ────────────────────────────────

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

  -- 2. Verify active workspace membership
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_caller_id
      AND wm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Caller is not an active member of workspace %', v_workspace_id;
  END IF;

  -- 3. Exact operational Task authorization check (OV1 access model)
  v_is_authorized := (
    private.has_global_operational_visibility(v_workspace_id)
    OR v_task.assignee_id = v_caller_id
    OR v_task.owner_id = v_caller_id
    OR v_project_owner_id = v_caller_id
    OR EXISTS (
      SELECT 1 FROM public.task_raci_assignments ra
      WHERE ra.task_id = p_task_id
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
    RAISE EXCEPTION 'Caller is not authorized to complete task % under operational visibility rules.', p_task_id;
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

-- ── 5. DEFINED PROCESS STEP COMPLETION + EXPENSE API ─────────────────────────

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

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- Post-cancellation task state guard
  IF v_task.workflow_state = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot modify task: task belongs to a cancelled process instance.';
  END IF;

  -- Retry / Actionable state guard
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

  -- Parse expense payload (if provided)
  SELECT o_expense_date, o_description, o_items, o_total_amount
  INTO v_parsed_date, v_parsed_desc, v_parsed_items, v_total_amount
  FROM private.parse_and_validate_expense_payload(p_expense_payload);

  IF v_parsed_items IS NOT NULL THEN
    -- Ensure idempotent single expense entry per cycle
    IF EXISTS (
      SELECT 1 FROM public.expense_transactions
      WHERE task_id = p_task_id
        AND cycle_number = p_cycle_number
        AND status IN ('active', 'corrected')
    ) THEN
      RAISE EXCEPTION 'An active expense transaction has already been recorded for process cycle %.', p_cycle_number;
    END IF;

    -- Insert expense transaction with cycle provenance
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
    jsonb_build_object(
      'step_id', v_step.id,
      'cycle_number', p_cycle_number,
      'transaction_id', v_tx_id,
      'total_expense', COALESCE(v_total_amount, 0.00)
    )
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
      'cycle_number', p_cycle_number,
      'transaction_id', v_tx_id,
      'total_expense', COALESCE(v_total_amount, 0.00)
    );
  ELSE
    -- Directly advance the task and DAG
    PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

    RETURN jsonb_build_object(
      'status', 'completed',
      'task_id', p_task_id,
      'cycle_number', p_cycle_number,
      'transaction_id', v_tx_id,
      'total_expense', COALESCE(v_total_amount, 0.00)
    );
  END IF;
END;
$$;

-- ── 6. CONTROLLED EXPENSE CORRECTION API ──────────────────────────────────────

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

  -- 4. Parse & validate corrected items payload
  SELECT o_expense_date, o_description, o_items, o_total_amount
  INTO v_parsed_date, v_parsed_desc, v_new_items, v_new_total
  FROM private.parse_and_validate_expense_payload(jsonb_build_object('items', p_items));

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
      expense_date = COALESCE(p_expense_date, expense_date),
      description = COALESCE(p_description, description)
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
    btrim(p_reason),
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
    'previous_total', v_prev_total,
    'new_total', v_new_total
  );
END;
$$;

-- ── 7. CONTROLLED EXPENSE VOID API ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.void_expense_transaction_internal(
  p_transaction_id uuid,
  p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id  uuid;
  v_tx         record;
  v_prev_total numeric(15,2);
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'transaction_id is required.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Void reason is required and cannot be empty.';
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
    RAISE EXCEPTION 'Expense transaction is already voided.';
  END IF;

  -- 2. Authorization check: Budget Manager or Finance Operator
  IF NOT (
    private.can_manage_budgets(v_tx.workspace_id, v_caller_id)
    OR private.is_finance_operator(v_tx.workspace_id, v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Caller is not authorized to void expenses in this workspace.';
  END IF;

  -- 3. Calculate previous total
  SELECT COALESCE(SUM(amount), 0.00) INTO v_prev_total
  FROM public.expense_items
  WHERE transaction_id = p_transaction_id;

  -- 4. Mark transaction as voided
  UPDATE public.expense_transactions
  SET status = 'voided',
      updated_by = v_caller_id,
      updated_at = clock_timestamp()
  WHERE id = p_transaction_id;

  -- 5. Insert immutable audit log entry
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
    created_at
  ) VALUES (
    v_tx.workspace_id,
    p_transaction_id,
    p_transaction_id,
    'voided',
    v_tx.status,
    'voided',
    v_prev_total,
    0.00,
    btrim(p_reason),
    v_caller_id,
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'status', 'voided',
    'previous_total', v_prev_total,
    'effective_total', 0.00
  );
END;
$$;

-- ── 8. CONTROLLED ADMIN HARD-DELETE / TOMBSTONE API ───────────────────────────

CREATE OR REPLACE FUNCTION private.hard_delete_expense_transaction_internal(
  p_transaction_id uuid,
  p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id        uuid;
  v_tx               record;
  v_prev_total       numeric(15,2);
  v_items_snapshot   jsonb;
  v_tombstone_record jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'transaction_id is required.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Hard delete reason is required and cannot be empty.';
  END IF;

  -- 1. Look up transaction
  SELECT * INTO v_tx
  FROM public.expense_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense transaction % not found.', p_transaction_id;
  END IF;

  -- 2. Authorization check: Admin / Executive ONLY (Finance Operator alone is denied)
  IF NOT private.can_manage_budgets(v_tx.workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Only Workspace Owner, Workspace Admin, CEO, or CTO may hard-delete expenses.';
  END IF;

  -- 3. Capture full immutable snapshot
  SELECT
    COALESCE(SUM(amount), 0.00),
    jsonb_agg(row_to_json(ei) ORDER BY line_number)
  INTO v_prev_total, v_items_snapshot
  FROM public.expense_items ei
  WHERE ei.transaction_id = p_transaction_id;

  v_tombstone_record := jsonb_build_object(
    'transaction', row_to_json(v_tx),
    'items', v_items_snapshot
  );

  -- 4. Insert immutable audit tombstone FIRST
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
    'hard_deleted',
    v_tx.status,
    NULL,
    v_prev_total,
    0.00,
    btrim(p_reason),
    v_caller_id,
    jsonb_build_object('snapshot', v_tombstone_record),
    clock_timestamp()
  );

  -- 5. Delete transaction (cascades to items; sets audit transaction_id to NULL while original_transaction_id survives)
  DELETE FROM public.expense_transactions WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_transaction_id', p_transaction_id,
    'previous_total', v_prev_total
  );
END;
$$;

-- ── 9. PUBLIC SECURITY INVOKER WRAPPERS & PRIVILEGES ─────────────────────────

-- 9.1 complete_task_with_expense
CREATE OR REPLACE FUNCTION public.complete_task_with_expense(
  p_task_id         uuid,
  p_expense_payload jsonb DEFAULT NULL,
  p_notes           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.complete_task_with_expense_internal(p_task_id, p_expense_payload, p_notes);
END;
$$;

-- 9.2 complete_responsible_step_with_expense
CREATE OR REPLACE FUNCTION public.complete_responsible_step_with_expense(
  p_task_id         uuid,
  p_cycle_number    integer,
  p_notes           text DEFAULT NULL,
  p_expense_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.complete_responsible_step_with_expense_internal(p_task_id, p_cycle_number, p_notes, p_expense_payload);
END;
$$;

-- 9.3 correct_expense_transaction
CREATE OR REPLACE FUNCTION public.correct_expense_transaction(
  p_transaction_id uuid,
  p_items          jsonb,
  p_reason         text,
  p_description    text DEFAULT NULL,
  p_expense_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.correct_expense_transaction_internal(p_transaction_id, p_items, p_reason, p_description, p_expense_date);
END;
$$;

-- 9.4 void_expense_transaction
CREATE OR REPLACE FUNCTION public.void_expense_transaction(
  p_transaction_id uuid,
  p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.void_expense_transaction_internal(p_transaction_id, p_reason);
END;
$$;

-- 9.5 hard_delete_expense_transaction
CREATE OR REPLACE FUNCTION public.hard_delete_expense_transaction(
  p_transaction_id uuid,
  p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.hard_delete_expense_transaction_internal(p_transaction_id, p_reason);
END;
$$;

-- ── 10. GRANTS & REVOCATIONS ──────────────────────────────────────────────────

-- Private functions
REVOKE ALL ON FUNCTION private.parse_and_validate_expense_payload(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.insert_expense_transaction_internal(uuid, uuid, date, text, jsonb, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.complete_task_with_expense_internal(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.complete_responsible_step_with_expense_internal(uuid, integer, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.correct_expense_transaction_internal(uuid, jsonb, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.void_expense_transaction_internal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.hard_delete_expense_transaction_internal(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.parse_and_validate_expense_payload(jsonb) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.insert_expense_transaction_internal(uuid, uuid, date, text, jsonb, uuid, integer) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.complete_task_with_expense_internal(uuid, jsonb, text) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.complete_responsible_step_with_expense_internal(uuid, integer, text, jsonb) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.correct_expense_transaction_internal(uuid, jsonb, text, text, date) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.void_expense_transaction_internal(uuid, text) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.hard_delete_expense_transaction_internal(uuid, text) TO authenticated, service_role, postgres;

-- Public wrappers
REVOKE ALL ON FUNCTION public.complete_task_with_expense(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_responsible_step_with_expense(uuid, integer, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_expense_transaction(uuid, jsonb, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_expense_transaction(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hard_delete_expense_transaction(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_task_with_expense(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_responsible_step_with_expense(uuid, integer, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_expense_transaction(uuid, jsonb, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_expense_transaction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_expense_transaction(uuid, text) TO authenticated;
