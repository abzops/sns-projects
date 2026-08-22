# P6-04 — Financial Explorer Core

**Package**: Package 6 — Finance Frontend  
**Status**: `IMPLEMENTED / MANUAL ACCEPTANCE PENDING`  
**Frontend Baseline**: `TBD (P6-04 Implementation)`  
**Database Tip**: `20260820174313_p4_01b_finance_active_tenancy_authorization_closure`  
**Route**: `/workspace/:workspaceId/finance/explorer`  
**Authoritative Backend Contracts**:
- `public.get_workspace_financial_summary(p_workspace_id uuid)`
- `public.get_project_financial_summary(p_project_id uuid)`
- `public.get_phase_financial_summary(p_phase_id uuid)`
- `public.get_task_list_financial_summary(p_task_list_id uuid)`

---

## 1. Executive Summary

P6-04 delivers the centralized **Financial Explorer Core** for SNS Projects ERP. It provides multi-dimensional, read-only operational search, deep financial drill-down, cascading filtering, single-dimension grouping, and client-side CSV exports across the entire organizational work hierarchy.

### Scope & Constraints:
- **Read-Only**: P6-04 Financial Explorer performs zero client-side mutations (no budget editing, expense correction, void, hard delete, or reallocation).
- **Saved Views Deferred**: Persistent Saved Views are explicitly deferred to P6-04A pending canonical database storage.
- **Alert Center Out of Scope**: Finance Alerts and notification lifecycle belong to the dedicated Alert Center package.
- **Database Migrations**: Zero new database migrations.

---

## 2. Authorization & Security Matrix

Explorer access strictly follows workspace-level Finance access rules:

| Role / Authority | Financial Explorer Access |
| :--- | :---: |
| **Workspace Owner (Active)** | ✅ Allowed |
| **Workspace Admin (Active)** | ✅ Allowed |
| **CEO / CTO (Active Workspace Tenancy)** | ✅ Allowed |
| **Finance Operator (`FIN` Dept / Role with Active Tenancy)** | ✅ Allowed |
| **Project Admin / System Admin Alone** | ❌ Denied (*Fails Closed*) |
| **Normal Member / Viewer** | ❌ Denied (*Fails Closed*) |
| **Project Owner / Phase Owner Alone** | ❌ Denied (*Fails Closed*) |
| **CEO / CTO without Active Tenancy** | ❌ Denied (*Fails Closed*) |
| **FIN Department Member without Active Tenancy** | ❌ Denied (*Fails Closed*) |

Authorization checks are enforced via `useFinanceAccess(workspaceId)` with fail-closed views rendered on access errors or missing permissions.

---

## 3. Financial Invariants & Normalized Model

### 3.1 Zero Double Counting
- **Fact Rows vs Rollups**: Only physical expense entries (`expense_transactions` & `expense_items`) represent additive financial facts. Project, Phase, Task List, and Task amounts are rollups.
- **Summary Metrics**: The summary strip's **Effective Spend** and all Group Header financial totals strictly aggregate matching effective **leaf expense transactions** (`actualSpend`). Parent rollup rows are never summed into workspace or group totals.
- **Voided & Corrected Expenses**: Voided transactions contribute ₹0.00 to effective spend while preserving historical item records. Corrected transactions use current line items.

### 3.2 Task Budget & Risk Context
- **Tasks Do Not Own Budgets**: Base Budget and Safety Buffer fields are rendered as `—` or `Inherited` for Task rows.
- **Nearest Budget-Owning Ancestor**: For a hierarchical task, budget source and risk context resolve to the nearest ancestor budget owner:
  $$\text{Task List} \longrightarrow \text{Phase} \longrightarrow \text{Project} \longrightarrow \text{Unbudgeted}$$
- **Context Risk Band**: Task and Expense rows inherit the canonical `risk_band` of their nearest budget-owning ancestor summary.

### 3.3 Standalone Operational Work
- Standalone Tasks and Standalone Process steps contribute to **Standalone / Unallocated Spend** at the workspace summary level.
- Standalone rows do not consume Project budgets and display `Budget Source = Unbudgeted / Standalone` with `Risk Band = UNBUDGETED`.

---

## 4. Multi-Dimensional Filters, Cascading & Grouping

### 4.1 Filters
- **Entity Type**: All, Project, Phase, Task List, Task, Expense, Standalone.
- **Cascading Selectors**: Selecting a Project narrows available Phases; selecting a Phase narrows available Task Lists; selecting a Task List narrows available Tasks. Upper changes clear invalid lower selections.
- **Owner**: Filter by entity owner (`task.owner_id`, `project.owner_id`).
- **Department**: Evaluated strictly as the **active primary department of the entity Owner** (or owning Task's owner for Expense rows). If unassigned, defaults to `Unassigned`.
- **Operational Status**: Active, Completed, Cancelled, Corrected, Voided. (Phases are marked `—` and excluded from status filtering per Requirement 17).
- **Financial Risk**: GREEN, YELLOW, ORANGE, RED, UNBUDGETED.
- **Over-Budget Only**: Filters to Project/Phase/Task List with canonical `overrun > 0`, or Tasks/Expenses whose ancestor context is `ORANGE` or `RED`.
- **Date Range**: Financial activity date (`expense_date` for expenses, `created_at` for operational entities).
- **Amount Range**: Min and Max monetary bounds.
- **Text Search**: Real-time substring search across names, descriptions, projects, phases, tasks, owners, and creators.

### 4.2 Grouping & Sorting
- **Grouping Dimensions**: `None (Flat Table)`, `Project`, `Phase`, `Task List`, `Owner`, `Department`, `Entity Type`, `Status`, `Risk Band`.
- **Group Headers**: Displays group title, total matched records, and total **effective leaf expense spend** within that group.
- **Sorting**: Sortable by Name, Actual Spend, Utilization %, Risk Band (RED > ORANGE > YELLOW > GREEN > UNBUDGETED), Date, and Owner.

---

## 5. CSV Export & Drill-Down

- **CSV Export**: `handleExportCSV` exports currently filtered rows to `sns-financial-explorer-YYYY-MM-DD.csv` with full INR decimal precision, escaped text, and zero exposure of internal private tokens.
- **Drill-Down Links**:
  - Project rows: Direct link to `/workspace/:workspaceId/project/:projectId`
  - Expense rows: Opens `ExpenseDetailModal` for inspection of line items and immutable audit logs.

---

## 6. Verification & Automated Test Suite

The comprehensive test suite `scripts/test-p6-04-financial-explorer.mjs` validates 27 automated assertions across access control, normalized data modeling, zero double-counting, cascading filters, and live PostgreSQL RPCs:

- `test-p6-04-financial-explorer.mjs` (27/27 assertions passed)
- `test-p6-03-expense-ledger.mjs` (42/42 assertions passed)
- `test-p6-02-budget-management.mjs` (46/46 assertions passed)
- `test-p6-01-finance-overview.mjs` (34/34 assertions passed)
- `test-p5-01-expense-execution.mjs` (39/39 assertions passed)
- `test-p5-03-subtask-completion.mjs` (37/37 assertions passed)
- `test-p4-01-finance-foundation.mjs` (74/74 assertions passed)
- `verify-doc-links.mjs` (283/283 links passed)
- `oxlint src/` (0 errors)
- `npm run build` (built cleanly)
