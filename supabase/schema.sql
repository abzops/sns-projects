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
  CONSTRAINT uq_department_workspace_code UNIQUE (workspace_id, code),
  CONSTRAINT uq_departments_id_workspace UNIQUE (id, workspace_id)
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
DROP POLICY IF EXISTS "workspace_members_insert_bootstrap" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_update_admin_owner" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_delete_admin_owner" ON public.workspace_members;

CREATE POLICY "workspace_members_select_active" ON public.workspace_members FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

-- First-owner bootstrap only (when workspace has 0 members)
CREATE POLICY "workspace_members_insert_bootstrap" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_members.workspace_id)
  );

-- Direct UPDATE and DELETE are intentionally not permitted to authenticated users;
-- all organization user administration flows through admin-manage-workspace-user.

-- ── user_system_roles ──
DROP POLICY IF EXISTS "user_system_roles_select" ON public.user_system_roles;
DROP POLICY IF EXISTS "user_system_roles_manage" ON public.user_system_roles;

CREATE POLICY "user_system_roles_select" ON public.user_system_roles FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

-- Direct INSERT, UPDATE, DELETE are intentionally not permitted to authenticated users;
-- all system role management flows through admin-manage-workspace-user.

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

-- Direct INSERT, UPDATE, DELETE are intentionally not permitted to authenticated users;
-- all department membership management flows through admin-manage-workspace-user.

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

-- ============================================================================
-- KANBAN ATOMIC REORDER FUNCTION
-- ============================================================================
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

REVOKE ALL ON FUNCTION public.reorder_kanban_tasks(uuid, uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_kanban_tasks(uuid, uuid, uuid[], uuid[]) TO authenticated;


-- ============================================================================
-- DEFINED PROCESS ENGINE — DP-1-A CATALOG & IMMUTABLE VERSIONS
-- ============================================================================

-- ── 1. defined_processes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defined_processes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  department_id             uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  name                      text NOT NULL,
  code                      text NOT NULL,
  description               text,
  process_owner_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_type               text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'custom_conversion')),
  source_task_list_id       uuid REFERENCES public.task_lists(id) ON DELETE RESTRICT,
  approval_state            text NOT NULL DEFAULT 'not_required' CHECK (approval_state IN ('not_required', 'pending_approval', 'approved', 'rejected')),
  submitted_for_approval_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_for_approval_at timestamptz,
  approval_decided_by       uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approval_decided_at       timestamptz,
  approval_notes            text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_by                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_defined_processes_workspace_code UNIQUE (workspace_id, code),
  CONSTRAINT uq_defined_processes_workspace_name UNIQUE (workspace_id, name),
  CONSTRAINT fk_defined_processes_dept_workspace FOREIGN KEY (department_id, workspace_id)
    REFERENCES public.departments(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT chk_defined_processes_source_provenance CHECK (
    (source_type = 'manual' AND source_task_list_id IS NULL AND approval_state = 'not_required')
    OR
    (source_type = 'custom_conversion' AND source_task_list_id IS NOT NULL AND approval_state <> 'not_required')
  )
);

CREATE INDEX IF NOT EXISTS idx_defined_processes_ws_dept_active
  ON public.defined_processes (workspace_id, department_id, is_active);

CREATE INDEX IF NOT EXISTS idx_defined_processes_owner
  ON public.defined_processes (process_owner_id);

CREATE INDEX IF NOT EXISTS idx_defined_processes_source_task_list
  ON public.defined_processes (source_task_list_id)
  WHERE source_task_list_id IS NOT NULL;

COMMENT ON TABLE public.defined_processes IS 'Reusable defined process templates catalog governed at workspace and department level.';

-- ── 2. defined_process_versions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defined_process_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defined_process_id uuid NOT NULL REFERENCES public.defined_processes(id) ON DELETE CASCADE,
  version_number     integer NOT NULL CHECK (version_number >= 1),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  change_summary     text,
  published_by       uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at       timestamptz,
  created_by         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_defined_process_versions_process_version UNIQUE (defined_process_id, version_number),
  CONSTRAINT uq_defined_process_versions_id_process UNIQUE (id, defined_process_id),
  CONSTRAINT chk_defined_process_versions_publication CHECK (
    (status = 'draft' AND published_by IS NULL AND published_at IS NULL)
    OR
    (status IN ('published', 'archived') AND published_by IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_defined_process_versions_single_published
  ON public.defined_process_versions (defined_process_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_defined_process_versions_process_status
  ON public.defined_process_versions (defined_process_id, status);

COMMENT ON TABLE public.defined_process_versions IS 'Immutable version instances for defined processes with single-published enforcement.';

-- ── 3. Application Updated_at Trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION private.trg_fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_defined_processes_updated_at ON public.defined_processes;
CREATE TRIGGER trg_defined_processes_updated_at
  BEFORE UPDATE ON public.defined_processes
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_defined_process_versions_updated_at ON public.defined_process_versions;
CREATE TRIGGER trg_defined_process_versions_updated_at
  BEFORE UPDATE ON public.defined_process_versions
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- ── 4. RLS & Privileges ───────────────────────────────────────────────────
ALTER TABLE public.defined_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.defined_processes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_versions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.defined_processes TO authenticated;
GRANT SELECT ON TABLE public.defined_process_versions TO authenticated;

DROP POLICY IF EXISTS "defined_processes_select_member" ON public.defined_processes;
CREATE POLICY "defined_processes_select_member"
  ON public.defined_processes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_workspace_active_member(defined_processes.workspace_id))
  );

DROP POLICY IF EXISTS "defined_process_versions_select_member" ON public.defined_process_versions;
CREATE POLICY "defined_process_versions_select_member"
  ON public.defined_process_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.defined_processes dp
      WHERE dp.id = defined_process_versions.defined_process_id
        AND private.is_workspace_active_member(dp.workspace_id)
    )
  );


-- ============================================================================
-- DEFINED PROCESS ENGINE — DP-1-B STEPS, DAG DEPENDENCIES, RACI, EVIDENCE
-- ============================================================================

-- ── 1. defined_process_steps ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defined_process_steps (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id             uuid NOT NULL REFERENCES public.defined_process_versions(id) ON DELETE CASCADE,
  step_code              text NOT NULL,
  title                  text NOT NULL,
  description            text,
  sequence_order         integer NOT NULL CHECK (sequence_order >= 1),
  expected_duration_days integer NOT NULL CHECK (expected_duration_days >= 1),
  approval_required      boolean NOT NULL DEFAULT false,
  consultation_required  boolean NOT NULL DEFAULT false,
  evidence_required      boolean NOT NULL DEFAULT false,
  notify_c_on_extension  boolean NOT NULL DEFAULT false,
  notify_i_on_extension  boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_defined_process_steps_version_code UNIQUE (version_id, step_code),
  CONSTRAINT uq_defined_process_steps_version_sequence UNIQUE (version_id, sequence_order),
  CONSTRAINT uq_defined_process_steps_id_version UNIQUE (id, version_id)
);

COMMENT ON TABLE public.defined_process_steps IS 'Step template definitions within a defined process version with sequence ordering and governance flags.';

CREATE INDEX IF NOT EXISTS idx_defined_process_steps_version_id
  ON public.defined_process_steps (version_id);

