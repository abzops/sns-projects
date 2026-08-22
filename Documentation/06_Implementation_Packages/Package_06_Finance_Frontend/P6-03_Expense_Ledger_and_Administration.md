# P6-03 — Expense Ledger & Correction / Void Administration

**Package**: Package 6 — Finance Frontend  
**Status**: `IMPLEMENTED / MANUAL ACCEPTANCE PENDING`  
**Database Tip**: `20260820174313_p4_01b_finance_active_tenancy_authorization_closure`  
**Route**: `/workspace/:workspaceId/finance/expenses`  
**Authoritative Backend RPCs**:
- `public.correct_expense_transaction(p_transaction_id uuid, p_items jsonb, p_reason text, p_description text, p_expense_date date)`
- `public.void_expense_transaction(p_transaction_id uuid, p_reason text)`
- `public.hard_delete_expense_transaction(p_transaction_id uuid, p_reason text)`

---

## 1. Executive Summary

P6-03 & P6-03A deliver the centralized **Finance Expense Ledger UI** and administrative controls for SNS Projects ERP. It provides real-time transaction oversight, multi-attribute filtering, complete line item inspection, and controlled modification workflows (Correction, Void, and Hard Delete).

---

## 2. Authorization & Security Architecture

Access and mutation authorities strictly conform to the Package 4 active tenancy model:

| Role / Authority | Read Ledger | View Line Items & Audit | Correct Expense | Void Expense | Hard Delete Expense |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Workspace Owner (Active)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Workspace Admin (Active)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **CEO / CTO (Active Tenancy)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Finance Operator (FIN Dept / Role)** | ✅ | ✅ | ✅ | ✅ | ❌ (*Hidden / Fails Closed*) |
| **Project Admin / System Admin** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Normal Member / Viewer** | ❌ | ❌ | ❌ | ❌ | ❌ |

### Key Invariants:
1. **Zero Client Direct DML**: The frontend never issues direct `UPDATE` or `DELETE` SQL queries against `expense_transactions`, `expense_items`, or `expense_audit_logs`. All state changes flow through PostgreSQL RPCs.
2. **Fail-Closed Routing & Scope Isolation**: Access to `/workspace/:workspaceId/finance/expenses` is gated via `useFinanceAccess(workspaceId)`. Authorization context errors and unauthorized accesses fail closed immediately. `useExpenseLedger` keys cache by `userId:workspaceId:authorizationScopeKey` and synchronously flushes state on scope shifts.
3. **Hard-Delete Segregation**: Finance Operators alone are denied hard-delete authority at both frontend UI level (`canManageBudgets` check) and backend database level (`private.can_manage_budgets` authorization check).

---

## 3. UI Features & Workflows

### 3.1 Ledger Table & Cards
- **Desktop Table**: High-density table displaying Date, Project, Task, Source (Task/Child Task/Process Step/Subtask), Description, Amount (INR formatted with paise), Status (`active`, `corrected`, `voided`), Created By, and Action buttons.
- **Mobile Stacked Cards**: Responsive card layout preserving all attribution and amounts.
- **Summary Metrics Bar**: Real-time totals for filtered transactions, Net Effective Spend, Active count, Corrected count, and Voided count.

### 3.2 Filtering & Search
- **Full-Text Search**: Live substring matching across task titles, subtask titles, project names, transaction descriptions, line item categories, and line item descriptions.
- **Project Filter**: Scoped to workspace projects.
- **Status Filter**: Filter by `all`, `active`, `corrected`, or `voided`.
- **Date Range**: Filter from and to expense dates.
- **Reset Filters**: One-click filter clear.

### 3.3 Transaction Inspection (Detail Drawer / Modal)
- **Metadata**: Expense UUID, expense date, status, creation timestamp, creator name, updater name.
- **Attribution**: Project, parent task, subtask / process step, cycle number.
- **Line Items Table**: Category, description, line number, amount.
- **Immutable Audit History**: Real-time chronological audit trail from `expense_audit_logs` showing actor name, action (`created`, `corrected`, `voided`, `hard_deleted`), status transitions (`previous_status` $\to$ `new_status`), previous total, new total, and mandatory reason.
- **Fail-Safe Loading**: Network or query failures in audit logs render an explicit `Audit History Unavailable` state with a `Retry` action rather than a misleading empty list.

### 3.4 Expense Correction (`correct_expense_transaction`)
- Modal pre-populated with current line items.
- Preserves optional `NULL` categories and arbitrary historical custom categories (using datalist suggestions rather than restrictive fixed dropdowns).
- Supports editing amounts, categories, and descriptions, adding new line items, removing items, and modifying/clearing the overall transaction description and expense date.
- Enforces at least 1 line item, positive amounts only (> ₹0.00), and a mandatory audit reason.
- Automatically transitions status to `corrected` and creates an immutable audit record.

### 3.5 Expense Voiding (`void_expense_transaction`)
- Modal requiring confirmation and mandatory void reason.
- Reduces effective transaction contribution to ₹0.00.
- Voided transactions display with line-through styling and `voided` status badge.
- Cannot be corrected or re-voided.

### 3.6 Hard Delete & Audit Tombstones (`hard_delete_expense_transaction`)
- Danger modal strictly restricted to Workspace Owners, Admins, and Executive Budget Managers.
- Physically deletes the transaction row and line items from operational tables.
- Preserves a permanent, immutable tombstone in `expense_audit_logs` with `original_transaction_id`, `actor_id`, mandatory reason, and full JSON snapshot.
- Accessible via the **Audit Tombstones** tab in the Ledger UI, with a read-only **View Snapshot Evidence** modal (`TombstoneDetailModal`).

---

## 4. Verification Suite

Automated verification is covered by `scripts/test-p6-03-expense-ledger.mjs` (42 assertions) and passes the complete regression gate:
- `test-p6-03-expense-ledger.mjs` (42/42 passed)
- `test-p6-02-budget-management.mjs` (46/46 passed)
- `test-p6-01-finance-overview.mjs` (34/34 passed)
- `test-p5-01-expense-execution.mjs` (39/39 passed)
- `test-p5-03-subtask-completion.mjs` (37/37 passed)
- `test-p4-01-finance-foundation.mjs` (74/74 passed)
- `verify-doc-links.mjs` (passed)
- `oxlint src/` (0 errors)
- `npm run build` (built cleanly)
