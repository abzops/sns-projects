# SNS Projects — Structured Production Data Reset & Reseed Report

**Date**: August 14, 2026  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects Dataset)  
**Execution Mode**: Transactional Destructive Replace (`BEGIN ... COMMIT`)  
**Status**: **RESEED SUCCESS**  

---

## 1. Pre-Reset Counts

Prior to resetting, the workspace contained unstructured/legacy sample data:
- **Projects**: 6
- **Milestones**: 0
- **Task Lists**: 0
- **Tasks**: 26 (all legacy uncategorized tasks with `milestone_id = NULL` and `task_list_id = NULL`)
- **Subtasks**: 0
- **RACI Assignments**: 0
- **Task Statuses**: 30
- **Notifications**: 27

---

## 2. Backup Location

A complete snapshot of all project-domain entities was taken prior to deletion and safely saved to a gitignored local storage:
- **Backup File**: `data-backups/pre_structured_reseed_20260814.json`
- **Backup Scope**: All 6 pre-existing projects, 26 tasks, 30 task statuses, and 27 notifications with full relational IDs and JSON payloads.
- **Security Check**: `data-backups/` is strictly added to `.gitignore` and excluded from git tracking. No credentials, tokens, or auth tables were included.

---

## 3. Exact Deleted Scope

All deletions were strictly scoped to `workspace_id = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea'` and executed in child $\rightarrow$ parent order inside a single PostgreSQL transaction:
1. `notifications` (belonging to target workspace)
2. `task_raci_assignments` (belonging to tasks in target workspace)
3. `subtasks` (belonging to tasks in target workspace)
4. `tasks` (belonging to projects in target workspace)
5. `task_lists` (belonging to projects in target workspace)
6. `milestones` (belonging to projects in target workspace)
7. `task_statuses` (belonging to projects in target workspace)
8. `projects` (belonging to target workspace)

---

## 4. Preserved Scope (Zero Disruption)

The following tables and configurations were **100% preserved and untouched**:
- `auth.users` (1 active owner account: `abhinand@stacknstock.in`)
- `public.profiles` (workspace owner profile)
- `public.workspaces` (workspace `dbcaddf1-cf02-4bad-8af1-974301cdfbea`)
- `public.workspace_members` (active owner membership)
- `public.user_system_roles` (executive role configuration)
- `public.department_memberships`
- All database schema constraints, RLS policies, and `private` schema helper functions.

---

## 5. Core Departments Setup

The 5 core Stack n Stock operational departments were verified, normalized, and updated/created:
| Department Name | Code | Color | Status | ID |
| :--- | :--- | :--- | :--- | :--- |
| **Engineering** | `ENG` | `#FDE215` | Created | `7e647420-75f8-4e5a-a56f-023942600e5a` |
| **Software & IT** | `SWIT` | `#8cc9ff` | Updated | `1dad91cc-751a-45ea-8236-42a3c1b441df` |
| **Operations** | `OPS` | `#60d394` | Created | `fbba5a84-29a8-4c2d-b558-b7d9ecf95446` |
| **Procurement** | `PROC` | `#ffb020` | Created | `c55b2534-63b1-4e6c-a361-b33ff1ef7f9a` |
| **Commercials & Partnerships** | `COMM` | `#c084fc` | Created | `1e614cca-aa46-4ca5-ba56-4b152d64bc39` |

---

## 6. Structured Projects Overview

### Project 1: ASRS Product Development
- **Description**: Design, engineer, prototype and validate the Stack n Stock automated storage and retrieval product for controlled production release.
- **Priority**: High | **Status**: Active | **Dates**: 2026-08-01 to 2026-10-31 | **Color**: `#FDE215`
- **Owner**: Workspace Owner (`abhinand@stacknstock.in`)
- **Milestones**: 2 | **Task Lists**: 4 | **Tasks**: 8 | **Subtasks**: 16

### Project 2: Warehouse Deployment Pilot
- **Description**: Plan, install, commission and hand over a Stack n Stock automated warehouse deployment through a controlled pilot implementation.
- **Priority**: Critical | **Status**: Active | **Dates**: 2026-08-10 to 2026-11-15 | **Color**: `#ffb020`
- **Owner**: Workspace Owner (`abhinand@stacknstock.in`)
- **Milestones**: 2 | **Task Lists**: 4 | **Tasks**: 8 | **Subtasks**: 16