DROP TRIGGER IF EXISTS trg_defined_process_steps_updated_at ON public.defined_process_steps;
CREATE TRIGGER trg_defined_process_steps_updated_at
  BEFORE UPDATE ON public.defined_process_steps
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- ── 2. defined_process_step_dependencies ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defined_process_step_dependencies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id         uuid NOT NULL REFERENCES public.defined_process_versions(id) ON DELETE CASCADE,
  step_id            uuid NOT NULL,
  depends_on_step_id uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_step_deps_step_version FOREIGN KEY (step_id, version_id)
    REFERENCES public.defined_process_steps(id, version_id) ON DELETE CASCADE,
  CONSTRAINT fk_step_deps_depends_on_version FOREIGN KEY (depends_on_step_id, version_id)
    REFERENCES public.defined_process_steps(id, version_id) ON DELETE CASCADE,
  CONSTRAINT chk_step_deps_no_self_dependency CHECK (step_id <> depends_on_step_id),
  CONSTRAINT uq_step_deps_version_step_depends UNIQUE (version_id, step_id, depends_on_step_id)
);

COMMENT ON TABLE public.defined_process_step_dependencies IS 'DAG dependency edges between steps strictly confined to the same defined process version.';

CREATE INDEX IF NOT EXISTS idx_step_deps_downstream
  ON public.defined_process_step_dependencies (version_id, depends_on_step_id, step_id);

CREATE INDEX IF NOT EXISTS idx_step_deps_step_version
  ON public.defined_process_step_dependencies (step_id, version_id);

CREATE INDEX IF NOT EXISTS idx_step_deps_depends_version
  ON public.defined_process_step_dependencies (depends_on_step_id, version_id);

-- ── 3. defined_process_step_raci ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defined_process_step_raci (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id           uuid NOT NULL REFERENCES public.defined_process_steps(id) ON DELETE CASCADE,
  raci_role         text NOT NULL CHECK (raci_role IN ('R', 'A', 'C', 'I')),
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  response_required boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_step_raci_step_role_user UNIQUE (step_id, raci_role, user_id),
  CONSTRAINT chk_step_raci_response_required CHECK (response_required = false OR raci_role = 'C')
);

COMMENT ON TABLE public.defined_process_step_raci IS 'Template RACI assignments for process steps with max-one Accountable enforcement.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_step_raci_single_accountable
  ON public.defined_process_step_raci (step_id)
  WHERE raci_role = 'A';

CREATE INDEX IF NOT EXISTS idx_step_raci_step_id
  ON public.defined_process_step_raci (step_id);

CREATE INDEX IF NOT EXISTS idx_step_raci_user_step
  ON public.defined_process_step_raci (user_id, step_id);

-- ── 4. defined_process_step_evidence_defs ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defined_process_step_evidence_defs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id       uuid NOT NULL REFERENCES public.defined_process_steps(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('file', 'link', 'text', 'reference')),
  title         text NOT NULL,
  description   text,
  is_mandatory  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.defined_process_step_evidence_defs IS 'Evidence requirement definitions for process steps (file, link, text, reference).';

CREATE INDEX IF NOT EXISTS idx_step_evidence_defs_step_id
  ON public.defined_process_step_evidence_defs (step_id);

DROP TRIGGER IF EXISTS trg_defined_process_step_evidence_defs_updated_at ON public.defined_process_step_evidence_defs;
CREATE TRIGGER trg_defined_process_step_evidence_defs_updated_at
  BEFORE UPDATE ON public.defined_process_step_evidence_defs
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- ── 5. RLS & Permissions ───────────────────────────────────────────────────
ALTER TABLE public.defined_process_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_step_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_step_raci ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_step_evidence_defs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.defined_process_steps FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_step_dependencies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_step_raci FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_step_evidence_defs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.defined_process_steps TO authenticated;
GRANT SELECT ON TABLE public.defined_process_step_dependencies TO authenticated;
GRANT SELECT ON TABLE public.defined_process_step_raci TO authenticated;
GRANT SELECT ON TABLE public.defined_process_step_evidence_defs TO authenticated;

DROP POLICY IF EXISTS "defined_process_steps_select_member" ON public.defined_process_steps;
CREATE POLICY "defined_process_steps_select_member"
  ON public.defined_process_steps
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.defined_process_versions dpv
      JOIN public.defined_processes dp ON dp.id = dpv.defined_process_id
      WHERE dpv.id = defined_process_steps.version_id
        AND private.is_workspace_active_member(dp.workspace_id)
    )
  );

DROP POLICY IF EXISTS "defined_process_step_dependencies_select_member" ON public.defined_process_step_dependencies;
CREATE POLICY "defined_process_step_dependencies_select_member"
  ON public.defined_process_step_dependencies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.defined_process_versions dpv
      JOIN public.defined_processes dp ON dp.id = dpv.defined_process_id
      WHERE dpv.id = defined_process_step_dependencies.version_id
        AND private.is_workspace_active_member(dp.workspace_id)
    )
  );

DROP POLICY IF EXISTS "defined_process_step_raci_select_member" ON public.defined_process_step_raci;
CREATE POLICY "defined_process_step_raci_select_member"
  ON public.defined_process_step_raci
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.defined_process_steps dps
      JOIN public.defined_process_versions dpv ON dpv.id = dps.version_id
      JOIN public.defined_processes dp ON dp.id = dpv.defined_process_id
      WHERE dps.id = defined_process_step_raci.step_id
        AND private.is_workspace_active_member(dp.workspace_id)
    )
  );

DROP POLICY IF EXISTS "defined_process_step_evidence_defs_select_member" ON public.defined_process_step_evidence_defs;
CREATE POLICY "defined_process_step_evidence_defs_select_member"
  ON public.defined_process_step_evidence_defs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.defined_process_steps dps
      JOIN public.defined_process_versions dpv ON dpv.id = dps.version_id
      JOIN public.defined_processes dp ON dp.id = dpv.defined_process_id
      WHERE dps.id = defined_process_step_evidence_defs.step_id
        AND private.is_workspace_active_member(dp.workspace_id)
    )
  );


-- ============================================================================
-- DEFINED PROCESS ENGINE — DP-1-C WORKING CALENDARS & COMPANY HOLIDAYS
-- ============================================================================

-- ── 1. workspace_working_calendars ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_working_calendars (
  workspace_id      uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  timezone          text NOT NULL,
  monday_working    boolean NOT NULL DEFAULT true,
  tuesday_working   boolean NOT NULL DEFAULT true,
  wednesday_working boolean NOT NULL DEFAULT true,
  thursday_working  boolean NOT NULL DEFAULT true,
  friday_working    boolean NOT NULL DEFAULT true,
  saturday_working  boolean NOT NULL DEFAULT false,
  sunday_working    boolean NOT NULL DEFAULT false,
  created_by        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_workspace_working_calendars_timezone CHECK (btrim(timezone) <> ''),
  CONSTRAINT chk_workspace_working_calendars_at_least_one_day CHECK (
    monday_working OR tuesday_working OR wednesday_working OR
    thursday_working OR friday_working OR saturday_working OR sunday_working
  )
);

COMMENT ON TABLE public.workspace_working_calendars IS 'Company-wide working calendar configuration defining working weekdays and timezone per workspace.';

CREATE INDEX IF NOT EXISTS idx_workspace_working_calendars_created_by
  ON public.workspace_working_calendars (created_by);

DROP TRIGGER IF EXISTS trg_workspace_working_calendars_updated_at ON public.workspace_working_calendars;
CREATE TRIGGER trg_workspace_working_calendars_updated_at
  BEFORE UPDATE ON public.workspace_working_calendars
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- ── 2. workspace_holidays ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspace_working_calendars(workspace_id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name         text NOT NULL,
  description  text,
  created_by   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_workspace_holidays_name CHECK (btrim(name) <> ''),
  CONSTRAINT uq_workspace_holidays_workspace_date UNIQUE (workspace_id, holiday_date)
);

COMMENT ON TABLE public.workspace_holidays IS 'Company non-working holiday dates declared per workspace calendar.';

CREATE INDEX IF NOT EXISTS idx_workspace_holidays_created_by
  ON public.workspace_holidays (created_by);

