-- SNS Projects — Enforce Deterministic Kanban Ordering Migration
-- Upgrades reorder_kanban_tasks RPC to require complete source & destination arrays.
-- Strict SECURITY INVOKER: Runs as authenticated caller, fully enforcing existing RLS policies.

-- 1. Drop older 3-argument signature if present
DROP FUNCTION IF EXISTS public.reorder_kanban_tasks(uuid, uuid, uuid[]);

-- 2. Create updated 4-argument atomic reorder function
CREATE OR REPLACE FUNCTION public.reorder_kanban_tasks(
  p_task_id uuid,
  p_new_status_id uuid,
  p_source_task_ids uuid[],
  p_destination_task_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_task RECORD;
  v_dest_status RECORD;
  v_project_id uuid;
  v_old_status_id uuid;
  v_ordered_ids uuid[];
  v_db_source_ids uuid[];
  v_db_dest_ids uuid[];
  v_db_same_ids uuid[];
  v_diff_count integer;
  v_index integer;
  v_target_id uuid;
  v_source_len integer;
  v_dest_len integer;
BEGIN
  -- 1. Validate the moved task exists and retrieve project_id & status_id (under RLS)
  SELECT id, project_id, status_id, milestone_id, task_list_id
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found or caller lacks permission', p_task_id;
  END IF;

  v_project_id := v_task.project_id;
  v_old_status_id := v_task.status_id;

  -- 2. Validate destination status exists and belongs to the same project
  SELECT id, project_id, name, system_code
  INTO v_dest_status
  FROM public.task_statuses
  WHERE id = p_new_status_id AND project_id = v_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target status % not found in project %', p_new_status_id, v_project_id;
  END IF;

  -- 3. Check for duplicates in source array
  IF p_source_task_ids IS NOT NULL AND array_length(p_source_task_ids, 1) > 0 THEN
    SELECT count(*) - count(DISTINCT tid)
    INTO v_diff_count
    FROM unnest(p_source_task_ids) AS tid;

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'Duplicate task ID found in source task array';
    END IF;
  END IF;

  -- 4. Check for duplicates in destination array
  IF p_destination_task_ids IS NOT NULL AND array_length(p_destination_task_ids, 1) > 0 THEN
    SELECT count(*) - count(DISTINCT tid)
    INTO v_diff_count
    FROM unnest(p_destination_task_ids) AS tid;

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'Duplicate task ID found in destination task array';
    END IF;
  END IF;

  -- =========================================================================
  -- CASE A: SAME-COLUMN REORDER (v_old_status_id = p_new_status_id)
  -- =========================================================================
  IF v_old_status_id = p_new_status_id THEN
    v_ordered_ids := COALESCE(p_destination_task_ids, p_source_task_ids);

    IF v_ordered_ids IS NULL OR array_length(v_ordered_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Same-column reorder requires non-empty ordered task array';
    END IF;

    -- Validate moved task is in array
    IF NOT (p_task_id = ANY(v_ordered_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in reorder array', p_task_id;
    END IF;

    -- Lock and retrieve all existing tasks in this status
    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = v_old_status_id
      FOR UPDATE
    ) INTO v_db_same_ids;

    -- Validate count equality
    IF array_length(v_ordered_ids, 1) <> array_length(v_db_same_ids, 1) THEN
      RAISE EXCEPTION 'Submitted task list count (%) does not match database count (%) for status %',
        array_length(v_ordered_ids, 1), array_length(v_db_same_ids, 1), v_old_status_id;
    END IF;

    -- Validate set equality (every submitted id must belong to the same project & status)
    SELECT count(*)
    INTO v_diff_count
    FROM unnest(v_ordered_ids) AS tid
    WHERE NOT (tid = ANY(v_db_same_ids));

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'One or more task IDs in reorder array do not belong to status % in project %',
        v_old_status_id, v_project_id;
    END IF;

    -- Atomically assign positions 1000, 2000, 3000...
    FOR v_index IN 1..array_length(v_ordered_ids, 1) LOOP
      v_target_id := v_ordered_ids[v_index];
      UPDATE public.tasks
      SET position = v_index * 1000,
          updated_at = now()
      WHERE id = v_target_id;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'source_status_id', v_old_status_id,
      'destination_status_id', p_new_status_id,
      'project_id', v_project_id,
      'same_column', true,
      'reordered_count', array_length(v_ordered_ids, 1)
    );

  -- =========================================================================
  -- CASE B: CROSS-COLUMN REORDER (v_old_status_id <> p_new_status_id)
  -- =========================================================================
  ELSE
    IF p_destination_task_ids IS NULL OR array_length(p_destination_task_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Cross-column move requires non-empty destination task array containing moved task';
    END IF;

    -- Moved task MUST NOT appear in final source array
    IF p_source_task_ids IS NOT NULL AND p_task_id = ANY(p_source_task_ids) THEN
      RAISE EXCEPTION 'Moved task % must not be present in final source task array', p_task_id;
    END IF;

    -- Moved task MUST appear in final destination array
    IF NOT (p_task_id = ANY(p_destination_task_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in destination task array', p_task_id;
    END IF;

    -- Lock and retrieve current source tasks in DB
    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = v_old_status_id
      FOR UPDATE
    ) INTO v_db_source_ids;

    -- Lock and retrieve current destination tasks in DB
    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = p_new_status_id
      FOR UPDATE
    ) INTO v_db_dest_ids;

    v_source_len := COALESCE(array_length(p_source_task_ids, 1), 0);
    v_dest_len := array_length(p_destination_task_ids, 1);

    -- Validate source set equality: (p_source_task_ids UNION p_task_id) = v_db_source_ids
    IF (v_source_len + 1) <> array_length(v_db_source_ids, 1) THEN
      RAISE EXCEPTION 'Source task count mismatch (expected %, got DB %)',
        v_source_len + 1, array_length(v_db_source_ids, 1);
    END IF;

    IF v_source_len > 0 THEN
      SELECT count(*)
      INTO v_diff_count
      FROM unnest(p_source_task_ids) AS tid
      WHERE NOT (tid = ANY(v_db_source_ids));

      IF v_diff_count > 0 THEN
        RAISE EXCEPTION 'Source task array contains IDs not present in DB source column';
      END IF;
    END IF;

    -- Validate destination set equality: (v_db_dest_ids UNION p_task_id) = p_destination_task_ids
    IF v_dest_len <> (array_length(v_db_dest_ids, 1) + 1) THEN
      RAISE EXCEPTION 'Destination task count mismatch (expected %, got DB % + 1)',
        v_dest_len, array_length(v_db_dest_ids, 1);
    END IF;

    SELECT count(*)
    INTO v_diff_count
    FROM unnest(p_destination_task_ids) AS tid
    WHERE tid <> p_task_id AND NOT (tid = ANY(v_db_dest_ids));

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'Destination task array contains invalid sibling IDs';
    END IF;

    -- 1. Update status_id for the moved task
    UPDATE public.tasks
    SET status_id = p_new_status_id,
        updated_at = now()
    WHERE id = p_task_id;

    -- 2. Renumber source column (1000, 2000, 3000...)
    IF v_source_len > 0 THEN
      FOR v_index IN 1..v_source_len LOOP
        UPDATE public.tasks
        SET position = v_index * 1000,
            updated_at = now()
        WHERE id = p_source_task_ids[v_index];
      END LOOP;
    END IF;

    -- 3. Renumber destination column (1000, 2000, 3000...)
    FOR v_index IN 1..v_dest_len LOOP
      UPDATE public.tasks
      SET position = v_index * 1000,
          updated_at = now()
      WHERE id = p_destination_task_ids[v_index];
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'source_status_id', v_old_status_id,
      'destination_status_id', p_new_status_id,
      'project_id', v_project_id,
      'same_column', false,
      'source_count', v_source_len,
      'destination_count', v_dest_len
    );
  END IF;
END;
$$;

-- 3. Revoke all from PUBLIC and anon; Grant to authenticated only
REVOKE ALL ON FUNCTION public.reorder_kanban_tasks(uuid, uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_kanban_tasks(uuid, uuid, uuid[], uuid[]) TO authenticated;
