-- SNS Projects — Kanban Reordering Atomic RPC Migration
-- Forward migration to support atomic position and status persistence for Kanban Board drag & drop.
-- Strict SECURITY INVOKER: Runs as authenticated caller, fully enforcing existing RLS policies.

CREATE OR REPLACE FUNCTION public.reorder_kanban_tasks(
  p_task_id uuid,
  p_new_status_id uuid,
  p_task_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_task RECORD;
  v_status RECORD;
  v_project_id uuid;
  v_invalid_task_count integer;
  v_index integer;
  v_target_id uuid;
BEGIN
  -- 1. Validate the moved task exists and retrieve its project_id (under RLS)
  SELECT id, project_id, status_id, milestone_id, task_list_id
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found or caller lacks permission', p_task_id;
  END IF;

  v_project_id := v_task.project_id;

  -- 2. Validate destination status exists and belongs to the same project
  SELECT id, project_id, name, system_code
  INTO v_status
  FROM public.task_statuses
  WHERE id = p_new_status_id AND project_id = v_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target status % not found in project %', p_new_status_id, v_project_id;
  END IF;

  -- 3. If task IDs array is provided, validate all belong to the same project
  IF p_task_ids IS NOT NULL AND array_length(p_task_ids, 1) > 0 THEN
    SELECT count(*)
    INTO v_invalid_task_count
    FROM unnest(p_task_ids) AS tid
    LEFT JOIN public.tasks t ON t.id = tid AND t.project_id = v_project_id
    WHERE t.id IS NULL;

    IF v_invalid_task_count > 0 THEN
      RAISE EXCEPTION 'One or more task IDs do not belong to project %', v_project_id;
    END IF;

    -- 4. Atomically update positions with 1000 spacing
    FOR v_index IN 1..array_length(p_task_ids, 1) LOOP
      v_target_id := p_task_ids[v_index];
      
      IF v_target_id = p_task_id THEN
        -- Update both status and position for moved task
        UPDATE public.tasks
        SET status_id = p_new_status_id,
            position = v_index * 1000,
            updated_at = now()
        WHERE id = v_target_id;
      ELSE
        -- Update position for sibling task
        UPDATE public.tasks
        SET position = v_index * 1000,
            updated_at = now()
        WHERE id = v_target_id;
      END IF;
    END LOOP;
  ELSE
    -- Single task status update if no sibling list passed
    UPDATE public.tasks
    SET status_id = p_new_status_id,
        updated_at = now()
    WHERE id = p_task_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'new_status_id', p_new_status_id,
    'project_id', v_project_id,
    'updated_count', COALESCE(array_length(p_task_ids, 1), 1)
  );
END;
$$;

-- Revoke default public execution & explicitly grant to authenticated only
REVOKE ALL ON FUNCTION public.reorder_kanban_tasks(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_kanban_tasks(uuid, uuid, uuid[]) TO authenticated;
