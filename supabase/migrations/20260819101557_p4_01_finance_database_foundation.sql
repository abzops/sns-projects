-- ============================================================================
-- SNS PROJECTS — PACKAGE 4 / P4-01
-- Migration: 20260819101557_p4_01_finance_database_foundation.sql
-- Description: Finance Database Foundation:
--              1. Budgets table (Project, Phase, Task List; Base Budget + Fixed Buffer).
--              2. Normalized Expense Ledger (expense_transactions + expense_items).
--              3. Immutable Audit Logs & Reallocations.
--              4. Composite hierarchy & tenancy constraints (ON DELETE RESTRICT).
--              5. Hardened private authorization helpers & RLS policies.
--              6. Canonical deterministic risk engine & rollup contract.
--              7. Zero new Security Advisor warnings.
-- ============================================================================

BEGIN;

-- ── 1. BUDGETS TABLE ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budgets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type    text NOT NULL CHECK (entity_type IN ('project', 'phase', 'task_list')),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  phase_id       uuid REFERENCES public.phases(id) ON DELETE RESTRICT,
  task_list_id   uuid REFERENCES public.task_lists(id) ON DELETE RESTRICT,
  base_budget    numeric(15,2) NOT NULL DEFAULT 0.00 CHECK (base_budget >= 0),
  safety_buffer  numeric(15,2) NOT NULL DEFAULT 0.00 CHECK (safety_buffer >= 0),
  created_by     uuid REFERENCES public.profiles(id),
  updated_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_budgets_phase FOREIGN KEY (phase_id, project_id) REFERENCES public.phases(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_budgets_task_list FOREIGN KEY (task_list_id, phase_id, project_id) REFERENCES public.task_lists(id, phase_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT chk_budgets_entity_structure CHECK (
    (entity_type = 'project' AND phase_id IS NULL AND task_list_id IS NULL) OR
    (entity_type = 'phase' AND phase_id IS NOT NULL AND task_list_id IS NULL) OR
    (entity_type = 'task_list' AND task_list_id IS NOT NULL AND phase_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_project ON public.budgets (workspace_id, project_id) WHERE entity_type = 'project';
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_phase ON public.budgets (workspace_id, phase_id) WHERE entity_type = 'phase';
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_task_list ON public.budgets (workspace_id, task_list_id) WHERE entity_type = 'task_list';

CREATE INDEX IF NOT EXISTS idx_budgets_project ON public.budgets (project_id);
CREATE INDEX IF NOT EXISTS idx_budgets_phase ON public.budgets (phase_id) WHERE phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_task_list ON public.budgets (task_list_id) WHERE task_list_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_workspace ON public.budgets (workspace_id);

-- ── 2. BUDGET AUDIT LOGS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_audit_logs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  budget_id              uuid REFERENCES public.budgets(id) ON DELETE SET NULL,
  entity_type            text NOT NULL CHECK (entity_type IN ('project', 'phase', 'task_list')),
  entity_id              uuid NOT NULL,
  action                 text NOT NULL CHECK (action IN ('created', 'updated', 'reallocated', 'deleted')),
  previous_base_budget   numeric(15,2),
  new_base_budget        numeric(15,2),
  previous_safety_buffer numeric(15,2),
  new_safety_buffer      numeric(15,2),
  reason                 text,
  actor_id               uuid NOT NULL REFERENCES public.profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_audit_logs_budget ON public.budget_audit_logs (budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_audit_logs_workspace ON public.budget_audit_logs (workspace_id);

-- ── 3. BUDGET REALLOCATIONS ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_reallocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  from_budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  to_budget_id   uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  amount         numeric(15,2) NOT NULL CHECK (amount > 0),
  reason         text NOT NULL CHECK (length(trim(reason)) > 0),
  actor_id       uuid NOT NULL REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_reallocation_distinct_budgets CHECK (from_budget_id <> to_budget_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_reallocations_workspace ON public.budget_reallocations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_budget_reallocations_from ON public.budget_reallocations (from_budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_reallocations_to ON public.budget_reallocations (to_budget_id);

-- ── 4. EXPENSE TRANSACTIONS & ITEMS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  description  text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'corrected', 'voided')),
  created_by   uuid NOT NULL REFERENCES public.profiles(id),
  updated_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_transactions_task ON public.expense_transactions (task_id);
CREATE INDEX IF NOT EXISTS idx_expense_transactions_workspace_status ON public.expense_transactions (workspace_id, status);

CREATE TABLE IF NOT EXISTS public.expense_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.expense_transactions(id) ON DELETE CASCADE,
  line_number    int NOT NULL DEFAULT 1 CHECK (line_number >= 1),
  amount         numeric(15,2) NOT NULL CHECK (amount > 0),
  category       text,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_expense_transaction_line UNIQUE (transaction_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_expense_items_transaction ON public.expense_items (transaction_id);

-- ── 5. EXPENSE AUDIT LOGS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_audit_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transaction_id        uuid REFERENCES public.expense_transactions(id) ON DELETE SET NULL,
  action                text NOT NULL CHECK (action IN ('created', 'corrected', 'voided', 'hard_deleted')),
  previous_status       text,
  new_status            text,
  previous_total_amount numeric(15,2),
  new_total_amount      numeric(15,2),
  reason                text,
  actor_id              uuid NOT NULL REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_expense_audit_reason CHECK (
    action = 'created' OR
    (action IN ('corrected', 'voided', 'hard_deleted') AND reason IS NOT NULL AND length(trim(reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_expense_audit_logs_transaction ON public.expense_audit_logs (transaction_id);
CREATE INDEX IF NOT EXISTS idx_expense_audit_logs_workspace ON public.expense_audit_logs (workspace_id);

-- ── 6. ENABLE ROW LEVEL SECURITY ──────────────────────────────────────────────

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_reallocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_audit_logs ENABLE ROW LEVEL SECURITY;

-- ── 7. PRIVATE AUTHORIZATION HELPERS ──────────────────────────────────────────

DROP FUNCTION IF EXISTS private.can_manage_budgets(uuid);
DROP FUNCTION IF EXISTS private.can_manage_budgets(uuid, uuid);
DROP FUNCTION IF EXISTS private.is_finance_operator(uuid);
DROP FUNCTION IF EXISTS private.is_finance_operator(uuid, uuid);
DROP FUNCTION IF EXISTS private.can_view_budget(uuid);
DROP FUNCTION IF EXISTS private.can_view_budget(uuid, uuid);
DROP FUNCTION IF EXISTS private.can_view_expense_transaction(uuid);
DROP FUNCTION IF EXISTS private.can_view_expense_transaction(uuid, uuid);
DROP FUNCTION IF EXISTS private.compute_financial_summary(uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION private.can_manage_budgets(
  p_workspace_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.workspaces w
        WHERE w.id = p_workspace_id
          AND w.created_by = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = p_user_id
          AND wm.status = 'active'
          AND (
            wm.role IN ('owner', 'admin')
            OR EXISTS (
              SELECT 1
              FROM public.user_system_roles usr
              WHERE usr.workspace_id = p_workspace_id
                AND usr.user_id = p_user_id
                AND usr.role IN ('ceo', 'cto')
            )
          )
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.is_finance_operator(
  p_workspace_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      JOIN public.department_memberships dm ON dm.workspace_id = wm.workspace_id AND dm.user_id = wm.user_id
      JOIN public.departments d ON d.id = dm.department_id
      WHERE wm.workspace_id = p_workspace_id
        AND wm.user_id = p_user_id
        AND wm.status = 'active'
        AND dm.is_active = true
        AND d.is_active = true
        AND d.code = 'FIN'
    );
$$;

CREATE OR REPLACE FUNCTION private.can_view_budget(
  p_budget_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_b record;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_budget_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT b.workspace_id, b.entity_type, b.project_id, b.phase_id, b.task_list_id
  INTO v_b
  FROM public.budgets b
  WHERE b.id = p_budget_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 1. Budget manager or Finance operator
  IF private.can_manage_budgets(v_b.workspace_id) OR private.is_finance_operator(v_b.workspace_id) THEN
    RETURN true;
  END IF;

  -- 2. Project Owner gets Project budget + descendant Phase/Task List budgets
  IF EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = v_b.project_id
      AND p.owner_id = v_user_id
  ) THEN
    RETURN true;
  END IF;

  -- 3. Phase Owner gets Phase budget + child Task List budgets
  IF v_b.phase_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.phases ph
    WHERE ph.id = v_b.phase_id
      AND ph.owner_id = v_user_id
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_expense_transaction(
  p_transaction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_et record;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_transaction_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT et.workspace_id, et.task_id
  INTO v_et
  FROM public.expense_transactions et
  WHERE et.id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 1. Budget manager or Finance operator
  IF private.can_manage_budgets(v_et.workspace_id) OR private.is_finance_operator(v_et.workspace_id) THEN
    RETURN true;
  END IF;

  -- 2. Ordinary user: exact expenses only for tasks visible through Operational V1 RLS
  RETURN private.can_view_operational_task(v_et.task_id);
END;
$$;

-- ── 8. TRIGGERS & BUSINESS INTEGRITY ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.trg_fn_validate_budget_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_proj_workspace_id uuid;
  v_parent_base numeric(15,2);
  v_allocated numeric(15,2);
BEGIN
  -- Resolve authoritative workspace from project
  SELECT p.workspace_id INTO v_proj_workspace_id
  FROM public.projects p
  WHERE p.id = NEW.project_id;

  IF v_proj_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', NEW.project_id;
  END IF;

  IF NEW.workspace_id <> v_proj_workspace_id THEN
    RAISE EXCEPTION 'Budget workspace % does not match project workspace %', NEW.workspace_id, v_proj_workspace_id;
  END IF;

  -- Immutability on UPDATE
  IF TG_OP = 'UPDATE' THEN
    IF OLD.workspace_id <> NEW.workspace_id OR
       OLD.entity_type <> NEW.entity_type OR
       OLD.project_id <> NEW.project_id OR
       OLD.phase_id IS DISTINCT FROM NEW.phase_id OR
       OLD.task_list_id IS DISTINCT FROM NEW.task_list_id OR
       OLD.created_by IS DISTINCT FROM NEW.created_by OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Budget entity identity, project/phase/task_list mapping, and creation metadata are immutable';
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
  ELSE
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, NEW.created_by);
    NEW.created_at := clock_timestamp();
    NEW.updated_at := clock_timestamp();
  END IF;

  -- Hierarchy Allocation Validation
  IF NEW.entity_type = 'phase' AND NEW.base_budget > 0 THEN
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

  ELSIF NEW.entity_type = 'task_list' AND NEW.base_budget > 0 THEN
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

  ELSIF NEW.entity_type = 'project' AND TG_OP = 'UPDATE' THEN
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budgets_validate_hierarchy ON public.budgets;
CREATE TRIGGER trg_budgets_validate_hierarchy
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_validate_budget_hierarchy();

CREATE OR REPLACE FUNCTION private.trg_fn_audit_budget_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := COALESCE(auth.uid(), NEW.updated_by, NEW.created_by, OLD.updated_by, OLD.created_by);
  v_entity_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Cannot mutate budget without authenticated actor or explicit creator';
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

DROP TRIGGER IF EXISTS trg_budgets_audit ON public.budgets;
CREATE TRIGGER trg_budgets_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budgets
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_audit_budget_mutation();

CREATE OR REPLACE FUNCTION private.trg_fn_derive_expense_transaction_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_actor_id uuid;
BEGIN
  v_actor_id := COALESCE(auth.uid(), NEW.created_by);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Cannot record expense transaction without authenticated actor or explicit creator';
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

DROP TRIGGER IF EXISTS trg_expense_transactions_source ON public.expense_transactions;
CREATE TRIGGER trg_expense_transactions_source
  BEFORE INSERT ON public.expense_transactions
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_derive_expense_transaction_source();

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
BEGIN
  v_actor_id := COALESCE(auth.uid(), NEW.actor_id);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Cannot execute reallocation without authenticated actor or explicit actor_id';
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

DROP TRIGGER IF EXISTS trg_budget_reallocations_validate ON public.budget_reallocations;
CREATE TRIGGER trg_budget_reallocations_validate
  BEFORE INSERT ON public.budget_reallocations
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_validate_budget_reallocation();

-- ── 9. CANONICAL RISK CALCULATION ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calculate_financial_risk_band(
  p_actual_spend numeric,
  p_base_budget numeric,
  p_safety_buffer numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(p_base_budget, 0) <= 0 AND COALESCE(p_safety_buffer, 0) <= 0 THEN
      CASE WHEN COALESCE(p_actual_spend, 0) <= 0 THEN 'GREEN' ELSE 'RED' END
    WHEN COALESCE(p_actual_spend, 0) < (0.80 * p_base_budget) THEN 'GREEN'
    WHEN COALESCE(p_actual_spend, 0) <= p_base_budget THEN 'YELLOW'
    WHEN COALESCE(p_safety_buffer, 0) > 0 AND COALESCE(p_actual_spend, 0) <= (p_base_budget + p_safety_buffer) THEN 'ORANGE'
    ELSE 'RED'
  END;
$$;

-- ── 10. FINANCIAL ROLLUP & SUMMARY ENGINE ─────────────────────────────────────

CREATE OR REPLACE FUNCTION private.compute_financial_summary(
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_phase_id uuid DEFAULT NULL,
  p_task_list_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity_type text;
  v_entity_id uuid;
  v_is_budgeted boolean := false;
  v_budget_source_type text := 'none';
  v_budget_source_id uuid := NULL;
  v_base_budget numeric(15,2) := 0.00;
  v_safety_buffer numeric(15,2) := 0.00;
  v_total_ceiling numeric(15,2) := 0.00;
  v_actual_spend numeric(15,2) := 0.00;
  v_remaining_base numeric(15,2) := 0.00;
  v_buffer_used numeric(15,2) := 0.00;
  v_buffer_remaining numeric(15,2) := 0.00;
  v_overrun numeric(15,2) := 0.00;
  v_utilization_pct numeric(7,2) := 0.00;
  v_risk_band text := 'GREEN';
  v_allocated_children numeric(15,2) := 0.00;
  v_unallocated_base numeric(15,2) := 0.00;
  v_standalone_spend numeric(15,2) := 0.00;
  v_project_spend numeric(15,2) := 0.00;
  v_b record;
BEGIN
  IF p_task_list_id IS NOT NULL THEN
    v_entity_type := 'task_list';
    v_entity_id := p_task_list_id;

    -- Actual spend: sum of leaf items for all tasks currently in this task list
    SELECT COALESCE(SUM(ei.amount), 0.00) INTO v_actual_spend
    FROM public.tasks t
    JOIN public.expense_transactions et ON et.task_id = t.id AND et.status IN ('active', 'corrected')
    JOIN public.expense_items ei ON ei.transaction_id = et.id
    WHERE t.task_list_id = p_task_list_id;

    -- 1. Check own budget
    SELECT b.id, b.base_budget, b.safety_buffer INTO v_b
    FROM public.budgets b
    WHERE b.task_list_id = p_task_list_id AND b.entity_type = 'task_list';

    IF FOUND THEN
      v_is_budgeted := true;
      v_budget_source_type := 'task_list';
      v_budget_source_id := v_b.id;
      v_base_budget := v_b.base_budget;
      v_safety_buffer := v_b.safety_buffer;
    ELSE
      -- 2. Check parent Phase budget
      SELECT b.id, b.base_budget, b.safety_buffer INTO v_b
      FROM public.task_lists tl
      JOIN public.budgets b ON b.phase_id = tl.phase_id AND b.entity_type = 'phase'
      WHERE tl.id = p_task_list_id;

      IF FOUND THEN
        v_budget_source_type := 'phase';
        v_budget_source_id := v_b.id;
        v_base_budget := v_b.base_budget;
        v_safety_buffer := v_b.safety_buffer;
      ELSE
        -- 3. Check parent Project budget
        SELECT b.id, b.base_budget, b.safety_buffer INTO v_b
        FROM public.task_lists tl
        JOIN public.budgets b ON b.project_id = tl.project_id AND b.entity_type = 'project'
        WHERE tl.id = p_task_list_id;

        IF FOUND THEN
          v_budget_source_type := 'project';
          v_budget_source_id := v_b.id;
          v_base_budget := v_b.base_budget;
          v_safety_buffer := v_b.safety_buffer;
        END IF;
      END IF;
    END IF;

  ELSIF p_phase_id IS NOT NULL THEN
    v_entity_type := 'phase';
    v_entity_id := p_phase_id;

    -- Actual spend: sum of leaf items for all tasks currently in this phase
    SELECT COALESCE(SUM(ei.amount), 0.00) INTO v_actual_spend
    FROM public.tasks t
    JOIN public.expense_transactions et ON et.task_id = t.id AND et.status IN ('active', 'corrected')
    JOIN public.expense_items ei ON ei.transaction_id = et.id
    WHERE t.phase_id = p_phase_id;

    -- 1. Check own budget
    SELECT b.id, b.base_budget, b.safety_buffer INTO v_b
    FROM public.budgets b
    WHERE b.phase_id = p_phase_id AND b.entity_type = 'phase';

    IF FOUND THEN
      v_is_budgeted := true;
      v_budget_source_type := 'phase';
      v_budget_source_id := v_b.id;
      v_base_budget := v_b.base_budget;
      v_safety_buffer := v_b.safety_buffer;

      SELECT COALESCE(SUM(b.base_budget), 0.00) INTO v_allocated_children
      FROM public.budgets b
      WHERE b.phase_id = p_phase_id AND b.entity_type = 'task_list';

      v_unallocated_base := GREATEST(0.00, v_base_budget - v_allocated_children);
    ELSE
      -- 2. Check parent Project budget
      SELECT b.id, b.base_budget, b.safety_buffer INTO v_b
      FROM public.phases ph
      JOIN public.budgets b ON b.project_id = ph.project_id AND b.entity_type = 'project'
      WHERE ph.id = p_phase_id;

      IF FOUND THEN
        v_budget_source_type := 'project';
        v_budget_source_id := v_b.id;
        v_base_budget := v_b.base_budget;
        v_safety_buffer := v_b.safety_buffer;
      END IF;
    END IF;

  ELSIF p_project_id IS NOT NULL THEN
    v_entity_type := 'project';
    v_entity_id := p_project_id;

    -- Actual spend: sum of leaf items for all tasks currently in this project
    SELECT COALESCE(SUM(ei.amount), 0.00) INTO v_actual_spend
    FROM public.tasks t
    JOIN public.expense_transactions et ON et.task_id = t.id AND et.status IN ('active', 'corrected')
    JOIN public.expense_items ei ON ei.transaction_id = et.id
    WHERE t.project_id = p_project_id;

    -- Check project budget
    SELECT b.id, b.base_budget, b.safety_buffer INTO v_b
    FROM public.budgets b
    WHERE b.project_id = p_project_id AND b.entity_type = 'project';

    IF FOUND THEN
      v_is_budgeted := true;
      v_budget_source_type := 'project';
      v_budget_source_id := v_b.id;
      v_base_budget := v_b.base_budget;
      v_safety_buffer := v_b.safety_buffer;

      SELECT COALESCE(SUM(b.base_budget), 0.00) INTO v_allocated_children
      FROM public.budgets b
      WHERE b.project_id = p_project_id AND b.entity_type = 'phase';

      v_unallocated_base := GREATEST(0.00, v_base_budget - v_allocated_children);
    END IF;

  ELSE
    -- Workspace / Company Summary
    v_entity_type := 'workspace';
    v_entity_id := p_workspace_id;

    -- Project spend
    SELECT COALESCE(SUM(ei.amount), 0.00) INTO v_project_spend
    FROM public.tasks t
    JOIN public.expense_transactions et ON et.task_id = t.id AND et.status IN ('active', 'corrected')
    JOIN public.expense_items ei ON ei.transaction_id = et.id
    JOIN public.projects p ON t.project_id = p.id
    WHERE p.workspace_id = p_workspace_id;

    -- Standalone spend (standalone processes)
    SELECT COALESCE(SUM(ei.amount), 0.00) INTO v_standalone_spend
    FROM public.tasks t
    JOIN public.expense_transactions et ON et.task_id = t.id AND et.status IN ('active', 'corrected')
    JOIN public.expense_items ei ON ei.transaction_id = et.id
    JOIN public.process_instances pi ON t.process_instance_id = pi.id
    WHERE t.project_id IS NULL AND pi.workspace_id = p_workspace_id;

    v_actual_spend := v_project_spend + v_standalone_spend;

    SELECT COALESCE(SUM(b.base_budget), 0.00), COALESCE(SUM(b.safety_buffer), 0.00)
    INTO v_base_budget, v_safety_buffer
    FROM public.budgets b
    WHERE b.workspace_id = p_workspace_id AND b.entity_type = 'project';

    v_is_budgeted := (v_base_budget > 0 OR v_safety_buffer > 0);
    v_budget_source_type := 'workspace';
  END IF;

  -- Calculations
  v_total_ceiling := v_base_budget + v_safety_buffer;
  v_remaining_base := GREATEST(0.00, v_base_budget - v_actual_spend);

  IF v_actual_spend > v_base_budget THEN
    v_buffer_used := LEAST(v_safety_buffer, v_actual_spend - v_base_budget);
  ELSE
    v_buffer_used := 0.00;
  END IF;

  v_buffer_remaining := GREATEST(0.00, v_safety_buffer - v_buffer_used);
  v_overrun := GREATEST(0.00, v_actual_spend - v_total_ceiling);

  IF v_base_budget > 0 THEN
    v_utilization_pct := ROUND((v_actual_spend / v_base_budget) * 100.0, 2);
  ELSE
    v_utilization_pct := 0.00;
  END IF;

  v_risk_band := public.calculate_financial_risk_band(v_actual_spend, v_base_budget, v_safety_buffer);

  RETURN jsonb_build_object(
    'entity_type', v_entity_type,
    'entity_id', v_entity_id,
    'is_budgeted', v_is_budgeted,
    'budget_source_type', v_budget_source_type,
    'budget_source_id', v_budget_source_id,
    'base_budget', v_base_budget,
    'safety_buffer', v_safety_buffer,
    'total_ceiling', v_total_ceiling,
    'actual_spend', v_actual_spend,
    'remaining_base', v_remaining_base,
    'buffer_used', v_buffer_used,
    'buffer_remaining', v_buffer_remaining,
    'overrun', v_overrun,
    'utilization_pct', v_utilization_pct,
    'risk_band', v_risk_band,
    'allocated_to_children', v_allocated_children,
    'unallocated_base', v_unallocated_base,
    'project_spend', v_project_spend,
    'standalone_spend', v_standalone_spend
  );
END;
$$;

-- Public Summary Endpoints (SECURITY INVOKER)

CREATE OR REPLACE FUNCTION public.get_project_financial_summary(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_project_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Authorization check: Budget Manager, Finance Operator, or Project Owner
  IF NOT (
    private.can_manage_budgets(v_workspace_id)
    OR private.is_finance_operator(v_workspace_id)
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.owner_id = v_user_id)
  ) THEN
    RETURN NULL;
  END IF;

  RETURN private.compute_financial_summary(v_workspace_id, p_project_id, NULL, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_phase_financial_summary(
  p_phase_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ph record;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_phase_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ph.id, ph.project_id, ph.owner_id, p.workspace_id, p.owner_id AS project_owner_id
  INTO v_ph
  FROM public.phases ph
  JOIN public.projects p ON p.id = ph.project_id
  WHERE ph.id = p_phase_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Authorization check: Budget Manager, Finance Operator, Project Owner, or Phase Owner
  IF NOT (
    private.can_manage_budgets(v_ph.workspace_id)
    OR private.is_finance_operator(v_ph.workspace_id)
    OR v_ph.owner_id = v_user_id
    OR v_ph.project_owner_id = v_user_id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN private.compute_financial_summary(v_ph.workspace_id, v_ph.project_id, p_phase_id, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_task_list_financial_summary(
  p_task_list_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tl record;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_task_list_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT tl.id, tl.project_id, tl.phase_id, p.workspace_id, p.owner_id AS project_owner_id, ph.owner_id AS phase_owner_id
  INTO v_tl
  FROM public.task_lists tl
  JOIN public.projects p ON p.id = tl.project_id
  LEFT JOIN public.phases ph ON ph.id = tl.phase_id
  WHERE tl.id = p_task_list_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Authorization check: Budget Manager, Finance Operator, Project Owner, or Phase Owner
  IF NOT (
    private.can_manage_budgets(v_tl.workspace_id)
    OR private.is_finance_operator(v_tl.workspace_id)
    OR v_tl.project_owner_id = v_user_id
    OR (v_tl.phase_owner_id IS NOT NULL AND v_tl.phase_owner_id = v_user_id)
  ) THEN
    RETURN NULL;
  END IF;

  RETURN private.compute_financial_summary(v_tl.workspace_id, v_tl.project_id, v_tl.phase_id, p_task_list_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_financial_summary(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Authorization check: Budget Manager or Finance Operator
  IF NOT (
    private.can_manage_budgets(p_workspace_id)
    OR private.is_finance_operator(p_workspace_id)
  ) THEN
    RETURN NULL;
  END IF;

  RETURN private.compute_financial_summary(p_workspace_id, NULL, NULL, NULL);
END;
$$;

-- ── 11. RLS POLICIES ──────────────────────────────────────────────────────────

-- Budgets
DROP POLICY IF EXISTS budgets_select_policy ON public.budgets;
CREATE POLICY budgets_select_policy ON public.budgets
  FOR SELECT TO authenticated
  USING (private.can_view_budget(id));

DROP POLICY IF EXISTS budgets_insert_policy ON public.budgets;
CREATE POLICY budgets_insert_policy ON public.budgets
  FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_budgets(workspace_id));

DROP POLICY IF EXISTS budgets_update_policy ON public.budgets;
CREATE POLICY budgets_update_policy ON public.budgets
  FOR UPDATE TO authenticated
  USING (private.can_manage_budgets(workspace_id))
  WITH CHECK (private.can_manage_budgets(workspace_id));

DROP POLICY IF EXISTS budgets_delete_policy ON public.budgets;
CREATE POLICY budgets_delete_policy ON public.budgets
  FOR DELETE TO authenticated
  USING (private.can_manage_budgets(workspace_id));

-- Expense Transactions
DROP POLICY IF EXISTS expense_transactions_select_policy ON public.expense_transactions;
CREATE POLICY expense_transactions_select_policy ON public.expense_transactions
  FOR SELECT TO authenticated
  USING (private.can_view_expense_transaction(id));

-- Expense Items
DROP POLICY IF EXISTS expense_items_select_policy ON public.expense_items;
CREATE POLICY expense_items_select_policy ON public.expense_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_transactions et
      WHERE et.id = expense_items.transaction_id
        AND private.can_view_expense_transaction(et.id)
    )
  );

-- Budget Audit Logs
DROP POLICY IF EXISTS budget_audit_logs_select_policy ON public.budget_audit_logs;
CREATE POLICY budget_audit_logs_select_policy ON public.budget_audit_logs
  FOR SELECT TO authenticated
  USING (private.can_manage_budgets(workspace_id) OR private.is_finance_operator(workspace_id));

-- Budget Reallocations
DROP POLICY IF EXISTS budget_reallocations_select_policy ON public.budget_reallocations;
CREATE POLICY budget_reallocations_select_policy ON public.budget_reallocations
  FOR SELECT TO authenticated
  USING (private.can_manage_budgets(workspace_id) OR private.is_finance_operator(workspace_id));

-- Expense Audit Logs
DROP POLICY IF EXISTS expense_audit_logs_select_policy ON public.expense_audit_logs;
CREATE POLICY expense_audit_logs_select_policy ON public.expense_audit_logs
  FOR SELECT TO authenticated
  USING (private.can_manage_budgets(workspace_id) OR private.is_finance_operator(workspace_id));

-- ── 12. EXPLICIT PRIVILEGES ───────────────────────────────────────────────────

-- Revoke all from anon/public
REVOKE ALL ON public.budgets FROM anon, public;
REVOKE ALL ON public.budget_audit_logs FROM anon, public;
REVOKE ALL ON public.budget_reallocations FROM anon, public;
REVOKE ALL ON public.expense_transactions FROM anon, public;
REVOKE ALL ON public.expense_items FROM anon, public;
REVOKE ALL ON public.expense_audit_logs FROM anon, public;

-- Grant SELECT/DML on budgets
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;

-- Grant SELECT only on expense & audit tables (DML fail-closed in P4-01)
GRANT SELECT ON public.expense_transactions, public.expense_items TO authenticated;
GRANT SELECT ON public.budget_audit_logs, public.budget_reallocations, public.expense_audit_logs TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expense_transactions, public.expense_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.budget_audit_logs, public.budget_reallocations, public.expense_audit_logs FROM authenticated;

-- Function Privileges
REVOKE ALL ON FUNCTION private.can_manage_budgets(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_finance_operator(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_budget(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_expense_transaction(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.compute_financial_summary(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.can_manage_budgets(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_finance_operator(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_budget(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_expense_transaction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.compute_financial_summary(uuid, uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.calculate_financial_risk_band(numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_financial_risk_band(numeric, numeric, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.get_project_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_financial_summary(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_phase_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_phase_financial_summary(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_task_list_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_task_list_financial_summary(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_workspace_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_financial_summary(uuid) TO authenticated;

COMMIT;