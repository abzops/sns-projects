-- ==============================================================================
-- P6-04C: Persistent Financial Explorer Saved Views
--
-- Adds authenticated personal Saved Views storage for the Financial Explorer
-- at /workspace/:workspaceId/finance/explorer.
--
-- Security & Ownership Invariants:
--   1. Personal Ownership: Users can ONLY read, create, update, and delete their
--      own Saved Views (user_id = auth.uid()).
--   2. Finance Authorization: Available only to users with current approved
--      workspace Finance authority (can_manage_budgets OR is_finance_operator).
--   3. Ownership & Tenancy Immutability: user_id, workspace_id, and created_at
--      are permanently immutable once inserted; anti-spoofing trigger forces
--      ownership to auth.uid() on INSERT.
--   4. RLS & Zero Public RPC: All operations occur via standard authenticated
--      PostgREST table queries under RLS. No public SECURITY DEFINER functions.
--   5. Unique Naming: One case-insensitive Saved View name per user per workspace.
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Table Definition
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.finance_explorer_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  view_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_finance_explorer_saved_views_name
    CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 100),

  CONSTRAINT chk_finance_explorer_saved_views_state_object
    CHECK (jsonb_typeof(view_state) = 'object')
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Indexes
-- ──────────────────────────────────────────────────────────────────────────────

-- Unique case-insensitive name per user per workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_explorer_saved_views_user_ws_name
  ON public.finance_explorer_saved_views (workspace_id, user_id, lower(trim(name)));

-- Fast lookup index for workspace/user scoped queries
CREATE INDEX IF NOT EXISTS idx_finance_explorer_saved_views_ws_user
  ON public.finance_explorer_saved_views (workspace_id, user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Immutability & Anti-Spoofing Trigger
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_finance_explorer_saved_views_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_is_trusted boolean;
BEGIN
  -- Resolve actor identity
  IF auth.uid() IS NOT NULL THEN
    v_actor_id := auth.uid();
  ELSE
    v_is_trusted := (
      current_user IN ('postgres', 'service_role', 'supabase_admin')
      OR current_setting('session_replication_role', true) = 'replica'
      OR NULLIF(current_setting('app.trusted_internal_execution', true), '') = 'on'
    );
    IF NOT v_is_trusted THEN
      RAISE EXCEPTION 'Cannot mutate saved views without authenticated session or trusted execution context';
    END IF;
    v_actor_id := COALESCE(
      NEW.user_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.user_id ELSE NULL END
    );
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'Cannot mutate saved view in trusted context without explicit user_id';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Force ownership to authenticated actor (anti-spoofing)
    NEW.user_id := v_actor_id;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := clock_timestamp();
  ELSIF TG_OP = 'UPDATE' THEN
    -- Enforce immutability of ownership, tenancy, and creation timestamp
    NEW.user_id := OLD.user_id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.trg_fn_finance_explorer_saved_views_immutability()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.trg_fn_finance_explorer_saved_views_immutability()
  TO authenticated, service_role, postgres;

DROP TRIGGER IF EXISTS trg_finance_explorer_saved_views_immutability
  ON public.finance_explorer_saved_views;

CREATE TRIGGER trg_finance_explorer_saved_views_immutability
  BEFORE INSERT OR UPDATE ON public.finance_explorer_saved_views
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_finance_explorer_saved_views_immutability();

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Row-Level Security Policies
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.finance_explorer_saved_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_explorer_saved_views_select_policy ON public.finance_explorer_saved_views;
CREATE POLICY finance_explorer_saved_views_select_policy
  ON public.finance_explorer_saved_views
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (
      private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
      OR
      private.is_finance_operator(workspace_id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS finance_explorer_saved_views_insert_policy ON public.finance_explorer_saved_views;
CREATE POLICY finance_explorer_saved_views_insert_policy
  ON public.finance_explorer_saved_views
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
      OR
      private.is_finance_operator(workspace_id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS finance_explorer_saved_views_update_policy ON public.finance_explorer_saved_views;
CREATE POLICY finance_explorer_saved_views_update_policy
  ON public.finance_explorer_saved_views
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (
      private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
      OR
      private.is_finance_operator(workspace_id, (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
      OR
      private.is_finance_operator(workspace_id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS finance_explorer_saved_views_delete_policy ON public.finance_explorer_saved_views;
CREATE POLICY finance_explorer_saved_views_delete_policy
  ON public.finance_explorer_saved_views
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (
      private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
      OR
      private.is_finance_operator(workspace_id, (SELECT auth.uid()))
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Permissions & Grants
-- ──────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON TABLE public.finance_explorer_saved_views FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.finance_explorer_saved_views TO authenticated;
