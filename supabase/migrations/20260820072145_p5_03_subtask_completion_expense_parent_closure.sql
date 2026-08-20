-- Migration: 20260820072145_p5_03_subtask_completion_expense_parent_closure.sql
-- Description: P5-03 Subtask Completion, Expense Capture & Parent Closure Convergence
--              1. Adds subtask_id traceability to expense_transactions and expense_audit_logs.
--              2. Establishes subtask_id parent-task invariant trigger.
--              3. Updates get_task_closure_state to incorporate active subtasks.
--              4. Guards direct browser subtask status='done' updates (requires RPC).
--              5. Implements subtask parent auto-completion and reopen/insertion triggers.
--              6. Adds atomic complete_subtask_with_expense RPC.
--              7. Converges production state safely without resetting data.

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: SCHEMA EXTENSIONS & INTEGRITY
-- ══════════════════════════════════════════════════════════════════════════════

-- 1.1 Add subtask_id to expense_transactions with ON DELETE RESTRICT
-- Subtasks with expense history cannot be deleted, preserving ledger source traceability.
ALTER TABLE public.expense_transactions
  ADD COLUMN IF NOT EXISTS subtask_id uuid REFERENCES public.subtasks(id) ON DELETE RESTRICT;

-- 1.2 Add subtask_id to expense_audit_logs for permanent audit preservation
ALTER TABLE public.expense_audit_logs
  ADD COLUMN IF NOT EXISTS subtask_id uuid;

-- 1.3 Create index on expense_transactions.subtask_id
CREATE INDEX IF NOT EXISTS idx_expense_transactions_subtask
  ON public.expense_transactions (subtask_id)
  WHERE subtask_id IS NOT NULL;

-- 1.4 Invariant trigger: When subtask_id is provided, referenced subtask.task_id must equal expense_transactions.task_id
CREATE OR REPLACE FUNCTION private.trg_fn_validate_expense_transaction_subtask()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subtask_task_id uuid;
BEGIN
  IF NEW.subtask_id IS NOT NULL THEN
    SELECT st.task_id INTO v_subtask_task_id
    FROM public.subtasks st
    WHERE st.id = NEW.subtask_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referenced subtask % does not exist.', NEW.subtask_id;
    END IF;

    IF v_subtask_task_id IS DISTINCT FROM NEW.task_id THEN
      RAISE EXCEPTION 'Subtask % belongs to task %, not expense task %.', NEW.subtask_id, v_subtask_task_id, NEW.task_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_transactions_validate_subtask ON public.expense_transactions;
CREATE TRIGGER trg_expense_transactions_validate_subtask
  BEFORE INSERT OR UPDATE OF subtask_id, task_id ON public.expense_transactions
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_validate_expense_transaction_subtask();

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: STATUS RESOLUTION & EXPENSE INSERTION HELPERS
-- ══════════════════════════════════════════════════════════════════════════════