### Project 3: SNS Projects Internal Rollout
- **Description**: Configure and adopt SNS Projects as Stack n Stock's internal project execution, responsibility and executive visibility platform.
- **Priority**: Medium | **Status**: Active | **Dates**: 2026-08-14 to 2026-09-15 | **Color**: `#60d394`
- **Owner**: Workspace Owner (`abhinand@stacknstock.in`)
- **Milestones**: 2 | **Task Lists**: 4 | **Tasks**: 8 | **Subtasks**: 16

---

## 7. Canonical Hierarchy & Task Distribution

| Project | Milestone | Task List | Task Title | Status | Priority | RACI | Subtasks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **ASRS Product Development** | Design & Engineering | Mechanical Design | Freeze Container & Rack Layout | `done` | High | R: ENG, A: Owner | 2 (2 done) |
| | Design & Engineering | Mechanical Design | Finalize Bin & Compartment Design | `in_progress` | High | R: ENG, A: Owner | 2 (1 done, 1 in_progress) |
| | Design & Engineering | Electrical & Controls | Freeze PLC I/O Map | `in_review` | High | R: ENG, A: Owner, C: SWIT | 2 (1 done, 1 in_progress) |
| | Design & Engineering | Electrical & Controls | Finalize Electrical Panel BOM | `todo` | Medium | R: ENG, A: Owner, C: PROC | 2 (2 todo) |
| | Prototype & Validation | Prototype Build | Release Manufacturing Package | `todo` | High | R: ENG, A: Owner, I: PROC | 2 (2 todo) |
| | Prototype & Validation | Prototype Build | Assemble ASRS Prototype | `todo` | High | R: ENG, A: Owner, C: PROC | 2 (2 todo) |
| | Prototype & Validation | Validation | Run Integrated Functional Test | `todo` | Urgent | R: ENG, A: Owner, C: SWIT | 2 (2 todo) |
| | Prototype & Validation | Validation | Close Validation Actions & Release V1 | `todo` | High | R: ENG, A: Owner, I: OPS | 2 (2 todo) |
| **Warehouse Deployment Pilot** | Site & Deployment Planning | Site Readiness | Freeze Site Layout | `done` | High | R: OPS, A: Owner, C: ENG | 2 (2 done) |
| | Site & Deployment Planning | Site Readiness | Confirm Utility & Compliance Readiness | `in_progress` | Urgent | R: OPS, A: Owner, C: ENG | 2 (1 in_progress, 1 todo) |
| | Site & Deployment Planning | Deployment Planning | Freeze Integrated Deployment Schedule | `in_review` | High | R: OPS, A: Owner, C: ENG, C: PROC | 2 (1 done, 1 in_progress) |
| | Site & Deployment Planning | Deployment Planning | Mobilize External Vendors | `todo` | Medium | R: PROC, A: Owner, C: OPS | 2 (2 todo) |
| | Installation & Go-Live | Installation & Commissioning | Complete Mechanical Installation | `todo` | High | R: OPS, A: Owner, C: ENG | 2 (2 todo) |
| | Installation & Go-Live | Installation & Commissioning | Commission PLC & HMI | `todo` | Urgent | R: ENG, A: Owner, C: SWIT | 2 (2 todo) |
| | Installation & Go-Live | Acceptance & Handover | Complete Site Acceptance Test | `todo` | Urgent | R: OPS, A: Owner, C: ENG, C: SWIT | 2 (2 todo) |
| | Installation & Go-Live | Acceptance & Handover | Train Operations Team & Go Live | `todo` | High | R: OPS, A: Owner, I: COMM | 2 (2 todo) |
| **SNS Projects Internal Rollout** | Organization & Governance | Organization Setup | Configure Department Structure | `done` | High | R: OPS, A: Owner | 2 (2 done) |
| | Organization & Governance | Organization Setup | Onboard Core Users | `in_progress` | High | R: OPS, A: Owner | 2 (1 in_progress, 1 todo) |
| | Organization & Governance | Governance | Configure System Roles | `in_progress` | Medium | R: OPS, A: Owner, C: SWIT | 2 (1 done, 1 in_progress) |
| | Organization & Governance | Governance | Establish RACI Working Standard | `in_review` | High | R: OPS, A: Owner, I: COMM | 2 (1 done, 1 in_progress) |
| | Adoption & Stabilization | Pilot Adoption | Configure First Live Structured Project | `todo` | High | R: OPS, A: Owner, C: ENG | 2 (2 todo) |
| | Adoption & Stabilization | Pilot Adoption | Run Team Walkthrough | `todo` | Medium | R: OPS, A: Owner, I: ENG, I: SWIT, I: PROC | 2 (2 todo) |
| | Adoption & Stabilization | Stabilization | Close P0 / P1 Application Defects | `todo` | Urgent | R: SWIT, A: Owner, C: OPS | 2 (1 in_progress, 1 todo) |
| | Adoption & Stabilization | Stabilization | Publish Quick User Guide & BAU Handover | `todo` | Medium | R: OPS, A: Owner, C: SWIT | 2 (2 todo) |

