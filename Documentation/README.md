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
- **Current Canonical Migration**: `20260822152000_p6_05r1_finance_alert_runtime_security_closure.sql`
- **Current Frontend Baseline**: `ff3a3bb9a8636eb0efb334404711f6ccf53b32e8`
- **Package 1 Status**: `VERIFIED` (Production Parity + Real Local PostgreSQL E2E 34-Test Lifecycle Suite + Trigger Security Closure)
- **Package 2 Status**: `P2-01, P2-01A, P2-02, P2-02A, P2-03 VERIFIED` (Parent Completion and Runtime Closure deployed and verified)
- **Package 3 Status**: **`COMPLETE / VERIFIED`** (`P3-01` and `P3-02` verified; manual signed-in production acceptance passed)
- **Operational V1 Certification**: **`OPERATIONAL V1 — STABLE / VERIFIED`** ([Certification Evidence](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md))
- **Operational V1 Access Closure**: **`OV1-A VERIFIED`** ([Security Closure](03_Security_and_Authentication/OV1-A_Operational_Visibility_Access_Closure.md))
- **Operational V1 Frontend Visibility**: **`OV1-B VERIFIED`** ([Certification Evidence](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md))
- **Operational V1 Role-Aware Dashboards**: **`OV1-C VERIFIED`** ([Certification Evidence](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md))
- **Operational V1 Stability & Acceptance**: **`OV1-D VERIFIED`** ([Certification Evidence](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md))
- **Package 4 Status**: **`P4-01 / P4-01A / P4-01B VERIFIED`** ([Finance Foundation](06_Implementation_Packages/Package_04_Finance_DB_Foundation/P4-01_Finance_Database_Foundation.md))
- **Package 5 Status**: **`COMPLETE / VERIFIED / FROZEN`** (`P5-01`..`C` VERIFIED · `P5-02`..`C` VERIFIED · `P5-03`..`C` [Subtask Completion & Closure](06_Implementation_Packages/Package_05_Expense_Execution/P5-03_Subtask_Completion_Expense_Parent_Closure.md) VERIFIED · Manual production acceptance PASSED · Frontend baseline `47d17ce`)
- **Package 6 Status**: **`IN PROGRESS`** (`P6-01 / P6-01A` [Finance Overview / Dashboard](06_Implementation_Packages/Package_06_Finance_Frontend/P6-01_Finance_Overview_Dashboard.md) VERIFIED / FROZEN · `P6-02 / P6-02A` [Budget Configuration UI](06_Implementation_Packages/Package_06_Finance_Frontend/P6-02_Budget_Configuration_UI.md) VERIFIED / FROZEN · `P6-03 / P6-03A` [Expense Ledger & Administration](06_Implementation_Packages/Package_06_Finance_Frontend/P6-03_Expense_Ledger_and_Administration.md) VERIFIED / FROZEN · `P6-04 / P6-04A / P6-04B` [Financial Explorer Core](06_Implementation_Packages/Package_06_Finance_Frontend/P6-04_Financial_Explorer_Core.md) VERIFIED / FROZEN · `P6-04C / P6-04C1` [Persistent Financial Explorer Saved Views](06_Implementation_Packages/Package_06_Finance_Frontend/P6-04C_Persistent_Financial_Explorer_Saved_Views.md) VERIFIED / FROZEN · `P6-05 / P6-05R1` [Finance Alert Runtime & Persistent Backend](06_Implementation_Packages/Package_06_Finance_Frontend/P6-05_Finance_Alert_Runtime.md) VERIFIED / FROZEN · `P6-05A / P6-05A1 / P6-05A2 / P6-05A3 / P6-05A4` [Finance Alert Center Frontend](06_Implementation_Packages/Package_06_Finance_Frontend/P6-05A_Finance_Alert_Center_Frontend.md) IMPLEMENTED / MANUAL ACCEPTANCE PENDING)

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
| **`03_Security_and_Authentication`** | RLS security policies, role hierarchies, user onboarding | [Security Hardening](03_Security_and_Authentication/Day0_Release1_1_Security_Hardening.md) · [Org Admin & Auth](03_Security_and_Authentication/V1_01_Organization_Admin_and_Auth.md) · [OV1-A Access Closure](03_Security_and_Authentication/OV1-A_Operational_Visibility_Access_Closure.md) |
| **`04_Defined_Processes`** | Defined Process Engine, DAG step execution, RACI contracts | [Engine Architecture Plan](04_Defined_Processes/Defined_Process_Engine_Architecture_Plan.md) · [Runtime API Contract](04_Defined_Processes/Defined_Process_Runtime_API_Contract.md) |
| **`05_Finance`** | Financial tracking, Base Budget + Safety Buffer model, Expense Ledgers | [Finance Architecture Spec](05_Finance/FINANCE_ARCHITECTURE_SPEC.md) · [Finance Decision Register](09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md) |
| **`06_Implementation_Packages`** | Technical specifications for discrete engineering delivery packages | [P1-01 Foundation](06_Implementation_Packages/Package_01_Core_Foundation/P1-01_Core_Hierarchy_Process_Instance_Foundation.md) · [P1-01A Hardening](06_Implementation_Packages/Package_01_Core_Foundation/P1-01A_Process_Instance_Access_Hardening.md) · [P1-01B Accuracy](06_Implementation_Packages/Package_01_Core_Foundation/P1-01B_Documentation_Accuracy_and_Architecture_Baseline.md) · [P1-02 Runtime](06_Implementation_Packages/Package_01_Core_Foundation/P1-02_Placement_Aware_Process_Runtime_Engine.md) · [P1-02D Parity](06_Implementation_Packages/Package_01_Core_Foundation/P1-02D_Process_Instance_Provenance_and_Schema_Parity.md) · [P1-02E Trigger Security](06_Implementation_Packages/Package_01_Core_Foundation/P1-02E_Legacy_Version_Trigger_Security_Closure.md) · [P2-01 Phase Rename](06_Implementation_Packages/Package_02_Process_Runtime/P2-01_Controlled_Milestone_to_Phase_Rename.md) · [P2-01A Phase Grant Hardening](06_Implementation_Packages/Package_02_Process_Runtime/P2-01A_Phase_Grant_Hardening_and_Browser_Acceptance.md) · [P2-02 Movement & Cancellation](06_Implementation_Packages/Package_02_Process_Runtime/P2-02_Process_Instance_Movement_Cancellation_Authorization.md) · [P2-02A Immutability Closure](06_Implementation_Packages/Package_02_Process_Runtime/P2-02A_Post_Cancellation_Immutability_Closure.md) · [P2-03 Parent Completion](06_Implementation_Packages/Package_02_Process_Runtime/P2-03_Parent_Task_Completion_and_Runtime_Closure.md) · [P3-01 Operational Hierarchy](06_Implementation_Packages/Package_03_Hierarchy_UI/P3-01_Operational_Hierarchy_UI_Cutover.md) · [P3-02 Subtask Hierarchy](06_Implementation_Packages/Package_03_Hierarchy_UI/P3-02_Subtask_Hierarchy_and_Operational_Closure.md) · [P4-01 Finance Foundation](06_Implementation_Packages/Package_04_Finance_DB_Foundation/P4-01_Finance_Database_Foundation.md) · [P5-01 Expense Runtime](06_Implementation_Packages/Package_05_Expense_Execution/P5-01_Expense_Execution_Runtime.md) · [P5-02 Expense Frontend](06_Implementation_Packages/Package_05_Expense_Execution/P5-02_Expense_Execution_Frontend.md) · [P5-03 Subtask Completion](06_Implementation_Packages/Package_05_Expense_Execution/P5-03_Subtask_Completion_Expense_Parent_Closure.md) · [P6-01 Finance Overview](06_Implementation_Packages/Package_06_Finance_Frontend/P6-01_Finance_Overview_Dashboard.md) |
| **`07_Testing_and_QA`** | Verification suites, static contract validation, safety harnesses | [Operational V1 Stability Certification](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md) · [Testing Directory](07_Testing_and_QA/) |
| **`08_Deployment_and_Operations`** | Data seed operations, migrations deployment, backup runs | [Structured Reseed Report](08_Deployment_and_Operations/Structured_Data_Reseed_Report.md) |
| **`09_Decision_Records`** | Authoritative Architecture Decision Records (ADRs) | [Master Decision Register](09_Decision_Records/DECISION_REGISTER.md) · [Process Decisions](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md) · [Finance Decisions](09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md) |
| **`10_Release_Notes`** | Production release notes, changelogs, and hotfix reports | [Operational V1 Release](10_Release_Notes/Operational_V1_Production_Release.md) · [Day-0 Release Notes](10_Release_Notes/Day0_Release1_Production_MVP.md) · [Hotfix Reports](10_Release_Notes/) |
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
| **Package 2: Process Runtime** | `P2-01` Controlled Milestone → Phase Rename | **`VERIFIED`** | Migration `20260817115837` · [P2-01 Spec](06_Implementation_Packages/Package_02_Process_Runtime/P2-01_Controlled_Milestone_to_Phase_Rename.md) |
| | `P2-01A` Phase Grant Hardening & Browser Acceptance | **`VERIFIED`** | Migration `20260817122020` · [P2-01A Spec](06_Implementation_Packages/Package_02_Process_Runtime/P2-01A_Phase_Grant_Hardening_and_Browser_Acceptance.md) |
| | `P2-02` Process Movement, Cancellation, Authorization & Audit | **`VERIFIED`** | Migration `20260817123556` · [P2-02 Spec](06_Implementation_Packages/Package_02_Process_Runtime/P2-02_Process_Instance_Movement_Cancellation_Authorization.md) |
| | `P2-02A` Post-Cancellation Immutability Final Closure | **`VERIFIED`** | Migration `20260817132234` · [P2-02A Spec](06_Implementation_Packages/Package_02_Process_Runtime/P2-02A_Post_Cancellation_Immutability_Closure.md) |
| | `P2-03` Parent Task Completion & Runtime Closure | **`VERIFIED`** | Migration `20260817142153` · [P2-03 Spec](06_Implementation_Packages/Package_02_Process_Runtime/P2-03_Parent_Task_Completion_and_Runtime_Closure.md) |
| **Package 3: Hierarchy UI** | `P3-01` Operational Hierarchy UI Cutover | **`VERIFIED`** | [P3-01 Spec](06_Implementation_Packages/Package_03_Hierarchy_UI/P3-01_Operational_Hierarchy_UI_Cutover.md) — manual signed-in production acceptance passed |
| | `P3-02` Subtask Hierarchy and Operational Closure | **`VERIFIED`** | [P3-02 Spec](06_Implementation_Packages/Package_03_Hierarchy_UI/P3-02_Subtask_Hierarchy_and_Operational_Closure.md) — Package 3 complete and verified |
| **Operational V1** | `OV1-A` Server-Enforced Operational Visibility | **`VERIFIED`** | Ownership/bootstrap hotfix `20260818120101` · [OV1-A Security Closure](03_Security_and_Authentication/OV1-A_Operational_Visibility_Access_Closure.md) |
| | `OV1-B` Frontend Visibility Alignment | **`VERIFIED`** | Frontend commit `c176835` · [Certification](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md) |
| | `OV1-C` Role-Aware Dashboard Engine | **`VERIFIED`** | Frontend tip `e518350` · [Certification](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md) |
| | `OV1-D` Operational V1 Final Production Acceptance & Stability Closure | **`VERIFIED`** | Frontend commit `0bd418d` · deployment run `32150807393` · [Certification](07_Testing_and_QA/SNS_Projects_Operational_V1_Stability_Certification.md) |
| **Package 4: Finance DB Foundation** | `P4-01 / P4-01A / P4-01B` Budgets, Buffers, Risk Engine, Ledgers & Active Tenancy | **`VERIFIED`** | Migrations `20260819070817`..`20260820174313` · [P4-01 Spec](06_Implementation_Packages/Package_04_Finance_DB_Foundation/P4-01_Finance_Database_Foundation.md) |
| **Package 5: Expense Execution** | `P5-01..C` Runtime & `P5-02..C` Frontend Completion & `P5-03..C` Subtask Closure | **`COMPLETE / VERIFIED / FROZEN`** | Migrations `20260819131603`..`20260820082034` · Frontend `47d17ce` · [P5-01 Spec](06_Implementation_Packages/Package_05_Expense_Execution/P5-01_Expense_Execution_Runtime.md) · [P5-02 Spec](06_Implementation_Packages/Package_05_Expense_Execution/P5-02_Expense_Execution_Frontend.md) · [P5-03 Spec](06_Implementation_Packages/Package_05_Expense_Execution/P5-03_Subtask_Completion_Expense_Parent_Closure.md) · All suites passed · Manual production acceptance PASSED |
| **Package 6: Finance Frontend** | `P6-01 / P6-01A` Workspace Finance Overview / Dashboard | **`VERIFIED / FROZEN`** | [P6-01 Spec](06_Implementation_Packages/Package_06_Finance_Frontend/P6-01_Finance_Overview_Dashboard.md) · Frontend baseline `2bf3fd1` · All 34 assertions passed · Manual acceptance PASSED |
| | `P6-02 / P6-02A` Central Budget Configuration UI | **`VERIFIED / FROZEN`** | [P6-02 Spec](06_Implementation_Packages/Package_06_Finance_Frontend/P6-02_Budget_Configuration_UI.md) · Route `/finance/budgets` · Project/Phase/Task List budgets · All 46 assertions passed · Manual acceptance PASSED |
| | `P6-03 / P6-03A` Expense Ledger & Correction / Void Administration | **`VERIFIED / FROZEN`** | [P6-03 Spec](06_Implementation_Packages/Package_06_Finance_Frontend/P6-03_Expense_Ledger_and_Administration.md) · Route `/finance/expenses` · Correction, Void, Hard Delete & Audit Tombstones · All 42 assertions passed · Manual acceptance PASSED · Baseline `b94cae6` |
| | `P6-04 / P6-04A / P6-04B` Financial Explorer Core & Metadata Authorization Closure | **`VERIFIED / FROZEN`** | [P6-04 Spec](06_Implementation_Packages/Package_06_Finance_Frontend/P6-04_Financial_Explorer_Core.md) · Route `/finance/explorer` · Multi-dimensional drill-down, cascading filters, zero double-counting, P6-04A semantic hardening, P6-04B metadata authorization RPC `get_workspace_finance_explorer_metadata` · Migration `20260822114456` · Baseline `8b37e18` · All 60 assertions passed · Manual acceptance PASSED |
| | `P6-04C / P6-04C1` Persistent Financial Explorer Saved Views | **`VERIFIED / FROZEN`** | [P6-04C Spec](06_Implementation_Packages/Package_06_Finance_Frontend/P6-04C_Persistent_Financial_Explorer_Saved_Views.md) · Authenticated personal Saved Views CRUD under RLS · Schema version 1, cascading reference sanitization, unsaved change indicators, runtime scope isolation & grant hardening · Migration `20260822140004` · Baseline `ff3a3bb` · All 50 assertions passed · Manual acceptance PASSED |
| | `P6-05 / P6-05R1` Finance Alert Runtime & Persistent Backend | **`VERIFIED / FROZEN`** | [P6-05 Spec](06_Implementation_Packages/Package_06_Finance_Frontend/P6-05_Finance_Alert_Runtime.md) · Persistent alert incidents (`public.finance_alerts`), private risk state, private notification events tracking, automated CEO/CTO high-risk notifications, partial unique active incidents, Open->Acknowledged->Resolved lifecycle, deferred triggers, private function execution closure · Migrations `20260822144843` & `20260822152000` · Baseline `7b317a9` · All 40 assertions passed |
| | `P6-05A / P6-05A1 / P6-05A2` Finance Alert Center Frontend & Runtime Closure | **`IMPLEMENTED / MANUAL ACCEPTANCE PENDING`** | [P6-05A Spec](06_Implementation_Packages/Package_06_Finance_Frontend/P6-05A_Finance_Alert_Center_Frontend.md) · Route `/finance/alerts` · Persistent alert incident monitoring, KPI strip, multi-attribute filter toolbar, responsive table/cards, non-blocking operational governance banner, URL deep-linking (`?alert=<uuid>`), Realtime sync, operational acknowledgment, controlled resolution flow, live modal convergence, per-alert synchronous mutex (`pendingAlertActionsRef`), in-flight scope isolation (`activeScopeRef`), and refresh failure UX · All 33 assertions passed · Regression gate passed |
| **Package 7: Financial Hierarchy**| Compact financial utilization bars, hover summaries | **`PLANNED`** | Upcoming Package 7 |
| **Package 8: Regression & Excel** | Defined Process Excel import, Day-N certification | **`PLANNED`** | Upcoming Package 8 |

