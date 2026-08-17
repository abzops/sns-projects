-- SNS Projects — Package 1 / P1-01: Core Hierarchy + Process Instance Database Foundation
-- Migration: 20260817063502_core_hierarchy_process_instance_foundation.sql
-- 
-- Summary:
-- 1. Phase Compatibility Foundation:
--    - Adds owner_id to public.milestones (with safe backfill from projects.owner_id).
--    - Adds owner_id and phase_id to public.task_lists (with safe backfills).
--    - Adds phase_id, parent_task_id, and process_instance_id to public.tasks.
--    - Implements bidirectional sync between phase_id and milestone_id with check invariants.
--    - Creates public.phases security_invoker compatibility view.
-- 2. Standalone Task Foundation:
--    - Alters public.tasks.project_id to be NULLABLE (RLS remains fail-closed).
-- 3. Child Task Foundation:
--    - Adds self-referencing parent_task_id on public.tasks with self-parent prevention.
-- 4. Process Instance Entity:
--    - Creates public.process_instances runtime table with placement_type and lifecycle checks.
--    - Sets up RLS, indexes, and strict Data API grants.

-- ============================================================================
-- 1. PHASE & TASK LIST OWNER FOUNDATION
-- ============================================================================

-- 1.1 Add owner_id to public.milestones
ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_milestones_owner_id ON public.milestones(owner_id);

-- Backfill milestone owner_id from project owner_id where unambiguous
UPDATE public.milestones m
SET owner_id = p.owner_id
FROM public.projects p
WHERE m.project_id = p.id
  AND m.owner_id IS NULL
  AND p.owner_id IS NOT NULL;

-- 1.2 Add owner_id to public.task_lists
ALTER TABLE public.task_lists
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_lists_owner_id ON public.task_lists(owner_id);

-- Backfill task_lists owner_id from project owner_id where unambiguous
UPDATE public.task_lists tl
SET owner_id = p.owner_id
FROM public.projects p
WHERE tl.project_id = p.id
  AND tl.owner_id IS NULL
  AND p.owner_id IS NOT NULL;


-- ============================================================================
-- 2. PHASE COMPATIBILITY COLUMNS & DUAL-SYNC ON TASK_LISTS & TASKS
-- ============================================================================