---

## 8. RACI Summary & Governance

- **Total RACI Assignment Rows**: 72
- **Responsible ($\ge 1$ R per task)**: 24 (all assigned to active Stack n Stock departments)
- **Accountable (exactly 1 A per task)**: 24 (all assigned to active workspace owner `abhinand@stacknstock.in`)
- **Consulted (C)**: 16 assignments across SWIT, PROC, ENG, OPS
- **Informed (I)**: 8 assignments across COMM, OPS, PROC, ENG, SWIT
- **Fabricated Accounts**: **0** (No synthetic user accounts or auth records created).

---

## 9. Progress Metrics Verification

- **Task Completion Source**: `task_statuses.system_code = 'done'`
- **ASRS Product Development**: 1/8 Done $\rightarrow$ **13% Progress**
- **Warehouse Deployment Pilot**: 1/8 Done $\rightarrow$ **13% Progress**
- **SNS Projects Internal Rollout**: 1/8 Done $\rightarrow$ **13% Progress**
- **All Active Milestones (1.1, 2.1, 3.1)**: 1/4 Done $\rightarrow$ **25% Progress**
- **All Active Task Lists (Mechanical Design, Site Readiness, Org Setup)**: 1/2 Done $\rightarrow$ **50% Progress**

---

## 10. Notification Inbox Sanitization

- Synthetic notifications generated during the reseed transaction were purged at the end of the transaction.
- **Notifications in target workspace**: **0** (clean initial inbox state).
- Notification triggers and schema functions remain active for ongoing user interactions.

---

## 11. Final Verification & Test Results

| Test Suite | Result | Details |
| :--- | :--- | :--- |
| **Structured Dataset Suite** (`test-structured-production-data.mjs`) | **20/20 PASSED** | Verified 3 projects, 6 milestones, 12 task lists, 24 tasks, 48 subtasks, 0 uncategorized |
| **Release 2.5 Hierarchy Suite** (`test-r2_5-hierarchy.mjs`) | **32/32 PASSED** | Verified foreign key pairings, cascade deletes, progress formulas |
| **Release 3 Go-Live Suite** (`test-r3-go-live.mjs`) | **25/25 PASSED** | Notification engine, hierarchy RLS, publication checks |
| **Release 1.1 Security Suite** (`test-r1_1-security.mjs`) | **20/20 PASSED** | Zero-trust RLS policies and security definer protections |
| **Hotfix Suite** (`test-member-rendering-hotfix.mjs`) | **15/15 PASSED** | Profile null fallback and explicit FK join query verified |
| **Linter** (`npm run lint`) | **0 Errors** | Clean |
| **Production Build** (`npm run build`) | **0 Errors** | Bundle compiled in 671ms |

---

## 12. Final Database Counts

| Entity | Count | Status |
| :--- | :--- | :--- |
| **Workspace Members** | 1 | Preserved |
| **Auth Users** | 1 | Preserved |
| **Projects** | 3 | Exactly 3 |
| **Milestones** | 6 | Exactly 6 |
| **Task Lists** | 12 | Exactly 12 |
| **Tasks** | 24 | Exactly 24 |
| **Subtasks** | 48 | Exactly 48 (2 per task) |
| **Uncategorized Tasks** | **0** | **Clean Canonical Hierarchy** |
| **Tasks with Missing R** | **0** | **100% Compliant** |
| **Tasks with Invalid A** | **0** | **100% Compliant** |
| **Core Departments** | 5 | ENG, SWIT, OPS, PROC, COMM |
| **Notifications** | 0 | Clean Inbox |
