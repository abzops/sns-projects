-- ==============================================================================
-- P6-05: FINANCE ALERT RUNTIME & PERSISTENT ALERT BACKEND
-- ==============================================================================
-- Delivers:
-- 1. Extension of notifications constraint with finance_risk_orange / finance_risk_red
-- 2. Internal risk state tracking table: private.finance_alert_risk_state
-- 3. Persistent incident table: public.finance_alerts (with partial unique unresolved index)
-- 4. Authoritative alert engine: private.reconcile_finance_alerts_for_workspace
-- 5. Mutation guard trigger enforcing immutability and valid lifecycle transitions
-- 6. Public mutation RPCs: acknowledge_finance_alert, resolve_finance_alert (SECURITY INVOKER)
-- 7. Deferred constraint triggers on budgets, expense_transactions, expense_items, tasks
-- 8. Realtime publication integration on public.finance_alerts
-- 9. Initial historical high-risk condition bootstrap (zero retroactive notifications)
-- ==============================================================================

-- 1. Extend notifications type check constraint
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'task_assigned'::text,
  'task_accountable'::text,
  'task_consulted'::text,
  'task_informed'::text,
  'raci_changed'::text,
  'task_status_changed'::text,
  'subtask_assigned'::text,
  'project_status_changed'::text,
  'system'::text,
  'process_task_ready'::text,
  'process_task_completed'::text,
  'consultation_required'::text,
  'process_consultation_response'::text,
  'approval_required'::text,
  'task_rework_required'::text,
  'rework_required'::text,
  'process_rework_requested'::text,
  'process_task_rejected'::text,
  'process_task_review_needed'::text,
  'process_completed'::text,
  'finance_risk_orange'::text,
  'finance_risk_red'::text
]));

-- 2. Private state table for tracking previously evaluated risk state
CREATE TABLE IF NOT EXISTS private.finance_alert_risk_state (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  budget_id uuid NULL,
  last_risk_band text NOT NULL,
  last_actual_spend numeric(15,2) NOT NULL DEFAULT 0.00,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entity_type, entity_id),
  CONSTRAINT chk_alert_risk_state_entity_type CHECK (entity_type IN ('project', 'phase', 'task_list')),
  CONSTRAINT chk_alert_risk_state_risk_band CHECK (last_risk_band IN ('GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNBUDGETED'))
);
REVOKE ALL ON TABLE private.finance_alert_risk_state FROM anon, authenticated, PUBLIC;

