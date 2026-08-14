-- ============================================================================
-- SNS PROJECTS V2 - DAY-0: RELEASE 1.1 SECURITY HARDENING
-- Migration: 20260814_02_security_hardening.sql
--
-- Forward-only relative to 20260814_01_day0_foundation.sql.
-- Addresses three verified vulnerabilities:
--   1. SECURITY DEFINER helpers exposed as public RPCs
--   2. Overly permissive notification INSERT
--   3. Unrestricted notification UPDATE columns
-- Also: trigger-function lockdown, default privilege hardening.
-- ============================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: CREATE PRIVATE SCHEMA
-- ══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS private;

-- Restrict: no PUBLIC or anon access
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;

-- Grant minimum USAGE needed for RLS policy evaluation
GRANT USAGE ON SCHEMA private TO postgres;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

-- Prevent future functions in private schema from auto-granting to PUBLIC/anon
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: CREATE PRIVATE AUTHORIZATION HELPERS
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 2a. get_user_workspace_role ─────────────────────────────────────────────

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

REVOKE EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_user_workspace_role(uuid) TO service_role;


-- ── 2b. is_workspace_active_member ──────────────────────────────────────────

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

REVOKE EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_active_member(uuid) TO service_role;


-- ── 2c. has_system_role ─────────────────────────────────────────────────────

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

REVOKE EXECUTE ON FUNCTION private.has_system_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.has_system_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION private.has_system_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_system_role(uuid, text) TO service_role;


-- ── 2d. can_administer_workspace ────────────────────────────────────────────

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

REVOKE EXECUTE ON FUNCTION private.can_administer_workspace(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.can_administer_workspace(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.can_administer_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_administer_workspace(uuid) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: CLEAN UP STALE V1 POLICIES + UPDATE ALL RLS POLICIES
-- ══════════════════════════════════════════════════════════════════════════════
-- Release 1.0 left behind duplicate V1 policies alongside the new ones.
-- These stale policies cause infinite recursion (self-referencing subqueries
-- on workspace_members). Drop ALL non-canonical policies first.

-- ── Stale V1 workspace policies ──
DROP POLICY IF EXISTS "Members can view workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_select" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_insert" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_delete" ON public.workspaces;

-- ── Stale V1 workspace_members policies ──
DROP POLICY IF EXISTS "Members can view workspace members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners/admins can delete members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners/admins can manage members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners/admins can update members" ON public.workspace_members;
DROP POLICY IF EXISTS "wm_select" ON public.workspace_members;
DROP POLICY IF EXISTS "wm_update" ON public.workspace_members;
DROP POLICY IF EXISTS "wm_insert" ON public.workspace_members;
DROP POLICY IF EXISTS "wm_delete" ON public.workspace_members;

-- ── Stale V1 profiles policies ──
DROP POLICY IF EXISTS "Anyone can read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;

-- ── Stale V1 projects policies ──
DROP POLICY IF EXISTS "Members can delete projects" ON public.projects;
DROP POLICY IF EXISTS "Members can view projects" ON public.projects;
DROP POLICY IF EXISTS "Members can create projects" ON public.projects;
DROP POLICY IF EXISTS "Members can update projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can delete projects" ON public.projects;
DROP POLICY IF EXISTS "Workspace members can view projects" ON public.projects;
DROP POLICY IF EXISTS "projects_delete" ON public.projects;
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_select" ON public.projects;
DROP POLICY IF EXISTS "projects_update" ON public.projects;

-- ── Stale V1 task_statuses policies ──
DROP POLICY IF EXISTS "Members can manage task statuses" ON public.task_statuses;
DROP POLICY IF EXISTS "Members can view task statuses" ON public.task_statuses;
DROP POLICY IF EXISTS "Workspace members can view statuses" ON public.task_statuses;
DROP POLICY IF EXISTS "Members can create statuses" ON public.task_statuses;
DROP POLICY IF EXISTS "Members can update statuses" ON public.task_statuses;
DROP POLICY IF EXISTS "Members can delete statuses" ON public.task_statuses;
DROP POLICY IF EXISTS "statuses_all" ON public.task_statuses;
DROP POLICY IF EXISTS "statuses_select" ON public.task_statuses;

-- ── Stale V1 tasks policies ──
DROP POLICY IF EXISTS "Members can view tasks" ON public.tasks;
DROP POLICY IF EXISTS "Members can create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Members can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Members can delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Workspace members can view tasks" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update" ON public.tasks;

-- ── 3a. workspaces ──────────────────────────────────────────────────────────

-- NOTE: Uses SECURITY DEFINER helper to avoid infinite recursion
-- (the original V1 policy self-referenced workspace_members with a subquery)
DROP POLICY IF EXISTS "workspaces_select_member" ON public.workspaces;
CREATE POLICY "workspaces_select_member" ON public.workspaces FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(id));

DROP POLICY IF EXISTS "workspaces_update_owner" ON public.workspaces;
CREATE POLICY "workspaces_update_owner" ON public.workspaces FOR UPDATE TO authenticated
  USING (private.get_user_workspace_role(id) IN ('owner', 'admin') OR private.has_system_role(id, 'system_admin'))
  WITH CHECK (private.get_user_workspace_role(id) IN ('owner', 'admin') OR private.has_system_role(id, 'system_admin'));

DROP POLICY IF EXISTS "workspaces_delete_owner" ON public.workspaces;
CREATE POLICY "workspaces_delete_owner" ON public.workspaces FOR DELETE TO authenticated
  USING (private.get_user_workspace_role(id) = 'owner');


-- ── 3b. workspace_members ───────────────────────────────────────────────────

-- NOTE: Uses SECURITY DEFINER helper to avoid infinite recursion
-- (the original V1 policy self-referenced workspace_members with a subquery)
DROP POLICY IF EXISTS "workspace_members_select_active" ON public.workspace_members;
CREATE POLICY "workspace_members_select_active" ON public.workspace_members FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

DROP POLICY IF EXISTS "workspace_members_insert_admin_owner" ON public.workspace_members;
CREATE POLICY "workspace_members_insert_admin_owner" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    private.can_administer_workspace(workspace_id)
    OR (user_id = auth.uid() AND role = 'owner' AND NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_members.workspace_id))
  );

