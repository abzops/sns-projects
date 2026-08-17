-- P2-02A: Post-cancellation immutability final closure
--
-- This forward-only migration closes two Process Instance runtime gaps:
--   1. Evidence cannot be submitted after the parent instance stops running.
--   2. The internal DAG advancement helper independently enforces the same
--      running-instance and non-cancelled-task invariants before mutations.

-- -------------------------------------------------------------------------
-- 1. Process Instance evidence submissions require a running parent
-- -------------------------------------------------------------------------

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
  v_instance       RECORD;
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

  -- Process Instance runtime only. Preserve legacy Task-List behavior.
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance
    FROM public.process_instances
    WHERE id = v_task.process_instance_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;

    IF v_instance.status <> 'running' THEN
      RAISE EXCEPTION 'Process instance is % (must be running to submit evidence).', v_instance.status;
    END IF;

    IF v_task.workflow_state = 'cancelled' THEN
      RAISE EXCEPTION 'Cannot submit evidence: task belongs to a cancelled process instance.';
    END IF;
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

-- -------------------------------------------------------------------------
-- 2. Internal Process Instance DAG advancement guard
-- -------------------------------------------------------------------------

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
  v_instance       RECORD;
  v_task_list      RECORD;
  v_project        RECORD;
  v_workspace_id   uuid;
  v_process_name   text;
  v_done_status_id uuid;
  v_todo_status_id uuid;
  v_recipient      RECORD;
  v_downstream     RECORD;
  v_all_preds_done boolean;
  v_due_date       date;
  v_pending_tasks  integer;
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- =========================================================================
  -- BRANCH 1: NEW PROCESS INSTANCE RUNTIME
  -- =========================================================================
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;

    -- Fail closed before task updates, downstream activation, notifications,
    -- audit insertion, or Process Instance completion.
    IF v_instance.status <> 'running' THEN
      RAISE EXCEPTION 'Process instance is % (must be running to advance workflow).', v_instance.status;
    END IF;

    IF v_task.workflow_state = 'cancelled' THEN
      RAISE EXCEPTION 'Cannot advance task: task belongs to a cancelled process instance.';
    END IF;

    -- Enable bypass only after the Process Instance immutability checks pass.
    PERFORM set_config('sns.process_engine_write', 'on', true);

    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;

    -- Resolve project Done status if project-attached
    IF v_task.project_id IS NOT NULL THEN
      SELECT id INTO v_done_status_id
      FROM public.task_statuses
      WHERE project_id = v_task.project_id AND (system_code = 'done' OR lower(name) = 'done')
      ORDER BY position DESC LIMIT 1;

      IF v_done_status_id IS NULL THEN
        SELECT id INTO v_done_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position DESC LIMIT 1;
      END IF;

      SELECT id INTO v_todo_status_id
      FROM public.task_statuses
      WHERE project_id = v_task.project_id AND (system_code = 'todo' OR lower(name) = 'to do')
      ORDER BY position ASC LIMIT 1;

      IF v_todo_status_id IS NULL THEN
        SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position ASC LIMIT 1;
      END IF;
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
      jsonb_build_object(
        'instance_id', v_instance.id,
        'step_id', v_task.process_step_id,
        'cycle_number', v_task.current_cycle_number
      )
    );

    -- Notify completed Task RACI
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
        'Step has been completed in process "' || v_process_name || '".',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    -- 2. Evaluate all downstream tasks in the process instance (ISOLATED BY process_instance_id)
    FOR v_downstream IN
      SELECT
        t.id AS downstream_task_id,
        t.title AS downstream_title,
        s.id AS step_id
      FROM public.defined_process_step_dependencies d
      JOIN public.defined_process_steps s ON s.id = d.step_id
      JOIN public.tasks t ON t.process_step_id = s.id AND t.process_instance_id = v_instance.id
      WHERE d.depends_on_step_id = v_task.process_step_id
        AND t.workflow_state = 'waiting'
    LOOP
      -- Check if ALL predecessor tasks are completed in THIS process instance
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.defined_process_step_dependencies pred_dep
        JOIN public.tasks pred_task ON pred_task.process_step_id = pred_dep.depends_on_step_id
          AND pred_task.process_instance_id = v_instance.id
        WHERE pred_dep.step_id = v_downstream.step_id
          AND pred_task.workflow_state <> 'completed'
      ) INTO v_all_preds_done;

      IF v_all_preds_done THEN
        -- Decisions 33 & 42: No per-step contractual due dates
        UPDATE public.tasks
        SET workflow_state = 'ready',
            ready_at = now(),
            due_date = NULL,
            status_id = COALESCE(v_todo_status_id, status_id)
        WHERE id = v_downstream.downstream_task_id;

        -- Audit TASK_READY
        INSERT INTO public.process_audit_events (
          workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
        ) VALUES (
          v_workspace_id, v_task.project_id, v_task.task_list_id, v_downstream.downstream_task_id, 'TASK_READY', p_actor_id,
          jsonb_build_object('instance_id', v_instance.id, 'step_id', v_downstream.step_id)
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
            'Dependencies cleared. Task is now ready in process "' || v_process_name || '".',
            'task',
            v_downstream.downstream_task_id,
            v_task.project_id,
            v_downstream.downstream_task_id
          );
        END LOOP;
      END IF;
    END LOOP;

    -- 3. Automatic Process Instance Completion Check
    SELECT count(*) INTO v_pending_tasks
    FROM public.tasks
    WHERE process_instance_id = v_instance.id
      AND process_step_id IS NOT NULL
      AND workflow_state NOT IN ('completed', 'cancelled');

    IF v_pending_tasks = 0 THEN
      UPDATE public.process_instances
      SET status = 'completed',
          completed_at = now()
      WHERE id = v_instance.id;

      INSERT INTO public.process_audit_events (
        workspace_id, project_id, task_list_id, event_type, actor_id, payload
      ) VALUES (
        v_workspace_id, v_task.project_id, v_task.task_list_id, 'PROCESS_COMPLETED', p_actor_id,
        jsonb_build_object('instance_id', v_instance.id, 'instance_name', v_instance.instance_name)
      );

      -- Notify process starter and all participants
      FOR v_recipient IN
        SELECT DISTINCT u_id FROM (
          SELECT v_instance.started_by AS u_id WHERE v_instance.started_by IS NOT NULL
          UNION
          SELECT v_instance.owner_id AS u_id WHERE v_instance.owner_id IS NOT NULL
          UNION
          SELECT ra.user_id AS u_id
          FROM public.tasks t
          JOIN public.task_raci_assignments ra ON ra.task_id = t.id
          WHERE t.process_instance_id = v_instance.id AND ra.user_id IS NOT NULL
        ) sub WHERE u_id IS NOT NULL
      LOOP
        PERFORM private.emit_notification(
          v_workspace_id,
          v_recipient.u_id,
          'process_completed',
          'Process completed: ' || v_process_name,
          'All tasks in process "' || v_process_name || '" have been completed.',
          'process_instance',
          v_instance.id,
          v_task.project_id,
          NULL
        );
      END LOOP;
    END IF;

  -- =========================================================================
  -- BRANCH 2: LEGACY TASK LIST DEFINED PROCESS RUNTIME
  -- =========================================================================
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;

    -- Preserve the legacy runtime bypass behavior.
    PERFORM set_config('sns.process_engine_write', 'on', true);

    -- Resolve project Done status
    SELECT id INTO v_done_status_id
    FROM public.task_statuses
    WHERE project_id = v_task.project_id AND (system_code = 'done' OR lower(name) = 'done')
    ORDER BY position DESC LIMIT 1;

    IF v_done_status_id IS NULL THEN
      SELECT id INTO v_done_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position DESC LIMIT 1;
    END IF;

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

    -- 2. Evaluate all downstream tasks in the task list
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
  END IF;
END;
$$;

-- Internal helper execution is restricted to trusted backend/database roles.
REVOKE ALL ON FUNCTION private.complete_task_and_advance(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.complete_task_and_advance(uuid, uuid) TO service_role, postgres;
