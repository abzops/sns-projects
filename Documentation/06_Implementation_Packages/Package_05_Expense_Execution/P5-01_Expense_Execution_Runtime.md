# P5-01 & P5-01A: Expense Execution Runtime, Security & Runtime Parity

**Package**: Package 05 — Expense Execution Integration  
**Status**: Implemented & Certified  
**Deployment Migration Tips**:  
- `20260819131603_p5_01_expense_execution_runtime.sql` (Baseline)  
- `20260819151608_p5_01a_expense_runtime_security_parity_hotfix.sql` (Hotfix)  
**Remote Project**: `gqerfixdmgbqahgslzsq`  
**Certification Date**: 2026-08-19  

---

## 1. Overview

P5-01 and P5-01A establish the production database execution engine and transactional APIs for recording, correcting, voiding, and auditing operational expenses in SNS Projects. All expense ledger writes occur atomically with work completion while strictly enforcing server-side mutation capabilities (blocking read-only Viewers from reaching mutation paths), preserving single canonical Defined Process execution runtime, ensuring notification constraint compatibility, and maintaining zero new Supabase Security Advisor warnings.

---

## 2. Core Architecture & Components

### 2.1 Schema Extensions & Invariants

1. **`public.expense_transactions`**:
   - `cycle_number integer NULL`: Stores Defined Process rework cycle provenance without duplicating mutable hierarchy columns.
   - Partial Unique Index `uq_expense_transactions_task_cycle_active` on `(task_id, cycle_number) WHERE cycle_number IS NOT NULL AND status IN ('active', 'corrected')`: Strictly guarantees single active expense per task cycle while allowing multiple rework cycles.
2. **`public.expense_audit_logs`**:
   - `original_transaction_id uuid NOT NULL`: Permanent, immutable identity tracking the originating transaction UUID across its entire lifecycle.
   - `metadata jsonb NULL DEFAULT '{}'::jsonb`: Stores complete snapshots of itemized expenses for corrections and hard-delete tombstones.
   - Preserves standard foreign key `transaction_id REFERENCES public.expense_transactions(id) ON DELETE SET NULL`.
3. **`public.task_approval_cycles`**:
   - Added `rework_instructions text NULL` to safely persist rework directives.
   - Updated constraint `chk_task_approval_cycle_decision` to permit `NULL` due dates on rejected process instance steps (Decisions 33 & 42).
4. **`public.notifications` Constraint Compatibility**:
   - Updated `notifications_type_check` to accept all 20 runtime and trigger emitted notification types:
     `task_assigned`, `task_accountable`, `task_consulted`, `task_informed`, `raci_changed`, `task_status_changed`, `subtask_assigned`, `project_status_changed`, `system`, `process_task_ready`, `process_task_completed`, `consultation_required`, `process_consultation_response`, `approval_required`, `task_rework_required`, `rework_required`, `process_rework_requested`, `process_task_rejected`, `process_task_review_needed`, `process_completed`.

---

## 3. Security Model & Mutation Authorization

### 3.1 Server-Side Viewer Read-Only Enforcement

Server-side helper `private.can_mutate_operational_workspace(workspace_id, user_id)` verifies that the authenticated caller holds mutation capability (Workspace Owner, Admin, Member, or System Role CEO, CTO, Project Admin, System Admin).

An involved Workspace Viewer assigned as Assignee or RACI R/A/C is strictly denied from reaching mutation execution paths across:
- `complete_task_with_expense`
- `complete_responsible_step_with_expense`
- `complete_responsible_part`
- `approve_process_task`
- `reject_process_task`
- `submit_task_consultation`
- `submit_task_evidence`

---

## 4. Transactional & Audited Execution APIs

All external APIs are implemented as `SECURITY INVOKER` wrappers delegating to hardened `SECURITY DEFINER` functions in the `private` schema with `SET search_path = ''`.

| Public Wrapper | Private Implementation | Authorized Roles | Audit Action | Description |
|---|---|---|---|---|
| `complete_task_with_expense` | `private.complete_task_with_expense_internal` | Mutation capability + authorized Task access (Assignee/RACI R/Admin) | `created` (if expense) | Atomically validates leaf status (Decision 17), optional expense payload, updates task status to Done, triggers parent auto-completion. |
| `complete_responsible_step_with_expense` | `private.complete_responsible_step_with_expense_internal` | Mutation capability + assigned Responsible (R) user | `created` (if expense) | Wraps canonical `complete_responsible_part_internal` for zero runtime duplication; atomically records optional cycle expense upon step completion. |
| `correct_expense_transaction` | `private.correct_expense_transaction_internal` | Workspace Owner/Admin, CEO, CTO, Finance Operator (`FIN`) | `corrected` | Requires mandatory reason string. Replaces line items, calculates new total, logs previous and new item snapshots. |
| `void_expense_transaction` | `private.void_expense_transaction_internal` | Workspace Owner/Admin, CEO, CTO, Finance Operator (`FIN`) | `voided` | Requires mandatory reason string. Marks transaction as voided ($0.00 effective contribution to rollups). |
| `hard_delete_expense_transaction` | `private.hard_delete_expense_transaction_internal` | Workspace Owner/Admin, CEO, CTO ONLY | `hard_deleted` | Requires mandatory reason string. Writes immutable audit tombstone with full snapshot first, then physically removes ledger rows. |

---

## 5. Verification Matrix

- **30/30 Automated Assertions** in `scripts/test-p5-01-expense-execution.mjs`.
- **60/60 P4-01 Budget Assertions** in `scripts/test-p4-01-finance-foundation.mjs`.
- **Full Process Runtime Regression**:
  - `scripts/test-p1-02a-process-lifecycle.mjs` (34/34 passing)
  - `scripts/test-p2-02-process-movement-cancellation.mjs` (44/44 passing)
  - `scripts/test-p2-03-parent-completion.mjs` (17/17 passing)
- **All OV1 Regression Suites Passing**:
  - `npm run test:loading-stabilization` (24/24)
  - `npm run test:ov1-frontend` (37/37)
  - `npm run test:ov1-dashboard` (43/43)
  - `npm run verify:css-modules` (48 modules)
  - `npm run test:stability` (14 routes + 16 failure contracts)
  - `node scripts/verify-doc-links.mjs` (255/255 links)
  - `npm run lint` (0 errors)
  - `npm run build` (0 errors)
- **Supabase Security Advisor**: Exactly 6 accepted baseline warnings, 0 new warnings.
