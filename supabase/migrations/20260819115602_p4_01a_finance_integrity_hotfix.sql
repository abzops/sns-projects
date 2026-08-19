-- ============================================================================
-- Migration: 20260819115602_p4_01a_finance_integrity_hotfix.sql
-- Description: P4-01A Finance Foundation Integrity Hotfix
--   1. Enforce Phase -> Task List budget reduction invariant (Phase base budget
--      cannot be reduced below the sum of existing child Task List base budgets,
--      including reductions to 0).
--   2. Harden audit actor contract and anti-spoofing across budget hierarchy,
--      budget audit logs, expense sources, and budget reallocations.
--   3. Restrict unauthenticated execution strictly to trusted server contexts.
-- ============================================================================

-- ── 0. BUDGET AUDIT LOGS IMMUTABILITY & DELETION COMPATIBILITY ───────────────

ALTER TABLE public.budget_audit_logs DROP CONSTRAINT IF EXISTS budget_audit_logs_budget_id_fkey;
ALTER TABLE public.budget_audit_logs ALTER COLUMN budget_id DROP NOT NULL;

-- ── 1. BUDGET HIERARCHY VALIDATION & ACTOR HARDENING ─────────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_validate_budget_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_base numeric(15,2);
  v_allocated numeric(15,2);
  v_actor_id uuid;
  v_is_trusted boolean;
