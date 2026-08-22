-- ============================================================================
-- Migration: 20260822152000_p6_05r1_finance_alert_runtime_security_closure.sql
-- Package: Package 6 — Finance Frontend (P6-05R1 Hotfix)
-- Scope: Finance Alert Runtime Security & Re-Breach Notification Closure
-- 
-- 1. Explicitly revoke execution on all private P6-05 trigger/engine functions
--    from PUBLIC, anon, and authenticated roles.
-- 2. Establish dedicated Finance risk notification tracking with persistent
--    transition identities (private.finance_alert_notification_events) and
--    dedicated emission helper (private.emit_finance_risk_notification).
-- 3. Resolve re-breach notification deduplication so genuine rapid threshold
--    re-entries emit exactly one notification per active CEO/CTO without
--    affecting generic notification deduplication.
-- ============================================================================

BEGIN;

-- 1. Add transition_sequence column to public.finance_alerts
ALTER TABLE public.finance_alerts
  ADD COLUMN IF NOT EXISTS transition_sequence integer NOT NULL DEFAULT 1;

-- 2. Create private.finance_alert_notification_events
CREATE TABLE IF NOT EXISTS private.finance_alert_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.finance_alerts(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  transition_key text NOT NULL,
  notification_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_finance_alert_notification_event UNIQUE (alert_id, recipient_user_id, transition_key)
);

REVOKE ALL PRIVILEGES ON TABLE private.finance_alert_notification_events FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE private.finance_alert_notification_events TO postgres, service_role;

