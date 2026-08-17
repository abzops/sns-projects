# P1-01B Documentation Accuracy & Authoritative Architecture Baseline

## Document Control
- **Status**: `VERIFIED`
- **Package**: Package 1 — Core Foundation
- **Implementation Commit**: [`477f47a`](https://github.com/abzops/sns-projects/commit/477f47a)
- **Canonical Migration**: `20260817064609_p1_01_process_instance_access_hardening.sql`
- **Target Project**: `gqerfixdmgbqahgslzsq` (SNS Projects Production)
- **Date**: 2026-08-17
- **Last Verified Date**: 2026-08-17

---

## 1. Objective & Why Correction Was Required

Following the delivery of P1-01 and P1-01A, a rigorous documentation audit identified inaccuracies, non-portable links, speculative feature drift, and invented timelines in the documentation suite:
1. **Technical Baseline Discrepancies**: Documentation cited outdated versions (React 18, PostgreSQL 15) and approximate commit descriptions rather than exact versions from `package.json` (React 19, Vite 8, PostgreSQL 17).
2. **Unapproved Timeline Projections**: A Mermaid Gantt chart contained speculative dates that were never approved by engineering leadership.
3. **Speculative Finance Scope Drift**: Unapproved ERP/accounting features (Cost Centers, General Ledger accounts, Purchase Orders, Invoice Management) had drifted into the roadmap.
4. **Incomplete Decision Records**: ADR documentation omitted the majority of established SNS Projects architectural decisions and altered canonical decision IDs.
5. **Non-Portable File Links**: Several documents contained local machine URIs (`file:///C:/...`), breaking cross-environment portability.

P1-01B establishes a factually accurate, portable, and authoritative documentation baseline without modifying the production database or application code.

---

## 2. Technical Baseline Corrections

All baseline descriptions across the documentation suite were verified against repository source code:

| Component | Inaccurate Reference | Verified Source Reality (`package.json`) |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18 | **React 19** (`react` ^19.2.7, `react-dom` ^19.2.7) |
| **Routing** | Unspecified | **React Router DOM 7** (`react-router-dom` ^7.18.1) |
| **Build System** | Unspecified | **Vite 8** (`vite` ^8.1.1) |
| **Database Engine** | PostgreSQL 15 | **Supabase PostgreSQL 17** |
| **Client SDK** | Supabase JS 2 | **Supabase JS v2** (`@supabase/supabase-js` ^2.110.0) |
| **Drag & Drop** | Unspecified | **dnd-kit** (`@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0) |
| **Icons** | Lucide React | **Lucide React** (`lucide-react` ^1.23.0) |
| **Implementation Commit**| "Current working commit" | Exact verified SHA: [`64fd803`](https://github.com/abzops/sns-projects/commit/64fd803) |

---

## 3. Removal of Speculative Finance Scope & Invented Timelines

- **Eliminated Timeline Gantt**: All unapproved implementation dates were removed from `Documentation/README.md` and `IMPLEMENTATION_ROADMAP.md`. Replaced with deterministic status tables (`VERIFIED`, `NEXT`, `PLANNED`, `PARKED`).
- **Removed ERP & Accounting Feature Drift**: Removed all references to:
  - ❌ Cost Centers / Allocation Codes
  - ❌ General Ledger (GL) Accounts / Double-Entry Ledgers
  - ❌ Purchase Orders (PO) / Requisition Flows
  - ❌ Invoice Processing & Vendor Management
  - ❌ Accounts Payable / Receivable
  - ❌ Multi-level budget overage approvals
- **Approved Finance Scope Established**: Created [`FINANCE_ARCHITECTURE_SPEC.md`](../../05_Finance/FINANCE_ARCHITECTURE_SPEC.md) detailing the authorized Base Budget + fixed Safety Buffer model, leaf expense capture, deterministic risk bands, and Finance Operator role boundaries.

---

## 4. Authoritative Decision Register Architecture

Repaired the decision documentation by establishing domain-specific registers that preserve canonical SNS Projects Decision IDs:

1. **[Master Decision Register](../../09_Decision_Records/DECISION_REGISTER.md)**: Master index of all decisions from Decision 1 through Decision 70.
2. **[Process Architecture Decisions](../../09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: Decisions 1–4, 26–44.
   - **Decision 32 explicitly documented as `PARKED`** (Minimal technical lifecycle `running`, `completed`, `cancelled` only).
3. **[Finance Architecture Decisions](../../09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md)**: Decisions 5–25, 45–70.
   - Base + Buffer model, risk bands, atomic completion intercepts, zero double counting, sibling reallocation, and audit tombstones.

---

## 5. Portability & Link Verifier Hardening

- **Removed Local URIs**: Converted all `file:///C:/...` and `C:\Users\...` references across documentation files into clean, relative Markdown links.
- **Hardened Verification Suite**: Updated [`scripts/verify-doc-links.mjs`](../../../scripts/verify-doc-links.mjs) to:
  1. Fail execution if any `file:///` local URIs or hardcoded Windows paths are detected in active documentation.
  2. Validate that all relative links resolve against existing repository files and directories.

---

## 6. Document Audit & Precedence Governance

### Authority Precedence Order
Documented in [`DOCUMENTATION_STANDARD.md`](../../00_Governance/DOCUMENTATION_STANDARD.md):
1. `DOCUMENTATION_STANDARD.md`
2. `DECISION_REGISTER.md`
3. Domain Decision Records (`PROCESS` & `FINANCE`)
4. `IMPLEMENTATION_ROADMAP.md`
5. System Architecture Specs
6. Verified Implementation Package Reports
7. Historical Release Notes
8. Archive

### Document Classification Metrics
- **Total Markdown Files**: 32 files
- **Active / Authoritative Governance & Specs**: 8 files
- **Implementation Package Reports**: 3 files (`P1-01`, `P1-01A`, `P1-01B`)
- **Historical Release Notes & Audits**: 21 files (labeled with `HISTORICAL` / `SUPERSEDED` metadata)

---

## 7. Security Advisor Baseline Documentation

Accurately documented the security posture in `P1-01A` and `README.md`:
- **P1-01A Hardening Migration**: Introduced **0 new WARN findings**.
- **Intentional Design Info**: `process_instances` produces an expected `RLS Enabled No Policy` INFO finding (fail-closed until P1-02).
- **Pre-Existing Baseline Warnings**:
  - 7 authenticated `SECURITY DEFINER` workflow RPC WARN findings.
  - 1 `Leaked Password Protection Disabled` configuration WARN finding.

---

## 8. Verification & Test Summary

- **Documentation Link Integrity & Portability**: `node scripts/verify-doc-links.mjs` $\longrightarrow$ **100% PASS** (Zero local URIs, zero broken links).
- **Foundation Test Suite**: `node scripts/test-p1-01-foundation.mjs` $\longrightarrow$ **45 / 45 PASSED**.
- **Static Contract Hotfix Suite**: `node scripts/test-p0-auth-hotfix.mjs` $\longrightarrow$ **30 / 30 PASSED**.
- **Auth Safety Guard Suite**: `node scripts/test-auth-harness-safety.mjs` $\longrightarrow$ **7 / 7 PASSED**.
- **V1-03A Process Builder Suite**: `node scripts/test-v1-03a-hotfix.mjs` $\longrightarrow$ **16 / 16 PASSED**.
- **ESLint**: **0 errors**.
- **Production Build**: **Clean build** (`✓ built in 745ms`).

---

## 9. Next Steps

- **Package 1 / P1-02**: Implement placement-aware Defined Process execution RPCs and participant-aware RLS policies.
