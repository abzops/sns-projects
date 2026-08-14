-- ============================================================================
-- StacknStock Projects – Complete Database Schema (V2 Release 1.1)
-- ============================================================================
-- Canonical schema reflecting production state after Release 1.1 Security
-- Hardening. Run this file against a clean Supabase project to recreate all
-- tables, functions, triggers, and RLS policies from scratch.
-- ============================================================================


-- ============================================================================
-- TABLES
-- ============================================================================


-- ── 1. profiles ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name  text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'User profile data, auto-created on sign-up.';


-- ── 2. workspaces ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspaces IS 'Top-level organisational unit that groups departments and projects.';


-- ── 3. workspace_members ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.profiles(id),
  invited_email text,
  role          text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status        text NOT NULL CHECK (status IN ('active', 'pending', 'declined')) DEFAULT 'pending',
  invited_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Active members: one row per user per workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_member_user
  ON public.workspace_members (workspace_id, user_id)
  WHERE user_id IS NOT NULL;

-- Pending invites: one pending invite per email per workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_member_pending_email
  ON public.workspace_members (workspace_id, invited_email)
  WHERE status = 'pending';

COMMENT ON TABLE public.workspace_members IS 'Membership & invitation records linking users to workspaces.';


-- ── 4. user_system_roles ─────────────────────────────────────────────────────

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

COMMENT ON TABLE public.user_system_roles IS 'System-level executive and administrative roles within a workspace.';


-- ── 5. departments ───────────────────────────────────────────────────────────

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

COMMENT ON TABLE public.departments IS 'Organizational departments within a workspace (Operations, Software, Mechanical, etc.).';


-- ── 6. department_memberships ────────────────────────────────────────────────

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

COMMENT ON TABLE public.department_memberships IS 'User associations with departments, including head/lead roles and primary designation.';


-- ── 7. projects ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  color            text DEFAULT '#FDE215',
  owner_id         uuid REFERENCES public.profiles(id),
  start_date       date,
  target_end_date  date,
  project_status   text NOT NULL DEFAULT 'active' CHECK (project_status IN ('draft', 'planned', 'active', 'on_hold', 'completed', 'cancelled')),
  project_priority text NOT NULL DEFAULT 'medium' CHECK (project_priority IN ('low', 'medium', 'high', 'critical')),
  created_by       uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON public.projects (workspace_id);

COMMENT ON TABLE public.projects IS 'A project lives inside a workspace and contains task boards.';


-- ── 8. milestones (Release 2.5) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  start_date  date,
  end_date    date,
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestones_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_milestones_project_pos ON public.milestones(project_id, position);

COMMENT ON TABLE public.milestones IS 'Strategic milestones belonging to a project.';