-- 3. Create dedicated private.emit_finance_risk_notification
CREATE OR REPLACE FUNCTION private.emit_finance_risk_notification(
  p_workspace_id uuid,
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_alert_id uuid,
  p_project_id uuid,
  p_transition_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted boolean := false;
BEGIN
  -- Insert into private tracking table with unique constraint on (alert_id, recipient_user_id, transition_key)
  INSERT INTO private.finance_alert_notification_events (
    alert_id,
    recipient_user_id,
    transition_key,
    notification_type,
    created_at
  ) VALUES (
    p_alert_id,
    p_user_id,
    p_transition_key,
    p_type,
    clock_timestamp()
  )
  ON CONFLICT (alert_id, recipient_user_id, transition_key) DO NOTHING
  RETURNING true INTO v_inserted;

  -- Only write to public.notifications if this transition event was newly recorded
  IF v_inserted IS TRUE THEN
    INSERT INTO public.notifications (
      workspace_id,
      user_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      project_id,
      task_id,
      is_read,
      created_at
    ) VALUES (
      p_workspace_id,
      p_user_id,
      p_type,
      p_title,
      p_message,
      'finance_alert',
      p_alert_id,
      p_project_id,
      NULL,
      false,
      clock_timestamp()
    );
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.emit_finance_risk_notification(uuid, uuid, text, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.emit_finance_risk_notification(uuid, uuid, text, text, text, uuid, uuid, text) TO postgres, service_role;

-- 4. Update private.reconcile_finance_alerts_for_workspace
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
  v_rec record;
  v_summary jsonb;
  v_curr_risk text;
  v_prev_risk text;
  v_base numeric(15,2);
  v_buffer numeric(15,2);
  v_actual numeric(15,2);
  v_overrun numeric(15,2);
  v_utilization numeric(7,2);
  v_alert public.finance_alerts%ROWTYPE;
  v_alert_id uuid;
  v_trans_seq integer;
  v_transition_key text;
  v_notif_type text;
  v_notif_title text;
  v_notif_message text;
  v_exec record;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- Mark engine write context locally for this transaction
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
    v_transition_key := NULL;

    IF v_curr_risk IN ('ORANGE', 'RED') THEN
      IF v_alert.id IS NULL THEN
        -- Brand new unresolved alert incident
        v_trans_seq := 1;

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
          transition_sequence,
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
          v_trans_seq,
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
          v_transition_key := v_alert_id::text || ':' || v_curr_risk || ':seq_' || v_trans_seq::text;
        END IF;

      ELSE
        -- Existing unresolved alert incident
        v_alert_id := v_alert.id;
        v_trans_seq := COALESCE(v_alert.transition_sequence, 1);

        IF (v_prev_risk = 'ORANGE' AND v_curr_risk = 'RED') OR (v_alert.current_risk_band = 'ORANGE' AND v_curr_risk = 'RED') THEN
          -- Escalation from ORANGE to RED
          v_trans_seq := v_trans_seq + 1;
          v_notif_type := 'finance_risk_red';
          v_notif_title := 'Budget entered RED: ' || v_rec.entity_name;
          v_transition_key := v_alert_id::text || ':RED:seq_' || v_trans_seq::text;

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
            transition_sequence = v_trans_seq,
            last_breached_at = v_now,
            red_at = COALESCE(v_alert.red_at, v_now),
            condition_cleared_at = NULL,
            updated_at = v_now
          WHERE id = v_alert.id;

        ELSIF (v_prev_risk IN ('GREEN', 'YELLOW', 'UNBUDGETED') OR v_alert.condition_cleared_at IS NOT NULL) THEN
          -- Genuine re-breach after temporary recovery
          v_trans_seq := v_trans_seq + 1;
          IF v_curr_risk = 'ORANGE' THEN
            v_notif_type := 'finance_risk_orange';
            v_notif_title := 'Budget entered ORANGE: ' || v_rec.entity_name;
          ELSIF v_curr_risk = 'RED' THEN
            v_notif_type := 'finance_risk_red';
            v_notif_title := 'Budget entered RED: ' || v_rec.entity_name;
          END IF;
          v_transition_key := v_alert_id::text || ':' || v_curr_risk || ':seq_' || v_trans_seq::text;

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
            transition_sequence = v_trans_seq,
            last_breached_at = v_now,
            red_at = COALESCE(v_alert.red_at, CASE WHEN v_curr_risk = 'RED' THEN v_now ELSE NULL END),
            condition_cleared_at = NULL,
            updated_at = v_now
          WHERE id = v_alert.id;

        ELSE
          -- Same band or downward shift RED -> ORANGE (no notification)
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
            updated_at = v_now
          WHERE id = v_alert.id;
        END IF;
      END IF;

    ELSE
      -- Risk is GREEN, YELLOW, or UNBUDGETED
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

    -- Update private tracked state
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

    -- Emit notifications if requested and transition event is present
    IF p_emit_notifications AND v_notif_type IS NOT NULL AND v_transition_key IS NOT NULL THEN
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
        PERFORM private.emit_finance_risk_notification(
          p_workspace_id,
          v_exec.user_id,
          v_notif_type,
          v_notif_title,
          v_notif_message,
          v_alert_id,
          v_rec.project_id,
          v_transition_key
        );
      END LOOP;
    END IF;

  END LOOP;
END;
$$;

-- 5. Update Guard Trigger Function on public.finance_alerts to preserve transition_sequence
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
    NEW.transition_sequence := OLD.transition_sequence;
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

-- 6. Explicitly Revoke Execution on ALL P6-05 Private Functions
REVOKE ALL ON FUNCTION private.reconcile_finance_alerts_for_workspace(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_finance_alerts_guard_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_finance_alerts_reconcile_budgets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_finance_alerts_reconcile_expense_transactions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_finance_alerts_reconcile_expense_items() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_fn_finance_alerts_reconcile_tasks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.emit_finance_risk_notification(uuid, uuid, text, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Grant execution strictly to internal administrative / engine roles
GRANT EXECUTE ON FUNCTION private.reconcile_finance_alerts_for_workspace(uuid, boolean) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.trg_fn_finance_alerts_guard_mutation() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.trg_fn_finance_alerts_reconcile_budgets() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.trg_fn_finance_alerts_reconcile_expense_transactions() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.trg_fn_finance_alerts_reconcile_expense_items() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.trg_fn_finance_alerts_reconcile_tasks() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.emit_finance_risk_notification(uuid, uuid, text, text, text, uuid, uuid, text) TO postgres, service_role;

COMMIT;
