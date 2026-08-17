-- ============================================================================
-- SNS PROJECTS — PACKAGE 1 / P1-02E
-- Migration: 20260817113427_p1_02e_legacy_version_trigger_security_closure.sql
-- Description: Move legacy task list version validation trigger helper from
--              public schema to private schema to eliminate Security Advisor
--              warning for authenticated SECURITY DEFINER function execution.
-- ============================================================================

-- ── 1. Create Private Trigger Function ───────────────────────────────────────

CREATE OR REPLACE FUNCTION private.sync_validate_legacy_task_list_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_list_version_id uuid;
BEGIN
  IF NEW.process_instance_id IS NULL AND NEW.process_step_id IS NOT NULL THEN
    IF NEW.task_list_id IS NULL THEN
      RAISE EXCEPTION 'Legacy defined process step task must have a task_list_id.';
    END IF;

    SELECT defined_process_version_id INTO v_list_version_id
    FROM public.task_lists
    WHERE id = NEW.task_list_id;

    IF v_list_version_id IS NULL OR v_list_version_id <> NEW.defined_process_version_id THEN
      RAISE EXCEPTION 'Version coherence violation: task_list % (version: %) does not match task defined_process_version_id %.',
        NEW.task_list_id, v_list_version_id, NEW.defined_process_version_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.sync_validate_legacy_task_list_version() IS
  'Internal validation trigger function enforcing task_list version coherence for legacy defined tasks.';

-- ── 2. Restrict Execution Privileges ─────────────────────────────────────────

REVOKE ALL ON FUNCTION private.sync_validate_legacy_task_list_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_validate_legacy_task_list_version() TO service_role, postgres;

-- ── 3. Rebind Trigger to Private Function ───────────────────────────────────

DROP TRIGGER IF EXISTS trg_validate_legacy_task_list_version ON public.tasks;
CREATE TRIGGER trg_validate_legacy_task_list_version
  BEFORE INSERT OR UPDATE OF task_list_id, process_step_id, defined_process_version_id, process_instance_id
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_validate_legacy_task_list_version();

-- ── 4. Drop Obsolete Public Function ─────────────────────────────────────────

DROP FUNCTION IF EXISTS public.sync_validate_legacy_task_list_version();
