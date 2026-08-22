# P6-04C — Persistent Financial Explorer Saved Views

**Package**: Package 6 — Finance Frontend  
**Status**: `IMPLEMENTED / MANUAL ACCEPTANCE PENDING`  
**Frontend Baseline**: `232a652178677e363c03383b39fe6456cec16201` (P6-04 baseline) — P6-04C applied on top  
**Database Tip**: `20260822133454_p6_04c_finance_explorer_saved_views`  
**Route**: `/workspace/:workspaceId/finance/explorer`  
**Authoritative Backend Contracts**:
- `public.finance_explorer_saved_views` (table with RLS, authenticated PostgREST CRUD)
- `private.trg_fn_finance_explorer_saved_views_immutability()` (trigger enforcement)

---

## 1. Executive Summary

P6-04C delivers authenticated, cross-device **Persistent Saved Views** for the Financial Explorer at `/workspace/:workspaceId/finance/explorer`. Users authorized for workspace Finance can save their multi-dimensional filter, grouping, and sorting configurations, load and atomically apply them without full page reloads, update active views when configurations change, rename views, and delete views.

### Scope & Constraints:
- **Personal Ownership**: Saved Views in P6-04C are strictly personal (`user_id = auth.uid()`). No shared, team, or public views are introduced.
- **Authoritative Database Storage**: All Saved Views are stored in `public.finance_explorer_saved_views` under strict RLS. `localStorage` is not used as an authoritative store.
- **Zero Fact Mutation**: Saved Views are user preference configurations only. Zero writes or mutations are made to budgets, expenses, projects, tasks, or financial summary data.
- **Zero Public Security Definer RPCs**: Standard PostgREST CRUD under table RLS is used.

---

## 2. Authorization & Security Matrix

Saved View CRUD is strictly gated by workspace Finance authority:

| Authority / Role | Saved Views CRUD | Isolation Contract |
| :--- | :---: | :--- |
| **Workspace Owner (Active)** | ✅ Allowed | Can CRUD only own Saved Views in active workspace |
| **Workspace Admin (Active)** | ✅ Allowed | Can CRUD only own Saved Views in active workspace |
| **CEO / CTO (Active Workspace Tenancy)** | ✅ Allowed | Can CRUD only own Saved Views in active workspace |
| **Finance Operator (Active Tenancy)** | ✅ Allowed | Can CRUD only own Saved Views in active workspace |
| **Normal Member / Viewer** | ❌ Denied | RLS denies read, insert, update, delete |
| **Project Admin / System Admin Alone** | ❌ Denied | Fails closed under `can_manage_budgets` / `is_finance_operator` |
| **Inactive Tenancy / Suspended Member** | ❌ Denied | RLS denies access; records preserved in DB |

---

## 3. Database Architecture & Immutability

### 3.1 Table Definition
```sql
CREATE TABLE public.finance_explorer_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  view_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_finance_explorer_saved_views_name CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 100),
  CONSTRAINT chk_finance_explorer_saved_views_state_object CHECK (jsonb_typeof(view_state) = 'object')
);
```

### 3.2 Immutability Trigger (`private.trg_fn_finance_explorer_saved_views_immutability`)
- **On INSERT**: Forces `NEW.user_id = auth.uid()`, preventing user identity spoofing.
- **On UPDATE**: Enforces `NEW.user_id = OLD.user_id`, `NEW.workspace_id = OLD.workspace_id`, `NEW.created_at = OLD.created_at`, updating `NEW.updated_at = clock_timestamp()`.

### 3.3 Row-Level Security
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies enforce `user_id = auth.uid()` AND (`private.can_manage_budgets(workspace_id, auth.uid()) OR private.is_finance_operator(workspace_id, auth.uid())`).
- Unique case-insensitive index on `(workspace_id, user_id, lower(trim(name)))`.

---

## 4. Frontend View State Contract & Normalization

### 4.1 Persisted Configuration State (`schemaVersion: 1`)
- **Persisted**: `entityType`, `selectedProject`, `selectedPhase`, `selectedTaskList`, `selectedTask`, `selectedOwner`, `selectedDepartment`, `selectedStatus`, `selectedRisk`, `overBudgetOnly`, `selectedCreator`, `dateFrom`, `dateTo`, `amountMin`, `amountMax`, `searchQuery`, `groupBy`, `sortBy`, `sortOrder`.
- **Excluded**: `workspaceId`, `userId`, `authorizationScopeKey`, loaded rows, financial summaries, expense data, cache objects.

### 4.2 Stale Reference Sanitization & Cascading Integrity
- Saved View state is validated against current authorized hierarchy metadata (`projects`, `phases`, `task_lists`, `tasks`, `profiles`, `primary_departments`).
- Stale or deleted entity IDs safely fall back to `'all'`.
- Cascading invalidation: Stale `Project` resets `Phase`, `Task List`, `Task`; stale `Phase` resets `Task List`, `Task`.

---

## 5. Verification & Automated Test Suite

The test suite `scripts/test-p6-04c-saved-views.mjs` executes 25 automated assertions covering database RLS, ownership immutability, anti-spoofing, and frontend contracts:

- `test-p6-04c-saved-views.mjs` (25/25 assertions passed)
- `test-p6-04-financial-explorer.mjs` (60/60 assertions passed)
- `test-p6-03-expense-ledger.mjs` (42/42 assertions passed)
- `test-p6-02-budget-management.mjs` (46/46 assertions passed)
- `test-p6-01-finance-overview.mjs` (34/34 assertions passed)
- `test-p5-01-expense-execution.mjs` (39/39 assertions passed)
- `test-p5-03-subtask-completion.mjs` (37/37 assertions passed)
- `test-p4-01-finance-foundation.mjs` (74/74 assertions passed)
- `verify-doc-links.mjs` (287/287 links passed)
- `oxlint src/` (0 errors)
- `npm run build` (built cleanly)