-- 2.1 In Progress status resolver
CREATE OR REPLACE FUNCTION private.resolve_project_in_progress_status(p_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status_id uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve In Progress status without a project.';
  END IF;

  -- 1. Canonical system_code = 'in_progress'
  SELECT ts.id
  INTO v_status_id
  FROM public.task_statuses ts
  WHERE ts.project_id = p_project_id
    AND ts.system_code = 'in_progress'
  ORDER BY ts.position ASC, ts.id
  LIMIT 1;

  -- 2. Name matching 'in progress', 'in_progress', 'doing', 'in-progress'
  IF v_status_id IS NULL THEN
    SELECT ts.id
    INTO v_status_id
    FROM public.task_statuses ts
    WHERE ts.project_id = p_project_id
      AND pg_catalog.lower(pg_catalog.btrim(ts.name)) IN ('in progress', 'in_progress', 'doing', 'in-progress')
    ORDER BY ts.position ASC, ts.id
    LIMIT 1;
  END IF;

  -- 3. First non-done status in the project
  IF v_status_id IS NULL THEN
    SELECT ts.id
    INTO v_status_id
    FROM public.task_statuses ts
    WHERE ts.project_id = p_project_id
      AND ts.system_code <> 'done'
      AND pg_catalog.lower(pg_catalog.btrim(ts.name)) <> 'done'
    ORDER BY ts.position ASC, ts.id
    LIMIT 1;
  END IF;

  IF v_status_id IS NULL THEN
    RAISE EXCEPTION 'Canonical In Progress status is not configured for project %.', p_project_id;
  END IF;

  RETURN v_status_id;
END;
$$;

-- 2.2 Update insert_expense_transaction_internal with optional p_subtask_id
CREATE OR REPLACE FUNCTION private.insert_expense_transaction_internal(
  p_workspace_id uuid,
  p_task_id      uuid,
  p_expense_date date,
  p_description  text,
  p_items        jsonb,
  p_actor_id     uuid,
  p_cycle_number integer DEFAULT NULL,
  p_subtask_id   uuid DEFAULT NULL
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
    subtask_id,
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
    p_subtask_id,
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
    subtask_id,
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
    p_subtask_id,
    'created',
    NULL,
    'active',
    NULL,
    v_total_amount,
    NULL,
    p_actor_id,
    jsonb_build_object('items', p_items, 'subtask_id', p_subtask_id),
    clock_timestamp()
  );

  RETURN v_tx_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: EXTENDED TASK CLOSURE STATE (CHILDREN + PROCESSES + SUBTASKS)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.get_task_closure_state(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task                    record;
  v_done_status_id          uuid;
  v_ordinary_child_count    integer;
  v_ordinary_closed_count   integer;
  v_attached_process_count  integer;
  v_completed_process_count integer;
  v_cancelled_process_count integer;
  v_subtask_count           integer;
  v_done_subtask_count      integer;
  v_cancelled_subtask_count integer;
  v_active_subtask_count    integer;
  v_open_subtask_count      integer;
  v_has_dependencies        boolean;
  v_all_closed              boolean;
BEGIN
  SELECT t.id, t.project_id
  INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %.', p_task_id;
  END IF;

  v_done_status_id := private.resolve_project_done_status(v_task.project_id);

  -- 1. Ordinary Child Tasks
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE t.status_id = v_done_status_id)::integer
  INTO v_ordinary_child_count, v_ordinary_closed_count
  FROM public.tasks t
  WHERE t.parent_task_id = p_task_id
    AND t.process_instance_id IS NULL
    AND t.process_step_id IS NULL;

  -- 2. Attached Process Instances
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE pi.status = 'completed')::integer,
    pg_catalog.count(*) FILTER (WHERE pi.status = 'cancelled')::integer
  INTO v_attached_process_count, v_completed_process_count, v_cancelled_process_count
  FROM public.process_instances pi
  WHERE pi.placement_type = 'task'
    AND pi.parent_task_id = p_task_id;

  -- 3. Subtasks (public.subtasks)
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE st.status = 'done')::integer,
    pg_catalog.count(*) FILTER (WHERE st.status = 'cancelled')::integer
  INTO v_subtask_count, v_done_subtask_count, v_cancelled_subtask_count
  FROM public.subtasks st
  WHERE st.task_id = p_task_id;

  v_active_subtask_count := v_subtask_count - v_cancelled_subtask_count;
  v_open_subtask_count := v_subtask_count - v_done_subtask_count - v_cancelled_subtask_count;

  -- A task has dependencies if it has child tasks, attached processes, or active subtasks
  v_has_dependencies := (v_ordinary_child_count + v_attached_process_count + v_active_subtask_count) > 0;

  -- All dependencies are closed when:
  -- 1) Has dependencies
  -- 2) All ordinary child tasks are Done
  -- 3) All attached processes are completed or cancelled
  -- 4) All active subtasks are Done (i.e. zero open subtasks)
  v_all_closed := v_has_dependencies
    AND v_ordinary_child_count = v_ordinary_closed_count
    AND v_attached_process_count = (v_completed_process_count + v_cancelled_process_count)
    AND v_open_subtask_count = 0;

  RETURN pg_catalog.jsonb_build_object(
    'task_id', p_task_id,
    'ordinary_child_count', v_ordinary_child_count,
    'ordinary_closed_child_count', v_ordinary_closed_count,
    'ordinary_open_child_count', v_ordinary_child_count - v_ordinary_closed_count,
    'attached_process_count', v_attached_process_count,
    'completed_process_count', v_completed_process_count,
    'cancelled_process_count', v_cancelled_process_count,
    'open_process_count', v_attached_process_count - v_completed_process_count - v_cancelled_process_count,
    'subtask_count', v_subtask_count,
    'done_subtask_count', v_done_subtask_count,
    'cancelled_subtask_count', v_cancelled_subtask_count,
    'active_subtask_count', v_active_subtask_count,
    'open_subtask_count', v_open_subtask_count,
    'has_dependencies', v_has_dependencies,
    'all_closed', v_all_closed
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: SUBTASK GUARDS & PARENT SYNCHRONIZATION TRIGGERS
-- ══════════════════════════════════════════════════════════════════════════════

-- 4.1 Prevent direct browser Data API update of subtask status to 'done'
CREATE OR REPLACE FUNCTION private.trg_fn_guard_subtask_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    IF pg_catalog.current_setting('sns.internal_subtask_completion', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Direct update of subtask status to "done" is prohibited. Subtasks must be completed via complete_subtask_with_expense.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subtasks_guard_status ON public.subtasks;
CREATE TRIGGER trg_subtasks_guard_status
  BEFORE UPDATE ON public.subtasks
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_guard_subtask_status_transition();

-- 4.2 Subtask Parent Synchronization Trigger (Auto-complete & Reopen)
CREATE OR REPLACE FUNCTION private.trg_fn_subtask_parent_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_task_id        uuid;
  v_parent                record;
  v_done_status_id        uuid;
  v_in_progress_status_id uuid;
  v_actor_id              uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_parent_task_id := OLD.task_id;
  ELSE
    v_parent_task_id := NEW.task_id;
  END IF;

  IF v_parent_task_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Look up parent task FOR UPDATE
  SELECT t.id, t.project_id, t.status_id, t.process_instance_id, t.process_step_id
  INTO v_parent
  FROM public.tasks t
  WHERE t.id = v_parent_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Defined step Tasks and standalone Process containers have their own authoritative lifecycle
  IF v_parent.process_instance_id IS NOT NULL OR v_parent.process_step_id IS NOT NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_done_status_id := private.resolve_project_done_status(v_parent.project_id);

  -- Case 1: Inserting new active work OR Reopening a subtask under a currently Done parent task
  -- Requirement 14 & 15: Parent task returns to In Progress
  IF (
    (TG_OP = 'INSERT' AND NEW.status NOT IN ('done', 'cancelled'))
    OR (TG_OP = 'UPDATE' AND OLD.status IN ('done', 'cancelled') AND NEW.status NOT IN ('done', 'cancelled'))
  ) THEN
    IF v_parent.status_id = v_done_status_id THEN
      v_in_progress_status_id := private.resolve_project_in_progress_status(v_parent.project_id);
      UPDATE public.tasks
      SET status_id = v_in_progress_status_id,
          updated_at = pg_catalog.now()
      WHERE id = v_parent.id;
    END IF;
  END IF;

  -- Case 2: Subtask completed OR cancelled OR deleted -> re-evaluate auto-completion of parent task
  IF (
    (TG_OP = 'UPDATE' AND NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
    OR (TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
    OR (TG_OP = 'DELETE' AND OLD.status NOT IN ('done', 'cancelled'))
  ) THEN
    PERFORM private.try_auto_complete_parent_task(
      v_parent_task_id,
      v_actor_id,
      TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status = 'cancelled')
    );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_subtasks_parent_sync ON public.subtasks;
CREATE TRIGGER trg_subtasks_parent_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.subtasks
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_subtask_parent_sync();

-- 4.3 Update parent task closure guard error message
CREATE OR REPLACE FUNCTION private.trg_fn_guard_parent_task_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_done_status_id        uuid;
  v_parent                record;
  v_parent_done_status_id uuid;
  v_state                 jsonb;
  v_old_is_ordinary       boolean := false;
  v_new_is_ordinary       boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_is_ordinary := NEW.process_instance_id IS NULL AND NEW.process_step_id IS NULL;
  ELSE
    v_old_is_ordinary := OLD.process_instance_id IS NULL AND OLD.process_step_id IS NULL;
    v_new_is_ordinary := NEW.process_instance_id IS NULL AND NEW.process_step_id IS NULL;
  END IF;

  -- Creating/attaching an ordinary child beneath a closed parent, or reopening
  -- an existing ordinary child while its parent remains closed, is forbidden.
  IF v_new_is_ordinary AND NEW.parent_task_id IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR NOT v_old_is_ordinary
       OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id
       OR NEW.status_id IS DISTINCT FROM OLD.status_id
     ) THEN
    SELECT t.*
    INTO v_parent
    FROM public.tasks t
    WHERE t.id = NEW.parent_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent task not found: %.', NEW.parent_task_id;
    END IF;

    v_parent_done_status_id := private.resolve_project_done_status(v_parent.project_id);
    IF v_parent.status_id = v_parent_done_status_id THEN
      RAISE EXCEPTION 'Cannot attach or reopen an ordinary child under Done parent task %. Reopen the parent first.', NEW.parent_task_id;
    END IF;
  END IF;

  -- A normal parent may be moved to Done manually only when every dependency is closed.
  IF TG_OP = 'UPDATE' AND v_new_is_ordinary AND NEW.project_id IS NOT NULL THEN
    v_done_status_id := private.resolve_project_done_status(NEW.project_id);

    IF NEW.status_id = v_done_status_id
       AND OLD.status_id IS DISTINCT FROM NEW.status_id THEN
      v_state := private.get_task_closure_state(NEW.id);
      IF COALESCE((v_state ->> 'has_dependencies')::boolean, false)
         AND NOT COALESCE((v_state ->> 'all_closed')::boolean, false) THEN
        RAISE EXCEPTION 'Cannot complete parent task % while subtasks, child tasks or attached processes remain open.', NEW.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: ATOMIC SUBTASK COMPLETION RPC (INVOKER + HARDENED DEFINER)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.complete_subtask_with_expense_internal(
  p_subtask_id      uuid,
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
  v_subtask          record;
  v_project          record;
  v_workspace_id     uuid;
  v_project_owner_id uuid;
  v_is_authorized    boolean;
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

  IF p_subtask_id IS NULL THEN
    RAISE EXCEPTION 'subtask_id is required.';
  END IF;

  -- 1. Look up subtask and parent task FOR UPDATE
  SELECT st.*, t.project_id, t.assignee_id AS task_assignee_id, t.owner_id AS task_owner_id,
         t.process_instance_id, t.process_step_id
  INTO v_subtask
  FROM public.subtasks st
  JOIN public.tasks t ON t.id = st.task_id
  WHERE st.id = p_subtask_id
  FOR UPDATE OF st;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subtask not found: %', p_subtask_id;
  END IF;

  -- 2. Retry / Idempotency check
  IF v_subtask.status = 'done' THEN
    IF p_expense_payload IS NOT NULL AND p_expense_payload <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Cannot record expense on an already completed subtask.';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'subtask_id', p_subtask_id,
      'task_id', v_subtask.task_id,
      'status', 'done',
      'is_retry', true,
      'transaction_id', NULL,
      'total_expense', 0.00
    );
  END IF;

  -- 3. Resolve Project and Workspace
  SELECT p.workspace_id, p.owner_id AS project_owner_id
  INTO v_project
  FROM public.projects p
  WHERE p.id = v_subtask.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found for subtask %', p_subtask_id;
  END IF;

  v_workspace_id := v_project.workspace_id;
  v_project_owner_id := v_project.project_owner_id;

  -- 4. Verify workspace mutation capability (Active tenant + Owner/Admin/Member/ProjectAdmin/SysAdmin)
  IF NOT private.can_mutate_operational_workspace(v_workspace_id, v_caller_id) THEN
    RAISE EXCEPTION 'Caller does not have mutation capability in workspace %', v_workspace_id;
  END IF;

  -- 5. Exact Subtask / Task authorization check (OV1 access model)
  v_is_authorized := (
    -- Global operational visibility through approved System Role
    EXISTS (
      SELECT 1 FROM public.user_system_roles usr
      WHERE usr.workspace_id = v_workspace_id
        AND usr.user_id = v_caller_id
        AND usr.role IN ('ceo', 'cto', 'project_admin', 'system_admin')
    )
    -- Project Owner
    OR (v_project_owner_id IS NOT NULL AND v_project_owner_id = v_caller_id)
    -- Subtask direct assignee
    OR (v_subtask.assignee_id IS NOT NULL AND v_subtask.assignee_id = v_caller_id)
    -- Subtask creator
    OR (v_subtask.created_by IS NOT NULL AND v_subtask.created_by = v_caller_id)
    -- Task direct assignee
    OR (v_subtask.task_assignee_id IS NOT NULL AND v_subtask.task_assignee_id = v_caller_id)
    -- Task owner
    OR (v_subtask.task_owner_id IS NOT NULL AND v_subtask.task_owner_id = v_caller_id)
    -- Task RACI Responsible (R), direct or active department-targeted
    OR EXISTS (
      SELECT 1 FROM public.task_raci_assignments ra
      WHERE ra.task_id = v_subtask.task_id
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
    -- Active workspace member on ordinary tasks
    OR (
      v_subtask.process_instance_id IS NULL AND v_subtask.process_step_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = v_workspace_id
          AND wm.user_id = v_caller_id
          AND wm.status = 'active'
          AND wm.role IN ('owner', 'admin', 'member')
      )
    )
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Caller is not authorized to complete subtask %', p_subtask_id;
  END IF;

  -- 6. Parse and validate expense payload if provided
  SELECT o_expense_date, o_description, o_items, o_total_amount
  INTO v_parsed_date, v_parsed_desc, v_parsed_items, v_total_amount
  FROM private.parse_and_validate_expense_payload(p_expense_payload);

  -- 7. Insert expense transaction if payload provided
  -- task_id = parent Task ID, subtask_id = exact Subtask ID, cycle_number = NULL
  IF v_parsed_items IS NOT NULL THEN
    v_tx_id := private.insert_expense_transaction_internal(
      p_workspace_id => v_workspace_id,
      p_task_id      => v_subtask.task_id,
      p_expense_date => v_parsed_date,
      p_description  => v_parsed_desc,
      p_items        => v_parsed_items,
      p_actor_id     => v_caller_id,
      p_cycle_number => NULL,
      p_subtask_id   => p_subtask_id
    );
  END IF;

  -- 8. Transition subtask status to 'done' (with internal bypass config)
  PERFORM pg_catalog.set_config('sns.internal_subtask_completion', 'true', true);

  UPDATE public.subtasks
  SET status = 'done',
      updated_at = pg_catalog.now()
  WHERE id = p_subtask_id;

  -- 9. Re-evaluate parent task closure (try auto-completing parent task)
  PERFORM private.try_auto_complete_parent_task(v_subtask.task_id, v_caller_id, false);

  -- 10. Return completion result
  RETURN jsonb_build_object(
    'success', true,
    'subtask_id', p_subtask_id,
    'task_id', v_subtask.task_id,
    'status', 'done',
    'transaction_id', v_tx_id,
    'total_expense', COALESCE(v_total_amount, 0.00),
    'notes', p_notes
  );
END;
$$;

-- 5.2 Public SECURITY INVOKER wrapper
CREATE OR REPLACE FUNCTION public.complete_subtask_with_expense(
  p_subtask_id      uuid,
  p_expense_payload jsonb DEFAULT NULL,
  p_notes           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN private.complete_subtask_with_expense_internal(
    p_subtask_id,
    p_expense_payload,
    p_notes
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6: GRANTS & PERMISSIONS
-- ══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION private.resolve_project_in_progress_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.resolve_project_in_progress_status(uuid) TO service_role, postgres;

REVOKE ALL ON FUNCTION private.insert_expense_transaction_internal(uuid, uuid, date, text, jsonb, uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.insert_expense_transaction_internal(uuid, uuid, date, text, jsonb, uuid, integer, uuid) TO service_role, postgres;

REVOKE ALL ON FUNCTION private.get_task_closure_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_task_closure_state(uuid) TO service_role, postgres;

REVOKE ALL ON FUNCTION private.complete_subtask_with_expense_internal(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_subtask_with_expense_internal(uuid, jsonb, text) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.complete_subtask_with_expense(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_subtask_with_expense(uuid, jsonb, text) TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.complete_subtask_with_expense(uuid, jsonb, text) IS
  'P5-03: Atomically completes a subtask with optional operational expense and evaluates parent task closure.';

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7: PRODUCTION STATE CONVERGENCE
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_task                  record;
  v_done_status_id        uuid;
  v_in_progress_status_id uuid;
  v_closure_state         jsonb;
  v_reopened_count        integer := 0;
  v_completed_count       integer := 0;
BEGIN
  -- 1. Reopen Tasks that are currently Done but have open subtasks
  FOR v_task IN
    SELECT DISTINCT t.id, t.project_id, t.status_id
    FROM public.tasks t
    JOIN public.subtasks st ON st.task_id = t.id
    WHERE t.project_id IS NOT NULL
      AND t.process_instance_id IS NULL
      AND t.process_step_id IS NULL
      AND st.status NOT IN ('done', 'cancelled')
  LOOP
    v_done_status_id := private.resolve_project_done_status(v_task.project_id);
    IF v_task.status_id = v_done_status_id THEN
      v_in_progress_status_id := private.resolve_project_in_progress_status(v_task.project_id);
      UPDATE public.tasks
      SET status_id = v_in_progress_status_id,
          updated_at = pg_catalog.now()
      WHERE id = v_task.id;
      
      v_reopened_count := v_reopened_count + 1;
    END IF;
  END LOOP;

  -- 2. Auto-complete Tasks that have dependencies where ALL dependencies are terminal, but Task is not Done
  FOR v_task IN
    SELECT DISTINCT t.id, t.project_id, t.status_id
    FROM public.tasks t
    WHERE t.project_id IS NOT NULL
      AND t.process_instance_id IS NULL
      AND t.process_step_id IS NULL
      AND (
        EXISTS (SELECT 1 FROM public.subtasks st WHERE st.task_id = t.id)
        OR EXISTS (SELECT 1 FROM public.tasks c WHERE c.parent_task_id = t.id)
        OR EXISTS (SELECT 1 FROM public.process_instances pi WHERE pi.placement_type = 'task' AND pi.parent_task_id = t.id)
      )
  LOOP
    v_done_status_id := private.resolve_project_done_status(v_task.project_id);
    IF v_task.status_id <> v_done_status_id THEN
      v_closure_state := private.get_task_closure_state(v_task.id);
      IF COALESCE((v_closure_state ->> 'has_dependencies')::boolean, false)
         AND COALESCE((v_closure_state ->> 'all_closed')::boolean, false) THEN
        PERFORM private.try_auto_complete_parent_task(v_task.id, NULL, false);
        v_completed_count := v_completed_count + 1;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'P5-03 State Convergence Complete: % tasks reopened to In Progress, % tasks auto-completed.', v_reopened_count, v_completed_count;
END;
$$;
