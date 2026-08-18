-- P2-03: Parent Task completion and Process Instance runtime closure.
--
-- Invariants:
--   * Only ordinary direct children and directly attached Process Instances
--     participate in normal parent Task closure.
--   * Materialized Process step Tasks are never double-counted as children.
--   * A parent with no closure dependencies is never auto-completed.
--   * Running Process Instances block their host; completed/cancelled instances
--     are closed dependencies, but cancelled steps never count as completed.
--   * Standalone Process container Tasks mirror terminal instance state.

CREATE OR REPLACE FUNCTION private.resolve_project_done_status(p_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_done_status_id uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve Done status without a project.';
  END IF;

  SELECT ts.id
  INTO v_done_status_id
  FROM public.task_statuses ts
  WHERE ts.project_id = p_project_id
    AND ts.system_code = 'done'
  ORDER BY ts.position DESC, ts.id
  LIMIT 1;

  IF v_done_status_id IS NULL THEN
    SELECT ts.id
    INTO v_done_status_id
    FROM public.task_statuses ts
    WHERE ts.project_id = p_project_id
      AND pg_catalog.lower(pg_catalog.btrim(ts.name)) = 'done'
    ORDER BY ts.position DESC, ts.id
    LIMIT 1;
  END IF;

  IF v_done_status_id IS NULL THEN
    RAISE EXCEPTION 'Canonical Done status is not configured for project %.', p_project_id;
  END IF;

  RETURN v_done_status_id;
END;
$$;

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
BEGIN
  SELECT t.id, t.project_id
  INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %.', p_task_id;
  END IF;

  v_done_status_id := private.resolve_project_done_status(v_task.project_id);

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE t.status_id = v_done_status_id)::integer
  INTO v_ordinary_child_count, v_ordinary_closed_count
  FROM public.tasks t
  WHERE t.parent_task_id = p_task_id
    AND t.process_instance_id IS NULL
    AND t.process_step_id IS NULL;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE pi.status = 'completed')::integer,
    pg_catalog.count(*) FILTER (WHERE pi.status = 'cancelled')::integer
  INTO v_attached_process_count, v_completed_process_count, v_cancelled_process_count
  FROM public.process_instances pi
  WHERE pi.placement_type = 'task'
    AND pi.parent_task_id = p_task_id;

  RETURN pg_catalog.jsonb_build_object(
    'task_id', p_task_id,
    'ordinary_child_count', v_ordinary_child_count,
    'ordinary_closed_child_count', v_ordinary_closed_count,
    'ordinary_open_child_count', v_ordinary_child_count - v_ordinary_closed_count,
    'attached_process_count', v_attached_process_count,
    'completed_process_count', v_completed_process_count,
    'cancelled_process_count', v_cancelled_process_count,
    'open_process_count', v_attached_process_count - v_completed_process_count - v_cancelled_process_count,
    'has_dependencies', (v_ordinary_child_count + v_attached_process_count) > 0,
    'all_closed',
      (v_ordinary_child_count + v_attached_process_count) > 0
      AND v_ordinary_child_count = v_ordinary_closed_count
      AND v_attached_process_count = v_completed_process_count + v_cancelled_process_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.try_auto_complete_parent_task(
  p_task_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_dependency_removed boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent         record;
  v_done_status_id uuid;
  v_state          jsonb;
  v_workspace_id   uuid;
  v_rows_updated   integer := 0;
BEGIN
  IF p_task_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT t.*
  INTO v_parent
  FROM public.tasks t
  WHERE t.id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Normal Tasks only. Defined step Tasks and standalone Process containers
  -- have their own authoritative lifecycle.
  IF v_parent.process_instance_id IS NOT NULL OR v_parent.process_step_id IS NOT NULL THEN
    RETURN false;
  END IF;

  v_done_status_id := private.resolve_project_done_status(v_parent.project_id);
  IF v_parent.status_id = v_done_status_id THEN
    RETURN false;
  END IF;

  v_state := private.get_task_closure_state(p_task_id);
  IF NOT (
    (
      COALESCE((v_state ->> 'has_dependencies')::boolean, false)
      AND COALESCE((v_state ->> 'all_closed')::boolean, false)
    )
    OR (
      p_dependency_removed
      AND NOT COALESCE((v_state ->> 'has_dependencies')::boolean, false)
    )
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.tasks t
  SET status_id = v_done_status_id,
      updated_at = pg_catalog.now()
  WHERE t.id = p_task_id
    AND t.status_id IS DISTINCT FROM v_done_status_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RETURN false;
  END IF;

  SELECT p.workspace_id
  INTO v_workspace_id
  FROM public.projects p
  WHERE p.id = v_parent.project_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace could not be resolved for parent task %.', p_task_id;
  END IF;

  INSERT INTO public.process_audit_events (
    workspace_id,
    project_id,
    task_list_id,
    task_id,
    event_type,
    actor_id,
    payload
  ) VALUES (
    v_workspace_id,
    v_parent.project_id,
    v_parent.task_list_id,
    p_task_id,
    'PARENT_TASK_AUTO_COMPLETED',
    p_actor_id,
    v_state || pg_catalog.jsonb_build_object(
      'completed_at', pg_catalog.now(),
      'dependency_removed', p_dependency_removed
    )
  );

  RETURN true;
END;
$$;

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

  -- A normal parent may be moved to Done manually only when every dependency
  -- is closed. Leaves remain manually completable and are never auto-closed.
  IF TG_OP = 'UPDATE' AND v_new_is_ordinary AND NEW.project_id IS NOT NULL THEN
    v_done_status_id := private.resolve_project_done_status(NEW.project_id);

    IF NEW.status_id = v_done_status_id
       AND OLD.status_id IS DISTINCT FROM NEW.status_id THEN
      v_state := private.get_task_closure_state(NEW.id);
      IF COALESCE((v_state ->> 'has_dependencies')::boolean, false)
         AND NOT COALESCE((v_state ->> 'all_closed')::boolean, false) THEN
        RAISE EXCEPTION 'Cannot complete parent task % while child tasks or attached processes remain open.', NEW.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_fn_reevaluate_parent_task_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id        uuid := auth.uid();
  v_old_is_ordinary boolean := false;
  v_new_is_ordinary boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_is_ordinary := OLD.process_instance_id IS NULL AND OLD.process_step_id IS NULL;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_is_ordinary := NEW.process_instance_id IS NULL AND NEW.process_step_id IS NULL;
  END IF;

  IF v_old_is_ordinary AND OLD.parent_task_id IS NOT NULL THEN
    PERFORM private.try_auto_complete_parent_task(
      OLD.parent_task_id,
      v_actor_id,
      TG_OP = 'DELETE'
        OR NOT v_new_is_ordinary
        OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id
    );
  END IF;

  IF v_new_is_ordinary AND NEW.parent_task_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NOT v_old_is_ordinary OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id) THEN
    PERFORM private.try_auto_complete_parent_task(NEW.parent_task_id, v_actor_id);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_fn_guard_process_instance_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_host                record;
  v_host_done_status_id uuid;
  v_total_steps         integer;
  v_completed_steps     integer;
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'running' THEN
      RAISE EXCEPTION 'Process Instance may transition to completed only from running.';
    END IF;

    SELECT
      pg_catalog.count(*)::integer,
      pg_catalog.count(*) FILTER (WHERE t.workflow_state = 'completed')::integer
    INTO v_total_steps, v_completed_steps
    FROM public.tasks t
    WHERE t.process_instance_id = NEW.id
      AND t.process_step_id IS NOT NULL;

    IF v_total_steps = 0 OR v_completed_steps <> v_total_steps THEN
      RAISE EXCEPTION 'Cannot complete Process Instance % until every materialized process step is completed.', NEW.id;
    END IF;
  END IF;

  IF NEW.status = 'running'
     AND NEW.placement_type = 'task'
     AND NEW.parent_task_id IS NOT NULL THEN
    SELECT t.*
    INTO v_host
    FROM public.tasks t
    WHERE t.id = NEW.parent_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Host task not found: %.', NEW.parent_task_id;
    END IF;

    v_host_done_status_id := private.resolve_project_done_status(v_host.project_id);
    IF v_host.status_id = v_host_done_status_id THEN
      RAISE EXCEPTION 'Cannot start or move a running Process Instance onto Done host task %. Reopen the host first.', NEW.parent_task_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_fn_sync_process_instance_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id          uuid := auth.uid();
  v_previous_engine   text := pg_catalog.current_setting('sns.process_engine_write', true);
  v_old_host_task_id  uuid;
  v_new_host_task_id  uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.placement_type = 'task' THEN
    v_old_host_task_id := OLD.parent_task_id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.placement_type = 'task' THEN
    v_new_host_task_id := NEW.parent_task_id;
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.placement_type = 'standalone'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.status IN ('completed', 'cancelled') THEN
    PERFORM pg_catalog.set_config('sns.process_engine_write', 'on', true);

    UPDATE public.tasks t
    SET workflow_state = NEW.status,
        workflow_completed_at = CASE
          WHEN NEW.status = 'completed' THEN COALESCE(t.workflow_completed_at, pg_catalog.now())
          ELSE NULL
        END,
        updated_at = pg_catalog.now()
    WHERE t.process_instance_id = NEW.id
      AND t.process_step_id IS NULL
      AND (
        t.workflow_state IS DISTINCT FROM NEW.status
        OR (NEW.status = 'completed' AND t.workflow_completed_at IS NULL)
        OR (NEW.status = 'cancelled' AND t.workflow_completed_at IS NOT NULL)
      );

    PERFORM pg_catalog.set_config(
      'sns.process_engine_write',
      COALESCE(v_previous_engine, ''),
      true
    );
  END IF;

  IF v_old_host_task_id IS NOT NULL THEN
    PERFORM private.try_auto_complete_parent_task(
      v_old_host_task_id,
      v_actor_id,
      TG_OP = 'DELETE' OR v_new_host_task_id IS DISTINCT FROM v_old_host_task_id
    );
  END IF;

  IF v_new_host_task_id IS NOT NULL
     AND v_new_host_task_id IS DISTINCT FROM v_old_host_task_id THEN
    PERFORM private.try_auto_complete_parent_task(v_new_host_task_id, v_actor_id);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_parent_completion_guard ON public.tasks;
CREATE TRIGGER trg_tasks_parent_completion_guard
BEFORE INSERT OR UPDATE OF project_id, parent_task_id, process_instance_id, process_step_id, status_id
ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_guard_parent_task_closure();

DROP TRIGGER IF EXISTS trg_tasks_parent_completion_reevaluate ON public.tasks;
CREATE TRIGGER trg_tasks_parent_completion_reevaluate
AFTER INSERT OR DELETE OR UPDATE OF parent_task_id, process_instance_id, process_step_id, status_id
ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_reevaluate_parent_task_closure();

DROP TRIGGER IF EXISTS trg_process_instances_parent_completion_guard ON public.process_instances;
CREATE TRIGGER trg_process_instances_parent_completion_guard
BEFORE INSERT OR UPDATE OF status, placement_type, parent_task_id
ON public.process_instances
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_guard_process_instance_closure();

DROP TRIGGER IF EXISTS trg_process_instances_parent_completion_sync ON public.process_instances;
CREATE TRIGGER trg_process_instances_parent_completion_sync
AFTER INSERT OR DELETE OR UPDATE OF status, placement_type, parent_task_id
ON public.process_instances
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_sync_process_instance_closure();

REVOKE ALL ON FUNCTION private.resolve_project_done_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_task_closure_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.try_auto_complete_parent_task(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_guard_parent_task_closure() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_reevaluate_parent_task_closure() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_guard_process_instance_closure() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_sync_process_instance_closure() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.resolve_project_done_status(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.get_task_closure_state(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.try_auto_complete_parent_task(uuid, uuid, boolean) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.trg_fn_guard_parent_task_closure() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.trg_fn_reevaluate_parent_task_closure() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.trg_fn_guard_process_instance_closure() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.trg_fn_sync_process_instance_closure() TO service_role, postgres;

COMMENT ON FUNCTION private.get_task_closure_state(uuid) IS
  'P2-03 closure state for ordinary direct children and directly attached Process Instances.';
COMMENT ON FUNCTION private.try_auto_complete_parent_task(uuid, uuid, boolean) IS
  'P2-03 idempotent parent Task auto-completion with immutable audit evidence.';
