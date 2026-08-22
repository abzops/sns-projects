# P6-05 — Finance Alert Runtime & Persistent Alert Backend

**Package**: Package 6 — Finance Frontend  
**Status**: `VERIFIED / FROZEN` (P6-05)  
**Database Migration Tip**: `20260822144843_p6_05_finance_alert_runtime`  
**Security Advisor Baseline**: Exactly 6 accepted warnings (5 Process SECURITY DEFINER + 1 leaked password protection)  
**Public SECURITY DEFINER Count**: Exactly 7 functions (0 new added by P6-05)  
**Authoritative Backend Contracts**:
- `public.finance_alerts` (persistent incident ledger with RLS & partial unique index `uq_finance_alerts_unresolved`)
- `private.finance_alert_risk_state` (internal tracked risk state, strictly zero browser access)
- `private.reconcile_finance_alerts_for_workspace` (private SECURITY DEFINER reconciliation engine)
- `public.acknowledge_finance_alert(p_alert_id uuid)` (SECURITY INVOKER RPC, `search_path = ''`)
- `public.resolve_finance_alert(p_alert_id uuid, p_resolution_note text)` (SECURITY INVOKER RPC, `search_path = ''`)
- Realtime publication: `public.finance_alerts` in `supabase_realtime`
- Notification types: `finance_risk_orange` and `finance_risk_red` in `notifications_type_check`

---

## 1. Executive Summary

P6-05 establishes the authoritative **Finance Alert Runtime & Persistent Alert Backend** for Stack n Stock Projects. The alert engine monitors budget consumption and risk band thresholds across Project, Phase, and Task List entities using the canonical calculation engine `private.compute_financial_summary`.

### Scope & Certified Invariants:
1. **Governing Risk Bands**: GREEN (< 80%), YELLOW (80%–100%), ORANGE (> 100% and <= 100% + buffer), RED (> 100% + buffer, or > 100% when buffer is 0.00).
2. **Notification Exclusivity (Decision 54)**: Automated high-priority notifications are sent to active **CEO** and **CTO** personas ONLY when budget crosses into **ORANGE** or **RED**. YELLOW band transitions NEVER notify executives.
3. **Incident Model (Decision 54)**: At most ONE unresolved alert incident exists per `(workspace_id, entity_type, entity_id)` enforced via partial unique index `WHERE lifecycle_status <> 'resolved'`.
4. **Alert Lifecycle (Decision 66)**: `open` -> `acknowledged` -> `resolved`. Direct transition from `open` to `resolved` is strictly rejected (`must be acknowledged first`). `resolved` status is terminal and immutable.
5. **Role Separation (Decisions 56 & 66)**:
   - **Finance Operator**: Can SELECT alerts and mutate `open` -> `acknowledged`. Strictly DENIED `resolve` authority.
   - **Budget Managers (`can_manage_budgets`)**: Active Workspace Owner, Admin, CEO, CTO can acknowledge AND resolve alerts.
6. **Condition Recovery & Re-breach**:
   - Risk drop to GREEN/YELLOW does NOT auto-resolve. Sets `condition_cleared_at = now()`.
   - Re-breach before resolution clears `condition_cleared_at`, updates metrics, and sends fresh executive notifications.
   - Resolution requires that current canonical risk has dropped to GREEN or YELLOW (resolution while ORANGE or RED is strictly rejected).
7. **Zero Public Definers**: Mutation RPCs (`acknowledge_finance_alert`, `resolve_finance_alert`) are `SECURITY INVOKER` with `SET search_path = ''`.
8. **Deferred Reconciliation**: Deferred constraint triggers on `budgets`, `expense_transactions`, `expense_items`, and `tasks` reconcile finance alerts atomically at transaction commit.

---

## 2. Security & Access Control Matrix

| Persona / Role | View Alerts (`SELECT`) | Acknowledge Alert | Resolve Alert | High-Risk Notifications |
| :--- | :---: | :---: | :---: | :---: |
| **Workspace Owner (Active)** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ (Unless CEO/CTO) |
| **Workspace Admin (Active)** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ (Unless CEO/CTO) |
| **CEO (Active Workspace Tenancy)** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Received (`finance_risk_*`) |
| **CTO (Active Workspace Tenancy)** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Received (`finance_risk_*`) |
| **Finance Operator (Active Tenancy)** | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| **Member / Viewer** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |
| **Project Admin / System Admin Alone** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |
| **Anonymous (`anon`)** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |

---

## 3. Database Architecture

### 3.1 `public.finance_alerts`
```sql
CREATE TABLE public.finance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  budget_id uuid REFERENCES public.budgets(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('project', 'phase', 'task_list')),
  entity_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  phase_id uuid REFERENCES public.phases(id) ON DELETE CASCADE,
  task_list_id uuid REFERENCES public.task_lists(id) ON DELETE CASCADE,
  entity_name text NOT NULL,
  opened_risk_band text NOT NULL CHECK (opened_risk_band IN ('ORANGE', 'RED')),
  current_risk_band text NOT NULL CHECK (current_risk_band IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
  base_budget numeric(15,2) NOT NULL DEFAULT 0.00,
  safety_buffer numeric(15,2) NOT NULL DEFAULT 0.00,
  actual_spend numeric(15,2) NOT NULL DEFAULT 0.00,
  overrun numeric(15,2) NOT NULL DEFAULT 0.00,
  utilization_pct numeric(7,2) NOT NULL DEFAULT 0.00,
  lifecycle_status text NOT NULL DEFAULT 'open' CHECK (lifecycle_status IN ('open', 'acknowledged', 'resolved')),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_breached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  red_at timestamptz,
  condition_cleared_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Partial Unique Index (Exactly one active unresolved alert per entity)
CREATE UNIQUE INDEX uq_finance_alerts_unresolved
  ON public.finance_alerts (workspace_id, entity_type, entity_id)
  WHERE (lifecycle_status <> 'resolved');
```

### 3.2 `private.finance_alert_risk_state`
Private table used by the alert engine to track transitions and suppress redundant notifications for same-band updates.
```sql
CREATE TABLE private.finance_alert_risk_state (
  workspace_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  budget_id uuid,
  last_risk_band text NOT NULL,
  last_actual_spend numeric(15,2) NOT NULL DEFAULT 0.00,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, entity_type, entity_id)
);
```

### 3.3 Public Mutation RPCs
```sql
-- Acknowledge Alert (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.acknowledge_finance_alert(
  p_alert_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$ ... $$;

-- Resolve Alert (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.resolve_finance_alert(
  p_alert_id uuid,
  p_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$ ... $$;
```

---

## 4. Verification & Test Suite

The verification suite `scripts/test-p6-05-finance-alert-runtime.mjs` executes 35 automated integration assertions across 3 comprehensive suites:
1. **Suite 1: Production Deployment & Bootstrap State** (Assertions 1–9)
2. **Suite 2: Isolated Integration Fixtures & Risk Transitions** (Assertions 10–18)
3. **Suite 3: Lifecycle Mutation & Permissions Matrix** (Assertions 19–35)

```bash
node scripts/test-p6-05-finance-alert-runtime.mjs
```

Result: `ALL 35 P6-05 FINANCE ALERT RUNTIME ASSERTIONS PASSED!`
