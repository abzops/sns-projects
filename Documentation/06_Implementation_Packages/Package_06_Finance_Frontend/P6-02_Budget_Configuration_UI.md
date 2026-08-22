# Package 6 — P6-02: Central Budget Configuration UI Specification & Certification

## 1. Executive Summary

| Attribute | Canonical Value |
| :--- | :--- |
| **Package** | Package 6: Finance Frontend |
| **Component** | P6-02 & P6-02A: Central Budget Configuration UI |
| **Status** | **`VERIFIED / FROZEN`** |
| **Manual Production Acceptance** | **`PASSED`** |
| **Frontend Baseline** | `7266e55d6bf23ada95b7d2082f1c6966a62e205f` |
| **Production Database Migration Tip** | `20260820174313_p4_01b_finance_active_tenancy_authorization_closure` |
| **Primary Route** | `/workspace/:workspaceId/finance/budgets` |
| **Package 6 Overall Status** | **`IN PROGRESS`** |

**P6-02** delivers the centralized **Budget Management & Configuration Command Center** for SNS Projects at route `/workspace/:workspaceId/finance/budgets`.

It allows authorized workspace leadership to configure, revise, and structure hierarchical Base Budgets and Safety Buffers across Projects, Phases, and Task Lists while preserving 100% database trigger authority, immutable audit logging, fail-closed role separation, and accurate inherited risk evaluation.

---

## 2. Certified Core Capabilities & Architectural Invariants

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

Direct URL access to `/workspace/:workspaceId/finance/budgets` by unauthorized users fails closed and renders a restricted access notice.

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
1. **Hierarchy Funding**:
   - Project Base Budget funds child Phase allocations.
   - Phase Base Budget funds child Task List allocations.
   - Project: May configure Base Budget $\ge 0$ and Safety Buffer $\ge 0$.
   - Phase: Requires parent Project to have a configured Base Budget.
   - Task List: Requires parent Phase to have a configured Base Budget.
2. **Allocation Capacity**:
   - Total child Phase Base Budgets cannot exceed parent Project Base Budget.
   - Total child Task List Base Budgets cannot exceed parent Phase Base Budget.
   - Safety Buffer is a contingency reserve and **never** expands allocatable capacity to child entities.
3. **Budget Revisions**:
   - Reducing Base Budget below existing child allocations is strictly rejected by the database.
   - Phase Base cannot be reduced below existing child Task List allocations.
   - Authorized managers may revise Base Budget below Actual Spend if child allocations permit (updates risk band to ORANGE/RED without halting operational workflows).
   - Database triggers remain the single authority; the frontend does not recreate hierarchy enforcement as a competing business engine.

### 2.4 Own vs Inherited Budget Semantics (P6-02A)

1. **Own Budget Origin**: Determined by the presence of an entity's own row in `public.budgets`.
2. **Effective Inherited Budget**: Determined from the canonical backend summary via `hasEffectiveBudget(summary)` (`summary.is_budgeted === true || summary.budget_source_id != null`).
3. **Certified Presentation Badges**:
   - `Own Budget` (owns dedicated budget row)
   - `Inherited from Project` (inherits Project ancestor budget)
   - `Inherited from Phase` (inherits Phase ancestor budget)
   - `Unbudgeted` / `No Project Budget` (no budget in ancestry)
4. **Presentation Accuracy**:
   - Inherited entities preserve backend `risk_band` (e.g. `GREEN`) rather than incorrectly displaying `UNBUDGETED`.
   - Unowned Base Budget and Safety Buffer fields display `—` to avoid pretending inherited amounts are owned locally.

### 2.5 Fail-Safe Loading, Error Handling & State Isolation

1. **Dual Loading Barrier**: Initial cold load waits for both Projects and Budgets (`projectsLoading || budgetsLoading`), preventing false ₹0 or Unbudgeted flashes.
2. **Error Recovery**: Budget fetch failures render an explicit error container with a `Retry` action, preventing empty-fallback "Set Budget" mutations.
3. **Summary State Tracking**: Async summaries track pending and error states per entity, rendering `—` or `Unavailable` instead of fake ₹0 or fake `GREEN`.
4. **Workspace Context Switch Reset**: Switching workspaces immediately clears local tree expansion, search filter, and cached financial summaries. Stale values never survive context switching.
5. **Update Mutation Scoping**: Authoritative `UPDATE` queries in `useBudgets.js` filter strictly by `id = existingBudgetId AND workspace_id = currentWorkspaceId`.

### 2.6 Immutable Database Audit Logging

