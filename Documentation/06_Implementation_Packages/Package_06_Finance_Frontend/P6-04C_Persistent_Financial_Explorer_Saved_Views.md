# P6-04C / P6-04C1 — Persistent Financial Explorer Saved Views

**Package**: Package 6 — Finance Frontend  
**Status**: `VERIFIED / FROZEN` (P6-04C, P6-04C1)  
**Manual Production Acceptance**: `PASSED`  
**Frontend Baseline**: `ff3a3bb9a8636eb0efb334404711f6ccf53b32e8`  
**Database Tip**: `20260822140004_p6_04c1_saved_view_grant_hardening`  
**Deployment Run**: `32577780067` (`SUCCESS`)  
**Route**: `/workspace/:workspaceId/finance/explorer`  
**Authoritative Backend Contracts**:
- `public.finance_explorer_saved_views` (table with RLS, authenticated PostgREST CRUD)
- `private.trg_fn_finance_explorer_saved_views_immutability()` (trigger enforcement)
- Migration: `20260822140004_p6_04c1_saved_view_grant_hardening.sql`

---

## 1. Executive Summary

P6-04C and P6-04C1 deliver authenticated, cross-device **Persistent Saved Views** for the Financial Explorer at `/workspace/:workspaceId/finance/explorer`. Users authorized for workspace Finance can save their multi-dimensional filter, grouping, and sorting configurations, load and atomically apply them without full page reloads, update active views when configurations change, rename views, and delete views.

### Scope & Certified Invariants:
- **Personal Ownership**: Saved Views are strictly personal (`user_id = auth.uid()`). No shared, team, public, or organization template views exist.
- **Authoritative Database Storage**: All Saved Views are stored in `public.finance_explorer_saved_views` under strict RLS. `localStorage` is not used as an authoritative store.
- **Zero Fact Mutation**: Saved Views write only user preference configuration data. ZERO mutations are made to budgets, expenses, projects, tasks, or financial summaries.
- **Grant Hardening (P6-04C1)**: `authenticated` role is granted exclusively `SELECT, INSERT, UPDATE, DELETE` (`TRUNCATE`, `REFERENCES`, and `TRIGGER` revoked). `anon` and `PUBLIC` have zero table privileges.
- **Runtime Isolation & Generation Tokens (P6-04C1)**: Synchronous cache and state flush on scope changes (`userId:workspaceId:authorizationScopeKey`) and generation tokens (`activeFetchIdRef`) to discard stale asynchronous fetch responses.
- **Security Advisor Baseline**: Exactly 6 accepted warnings (5 existing public Process SECURITY DEFINER warnings + 1 leaked-password-protection warning). Database public SECURITY DEFINER count remains 7 (0 new introduced).

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

Backend RLS remains the final authority.

---

## 3. Database Architecture, RLS & Grant Hardening

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
- Access revocation preserves records in the database while blocking RLS access.

---

## 4. Persisted State Contract & Normalization

### 4.1 Persisted Configuration State (`schemaVersion: 1`)
- **Persisted (19 Fields)**:
  1. `entityType`
  2. `selectedProject`
  3. `selectedPhase`
  4. `selectedTaskList`
  5. `selectedTask`
  6. `selectedOwner`
  7. `selectedDepartment`
  8. `selectedStatus`
  9. `selectedRisk`
  10. `overBudgetOnly`
  11. `selectedCreator`
  12. `dateFrom`
  13. `dateTo`
  14. `amountMin`
  15. `amountMax`
  16. `searchQuery`
  17. `groupBy`
  18. `sortBy`
  19. `sortOrder`
- **Explicitly Excluded**: `workspaceId`, `userId`, `authorizationScopeKey`, loaded rows, financial summaries, expense data, cache objects, selected expense modal state, loading/error states.

### 4.2 Frozen P6-04 Enum Parity
- **Status**: `all`, `Active`, `Completed`, `Cancelled`, `Corrected`, `Voided`
- **Group By**: `none`, `project`, `phase`, `task_list`, `owner`, `department`, `rowType`, `status`, `riskBand`
- **Sort By**: `name`, `actualSpend`, `utilizationPct`, `riskBand`, `date`, `ownerName`
- **Sort Order**: `asc`, `desc`

### 4.3 Stale Reference Safety & Metadata Normalization
- Saved View state is validated against current authorized hierarchy metadata (`projects`, `phases`, `task_lists`, `tasks`, `owners`, `creators`, `departments`).
- `selectedOwner` validates against `owners[].id`.
- `selectedCreator` validates against `creators[].id`.
- `selectedDepartment` validates against `departments[].name` while preserving `'Unassigned'`.
- Stale or deleted entity IDs safely fall back to `'all'`.
- Cascading invalidation: Stale `Project` resets `Phase`, `Task List`, `Task`; stale `Phase` resets `Task List`, `Task`.
- Saved View JSON never resurrects inaccessible hierarchy records.

---

## 5. P6-04C1 Runtime Hardening

- **Access Gate Correction**: Replaced nonexistent `canAccessFinance` with `canViewWorkspaceFinance && !financeAccessError`.
- **Scope Key Isolation**: Keyed by `userId:workspaceId:authorizationScopeKey`. Synchronous state flush on scope changes immediately purges stale Saved View names, active selections, baseline state, and errors.
- **Generation Protection**: `activeFetchIdRef` discards stale asynchronous fetch responses, eliminating previous-user/workspace view state flash.
- **Visible Update Error Handling**: Update Current View errors are caught and surfaced visibly in `FinancialExplorerSavedViewsBar`.

---

## 6. Manual Production Acceptance

Manual production acceptance: **`PASSED`**

Verified browser flows in production:
- Save Current View
- Persistence across browser refresh / re-login / device switch
- Load and atomic apply
- Exact filter, grouping, and sorting restoration
- Unsaved changes indicator
- Update active view with current configuration
- Rename active view with duplicate-name guard
- Delete active view while retaining current Explorer filter configuration
- Owner / Creator / Department filter restoration
- Finance Operator personal Saved Views
- Personal user isolation and workspace isolation
- Unauthorized role fail-closed behavior
- Mobile / responsive layout usability
- Preserved frozen P6-04 financial exploration semantics

Post-acceptance production verification confirmed:
- Budgets: 5
- Expense Transactions: 2
- Expense Items: 3
- Saved Views Table: 0 rows (expected as manual acceptance test views were cleaned up upon completion)

---

## 7. Verification & Automated Test Suite

All test suites passed cleanly with zero regressions:

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
