# SNS Projects — Master Documentation Index

## 1. System Overview

**StacknStock Projects (SNS Projects)** is an enterprise-grade project and process execution platform designed for industrial, technical, and multi-disciplinary teams. It unifies strategic project milestones, tactical Kanban task boards, full RACI accountability matrices, and strict sequential/DAG Defined Process Workflows into a single coherent system.

---

## 2. Current Technical Baseline

- **Frontend Core**: React 19 (`react` ^19.2.7, `react-dom` ^19.2.7), JavaScript (JSX)
- **Routing**: React Router DOM 7 (`react-router-dom` ^7.18.1)
- **Build Tooling**: Vite 8 (`vite` ^8.1.1), Oxlint (`oxlint` ^1.71.0)
- **UI Architecture**: Vanilla CSS / CSS Modules, Lucide React (`lucide-react` ^1.23.0)
- **Drag & Drop**: dnd-kit (`@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0, `@dnd-kit/utilities` ^3.2.2)
- **State Management**: React Context + custom domain hooks
- **Client SDK**: Supabase JS v2 (`@supabase/supabase-js` ^2.110.0)
- **Backend Database**: Supabase PostgreSQL 17, Row-Level Security (RLS)
- **Backend Serverless**: Supabase Edge Functions (Deno / TypeScript), PostgreSQL Functions & Triggers
- **Hosting & CI/CD**: GitHub Pages CDN, GitHub Actions Automated Workflows
- **Production URL**: `https://abzops.github.io/sns-projects/`
- **Supabase Project Reference**: `gqerfixdmgbqahgslzsq`
- **Current Canonical Migration**: `20260817122020_p2_01a_phase_grant_hardening.sql`
- **Package 1 Status**: `VERIFIED` (Production Parity + Real Local PostgreSQL E2E 34-Test Lifecycle Suite + Trigger Security Closure)
- **Package 2 Status**: `P2-01 & P2-01A VERIFIED` (Controlled Milestone $\to$ Phase Rename + Phase Grant Hardening + Browser Acceptance)

> [!IMPORTANT]
> **Zero Secrets Policy**: Committing secrets, service keys, private tokens, or user passwords to documentation or source code is strictly prohibited.

---

## 3. Master Documentation Precedence Order

When consulting documentation, the following hierarchy of authority applies:
1. **[Documentation Standard](00_Governance/DOCUMENTATION_STANDARD.md)**
2. **[Master Decision Register](09_Decision_Records/DECISION_REGISTER.md)**
3. **Domain Decision Records** ([Process ADRs](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md) · [Finance ADRs](09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md))
4. **[Implementation Roadmap](00_Governance/IMPLEMENTATION_ROADMAP.md)**
5. **System Architecture Specs** ([V2 Architecture Blueprint](01_Product_Architecture/SNS_Projects_V2_Architecture_Blueprint.md) · [Finance Architecture Spec](05_Finance/FINANCE_ARCHITECTURE_SPEC.md))
6. **Implementation Package Reports** (`06_Implementation_Packages/`)
7. **Historical Release Notes** (`10_Release_Notes/`)
8. **Archive** (`99_Archive/`)

---

## 4. Documentation Map

| Category | Description | Primary Reference |
| :--- | :--- | :--- |
| **`00_Governance`** | Documentation standards, roadmaps, implementation workflow | [Documentation Standard](00_Governance/DOCUMENTATION_STANDARD.md) · [Implementation Roadmap](00_Governance/IMPLEMENTATION_ROADMAP.md) |
| **`01_Product_Architecture`** | Target architecture blueprints and system audit reports | [Architecture Blueprint](01_Product_Architecture/SNS_Projects_V2_Architecture_Blueprint.md) · [Current State Audit](01_Product_Architecture/SNS_Projects_Current_State_Audit.md) |
| **`02_Database_and_Data_Architecture`** | Database schema designs, hierarchy alignment, migration chains | [Hierarchy Alignment](02_Database_and_Data_Architecture/Day0_Release2_5_Hierarchy_Alignment.md) · [Migration History](02_Database_and_Data_Architecture/Migration_History_Reconciliation.md) |
| **`03_Security_and_Authentication`** | RLS security policies, role hierarchies, user onboarding | [Security Hardening](03_Security_and_Authentication/Day0_Release1_1_Security_Hardening.md) · [Org Admin & Auth](03_Security_and_Authentication/V1_01_Organization_Admin_and_Auth.md) |
| **`04_Defined_Processes`** | Defined Process Engine, DAG step execution, RACI contracts | [Engine Architecture Plan](04_Defined_Processes/Defined_Process_Engine_Architecture_Plan.md) · [Runtime API Contract](04_Defined_Processes/Defined_Process_Runtime_API_Contract.md) |
| **`05_Finance`** | Financial tracking, Base Budget + Safety Buffer model, Expense Ledgers | [Finance Architecture Spec](05_Finance/FINANCE_ARCHITECTURE_SPEC.md) · [Finance Decision Register](09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md) |
| **`06_Implementation_Packages`** | Technical specifications for discrete engineering delivery packages | [P1-01 Foundation](06_Implementation_Packages/Package_01_Core_Foundation/P1-01_Core_Hierarchy_Process_Instance_Foundation.md) · [P1-01A Hardening](06_Implementation_Packages/Package_01_Core_Foundation/P1-01A_Process_Instance_Access_Hardening.md) · [P1-01B Accuracy](06_Implementation_Packages/Package_01_Core_Foundation/P1-01B_Documentation_Accuracy_and_Architecture_Baseline.md) · [P1-02 Runtime](06_Implementation_Packages/Package_01_Core_Foundation/P1-02_Placement_Aware_Process_Runtime_Engine.md) · [P1-02D Parity](06_Implementation_Packages/Package_01_Core_Foundation/P1-02D_Process_Instance_Provenance_and_Schema_Parity.md) · [P1-02E Trigger Security](06_Implementation_Packages/Package_01_Core_Foundation/P1-02E_Legacy_Version_Trigger_Security_Closure.md) · [P2-01 Phase Rename](06_Implementation_Packages/Package_02_Process_Runtime/P2-01_Controlled_Milestone_to_Phase_Rename.md) · [P2-01A Phase Grant Hardening](06_Implementation_Packages/Package_02_Process_Runtime/P2-01A_Phase_Grant_Hardening_and_Browser_Acceptance.md) |
| **`07_Testing_and_QA`** | Verification suites, static contract validation, safety harnesses | [Testing Directory](07_Testing_and_QA/) |
| **`08_Deployment_and_Operations`** | Data seed operations, migrations deployment, backup runs | [Structured Reseed Report](08_Deployment_and_Operations/Structured_Data_Reseed_Report.md) |
| **`09_Decision_Records`** | Authoritative Architecture Decision Records (ADRs) | [Master Decision Register](09_Decision_Records/DECISION_REGISTER.md) · [Process Decisions](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md) · [Finance Decisions](09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md) |
| **`10_Release_Notes`** | Production release notes, changelogs, and hotfix reports | [Day-0 Release Notes](10_Release_Notes/Day0_Release1_Production_MVP.md) · [Hotfix Reports](10_Release_Notes/) |
| **`99_Archive`** | Historical or superseded project documentation | [Archive Directory](99_Archive/) |

---

## 5. Current Implementation Status

| Package | Scope | Status | Canonical Reference |
| :--- | :--- | :--- | :--- |
| **Package 1: Core Foundation** | `P1-01` Core Hierarchy & Process Instance Foundation | **`VERIFIED`** | Migration `20260817063502` |
| | `P1-01A` Process Instance Access Hardening | **`VERIFIED`** | Migration `20260817064609` |
| | `P1-01B` Documentation Accuracy & Authoritative Baseline | **`VERIFIED`** | Commit `64fd803` + Current Baseline |
| | `P1-02` Placement-Aware Process Runtime Engine | **`VERIFIED`** | Migration `20260817070924` · [P1-02 Spec](06_Implementation_Packages/Package_01_Core_Foundation/P1-02_Placement_Aware_Process_Runtime_Engine.md) |
| | `P1-02A` Process Runtime Execution, Security & Idempotency Closure | **`VERIFIED`** | Migration `20260817072340` · [P1-02A Spec](06_Implementation_Packages/Package_01_Core_Foundation/P1-02A_Process_Runtime_Execution_and_Security_Closure.md) |
| | `P1-02B` Production Deployment & Real Database E2E Verification | **`VERIFIED`** | [P1-02B Spec](06_Implementation_Packages/Package_01_Core_Foundation/P1-02B_Production_Deployment_and_E2E_Verification.md) |
| | `P1-02C` Workflow RPC Security, Search Path & Real E2E Closure | **`VERIFIED`** | Migration `20260817091154` · [P1-02C Spec](06_Implementation_Packages/Package_01_Core_Foundation/P1-02C_Workflow_RPC_Security_and_Real_E2E_Closure.md) |
| | `P1-02D` Process Instance Provenance & Schema Parity Final Closure | **`VERIFIED`** | Migration `20260817111751` · [P1-02D Spec](06_Implementation_Packages/Package_01_Core_Foundation/P1-02D_Process_Instance_Provenance_and_Schema_Parity.md) |
| | `P1-02E` Legacy Version Trigger Security Closure | **`VERIFIED`** | Migration `20260817113427` · [P1-02E Spec](06_Implementation_Packages/Package_01_Core_Foundation/P1-02E_Legacy_Version_Trigger_Security_Closure.md) |
| **Package 2: Process Runtime** | Multi-instance execution, step RACI, DAG lifecycle | **`PLANNED`** | Upcoming Package 2 |
| **Package 3: Hierarchy UI** | Milestone $\to$ Phase cutover, nested task UI | **`PLANNED`** | Upcoming Package 3 |
| **Package 4: Finance DB** | Base Budgets, Safety Buffers, Expense Ledger, RLS | **`PLANNED`** | Upcoming Package 4 |
| **Package 5: Expense Execution** | Atomic completion intercept, split expenses, audit | **`PLANNED`** | Upcoming Package 5 |
| **Package 6: Finance Frontend** | Overview, Financial Explorer, Alert Center UI | **`PLANNED`** | Upcoming Package 6 |
| **Package 7: Financial Hierarchy**| Compact financial utilization bars, hover summaries | **`PLANNED`** | Upcoming Package 7 |
| **Package 8: Regression & Excel** | Defined Process Excel import, Day-N certification | **`PLANNED`** | Upcoming Package 8 |

---

## 6. Key Authoritative Decisions & Open Items

- **[Decision 1–4, 26–44](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: 5-Level Work Hierarchy, Temporary Phase Compatibility, Full Tasks as Process Steps, Single Process Due Date, Intra-Project Movement.
- **[Decision 32 (PARKED)](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md#decision-32--overall-process-business-status-model--parked)**: Overall Process Business Status Model is **PARKED** (Technical states `running`, `completed`, `cancelled` only).
- **[Decision 33 & 42](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: Contractual Due Dates on Process Instance only (`process_instances.due_date`); step tasks receive `due_date = NULL`.
- **[Decision 38](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: Standalone Process Visibility is restricted to Starter, Owner, RACI Assignees, and Workspace Executives (Admin/CEO/CTO).
- **[Decision 5–25, 45–70](09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md)**: Base Budget + Safety Buffer Model, Deterministic Risk Bands (`GREEN`, `YELLOW`, `ORANGE`, `RED`), No Task Budgets, No Financial Double Counting, Finance Operator Role, Sibling Reallocation, Expense Voids/Tombstones.
- **Explicit Scope Boundaries**: ERP/Accounting modules (Cost Centers, GL accounts, Purchase Orders, AP/AR, Invoice Management) are strictly excluded from V1.

---

## 7. Latest Verified Production State

- **Database Migration Chain**: 20 canonical migrations verified in strict sequential order.
- **Process Instance Security Model**:
  - `PUBLIC`: Zero direct privileges (`REVOKE ALL`).
  - `anon`: Zero direct privileges (`REVOKE ALL`).
  - `authenticated`: Selective `SELECT` via `process_instances_select_policy` (`private.can_read_process_instance`), zero direct client DML (`REVOKE INSERT, UPDATE, DELETE`).
  - `service_role`: Dedicated backend execution role for trusted RPC operations.
  - `postgres`: Superuser / Administrative Owner.
  - **RLS State**: Enabled on `public.process_instances` with selective read policy and fail-closed direct mutations.
