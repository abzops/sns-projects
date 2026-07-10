-- ============================================================================
-- StacknStock Projects – Complete Database Schema
-- ============================================================================
-- Run this file against your Supabase project's SQL editor.
-- It creates all tables, functions, triggers, and RLS policies.
-- ============================================================================


-- ── Helper Function: get_user_workspace_role ─────────────────────────────────
-- Returns the authenticated user's role in a given workspace, or NULL if not
-- an active member. Used extensively by RLS policies.
-- ─────────────────────────────────────────────────────────────────────────────

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

COMMENT ON TABLE public.workspaces IS 'Top-level organisational unit that groups projects.';


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


-- ── 4. projects ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  color        text DEFAULT '#f5c400',
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.projects IS 'A project lives inside a workspace and contains task boards.';


-- ── 5. task_statuses ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_statuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL,
  position   integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_statuses IS 'Kanban columns – ordered status buckets for a project.';


-- ── 6. tasks ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  status_id   uuid REFERENCES public.task_statuses(id),
  priority    text CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')) DEFAULT 'none',
  assignee_id uuid REFERENCES public.profiles(id),
  due_date    date,
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tasks IS 'Individual work items within a project.';


-- ============================================================================
-- TRIGGERS & FUNCTIONS
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

-- Drop if exists to make this script re-runnable
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
  INSERT INTO public.task_statuses (project_id, name, color, position)
  VALUES
    (NEW.id, 'To Do',        '#a0a0a0', 0),
    (NEW.id, 'In Progress',  '#8cc9ff', 1),
    (NEW.id, 'In Review',    '#ffb020', 2),
    (NEW.id, 'Done',         '#60d394', 3);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_project_created ON public.projects;

CREATE TRIGGER on_project_created
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_default_statuses();


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================


-- ── Enable RLS on every table ───────────────────────────────────────────────

ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_statuses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks             ENABLE ROW LEVEL SECURITY;


-- ── profiles ────────────────────────────────────────────────────────────────

CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ── workspaces ──────────────────────────────────────────────────────────────

CREATE POLICY "workspaces_select_member"
  ON public.workspaces FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_members.workspace_id = workspaces.id
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.status = 'active'
    )
  );

CREATE POLICY "workspaces_insert_authenticated"
  ON public.workspaces FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "workspaces_update_owner"
  ON public.workspaces FOR UPDATE
  TO authenticated
  USING (
    get_user_workspace_role(id) = 'owner'
  )
  WITH CHECK (
    get_user_workspace_role(id) = 'owner'
  );

CREATE POLICY "workspaces_delete_owner"
  ON public.workspaces FOR DELETE
  TO authenticated
  USING (
    get_user_workspace_role(id) = 'owner'
  );


-- ── workspace_members ───────────────────────────────────────────────────────

CREATE POLICY "workspace_members_select_active"
  ON public.workspace_members FOR SELECT
  TO authenticated
  USING (
    -- Active members of the same workspace can see all members
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_members.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.status = 'active'
    )
  );

CREATE POLICY "workspace_members_insert_admin_owner"
  ON public.workspace_members FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin')
    -- Also allow the very first member (workspace creator bootstrapping)
    OR (
      user_id = auth.uid()
      AND role = 'owner'
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_members.workspace_id
      )
    )
  );

CREATE POLICY "workspace_members_update_admin_owner"
  ON public.workspace_members FOR UPDATE
  TO authenticated
  USING (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin')
    -- Users can accept/decline their own pending invite
    OR (user_id = auth.uid() AND status = 'pending')
    -- Handle pending invites by email match
    OR (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()) AND status = 'pending')
  )
  WITH CHECK (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin')
    OR (user_id = auth.uid())
    OR (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );

CREATE POLICY "workspace_members_delete_admin_owner"
  ON public.workspace_members FOR DELETE
  TO authenticated
  USING (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin')
  );


-- ── projects ────────────────────────────────────────────────────────────────

CREATE POLICY "projects_select_member"
  ON public.projects FOR SELECT
  TO authenticated
  USING (
    get_user_workspace_role(workspace_id) IS NOT NULL
  );

CREATE POLICY "projects_insert_member"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
  );

CREATE POLICY "projects_update_member"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
  );

CREATE POLICY "projects_delete_admin_owner"
  ON public.projects FOR DELETE
  TO authenticated
  USING (
    get_user_workspace_role(workspace_id) IN ('owner', 'admin')
  );


-- ── task_statuses ───────────────────────────────────────────────────────────

CREATE POLICY "task_statuses_select_member"
  ON public.task_statuses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = task_statuses.project_id
        AND get_user_workspace_role(p.workspace_id) IS NOT NULL
    )
  );

CREATE POLICY "task_statuses_insert_member"
  ON public.task_statuses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = task_statuses.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY "task_statuses_update_member"
  ON public.task_statuses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = task_statuses.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = task_statuses.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY "task_statuses_delete_member"
  ON public.task_statuses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = task_statuses.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  );


-- ── tasks ───────────────────────────────────────────────────────────────────

CREATE POLICY "tasks_select_member"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = tasks.project_id
        AND get_user_workspace_role(p.workspace_id) IS NOT NULL
    )
  );

CREATE POLICY "tasks_insert_member"
  ON public.tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = tasks.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY "tasks_update_member"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = tasks.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = tasks.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY "tasks_delete_member"
  ON public.tasks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = tasks.project_id
        AND get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
    )
  );


-- ============================================================================
-- INDEXES (performance)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON public.workspace_members (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON public.workspace_members (user_id);

CREATE INDEX IF NOT EXISTS idx_projects_workspace
  ON public.projects (workspace_id);

CREATE INDEX IF NOT EXISTS idx_task_statuses_project
  ON public.task_statuses (project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_project
  ON public.tasks (project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON public.tasks (status_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee
  ON public.tasks (assignee_id);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status_position
  ON public.tasks (project_id, status_id, position);