-- 2.1 Add phase_id to public.task_lists
ALTER TABLE public.task_lists
  ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES public.milestones(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_task_lists_phase_id ON public.task_lists(phase_id);

-- Backfill task_lists phase_id = milestone_id
UPDATE public.task_lists
SET phase_id = milestone_id
WHERE milestone_id IS NOT NULL
  AND phase_id IS NULL;

-- 2.2 Add phase_id and parent_task_id to public.tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES public.milestones(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_phase_id ON public.tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON public.tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- Backfill tasks phase_id = milestone_id
UPDATE public.tasks
SET phase_id = milestone_id
WHERE milestone_id IS NOT NULL
  AND phase_id IS NULL;

-- Prevent direct self-parenting
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_no_self_parent') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_no_self_parent CHECK (parent_task_id IS NULL OR parent_task_id <> id);
  END IF;
END $$;

-- 2.3 Standalone Task Foundation: Make tasks.project_id NULLABLE
ALTER TABLE public.tasks ALTER COLUMN project_id DROP NOT NULL;

-- 2.4 Bidirectional Phase / Milestone Synchronization Trigger Function
CREATE OR REPLACE FUNCTION public.sync_milestone_phase_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- 1. If phase_id is provided and milestone_id is null, copy phase_id to milestone_id
  IF NEW.phase_id IS NOT NULL AND NEW.milestone_id IS NULL THEN
    NEW.milestone_id := NEW.phase_id;
  -- 2. If milestone_id is provided and phase_id is null, copy milestone_id to phase_id
  ELSIF NEW.milestone_id IS NOT NULL AND NEW.phase_id IS NULL THEN
    NEW.phase_id := NEW.milestone_id;
  -- 3. If both are provided and they do not match, synchronize or raise exception
  ELSIF NEW.phase_id IS NOT NULL AND NEW.milestone_id IS NOT NULL THEN
    IF NEW.phase_id <> NEW.milestone_id THEN
      IF TG_OP = 'UPDATE' THEN
        IF NEW.phase_id <> OLD.phase_id AND NEW.milestone_id = OLD.milestone_id THEN
          NEW.milestone_id := NEW.phase_id;
        ELSIF NEW.milestone_id <> OLD.milestone_id AND NEW.phase_id = OLD.phase_id THEN
          NEW.phase_id := NEW.milestone_id;
        ELSE
          RAISE EXCEPTION 'Contradictory phase_id (%) and milestone_id (%) supplied', NEW.phase_id, NEW.milestone_id;
        END IF;
      ELSE
        RAISE EXCEPTION 'Contradictory phase_id (%) and milestone_id (%) supplied', NEW.phase_id, NEW.milestone_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_milestone_phase_id() IS 'Ensures bidirectional synchronization between milestone_id and phase_id during compatibility period.';

-- Trigger on tasks
DROP TRIGGER IF EXISTS trg_tasks_sync_milestone_phase ON public.tasks;
CREATE TRIGGER trg_tasks_sync_milestone_phase
  BEFORE INSERT OR UPDATE OF phase_id, milestone_id ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_milestone_phase_id();

-- Trigger on task_lists
DROP TRIGGER IF EXISTS trg_task_lists_sync_milestone_phase ON public.task_lists;
CREATE TRIGGER trg_task_lists_sync_milestone_phase
  BEFORE INSERT OR UPDATE OF phase_id, milestone_id ON public.task_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_milestone_phase_id();

-- Check constraints to enforce invariant
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_phase_milestone_sync') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_phase_milestone_sync CHECK (phase_id IS NOT DISTINCT FROM milestone_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_lists_phase_milestone_sync') THEN
    ALTER TABLE public.task_lists
      ADD CONSTRAINT chk_task_lists_phase_milestone_sync CHECK (phase_id IS NOT DISTINCT FROM milestone_id);
  END IF;
END $$;


-- ============================================================================
-- 3. PHASE READ COMPATIBILITY VIEW
-- ============================================================================

CREATE OR REPLACE VIEW public.phases
WITH (security_invoker = true)
AS
SELECT
  id,
  project_id,
  name,
  description,
  start_date,
  end_date,
  position,
  created_by,
  created_at,
  updated_at,
  owner_id
FROM public.milestones;

COMMENT ON VIEW public.phases IS 'Compatibility view over public.milestones presenting Phase terminology under security_invoker.';

GRANT SELECT ON public.phases TO authenticated;
GRANT SELECT ON public.phases TO service_role, postgres;
REVOKE ALL ON public.phases FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.phases FROM authenticated, anon;


-- ============================================================================
-- 4. PROCESS INSTANCE ENTITY
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.process_instances (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  defined_process_id         uuid NOT NULL REFERENCES public.defined_processes(id) ON DELETE RESTRICT,
  defined_process_version_id uuid NOT NULL REFERENCES public.defined_process_versions(id) ON DELETE RESTRICT,
  instance_name              text NOT NULL,
  started_by                 uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  owner_id                   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  started_at                 timestamptz NOT NULL DEFAULT now(),
  due_date                   timestamptz NULL,
  placement_type             text NOT NULL CHECK (placement_type IN ('standalone', 'project', 'phase', 'task_list', 'task')),
  project_id                 uuid NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phase_id                   uuid NULL REFERENCES public.milestones(id) ON DELETE SET NULL,
  task_list_id               uuid NULL REFERENCES public.task_lists(id) ON DELETE SET NULL,
  parent_task_id             uuid NULL REFERENCES public.tasks(id) ON DELETE SET NULL,
  status                     text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled')),
  completed_at               timestamptz NULL,
  cancelled_at               timestamptz NULL,
  cancelled_by               uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancel_reason              text NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_process_instance_placement CHECK (
    (
      placement_type = 'standalone'
      AND project_id IS NULL
      AND phase_id IS NULL
      AND task_list_id IS NULL
    )
    OR
    (
      placement_type = 'project'
      AND project_id IS NOT NULL
      AND phase_id IS NULL
      AND task_list_id IS NULL
      AND parent_task_id IS NULL
    )
    OR
    (
      placement_type = 'phase'
      AND project_id IS NOT NULL
      AND phase_id IS NOT NULL
      AND task_list_id IS NULL
      AND parent_task_id IS NULL
    )
    OR
    (
      placement_type = 'task_list'
      AND project_id IS NOT NULL
      AND phase_id IS NOT NULL
      AND task_list_id IS NOT NULL
      AND parent_task_id IS NULL
    )
    OR
    (
      placement_type = 'task'
      AND project_id IS NOT NULL
      AND parent_task_id IS NOT NULL
    )
  ),
  CONSTRAINT chk_process_instance_status_lifecycle CHECK (
    (
      status = 'running'
      AND completed_at IS NULL
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND cancel_reason IS NULL
    )
    OR
    (
      status = 'completed'
      AND completed_at IS NOT NULL
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND cancel_reason IS NULL
    )
    OR
    (
      status = 'cancelled'
      AND completed_at IS NULL
      AND cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND cancel_reason IS NOT NULL
      AND btrim(cancel_reason) <> ''
    )
  )
);

COMMENT ON TABLE public.process_instances IS 'Explicit runtime container for an executed Defined Process.';

-- 4.1 Process Instance Indexes
CREATE INDEX IF NOT EXISTS idx_process_instances_workspace ON public.process_instances(workspace_id);
CREATE INDEX IF NOT EXISTS idx_process_instances_defined_process ON public.process_instances(defined_process_id, defined_process_version_id);
CREATE INDEX IF NOT EXISTS idx_process_instances_project ON public.process_instances(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_instances_phase ON public.process_instances(phase_id) WHERE phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_instances_task_list ON public.process_instances(task_list_id) WHERE task_list_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_instances_parent_task ON public.process_instances(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_instances_owner ON public.process_instances(owner_id);
CREATE INDEX IF NOT EXISTS idx_process_instances_started_by ON public.process_instances(started_by);
CREATE INDEX IF NOT EXISTS idx_process_instances_placement_type ON public.process_instances(placement_type);
CREATE INDEX IF NOT EXISTS idx_process_instances_status ON public.process_instances(status);

-- 4.2 Updated_at trigger on process_instances
DROP TRIGGER IF EXISTS trg_process_instances_updated_at ON public.process_instances;
CREATE TRIGGER trg_process_instances_updated_at
  BEFORE UPDATE ON public.process_instances
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- 4.3 Process Instance RLS
ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "process_instances_select_member" ON public.process_instances;
CREATE POLICY "process_instances_select_member" ON public.process_instances
  FOR SELECT TO authenticated
  USING (private.is_workspace_active_member(workspace_id));

-- Direct client DML (INSERT, UPDATE, DELETE) is intentionally not permitted to authenticated users;
-- Process Instance lifecycle and placement will be managed by controlled Package 2 RPCs.
GRANT SELECT ON TABLE public.process_instances TO authenticated;
GRANT ALL ON TABLE public.process_instances TO service_role, postgres;
REVOKE ALL ON TABLE public.process_instances FROM PUBLIC, anon;


-- ============================================================================
-- 5. TASK → PROCESS INSTANCE RELATION
-- ============================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS process_instance_id uuid REFERENCES public.process_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_process_instance ON public.tasks(process_instance_id) WHERE process_instance_id IS NOT NULL;
