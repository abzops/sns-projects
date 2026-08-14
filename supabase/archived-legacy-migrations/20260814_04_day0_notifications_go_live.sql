-- ============================================================================
-- Migration: 20260814_04_day0_notifications_go_live.sql
-- Release 3: Day-0 In-App Notifications, Realtime & Safe Performance Hardening
-- ============================================================================

BEGIN;

-- ── 1. Safe Performance & Covering Foreign Key Indexes ──────────────────────

-- Update notifications_type_check to allow Day-0 hierarchy & RACI notification types
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'task_assigned',
    'task_accountable',
    'task_consulted',
    'task_informed',
    'raci_changed',
    'task_status_changed',
    'subtask_assigned',
    'project_status_changed',
    'system'
  ));

-- Single-column FKs for PostgREST embedding support (with ON DELETE RESTRICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_milestone_id_fkey' AND table_name = 'tasks'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_milestone_id_fkey
      FOREIGN KEY (milestone_id)
      REFERENCES public.milestones(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_task_list_id_fkey' AND table_name = 'tasks'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_task_list_id_fkey
      FOREIGN KEY (task_list_id)
      REFERENCES public.task_lists(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Covering indexes
CREATE INDEX IF NOT EXISTS idx_task_lists_milestone_proj ON public.task_lists(milestone_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_hierarchy_covering ON public.tasks(task_list_id, milestone_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone_proj ON public.tasks(milestone_id, project_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

-- ── 2. RLS auth.uid() Query Optimization ───────────────────────────────────

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── 3. Realtime Publication Configuration ──────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications' AND schemaname = 'public'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ── 4. Internal Notification Emission Helper (Private Schema) ───────────────

CREATE OR REPLACE FUNCTION private.emit_notification(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_type         text,
  p_title        text,
  p_message      text,
  p_entity_type  text,
  p_entity_id    uuid,
  p_project_id   uuid,
  p_task_id      uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Deduplication check: ignore if an unread notification with identical parameters exists created in last 10 seconds
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND type = p_type
      AND title = p_title
      AND COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_read = false
      AND created_at > (now() - interval '10 seconds')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    workspace_id,
    user_id,
    type,
    title,
    message,
    entity_type,
    entity_id,
    project_id,
    task_id,
    is_read,
    created_at
  ) VALUES (
    p_workspace_id,
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_entity_type,
    p_entity_id,
    p_project_id,
    p_task_id,
    false,
    now()
  );
END;
$$;

-- Revoke execute on emit_notification from public/anon/authenticated
REVOKE ALL ON FUNCTION private.emit_notification(uuid, uuid, text, text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.emit_notification(uuid, uuid, text, text, text, text, uuid, uuid, uuid) TO postgres, service_role;

-- ── 5. Event A: Task RACI Assigned Trigger ─────────────────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_raci_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task_title      text;
  v_project_id      uuid;
  v_workspace_id    uuid;
  v_project_name    text;
  v_milestone_name  text;
  v_task_list_name  text;
  v_hierarchy_path  text;
  v_title           text;
  v_type            text;
  v_message         text;
  v_dept_member     RECORD;
BEGIN
  -- Resolve task and hierarchy context
  SELECT 
    t.title,
    t.project_id,
    p.workspace_id,
    p.name,
    m.name,
    tl.name
  INTO 
    v_task_title,
    v_project_id,
    v_workspace_id,
    v_project_name,
    v_milestone_name,
    v_task_list_name
  FROM public.tasks t
  JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.milestones m ON m.id = t.milestone_id
  LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
  WHERE t.id = NEW.task_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Build hierarchy context string
  IF v_milestone_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_milestone_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  -- Title and notification type based on RACI role
  IF NEW.raci_role = 'R' THEN
    v_title := 'Task assigned to you';
    v_type  := 'task_assigned';
  ELSIF NEW.raci_role = 'A' THEN
    v_title := 'You are accountable for a task';
    v_type  := 'task_accountable';
  ELSIF NEW.raci_role = 'C' THEN
    v_title := 'Your input is requested';
    v_type  := 'task_consulted';
  ELSIF NEW.raci_role = 'I' THEN
    v_title := 'You are following a task';
    v_type  := 'task_informed';
  ELSE
    v_title := 'Task updated';
    v_type  := 'task_raci_update';
  END IF;

  v_message := '"' || v_task_title || '" in ' || v_hierarchy_path;

  -- If assigned directly to a user
  IF NEW.user_id IS NOT NULL THEN
    PERFORM private.emit_notification(
      v_workspace_id,
      NEW.user_id,
      v_type,
      v_title,
      v_message,
      'task',
      NEW.task_id,
      v_project_id,
      NEW.task_id
    );
  END IF;

  -- If assigned to a department, notify active members of that department
  IF NEW.department_id IS NOT NULL THEN
    FOR v_dept_member IN
      SELECT dm.user_id
      FROM public.department_memberships dm
      WHERE dm.department_id = NEW.department_id
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_dept_member.user_id,
        v_type,
        v_title,
        v_message || ' (via Department assignment)',
        'task',
        NEW.task_id,
        v_project_id,
        NEW.task_id
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raci_assigned ON public.task_raci_assignments;
CREATE TRIGGER trg_raci_assigned
  AFTER INSERT ON public.task_raci_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_raci_assigned();

-- ── 6. Event B: Task Status Change Trigger ──────────────────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_task_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status_name     text;
  v_workspace_id    uuid;
  v_project_name    text;
  v_milestone_name  text;
  v_task_list_name  text;
  v_hierarchy_path  text;
  v_title           text;
  v_message         text;
  v_recipient       RECORD;
  v_actor_id        uuid;
BEGIN
  -- Check if status actually changed
  IF OLD.status_id IS NOT DISTINCT FROM NEW.status_id THEN
    RETURN NEW;
  END IF;

  -- Get status name
  SELECT name INTO v_status_name FROM public.task_statuses WHERE id = NEW.status_id;

  -- Resolve project and hierarchy
  SELECT 
    p.workspace_id,
    p.name,
    m.name,
    tl.name
  INTO 
    v_workspace_id,
    v_project_name,
    v_milestone_name,
    v_task_list_name
  FROM public.projects p
  LEFT JOIN public.milestones m ON m.id = NEW.milestone_id
  LEFT JOIN public.task_lists tl ON tl.id = NEW.task_list_id
  WHERE p.id = NEW.project_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_milestone_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_milestone_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  v_title   := 'Task status updated: ' || COALESCE(v_status_name, 'Updated');
  v_message := '"' || NEW.title || '" moved to ' || COALESCE(v_status_name, 'new status') || ' in ' || v_hierarchy_path;

  -- Optional actor exclusion
  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  -- Notify all distinct Responsible (R), Accountable (A), and Informed (I) users
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      -- Direct user RACI assignments
      SELECT ra.user_id AS u_id
      FROM public.task_raci_assignments ra
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'A', 'I')
        AND ra.user_id IS NOT NULL

      UNION

      -- Department RACI assignments (active members)
      SELECT dm.user_id AS u_id
      FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'I')
        AND ra.department_id IS NOT NULL
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true

      UNION

      -- Primary task assignee if set
      SELECT NEW.assignee_id AS u_id
      WHERE NEW.assignee_id IS NOT NULL
    ) sub
    WHERE u_id IS NOT NULL
      AND (v_actor_id IS NULL OR u_id <> v_actor_id)
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'task_status_changed',
      v_title,
      v_message,
      'task',
      NEW.id,
      NEW.project_id,
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_status_changed ON public.tasks;
CREATE TRIGGER trg_task_status_changed
  AFTER UPDATE OF status_id ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_task_status_changed();

-- ── 7. Event C: Subtask Assigned Trigger ────────────────────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_subtask_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_task_title text;
  v_project_id        uuid;
  v_workspace_id      uuid;
  v_project_name      text;
  v_milestone_name    text;
  v_task_list_name    text;
  v_hierarchy_path    text;
  v_title             text;
  v_message           text;
  v_actor_id          uuid;
BEGIN
  -- Only trigger if assignee is set and changed
  IF NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN
    RETURN NEW;
  END IF;

  -- Resolve parent task and project info
  SELECT 
    t.title,
    t.project_id,
    p.workspace_id,
    p.name,
    m.name,
    tl.name
  INTO 
    v_parent_task_title,
    v_project_id,
    v_workspace_id,
    v_project_name,
    v_milestone_name,
    v_task_list_name
  FROM public.tasks t
  JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.milestones m ON m.id = t.milestone_id
  LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
  WHERE t.id = NEW.task_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_milestone_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_milestone_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  v_title   := 'Subtask assigned to you';
  v_message := '"' || NEW.title || '" under task "' || v_parent_task_title || '" in ' || v_hierarchy_path;

  PERFORM private.emit_notification(
    v_workspace_id,
    NEW.assignee_id,
    'subtask_assigned',
    v_title,
    v_message,
    'subtask',
    NEW.id,
    v_project_id,
    NEW.task_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subtask_assigned ON public.subtasks;
CREATE TRIGGER trg_subtask_assigned
  AFTER INSERT OR UPDATE OF assignee_id ON public.subtasks
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_subtask_assigned();

COMMIT;