---

## 6. Key Authoritative Decisions & Open Items

- **[Decision 1–4, 26–44](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: 5-Level Work Hierarchy, Temporary Phase Compatibility, Full Tasks as Process Steps, Single Process Due Date, Intra-Project Movement.
- **[Decision 32 (PARKED)](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md#decision-32--overall-process-business-status-model--parked)**: Overall Process Business Status Model is **PARKED** (Technical states `running`, `completed`, `cancelled` only).
- **[Decision 33 & 42](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: Contractual Due Dates on Process Instance only (`process_instances.due_date`); step tasks receive `due_date = NULL`.
- **[Decision 38](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: Standalone Process Visibility is restricted to Starter, Process Owner, RACI participants, and the four broad System Roles.
- **[Decision 71](09_Decision_Records/PROCESS_ARCHITECTURE_DECISIONS.md)**: Broad operational visibility is System-Role based; workspace-only roles receive involved work plus minimum ancestor context.
- **[Decision 5–25, 45–70](09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md)**: Base Budget + Safety Buffer Model, Deterministic Risk Bands (`GREEN`, `YELLOW`, `ORANGE`, `RED`), No Task Budgets, No Financial Double Counting, Finance Operator Role, Sibling Reallocation, Expense Voids/Tombstones.
- **Explicit Scope Boundaries**: ERP/Accounting modules (Cost Centers, GL accounts, Purchase Orders, AP/AR, Invoice Management) are strictly excluded from V1.

---

## 7. Latest Verified Production State

- **Production Database Migration Chain**: 31 canonical migrations verified in strict sequential order; current tip `20260818120101`.
- **Process Instance Security Model**:
  - `PUBLIC`: Zero direct privileges (`REVOKE ALL`).
  - `anon`: Zero direct privileges (`REVOKE ALL`).
  - `authenticated`: Selective `SELECT` via `process_instances_select_policy` (`private.can_view_operational_process_instance`), zero direct client DML (`REVOKE INSERT, UPDATE, DELETE`).
  - `service_role`: Dedicated backend execution role for trusted RPC operations.
  - `postgres`: Superuser / Administrative Owner.
  - **RLS State**: Enabled on `public.process_instances` with selective read policy and fail-closed direct mutations.
