-- ============================================================================
-- SNS PROJECTS V2 - DAY-0 PRODUCTION MVP: RELEASE 1
-- Migration: 20260814_01_day0_foundation.sql
-- Description: Adds Departments, User System Roles, Department Memberships,
--              Project Metadata, Task Status Codes, Task RACI Assignments,
--              and Notifications with strict RLS and Helper Functions.
-- ============================================================================

-- ── 1. USER SYSTEM ROLES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_system_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('ceo', 'cto', 'project_admin', 'system_admin')),
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_system_role UNIQUE (workspace_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_system_roles_workspace ON public.user_system_roles (workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_system_roles_user ON public.user_system_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_system_roles_lookup ON public.user_system_roles (workspace_id, user_id, role);


-- ── 2. DEPARTMENTS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.departments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  description  text,
  color        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_department_workspace_code UNIQUE (workspace_id, code)
);

CREATE INDEX IF NOT EXISTS idx_departments_workspace ON public.departments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_departments_code ON public.departments (workspace_id, code);


-- ── 3. DEPARTMENT MEMBERSHIPS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.department_memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('head', 'lead', 'member')),
  is_primary    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_department_member UNIQUE (department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dept_memberships_dept ON public.department_memberships (department_id);
CREATE INDEX IF NOT EXISTS idx_dept_memberships_user ON public.department_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_dept_memberships_workspace ON public.department_memberships (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dept_member_primary
  ON public.department_memberships (workspace_id, user_id)
  WHERE is_primary = true AND is_active = true;


-- ── 4. ENHANCE PROJECTS ──────────────────────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS target_end_date date,
  ADD COLUMN IF NOT EXISTS project_status text NOT NULL DEFAULT 'active' CHECK (project_status IN ('draft', 'planned', 'active', 'on_hold', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS project_priority text NOT NULL DEFAULT 'medium' CHECK (project_priority IN ('low', 'medium', 'high', 'critical'));

-- Backfill owner_id where null
UPDATE public.projects
SET owner_id = created_by
WHERE owner_id IS NULL AND created_by IS NOT NULL;


-- ── 5. ENHANCE TASK STATUSES & ENSURE BLOCKED STATUS ─────────────────────────

ALTER TABLE public.task_statuses
  ADD COLUMN IF NOT EXISTS system_code text CHECK (system_code IS NULL OR system_code IN ('todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'));

-- Backfill system_code on existing statuses safely
UPDATE public.task_statuses
SET system_code = 'todo'
WHERE lower(name) IN ('to do', 'todo', 'backlog', 'not started') AND (system_code IS NULL OR system_code = '');

UPDATE public.task_statuses
SET system_code = 'in_progress'
WHERE lower(name) IN ('in progress', 'in-progress', 'in_progress', 'doing') AND (system_code IS NULL OR system_code = '');

UPDATE public.task_statuses
SET system_code = 'in_review'
WHERE lower(name) IN ('in review', 'in-review', 'in_review', 'review') AND (system_code IS NULL OR system_code = '');

UPDATE public.task_statuses
SET system_code = 'done'
WHERE lower(name) IN ('done', 'completed') AND (system_code IS NULL OR system_code = '');

UPDATE public.task_statuses
SET system_code = 'blocked'
WHERE lower(name) IN ('blocked', 'impediment') AND (system_code IS NULL OR system_code = '');

-- Fallback for any unmapped
UPDATE public.task_statuses
SET system_code = 'todo'
WHERE system_code IS NULL;

-- Ensure every existing project has a Blocked status (position 3) and Done at position 4
DO $$
DECLARE
  proj RECORD;
  has_blocked boolean;
BEGIN
  FOR proj IN SELECT id FROM public.projects LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.task_statuses WHERE project_id = proj.id AND system_code = 'blocked'
    ) INTO has_blocked;

    IF NOT has_blocked THEN
      -- Shift Done to position 4 if it's currently at 3
      UPDATE public.task_statuses
      SET position = 4
      WHERE project_id = proj.id AND system_code = 'done';

      -- Insert Blocked at position 3
      INSERT INTO public.task_statuses (project_id, name, color, position, system_code)
      VALUES (proj.id, 'Blocked', '#ff6666', 3, 'blocked');
    END IF;
  END LOOP;
END $$;

-- Update project status seeder trigger for future projects
CREATE OR REPLACE FUNCTION public.seed_default_statuses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.task_statuses (project_id, name, color, position, system_code)
  VALUES
    (NEW.id, 'To Do',        '#a0a0a0', 0, 'todo'),
    (NEW.id, 'In Progress',  '#8cc9ff', 1, 'in_progress'),
    (NEW.id, 'In Review',    '#ffb020', 2, 'in_review'),
    (NEW.id, 'Blocked',      '#ff6666', 3, 'blocked'),
    (NEW.id, 'Done',         '#60d394', 4, 'done');
  RETURN NEW;
END;
$$;


-- ── 6. TASK RACI ASSIGNMENTS ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_raci_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  raci_role     text NOT NULL CHECK (raci_role IN ('R', 'A', 'C', 'I')),
  user_id       uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Exactly one target must be present: either user_id or department_id
  CONSTRAINT chk_raci_single_target CHECK (
    (user_id IS NOT NULL AND department_id IS NULL)
    OR (user_id IS NULL AND department_id IS NOT NULL)
  ),
  -- Accountable rule: target MUST be a user
  CONSTRAINT chk_raci_accountable_user CHECK (
    raci_role != 'A' OR (user_id IS NOT NULL AND department_id IS NULL)
  )
);

-- At most one Accountable per task
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_raci_accountable
  ON public.task_raci_assignments (task_id)
  WHERE raci_role = 'A';

-- Unique user assignment per role per task
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_raci_user
  ON public.task_raci_assignments (task_id, raci_role, user_id)
  WHERE user_id IS NOT NULL;

-- Unique department assignment per role per task
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_raci_dept
  ON public.task_raci_assignments (task_id, raci_role, department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_raci_task ON public.task_raci_assignments (task_id);
CREATE INDEX IF NOT EXISTS idx_task_raci_user ON public.task_raci_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_task_raci_dept ON public.task_raci_assignments (department_id);


-- Backfill: For every existing task where assignee_id IS NOT NULL, create Responsible (R) assignment
INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id, created_by)
SELECT id, 'R', assignee_id, created_by
FROM public.tasks
WHERE assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;


-- ── 7. NOTIFICATIONS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('task_assigned', 'raci_changed', 'task_status_changed', 'project_status_changed', 'system')),
  title        text NOT NULL,
  message      text,
  entity_type  text,
  entity_id    uuid,
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  task_id      uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  is_read      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_inbox ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON public.notifications (workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_project ON public.notifications (project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_task ON public.notifications (task_id);


-- ── 8. HELPER FUNCTIONS ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_workspace_role(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_active_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_system_role(p_workspace_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_system_roles
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND role = p_role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_administer_workspace(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    public.get_user_workspace_role(p_workspace_id) IN ('owner', 'admin')
    OR public.has_system_role(p_workspace_id, 'system_admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_active_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_system_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_administer_workspace(uuid) TO authenticated;


-- ── 9. ROW LEVEL SECURITY POLICIES ───────────────────────────────────────────

-- user_system_roles
ALTER TABLE public.user_system_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_system_roles_select" ON public.user_system_roles;
DROP POLICY IF EXISTS "user_system_roles_manage" ON public.user_system_roles;

CREATE POLICY "user_system_roles_select" ON public.user_system_roles
  FOR SELECT TO authenticated
  USING (public.is_workspace_active_member(workspace_id));

CREATE POLICY "user_system_roles_manage" ON public.user_system_roles
  FOR ALL TO authenticated
  USING (
    public.get_user_workspace_role(workspace_id) = 'owner'
    OR public.has_system_role(workspace_id, 'system_admin')
  )
  WITH CHECK (
    public.get_user_workspace_role(workspace_id) = 'owner'
    OR public.has_system_role(workspace_id, 'system_admin')
  );

-- departments
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_select_member" ON public.departments;
DROP POLICY IF EXISTS "departments_insert_manage" ON public.departments;
DROP POLICY IF EXISTS "departments_update_manage" ON public.departments;
DROP POLICY IF EXISTS "departments_delete_owner" ON public.departments;

CREATE POLICY "departments_select_member" ON public.departments
  FOR SELECT TO authenticated
  USING (public.is_workspace_active_member(workspace_id));

CREATE POLICY "departments_insert_manage" ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_administer_workspace(workspace_id));

CREATE POLICY "departments_update_manage" ON public.departments
  FOR UPDATE TO authenticated
  USING (public.can_administer_workspace(workspace_id))
  WITH CHECK (public.can_administer_workspace(workspace_id));

CREATE POLICY "departments_delete_owner" ON public.departments
  FOR DELETE TO authenticated
  USING (
    public.get_user_workspace_role(workspace_id) = 'owner'
    OR public.has_system_role(workspace_id, 'system_admin')
  );

-- department_memberships
ALTER TABLE public.department_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_memberships_select_member" ON public.department_memberships;
DROP POLICY IF EXISTS "dept_memberships_manage" ON public.department_memberships;

CREATE POLICY "dept_memberships_select_member" ON public.department_memberships
  FOR SELECT TO authenticated
  USING (public.is_workspace_active_member(workspace_id));

CREATE POLICY "dept_memberships_manage" ON public.department_memberships
  FOR ALL TO authenticated
  USING (public.can_administer_workspace(workspace_id))
  WITH CHECK (public.can_administer_workspace(workspace_id));

-- task_raci_assignments
ALTER TABLE public.task_raci_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_raci_select_member" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_manage" ON public.task_raci_assignments;

CREATE POLICY "task_raci_select_member" ON public.task_raci_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND public.is_workspace_active_member(p.workspace_id)
    )
  );

CREATE POLICY "task_raci_manage" ON public.task_raci_assignments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND (
          public.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          OR public.has_system_role(p.workspace_id, 'system_admin')
          OR public.has_system_role(p.workspace_id, 'project_admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_raci_assignments.task_id
        AND (
          public.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          OR public.has_system_role(p.workspace_id, 'system_admin')
          OR public.has_system_role(p.workspace_id, 'project_admin')
        )
    )
  );

-- notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_internal" ON public.notifications;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_insert_internal" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_workspace_active_member(workspace_id)
  );

-- ============================================================================
-- END MIGRATION: 20260814_01_day0_foundation.sql
-- ============================================================================