DROP POLICY IF EXISTS "workspace_members_update_admin_owner" ON public.workspace_members;
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

DROP POLICY IF EXISTS "workspace_members_delete_admin_owner" ON public.workspace_members;
CREATE POLICY "workspace_members_delete_admin_owner" ON public.workspace_members FOR DELETE TO authenticated
  USING (private.can_administer_workspace(workspace_id));


-- ── 3c. user_system_roles ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "user_system_roles_select" ON public.user_system_roles;
CREATE POLICY "user_system_roles_select" ON public.user_system_roles FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

DROP POLICY IF EXISTS "user_system_roles_manage" ON public.user_system_roles;
CREATE POLICY "user_system_roles_manage" ON public.user_system_roles FOR ALL TO authenticated
  USING (private.get_user_workspace_role(workspace_id) = 'owner' OR private.has_system_role(workspace_id, 'system_admin'))
  WITH CHECK (private.get_user_workspace_role(workspace_id) = 'owner' OR private.has_system_role(workspace_id, 'system_admin'));


-- ── 3d. departments ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "departments_select_member" ON public.departments;
CREATE POLICY "departments_select_member" ON public.departments FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

DROP POLICY IF EXISTS "departments_insert_manage" ON public.departments;
CREATE POLICY "departments_insert_manage" ON public.departments FOR INSERT TO authenticated
  WITH CHECK (private.can_administer_workspace(workspace_id));

DROP POLICY IF EXISTS "departments_update_manage" ON public.departments;
CREATE POLICY "departments_update_manage" ON public.departments FOR UPDATE TO authenticated
  USING (private.can_administer_workspace(workspace_id))
  WITH CHECK (private.can_administer_workspace(workspace_id));

DROP POLICY IF EXISTS "departments_delete_owner" ON public.departments;
CREATE POLICY "departments_delete_owner" ON public.departments FOR DELETE TO authenticated
  USING (private.get_user_workspace_role(workspace_id) = 'owner' OR private.has_system_role(workspace_id, 'system_admin'));


-- ── 3e. department_memberships ──────────────────────────────────────────────

DROP POLICY IF EXISTS "dept_memberships_select_member" ON public.department_memberships;
CREATE POLICY "dept_memberships_select_member" ON public.department_memberships FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

DROP POLICY IF EXISTS "dept_memberships_manage" ON public.department_memberships;
CREATE POLICY "dept_memberships_manage" ON public.department_memberships FOR ALL TO authenticated
  USING (private.can_administer_workspace(workspace_id))
  WITH CHECK (private.can_administer_workspace(workspace_id));


-- ── 3f. projects ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "projects_select_member" ON public.projects;
CREATE POLICY "projects_select_member" ON public.projects FOR SELECT TO authenticated
  USING (private.get_user_workspace_role(workspace_id) IS NOT NULL);

DROP POLICY IF EXISTS "projects_insert_member" ON public.projects;
CREATE POLICY "projects_insert_member" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    private.get_user_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
    OR private.has_system_role(workspace_id, 'system_admin')
    OR private.has_system_role(workspace_id, 'project_admin')
  );

DROP POLICY IF EXISTS "projects_update_member" ON public.projects;
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

DROP POLICY IF EXISTS "projects_delete_admin_owner" ON public.projects;
CREATE POLICY "projects_delete_admin_owner" ON public.projects FOR DELETE TO authenticated
  USING (private.can_administer_workspace(workspace_id));


