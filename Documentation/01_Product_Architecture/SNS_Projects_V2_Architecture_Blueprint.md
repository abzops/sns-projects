# SNS Projects V2 — Target Architecture Blueprint

**Document Version:** 2.0.0-PROPOSAL  
**Author:** Principal System Architect  
**Target Repository:** `stacknstock-projects`  
**Deployment Target:** GitHub Pages (`dist/`) + Supabase Managed PostgreSQL & Auth  
**Core Directive:** Upgrade the existing StacknStock Projects application in place into an enterprise-grade, RACI-governed, department-aware engineering & operations command center (**SNS Projects V2**).

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Current-to-Target Architecture Map](#2-current-to-target-architecture-map)
3. [Final Information Hierarchy](#3-final-information-hierarchy)
4. [User Identity and Access Model](#4-user-identity-and-access-model)
5. [System Roles](#5-system-roles)
6. [Department Model](#6-department-model)
7. [Project Membership Model](#7-project-membership-model)
8. [Project and Workstream Model](#8-project-and-workstream-model)
9. [RACI Model](#9-raci-model)
10. [Task Workflow State Machine](#10-task-workflow-state-machine)
11. [Approval Workflow](#11-approval-workflow)
12. [Task Dependency Algorithm](#12-task-dependency-algorithm)
13. [Milestone and Stage-Gate Model](#13-milestone-and-stage-gate-model)
14. [Activity and Audit Event Model](#14-activity-and-audit-event-model)
15. [Notification Architecture](#15-notification-architecture)
16. [CEO Dashboard Information Model](#16-ceo-dashboard-information-model)
17. [CTO Dashboard Information Model](#17-cto-dashboard-information-model)
18. [Project Administrator Dashboard Information Model](#18-project-administrator-dashboard-information-model)
19. [Employee / My Work Information Model](#19-employee--my-work-information-model)
20. [Department Workspace Information Model](#20-department-workspace-information-model)
21. [Proposed Logical Database Entities](#21-proposed-logical-database-entities)
22. [Important Constraints and Uniqueness Rules](#22-important-constraints-and-uniqueness-rules)
23. [Access-Control and RLS Matrix](#23-access-control-and-rls-matrix)
24. [Proposed Application Routes](#24-proposed-application-routes)
25. [Proposed Navigation Structure](#25-proposed-navigation-structure)
26. [Existing Component Reuse Map](#26-existing-component-reuse-map)
27. [Existing Table Migration Map](#27-existing-table-migration-map)
28. [Legacy Data Staging Strategy](#28-legacy-data-staging-strategy)
29. [Implementation Phases](#29-implementation-phases)
30. [Risk Register](#30-risk-register)
31. [Testing Strategy](#31-testing-strategy)
32. [Definition of Done](#32-definition-of-done)
33. [Acceptance Criteria](#33-acceptance-criteria)
34. [Files Expected to Change During Each Future Phase](#34-files-expected-to-change-during-each-future-phase)
35. [Remaining Questions That Truly Require Business Input](#35-remaining-questions-that-truly-require-business-input)

---

## 1. Executive Summary

SNS Projects V1 established a functional, beautifully branded dark-mode foundation with Supabase authentication, basic multi-workspace containers, and drag-and-drop Kanban task management. However, V1 treats all projects as isolated silos, lacks organizational hierarchy, models task ownership with a single assignee, and contains zero governance, approval, dependency, or executive intelligence capabilities.

**SNS Projects V2** evolves this foundation into a unified, **multi-departmental project execution engine** designed specifically for StacknStock's hardware (ASRS/Darkstore), software (WMS/OMS/Control Tower), supply chain, commercial, and operational rollout.

### Core Architectural Directives:
- **In-Place Evolution:** No blank-slate rewrites. Retain the proven React 19 + Vite + Supabase + `@dnd-kit` + GitHub Actions CI/CD stack.
- **Tenant Boundary:** The `workspace` remains the top-level organization tenant.
- **Organizational Structure:** `departments` sit under the workspace. "Department Workspaces" are role-aware, filtered functional views over the master project portfolio rather than isolated database silos.
- **Unified Master Project:** Cross-functional hardware/software operations run across interconnected `workstreams`, `project_phases`, and controlled `stage_gates`.
- **Decoupled Identity & Roles:** Distinct layers for System Roles (CEO, CTO, Admin), Department Memberships (with designated Heads), Project Memberships, and Task RACI Assignments (Responsible, Accountable, Consulted, Informed).
- **Strict Database-Enforced Governance:** Workflow legality (e.g., stage gate clearances, approval requirements before task completion) is enforced in PostgreSQL via validated RPC transactions and Row Level Security (RLS), not merely in client-side React UI state.
- **Event-First Asynchronous Architecture:** Activity events trigger notification evaluations that feed in-app realtime centers first, with an integration outbox prepared for Zoho Cliq and Zoho Mail.

---

## 2. Current-to-Target Architecture Map

```text
+---------------------------------------------------------------------------------------------------+
|                                  CURRENT ARCHITECTURE (V1)                                        |
+---------------------------------------------------------------------------------------------------+
| [Tenancy]          Workspaces (Isolated Silos)                                                    |
| [Organization]     None (Departmental names hardcoded into separate projects)                     |
| [Project Model]    Flat Projects inside Workspaces                                                |
| [Task Model]       Flat Task List (Single Assignee, 4 Default Kanban Columns)                     |
| [Governance]       None (Any member can move any task to Done at any time)                        |
| [RACI]             None (Single `assignee_id` field)                                              |
| [Executive Views]  None (Only Workspace Card Grid & Project Card Grid)                            |
| [Notifications]    Ephemeral React Toast Popups only                                              |
| [Dependencies]     None                                                                           |
| [Auditability]     None                                                                           |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ (MIGRATION & IN-PLACE UPGRADE)
+---------------------------------------------------------------------------------------------------+
|                                   TARGET ARCHITECTURE (V2)                                        |
+---------------------------------------------------------------------------------------------------+
| [Tenancy]          Organization Workspace (Preserved Tenant Root)                                 |
| [Organization]     Departments (Operations, Software, Mechanical, Supply Chain, Commercial, etc.) |
| [Project Model]    Master Project Portfolio -> Workstreams -> Phases -> Milestones -> Stage Gates |
| [Task Model]       Governed Work Items (Deliverables, RACI, Gate Requirements, System Status Codes)|
| [Governance]       Database-Enforced Approval Engine & Stage-Gate Verification RPCs               |
| [RACI Matrix]      Formal Matrix: R (>=1), A (exactly 1), C (>=0), I (>=0) on Tasks & Workstreams |
| [Executive Views]  Role-Aware Executive Dashboards: CEO Overview, CTO Velocity, Admin, Department |
| [Notifications]    Event-Driven Hub: Activity Event -> Rules Engine -> In-App Realtime + Outbox   |
| [Dependencies]     Directed Acyclic Dependency Graph (DAG) with Critical Path & Blocker Alerts   |
| [Auditability]     Immutable Activity & Audit Event Log with Structured Diff Snapshots            |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Final Information Hierarchy

```text
Organization Workspace (Tenant Root: StacknStock)
  │
  ├── System Roles (CEO, CTO, Project Administrator, System Admin, Member)
  │
  ├── Departments (Operations & Procurement, Software Systems, Mechanical/ASRS, Supply Chain, Finance)
  │     ├── Department Head (User Profile)
  │     └── Department Memberships (User Profiles + Department Roles)
  │
  └── Master Projects / Programs (e.g., "SNS Q-Commerce Fulfillment Network Rollout")
        │
        ├── Project Memberships (User Profiles + Project-Specific Access Levels)
        ├── Project RACI (Department-level Accountabilities)
        │
        ├── Workstreams (Functional Sub-Tracks, e.g., "ASRS Build", "WMS Engine", "Darkstore Ops")
        │     │
        │     ├── Project Phases (Sequential Stages, e.g., "Proto Phase", "Integration", "Pilot")
        │     │     │
        │     │     ├── Stage Gates (Quality Gates controlling phase transitions)
        │     │     │     ├── Gate Criteria & Checklists
        │     │     │     └── Gate Approvals (Signed by CEO / CTO / Project Admin)
        │     │     │
        │     │     └── Milestones (Strategic Checkpoints with Target Dates & Health Status)
        │     │
        │     └── Tasks / Deliverables (Actionable Items)
        │           ├── System Status Code (backlog, in_progress, review, approved, done, blocked)
        │           ├── Task RACI Matrix:
        │           │     ├── Responsible (>= 1 Users / Departments doing work)
        │           │     ├── Accountable (Exactly 1 User owning outcome & sign-off)
        │           │     ├── Consulted (>= 0 Subject Matter Experts)
        │           │     └── Informed (>= 0 Stakeholders receiving updates)
        │           ├── Task Dependencies (blocked_by / blocks relationships)
        │           ├── Approval Requirements (Gated transitions requiring formal sign-off)
        │           ├── Deliverables & Attachments (Linked artifacts in Supabase Storage)
        │           └── Comments & Activity History (Immutable audit trail)
        │
        ├── Risks & Issues Register (Severity, Probability, Mitigation, Owner)
        └── Integration Outbox (Buffered webhooks for Zoho Cliq / Zoho Mail)
```

---

## 4. User Identity and Access Model

Identity is anchored in Supabase GoTrue Auth (`auth.users`) and bridged to `public.profiles`. Permissions are evaluated along four distinct, orthogonal axes:

1. **Tenant Access:** Validated through `workspace_members` (active membership in the workspace).
2. **System Role:** Global capabilities across the workspace (CEO, CTO, Project Administrator, Member).
3. **Department Membership:** Organizational affiliation and departmental oversight (Head of Department vs. Staff).
4. **Project / Task Context:** Explicit RACI assignment on individual tasks and workstreams.

```text
+---------------------------------------------------------------------------------------+
|                                     USER ACCESS EVALUATION                            |
+---------------------------------------------------------------------------------------+
|  Can User U perform Action X on Task T in Project P?                                  |
|                                                                                       |
|  1. Tenant Check: Is U an active member of Workspace W? (If NO -> Deny)               |
|  2. Executive Bypass: Is U a System Admin, CEO, or CTO? (If YES -> Allow)             |
|  3. Project Admin Check: Is U a Project Administrator for Project P? (If YES -> Allow)|
|  4. RACI Execution Check:                                                             |
|       - Action is "Mark Done": Is Task T approval-gated?                              |
|           - If YES: Only the Accountable (A) user or assigned Approver can approve.   |
|           - If NO: Any Responsible (R) or Accountable (A) user can transition.        |
|       - Action is "Edit Description/Details": U is (R), (A), or Dept Head.            |
|       - Action is "Add Comment": U is (R), (A), (C), (I), or Project Member.          |
+---------------------------------------------------------------------------------------+
```

---

## 5. System Roles

System roles are assigned per user within the workspace via `user_system_roles`:

| System Role Code | Role Name | Intended Assignee | Strategic Purpose & System Capabilities |
| :--- | :--- | :--- | :--- |
| `ceo` | Chief Executive Officer | Company CEO | Top-level visibility across all departments; full approval authority on company-wide stage gates, budget overruns, and critical milestones; access to the CEO Executive Command Center. |
| `cto` | Chief Technology Officer | Engineering Head / CTO | Technical authority across Hardware (ASRS) and Software (WMS/ERP) workstreams; sign-off on architecture reviews, technical stage gates, and blocker escalations; access to CTO Velocity Dashboard. |
| `project_admin` | Project Administrator | Program / Delivery Manager | Cross-departmental coordination; planning workstreams, defining milestones, configuring stage gates, managing dependency conflicts, and running portfolio operations. |
| `system_admin` | Workspace Administrator | Operations / IT Admin | Managing workspace settings, tenant members, department master registries, and system integrations. |
| `member` | Team Member (Default) | All Employees & Contractors | Standard execution role; assigned to tasks via RACI; accesses "My Work" and assigned Department Workspace views. |

> **Key Rule (Decision 8):** A user may hold `project_admin` system role while simultaneously being assigned as a normal `member` within the *Mechanical Design* department.

---

## 6. Department Model

Departments represent the permanent organizational structure of StacknStock.

### Department Entities:
- **Identifier & Metadata:** `code` (e.g. `OPS`, `SW`, `MECH`, `SCM`, `COMM`, `FIN`), `name`, `color`, `icon`.
- **Leadership:** `head_user_id` referencing `profiles(id)`. The Department Head has administrative authority over departmental task allocation and milestone sign-offs.
- **Membership:** Users are linked via `department_memberships` (`user_id`, `department_id`, `role: 'head' | 'lead' | 'member'`).
- **UI Projection (Decision 5):** A "Department Workspace" in the UI is **not** an isolated project database. It is a smart, role-aware lens filtering the master project portfolio by the department's RACI involvements, deliverables, and workstreams.

---

## 7. Project Membership Model

While all active workspace users can view public projects, explicit project access and elevated management permissions are tracked via `project_members`:

- **Fields:** `project_id`, `user_id`, `project_role` (`'manager' | 'contributor' | 'observer'`), `created_at`.
- **Capabilities:**
  - `manager`: Can manage workstreams, schedule milestones, and edit project metadata.
  - `contributor`: Default for team members assigned tasks within the project.
  - `observer`: Read-only stakeholder receiving portfolio reports.

---

## 8. Project and Workstream Model

To eliminate the V1 fragmentation where departments were created as disjointed projects, V2 introduces a structured three-tier project execution hierarchy:

```text
Master Project: "SNS Q-Commerce Network 2026"
  │
  ├── Workstream 1: "ASRS Proto & Hardware Build" (Lead Dept: Mechanical / SCM)
  │     ├── Phase 1.1: "Carriage Module Fabrication"
  │     └── Phase 1.2: "Motor & Sensor Integration"
  │
  ├── Workstream 2: "Digital Systems & WMS" (Lead Dept: Software Systems)
  │     ├── Phase 2.1: "ERPNext Master Data & Inbound"
  │     └── Phase 2.2: "Custom WMS Bin Allocation Engine"
  │
  └── Workstream 3: "Darkstore Operations Launch" (Lead Dept: Operations)
        ├── Phase 3.1: "Mother Hub Sourcing & Fitout"
        └── Phase 3.2: "Node Receiving & Picking SOPs"
```

- **Master Project:** Represents the overarching strategic initiative.
- **Workstream (`workstreams`):** Functional tracks owned by lead departments.
- **Phase (`project_phases`):** Chronological stages within a workstream bounded by milestones and stage gates.

---

## 9. RACI Model

V2 strictly implements the RACI governance framework across both project workstreams and individual tasks.

### 1. Matrix Definitions:
- **R — Responsible:** The "Doers". The individuals or departmental units responsible for executing the work to achieve the deliverable.
- **A — Accountable:** The "Owner / Approver". Exactly **one** person who holds final accountability for the correct, thorough completion of the task and has the sole authority to approve or reject the outcome.
- **C — Consulted:** The "Subject Matter Experts". Two-way communication; contributors who provide technical, operational, or commercial input prior to work finalization.
- **I — Informed:** The "Stakeholders". One-way communication; individuals or departments kept updated on progress, milestones, and status changes.

### 2. Assignment Rules & Database Constraints (Decisions 9, 10, 11, 12):
1. **Task-Level Multiplicity:**
   - **Responsible (R):** Must have **at least 1** assignment (user or department).
   - **Accountable (A):** Must have **exactly 1** user assignment per task.
   - **Consulted (C):** Optional, 0 to N users/departments.
   - **Informed (I):** Optional, 0 to N users/departments.
2. **Polymorphic Target:** `task_raci_assignments` supports assigning either a specific `user_id` or an entire `department_id`.
3. **Legacy Data Migration (Decision 12):** When migrating V1 tasks, existing `assignee_id` values are migrated directly as **Responsible (R)** records, while the task's `created_by` or project creator defaults as initial **Accountable (A)** pending audit review.

---

## 10. Task Workflow State Machine

Tasks in V2 transition through a rigorous, database-enforced finite state machine.

### System Status Codes (`system_code`):
Custom user-facing status names in `task_statuses` map directly to immutable internal system codes:
- `backlog`: Defined work not yet active.
- `todo`: Scheduled work ready for pickup.
- `in_progress`: Actively being executed by Responsible parties.
- `in_review`: Execution complete; submitted for sign-off.
- `blocked`: Execution prevented by dependency or missing material.
- `done`: Formally approved and completed.
- `cancelled`: Deprecated or abandoned.

### State Transition Diagram:

```text
                 +-------------+
                 |   BACKLOG   |
                 +-------------+
                        │
                        ▼
                 +-------------+
                 |    TODO     | ◄─────────────────────────┐
                 +-------------+                           │
                        │                                  │
                        ▼                                  │
    ┌──────────► +-------------+ ──────────┐               │
    │            | IN_PROGRESS |           │               │
    │            +-------------+           │               │
    │                   │                  ▼               │
    │                   │          +---------------+       │
    │                   │          |    BLOCKED    |       │
    │                   │          +---------------+       │
    │                   ▼                                  │
    │            +-------------+                           │
    │            |  IN_REVIEW  |                           │
    │            +-------------+                           │
    │             │           │                            │
    │ (Rejected)  │           │ (Approved by Accountable)  │
    └─────────────┘           ▼                            │
                       +-------------+                     │
                       |    DONE     |                     │
                       +-------------+                     │
                              │ (Reopened by Accountable)  │
                              └────────────────────────────┘
```

### Transition Enforcement Rules:
1. **Transition to `in_review`:** Any **Responsible (R)** user can submit a task for review once all required deliverables are linked.
2. **Transition to `done`:**
   - If `approval_required = false`: Any Responsible (R) or Accountable (A) can mark Done.
   - If `approval_required = true`: **Only** the designated **Accountable (A)** user or an approved executive (`ceo`, `cto`, `project_admin`) can approve the transition via RPC `approve_task()`.
3. **Transition to `blocked`:** Prompts for a blocker reason; dispatches immediate alerts to Accountable owner and Project Administrator.

---

## 11. Approval Workflow

Approvals govern critical task completions, budget authorizations, and phase stage gates.

```text
[ Task in IN_PROGRESS ]
       │
       ▼ (Responsible user clicks "Submit for Approval")
[ Create Pending Approval Record in public.approvals ]
       │
       ├── Task status moves to IN_REVIEW
       ├── Notification sent to Accountable (A) User
       └── UI locks task execution fields
              │
              ├──► [ OPTION A: APPROVED ]
              │       ├── Approver submits digital signature / notes
              │       ├── approval.status -> 'approved'
              │       ├── Task status moves to DONE via atomic RPC
              │       └── Notification sent to (R) and (I) stakeholders
              │
              └──► [ OPTION B: REJECTED ]
                      ├── Approver submits rejection reason & required rework
                      ├── approval.status -> 'rejected'
                      ├── Task status moves back to IN_PROGRESS
                      └── High-priority rework notification sent to (R)
```

---

## 12. Task Dependency Algorithm

Task dependencies prevent premature work execution and enable critical path calculations.

### Dependency Types (`dependency_type`):
- `finish_to_start` (FS - Default): Task B cannot start until Task A is `done`.
- `start_to_start` (SS): Task B cannot start until Task A has moved to `in_progress`.
- `finish_to_finish` (FF): Task B cannot complete until Task A is `done`.

### Cycle Detection & Enforcement Algorithm:
1. **Acyclic Verification:** Before inserting into `task_dependencies (predecessor_id, successor_id)`, a PostgreSQL recursive CTE checks for circular loops. If a path from `successor_id` to `predecessor_id` exists, the transaction aborts with `400: Circular Dependency Detected`.
2. **Automated Blocker Resolution:**
   - When Task A moves to `done`, an asynchronous database trigger evaluates all successor tasks.
   - If a successor task was marked `blocked` solely due to Task A, its status is automatically updated to `todo`, and an unblock alert is dispatched to its Responsible team.

---

## 13. Milestone and Stage-Gate Model

To ensure complex multi-department rollouts (such as Darkstore Node deployments or ASRS hardware commissioning) satisfy all quality and safety criteria, projects are structured around formal Stage Gates.

```text
[ Phase 1: Prototype Build ] ────► [ STAGE GATE 1 ] ────► [ Phase 2: Integration ]
                                           │
                                   ┌───────┴───────┐
                                   ▼               ▼
                           [ Gate Criteria ] [ Approvals ]
                           - BOM Verified    - CTO Sign-off
                           - Stress Tested   - Lead SCM Sign-off
                           - QC GRN Logged
```

- **Stage Gate (`stage_gates`):** A formal checkpoint at the end of a project phase.
- **Gate Requirements (`gate_requirements`):** Specific prerequisites (e.g., "100% of P0 Tasks Done", "ISO Compliance Audit Uploaded", "Safety Sign-off Attached").
- **Gate Status:** `locked` -> `in_review` -> `passed` | `rejected`.
- **Phase Blocking:** Tasks in Phase $N+1$ cannot transition to `in_progress` until Stage Gate $N$ status is `passed`.

---

## 14. Activity and Audit Event Model

Every state change, RACI alteration, approval decision, and comment generates an immutable audit record in `activity_events`.

### Event Schema:
- `id`: UUID Primary Key
- `workspace_id`: Tenant boundary
- `project_id`: Project context
- `entity_type`: `'task' | 'project' | 'approval' | 'stage_gate' | 'raci' | 'attachment'`
- `entity_id`: Target entity UUID
- `actor_id`: User UUID performing the action
- `event_type`: e.g. `'task_created'`, `'status_changed'`, `'raci_reassigned'`, `'approval_submitted'`, `'gate_passed'`
- `payload`: JSONB snapshot capturing `{ old_state: {...}, new_state: {...}, diff: {...} }`
- `created_at`: Immutable timestamp

---

## 15. Notification Architecture

Notifications follow an **event-first asynchronous pipeline** (Decision 17 & 18):

```text
[ Database Action / User Event ]
               │
               ▼
[ INSERT INTO public.activity_events ]
               │
               ▼ (PostgreSQL Trigger on activity_events)
[ Evaluate Notification Rules ]
  ├── Rule 1: Task Assigned -> Notify all newly assigned (R) and (A) users
  ├── Rule 2: Approval Requested -> Notify designated Accountable (A) approver
  ├── Rule 3: Task Blocked -> Notify Project Admin & (A) owner
  └── Rule 4: Stage Gate Passed -> Notify all Project Stakeholders (I)
               │
               ▼
[ INSERT INTO public.notifications ] (Target user inboxes)
               │
       ┌───────┴────────────────────────────────────────┐
       ▼ (Immediate - MVP)                              ▼ (Phase 3 & 4)
[ Supabase Realtime Channel ]                 [ INSERT INTO integration_outbox ]
       │                                                │
       ▼                                                ▼
[ In-App Bell Center & Audio Ping ]           [ Edge Function / Webhook Dispatcher ]
                                                ├── Zoho Cliq Channel Message
                                                └── Zoho Mail Alert
```

---

## 16. CEO Dashboard Information Model

The CEO Executive Dashboard provides an aggregated, bird's-eye view of organizational velocity, strategic milestones, and capital deployment across all projects and departments.

```text
+----------------------------------------------------------------------------------------------------+
|                                    CEO EXECUTIVE COMMAND CENTER                                    |
+----------------------------------------------------------------------------------------------------+
| [ KPI CARDS ]                                                                                      |
|  • Active Workstreams: 6       • Overall Network Health: 94% On-Track    • Critical Blockers: 2     |
|  • Milestones Due (30d): 8     • Overdue Deliverables: 3                 • Pending CEO Approvals: 1 |
+----------------------------------------------------------------------------------------------------+
| [ CROSS-DEPARTMENTAL PROGRESS GAUGES ]                                                             |
|  • Mechanical / ASRS Build:   [████████████████░░░░] 78% (Phase 2 - Prototype Commissioning)       |
|  • Software Systems / WMS:    [████████████░░░░░░░░] 62% (Phase 2 - WMS Bin Allocation Engine)     |
|  • Darkstore Ops & Mother Hub:[████████████████████] 100% (Phase 1 - Facility Handover Passed)     |
|  • Supply Chain & Procurement:[██████████████░░░░░░] 70% (ASRS BOM Parts Sourced: 92/100)         |
+----------------------------------------------------------------------------------------------------+
| [ STRATEGIC ROADMAP & STAGE GATE TIMELINE ]                                                        |
|  [Gate 1: Proto ASRS] -> PASSED | [Gate 2: WMS Integration] -> IN REVIEW | [Gate 3: Pilot Launch]  |
+----------------------------------------------------------------------------------------------------+
| [ EXECUTIVE ACTION QUEUE ]                                                                         |
|  • Urgent Sign-Off: Mother Hub Lease Agreement Addendum (Commercial Dept) -> [ Review & Sign ]    |
|  • High Risk Alert: Motor Drive Controller Sourcing Lead-time (+14 days delay) -> [ View Risk ]    |
+----------------------------------------------------------------------------------------------------+
```

---

## 17. CTO Dashboard Information Model

The CTO Dashboard focuses on technical velocity, engineering workstreams, hardware/software integration blockers, and specification readiness.

```text
+----------------------------------------------------------------------------------------------------+
|                                     CTO TECHNICAL VELOCITY HUB                                     |
+----------------------------------------------------------------------------------------------------+
| [ ENGINEERING METRICS ]                                                                            |
|  • ASRS Mechanical Velocity: 24 Tasks/Wk   • Software PRs / Modules Gated: 14                      |
|  • Open Technical Spikes: 3                • System Integration Bugs: 5 (2 Critical)               |
+----------------------------------------------------------------------------------------------------+
| [ TECHNICAL WORKSTREAM HEALTH ]                                                                    |
|  1. ASRS Prototype Mechanical Fabrication:                                                         |
|     - Carriage structure & rails: Complete (QC Passed)                                             |
|     - Drive motor & pulley assembly: In Progress (Blocked on 24V Stepper Delivery)                 |
|  2. Digital Systems Architecture (WMS / ERPNext / OMS / Control Tower):                            |
|     - Brand Onboarding Scorecard & Bin-fit logic: In Review                                        |
|     - Barcode Scan & Tote Dispatch API contracts: In Progress                                      |
+----------------------------------------------------------------------------------------------------+
| [ ARCHITECTURE & GATE APPROVAL PIPELINE ]                                                          |
|  • ASRS Safety Interlock Electrical Schematic -> [ Approve ] [ Request Revision ]                 |
|  • Control Tower Realtime WebSocket Specification -> [ Approve ] [ Request Revision ]              |
+----------------------------------------------------------------------------------------------------+
```

---

## 18. Project Administrator Dashboard Information Model

Designed for the delivery and project managers orchestrating day-to-day work across workstreams:
- **Dependency Bottleneck Detector:** Automatically flags tasks on the critical path whose delays threaten downstream milestones.
- **RACI Allocation Auditor:** Detects unbalanced workloads (e.g., an individual assigned Responsible on 25 active tasks or tasks missing Accountable owners).
- **Stage Gate Readiness Scorecard:** Summary of open gate requirements prior to formal review submission.
- **Overdue Task Escalation Matrix:** Categorized by department and priority.

---

## 19. Employee / "My Work" Information Model

The primary operational hub for every team member:
- **My Tasks (RACI Filtered Tabs):**
  - **I am Responsible (R):** My active action items; filtered by `Todo`, `In Progress`, `In Review`.
  - **I am Accountable (A):** Items I own and must review/approve before completion.
  - **I am Consulted (C):** Tasks awaiting my technical or operational input.
  - **I am Informed (I):** Activity stream of deliverables I track.
- **Today's Priorities:** Ranked by due date and urgency.
- **My Open Approvals:** Direct queue to sign off on deliverables submitted by team members.

---

## 20. Department Workspace Information Model

A Department Workspace is a focused functional portal providing:
- **Department Portfolio View:** All master project workstreams where the department is assigned in RACI.
- **Department Head Summary:** Team member capacity, open task queues, and overdue deliverable counts.
- **Department Deliverables Table:** Categorized by hardware components, software modules, procurement orders, and SOPs.
- **Direct Kanban Board:** Filtered to show only cards relevant to the department's team members.

---

## 21. Proposed Logical Database Entities

Below is the exhaustive specification of all 24 required logical entities.

```text
+----------------------------+------------------------------------------------------------------------------------+
| ENTITY NAME                | SPECIFICATION & ARCHITECTURAL ROLE                                                 |
+----------------------------+------------------------------------------------------------------------------------+
| 1. workspaces              | PRESERVED (Tenant Root). Groups all departments, master projects, and users.       |
| 2. profiles                | PRESERVED. Synchronized user identity, names, avatars, contact details.            |
| 3. user_system_roles       | NEW (MVP). Associates users with global system roles (ceo, cto, project_admin).    |
| 4. departments             | NEW (MVP). Organizational units (Ops, Software, Mech, SCM, Finance) under tenant. |
| 5. department_memberships  | NEW (MVP). User affiliations to departments with roles (head, lead, member).       |
| 6. projects                | ENHANCED (MVP). Master projects/programs with budget, start/end dates, health.     |
| 7. project_members         | NEW (MVP). Granular project access levels (manager, contributor, observer).        |
| 8. workstreams             | NEW (MVP). Cross-functional tracks (ASRS Build, WMS, Darkstore Ops) within project.|
| 9. project_phases          | NEW (MVP). Sequential stages within a workstream.                                  |
| 10. milestones             | NEW (MVP). Target checkpoints with due dates, deliverables, and progress metrics.  |
| 11. stage_gates            | NEW (MVP). Quality & governance gates between project phases.                      |
| 12. gate_requirements     | NEW (MVP). Checklists, metrics, and documents required to pass a stage gate.       |
| 13. task_statuses          | ENHANCED (MVP). Kanban status buckets enhanced with immutable `system_code`.       |
| 14. tasks                  | ENHANCED (MVP). Work items with workstream, phase, milestone, and gate links.     |
| 15. task_raci_assignments  | NEW (MVP). Polymorphic RACI mapping (task_id, role: R/A/C/I, user_id/dept_id).    |
| 16. task_dependencies      | NEW (MVP). Finish-to-Start DAG relationship links with cycle prevention.           |
| 17. task_deliverables      | NEW (MVP). Explicit tangible outputs (drawings, specs, BOM, PRs) linked to tasks.  |
| 18. task_comments          | NEW (MVP). Discussion threads, feedback, and review comments on tasks.             |
| 19. task_attachments       | NEW (MVP). File references stored in Supabase Storage with metadata.               |
| 20. approvals              | NEW (MVP). Formal sign-off records for tasks, budgets, and stage gates.           |
| 21. activity_events        | NEW (MVP). Immutable audit log capturing all mutations with JSONB state diffs.     |
| 22. notifications          | NEW (MVP). Target in-app user notifications generated from activity events.        |
| 23. notification_prefs     | NEW (Phase 2). User notification preferences (in-app, email, Cliq frequency).      |
| 24. integration_outbox     | NEW (Phase 3). Asynchronous queue for external webhook delivery (Zoho Cliq/Mail).  |
| 25. project_risks          | NEW (Phase 2). Risk log (impact, probability, mitigation plan, owner).             |
| 26. project_issues         | NEW (Phase 2). Active impediments, severity, root cause, resolution owner.         |
+----------------------------+------------------------------------------------------------------------------------+
```

### Entity Deep-Dive Table

| Entity Name | Why It Is Needed | Relates To Existing Entity | Release Phase | RLS Enforcement Boundary | Primary UI Module |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `user_system_roles` | Decouple executive/admin privileges from tenancy roles | `profiles`, `workspaces` | MVP (Phase 1) | Workspace Admin only for write; Workspace members for read | Global Auth & Shell |
| `departments` | Model permanent company structure & leadership | `workspaces`, `profiles` | MVP (Phase 1) | Workspace Admin/Head for write; Workspace members for read | Department Workspace & Admin |
| `department_memberships` | Map team members to departments | `departments`, `profiles` | MVP (Phase 1) | Workspace Admin/Head for write; Workspace members for read | Workspace Settings & Dept Views |
| `workstreams` | Group cross-functional execution tracks | `projects`, `departments` | MVP (Phase 1) | Project Managers & Dept Leads for write; Project members read | Project & Portfolio Views |
| `project_phases` | Sequential progression & timeline management | `workstreams` | MVP (Phase 1) | Project Managers for write; Project members for read | Gantt & Milestone Timeline |
| `milestones` | High-level deliverables & executive targets | `projects`, `project_phases` | MVP (Phase 1) | Project Managers for write; Project members for read | CEO/CTO Dashboards & Milestones |
| `stage_gates` | Enforce quality sign-off before phase transitions | `project_phases`, `projects` | MVP (Phase 1) | Project Managers for create; Designated Approvers for sign | Stage Gate Review Panel |
| `gate_requirements` | Concrete checklist items for stage gate clearance | `stage_gates`, `tasks` | MVP (Phase 1) | Project Managers for write; Assigned Approvers for verify | Gate Checklist Modal |
| `task_raci_assignments` | Formal RACI framework governance | `tasks`, `profiles`, `departments` | MVP (Phase 1) | Task Accountable (A) / Project Manager for write | Task Detail Panel & Matrix Grid |
| `task_dependencies` | Critical path scheduling & blocker enforcement | `tasks` | MVP (Phase 1) | Task (A) / Project Manager for write; Members for read | Kanban Board & Dependency Graph |
| `task_deliverables` | Structured output tracking | `tasks` | MVP (Phase 1) | Task (R) / (A) for write; Members for read | Task Detail & Review Drawer |
| `task_comments` | Contextual task discussion & review notes | `tasks`, `profiles` | MVP (Phase 1) | Author for update/delete; Task RACI members for read/create | Task Detail Discussion Feed |
| `task_attachments` | File management in Supabase Storage | `tasks`, `profiles` | MVP (Phase 1) | Author for write; Workspace members for read | Task File Attachment Widget |
| `approvals` | Formal digital sign-offs & auditability | `tasks`, `stage_gates`, `profiles` | MVP (Phase 1) | Designated Approver for sign; Task RACI members read | Approval Queue & Modal |
| `activity_events` | Immutable system audit log & notification trigger | `workspaces`, `projects`, `tasks` | MVP (Phase 1) | System/Trigger write only; Workspace members for read | Activity Feed & Audit Drawer |
| `notifications` | In-app user alerts and task inbox | `profiles`, `activity_events` | MVP (Phase 1) | Target User only for read/update (mark read) | Notification Bell & Drawer |
| `notification_prefs` | User channel filtering preferences | `profiles` | Phase 2 | User only for update/read | User Profile Settings |
| `integration_outbox` | Resilient webhook dispatch to Zoho | `workspaces`, `activity_events` | Phase 3 | Background Worker / Edge Function service role only | Integration Settings |
| `project_risks` | Executive risk register | `projects`, `profiles` | Phase 2 | Project Manager / Executives for write; Members for read | CEO/CTO & Risk Matrix |
| `project_issues` | Active blocker escalation tracking | `projects`, `tasks`, `profiles` | Phase 2 | Project Members for create; Issue Owner for update | Blocker Escalation Board |

---

## 22. Important Constraints and Uniqueness Rules

1. **RACI Task Constraints:**
   - Unique index on `task_raci_assignments(task_id, role, user_id)` WHERE `user_id IS NOT NULL`.
   - Unique index on `task_raci_assignments(task_id, role, department_id)` WHERE `department_id IS NOT NULL`.
   - Partial unique index on `task_raci_assignments(task_id)` WHERE `role = 'accountable'` ensuring **exactly one Accountable owner per task**.
2. **Department Codes:** Unique constraint on `departments(workspace_id, code)` ensuring short codes (`OPS`, `SW`, etc.) are unique per tenant.
3. **Stage Gate Requirements:** Unique index on `gate_requirements(gate_id, title)`.
4. **Task Dependencies:** Check constraint `predecessor_id != successor_id` preventing self-dependencies; unique composite index on `(predecessor_id, successor_id)`.
5. **System Codes:** Check constraint on `task_statuses(system_code)` matching `('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled')`.

---

## 23. Access-Control and RLS Matrix

### Discrepancy Clarification from V1 Audit:
In `SNS_PROJECTS_CURRENT_STATE_AUDIT.md`, Section 7 noted that Workspace Admins could rename workspaces based on UI inputs, while Section 29 cited RLS policy `workspaces_update_owner`.
**Resolution for V2:** The V1 database policy strictly enforced `USING (get_user_workspace_role(id) = 'owner')`, causing Admin renames to fail silently or error. In V2, we explicitly clarify:
- **Workspace Rename / Setting Updates:** Permitted for `owner` and `system_admin` / `admin`.
- **Workspace Deletion:** Exclusively restricted to the tenant `owner`.

### V2 RLS Policy Directives:

```sql
-- 1. Departments: All workspace members can SELECT; Admins & Dept Heads can INSERT/UPDATE
CREATE POLICY "departments_select_member" ON public.departments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = departments.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'));

-- 2. Tasks Approval Guard: Controlled tasks cannot be updated to system_code 'done' without approval record
CREATE POLICY "tasks_update_governance" ON public.tasks
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND get_user_workspace_role(p.workspace_id) IS NOT NULL))
  WITH CHECK (
    -- If moving to done and approval is required, an approved approval record must exist
    (status_id NOT IN (SELECT id FROM public.task_statuses WHERE system_code = 'done'))
    OR (approval_required = false)
    OR (EXISTS (SELECT 1 FROM public.approvals a WHERE a.entity_type = 'task' AND a.entity_id = tasks.id AND a.status = 'approved'))
  );

-- 3. Notifications: Users can only see and mark read their own notifications
CREATE POLICY "notifications_own" ON public.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

---

## 24. Proposed Application Routes

```text
/login                                       -> Public Login Page
/signup                                      -> Public Registration Page

/                                            -> Root Dispatcher (Redirects to /dashboard or /my-work based on role)
/dashboard                                   -> Role-Based Executive Dashboard (CEO / CTO / Project Admin view)
/my-work                                     -> Personal Action Center (RACI filtered tasks & approval queue)

/workspace/:workspaceId                      -> Workspace Portfolio Hub (All projects & workstreams)
/workspace/:workspaceId/department/:deptCode -> Department Workspace (Filtered by Dept RACI & Deliverables)

/workspace/:workspaceId/project/:projectId   -> Master Project Execution Hub
  ├── /overview                              -> Project KPI, Milestone Timeline & Health
  ├── /kanban                                -> Cross-functional Kanban Board
  ├── /list                                  -> RACI Deliverables & Data Table
  ├── /stage-gates                           -> Quality Gates & Phase Approval Panel
  ├── /risks                                 -> Risk & Blocker Matrix
  └── /settings                              -> Project Configuration & Member Access

/workspace/:workspaceId/approvals            -> Centralized Approval Queue (Pending my sign-off)
/workspace/:workspaceId/settings             -> Workspace Administration & Department Registry
```

---

## 25. Proposed Navigation Structure

### Enhanced Sidebar (`src/components/AppLayout.jsx`):
1. **Brand Header:** Official StacknStock horizontal logo with workspace switcher dropdown.
2. **Executive & Personal Section:**
   - **Executive Dashboard** (Visible to CEO, CTO, Project Admins)
   - **My Work** (Personal RACI tasks, due dates, action items)
   - **Approval Queue** (Badge indicator with count of pending sign-offs)
3. **Organizational Departments Navigation:**
   - Expandable "Departments" accordion listing all company units (*Operations*, *Software Systems*, *Mechanical Design*, *Supply Chain*, *Finance*).
4. **Master Projects Navigation:**
   - List of active Master Projects with colored status dots.
5. **Notification Bell Center:**
   - Top-right / sidebar notification trigger with unread badge counter.
6. **Bottom User Profile:**
   - Avatar, full name, active system role badge (`CEO`, `CTO`, `Admin`, `Member`), and Sign Out.

---

## 26. Existing Component Reuse Map

| Existing V1 Component | V2 Reuse Strategy | Enhancements Required |
| :--- | :--- | :--- |
| `src/components/AppLayout.jsx` | **Retained as Shell** | Add Department links, Executive dashboard routes, and Notification Bell. |
| `src/components/Modal.jsx` | **Preserved 100%** | Reuse across Task Creation, Approval Dialogs, and Gate Checklists. |
| `src/components/Toast.jsx` | **Preserved 100%** | Retain for transient client-side UI feedback. |
| `src/components/Avatar.jsx` | **Preserved 100%** | Enhance with Department Badge and RACI role initials overlay. |
| `src/components/StatusBadge.jsx` | **Preserved 100%** | Add system code indicator (`Blocked`, `In Review`, `Done`). |
| `src/components/PriorityIcon.jsx` | **Preserved 100%** | Retain across all list and card views. |
| `src/components/Spinner.jsx` | **Preserved 100%** | Standard loading indicator across all async data panels. |
| `src/components/EmptyState.jsx` | **Preserved 100%** | Reuse in empty departmental queues and approval inboxes. |
| `src/components/TaskCard.jsx` | **Enhanced** | Add RACI avatar stack (R & A), deliverable count, and blocker indicator. |
| `src/components/TaskRow.jsx` | **Enhanced** | Add RACI columns, Stage Gate badge, and quick-action approval button. |
| `src/components/TaskDetailPanel.jsx` | **Major Upgrade** | Add RACI multi-select, Deliverables tab, Approval timeline, Comments feed. |

---

## 27. Existing Table Migration Map

| Existing Table | Action | Migration Details |
| :--- | :--- | :--- |
| `public.profiles` | **Preserved & Extended** | Add `department_id`, `job_title`, `phone_number`. |
| `public.workspaces` | **Preserved** | Retained as organizational tenant root. |
| `public.workspace_members` | **Preserved** | Retained for tenant membership and invite claims. |
| `public.projects` | **Extended** | Add `budget`, `start_date`, `target_end_date`, `health_status`, `is_master_project`. |
| `public.task_statuses` | **Extended** | Add `system_code` column (`backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`). |
| `public.tasks` | **Extended** | Add `workstream_id`, `phase_id`, `milestone_id`, `approval_required`, `estimated_hours`. |

---

## 28. Legacy Data Staging Strategy

The initial dataset imported from the SNS Excel spreadsheet (`seed_sns_projects_dataset.sql`) embedded rich metadata (e.g. `phase_milestone`, `task_list`, `subtask`, `assignee`) directly into `tasks.description`.

### Staging & Validation Pipeline (Decision 19):
```text
[ Existing tasks table (V1) ]
              │
              ▼ (Step 1: Staging Script)
[ INSERT INTO staging_legacy_task_imports ]
  ├── Extracts raw text fields from description
  ├── Identifies target department mappings
  └── Generates proposed RACI, milestone, and deliverable rows
              │
              ▼ (Step 2: Admin Validation UI)
[ Project Administrator Review Screen ]
  ├── Admin reviews proposed parsed entities
  ├── Corrects ambiguous assignees or phase titles
  └── Clicks "Approve & Promote to V2 Production"
              │
              ▼ (Step 3: Atomic Promotion Transaction)
[ Populate Production V2 Tables: workstreams, phases, milestones, task_raci_assignments ]
```

---

## 29. Implementation Phases

```text
+----------------------------------------------------------------------------------------------------+
|                                    V2 IMPLEMENTATION ROADMAP                                       |
+----------------------------------------------------------------------------------------------------+
| PHASE 1: CORE DATA & GOVERNANCE FOUNDATION (Weeks 1–2)                                             |
|   • Database Schema Migration: Departments, System Roles, RACI, Workstreams, Phases, Approvals     |
|   • RLS Policies & Atomic PostgreSQL Transaction RPCs (`approve_task`, `reorder_tasks`)            |
|   • Legacy Data Staging & RACI Migration Tools                                                     |
|                                                                                                    |
| PHASE 2: RACI, TASK ENGINE & GOVERNED KANBAN (Weeks 3–4)                                           |
|   • Upgraded TaskDetailPanel (RACI Selector, Deliverables, Stage Gate Links, Approval Triggers)    |
|   • Governed Kanban Board with State Machine Constraints & Blocker Alerts                          |
|   • In-App Realtime Notification Bell & Activity Audit Stream                                      |
|                                                                                                    |
| PHASE 3: EXECUTIVE & DEPARTMENTAL COMMAND CENTERS (Weeks 5–6)                                      |
|   • CEO Strategic Command Center (Cross-departmental velocity, milestone tracking, health gauges) |
|   • CTO Engineering Dashboard (Hardware/Software workstreams, specs, technical blocker queues)     |
|   • Department Workspaces (Operations, Software, Mechanical, SCM, Finance lenses)                  |
|   • Personal "My Work" & Dedicated Approval Queue                                                  |
|                                                                                                    |
| PHASE 4: DEPENDENCY DAG, STAGE GATES & ENTERPRISE INTEGRATIONS (Weeks 7–8)                         |
|   • Visual Dependency Graph & Automated Blocker Resolution Engine                                  |
|   • Quality Stage-Gate Verification Panel & Checklists                                             |
|   • Supabase Storage Integration for Task File Deliverables                                        |
|   • Integration Outbox Worker for Zoho Cliq & Zoho Mail Notifications                              |
+----------------------------------------------------------------------------------------------------+
```

---

## 30. Risk Register

| Risk ID | Risk Description | Severity | Probability | Mitigation Strategy |
| :--- | :--- | :---: | :---: | :--- |
| **R-01** | **Permission Deadlocks:** Strict RLS policies accidentally prevent users from marking tasks complete when approver is unavailable. | High | Medium | Executive override logic allowing CEO, CTO, or Project Admin to bypass/sign off stalled approvals. |
| **R-02** | **Data Corruption in Legacy Import:** Description string parsing creates malformed milestones. | Medium | High | Staging table architecture with mandatory human review before production promotion (Decision 19). |
| **R-03** | **Performance Degradation on Kanban:** Complex RACI joins on large task boards cause slow render times. | Medium | Low | PostgreSQL database views with materialized aggregation queries and indexed foreign keys. |
| **R-04** | **Circular Dependencies:** User links Task A -> Task B -> Task A. | High | Low | Database recursive CTE check on `task_dependencies` rejecting circular insertions with HTTP 400. |

---

## 31. Testing Strategy

1. **Database & RLS Test Suite:** Automated SQL test scripts verifying that:
   - Viewers cannot insert tasks.
   - Non-Accountable members cannot move approval-gated tasks to `done`.
   - Stage gate blocking prevents phase advancement when requirements are incomplete.
2. **RPC Transaction Verification:** Test concurrency and idempotency of `approve_task()`, `reorder_tasks()`, and `pass_stage_gate()`.
3. **Client-Side Component Testing:** Visual regression tests verifying Dark Mode styling, `@dnd-kit` drag handles, and responsive drawers on mobile/tablet breakpoints.

---

## 32. Definition of Done

A feature is considered **Done** in SNS Projects V2 when:
1. Database schema and RLS policies are applied and verified in Supabase.
2. Workflow state rules are enforced via database functions/RPCs.
3. React UI components seamlessly integrate with Stack n Stock design tokens (`#FDE215` / `#000000`).
4. All user mutations generate corresponding `activity_events` and `notifications`.
5. TypeScript types are exported for all entity payloads.
6. The application builds cleanly (`npm run build`) and deploys via GitHub Actions without warnings.

---

## 33. Acceptance Criteria

- [ ] **RACI Integrity:** Every controlled task enforces at least one (R) and exactly one (A) user.
- [ ] **Approval Enforcement:** A task marked `approval_required = true` cannot be moved to `done` without an approval record signed by (A).
- [ ] **Department Filtering:** Navigating to `/workspace/:id/department/SW` displays only software workstreams, deliverables, and assigned team members without duplicating database projects.
- [ ] **Executive Visibility:** CEO and CTO dashboards accurately aggregate real-time milestones, workstream progress percentages, and blocker metrics.
- [ ] **Realtime Sync:** Status changes on the Kanban board immediately reflect across open browser sessions via Supabase Realtime.

---

## 34. Files Expected to Change During Each Future Phase

### Phase 1: Core Foundation & Data Layer
- **New Database Files:** `supabase/migrations/001_v2_core_schema.sql`, `supabase/migrations/002_v2_functions_and_rpc.sql`
- **Data Layer:** `src/lib/supabase.js`, `src/types/database.ts` (New), `src/hooks/useDepartments.js` (New), `src/hooks/useRaci.js` (New)

### Phase 2: Task Engine & RACI UI
- **Components:** `src/components/TaskDetailPanel.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskRow.jsx`, `src/components/NotificationBell.jsx` (New)
- **Pages:** `src/pages/TasksPage.jsx`, `src/pages/MyWorkPage.jsx` (New), `src/pages/ApprovalsPage.jsx` (New)

### Phase 3: Executive Dashboards & Department Views
- **Pages:** `src/pages/CeoDashboardPage.jsx` (New), `src/pages/CtoDashboardPage.jsx` (New), `src/pages/DepartmentWorkspacePage.jsx` (New)
- **Navigation:** `src/components/AppLayout.jsx`, `src/App.jsx`

### Phase 4: Stage Gates, Dependencies & Outbox
- **Components:** `src/components/DependencyGraph.jsx` (New), `src/components/StageGateModal.jsx` (New)
- **Backend:** `supabase/functions/webhook-dispatcher/` (New Edge Function)

---

## 35. Remaining Questions That Truly Require Business Input

1. **Stage-Gate Authority:** For multi-department hardware/software milestones (e.g. *ASRS Mother Hub Deployment*), is dual sign-off required from **both** the CTO and Head of Operations, or does the CTO hold sole sign-off authority?
2. **Budget Thresholds:** Should task budget overruns above a specific monetary threshold (e.g., > ₹1,00,000) trigger an automated approval routing directly to the CEO dashboard?
3. **External Vendor Guest Access:** Will fabrication vendors (e.g. laser cutting, sheet metal shops) be given restricted guest accounts in V2 to upload GRN / inspection photos directly, or will internal Supply Chain staff remain the sole data entry point?
4. **Notification Urgency Thresholds:** Should overdue P0/Urgent tasks trigger immediate SMS/WhatsApp alerts via webhook, or is daily digest email + in-app notification sufficient for MVP?

---

## Strict Implementation Order

To prevent UI development from breaking against missing backend structures, implementation must proceed in this strict chronological order:

```text
Step 1: Database Migration Scripts (Tables, Constraints, Indexes)
   │
Step 2: Security & Governance (RLS Policies, Security Definer Helper Functions)
   │
Step 3: Atomic Business RPCs (approve_task, reorder_tasks, pass_stage_gate)
   │
Step 4: Legacy Staging & RACI Backfill Execution
   │
Step 5: TypeScript Interfaces & Supabase API Client Layer
   │
Step 6: Data Hooks & Realtime Subscriptions
   │
Step 7: Reusable Shared UI Components (RACI Picker, Gate Badge, Approval Drawer)
   │
Step 8: Core Task & Kanban Upgrades
   │
Step 9: Executive Dashboards (CEO / CTO / Admin) & Department Views
   │
Step 10: External Webhook Outbox & GitHub Pages Final Verification
```

---
*End of Target Architecture Blueprint.*
