# P4-01: Finance Database Foundation

**Package**: Package 04 — Finance Foundation  
**Status**: Implemented & Certified  
**Deployment Migration Tip**: `20260819101557_p4_01_finance_database_foundation.sql`  
**Remote Project**: `gqerfixdmgbqahgslzsq`  
**Certification Date**: 2026-08-19  

---

## 1. Overview

P4-01 delivers the canonical Finance database foundation for SNS Projects without altering or destabilizing Operational V1. It introduces the immutable budget ledger, expense ledger, deterministic financial risk engine, and authorization helpers.

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
     - Safety buffer is non-allocatable to child containers.
   - Deletion protection: `ON DELETE RESTRICT` from projects, phases, and task lists.

2. **`public.budget_audit_logs`**:
   - Immutable audit trail capturing every budget creation, update, and deletion.
   - Automatically populated by trigger `private.trg_fn_audit_budget_mutation()`.
   - Records `actor_id = COALESCE(auth.uid(), NEW.created_by / NEW.updated_by / NEW.actor_id)`.

3. **`public.budget_reallocations`**:
   - Records peer-to-peer budget reallocations strictly between sibling entities of the exact same entity type within the same workspace/project/phase.
   - Validated by `private.trg_fn_validate_budget_reallocation()`.

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

1. **Management Authority**:
   - Budget mutations permitted strictly to Workspace Owner, Workspace Admin, CEO, and CTO (`private.can_manage_budgets`).
   - Project Admin, System Admin, and Finance Operators alone are denied budget mutation.

2. **Read Scope & Anti-Leak Rules**:
   - Workspace Owner, Admin, CEO, CTO, and Finance Operator (`FIN` department) receive workspace-wide financial visibility.
   - Project Owner receives financial visibility for their owned project and descendant phases/lists.
   - Phase Owner receives financial visibility for their owned phase and descendant lists.
   - General Members and Viewers cannot view container aggregate summaries without ownership, avoiding sibling container leaks.
   - Viewers can view exact expense values only on operational tasks they are authorized to view (Decision 58).

3. **Security Advisor Compliance**:
   - Zero `SECURITY DEFINER` functions introduced in the `public` schema.
   - All private helpers placed in `private` schema with `SET search_path = ''`.
   - Explicit `REVOKE ALL FROM PUBLIC, anon` and restricted `GRANT EXECUTE TO authenticated`.
   - All 6 new Finance tables have Row Level Security enabled.

---

## 5. Verification & Test Suite

The comprehensive regression test suite `scripts/test-p4-01-finance-foundation.mjs` executes 55 real SQL assertions inside an isolated transaction:
- Budget hierarchy and allocation rules (Projects, Phases, Task Lists).
- Fixed Safety Buffer calculations and non-allocatability.
- Boundary risk calculations (GREEN, YELLOW, ORANGE, RED).
- Expense itemization and upward aggregations (Project Spend + Standalone Spend = Total Company Spend).
- Dynamic task movement and spend reattribution.
- Role-based mutation and scoped read visibility.
- Fail-closed direct expense DML protections.
- Foreign key deletion restriction (`ON DELETE RESTRICT`).
- Immutability of budget entity identity and audit trigger generation.