DROP TRIGGER IF EXISTS trg_workspace_holidays_updated_at ON public.workspace_holidays;
CREATE TRIGGER trg_workspace_holidays_updated_at
  BEFORE UPDATE ON public.workspace_holidays
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- ── 3. RLS & Permissions ───────────────────────────────────────────────────
ALTER TABLE public.workspace_working_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_holidays ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.workspace_working_calendars FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.workspace_holidays FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.workspace_working_calendars TO authenticated;
GRANT SELECT ON TABLE public.workspace_holidays TO authenticated;

DROP POLICY IF EXISTS "workspace_working_calendars_select_member" ON public.workspace_working_calendars;
CREATE POLICY "workspace_working_calendars_select_member"
  ON public.workspace_working_calendars
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_workspace_active_member(workspace_working_calendars.workspace_id))
  );

DROP POLICY IF EXISTS "workspace_holidays_select_member" ON public.workspace_holidays;
CREATE POLICY "workspace_holidays_select_member"
  ON public.workspace_holidays
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_workspace_active_member(workspace_holidays.workspace_id))
  );


-- ============================================================================
-- DEFINED PROCESS ENGINE — DP-1-D RUNTIME PROVENANCE, WORKFLOW & GUARDS
-- ============================================================================

-- ── 1. task_lists Provenance & Lifecycle ────────────────────────────────────
ALTER TABLE public.task_lists
  ADD COLUMN IF NOT EXISTS task_list_type text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS defined_process_id uuid NULL,
  ADD COLUMN IF NOT EXISTS defined_process_version_id uuid NULL,
  ADD COLUMN IF NOT EXISTS process_state text NULL,
  ADD COLUMN IF NOT EXISTS started_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_lists_task_list_type') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT chk_task_lists_task_list_type CHECK (task_list_type IN ('custom', 'defined'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_lists_process_state') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT chk_task_lists_process_state CHECK (
        process_state IS NULL OR process_state IN ('active', 'completed', 'cancelled')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_lists_process_version') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT fk_task_lists_process_version
        FOREIGN KEY (defined_process_version_id, defined_process_id)
        REFERENCES public.defined_process_versions(id, defined_process_id)
        ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_task_lists_id_version') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT uq_task_lists_id_version UNIQUE (id, defined_process_version_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_lists_provenance_coherence') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT chk_task_lists_provenance_coherence CHECK (
        (
          task_list_type = 'custom'
          AND defined_process_id IS NULL
          AND defined_process_version_id IS NULL
          AND process_state IS NULL
          AND started_by IS NULL
          AND started_at IS NULL
          AND completed_at IS NULL
          AND cancelled_by IS NULL
          AND cancelled_at IS NULL
          AND cancellation_reason IS NULL
        )
        OR
        (
          task_list_type = 'defined'
          AND defined_process_id IS NOT NULL
          AND defined_process_version_id IS NOT NULL
          AND process_state IN ('active', 'completed', 'cancelled')
          AND started_by IS NOT NULL
          AND started_at IS NOT NULL
          AND (
            (
              process_state = 'active'
              AND completed_at IS NULL
              AND cancelled_by IS NULL
              AND cancelled_at IS NULL
              AND cancellation_reason IS NULL
            )
            OR
            (
              process_state = 'completed'
              AND completed_at IS NOT NULL
              AND cancelled_by IS NULL
              AND cancelled_at IS NULL
              AND cancellation_reason IS NULL
            )
            OR
            (
              process_state = 'cancelled'
              AND completed_at IS NULL
              AND cancelled_by IS NOT NULL
              AND cancelled_at IS NOT NULL
              AND cancellation_reason IS NOT NULL
              AND btrim(cancellation_reason) <> ''
            )
          )
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_lists_defined_process
  ON public.task_lists (defined_process_id, defined_process_version_id)
  WHERE task_list_type = 'defined';

CREATE INDEX IF NOT EXISTS idx_task_lists_process_version_fk
  ON public.task_lists (defined_process_version_id, defined_process_id);

CREATE INDEX IF NOT EXISTS idx_task_lists_project_process_state
  ON public.task_lists (project_id, process_state)
  WHERE task_list_type = 'defined';

CREATE INDEX IF NOT EXISTS idx_task_lists_started_by
  ON public.task_lists (started_by)
  WHERE started_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_lists_cancelled_by
  ON public.task_lists (cancelled_by)
  WHERE cancelled_by IS NOT NULL;

-- ── 2. tasks Provenance & Workflow State ─────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS defined_process_version_id uuid NULL,
  ADD COLUMN IF NOT EXISTS process_step_id uuid NULL,
  ADD COLUMN IF NOT EXISTS workflow_state text NULL,
  ADD COLUMN IF NOT EXISTS current_cycle_number integer NULL,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS workflow_completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS overdue_cycle_notified boolean NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_workflow_state') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_workflow_state CHECK (
        workflow_state IS NULL OR workflow_state IN (
          'waiting', 'ready', 'active', 'awaiting_consultation',
          'awaiting_approval', 'rework_required', 'completed', 'cancelled'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_step_version') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_step_version
        FOREIGN KEY (process_step_id, defined_process_version_id)
        REFERENCES public.defined_process_steps(id, version_id)
        ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_task_list_version') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_task_list_version
        FOREIGN KEY (task_list_id, defined_process_version_id)
        REFERENCES public.task_lists(id, defined_process_version_id)
        ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_defined_provenance_coherence') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_defined_provenance_coherence CHECK (
        (
          process_step_id IS NULL
          AND defined_process_version_id IS NULL
          AND workflow_state IS NULL
          AND current_cycle_number IS NULL
          AND ready_at IS NULL
          AND activated_at IS NULL
          AND workflow_completed_at IS NULL
          AND overdue_cycle_notified IS NULL
        )
        OR
        (
          process_step_id IS NOT NULL
          AND defined_process_version_id IS NOT NULL
          AND task_list_id IS NOT NULL
          AND milestone_id IS NOT NULL
          AND workflow_state IS NOT NULL
          AND current_cycle_number IS NOT NULL
          AND current_cycle_number >= 1
          AND overdue_cycle_notified IS NOT NULL
          AND assignee_id IS NULL
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_task_list_process_step
  ON public.tasks (task_list_id, process_step_id)
  WHERE process_step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_task_list_workflow_state
  ON public.tasks (task_list_id, workflow_state)
  WHERE process_step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_process_step_version
  ON public.tasks (process_step_id, defined_process_version_id)
  WHERE process_step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_task_list_version
  ON public.tasks (task_list_id, defined_process_version_id)
  WHERE defined_process_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_overdue_scan
  ON public.tasks (due_date, workflow_state)
  WHERE process_step_id IS NOT NULL AND due_date IS NOT NULL;

-- ── 3. Mutation Guard Triggers ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.trg_fn_guard_defined_task_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_is_trusted boolean;
  v_parent_list_type text;
BEGIN
  v_is_trusted := (
    current_user = 'postgres'
    AND current_setting('sns.process_engine_write', true) = 'on'
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_trusted THEN
      IF NEW.process_step_id IS NOT NULL OR NEW.defined_process_version_id IS NOT NULL OR NEW.workflow_state IS NOT NULL THEN
        RAISE EXCEPTION 'Defined Process tasks cannot be created directly.';
      END IF;

      IF NEW.task_list_id IS NOT NULL THEN
        SELECT tl.task_list_type INTO v_parent_list_type
        FROM public.task_lists tl
        WHERE tl.id = NEW.task_list_id;

        IF v_parent_list_type = 'defined' THEN
          RAISE EXCEPTION 'Cannot insert custom tasks into a Defined Process task list.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.process_step_id IS NOT NULL THEN
      IF NOT v_is_trusted THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.status_id IS DISTINCT FROM OLD.status_id
           OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
           OR NEW.due_date IS DISTINCT FROM OLD.due_date
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
           OR NEW.task_list_id IS DISTINCT FROM OLD.task_list_id
           OR NEW.defined_process_version_id IS DISTINCT FROM OLD.defined_process_version_id
           OR NEW.process_step_id IS DISTINCT FROM OLD.process_step_id
           OR NEW.workflow_state IS DISTINCT FROM OLD.workflow_state
           OR NEW.current_cycle_number IS DISTINCT FROM OLD.current_cycle_number
           OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
           OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
           OR NEW.workflow_completed_at IS DISTINCT FROM OLD.workflow_completed_at
           OR NEW.overdue_cycle_notified IS DISTINCT FROM OLD.overdue_cycle_notified THEN
          RAISE EXCEPTION 'Direct modification of Defined Process task workflow fields is prohibited.';
        END IF;
      END IF;
    ELSE
      IF NOT v_is_trusted THEN
        IF NEW.process_step_id IS NOT NULL OR NEW.defined_process_version_id IS NOT NULL OR NEW.workflow_state IS NOT NULL THEN
          RAISE EXCEPTION 'Cannot convert a custom task into a Defined Process task directly.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.process_step_id IS NOT NULL THEN
      IF NOT v_is_trusted THEN
        RAISE EXCEPTION 'Defined Process tasks cannot be deleted directly.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_guard_defined_mutation ON public.tasks;
CREATE TRIGGER trg_tasks_guard_defined_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_guard_defined_task_mutation();

CREATE OR REPLACE FUNCTION private.trg_fn_guard_defined_task_list_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_is_trusted boolean;
BEGIN
  v_is_trusted := (
    current_user = 'postgres'
    AND current_setting('sns.process_engine_write', true) = 'on'
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_trusted THEN
      IF NEW.task_list_type = 'defined' THEN
        RAISE EXCEPTION 'Defined Process task lists cannot be created directly.';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.task_list_type = 'defined' THEN
      IF NOT v_is_trusted THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
           OR NEW.task_list_type IS DISTINCT FROM OLD.task_list_type
           OR NEW.defined_process_id IS DISTINCT FROM OLD.defined_process_id
           OR NEW.defined_process_version_id IS DISTINCT FROM OLD.defined_process_version_id
           OR NEW.process_state IS DISTINCT FROM OLD.process_state
           OR NEW.started_by IS DISTINCT FROM OLD.started_by
           OR NEW.started_at IS DISTINCT FROM OLD.started_at
           OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
           OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
           OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
           OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'Direct modification of Defined Process task list lifecycle fields is prohibited.';
        END IF;
      END IF;
    ELSE
      IF NOT v_is_trusted THEN
        IF NEW.task_list_type = 'defined' THEN
          RAISE EXCEPTION 'Cannot convert a custom task list into a Defined Process task list directly.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.task_list_type = 'defined' THEN
      IF NOT v_is_trusted THEN
        RAISE EXCEPTION 'Defined Process task lists cannot be deleted directly.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_lists_guard_defined_mutation ON public.task_lists;
CREATE TRIGGER trg_task_lists_guard_defined_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.task_lists
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_guard_defined_task_list_mutation();

-- ── 4. RLS Policy Hardening ─────────────────────────────────────────────────
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

DROP POLICY IF EXISTS "task_raci_manage" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_insert_member" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_update_member" ON public.task_raci_assignments;
DROP POLICY IF EXISTS "task_raci_delete_member" ON public.task_raci_assignments;

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

-- SNS Projects — Defined Process Engine MVP (Complete Backend Vertical Slice)
-- Implements:
-- 1. Runtime history tables (completions, consultations, evidence, approval cycles, audit events)
-- 2. Live task RACI response_required support
-- 3. Working-day due-date calculation helper
-- 4. Process publication validation RPC (publish_defined_process_version)
-- 5. Start Defined Process RPC (start_defined_process)
-- 6. Responsible completion RPC (complete_responsible_part)
-- 7. Consultation submission RPC (submit_task_consultation)
-- 8. Evidence submission RPC (submit_task_evidence)
-- 9. Accountable approval RPC (approve_process_task)
-- 10. Rejection / rework RPC (reject_process_task)
-- 11. Centralized completion helper & DAG dependency activation (complete_task_and_advance)
-- 12. Automatic process completion & workflow notifications
-- 13. Baseline working calendar seed

-- ============================================================================
-- 0. EXPAND NOTIFICATION TYPES
-- ============================================================================

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
    'system',
    'process_task_ready',
    'process_task_completed',
    'consultation_required',
    'approval_required',
    'task_rework_required',
    'process_completed'
  ));

-- ============================================================================
-- 1. RUNTIME HISTORY TABLES
-- ============================================================================

-- 1.1 task_responsible_completions
CREATE TABLE IF NOT EXISTS public.task_responsible_completions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number    integer NOT NULL CHECK (cycle_number >= 1),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  completion_note text NULL,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_resp_completion UNIQUE (task_id, cycle_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_resp_comp_task_cycle
  ON public.task_responsible_completions (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_resp_comp_user
  ON public.task_responsible_completions (user_id);

ALTER TABLE public.task_responsible_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_resp_comp_select_member" ON public.task_responsible_completions;
CREATE POLICY "task_resp_comp_select_member"
  ON public.task_responsible_completions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_responsible_completions.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.2 task_consultation_responses
CREATE TABLE IF NOT EXISTS public.task_consultation_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number    integer NOT NULL CHECK (cycle_number >= 1),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  response_text   text NOT NULL CHECK (btrim(response_text) <> ''),
  responded_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_consult_resp UNIQUE (task_id, cycle_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_consult_resp_task_cycle
  ON public.task_consultation_responses (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_consult_resp_user
  ON public.task_consultation_responses (user_id);

ALTER TABLE public.task_consultation_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_consult_resp_select_member" ON public.task_consultation_responses;
CREATE POLICY "task_consult_resp_select_member"
  ON public.task_consultation_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_consultation_responses.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.3 task_evidence_submissions
CREATE TABLE IF NOT EXISTS public.task_evidence_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number    integer NOT NULL CHECK (cycle_number >= 1),
  evidence_def_id uuid NULL REFERENCES public.defined_process_step_evidence_defs(id) ON DELETE RESTRICT,
  evidence_type   text NOT NULL CHECK (evidence_type IN ('text', 'link')),
  payload         jsonb NOT NULL,
  submitted_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_evidence_task_cycle
  ON public.task_evidence_submissions (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_evidence_def
  ON public.task_evidence_submissions (evidence_def_id);

CREATE INDEX IF NOT EXISTS idx_task_evidence_submitted_by
  ON public.task_evidence_submissions (submitted_by);

ALTER TABLE public.task_evidence_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_evidence_select_member" ON public.task_evidence_submissions;
CREATE POLICY "task_evidence_select_member"
  ON public.task_evidence_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_evidence_submissions.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.4 task_approval_cycles
CREATE TABLE IF NOT EXISTS public.task_approval_cycles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  cycle_number     integer NOT NULL CHECK (cycle_number >= 1),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by       uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decided_at       timestamptz NULL,
  rejection_reason text NULL,
  new_due_date     date NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_approval_cycle UNIQUE (task_id, cycle_number),
  CONSTRAINT chk_task_approval_cycle_decision CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND rejection_reason IS NULL AND new_due_date IS NULL)
    OR
    (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NULL AND new_due_date IS NULL)
    OR
    (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '' AND new_due_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_task_approval_task_cycle
  ON public.task_approval_cycles (task_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_task_approval_decided_by
  ON public.task_approval_cycles (decided_by);

ALTER TABLE public.task_approval_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_approval_select_member" ON public.task_approval_cycles;
CREATE POLICY "task_approval_select_member"
  ON public.task_approval_cycles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.id = task_approval_cycles.task_id
        AND private.is_workspace_active_member(p.workspace_id)
    )
  );

-- 1.5 process_audit_events
CREATE TABLE IF NOT EXISTS public.process_audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  project_id   uuid NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  task_list_id uuid NULL REFERENCES public.task_lists(id) ON DELETE RESTRICT,
  task_id      uuid NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  event_type   text NOT NULL,
  actor_id     uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_process_audit_ws_created
  ON public.process_audit_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_process_audit_project
  ON public.process_audit_events (project_id);

CREATE INDEX IF NOT EXISTS idx_process_audit_task_list
  ON public.process_audit_events (task_list_id);

CREATE INDEX IF NOT EXISTS idx_process_audit_task
  ON public.process_audit_events (task_id);

CREATE INDEX IF NOT EXISTS idx_process_audit_actor
  ON public.process_audit_events (actor_id);

ALTER TABLE public.process_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "process_audit_select_member" ON public.process_audit_events;
CREATE POLICY "process_audit_select_member"
  ON public.process_audit_events
  FOR SELECT
  TO authenticated
  USING (
    private.is_workspace_active_member(workspace_id)
  );


-- ============================================================================
-- 2. ALTER task_raci_assignments (response_required)
-- ============================================================================

ALTER TABLE public.task_raci_assignments
  ADD COLUMN IF NOT EXISTS response_required boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_raci_response_required') THEN
    ALTER TABLE public.task_raci_assignments
      ADD CONSTRAINT chk_task_raci_response_required CHECK (response_required = false OR raci_role = 'C');
  END IF;
END $$;


-- ============================================================================
-- 3. WORKING DAY CALCULATION HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION private.add_working_days(
  p_workspace_id   uuid,
  p_start_date     date,
  p_duration_days  integer
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cal RECORD;
  v_curr_date date;
  v_working_counted integer := 0;
  v_dow integer;
  v_is_working boolean;
  v_is_holiday boolean;
BEGIN
  IF p_duration_days IS NULL OR p_duration_days < 1 THEN
    RAISE EXCEPTION 'Duration must be at least 1 working day.';
  END IF;

  SELECT * INTO v_cal
  FROM public.workspace_working_calendars
  WHERE workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Working calendar is not configured for this workspace.';
  END IF;

  v_curr_date := p_start_date;

  WHILE v_working_counted < p_duration_days LOOP
    -- Extract day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    v_dow := EXTRACT(DOW FROM v_curr_date);

    v_is_working := CASE v_dow
      WHEN 0 THEN v_cal.sunday_working
      WHEN 1 THEN v_cal.monday_working
      WHEN 2 THEN v_cal.tuesday_working
      WHEN 3 THEN v_cal.wednesday_working
      WHEN 4 THEN v_cal.thursday_working
      WHEN 5 THEN v_cal.friday_working
      WHEN 6 THEN v_cal.saturday_working
      ELSE false
    END;

    IF v_is_working THEN
      SELECT EXISTS (
        SELECT 1 FROM public.workspace_holidays
        WHERE workspace_id = p_workspace_id AND holiday_date = v_curr_date
      ) INTO v_is_holiday;

      IF NOT v_is_holiday THEN
        v_working_counted := v_working_counted + 1;
        IF v_working_counted = p_duration_days THEN
          RETURN v_curr_date;
        END IF;
      END IF;
    END IF;

    v_curr_date := v_curr_date + 1;
  END LOOP;

  RETURN v_curr_date;
END;
$$;


-- ============================================================================
-- 4. PUBLISH DEFINED PROCESS VERSION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_defined_process_version(
  p_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id    uuid;
  v_version      RECORD;
  v_process      RECORD;
  v_step_count   integer;
  v_root_count   integer;
  v_root_step    RECORD;
  v_invalid_raci RECORD;
  v_step         RECORD;
  v_r_count      integer;
  v_a_count      integer;
  v_req_c_count  integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_version
  FROM public.defined_process_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft process versions can be published.';
  END IF;

  SELECT * INTO v_process
  FROM public.defined_processes
  WHERE id = v_version.defined_process_id;

  -- Verify publication authorization:
  -- Department Head of owning department OR project_admin / system_admin OR workspace owner/admin
  IF NOT (
    (SELECT private.get_user_workspace_role(v_process.workspace_id)) IN ('owner', 'admin')
    OR
    (SELECT private.has_system_role(v_process.workspace_id, 'project_admin'))
    OR
    (SELECT private.has_system_role(v_process.workspace_id, 'system_admin'))
    OR
    EXISTS (
      SELECT 1 FROM public.department_memberships dm
      WHERE dm.department_id = v_process.department_id
        AND dm.user_id = v_caller_id
        AND dm.role = 'head'
        AND dm.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Insufficient authority to publish this process version.';
  END IF;

  -- 1. Step count check (>= 1)
  SELECT count(*) INTO v_step_count
  FROM public.defined_process_steps
  WHERE version_id = p_version_id;

  IF v_step_count < 1 THEN
    RAISE EXCEPTION 'Process version must contain at least one step.';
  END IF;

  -- 2. Root step check (exactly 1 root with sequence_order = 1)
  SELECT count(*) INTO v_root_count
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF v_root_count <> 1 THEN
    RAISE EXCEPTION 'Process version must have exactly one root step (found %)', v_root_count;
  END IF;

  SELECT * INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF v_root_step.sequence_order <> 1 THEN
    RAISE EXCEPTION 'Root step must have sequence_order = 1.';
  END IF;

  -- 3. Reachability & DAG cycle check
  -- Reachable steps from root using BFS/DFS
  WITH RECURSIVE reachable AS (
    SELECT v_root_step.id AS step_id
    UNION
    SELECT d.step_id
    FROM public.defined_process_step_dependencies d
    JOIN reachable r ON r.step_id = d.depends_on_step_id
    WHERE d.version_id = p_version_id
  )
  SELECT count(DISTINCT step_id) INTO v_root_count FROM reachable;

  IF v_root_count <> v_step_count THEN
    RAISE EXCEPTION 'Every step in the process must be reachable from the root step without cycles.';
  END IF;

  -- 4. Check each step's RACI, durations, approvals, consultations
  FOR v_step IN
    SELECT * FROM public.defined_process_steps WHERE version_id = p_version_id
  LOOP
    IF v_step.expected_duration_days < 1 THEN
      RAISE EXCEPTION 'Step % (%) duration must be >= 1 working day.', v_step.step_code, v_step.title;
    END IF;

    -- Count R and A
    SELECT
      count(*) FILTER (WHERE raci_role = 'R'),
      count(*) FILTER (WHERE raci_role = 'A'),
      count(*) FILTER (WHERE raci_role = 'C' AND response_required = true)
    INTO v_r_count, v_a_count, v_req_c_count
    FROM public.defined_process_step_raci
    WHERE step_id = v_step.id;

    IF v_r_count < 1 THEN
      RAISE EXCEPTION 'Step % (%) must have at least one Responsible (R) assignment.', v_step.step_code, v_step.title;
    END IF;

    IF v_a_count <> 1 THEN
      RAISE EXCEPTION 'Step % (%) must have exactly one Accountable (A) assignment (found %).', v_step.step_code, v_step.title, v_a_count;
    END IF;

    -- approval_required => Accountable user cannot be in Responsible set
    IF v_step.approval_required THEN
      IF EXISTS (
        SELECT 1 FROM public.defined_process_step_raci r
        WHERE r.step_id = v_step.id AND r.raci_role = 'R' AND r.user_id = (
          SELECT a.user_id FROM public.defined_process_step_raci a
          WHERE a.step_id = v_step.id AND a.raci_role = 'A'
        )
      ) THEN
        RAISE EXCEPTION 'Step % requires approval, so Accountable cannot be in the Responsible set.', v_step.step_code;
      END IF;
    END IF;

    -- consultation_required => >= 1 C with response_required = true
    IF v_step.consultation_required AND v_req_c_count < 1 THEN
      RAISE EXCEPTION 'Step % requires consultation, so at least one Consulted (C) must have response_required = true.', v_step.step_code;
    END IF;
  END LOOP;

  -- 5. Validate that all RACI users are active workspace members
  SELECT r.user_id, p.full_name INTO v_invalid_raci
  FROM public.defined_process_step_raci r
  JOIN public.defined_process_steps s ON s.id = r.step_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE s.version_id = p_version_id
    AND r.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = v_process.workspace_id
        AND wm.user_id = r.user_id
        AND wm.status = 'active'
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'RACI user % is not an active workspace member.', COALESCE(v_invalid_raci.full_name, v_invalid_raci.user_id::text);
  END IF;

  -- 6. Perform atomic publication
  -- Archive previously published versions
  UPDATE public.defined_process_versions
  SET status = 'archived'
  WHERE defined_process_id = v_process.id AND status = 'published';

  -- Publish target version
  UPDATE public.defined_process_versions
  SET status = 'published',
      published_by = v_caller_id,
      published_at = now()
  WHERE id = p_version_id;

  -- Record audit event
  INSERT INTO public.process_audit_events (
    workspace_id,
    event_type,
    actor_id,
    payload
  ) VALUES (
    v_process.workspace_id,
    'PROCESS_VERSION_PUBLISHED',
    v_caller_id,
    jsonb_build_object(
      'process_id', v_process.id,
      'version_id', p_version_id,
      'version_number', v_version.version_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'version_id', p_version_id,
    'status', 'published'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_defined_process_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_defined_process_version(uuid) TO authenticated;


-- ============================================================================
-- 5. CENTRALIZED COMPLETION & DAG PROPAGATION HELPER (PRIVATE)
-- ============================================================================

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
  v_task_list      RECORD;
  v_workspace_id   uuid;
  v_project        RECORD;
  v_done_status_id uuid;
  v_todo_status_id uuid;
  v_recipient      RECORD;
  v_downstream     RECORD;
  v_all_preds_done boolean;
  v_due_date       date;
  v_pending_tasks  integer;
BEGIN
  -- Enable bypass marker for trusted workflow mutation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
  SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
  v_workspace_id := v_project.workspace_id;

  -- Resolve project Done status
  SELECT id INTO v_done_status_id
  FROM public.task_statuses
  WHERE project_id = v_task.project_id AND (system_code = 'done' OR lower(name) = 'done')
  ORDER BY position DESC LIMIT 1;

  IF v_done_status_id IS NULL THEN
    SELECT id INTO v_done_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position DESC LIMIT 1;
  END IF;

  -- Resolve project To Do status
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

  -- 2. Evaluate all downstream tasks in the process instance
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
END;
$$;


-- ============================================================================
-- 6. START DEFINED PROCESS RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_defined_process(
  p_version_id      uuid,
  p_project_id      uuid,
  p_milestone_id    uuid,
  p_instance_name   text,
  p_raci_overrides  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id       uuid;
  v_version         RECORD;
  v_process         RECORD;
  v_project         RECORD;
  v_workspace_id    uuid;
  v_root_step       RECORD;
  v_step            RECORD;
  v_task_list_id    uuid;
  v_root_task_id    uuid;
  v_task_id         uuid;
  v_todo_status_id  uuid;
  v_due_date        date;
  v_is_root         boolean;
  v_task_count      integer := 0;
  v_caller_is_root_r boolean := false;
  v_recipient       RECORD;
  v_raci            RECORD;
  v_pos             integer := 1000;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_instance_name IS NULL OR btrim(p_instance_name) = '' THEN
    RAISE EXCEPTION 'Process instance name is required.';
  END IF;

  -- 1. Validate version and process
  SELECT * INTO v_version FROM public.defined_process_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'published' THEN
    RAISE EXCEPTION 'Process version must be published to be started.';
  END IF;

  SELECT * INTO v_process FROM public.defined_processes WHERE id = v_version.defined_process_id;

  -- 2. Validate project & milestone hierarchy
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target project not found.';
  END IF;

  IF v_project.workspace_id <> v_process.workspace_id THEN
    RAISE EXCEPTION 'Project workspace does not match defined process workspace.';
  END IF;
  v_workspace_id := v_project.workspace_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.milestones m
    WHERE m.id = p_milestone_id AND m.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Milestone does not belong to target project.';
  END IF;

  -- 3. Check workspace calendar exists
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_working_calendars WHERE workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'Working calendar is not configured for this workspace.';
  END IF;

  -- 4. Find root step
  SELECT s.* INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Root step not found for process version.';
  END IF;

  -- 5. CRITICAL START RULE: Caller MUST be in resolved Responsible (R) set for Root Step
  SELECT EXISTS (
    SELECT 1 FROM public.defined_process_step_raci r
    WHERE r.step_id = v_root_step.id AND r.raci_role = 'R' AND r.user_id = v_caller_id
  ) INTO v_caller_is_root_r;

  IF NOT v_caller_is_root_r THEN
    RAISE EXCEPTION 'Caller must be an assigned Responsible user for the root step of this process.';
  END IF;

  -- Resolve default Todo status
  SELECT id INTO v_todo_status_id
  FROM public.task_statuses
  WHERE project_id = p_project_id AND (system_code = 'todo' OR lower(name) = 'to do')
  ORDER BY position ASC LIMIT 1;

  IF v_todo_status_id IS NULL THEN
    SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = p_project_id ORDER BY position ASC LIMIT 1;
  END IF;

  -- Enable trusted bypass for creation of defined process instance
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 6. Insert live task_lists instance
  INSERT INTO public.task_lists (
    project_id,
    milestone_id,
    name,
    task_list_type,
    defined_process_id,
    defined_process_version_id,
    process_state,
    started_by,
    started_at
  ) VALUES (
    p_project_id,
    p_milestone_id,
    p_instance_name,
    'defined',
    v_process.id,
    p_version_id,
    'active',
    v_caller_id,
    now()
  ) RETURNING id INTO v_task_list_id;

  -- 7. Insert all defined tasks in this version
  FOR v_step IN
    SELECT * FROM public.defined_process_steps
    WHERE version_id = p_version_id
    ORDER BY sequence_order ASC
  LOOP
    v_is_root := (v_step.id = v_root_step.id);
    v_task_count := v_task_count + 1;
    v_pos := v_pos + 1000;

    IF v_is_root THEN
      v_due_date := private.add_working_days(v_workspace_id, CURRENT_DATE, v_step.expected_duration_days);

      INSERT INTO public.tasks (
        project_id,
        milestone_id,
        task_list_id,
        title,
        description,
        status_id,
        defined_process_version_id,
        process_step_id,
        workflow_state,
        current_cycle_number,
        ready_at,
        due_date,
        overdue_cycle_notified,
        position,
        created_by
      ) VALUES (
        p_project_id,
        p_milestone_id,
        v_task_list_id,
        v_step.title,
        v_step.description,
        v_todo_status_id,
        p_version_id,
        v_step.id,
        'ready',
        1,
        now(),
        v_due_date,
        false,
        v_pos,
        v_caller_id
      ) RETURNING id INTO v_task_id;

      v_root_task_id := v_task_id;
    ELSE
      INSERT INTO public.tasks (
        project_id,
        milestone_id,
        task_list_id,
        title,
        description,
        status_id,
        defined_process_version_id,
        process_step_id,
        workflow_state,
        current_cycle_number,
        ready_at,
        due_date,
        overdue_cycle_notified,
        position,
        created_by
      ) VALUES (
        p_project_id,
        p_milestone_id,
        v_task_list_id,
        v_step.title,
        v_step.description,
        v_todo_status_id,
        p_version_id,
        v_step.id,
        'waiting',
        1,
        NULL,
        NULL,
        false,
        v_pos,
        v_caller_id
      ) RETURNING id INTO v_task_id;
    END IF;

    -- Instantiate task_raci_assignments for this task from template
    FOR v_raci IN
      SELECT * FROM public.defined_process_step_raci WHERE step_id = v_step.id
    LOOP
      INSERT INTO public.task_raci_assignments (
        task_id,
        raci_role,
        user_id,
        response_required
      ) VALUES (
        v_task_id,
        v_raci.raci_role,
        v_raci.user_id,
        COALESCE(v_raci.response_required, false)
      );
    END LOOP;
  END LOOP;

  -- 8. Audit events & notifications for root task
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, p_project_id, v_task_list_id, 'PROCESS_STARTED', v_caller_id,
    jsonb_build_object('instance_name', p_instance_name, 'version_id', p_version_id, 'task_count', v_task_count)
  );

  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, p_project_id, v_task_list_id, v_root_task_id, 'TASK_READY', v_caller_id,
    jsonb_build_object('step_id', v_root_step.id, 'due_date', v_due_date)
  );

  -- Notify root task participants only
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_root_task_id AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = v_root_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_task_ready',
      'Process Task Ready: ' || v_root_step.title,
      'Process "' || p_instance_name || '" has started and root step is ready.',
      'task',
      v_root_task_id,
      p_project_id,
      v_root_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'task_list_id', v_task_list_id,
    'root_task_id', v_root_task_id,
    'task_count', v_task_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_defined_process(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_defined_process(uuid, uuid, uuid, text, jsonb) TO authenticated;


-- ============================================================================
-- 7. RESPONSIBLE COMPLETION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_responsible_part(
  p_task_id uuid,
  p_note    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id       uuid;
  v_task            RECORD;
  v_step            RECORD;
  v_task_list       RECORD;
  v_workspace_id    uuid;
  v_is_responsible  boolean := false;
  v_total_r_count   integer;
  v_done_r_count    integer;
  v_pending_subtasks integer;
  v_missing_evidence integer;
  v_pending_c_count integer;
  v_recipient       RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state NOT IN ('ready', 'active', 'rework_required') THEN
    RAISE EXCEPTION 'Task is not in an actionable state (current state: %).', v_task.workflow_state;
  END IF;

  SELECT * INTO v_step FROM public.defined_process_steps WHERE id = v_task.process_step_id;
  SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p WHERE p.id = v_task.project_id;

  -- Verify caller has R assignment
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

  -- Check if already completed this cycle
  IF EXISTS (
    SELECT 1 FROM public.task_responsible_completions
    WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Responsible completion already submitted for this cycle.';
  END IF;

  -- Insert completion record
  INSERT INTO public.task_responsible_completions (
    task_id, cycle_number, user_id, completion_note
  ) VALUES (
    p_task_id, v_task.current_cycle_number, v_caller_id, p_note
  );

  -- Count total assigned R users vs completed R users for this cycle
  WITH distinct_r_users AS (
    SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.user_id IS NOT NULL
    UNION
    SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
    JOIN public.department_memberships dm ON dm.department_id = ra.department_id
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.department_id IS NOT NULL AND dm.is_active = true
  )
  SELECT count(*) INTO v_total_r_count FROM distinct_r_users;

  SELECT count(DISTINCT user_id) INTO v_done_r_count
  FROM public.task_responsible_completions
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  IF v_done_r_count < v_total_r_count THEN
    -- Transition to active if was ready/rework_required
    IF v_task.workflow_state <> 'active' THEN
      PERFORM set_config('sns.process_engine_write', 'on', true);
      UPDATE public.tasks SET workflow_state = 'active', activated_at = COALESCE(activated_at, now()) WHERE id = p_task_id;
    END IF;

    RETURN jsonb_build_object(
      'completed', false,
      'workflow_state', 'active',
      'remaining_responsible', v_total_r_count - v_done_r_count
    );
  END IF;

  -- All Responsible users completed! Check subtasks & evidence
  -- Check non-cancelled subtasks
  SELECT count(*) INTO v_pending_subtasks
  FROM public.subtasks
  WHERE task_id = p_task_id AND status NOT IN ('done', 'cancelled');

  IF v_pending_subtasks > 0 THEN
    RAISE EXCEPTION 'All subtasks must be completed before completing the task (% pending).', v_pending_subtasks;
  END IF;

  -- Check required evidence definitions
  SELECT count(*) INTO v_missing_evidence
  FROM public.defined_process_step_evidence_defs ed
  WHERE ed.step_id = v_step.id AND ed.is_mandatory = true
    AND NOT EXISTS (
      SELECT 1 FROM public.task_evidence_submissions es
      WHERE es.task_id = p_task_id AND es.evidence_def_id = ed.id AND es.cycle_number = v_task.current_cycle_number
    );

  IF v_missing_evidence > 0 THEN
    RAISE EXCEPTION 'Required evidence submission missing (% definitions pending).', v_missing_evidence;
  END IF;

  -- Check Consultation requirement
  IF v_step.consultation_required THEN
    SELECT count(*) INTO v_pending_c_count
    FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true
      AND NOT EXISTS (
        SELECT 1 FROM public.task_consultation_responses cr
        WHERE cr.task_id = p_task_id AND cr.cycle_number = v_task.current_cycle_number
          AND (cr.user_id = ra.user_id OR (ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm WHERE dm.department_id = ra.department_id AND dm.user_id = cr.user_id AND dm.is_active = true
          )))
      );

    IF v_pending_c_count > 0 THEN
      PERFORM set_config('sns.process_engine_write', 'on', true);
      UPDATE public.tasks SET workflow_state = 'awaiting_consultation' WHERE id = p_task_id;

      -- Notify Consulted users
      FOR v_recipient IN
        SELECT DISTINCT u_id FROM (
          SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true AND ra.user_id IS NOT NULL
          UNION
          SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
          JOIN public.department_memberships dm ON dm.department_id = ra.department_id
          WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true AND ra.department_id IS NOT NULL AND dm.is_active = true
        ) sub WHERE u_id IS NOT NULL
      LOOP
        PERFORM private.emit_notification(
          v_workspace_id,
          v_recipient.u_id,
          'consultation_required',
          'Consultation required: ' || v_task.title,
          'Your input is required for task "' || v_task.title || '" in process "' || v_task_list.name || '".',
          'task',
          p_task_id,
          v_task.project_id,
          p_task_id
        );
      END LOOP;

      RETURN jsonb_build_object(
        'completed', false,
        'workflow_state', 'awaiting_consultation',
        'pending_consultations', v_pending_c_count
      );
    END IF;
  END IF;

  -- Check Approval requirement
  IF v_step.approval_required THEN
    PERFORM set_config('sns.process_engine_write', 'on', true);
    UPDATE public.tasks SET workflow_state = 'awaiting_approval' WHERE id = p_task_id;

    -- Create pending approval cycle
    INSERT INTO public.task_approval_cycles (
      task_id, cycle_number, status
    ) VALUES (
      p_task_id, v_task.current_cycle_number, 'pending'
    ) ON CONFLICT (task_id, cycle_number) DO NOTHING;

    -- Notify Accountable (A)
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'approval_required',
        'Approval required: ' || v_task.title,
        'Task "' || v_task.title || '" has completed work and is awaiting your approval.',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    RETURN jsonb_build_object(
      'completed', false,
      'workflow_state', 'awaiting_approval'
    );
  END IF;

  -- No consultation or approval pending: complete task directly
  PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

  RETURN jsonb_build_object(
    'completed', true,
    'workflow_state', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_responsible_part(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_responsible_part(uuid, text) TO authenticated;


-- ============================================================================
-- 8. CONSULTATION SUBMISSION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_task_consultation(
  p_task_id   uuid,
  p_response  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id        uuid;
  v_task             RECORD;
  v_step             RECORD;
  v_task_list        RECORD;
  v_workspace_id     uuid;
  v_is_consulted     boolean := false;
  v_pending_c_count  integer;
  v_recipient        RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_response IS NULL OR btrim(p_response) = '' THEN
    RAISE EXCEPTION 'Response text cannot be empty.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'awaiting_consultation' THEN
    RAISE EXCEPTION 'Task is not awaiting consultation (current state: %).', v_task.workflow_state;
  END IF;

  SELECT * INTO v_step FROM public.defined_process_steps WHERE id = v_task.process_step_id;
  SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p WHERE p.id = v_task.project_id;

  -- Verify caller has C assignment
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'C'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_consulted;

  IF NOT v_is_consulted THEN
    RAISE EXCEPTION 'Caller is not an assigned Consulted user for this task.';
  END IF;

  -- Insert consultation response
  INSERT INTO public.task_consultation_responses (
    task_id, cycle_number, user_id, response_text
  ) VALUES (
    p_task_id, v_task.current_cycle_number, v_caller_id, p_response
  ) ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET response_text = EXCLUDED.response_text, responded_at = now();

  -- Check if all required C have responded
  SELECT count(*) INTO v_pending_c_count
  FROM public.task_raci_assignments ra
  WHERE ra.task_id = p_task_id AND ra.raci_role = 'C' AND ra.response_required = true
    AND NOT EXISTS (
      SELECT 1 FROM public.task_consultation_responses cr
      WHERE cr.task_id = p_task_id AND cr.cycle_number = v_task.current_cycle_number
        AND (cr.user_id = ra.user_id OR (ra.department_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.department_memberships dm WHERE dm.department_id = ra.department_id AND dm.user_id = cr.user_id AND dm.is_active = true
        )))
    );

  IF v_pending_c_count > 0 THEN
    RETURN jsonb_build_object(
      'consultation_complete', false,
      'remaining_consultations', v_pending_c_count
    );
  END IF;

  -- All required consultations completed!
  IF v_step.approval_required THEN
    PERFORM set_config('sns.process_engine_write', 'on', true);
    UPDATE public.tasks SET workflow_state = 'awaiting_approval' WHERE id = p_task_id;

    INSERT INTO public.task_approval_cycles (
      task_id, cycle_number, status
    ) VALUES (
      p_task_id, v_task.current_cycle_number, 'pending'
    ) ON CONFLICT (task_id, cycle_number) DO NOTHING;

    -- Notify Accountable
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'approval_required',
        'Approval required: ' || v_task.title,
        'Consultations finished. Task "' || v_task.title || '" is awaiting your approval.',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    RETURN jsonb_build_object(
      'consultation_complete', true,
      'workflow_state', 'awaiting_approval'
    );
  ELSE
    PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

    RETURN jsonb_build_object(
      'consultation_complete', true,
      'workflow_state', 'completed'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_task_consultation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_consultation(uuid, text) TO authenticated;


-- ============================================================================
-- 9. EVIDENCE SUBMISSION RPC
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.submit_task_evidence(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_evidence(uuid, uuid, text, jsonb) TO authenticated;


-- ============================================================================
-- 10. ACCOUNTABLE APPROVAL RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_process_task(
  p_task_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id     uuid;
  v_task          RECORD;
  v_is_accountable boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Task is not awaiting approval (current state: %).', v_task.workflow_state;
  END IF;

  -- Verify caller is Accountable (A)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'A'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_accountable;

  IF NOT v_is_accountable THEN
    RAISE EXCEPTION 'Caller is not the assigned Accountable user for this task.';
  END IF;

  -- Update approval cycle
  UPDATE public.task_approval_cycles
  SET status = 'approved',
      decided_by = v_caller_id,
      decided_at = now()
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  -- Complete task and advance workflow
  PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

  RETURN jsonb_build_object(
    'success', true,
    'workflow_state', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_process_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_process_task(uuid) TO authenticated;


-- ============================================================================
-- 11. ACCOUNTABLE REJECTION / REWORK RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_process_task(
  p_task_id      uuid,
  p_reason       text,
  p_new_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id      uuid;
  v_task           RECORD;
  v_task_list      RECORD;
  v_workspace_id   uuid;
  v_is_accountable boolean := false;
  v_new_cycle      integer;
  v_recipient      RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required.';
  END IF;

  IF p_new_due_date IS NULL OR p_new_due_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'New due date must be today or a future date.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Task is not awaiting approval (current state: %).', v_task.workflow_state;
  END IF;

  SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p WHERE p.id = v_task.project_id;

  -- Verify caller is Accountable (A)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'A'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_accountable;

  IF NOT v_is_accountable THEN
    RAISE EXCEPTION 'Caller is not the assigned Accountable user for this task.';
  END IF;

  v_new_cycle := v_task.current_cycle_number + 1;

  -- Enable bypass marker
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- Update current approval cycle to rejected
  UPDATE public.task_approval_cycles
  SET status = 'rejected',
      decided_by = v_caller_id,
      decided_at = now(),
      rejection_reason = p_reason,
      new_due_date = p_new_due_date
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  -- Update task state to rework_required and increment cycle
  UPDATE public.tasks
  SET current_cycle_number = v_new_cycle,
      workflow_state = 'rework_required',
      due_date = p_new_due_date,
      overdue_cycle_notified = false
  WHERE id = p_task_id;

  -- Audit event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_REWORK_REQUIRED', v_caller_id,
    jsonb_build_object(
      'previous_cycle', v_task.current_cycle_number,
      'new_cycle', v_new_cycle,
      'reason', p_reason,
      'new_due_date', p_new_due_date
    )
  );

  -- Notify RACI
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = p_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL AND u_id <> v_caller_id
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'task_rework_required',
      'Rework required: ' || v_task.title,
      'Task "' || v_task.title || '" was rejected. Reason: ' || p_reason,
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'workflow_state', 'rework_required',
    'new_cycle_number', v_new_cycle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_process_task(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_process_task(uuid, text, date) TO authenticated;


-- ============================================================================
-- 12. SEED WORKSPACE WORKING CALENDAR
-- ============================================================================

INSERT INTO public.workspace_working_calendars (
  workspace_id,
  timezone,
  monday_working,
  tuesday_working,
  wednesday_working,
  thursday_working,
  friday_working,
  saturday_working,
  sunday_working,
  created_by
)
SELECT
  w.id,
  'Asia/Kolkata',
  true, true, true, true, true, false, false,
  w.created_by
FROM public.workspaces w
WHERE w.id = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea'
  AND NOT EXISTS (
    SELECT 1 FROM public.workspace_working_calendars cal WHERE cal.workspace_id = w.id
  );

-- SNS Projects — MVP Runtime History Table Grant Hardening
-- Revoke all direct mutation permissions from PUBLIC, anon, and authenticated
-- Grant SELECT ONLY to authenticated on runtime history tables

-- 1. task_responsible_completions
REVOKE ALL ON TABLE public.task_responsible_completions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_responsible_completions TO authenticated;

-- 2. task_consultation_responses
REVOKE ALL ON TABLE public.task_consultation_responses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_consultation_responses TO authenticated;

-- 3. task_evidence_submissions
REVOKE ALL ON TABLE public.task_evidence_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_evidence_submissions TO authenticated;

-- 4. task_approval_cycles
REVOKE ALL ON TABLE public.task_approval_cycles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_approval_cycles TO authenticated;

-- 5. process_audit_events
REVOKE ALL ON TABLE public.process_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.process_audit_events TO authenticated;