Every `INSERT` and `UPDATE` on `public.budgets` triggers an automatic immutable entry in `public.budget_audit_logs` capturing:
- `budget_id`
- `actor_id` (verified against `auth.uid()`)
- `action` (`created` / `updated`)
- `previous_base_budget` & `previous_safety_buffer`
- `new_base_budget` & `new_safety_buffer`
- `created_at` timestamp

The frontend never manually inserts or tampers with `budget_audit_logs`.

---

## 3. Implementation Components

1. **Route & Layout**:
   - Mounted in [App.jsx](../../../src/App.jsx): `/workspace/:workspaceId/finance/budgets`
   - Entry link added in [FinanceOverviewPage.jsx](../../../src/pages/FinanceOverviewPage.jsx) header actions (visible only when `canManageBudgets = true`).
2. **Page & State**:
   - [BudgetManagementPage.jsx](../../../src/pages/BudgetManagementPage.jsx): Hierarchical tree view displaying Projects, Phases, and Task Lists with budget pills, spend progress, allocation indicators, and fail-safe loading/error recovery.
   - [useBudgets.js](../../../src/hooks/useBudgets.js): Dedicated hook managing budget queries, cache invalidation, workspace-scoped `UPDATE` mutations, and `INSERT` creation.
3. **Modal Form**:
   - [BudgetEditModal.jsx](../../../src/components/finance/BudgetEditModal.jsx): Context-aware modal showing parent capacity, child allocations, and current spend with real-time validation and canonical tokens.
4. **Shared Contracts & Design System**:
   - Canonical normalization & effective budget evaluation via [src/lib/finance.js](../../../src/lib/finance.js) (`normalizeFinancialSummary`, `hasEffectiveBudget`).
   - Canonical INR currency formatting via [src/lib/expenseExecution.js](../../../src/lib/expenseExecution.js) (`formatCurrency`).
   - 100% token parity with root design tokens (`var(--panel)`, `var(--panel-soft)`, `var(--border)`, `var(--text)`, `var(--yellow)`).

---

## 4. Production Acceptance Evidence

Independent signed-in manual production acceptance was performed on live Supabase production (`gqerfixdmgbqahgslzsq`) and verified with persistent operational data:

### 4.1 Live Production Budget Hierarchy

1. **Project**: `Kerala Pilot Deployment`
   - **Base Budget**: `₹30,000.00`
   - **Safety Buffer**: `₹10,000.00`
   - **Status**: Own Budget configured
2. **Phase**: `Site & Infrastructure Readiness`
   - **Base Budget**: `₹10,000.00`
   - **Safety Buffer**: `₹6,000.00` (updated from initial `₹5,000.00`)
   - **Status**: Own Budget configured under Project
3. **Task List**: `Property, Civil & Utilities`
   - **Base Budget**: `₹5,000.00`
   - **Safety Buffer**: `₹1,000.00`
   - **Status**: Own Budget configured under Phase

### 4.2 Live Production Audit Ledger Evidence

The PostgreSQL `budget_audit_logs` ledger in production independently recorded:
1. `Project created`: Kerala Pilot Deployment (`base_budget = 30000.00`, `safety_buffer = 10000.00`, `actor_id` matches active Workspace Owner).
2. `Phase created`: Site & Infrastructure Readiness (`base_budget = 10000.00`, `safety_buffer = 5000.00`).
3. `Task List created`: Property, Civil & Utilities (`base_budget = 5000.00`, `safety_buffer = 1000.00`).
4. `Phase updated`: Site & Infrastructure Readiness:
   - `previous_safety_buffer`: `₹5,000.00`
   - `new_safety_buffer`: `₹6,000.00`
   - `actor_id`: matches active Workspace Owner.

---

## 5. Verification & Test Suite

The automated test suite in [scripts/test-p6-02-budget-management.mjs](../../../scripts/test-p6-02-budget-management.mjs) runs 46 end-to-end assertions:

- **Suite 1: Frontend Authorization & Active-Tenancy Matrix** (11 assertions)
- **Suite 2: Inherited Budget Semantics & Presentation Contracts** (5 assertions)
- **Suite 3: Source Code Contracts, Fail-Safe Loading & Token Parity** (14 assertions)
- **Suite 4: PostgreSQL Live Hierarchy, Inherited RPCs & Database Integration** (16 assertions)

All 46 assertions pass alongside the full regression gate:
- `test-p6-02-budget-management.mjs`: 46/46 passed
- `test-p6-01-finance-overview.mjs`: 34/34 passed
- `test-p4-01-finance-foundation.mjs`: 74/74 passed
- `test-p5-01-expense-execution.mjs`: 39/39 passed
- `test-p5-03-subtask-completion.mjs`: 37/37 passed
- `verify-doc-links.mjs`: 280 links checked, 0 errors
- `oxlint src/`: 0 errors
- `npm run build`: built in 862ms cleanly
