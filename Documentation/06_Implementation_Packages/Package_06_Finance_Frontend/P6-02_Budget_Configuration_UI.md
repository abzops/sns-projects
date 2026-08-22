# Package 6 — P6-02: Central Budget Configuration UI Specification & Verification

## 1. Executive Summary

**P6-02** delivers the centralized **Budget Management & Configuration UI** for SNS Projects at route `/workspace/:workspaceId/finance/budgets`.

It allows authorized workspace leadership to configure, revise, and structure hierarchical Base Budgets and Safety Buffers across Projects, Phases, and Task Lists while preserving 100% database trigger authority, immutable audit logging, and fail-closed role separation.

---

## 2. Core Capabilities & Architectural Invariants

### 2.1 Authorized Budget Management Matrix (Fail-Closed)

Budget Configuration authority (`canManageBudgets = true`) is granted strictly to:
- **Active Workspace Owner**
- **Active Workspace Admin**
- **Active CEO** (with active workspace tenancy)
- **Active CTO** (with active workspace tenancy)

Explicitly **DENIED** budget management authority:
- **Finance Operator** (`FIN` department members have read/overview and expense correction authority only)
- **Project Admin only**
- **System Admin only**
- **Project Owner / Phase Owner** (without workspace owner/admin role)
- **General Member**
- **Viewer**
- **CEO / CTO without active workspace tenancy**

Direct URL access to `/workspace/:workspaceId/finance/budgets` by unauthorized users renders a fail-closed access restricted view.

### 2.2 Strict Feature Boundaries (Zero Scope Creep)
- **Included**:
  - Project budget creation and updates (Base Budget & Safety Buffer)
  - Phase budget creation and updates (Base Budget & Safety Buffer)
  - Task List budget creation and updates (Base Budget & Safety Buffer)
  - Remaining parent allocation capacity visualization
  - Real-time refresh of Finance summaries and cache invalidation
- **Strictly Excluded**:
  - NO Budget Deletion UI (preserves financial history and referential integrity)
  - NO Budget Reallocation UI (reallocation workflow deferred to dedicated package)
  - NO Direct authenticated DML bypass (all mutations governed by PostgreSQL RLS and trigger hierarchy)
  - NO Expense administration in budget modal

### 2.3 Hierarchical Invariant & Capacity Integrity

All budget constraints are enforced directly by PostgreSQL triggers (`trg_budgets_validate_hierarchy`):
1. **Hierarchy Requirement**:
   - Project: May configure Base Budget $\ge 0$ and Safety Buffer $\ge 0$.
   - Phase: Requires parent Project to have a configured Base Budget.
   - Task List: Requires parent Phase to have a configured Base Budget.
2. **Allocation Capacity**:
   - Total child Phase Base Budgets cannot exceed parent Project Base Budget.
   - Total child Task List Base Budgets cannot exceed parent Phase Base Budget.
   - Safety Buffer is a contingency reserve and **never** expands allocatable capacity to child entities.
3. **Budget Revisions**:
   - Reducing Base Budget below existing child allocations is strictly rejected by the database.
   - Authorized managers may revise Base Budget below Actual Spend if child allocations permit (updates risk band to ORANGE/RED without halting operational workflows).

### 2.4 Immutable Audit Logging
Every `INSERT` and `UPDATE` on `public.budgets` triggers an automatic immutable entry in `public.budget_audit_logs` capturing:
- `budget_id`
- `actor_id` (verified against `auth.uid()`)
- `action` (`created` / `updated`)
- `previous_base_budget` & `previous_safety_buffer`
- `new_base_budget` & `new_safety_buffer`
- `created_at` timestamp

---

## 3. Implementation Components

1. **Route & Layout**:
   - Mounted in [App.jsx](../../../src/App.jsx): `/workspace/:workspaceId/finance/budgets`
   - Entry link added in [FinanceOverviewPage.jsx](../../../src/pages/FinanceOverviewPage.jsx) header actions (visible only when `canManageBudgets = true`).
2. **Page & State**:
   - [BudgetManagementPage.jsx](../../../src/pages/BudgetManagementPage.jsx): Hierarchical tree view displaying Projects, Phases, and Task Lists with budget pills, spend progress, and allocation indicators.
   - [useBudgets.js](../../../src/hooks/useBudgets.js): Dedicated hook managing budget queries, cache invalidation, and `INSERT`/`UPDATE` mutations.
3. **Modal Form**:
   - [BudgetEditModal.jsx](../../../src/components/finance/BudgetEditModal.jsx): Context-aware modal showing parent capacity, child allocations, and current spend with real-time client and backend validation error reporting.
4. **Shared Contracts**:
   - Canonical normalization via [src/lib/finance.js](../../../src/lib/finance.js).
   - INR formatting via [src/lib/expenseExecution.js](../../../src/lib/expenseExecution.js).

---

## 4. Verification & Test Suite

The automated test suite in [scripts/test-p6-02-budget-management.mjs](../../../scripts/test-p6-02-budget-management.mjs) runs 46 end-to-end assertions:

- **Suite 1: Frontend Authorization & Active-Tenancy Matrix** (11 assertions)
- **Suite 2: Inherited Budget Semantics & Presentation Contracts** (5 assertions)
- **Suite 3: Source Code Contracts, Fail-Safe Loading & Token Parity** (14 assertions)
- **Suite 4: PostgreSQL Live Hierarchy, Inherited RPCs & Database Integration** (16 assertions)

All 46 assertions pass alongside the full regression gate (P6-01, P4-01, P5-01, P5-03, doc link verification, oxlint, and vite build).