-- ── 3g. task_statuses ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "task_statuses_select_member" ON public.task_statuses;
CREATE POLICY "task_statuses_select_member" ON public.task_statuses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND private.get_user_workspace_role(p.workspace_id) IS NOT NULL));

DROP POLICY IF EXISTS "task_statuses_insert_member" ON public.task_statuses;
CREATE POLICY "task_statuses_insert_member" ON public.task_statuses FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

DROP POLICY IF EXISTS "task_statuses_update_member" ON public.task_statuses;
CREATE POLICY "task_statuses_update_member" ON public.task_statuses FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

DROP POLICY IF EXISTS "task_statuses_delete_member" ON public.task_statuses;
CREATE POLICY "task_statuses_delete_member" ON public.task_statuses FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_statuses.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));


-- ── 3h. tasks ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tasks_select_member" ON public.tasks;
CREATE POLICY "tasks_select_member" ON public.tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND private.get_user_workspace_role(p.workspace_id) IS NOT NULL));

DROP POLICY IF EXISTS "tasks_insert_member" ON public.tasks;
CREATE POLICY "tasks_insert_member" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

DROP POLICY IF EXISTS "tasks_update_member" ON public.tasks;
CREATE POLICY "tasks_update_member" ON public.tasks FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));

DROP POLICY IF EXISTS "tasks_delete_member" ON public.tasks;
CREATE POLICY "tasks_delete_member" ON public.tasks FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));


-- ── 3i. task_raci_assignments ───────────────────────────────────────────────

DROP POLICY IF EXISTS "task_raci_select_member" ON public.task_raci_assignments;
CREATE POLICY "task_raci_select_member" ON public.task_raci_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = task_raci_assignments.task_id AND private.is_workspace_active_member(p.workspace_id)));

DROP POLICY IF EXISTS "task_raci_manage" ON public.task_raci_assignments;
CREATE POLICY "task_raci_manage" ON public.task_raci_assignments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = task_raci_assignments.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = task_raci_assignments.task_id AND (private.get_user_workspace_role(p.workspace_id) IN ('owner', 'admin', 'member') OR private.has_system_role(p.workspace_id, 'system_admin') OR private.has_system_role(p.workspace_id, 'project_admin'))));


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: DROP OBSOLETE PUBLIC HELPER FUNCTIONS
-- ══════════════════════════════════════════════════════════════════════════════
-- NOTE: The notifications_insert_internal policy depends on
-- public.is_workspace_active_member, so it must be dropped BEFORE removing
-- the public helper functions.

DROP POLICY IF EXISTS "notifications_insert_internal" ON public.notifications;

DROP FUNCTION IF EXISTS public.can_administer_workspace(uuid);
DROP FUNCTION IF EXISTS public.has_system_role(uuid, text);
DROP FUNCTION IF EXISTS public.is_workspace_active_member(uuid);
DROP FUNCTION IF EXISTS public.get_user_workspace_role(uuid);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: TRIGGER-ONLY FUNCTION LOCKDOWN
-- ══════════════════════════════════════════════════════════════════════════════
-- Triggers execute as function owner regardless of caller privileges.
-- Revoking EXECUTE does NOT break trigger execution.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.seed_default_statuses() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_statuses() FROM anon;
REVOKE EXECUTE ON FUNCTION public.seed_default_statuses() FROM authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6: NOTIFICATION SECURITY
-- ══════════════════════════════════════════════════════════════════════════════

-- 6a: Remove authenticated INSERT capability entirely.
--     notifications_insert_internal policy was already dropped in Section 4.
--     Future notifications will be generated via server-side event processing.
REVOKE INSERT ON TABLE public.notifications FROM authenticated;
REVOKE INSERT ON TABLE public.notifications FROM anon;

-- 6b: Column-level UPDATE restriction.
--     Only is_read and read_at may be updated. All other columns are rejected.
REVOKE UPDATE ON TABLE public.notifications FROM authenticated;
GRANT UPDATE (is_read, read_at) ON TABLE public.notifications TO authenticated;

-- 6c: Retain existing row-level UPDATE policy (user can only update own rows).
--     notifications_update_own already exists with:
--       USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())
--     No change needed.

-- 6d: Retain existing row-level SELECT policy.
--     notifications_select_own already exists with:
--       USING (user_id = auth.uid())
--     No change needed.


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7: DEFAULT PRIVILEGE HARDENING
-- ══════════════════════════════════════════════════════════════════════════════
-- Future functions created by postgres in public schema must NOT auto-receive
-- EXECUTE for PUBLIC, anon, authenticated, or service_role.
-- supabase_admin defaults are NOT modified.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM service_role;


COMMIT;

-- ============================================================================
-- END MIGRATION: 20260814_02_security_hardening.sql
-- ============================================================================