BEGIN
  -- 1. Actor resolution & anti-spoofing
  IF auth.uid() IS NOT NULL THEN
    v_actor_id := auth.uid();
  ELSE
    v_is_trusted := (
      current_user IN ('postgres', 'service_role', 'supabase_admin')
      OR current_setting('session_replication_role', true) = 'replica'
      OR NULLIF(current_setting('app.trusted_internal_execution', true), '') = 'on'
    );
    IF NOT v_is_trusted THEN
      RAISE EXCEPTION 'Cannot mutate budget without authenticated session or trusted internal execution context';
    END IF;
    v_actor_id := COALESCE(
      NEW.updated_by,
      NEW.created_by,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.updated_by ELSE NULL END,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.created_by ELSE NULL END
    );
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'Cannot mutate budget in trusted context without explicit creator/actor';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := v_actor_id;
    NEW.updated_by := v_actor_id;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := clock_timestamp();
  ELSIF TG_OP = 'UPDATE' THEN
    -- Entity identity and mapping immutability
    IF OLD.workspace_id <> NEW.workspace_id OR
       OLD.entity_type <> NEW.entity_type OR
       OLD.project_id IS DISTINCT FROM NEW.project_id OR
       OLD.phase_id IS DISTINCT FROM NEW.phase_id OR
       OLD.task_list_id IS DISTINCT FROM NEW.task_list_id OR
       OLD.created_by <> NEW.created_by OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Budget entity identity, tenancy, and container mapping are strictly immutable';
    END IF;

    NEW.updated_by := v_actor_id;
    NEW.updated_at := clock_timestamp();
  END IF;

  -- 2. Budget allocation hierarchy checks
  IF NEW.entity_type = 'project' THEN
    IF NEW.phase_id IS NOT NULL OR NEW.task_list_id IS NOT NULL THEN
      RAISE EXCEPTION 'Project budget must have phase_id and task_list_id as NULL';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Check that new Project Base Budget is not reduced below existing child Phase Base Budgets
      SELECT COALESCE(SUM(b.base_budget), 0) INTO v_allocated
      FROM public.budgets b
      WHERE b.workspace_id = NEW.workspace_id
        AND b.project_id = NEW.project_id
        AND b.entity_type = 'phase';

      IF NEW.base_budget < v_allocated THEN
        RAISE EXCEPTION 'Cannot reduce Project Base Budget to % because child Phase allocations total %', NEW.base_budget, v_allocated;
      END IF;
    END IF;

  ELSIF NEW.entity_type = 'phase' THEN
    IF NEW.project_id IS NULL OR NEW.phase_id IS NULL OR NEW.task_list_id IS NOT NULL THEN
      RAISE EXCEPTION 'Phase budget must have project_id and phase_id populated, and task_list_id as NULL';
    END IF;

    IF NEW.base_budget > 0 THEN
      -- Requires parent Project budget with base_budget > 0
      SELECT b.base_budget INTO v_parent_base
      FROM public.budgets b
      WHERE b.workspace_id = NEW.workspace_id
        AND b.project_id = NEW.project_id
        AND b.entity_type = 'project';

      IF v_parent_base IS NULL OR v_parent_base <= 0 THEN
        RAISE EXCEPTION 'Cannot allocate Phase Base Budget without a positive parent Project Base Budget';
      END IF;

      SELECT COALESCE(SUM(b.base_budget), 0) INTO v_allocated
      FROM public.budgets b
      WHERE b.workspace_id = NEW.workspace_id
        AND b.project_id = NEW.project_id
        AND b.entity_type = 'phase'
        AND b.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

      IF (v_allocated + NEW.base_budget) > v_parent_base THEN
        RAISE EXCEPTION 'Sum of Phase Base Budgets (%) exceeds Project Base Budget (%)', (v_allocated + NEW.base_budget), v_parent_base;
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Check that new Phase Base Budget is not reduced below existing child Task List Base Budgets
      SELECT COALESCE(SUM(b.base_budget), 0) INTO v_allocated
      FROM public.budgets b
      WHERE b.workspace_id = NEW.workspace_id
        AND b.phase_id = NEW.phase_id
        AND b.entity_type = 'task_list';

      IF NEW.base_budget < v_allocated THEN
        RAISE EXCEPTION 'Cannot reduce Phase Base Budget to % because child Task List allocations total %', NEW.base_budget, v_allocated;
      END IF;
    END IF;

  ELSIF NEW.entity_type = 'task_list' THEN
    IF NEW.project_id IS NULL OR NEW.phase_id IS NULL OR NEW.task_list_id IS NULL THEN
      RAISE EXCEPTION 'Task List budget must have project_id, phase_id, and task_list_id populated';
    END IF;

    IF NEW.base_budget > 0 THEN
      -- Requires immediate parent Phase budget with base_budget > 0
      SELECT b.base_budget INTO v_parent_base
      FROM public.budgets b
      WHERE b.workspace_id = NEW.workspace_id
        AND b.phase_id = NEW.phase_id
        AND b.entity_type = 'phase';

      IF v_parent_base IS NULL OR v_parent_base <= 0 THEN
        RAISE EXCEPTION 'Cannot allocate Task List Base Budget without a positive parent Phase Base Budget';
      END IF;

      SELECT COALESCE(SUM(b.base_budget), 0) INTO v_allocated
      FROM public.budgets b
      WHERE b.workspace_id = NEW.workspace_id
        AND b.phase_id = NEW.phase_id
        AND b.entity_type = 'task_list'
        AND b.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

      IF (v_allocated + NEW.base_budget) > v_parent_base THEN
        RAISE EXCEPTION 'Sum of Task List Base Budgets (%) exceeds Phase Base Budget (%)', (v_allocated + NEW.base_budget), v_parent_base;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid entity_type % for budget', NEW.entity_type;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. BUDGET AUDIT MUTATION TRIGGER & ACTOR HARDENING ───────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_audit_budget_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_entity_id uuid;
  v_is_trusted boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_actor_id := auth.uid();
  ELSE
    v_is_trusted := (
      current_user IN ('postgres', 'service_role', 'supabase_admin')
      OR current_setting('session_replication_role', true) = 'replica'
      OR NULLIF(current_setting('app.trusted_internal_execution', true), '') = 'on'
    );
    IF NOT v_is_trusted THEN
      RAISE EXCEPTION 'Cannot mutate budget without authenticated session or trusted internal execution context';
    END IF;
    v_actor_id := COALESCE(
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.updated_by ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.created_by ELSE NULL END,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.updated_by ELSE NULL END,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.created_by ELSE NULL END
    );
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'Cannot record budget audit in trusted context without explicit creator/actor';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_entity_id := CASE NEW.entity_type
      WHEN 'project' THEN NEW.project_id
      WHEN 'phase' THEN NEW.phase_id
      WHEN 'task_list' THEN NEW.task_list_id
    END;

    INSERT INTO public.budget_audit_logs (
      workspace_id, budget_id, entity_type, entity_id, action,
      previous_base_budget, new_base_budget,
      previous_safety_buffer, new_safety_buffer,
      actor_id, created_at
    ) VALUES (
      NEW.workspace_id, NEW.id, NEW.entity_type, v_entity_id, 'created',
      NULL, NEW.base_budget,
      NULL, NEW.safety_buffer,
      v_actor_id, clock_timestamp()
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_entity_id := CASE NEW.entity_type
      WHEN 'project' THEN NEW.project_id
      WHEN 'phase' THEN NEW.phase_id
      WHEN 'task_list' THEN NEW.task_list_id
    END;

    IF OLD.base_budget IS DISTINCT FROM NEW.base_budget OR
       OLD.safety_buffer IS DISTINCT FROM NEW.safety_buffer THEN
      INSERT INTO public.budget_audit_logs (
        workspace_id, budget_id, entity_type, entity_id, action,
        previous_base_budget, new_base_budget,
        previous_safety_buffer, new_safety_buffer,
        actor_id, created_at
      ) VALUES (
        NEW.workspace_id, NEW.id, NEW.entity_type, v_entity_id, 'updated',
        OLD.base_budget, NEW.base_budget,
        OLD.safety_buffer, NEW.safety_buffer,
        v_actor_id, clock_timestamp()
      );
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_entity_id := CASE OLD.entity_type
      WHEN 'project' THEN OLD.project_id
      WHEN 'phase' THEN OLD.phase_id
      WHEN 'task_list' THEN OLD.task_list_id
    END;

    INSERT INTO public.budget_audit_logs (
      workspace_id, budget_id, entity_type, entity_id, action,
      previous_base_budget, new_base_budget,
      previous_safety_buffer, new_safety_buffer,
      actor_id, created_at
    ) VALUES (
      OLD.workspace_id, OLD.id, OLD.entity_type, v_entity_id, 'deleted',
      OLD.base_budget, NULL,
      OLD.safety_buffer, NULL,
      v_actor_id, clock_timestamp()
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- ── 3. EXPENSE TRANSACTION SOURCE & ACTOR HARDENING ──────────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_derive_expense_transaction_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_actor_id uuid;
  v_is_trusted boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_actor_id := auth.uid();
  ELSE
    v_is_trusted := (
      current_user IN ('postgres', 'service_role', 'supabase_admin')
      OR current_setting('session_replication_role', true) = 'replica'
      OR NULLIF(current_setting('app.trusted_internal_execution', true), '') = 'on'
    );
    IF NOT v_is_trusted THEN
      RAISE EXCEPTION 'Cannot record expense transaction without authenticated session or trusted internal execution context';
    END IF;
    v_actor_id := COALESCE(NEW.created_by, NEW.updated_by);
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'Cannot record expense transaction in trusted context without explicit creator';
    END IF;
  END IF;

  SELECT COALESCE(
    (SELECT p.workspace_id FROM public.tasks t JOIN public.projects p ON t.project_id = p.id WHERE t.id = NEW.task_id),
    (SELECT pi.workspace_id FROM public.tasks t JOIN public.process_instances pi ON t.process_instance_id = pi.id WHERE t.id = NEW.task_id)
  ) INTO v_workspace_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Task % has no resolvable workspace tenancy (project_id and process_instance_id are null)', NEW.task_id;
  END IF;

  NEW.workspace_id := v_workspace_id;
  NEW.created_by := v_actor_id;
  NEW.updated_by := v_actor_id;
  NEW.created_at := clock_timestamp();
  NEW.updated_at := clock_timestamp();

  RETURN NEW;
END;
$$;

-- ── 4. BUDGET REALLOCATION VALIDATION & ACTOR HARDENING ──────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_validate_budget_reallocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from record;
  v_to record;
  v_actor_id uuid;
  v_is_trusted boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_actor_id := auth.uid();
  ELSE
    v_is_trusted := (
      current_user IN ('postgres', 'service_role', 'supabase_admin')
      OR current_setting('session_replication_role', true) = 'replica'
      OR NULLIF(current_setting('app.trusted_internal_execution', true), '') = 'on'
    );
    IF NOT v_is_trusted THEN
      RAISE EXCEPTION 'Cannot execute reallocation without authenticated session or trusted internal execution context';
    END IF;
    v_actor_id := NEW.actor_id;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'Cannot execute reallocation in trusted context without explicit actor_id';
    END IF;
  END IF;

  SELECT * INTO v_from FROM public.budgets WHERE id = NEW.from_budget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source budget % does not exist', NEW.from_budget_id;
  END IF;

  SELECT * INTO v_to FROM public.budgets WHERE id = NEW.to_budget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination budget % does not exist', NEW.to_budget_id;
  END IF;

  IF v_from.workspace_id <> v_to.workspace_id THEN
    RAISE EXCEPTION 'Reallocation budgets must belong to the same workspace';
  END IF;

  IF NOT private.can_manage_budgets(v_from.workspace_id, v_actor_id) THEN
    RAISE EXCEPTION 'Caller is not authorized to reallocate budgets in workspace %', v_from.workspace_id;
  END IF;

  IF v_from.entity_type <> v_to.entity_type THEN
    RAISE EXCEPTION 'Reallocation is permitted strictly between sibling entities of the same type';
  END IF;

  IF v_from.entity_type = 'phase' AND v_from.project_id <> v_to.project_id THEN
    RAISE EXCEPTION 'Phase reallocation is permitted strictly between phases in the same project';
  END IF;

  IF v_from.entity_type = 'task_list' AND v_from.phase_id <> v_to.phase_id THEN
    RAISE EXCEPTION 'Task List reallocation is permitted strictly between task lists in the same phase';
  END IF;

  NEW.workspace_id := v_from.workspace_id;
  NEW.actor_id := v_actor_id;
  NEW.created_at := clock_timestamp();

  RETURN NEW;
END;
$$;

-- ── 5. BUDGET SELECT POLICY DIRECT RE-ALIGNMENT ──────────────────────────────

DROP POLICY IF EXISTS budgets_select_policy ON public.budgets;
CREATE POLICY budgets_select_policy ON public.budgets
  FOR SELECT TO authenticated
  USING (
    private.can_manage_budgets(workspace_id)
    OR private.is_finance_operator(workspace_id)
    OR (
      project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = budgets.project_id AND p.owner_id = auth.uid()
      )
    )
    OR (
      phase_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.phases ph WHERE ph.id = budgets.phase_id AND ph.owner_id = auth.uid()
      )
    )
  );
