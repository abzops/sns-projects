-- ============================================================================
-- ONE-SHOT FIX: RLS policies, triggers, cleanup
-- ============================================================================
-- Paste this entire file into Supabase SQL Editor and click Run.
-- It is safe to run multiple times (idempotent).
-- ============================================================================

-- ── 0. Ensure profile exists for current user ───────────────────────────────
INSERT INTO public.profiles (id)
SELECT id FROM auth.users WHERE email = 'abhinand@stacknstock.in'
ON CONFLICT (id) DO NOTHING;

-- ── 1. Clean up duplicate workspaces (keep only the first one) ──────────────
-- Delete duplicates of "SNS Projects Dataset" (keep oldest)
DELETE FROM public.workspaces
WHERE name = 'SNS Projects Dataset'
  AND id != (
    SELECT id FROM public.workspaces
    WHERE name = 'SNS Projects Dataset'
    ORDER BY created_at ASC
    LIMIT 1
  );

-- ── 2. Helper function ─────────────────────────────────────────────────────
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

-- ── 3. Triggers ─────────────────────────────────────────────────────────────

-- Auto-create profile on sign-up
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Seed default statuses when a project is created
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


-- ── 4. Enable RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_statuses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks             ENABLE ROW LEVEL SECURITY;


-- ── 5. Drop all existing policies (safe cleanup) ────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','workspaces','workspace_members','projects','task_statuses','tasks')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;


-- ── 6. Create RLS Policies ─────────────────────────────────────────────────

-- profiles
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- workspaces
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
  USING (get_user_workspace_role(id) = 'owner')
  WITH CHECK (get_user_workspace_role(id) = 'owner');

CREATE POLICY "workspaces_delete_owner"
  ON public.workspaces FOR DELETE
  TO authenticated
  USING (get_user_workspace_role(id) = 'owner');

-- workspace_members
CREATE POLICY "workspace_members_select_active"
  ON public.workspace_members FOR SELECT
  TO authenticated
  USING (
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
    OR (user_id = auth.uid() AND status = 'pending')
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

-- projects
CREATE POLICY "projects_select_member"
  ON public.projects FOR SELECT
  TO authenticated
  USING (get_user_workspace_role(workspace_id) IS NOT NULL);

CREATE POLICY "projects_insert_member"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member'));

CREATE POLICY "projects_update_member"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member'))
  WITH CHECK (get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member'));

CREATE POLICY "projects_delete_admin_owner"
  ON public.projects FOR DELETE
  TO authenticated
  USING (get_user_workspace_role(workspace_id) IN ('owner', 'admin'));

-- task_statuses
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

-- tasks
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


-- ── 7. Performance indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON public.workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user      ON public.workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace           ON public.projects (workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_statuses_project        ON public.task_statuses (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project                ON public.tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status                 ON public.tasks (status_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee               ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_position ON public.tasks (project_id, status_id, position);

-- ============================================================================
-- Done! Refresh your website.
-- ============================================================================
