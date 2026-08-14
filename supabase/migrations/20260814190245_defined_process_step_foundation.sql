-- SNS Projects — DP-1-B: Steps + DAG Dependencies + Template RACI + Evidence Definitions
-- Scope: public.defined_process_steps, public.defined_process_step_dependencies,
--        public.defined_process_step_raci, and public.defined_process_step_evidence_defs.
-- Enforces DAG structure, same-version foreign keys, RACI constraints, and least-privilege SELECT-only RLS.

-- ============================================================================
-- 1. TABLE: public.defined_process_steps
-- ============================================================================
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

  -- Structural constraints
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

-- ============================================================================
-- 2. TABLE: public.defined_process_step_dependencies
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.defined_process_step_dependencies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id         uuid NOT NULL REFERENCES public.defined_process_versions(id) ON DELETE CASCADE,
  step_id            uuid NOT NULL,
  depends_on_step_id uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Same-version dependency integrity: both endpoints must belong to the exact same version
  CONSTRAINT fk_step_deps_step_version FOREIGN KEY (step_id, version_id)
    REFERENCES public.defined_process_steps(id, version_id) ON DELETE CASCADE,
  CONSTRAINT fk_step_deps_depends_on_version FOREIGN KEY (depends_on_step_id, version_id)
    REFERENCES public.defined_process_steps(id, version_id) ON DELETE CASCADE,

  -- Graph edge integrity
  CONSTRAINT chk_step_deps_no_self_dependency CHECK (step_id <> depends_on_step_id),
  CONSTRAINT uq_step_deps_version_step_depends UNIQUE (version_id, step_id, depends_on_step_id)
);

COMMENT ON TABLE public.defined_process_step_dependencies IS 'DAG dependency edges between steps strictly confined to the same defined process version.';

-- Downstream dependency traversal index (which steps depend on completed step)
CREATE INDEX IF NOT EXISTS idx_step_deps_downstream
  ON public.defined_process_step_dependencies (version_id, depends_on_step_id, step_id);

CREATE INDEX IF NOT EXISTS idx_step_deps_step_version
  ON public.defined_process_step_dependencies (step_id, version_id);

CREATE INDEX IF NOT EXISTS idx_step_deps_depends_version
  ON public.defined_process_step_dependencies (depends_on_step_id, version_id);

-- ============================================================================
-- 3. TABLE: public.defined_process_step_raci
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.defined_process_step_raci (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id           uuid NOT NULL REFERENCES public.defined_process_steps(id) ON DELETE CASCADE,
  raci_role         text NOT NULL CHECK (raci_role IN ('R', 'A', 'C', 'I')),
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  response_required boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Unique assignment per step, role, and user
  CONSTRAINT uq_step_raci_step_role_user UNIQUE (step_id, raci_role, user_id),

  -- response_required is permitted ONLY on Consulted ('C') assignments
  CONSTRAINT chk_step_raci_response_required CHECK (response_required = false OR raci_role = 'C')
);

COMMENT ON TABLE public.defined_process_step_raci IS 'Template RACI assignments for process steps with max-one Accountable enforcement.';

-- Maximum one Accountable person per Step partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_step_raci_single_accountable
  ON public.defined_process_step_raci (step_id)
  WHERE raci_role = 'A';

CREATE INDEX IF NOT EXISTS idx_step_raci_step_id
  ON public.defined_process_step_raci (step_id);

CREATE INDEX IF NOT EXISTS idx_step_raci_user_step
  ON public.defined_process_step_raci (user_id, step_id);

-- ============================================================================
-- 4. TABLE: public.defined_process_step_evidence_defs
-- ============================================================================
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

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) & PRIVILEGES (LEAST PRIVILEGE: SELECT ONLY)
-- ============================================================================
ALTER TABLE public.defined_process_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_step_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_step_raci ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defined_process_step_evidence_defs ENABLE ROW LEVEL SECURITY;

-- Revoke all direct permissions from PUBLIC and anon
REVOKE ALL ON TABLE public.defined_process_steps FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_step_dependencies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_step_raci FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.defined_process_step_evidence_defs FROM PUBLIC, anon, authenticated;

-- Grant SELECT only to authenticated users
GRANT SELECT ON TABLE public.defined_process_steps TO authenticated;
GRANT SELECT ON TABLE public.defined_process_step_dependencies TO authenticated;
GRANT SELECT ON TABLE public.defined_process_step_raci TO authenticated;
GRANT SELECT ON TABLE public.defined_process_step_evidence_defs TO authenticated;

-- defined_process_steps: Active workspace members can read steps in their workspace
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

-- defined_process_step_dependencies: Active workspace members can read dependencies in their workspace
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

-- defined_process_step_raci: Active workspace members can read template RACI in their workspace
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

-- defined_process_step_evidence_defs: Active workspace members can read evidence definitions in their workspace
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
