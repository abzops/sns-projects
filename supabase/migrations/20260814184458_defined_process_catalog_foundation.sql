-- SNS Projects — DP-1-A: Defined Process Catalog & Version Foundation
-- Scope: public.defined_processes and public.defined_process_versions tables only.
-- Enforces immutable versioning, strict provenance constraints, and least-privilege SELECT-only RLS.

-- ============================================================================
-- 1. SUPPORTING COMPOSITE CONSTRAINT ON public.departments
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_departments_id_workspace'
      AND conrelid = 'public.departments'::regclass
  ) THEN
    ALTER TABLE public.departments
      ADD CONSTRAINT uq_departments_id_workspace UNIQUE (id, workspace_id);
  END IF;
END $$;

-- ============================================================================
-- 2. TABLE: public.defined_processes
-- ============================================================================
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

  -- Structural & provenance constraints
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

COMMENT ON TABLE public.defined_processes IS 'Reusable defined process templates catalog governed at workspace and department level.';

-- Indexes for defined_processes
CREATE INDEX IF NOT EXISTS idx_defined_processes_ws_dept_active
  ON public.defined_processes (workspace_id, department_id, is_active);

CREATE INDEX IF NOT EXISTS idx_defined_processes_owner
  ON public.defined_processes (process_owner_id);

CREATE INDEX IF NOT EXISTS idx_defined_processes_source_task_list
  ON public.defined_processes (source_task_list_id)
  WHERE source_task_list_id IS NOT NULL;

-- ============================================================================
-- 3. TABLE: public.defined_process_versions
-- ============================================================================
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

  -- Version uniqueness & future composite provenance key
  CONSTRAINT uq_defined_process_versions_process_version UNIQUE (defined_process_id, version_number),
  CONSTRAINT uq_defined_process_versions_id_process UNIQUE (id, defined_process_id),
  CONSTRAINT chk_defined_process_versions_publication CHECK (
    (status = 'draft' AND published_by IS NULL AND published_at IS NULL)
    OR
    (status IN ('published', 'archived') AND published_by IS NOT NULL AND published_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.defined_process_versions IS 'Immutable version instances for defined processes with single-published enforcement.';

-- Single published version partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_defined_process_versions_single_published
  ON public.defined_process_versions (defined_process_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_defined_process_versions_process_status
  ON public.defined_process_versions (defined_process_id, status);

-- ============================================================================
-- 4. APPLICATION UPDATED_AT TRIGGER
-- ============================================================================
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

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) & PRIVILEGES (LEAST PRIVILEGE: SELECT ONLY)
-- ============================================================================
ALTER TABLE public.defined_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_versions ENABLE ROW LEVEL SECURITY;

-- Revoke all direct permissions from PUBLIC and anon
REVOKE ALL ON TABLE public.defined_processes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_versions FROM PUBLIC, anon, authenticated;

-- Grant SELECT only to authenticated users (mutations reserved for future workflow engine)
GRANT SELECT ON TABLE public.defined_processes TO authenticated;
GRANT SELECT ON TABLE public.defined_process_versions TO authenticated;

-- defined_processes: Active workspace members can read defined processes in their workspace
DROP POLICY IF EXISTS "defined_processes_select_member" ON public.defined_processes;
CREATE POLICY "defined_processes_select_member"
  ON public.defined_processes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_workspace_active_member(defined_processes.workspace_id))
  );

-- defined_process_versions: Active workspace members can read versions belonging to their workspace processes
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
