-- SNS Projects — DP-1-D.1: Authorization Integrity & Process Version FK Index Hotfix
-- 1. Restores canonical project_admin authority across Task Lists, Tasks, and RACI.
-- 2. Enforces that ordinary workspace members CANNOT delete Task Lists (owner/admin/project_admin/system_admin only).
-- 3. Adds the correctly ordered covering index for fk_task_lists_process_version.

-- ============================================================================
-- 1. COVERING INDEX FOR FK fk_task_lists_process_version
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_task_lists_process_version_fk
  ON public.task_lists (defined_process_version_id, defined_process_id);


-- ============================================================================
-- 2. TASK LIST RLS POLICIES
-- ============================================================================

-- 2.1 task_lists_insert_member: owner, admin, member OR project_admin OR system_admin (custom only)
DROP POLICY IF EXISTS "task_lists_insert_member" ON public.task_lists;
CREATE POLICY "task_lists_insert_member"
  ON public.task_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (
    task_list_type = 'custom'
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id)
      )) IN ('owner', 'admin', 'member')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id),
        'project_admin'
      ))
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id),
        'system_admin'
      ))
    )
  );

-- 2.2 task_lists_delete_member: owner, admin OR project_admin OR system_admin (custom only, ordinary member excluded)
DROP POLICY IF EXISTS "task_lists_delete_member" ON public.task_lists;
CREATE POLICY "task_lists_delete_member"
  ON public.task_lists
  FOR DELETE
  TO authenticated
  USING (
    task_list_type = 'custom'
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id)
      )) IN ('owner', 'admin')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id),
        'project_admin'
      ))
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = task_lists.project_id),
        'system_admin'
      ))
    )
  );


-- ============================================================================
-- 3. TASK RLS POLICIES
-- ============================================================================

-- 3.1 tasks_insert_member: owner, admin, member OR project_admin OR system_admin (custom only)
DROP POLICY IF EXISTS "tasks_insert_member" ON public.tasks;
CREATE POLICY "tasks_insert_member"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    process_step_id IS NULL
    AND defined_process_version_id IS NULL
    AND workflow_state IS NULL
    AND (
      task_list_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.task_lists tl
        WHERE tl.id = tasks.task_list_id AND tl.task_list_type = 'custom'
      )
    )
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id)
      )) IN ('owner', 'admin', 'member')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id),
        'project_admin'
      ))
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id),
        'system_admin'
      ))
    )
  );

-- 3.2 tasks_delete_member: owner, admin, member OR project_admin OR system_admin (custom only)
DROP POLICY IF EXISTS "tasks_delete_member" ON public.tasks;
CREATE POLICY "tasks_delete_member"
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (
    process_step_id IS NULL
    AND (
      (SELECT private.get_user_workspace_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id)
      )) IN ('owner', 'admin', 'member')
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id),
        'project_admin'
      ))
      OR
      (SELECT private.has_system_role(
        (SELECT p.workspace_id FROM public.projects p WHERE p.id = tasks.project_id),
        'system_admin'
      ))
    )
  );


-- ============================================================================
-- 4. TASK RACI RLS POLICIES
-- ============================================================================

-- 4.1 task_raci_insert_member: owner, admin, member OR project_admin OR system_admin (custom tasks only)
DROP POLICY IF EXISTS "task_raci_insert_member" ON public.task_raci_assignments;
CREATE POLICY "task_raci_insert_member"
  ON public.task_raci_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'project_admin'))
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  );

-- 4.2 task_raci_update_member: owner, admin, member OR project_admin OR system_admin (custom tasks only)
DROP POLICY IF EXISTS "task_raci_update_member" ON public.task_raci_assignments;
CREATE POLICY "task_raci_update_member"
  ON public.task_raci_assignments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'project_admin'))
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'project_admin'))
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  );

-- 4.3 task_raci_delete_member: owner, admin, member OR project_admin OR system_admin (custom tasks only)
DROP POLICY IF EXISTS "task_raci_delete_member" ON public.task_raci_assignments;
CREATE POLICY "task_raci_delete_member"
  ON public.task_raci_assignments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND t.process_step_id IS NULL
        AND (
          (SELECT private.get_user_workspace_role(p.workspace_id)) IN ('owner', 'admin', 'member')
          OR
          (SELECT private.has_system_role(p.workspace_id, 'project_admin'))
          OR
          (SELECT private.has_system_role(p.workspace_id, 'system_admin'))
        )
    )
  );