-- 3. Public persistent alerts table
CREATE TABLE IF NOT EXISTS public.finance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  budget_id uuid NULL REFERENCES public.budgets(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phase_id uuid NULL REFERENCES public.phases(id) ON DELETE CASCADE,
  task_list_id uuid NULL REFERENCES public.task_lists(id) ON DELETE CASCADE,
  entity_name text NOT NULL,
  opened_risk_band text NOT NULL,
  current_risk_band text NOT NULL,
  base_budget numeric(15,2) NOT NULL DEFAULT 0.00,
  safety_buffer numeric(15,2) NOT NULL DEFAULT 0.00,
  actual_spend numeric(15,2) NOT NULL DEFAULT 0.00,
  overrun numeric(15,2) NOT NULL DEFAULT 0.00,
  utilization_pct numeric(7,2) NOT NULL DEFAULT 0.00,
  lifecycle_status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_breached_at timestamptz NOT NULL DEFAULT now(),
  red_at timestamptz NULL,
  condition_cleared_at timestamptz NULL,
  acknowledged_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz NULL,
  resolved_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz NULL,
  resolution_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_finance_alerts_entity_type CHECK (entity_type IN ('project', 'phase', 'task_list')),
  CONSTRAINT chk_finance_alerts_opened_risk CHECK (opened_risk_band IN ('ORANGE', 'RED')),
  CONSTRAINT chk_finance_alerts_current_risk CHECK (current_risk_band IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
  CONSTRAINT chk_finance_alerts_status CHECK (lifecycle_status IN ('open', 'acknowledged', 'resolved'))
);

-- At most one UNRESOLVED incident per (workspace, entity_type, entity_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_alerts_unresolved 
  ON public.finance_alerts (workspace_id, entity_type, entity_id) 
  WHERE (lifecycle_status <> 'resolved');

CREATE INDEX IF NOT EXISTS idx_finance_alerts_ws_status_opened 
  ON public.finance_alerts (workspace_id, lifecycle_status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_alerts_ws_current_risk 
  ON public.finance_alerts (workspace_id, current_risk_band);

CREATE INDEX IF NOT EXISTS idx_finance_alerts_entity 
  ON public.finance_alerts (entity_type, entity_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_alerts_project_id 
  ON public.finance_alerts (project_id) WHERE project_id IS NOT NULL;

-- 4. Table grants & RLS on public.finance_alerts
ALTER TABLE public.finance_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.finance_alerts FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.finance_alerts FROM anon, PUBLIC;
GRANT SELECT, UPDATE (lifecycle_status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_note) ON TABLE public.finance_alerts TO authenticated;

DROP POLICY IF EXISTS finance_alerts_select_policy ON public.finance_alerts;
CREATE POLICY finance_alerts_select_policy ON public.finance_alerts
  FOR SELECT TO authenticated
  USING (
    private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
    OR
    private.is_finance_operator(workspace_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS finance_alerts_update_policy ON public.finance_alerts;
CREATE POLICY finance_alerts_update_policy ON public.finance_alerts
  FOR UPDATE TO authenticated
  USING (
    private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
    OR
    private.is_finance_operator(workspace_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    private.can_manage_budgets(workspace_id, (SELECT auth.uid()))
    OR
    private.is_finance_operator(workspace_id, (SELECT auth.uid()))
  );

-- 5. Authoritative Private Reconciliation Engine
CREATE OR REPLACE FUNCTION private.reconcile_finance_alerts_for_workspace(
  p_workspace_id uuid,
  p_emit_notifications boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec RECORD;
  v_summary jsonb;
  v_curr_risk text;
  v_base numeric(15,2);
  v_buffer numeric(15,2);
  v_actual numeric(15,2);
  v_overrun numeric(15,2);
  v_utilization numeric(7,2);
  v_prev_risk text;
  v_alert RECORD;
  v_exec RECORD;
  v_notif_type text;
  v_notif_title text;
  v_notif_message text;
  v_alert_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  -- Set engine write marker for this session
  PERFORM set_config('sns.finance_alert_engine_write', 'true', true);

  FOR v_rec IN (
    SELECT 
      b.id as budget_id,
      'project'::text as entity_type,
      b.project_id as entity_id,
      b.project_id,
      NULL::uuid as phase_id,
      NULL::uuid as task_list_id,
      p.name as entity_name
    FROM public.budgets b
    JOIN public.projects p ON p.id = b.project_id
    WHERE b.workspace_id = p_workspace_id AND b.entity_type = 'project'

    UNION

    SELECT 
      b.id as budget_id,
      'phase'::text as entity_type,
      b.phase_id as entity_id,
      b.project_id,
      b.phase_id,
      NULL::uuid as task_list_id,
      ph.name as entity_name
    FROM public.budgets b
    JOIN public.phases ph ON ph.id = b.phase_id
    WHERE b.workspace_id = p_workspace_id AND b.entity_type = 'phase'

    UNION

    SELECT 
      b.id as budget_id,
      'task_list'::text as entity_type,
      b.task_list_id as entity_id,
      b.project_id,
      b.phase_id,
      b.task_list_id,
      tl.name as entity_name
    FROM public.budgets b
    JOIN public.task_lists tl ON tl.id = b.task_list_id
    WHERE b.workspace_id = p_workspace_id AND b.entity_type = 'task_list'

    UNION

    SELECT 
      fa.budget_id,
      fa.entity_type,
      fa.entity_id,
      fa.project_id,
      fa.phase_id,
      fa.task_list_id,
      fa.entity_name
    FROM public.finance_alerts fa
    WHERE fa.workspace_id = p_workspace_id AND fa.lifecycle_status <> 'resolved'
  ) LOOP

    v_summary := private.compute_financial_summary(
      p_workspace_id,
      v_rec.project_id,
      v_rec.phase_id,
      v_rec.task_list_id
    );

    v_curr_risk := COALESCE(v_summary->>'risk_band', 'GREEN');
    v_base := COALESCE((v_summary->>'base_budget')::numeric, 0.00);
    v_buffer := COALESCE((v_summary->>'safety_buffer')::numeric, 0.00);
    v_actual := COALESCE((v_summary->>'actual_spend')::numeric, 0.00);
    v_overrun := COALESCE((v_summary->>'overrun')::numeric, 0.00);
    v_utilization := COALESCE((v_summary->>'utilization_pct')::numeric, 0.00);

    SELECT last_risk_band INTO v_prev_risk
    FROM private.finance_alert_risk_state
    WHERE workspace_id = p_workspace_id
      AND entity_type = v_rec.entity_type
      AND entity_id = v_rec.entity_id;

    SELECT * INTO v_alert
    FROM public.finance_alerts
    WHERE workspace_id = p_workspace_id
      AND entity_type = v_rec.entity_type
      AND entity_id = v_rec.entity_id
      AND lifecycle_status <> 'resolved';

    v_notif_type := NULL;

    IF v_curr_risk IN ('ORANGE', 'RED') THEN
      IF v_alert.id IS NULL THEN
        INSERT INTO public.finance_alerts (
          workspace_id,
          budget_id,
          entity_type,
          entity_id,
          project_id,
          phase_id,
          task_list_id,
          entity_name,
          opened_risk_band,
          current_risk_band,
          base_budget,
          safety_buffer,
          actual_spend,
          overrun,
          utilization_pct,
          lifecycle_status,
          opened_at,
          last_breached_at,
          red_at,
          condition_cleared_at,
          created_at,
          updated_at
        ) VALUES (
          p_workspace_id,
          v_rec.budget_id,
          v_rec.entity_type,
          v_rec.entity_id,
          v_rec.project_id,
          v_rec.phase_id,
          v_rec.task_list_id,
          v_rec.entity_name,
          v_curr_risk,
          v_curr_risk,
          v_base,
          v_buffer,
          v_actual,
          v_overrun,
          v_utilization,
          'open',
          v_now,
          v_now,
          CASE WHEN v_curr_risk = 'RED' THEN v_now ELSE NULL END,
          NULL,
          v_now,
          v_now
        )
        RETURNING id INTO v_alert_id;

        IF v_prev_risk IS NULL OR v_prev_risk IN ('GREEN', 'YELLOW', 'UNBUDGETED') THEN
          IF v_curr_risk = 'ORANGE' THEN
            v_notif_type := 'finance_risk_orange';
            v_notif_title := 'Budget entered ORANGE: ' || v_rec.entity_name;
          ELSIF v_curr_risk = 'RED' THEN
            v_notif_type := 'finance_risk_red';
            v_notif_title := 'Budget entered RED: ' || v_rec.entity_name;
          END IF;
        END IF;

      ELSE
        v_alert_id := v_alert.id;

        UPDATE public.finance_alerts
        SET
          budget_id = v_rec.budget_id,
          entity_name = v_rec.entity_name,
          current_risk_band = v_curr_risk,
          base_budget = v_base,
          safety_buffer = v_buffer,
          actual_spend = v_actual,
          overrun = v_overrun,
          utilization_pct = v_utilization,
          last_breached_at = v_now,
          red_at = COALESCE(v_alert.red_at, CASE WHEN v_curr_risk = 'RED' THEN v_now ELSE NULL END),
          condition_cleared_at = NULL,
          updated_at = v_now
        WHERE id = v_alert.id;

        IF (v_prev_risk = 'ORANGE' AND v_curr_risk = 'RED') THEN
          v_notif_type := 'finance_risk_red';
          v_notif_title := 'Budget entered RED: ' || v_rec.entity_name;
        ELSIF (v_prev_risk IN ('GREEN', 'YELLOW', 'UNBUDGETED') OR v_alert.condition_cleared_at IS NOT NULL) THEN
          IF v_curr_risk = 'ORANGE' THEN
            v_notif_type := 'finance_risk_orange';
            v_notif_title := 'Budget entered ORANGE: ' || v_rec.entity_name;
          ELSIF v_curr_risk = 'RED' THEN
            v_notif_type := 'finance_risk_red';
            v_notif_title := 'Budget entered RED: ' || v_rec.entity_name;
          END IF;
        END IF;
      END IF;

    ELSE
      IF v_alert.id IS NOT NULL THEN
        v_alert_id := v_alert.id;

        UPDATE public.finance_alerts
        SET
          budget_id = v_rec.budget_id,
          entity_name = v_rec.entity_name,
          current_risk_band = v_curr_risk,
          base_budget = v_base,
          safety_buffer = v_buffer,
          actual_spend = v_actual,
          overrun = v_overrun,
          utilization_pct = v_utilization,
          condition_cleared_at = COALESCE(v_alert.condition_cleared_at, v_now),
          updated_at = v_now
        WHERE id = v_alert.id;
      END IF;
    END IF;

    INSERT INTO private.finance_alert_risk_state (
      workspace_id,
      entity_type,
      entity_id,
      budget_id,
      last_risk_band,
      last_actual_spend,
      updated_at
    ) VALUES (
      p_workspace_id,
      v_rec.entity_type,
      v_rec.entity_id,
      v_rec.budget_id,
      v_curr_risk,
      v_actual,
      v_now
    )
    ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
      budget_id = EXCLUDED.budget_id,
      last_risk_band = EXCLUDED.last_risk_band,
      last_actual_spend = EXCLUDED.last_actual_spend,
      updated_at = EXCLUDED.updated_at;

    IF p_emit_notifications AND v_notif_type IS NOT NULL THEN
      v_notif_message := v_rec.entity_type || ' entered ' || v_curr_risk || 
                         ' (Spend: ₹' || to_char(v_actual, 'FM999,999,999.00') || 
                         ', Base: ₹' || to_char(v_base, 'FM999,999,999.00') || 
                         ', Buffer: ₹' || to_char(v_buffer, 'FM999,999,999.00') || ')';

      FOR v_exec IN (
        SELECT usr.user_id
        FROM public.user_system_roles usr
        JOIN public.workspace_members wm ON wm.workspace_id = usr.workspace_id AND wm.user_id = usr.user_id
        WHERE usr.workspace_id = p_workspace_id
          AND usr.role IN ('ceo', 'cto')
          AND wm.status = 'active'
      ) LOOP
        PERFORM private.emit_notification(
          p_workspace_id,
          v_exec.user_id,
          v_notif_type,
          v_notif_title,
          v_notif_message,
          'finance_alert',
          v_alert_id,
          v_rec.project_id,
          NULL
        );
      END LOOP;
    END IF;

  END LOOP;
END;
$$;

-- 6. Guard Trigger Function on public.finance_alerts
CREATE OR REPLACE FUNCTION private.trg_fn_finance_alerts_guard_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_engine_write boolean;
  v_summary jsonb;
  v_current_risk text;
BEGIN
  v_is_engine_write := (current_setting('sns.finance_alert_engine_write', true) = 'true');
  IF v_is_engine_write THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Direct client INSERT on finance_alerts is strictly blocked';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Direct client DELETE on finance_alerts is strictly blocked';
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.budget_id := OLD.budget_id;
    NEW.entity_type := OLD.entity_type;
    NEW.entity_id := OLD.entity_id;
    NEW.project_id := OLD.project_id;
    NEW.phase_id := OLD.phase_id;
    NEW.task_list_id := OLD.task_list_id;
    NEW.entity_name := OLD.entity_name;
    NEW.opened_risk_band := OLD.opened_risk_band;
    NEW.current_risk_band := OLD.current_risk_band;
    NEW.base_budget := OLD.base_budget;
    NEW.safety_buffer := OLD.safety_buffer;
    NEW.actual_spend := OLD.actual_spend;
    NEW.overrun := OLD.overrun;
    NEW.utilization_pct := OLD.utilization_pct;
    NEW.opened_at := OLD.opened_at;
    NEW.last_breached_at := OLD.last_breached_at;
    NEW.red_at := OLD.red_at;
    NEW.condition_cleared_at := OLD.condition_cleared_at;
    NEW.created_at := OLD.created_at;

    IF OLD.lifecycle_status = 'open' AND NEW.lifecycle_status = 'acknowledged' THEN
      IF NOT (private.can_manage_budgets(OLD.workspace_id, (SELECT auth.uid())) OR private.is_finance_operator(OLD.workspace_id, (SELECT auth.uid()))) THEN
        RAISE EXCEPTION 'Not authorized to acknowledge finance alert in workspace %', OLD.workspace_id;
      END IF;

      NEW.acknowledged_by := COALESCE((SELECT auth.uid()), NEW.acknowledged_by);
      NEW.acknowledged_at := clock_timestamp();
      NEW.resolved_by := OLD.resolved_by;
      NEW.resolved_at := OLD.resolved_at;
      NEW.resolution_note := OLD.resolution_note;

    ELSIF OLD.lifecycle_status = 'acknowledged' AND NEW.lifecycle_status = 'resolved' THEN
      IF NOT private.can_manage_budgets(OLD.workspace_id, (SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Not authorized to resolve finance alert in workspace % (Budget Manager authority required)', OLD.workspace_id;
      END IF;

      v_summary := private.compute_financial_summary(OLD.workspace_id, OLD.project_id, OLD.phase_id, OLD.task_list_id);
      v_current_risk := COALESCE(v_summary->>'risk_band', 'GREEN');

      IF v_current_risk IN ('ORANGE', 'RED') THEN
        RAISE EXCEPTION 'Cannot resolve finance alert while current risk is % (must return to GREEN or YELLOW)', v_current_risk;
      END IF;

      NEW.acknowledged_by := OLD.acknowledged_by;
      NEW.acknowledged_at := OLD.acknowledged_at;
      NEW.resolved_by := COALESCE((SELECT auth.uid()), NEW.resolved_by);
      NEW.resolved_at := clock_timestamp();

    ELSIF OLD.lifecycle_status = NEW.lifecycle_status THEN
      NEW.acknowledged_by := OLD.acknowledged_by;
      NEW.acknowledged_at := OLD.acknowledged_at;
      NEW.resolved_by := OLD.resolved_by;
      NEW.resolved_at := OLD.resolved_at;
      NEW.resolution_note := OLD.resolution_note;

    ELSE
      RAISE EXCEPTION 'Invalid finance alert lifecycle transition from % to %', OLD.lifecycle_status, NEW.lifecycle_status;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_alerts_guard_mutation ON public.finance_alerts;
CREATE TRIGGER trg_finance_alerts_guard_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_alerts
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_finance_alerts_guard_mutation();

-- 7. Public Mutation RPCs (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.acknowledge_finance_alert(
  p_alert_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_alert public.finance_alerts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to acknowledge finance alert';
  END IF;

  SELECT * INTO v_alert
  FROM public.finance_alerts
  WHERE id = p_alert_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finance alert not found: %', p_alert_id;
  END IF;

  IF NOT (private.can_manage_budgets(v_alert.workspace_id, auth.uid()) OR private.is_finance_operator(v_alert.workspace_id, auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized to acknowledge finance alert';
  END IF;

  IF v_alert.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Cannot acknowledge alert with status % (must be open)', v_alert.lifecycle_status;
  END IF;

  UPDATE public.finance_alerts
  SET
    lifecycle_status = 'acknowledged',
    acknowledged_by = auth.uid(),
    acknowledged_at = clock_timestamp()
  WHERE id = p_alert_id
  RETURNING * INTO v_alert;

  RETURN jsonb_build_object(
    'id', v_alert.id,
    'workspace_id', v_alert.workspace_id,
    'lifecycle_status', v_alert.lifecycle_status,
    'acknowledged_by', v_alert.acknowledged_by,
    'acknowledged_at', v_alert.acknowledged_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_finance_alert(
  p_alert_id uuid,
  p_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_alert public.finance_alerts;
  v_summary jsonb;
  v_current_risk text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to resolve finance alert';
  END IF;

  SELECT * INTO v_alert
  FROM public.finance_alerts
  WHERE id = p_alert_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finance alert not found: %', p_alert_id;
  END IF;

  IF NOT private.can_manage_budgets(v_alert.workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to resolve finance alert (Budget Manager authority required)';
  END IF;

  IF v_alert.lifecycle_status <> 'acknowledged' THEN
    RAISE EXCEPTION 'Cannot resolve alert with status % (must be acknowledged first)', v_alert.lifecycle_status;
  END IF;

  v_summary := private.compute_financial_summary(v_alert.workspace_id, v_alert.project_id, v_alert.phase_id, v_alert.task_list_id);
  v_current_risk := COALESCE(v_summary->>'risk_band', 'GREEN');

  IF v_current_risk IN ('ORANGE', 'RED') THEN
    RAISE EXCEPTION 'Cannot resolve finance alert while current risk is % (must return to GREEN or YELLOW)', v_current_risk;
  END IF;

  UPDATE public.finance_alerts
  SET
    lifecycle_status = 'resolved',
    resolved_by = auth.uid(),
    resolved_at = clock_timestamp(),
    resolution_note = p_resolution_note
  WHERE id = p_alert_id
  RETURNING * INTO v_alert;

  RETURN jsonb_build_object(
    'id', v_alert.id,
    'workspace_id', v_alert.workspace_id,
    'lifecycle_status', v_alert.lifecycle_status,
    'resolved_by', v_alert.resolved_by,
    'resolved_at', v_alert.resolved_at,
    'resolution_note', v_alert.resolution_note
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_finance_alert(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_finance_alert(uuid) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_finance_alert(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_finance_alert(uuid, text) FROM anon, PUBLIC;

-- 8. Deferred Constraint Triggers on Source Tables
CREATE OR REPLACE FUNCTION private.trg_fn_finance_alerts_reconcile_budgets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.workspace_id IS NOT NULL THEN
      PERFORM private.reconcile_finance_alerts_for_workspace(OLD.workspace_id, true);
    END IF;
  ELSE
    IF NEW.workspace_id IS NOT NULL THEN
      PERFORM private.reconcile_finance_alerts_for_workspace(NEW.workspace_id, true);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id AND OLD.workspace_id IS NOT NULL THEN
      PERFORM private.reconcile_finance_alerts_for_workspace(OLD.workspace_id, true);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_budgets_finance_alerts_reconcile ON public.budgets;
CREATE CONSTRAINT TRIGGER trg_budgets_finance_alerts_reconcile
AFTER INSERT OR UPDATE OR DELETE ON public.budgets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_finance_alerts_reconcile_budgets();

CREATE OR REPLACE FUNCTION private.trg_fn_finance_alerts_reconcile_expense_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.workspace_id IS NOT NULL THEN
      PERFORM private.reconcile_finance_alerts_for_workspace(OLD.workspace_id, true);
    END IF;
  ELSE
    IF NEW.workspace_id IS NOT NULL THEN
      PERFORM private.reconcile_finance_alerts_for_workspace(NEW.workspace_id, true);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id AND OLD.workspace_id IS NOT NULL THEN
      PERFORM private.reconcile_finance_alerts_for_workspace(OLD.workspace_id, true);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_transactions_finance_alerts_reconcile ON public.expense_transactions;
CREATE CONSTRAINT TRIGGER trg_expense_transactions_finance_alerts_reconcile
AFTER INSERT OR UPDATE OR DELETE ON public.expense_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_finance_alerts_reconcile_expense_transactions();

CREATE OR REPLACE FUNCTION private.trg_fn_finance_alerts_reconcile_expense_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT workspace_id INTO v_ws_id FROM public.expense_transactions WHERE id = OLD.transaction_id;
  ELSE
    SELECT workspace_id INTO v_ws_id FROM public.expense_transactions WHERE id = NEW.transaction_id;
  END IF;

  IF v_ws_id IS NOT NULL THEN
    PERFORM private.reconcile_finance_alerts_for_workspace(v_ws_id, true);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_items_finance_alerts_reconcile ON public.expense_items;
CREATE CONSTRAINT TRIGGER trg_expense_items_finance_alerts_reconcile
AFTER INSERT OR UPDATE OR DELETE ON public.expense_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_finance_alerts_reconcile_expense_items();

CREATE OR REPLACE FUNCTION private.trg_fn_finance_alerts_reconcile_tasks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_ws uuid;
  v_new_ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.project_id IS NOT NULL THEN
      SELECT workspace_id INTO v_old_ws FROM public.projects WHERE id = OLD.project_id;
    ELSIF OLD.process_instance_id IS NOT NULL THEN
      SELECT workspace_id INTO v_old_ws FROM public.process_instances WHERE id = OLD.process_instance_id;
    END IF;

    IF v_old_ws IS NOT NULL THEN
      PERFORM private.reconcile_finance_alerts_for_workspace(v_old_ws, true);
    END IF;
  ELSE
    IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.phase_id IS DISTINCT FROM NEW.phase_id OR OLD.task_list_id IS DISTINCT FROM NEW.task_list_id THEN
      IF OLD.project_id IS NOT NULL THEN
        SELECT workspace_id INTO v_old_ws FROM public.projects WHERE id = OLD.project_id;
      ELSIF OLD.process_instance_id IS NOT NULL THEN
        SELECT workspace_id INTO v_old_ws FROM public.process_instances WHERE id = OLD.process_instance_id;
      END IF;

      IF NEW.project_id IS NOT NULL THEN
        SELECT workspace_id INTO v_new_ws FROM public.projects WHERE id = NEW.project_id;
      ELSIF NEW.process_instance_id IS NOT NULL THEN
        SELECT workspace_id INTO v_new_ws FROM public.process_instances WHERE id = NEW.process_instance_id;
      END IF;

      IF v_old_ws IS NOT NULL THEN
        PERFORM private.reconcile_finance_alerts_for_workspace(v_old_ws, true);
      END IF;
      IF v_new_ws IS NOT NULL AND v_new_ws IS DISTINCT FROM v_old_ws THEN
        PERFORM private.reconcile_finance_alerts_for_workspace(v_new_ws, true);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_finance_alerts_reconcile ON public.tasks;
CREATE CONSTRAINT TRIGGER trg_tasks_finance_alerts_reconcile
AFTER UPDATE OR DELETE ON public.tasks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_fn_finance_alerts_reconcile_tasks();

-- 9. Realtime Publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'finance_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_alerts;
  END IF;
END $$;

-- 10. Bootstrap existing high-risk conditions without notifications
DO $$
DECLARE
  ws RECORD;
BEGIN
  FOR ws IN SELECT id FROM public.workspaces LOOP
    PERFORM private.reconcile_finance_alerts_for_workspace(ws.id, false);
  END LOOP;
END $$;