-- ── 9. task_lists (Release 2.5) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL,
  project_id  uuid NOT NULL,
  name        text NOT NULL,
  description text,
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_task_lists_milestone FOREIGN KEY (milestone_id, project_id)
    REFERENCES public.milestones(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_lists_project FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT task_lists_id_milestone_project_unique UNIQUE (id, milestone_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_task_lists_milestone_pos ON public.task_lists(milestone_id, position);
CREATE INDEX IF NOT EXISTS idx_task_lists_project ON public.task_lists(project_id);

COMMENT ON TABLE public.task_lists IS 'Task lists group related tasks under a milestone.';


-- ── 10. task_statuses ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_statuses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL,
  position    integer NOT NULL,
  system_code text CHECK (system_code IS NULL OR system_code IN ('todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_statuses_project ON public.task_statuses (project_id);

COMMENT ON TABLE public.task_statuses IS 'Kanban columns – ordered status buckets for a project.';


-- ── 11. tasks ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  milestone_id uuid,
  task_list_id uuid,
  title       text NOT NULL,
  description text,
  status_id   uuid REFERENCES public.task_statuses(id),
  priority    text CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')) DEFAULT 'none',
  assignee_id uuid REFERENCES public.profiles(id),
  due_date    date,
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_hierarchy_check CHECK (
    (milestone_id IS NULL AND task_list_id IS NULL)
    OR
    (milestone_id IS NOT NULL AND task_list_id IS NOT NULL)
  ),
  CONSTRAINT fk_tasks_task_list FOREIGN KEY (task_list_id, milestone_id, project_id)
    REFERENCES public.task_lists(id, milestone_id, project_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON public.tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON public.tasks (milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON public.tasks (task_list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks (status_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_position ON public.tasks (project_id, status_id, position);

COMMENT ON TABLE public.tasks IS 'Individual work items within a project.';


-- ── 12. subtasks (Release 2.5) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subtasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  start_date  date,
  due_date    date,
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subtasks_task_pos ON public.subtasks(task_id, position);
CREATE INDEX IF NOT EXISTS idx_subtasks_assignee ON public.subtasks(assignee_id);

COMMENT ON TABLE public.subtasks IS 'Lightweight execution breakdowns of tasks with status and assignee.';


-- ── 10. task_raci_assignments ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_raci_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  raci_role     text NOT NULL CHECK (raci_role IN ('R', 'A', 'C', 'I')),
  user_id       uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_raci_single_target CHECK (
    (user_id IS NOT NULL AND department_id IS NULL)
    OR (user_id IS NULL AND department_id IS NOT NULL)
  ),
  CONSTRAINT chk_raci_accountable_user CHECK (
    raci_role != 'A' OR (user_id IS NOT NULL AND department_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_raci_accountable
  ON public.task_raci_assignments (task_id)
  WHERE raci_role = 'A';

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_raci_user
  ON public.task_raci_assignments (task_id, raci_role, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_raci_dept
  ON public.task_raci_assignments (task_id, raci_role, department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_raci_task ON public.task_raci_assignments (task_id);
CREATE INDEX IF NOT EXISTS idx_task_raci_user ON public.task_raci_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_task_raci_dept ON public.task_raci_assignments (department_id);

COMMENT ON TABLE public.task_raci_assignments IS 'RACI matrix assignments for tasks (Responsible, Accountable, Consulted, Informed).';


-- ── 11. notifications ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN (
    'task_assigned',
    'task_accountable',
    'task_consulted',
    'task_informed',
    'raci_changed',
    'task_status_changed',
    'subtask_assigned',
    'project_status_changed',
    'system'
  )),
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

COMMENT ON TABLE public.notifications IS 'In-app user notifications and activity inbox.';


-- ============================================================================
-- PRIVATE SCHEMA & AUTHORIZATION HELPERS (Release 1.1)
-- ============================================================================
-- Authorization helpers live in the 'private' schema which is NOT exposed
-- through PostgREST / Supabase Data API. This prevents direct RPC invocation
-- by API clients while still allowing use in RLS policies.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO postgres;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

-- Prevent auto-granting EXECUTE on future private functions to PUBLIC
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── Authorization Helpers ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.get_user_workspace_role(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role
  FROM public.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_active_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.has_system_role(p_workspace_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_system_roles
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND role = p_role
  );
$$;

CREATE OR REPLACE FUNCTION private.can_administer_workspace(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    private.get_user_workspace_role(p_workspace_id) IN ('owner', 'admin')
    OR private.has_system_role(p_workspace_id, 'system_admin')
  );
$$;

-- Minimal EXECUTE grants: only authenticated and service_role (for RLS eval)
REVOKE EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION private.has_system_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.has_system_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION private.has_system_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_system_role(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION private.can_administer_workspace(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.can_administer_workspace(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.can_administer_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_administer_workspace(uuid) TO service_role;


-- ============================================================================
-- TRIGGER FUNCTIONS (public, but NOT callable by users)
-- ============================================================================

-- ── Auto-create profile on user sign-up ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
  );
  RETURN NEW;
END;
$$;

-- Trigger-only: revoke all user-facing EXECUTE
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ── Seed default statuses when a project is created ─────────────────────────

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

-- Trigger-only: revoke all user-facing EXECUTE
REVOKE EXECUTE ON FUNCTION public.seed_default_statuses() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_statuses() FROM anon;
REVOKE EXECUTE ON FUNCTION public.seed_default_statuses() FROM authenticated;

DROP TRIGGER IF EXISTS on_project_created ON public.projects;

CREATE TRIGGER on_project_created
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_default_statuses();


-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_system_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_statuses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_raci_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications          ENABLE ROW LEVEL SECURITY;

-- ── profiles ──
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_select_authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ── workspaces ──
DROP POLICY IF EXISTS "workspaces_select_member" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_insert_authenticated" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_update_owner" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_delete_owner" ON public.workspaces;

CREATE POLICY "workspaces_select_member" ON public.workspaces FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(id));

CREATE POLICY "workspaces_insert_authenticated" ON public.workspaces FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "workspaces_update_owner" ON public.workspaces FOR UPDATE TO authenticated
  USING (private.get_user_workspace_role(id) IN ('owner', 'admin') OR private.has_system_role(id, 'system_admin'))
  WITH CHECK (private.get_user_workspace_role(id) IN ('owner', 'admin') OR private.has_system_role(id, 'system_admin'));

CREATE POLICY "workspaces_delete_owner" ON public.workspaces FOR DELETE TO authenticated
  USING (private.get_user_workspace_role(id) = 'owner');

-- ── workspace_members ──
DROP POLICY IF EXISTS "workspace_members_select_active" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_insert_admin_owner" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_update_admin_owner" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_delete_admin_owner" ON public.workspace_members;

CREATE POLICY "workspace_members_select_active" ON public.workspace_members FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

CREATE POLICY "workspace_members_insert_admin_owner" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    private.can_administer_workspace(workspace_id)
    OR (user_id = auth.uid() AND role = 'owner' AND NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_members.workspace_id))
  );

CREATE POLICY "workspace_members_update_admin_owner" ON public.workspace_members FOR UPDATE TO authenticated
  USING (
    private.can_administer_workspace(workspace_id)
    OR (user_id = auth.uid() AND status = 'pending')
    OR (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()) AND status = 'pending')
  )
  WITH CHECK (
    private.can_administer_workspace(workspace_id)
    OR (user_id = auth.uid())
    OR (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );

CREATE POLICY "workspace_members_delete_admin_owner" ON public.workspace_members FOR DELETE TO authenticated
  USING (private.can_administer_workspace(workspace_id));

-- ── user_system_roles ──
DROP POLICY IF EXISTS "user_system_roles_select" ON public.user_system_roles;
DROP POLICY IF EXISTS "user_system_roles_manage" ON public.user_system_roles;

CREATE POLICY "user_system_roles_select" ON public.user_system_roles FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

CREATE POLICY "user_system_roles_manage" ON public.user_system_roles FOR ALL TO authenticated
  USING (private.get_user_workspace_role(workspace_id) = 'owner' OR private.has_system_role(workspace_id, 'system_admin'))
  WITH CHECK (private.get_user_workspace_role(workspace_id) = 'owner' OR private.has_system_role(workspace_id, 'system_admin'));

-- ── departments ──
DROP POLICY IF EXISTS "departments_select_member" ON public.departments;
DROP POLICY IF EXISTS "departments_insert_manage" ON public.departments;
DROP POLICY IF EXISTS "departments_update_manage" ON public.departments;
DROP POLICY IF EXISTS "departments_delete_owner" ON public.departments;

CREATE POLICY "departments_select_member" ON public.departments FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

CREATE POLICY "departments_insert_manage" ON public.departments FOR INSERT TO authenticated
  WITH CHECK (private.can_administer_workspace(workspace_id));

CREATE POLICY "departments_update_manage" ON public.departments FOR UPDATE TO authenticated
  USING (private.can_administer_workspace(workspace_id))
  WITH CHECK (private.can_administer_workspace(workspace_id));

CREATE POLICY "departments_delete_owner" ON public.departments FOR DELETE TO authenticated
  USING (private.get_user_workspace_role(workspace_id) = 'owner' OR private.has_system_role(workspace_id, 'system_admin'));

-- ── department_memberships ──
DROP POLICY IF EXISTS "dept_memberships_select_member" ON public.department_memberships;
DROP POLICY IF EXISTS "dept_memberships_manage" ON public.department_memberships;

CREATE POLICY "dept_memberships_select_member" ON public.department_memberships FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

CREATE POLICY "dept_memberships_manage" ON public.department_memberships FOR ALL TO authenticated
  USING (private.can_administer_workspace(workspace_id))
  WITH CHECK (private.can_administer_workspace(workspace_id));

-- ── projects ──
DROP POLICY IF EXISTS "projects_select_member" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_member" ON public.projects;
DROP POLICY IF EXISTS "projects_update_member" ON public.projects;
DROP POLICY IF EXISTS "projects_delete_admin_owner" ON public.projects;

CREATE POLICY "projects_select_member" ON public.projects FOR SELECT TO authenticated
  USING (private.get_user_workspace_role(workspace_id) IS NOT NULL);

CREATE POLICY "projects_insert_member" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    private.get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
    OR private.has_system_role(workspace_id, 'system_admin')
    OR private.has_system_role(workspace_id, 'project_admin')
  );

CREATE POLICY "projects_update_member" ON public.projects FOR UPDATE TO authenticated
  USING (
    private.get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
    OR private.has_system_role(workspace_id, 'system_admin')
    OR private.has_system_role(workspace_id, 'project_admin')
  )
  WITH CHECK (
    private.get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
    OR private.has_system_role(workspace_id, 'system_admin')
    OR private.has_system_role(workspace_id, 'project_admin')
  );

CREATE POLICY "projects_delete_admin_owner" ON public.projects FOR DELETE TO authenticated
  USING (private.can_administer_workspace(workspace_id));

-- ── milestones (Release 2.5) ──
DROP POLICY IF EXISTS "milestones_select_member" ON public.milestones;
DROP POLICY IF EXISTS "milestones_insert_member" ON public.milestones;
DROP POLICY IF EXISTS "milestones_update_member" ON public.milestones;
DROP POLICY IF EXISTS "milestones_delete_member" ON public.milestones;

CREATE POLICY "milestones_select_member" ON public.milestones FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id AND private.is_workspace_active_member(p.workspace_id)));

CREATE POLICY "milestones_insert_member" ON public.milestones FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "milestones_update_member" ON public.milestones FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "milestones_delete_member" ON public.milestones FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

-- ── task_lists (Release 2.5) ──
DROP POLICY IF EXISTS "task_lists_select_member" ON public.task_lists;
DROP POLICY IF EXISTS "task_lists_insert_member" ON public.task_lists;
DROP POLICY IF EXISTS "task_lists_update_member" ON public.task_lists;
DROP POLICY IF EXISTS "task_lists_delete_member" ON public.task_lists;

CREATE POLICY "task_lists_select_member" ON public.task_lists FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_lists.project_id AND private.is_workspace_active_member(p.workspace_id)));

CREATE POLICY "task_lists_insert_member" ON public.task_lists FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_lists.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "task_lists_update_member" ON public.task_lists FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_lists.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_lists.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "task_lists_delete_member" ON public.task_lists FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_lists.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

-- ── task_statuses ──
DROP POLICY IF EXISTS "task_statuses_select_member" ON public.task_statuses;
DROP POLICY IF EXISTS "task_statuses_insert_member" ON public.task_statuses;
DROP POLICY IF EXISTS "task_statuses_update_member" ON public.task_statuses;
DROP POLICY IF EXISTS "task_statuses_delete_member" ON public.task_statuses;

CREATE POLICY "task_statuses_select_member" ON public.task_statuses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND private.get_user_workspace_role(p.workspace_id) IS NOT NULL));

CREATE POLICY "task_statuses_insert_member" ON public.task_statuses FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "task_statuses_update_member" ON public.task_statuses FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "task_statuses_delete_member" ON public.task_statuses FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

-- ── tasks ──
DROP POLICY IF EXISTS "tasks_select_member" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert_member" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update_member" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete_member" ON public.tasks;

CREATE POLICY "tasks_select_member" ON public.tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND private.get_user_workspace_role(p.workspace_id) IS NOT NULL));

CREATE POLICY "tasks_insert_member" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "tasks_update_member" ON public.tasks FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "tasks_delete_member" ON public.tasks FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

-- ── subtasks (Release 2.5) ──
DROP POLICY IF EXISTS "subtasks_select_member" ON public.subtasks;
DROP POLICY IF EXISTS "subtasks_insert_member" ON public.subtasks;
DROP POLICY IF EXISTS "subtasks_update_member" ON public.subtasks;
DROP POLICY IF EXISTS "subtasks_delete_member" ON public.subtasks;

CREATE POLICY "subtasks_select_member" ON public.subtasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = subtasks.task_id AND private.is_workspace_active_member(p.workspace_id)));

