# P4-01 / P4-01A / P4-01B: Finance Database Foundation & Active-Tenancy Closure

**Package**: Package 04 — Finance Foundation  
**Status**: `P4-01 / P4-01A / P4-01B VERIFIED`  
**Deployment Migration Tip**: `20260820174313_p4_01b_finance_active_tenancy_authorization_closure.sql`  
**Base Foundation Migration**: `20260819101557_p4_01_finance_database_foundation.sql`  
**Remote Project**: `gqerfixdmgbqahgslzsq`  
**Certification Date**: 2026-08-20  

---

## 1. Overview

P4-01 delivers the canonical Finance database foundation for SNS Projects without altering or destabilizing Operational V1. P4-01A adds critical integrity closures for Phase $\to$ Task List budget reduction invariants and hardened audit actor resolution. P4-01B closes the active-tenancy authorization model by removing historical workspace creator shortcuts from `private.can_manage_budgets`.

---

## 2. Architecture & Schema Components

### 2.1 Core Tables

1. **`public.budgets`**:
   - Budget-owning entities: `project`, `phase`, `task_list`.
   - Strict container constraints: `base_budget >= 0`, `safety_buffer >= 0`.
   - Identity columns (`workspace_id`, `entity_type`, `project_id`, `phase_id`, `task_list_id`, `created_by`, `created_at`) are immutable on `UPDATE`.
   - Structural trigger `private.trg_fn_validate_budget_hierarchy` enforces:
     - Project has no parent budget container.
     - Phase base budget cannot exceed parent Project base budget.
     - Task List base budget cannot exceed immediate Phase base budget.
     - Task List positive base budget requires positive immediate Phase base budget.
     - **P4-01A Invariant**: Phase base budget cannot be reduced below the sum of existing child Task List base budgets (including reductions to 0).
     - Safety buffer is non-allocatable to child containers.
   - Deletion protection: `ON DELETE RESTRICT` from projects, phases, and task lists.

2. **`public.budget_audit_logs`**:
   - Immutable audit trail capturing every budget creation, update, and deletion.
   - Automatically populated by trigger `private.trg_fn_audit_budget_mutation()`.
   - **P4-01A Actor Hardening**: Authenticated caller identity is unconditionally forced to `auth.uid()`; caller-supplied `created_by` / `updated_by` spoof attempts are overridden.
   - Unauthenticated execution is restricted to trusted internal server sessions (`current_user IN ('postgres', 'service_role', 'supabase_admin')`, `replica` mode, or `app.trusted_internal_execution = 'on'`).

3. **`public.budget_reallocations`**:
   - Records peer-to-peer budget reallocations strictly between sibling entities of the exact same entity type within the same workspace/project/phase.
   - Validated by `private.trg_fn_validate_budget_reallocation()`.
   - Reallocation actor is derived from `auth.uid()`.

4. **`public.expense_transactions`**:
   - High-level expense transaction envelope attached strictly to leaf operational `tasks` (`task_id`).
   - Auto-derives workspace tenancy from task project or process instance.
   - Direct browser DML (`INSERT`, `UPDATE`, `DELETE`) is fail-closed / revoked in P4-01.

5. **`public.expense_items`**:
   - Granular itemized expense lines supporting both single-total and split line-item entries.
   - Auto-rolled up to task lists, phases, projects, and workspace totals.

6. **`public.expense_audit_logs`**:
   - Captures transactional audit events with mandatory non-empty reason strings.

---

## 3. Financial Risk Engine

Deterministic risk band evaluation implemented in `public.calculate_financial_risk_band(actual_spend, base_budget, safety_buffer)`:
- GREEN: `actual_spend < 0.80 * base_budget`
- YELLOW: `0.80 * base_budget <= actual_spend <= base_budget`
- ORANGE: `base_budget < actual_spend <= base_budget + safety_buffer` (when `safety_buffer > 0`)
- RED: `actual_spend > base_budget + safety_buffer` (or `> base_budget` when `safety_buffer = 0`)

- Unbudgeted work rolls upward to the nearest budget-owning ancestor.
- Overruns do not block operational execution or task workflows.

---

## 4. Authorization & Security Architecture

