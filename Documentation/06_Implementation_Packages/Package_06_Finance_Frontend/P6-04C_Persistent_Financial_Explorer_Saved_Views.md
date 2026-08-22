# P6-04C — Persistent Financial Explorer Saved Views

**Package**: Package 6 — Finance Frontend  
**Status**: `IMPLEMENTED / MANUAL ACCEPTANCE PENDING`  
**Frontend Baseline**: `3b07e209fea1c425fb86cec3c70c533a1c8dd115` (P6-04C baseline) — P6-04C1 applied on top  
**Database Tip**: `20260822140004_p6_04c1_saved_view_grant_hardening`  
**Route**: `/workspace/:workspaceId/finance/explorer`  
**Authoritative Backend Contracts**:
- `public.finance_explorer_saved_views` (table with RLS, authenticated PostgREST CRUD)
- `private.trg_fn_finance_explorer_saved_views_immutability()` (trigger enforcement)

---

## 1. Executive Summary

P6-04C & P6-04C1 deliver authenticated, cross-device **Persistent Saved Views** for the Financial Explorer at `/workspace/:workspaceId/finance/explorer`. Users authorized for workspace Finance can save their multi-dimensional filter, grouping, and sorting configurations, load and atomically apply them without full page reloads, update active views when configurations change, rename views, and delete views.

### Scope & Constraints:
- **Personal Ownership**: Saved Views in P6-04C are strictly personal (`user_id = auth.uid()`). No shared, team, or public views are introduced.
- **Authoritative Database Storage**: All Saved Views are stored in `public.finance_explorer_saved_views` under strict RLS. `localStorage` is not used as an authoritative store.
- **Zero Fact Mutation**: Saved Views are user preference configurations only. Zero writes or mutations are made to budgets, expenses, projects, tasks, or financial summary data.
- **Grant Hardening (P6-04C1)**: `authenticated` role is granted exclusively `SELECT, INSERT, UPDATE, DELETE` (`TRUNCATE, REFERENCES, TRIGGER` revoked). `anon` and `PUBLIC` have zero table privileges.
- **Runtime Isolation & Generation Tokens (P6-04C1)**: Synchronous cache flush on scope changes (`userId:workspaceId:authorizationScopeKey`) and generation token (`activeFetchIdRef`) to discard stale asynchronous fetch responses.
- **Zero Public Security Definer RPCs**: Standard PostgREST CRUD under table RLS is used. Baseline 7 public SECURITY DEFINER functions maintained (0 new).

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

### 3.1 Table Definition & Grants
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

-- P6-04C1 Table Privilege Hardening
REVOKE ALL PRIVILEGES ON TABLE public.finance_explorer_saved_views FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.finance_explorer_saved_views TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.finance_explorer_saved_views FROM anon, PUBLIC;
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
- **Frozen P6-04 Enum Alignment**:
  - `selectedStatus`: `all`, `Active`, `Completed`, `Cancelled`, `Corrected`, `Voided`
  - `groupBy`: `none`, `project`, `phase`, `task_list`, `owner`, `department`, `rowType`, `status`, `riskBand`
  - `sortBy`: `name`, `actualSpend`, `utilizationPct`, `riskBand`, `date`, `ownerName`
  - `sortOrder`: `asc`, `desc`

### 4.2 Stale Reference Sanitization & Cascading Integrity
- Saved View state is validated against current authorized hierarchy metadata (`projects`, `phases`, `task_lists`, `tasks`, `owners`, `creators`, `departments`).
- `selectedDepartment` is validated against `departments[].name` while preserving `'Unassigned'`.
- Stale or deleted entity IDs safely fall back to `'all'`.
- Cascading invalidation: Stale `Project` resets `Phase`, `Task List`, `Task`; stale `Phase` resets `Task List`, `Task`.

---

## 5. Verification & Automated Test Suite

The test suite `scripts/test-p6-04c-saved-views.mjs` executes 50 automated assertions covering database RLS, grants, ownership immutability, anti-spoofing, and frontend contracts:

- `test-p6-04c-saved-views.mjs` (50/50 assertions passed)
- `test-p6-04-financial-explorer.mjs` (60/60 assertions passed)
- `test-p6-03-expense-ledger.mjs` (42/42 assertions passed)
- `test-p6-02-budget-management.mjs` (46/46 assertions passed)
- `test-p6-01-finance-overview.mjs` (34/34 assertions passed)
- `test-p5-01-expense-execution.mjs` (39/39 assertions passed)
- `test-p5-03-subtask-completion.mjs` (37/37 assertions passed)
- `test-p4-01-finance-foundation.mjs` (74/74 assertions passed)
- `test-ov1-b-frontend-visibility.mjs` (37/37 assertions passed)
- `test-ov1-c-role-aware-dashboard.mjs` (43/43 assertions passed)
- `verify-doc-links.mjs` (290/290 links passed)
- `oxlint src/` (0 errors)
- `npm run build` (built cleanly)