CREATE POLICY "subtasks_insert_member" ON public.subtasks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = subtasks.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "subtasks_update_member" ON public.subtasks FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = subtasks.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = subtasks.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

CREATE POLICY "subtasks_delete_member" ON public.subtasks FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = subtasks.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

-- ── task_raci_assignments ──
DROP POLICY IF EXISTS "task_raci_select_member" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_manage" ON public.task_raci_assignments;

CREATE POLICY "task_raci_select_member" ON public.task_raci_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = task_raci_assignments.task_id AND private.is_workspace_active_member(p.workspace_id)));

CREATE POLICY "task_raci_manage" ON public.task_raci_assignments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = task_raci_assignments.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = task_raci_assignments.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

-- ── notifications ──
-- INSERT: revoked from authenticated/anon. Only service_role/postgres can insert.
-- UPDATE: column-level grant for is_read and read_at only.
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;

CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- Notification table-level grants:
REVOKE INSERT ON TABLE public.notifications FROM authenticated;
REVOKE INSERT ON TABLE public.notifications FROM anon;
REVOKE UPDATE ON TABLE public.notifications FROM authenticated;
GRANT UPDATE (is_read, read_at) ON TABLE public.notifications TO authenticated;


-- ============================================================================
-- NOTIFICATION ENGINE & REALTIME (Release 3)
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_task_lists_milestone_proj ON public.task_lists(milestone_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_hierarchy_covering ON public.tasks(task_list_id, milestone_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone_proj ON public.tasks(milestone_id, project_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

-- Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications' AND schemaname = 'public'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Emission helper
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

REVOKE ALL ON FUNCTION private.emit_notification(uuid, uuid, text, text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.emit_notification(uuid, uuid, text, text, text, text, uuid, uuid, uuid) TO postgres, service_role;

-- Trigger Functions:
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

  IF v_milestone_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_milestone_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

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
  IF OLD.status_id IS NOT DISTINCT FROM NEW.status_id THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_status_name FROM public.task_statuses WHERE id = NEW.status_id;

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

  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id
      FROM public.task_raci_assignments ra
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'A', 'I')
        AND ra.user_id IS NOT NULL

      UNION

      SELECT dm.user_id AS u_id
      FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'I')
        AND ra.department_id IS NOT NULL
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true

      UNION

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
BEGIN
  IF NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN
    RETURN NEW;
  END IF;

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


-- ============================================================================
-- DEFAULT PRIVILEGE HARDENING (Release 1.1)
-- ============================================================================
-- Future functions created by postgres in public do NOT auto-receive EXECUTE
-- for PUBLIC, anon, authenticated, or service_role.
-- supabase_admin defaults are NOT modified.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM service_role;
