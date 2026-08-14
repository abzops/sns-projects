-- ============================================================================
-- SNS PROJECTS V2 - DAY-0: RELEASE 2.5 HIERARCHY ALIGNMENT
-- Migration: 20260814_03_hierarchy_alignment.sql
--
-- Canonical Hierarchy:
--   Workspace -> Project -> Milestone -> Task List -> Task -> Subtask
--
-- Key Rules & Safeguards:
--   1. Strict composite foreign keys enforce project/milestone/task-list consistency.
--   2. RESTRICT delete prevents accidental deletion of non-empty milestones/task lists.
--   3. Nullable milestone_id/task_list_id preserves legacy tasks (Uncategorized Tasks).
--   4. Check constraint ensures structured tasks have both milestone_id & task_list_id.
--   5. Subtasks are execution breakdowns of tasks with lightweight status/assignee.
--   6. Hardened RLS policies ensure Viewers remain strictly read-only.
-- ============================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: CREATE MILESTONES TABLE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  start_date date,
  end_date date,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestones_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_milestones_project_pos ON public.milestones(project_id, position);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: CREATE TASK LISTS TABLE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.task_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Composite FK to milestones(id, project_id) guarantees project_id matches milestone.project_id
  -- ON DELETE RESTRICT prevents deleting milestone while task_lists exist
  CONSTRAINT fk_task_lists_milestone FOREIGN KEY (milestone_id, project_id)
    REFERENCES public.milestones(id, project_id) ON DELETE RESTRICT,
  -- Direct project cascade if whole project is deleted
  CONSTRAINT fk_task_lists_project FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT task_lists_id_milestone_project_unique UNIQUE (id, milestone_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_task_lists_milestone_pos ON public.task_lists(milestone_id, position);
CREATE INDEX IF NOT EXISTS idx_task_lists_project ON public.task_lists(project_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: ALTER TASKS TABLE (ADD HIERARCHY REFERENCES & COMPOSITE FK)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS milestone_id uuid,
  ADD COLUMN IF NOT EXISTS task_list_id uuid;

-- Check constraint: either both are null (legacy/uncategorized) or both are populated
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_hierarchy_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_hierarchy_check CHECK (
    (milestone_id IS NULL AND task_list_id IS NULL)
    OR
    (milestone_id IS NOT NULL AND task_list_id IS NOT NULL)
  );

-- Composite FK to task_lists(id, milestone_id, project_id) guarantees:
--   1. task_list belongs to the task_lists table
--   2. milestone_id matches task_list's milestone_id
--   3. project_id matches task_list's project_id
-- ON DELETE RESTRICT prevents deleting task_list while tasks exist
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS fk_tasks_task_list;
ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_task_list FOREIGN KEY (task_list_id, milestone_id, project_id)
    REFERENCES public.task_lists(id, milestone_id, project_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON public.tasks(milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON public.tasks(task_list_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: CREATE SUBTASKS TABLE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  start_date date,
  due_date date,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subtasks_task_pos ON public.subtasks(task_id, position);
CREATE INDEX IF NOT EXISTS idx_subtasks_assignee ON public.subtasks(assignee_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: ROW LEVEL SECURITY POLICIES
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 5a. milestones ──────────────────────────────────────────────────────────

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "milestones_select_member" ON public.milestones;
CREATE POLICY "milestones_select_member" ON public.milestones FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
      AND private.is_workspace_active_member(p.workspace_id)
  ));

DROP POLICY IF EXISTS "milestones_insert_member" ON public.milestones;
CREATE POLICY "milestones_insert_member" ON public.milestones FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));

DROP POLICY IF EXISTS "milestones_update_member" ON public.milestones;
CREATE POLICY "milestones_update_member" ON public.milestones FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));

DROP POLICY IF EXISTS "milestones_delete_member" ON public.milestones;
CREATE POLICY "milestones_delete_member" ON public.milestones FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));


-- ── 5b. task_lists ──────────────────────────────────────────────────────────

ALTER TABLE public.task_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_lists_select_member" ON public.task_lists;
CREATE POLICY "task_lists_select_member" ON public.task_lists FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = task_lists.project_id
      AND private.is_workspace_active_member(p.workspace_id)
  ));

DROP POLICY IF EXISTS "task_lists_insert_member" ON public.task_lists;
CREATE POLICY "task_lists_insert_member" ON public.task_lists FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = task_lists.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));

DROP POLICY IF EXISTS "task_lists_update_member" ON public.task_lists;
CREATE POLICY "task_lists_update_member" ON public.task_lists FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = task_lists.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = task_lists.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));

DROP POLICY IF EXISTS "task_lists_delete_member" ON public.task_lists;
CREATE POLICY "task_lists_delete_member" ON public.task_lists FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = task_lists.project_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));


-- ── 5c. subtasks ────────────────────────────────────────────────────────────

ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subtasks_select_member" ON public.subtasks;
CREATE POLICY "subtasks_select_member" ON public.subtasks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = subtasks.task_id
      AND private.is_workspace_active_member(p.workspace_id)
  ));

DROP POLICY IF EXISTS "subtasks_insert_member" ON public.subtasks;
CREATE POLICY "subtasks_insert_member" ON public.subtasks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = subtasks.task_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));

DROP POLICY IF EXISTS "subtasks_update_member" ON public.subtasks;
CREATE POLICY "subtasks_update_member" ON public.subtasks FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = subtasks.task_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = subtasks.task_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));

DROP POLICY IF EXISTS "subtasks_delete_member" ON public.subtasks;
CREATE POLICY "subtasks_delete_member" ON public.subtasks FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = subtasks.task_id
      AND (
        private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        OR private.has_system_role(p.workspace_id, 'system_admin')
        OR private.has_system_role(p.workspace_id, 'project_admin')
      )
  ));

COMMIT;