1. **Management Authority & Active Tenancy (P4-01B Closure)**:
   - Budget management requires **active workspace tenancy** (`private.can_manage_budgets`):
     - Active Workspace Owner or Workspace Admin (`workspace_members.role IN ('owner', 'admin') AND status = 'active'`).
     - Active CEO or Active CTO with active workspace membership (`user_system_roles.role IN ('ceo', 'cto') AND workspace_members.status = 'active'`).
   - **Historical Creator Elimination**: Historical workspace creation (`workspaces.created_by`) grants **ZERO** Finance authority. Creators who are not active Owners/Admins/CEOs/CTOs cannot insert, update, delete, or reallocate budgets.
   - Project Admin, System Admin, Project Owner, Phase Owner, Task Owner, RACI roles, and Finance Operators alone are strictly denied budget mutation.

2. **Finance Operator Role Separation**:
   - `private.is_finance_operator(p_workspace_id)` checks active membership in the Finance department (`FIN`).
   - **CAN**: View workspace financial summaries, inspect expenses, view audit logs, correct expenses, void expenses.
   - **CANNOT**: Set Base Budgets, modify Safety Buffers, reallocate budgets, or hard-delete voided expenses.

3. **Read Scope & Anti-Leak Rules**:
   - Workspace Owner, Admin, CEO, CTO, and Finance Operator (`FIN` department) receive workspace-wide financial visibility.
   - Project Owner receives financial visibility for their owned project and descendant phases/lists.
   - Phase Owner receives financial visibility for their owned phase and descendant lists.
   - General Members and Viewers cannot view container aggregate summaries without ownership, avoiding sibling container leaks.
   - Viewers can view exact expense values only on operational tasks they are authorized to view (Decision 58).

4. **Security Advisor Compliance**:
   - Zero `SECURITY DEFINER` functions introduced in the `public` schema.
   - All private helpers placed in `private` schema with `SET search_path = ''`.
   - Explicit `REVOKE ALL FROM PUBLIC, anon` and restricted `GRANT EXECUTE TO authenticated`.
   - All 6 new Finance tables have Row Level Security enabled.

---

## 5. Verification & Test Suite

The test suite `scripts/test-p4-01-finance-foundation.mjs` executes 74 numbered behavioral assertions inside an isolated transaction:
- **Hierarchy & Allocation Rules**: Tests 1–13 (Project, Phase, Task List configurations, allocation ceilings, non-allocatable buffers, Phase reduction constraints 12a/12b/12c, unbudgeted rollups).
- **Risk Engine Boundaries**: Tests 14–20 (Exact GREEN, YELLOW, ORANGE, RED thresholds).
- **Expense Aggregations**: Tests 21–30 (Single totals, split items, leaf rollups, task movement reattribution, standalone vs project spend).
- **Role-Based Authority & Visibility**: Tests 31–41 (Owner/Admin/CEO/CTO mutation rights, Project Admin/System Admin/Finance Operator mutation blocks, scoped summaries, anti-leak checks, Decision 58 Viewer reads).
- **Fail-Closed DML & Integrity Protection**: Tests 42–54 (Blocked direct expense DML, `ON DELETE RESTRICT` operational protection, entity immutability, anti-spoofing overrides 49a/49b/49c, mandatory audit reasons, sibling reallocation restrictions, Security Advisor zero-definer check, RLS table enablement).
- **P4-01B Active-Tenancy Matrix & Creator Elimination**: Tests 55–60:
  - Approved authorities (Owner, Admin, CEO, CTO with active membership) pass `can_manage_budgets` (55).
  - Non-budget roles (Finance Operator, Project Admin, System Admin, Project/Phase Owner, Viewer) fail `can_manage_budgets` (56).
  - Historical creator matrix: Creator+Owner = true (57a), Creator+Admin = true (57b), Creator+Member = FALSE (57c), Creator+Viewer = FALSE (57d), Creator+Non-Active = FALSE (57e), Creator+No-Membership = FALSE (57f).
  - CEO/CTO active tenancy requirement (58).
  - Data access & RLS enforcement on plain member creator: INSERT blocked by RLS (59a), UPDATE blocked (59b), DELETE blocked (59c), Reallocate blocked (59d).
  - Finance Operator legitimate summary and audit visibility preserved (60).
