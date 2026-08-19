# P5-01: Expense Execution Runtime & Audit APIs

**Package**: Package 05 — Expense Execution Integration  
**Status**: Implemented & Certified  
**Deployment Migration Tip**: `20260819131603_p5_01_expense_execution_runtime.sql`  
**Remote Project**: `gqerfixdmgbqahgslzsq`  
**Certification Date**: 2026-08-19  

---

## 1. Overview

P5-01 establishes the backend database execution engine and transactional APIs for recording, correcting, voiding, and auditing operational expenses in SNS Projects. All expense ledger writes occur atomically with work completion while preserving full Operational V1 authorization, DAG progression, and zero new Supabase Security Advisor warnings.

---

## 2. Core Architecture & Components

### 2.1 Schema Extensions

1. **`public.expense_transactions`**:
   - `cycle_number integer NULL`: Stores Defined Process rework cycle provenance without duplicating mutable hierarchy columns.
   - Index `idx_expense_transactions_cycle` on `(task_id, cycle_number)`.
2. **`public.expense_audit_logs`**:
   - `original_transaction_id uuid NOT NULL`: Permanent, immutable identity tracking the originating transaction UUID across its entire lifecycle.
   - `metadata jsonb NULL DEFAULT '{}'::jsonb`: Stores complete snapshots of itemized expenses for corrections and hard-delete tombstones.
   - Preserves standard foreign key `transaction_id REFERENCES public.expense_transactions(id) ON DELETE SET NULL`.
3. **`public.task_approval_cycles`**:
   - Added `rework_instructions text NULL` to safely persist rework directives.
   - Updated constraint `chk_task_approval_cycle_decision` to permit `NULL` due dates on rejected process instance steps (Decisions 33 & 42).
4. **`public.notifications`**:
   - Updated constraint `notifications_type_check` to include `rework_required` type.

---

## 3. Transactional & Audited Execution APIs

All external APIs are implemented as `SECURITY INVOKER` wrappers delegating to hardened `SECURITY DEFINER` functions in the `private` schema with `SET search_path = ''`.

| Public Wrapper | Private Implementation | Authorized Roles | Audit Action | Description |
|---|---|---|---|---|
| `complete_task_with_expense` | `private.complete_task_with_expense_internal` | Assignee, Owner, Project Owner, RACI R, Workspace Owner/Admin, CEO, CTO | `created` (if expense) | Atomically validates leaf status (Decision 17), optional expense payload, updates task status to Done, triggers parent auto-completion. |
| `complete_responsible_step_with_expense` | `private.complete_responsible_step_with_expense_internal` | Assigned Responsible (R) user | `created` (if expense) | Validates consultations and evidence preflight, records optional cycle expense, advances DAG or transitions to `awaiting_approval`. |
| `correct_expense_transaction` | `private.correct_expense_transaction_internal` | Workspace Owner/Admin, CEO, CTO, Finance Operator (`FIN`) | `corrected` | Requires mandatory reason string. Replaces line items, calculates new total, logs previous and new item snapshots. |
| `void_expense_transaction` | `private.void_expense_transaction_internal` | Workspace Owner/Admin, CEO, CTO, Finance Operator (`FIN`) | `voided` | Requires mandatory reason string. Marks transaction as voided ($0.00 effective contribution to rollups). |
| `hard_delete_expense_transaction` | `private.hard_delete_expense_transaction_internal` | Workspace Owner/Admin, CEO, CTO ONLY | `hard_deleted` | Requires mandatory reason string. Writes immutable audit tombstone with full snapshot first, then physically removes ledger rows. |

---

## 4. Key Financial & Operational Invariants

1. **Atomic Intercept**: Work completion and expense entry succeed or fail in a single PostgreSQL transaction. Invalid expense payloads roll back task completion; unauthorized completion attempts create zero expense.
2. **Leaf Work Isolation (Decision 17)**: Parent tasks with child dependencies or attached process instances are strictly blocked from direct expense capture.
3. **Rework Cycle Accumulation (Decision 61)**: When a process step is rejected into rework (Cycle $N+1$), the Cycle $N$ expense remains active and cumulative spend rolls upward across all cycles.
4. **Permanent Audit Identity**: When an admin hard-deletes an expense transaction, the tombstone in `expense_audit_logs` retains the exact original UUID in `original_transaction_id` and complete line-item data in `metadata.snapshot`.
5. **Zero Double-Counting**: Standalone process expenses roll strictly to Standalone Spend; Project expenses roll strictly to Project Actual Spend.
6. **Anti-Spoofing**: All actor identities are derived server-side from `auth.uid()`.

---

## 5. Verification Matrix

- **32/32 Automated Assertions** in `scripts/test-p5-01-expense-execution.mjs`.
- **60/60 P4-01 Budget Assertions** in `scripts/test-p4-01-finance-foundation.mjs`.
- **All OV1 Regression Suites Passing**:
  - `npm run test:loading-stabilization` (24/24)
  - `npm run test:ov1-frontend` (37/37)
  - `npm run test:ov1-dashboard` (43/43)
  - `npm run verify:css-modules` (48 modules)
  - `npm run test:stability` (14 routes + 16 failure contracts)
  - `node scripts/verify-doc-links.mjs` (251/251 links)
  - `npm run lint` (0 errors)
  - `npm run build` (0 errors)
- **Supabase Security Advisor**: Exactly 6 accepted baseline warnings, 0 new warnings.
