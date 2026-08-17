# P1-01 Core Hierarchy & Process Instance Foundation

## Document Control
- **Status**: `VERIFIED`
- **Package**: Package 1 — Core Foundation
- **Implementation Commit**: [`65efb78`](https://github.com/abzops/sns-projects/commit/65efb78)
- **Canonical Migration**: `20260817063502_core_hierarchy_process_instance_foundation.sql`
- **Target Project**: `gqerfixdmgbqahgslzsq` (SNS Projects Production)
- **Date**: 2026-08-17
- **Last Verified Date**: 2026-08-17

---

## 1. Objective & Business Context
StacknStock Projects V2 requires a scalable, enterprise-grade work hierarchy to support complex industrial workflows, multi-stage engineering projects, and reusable standard operating procedures (Defined Processes). 

Previously, Defined Processes were coupled directly to Kanban Task Lists (`task_list_type = 'defined'`), which prevented:
1. Executing multiple processes beneath a single project milestone or parent task.
2. Executing standalone processes outside of rigid project containers.
3. Breaking down tasks into fully-featured child tasks (process steps) with independent RACI matrices, approval cycles, and expense tracking.

P1-01 introduces the foundational database schema, placement integrity constraints, and compatibility layers needed for the full V2 target hierarchy without disrupting live production operations.

---

## 2. Structural Hierarchy Evolution

### Previous Architecture (V1)
$$\text{Workspace} \longrightarrow \text{Project} \longrightarrow \text{Milestone} \longrightarrow \text{Task List} \longrightarrow \text{Task} \longrightarrow \text{Simple Subtask}$$

### Target Architecture (V2)
$$\text{Workspace} \longrightarrow \text{Project} \longrightarrow \text{Phase} \longrightarrow \text{Task List} \longrightarrow \text{Task} \longrightarrow \text{Child Task (Process Step)}$$

*Along with unconstrained Standalone Work:*
$$\text{Standalone Process Instance} \longrightarrow \text{Parent Task} \longrightarrow \text{Process Step Tasks}$$

---

## 3. Scope Implemented

1. **Phase Compatibility Layer**:
   - Added `phase_id` to `public.tasks` and `public.task_lists` referencing `public.milestones(id)`.
   - Backfilled existing records where `phase_id = milestone_id`.
   - Implemented database-level bidirectional synchronization (`sync_milestone_phase_id()`) ensuring complete non-breaking backward compatibility.
   - Exposed `public.phases` as a `security_invoker` view over `public.milestones`.
2. **Ownership Alignment**:
   - Added `owner_id` to `public.milestones` and `public.task_lists` with profiles FK.
   - Backfilled existing records safely from `projects.owner_id`.
3. **Child Task Support**:
   - Added `parent_task_id` self-referencing column on `public.tasks` with `ON DELETE CASCADE`.
   - Enforced self-parenting check constraint (`chk_tasks_no_self_parent`).
4. **Standalone Task Foundation**:
   - Dropped `NOT NULL` constraint on `public.tasks.project_id`.
   - Verified that RLS policies fail closed (unauthorized users cannot view standalone tasks).
5. **Explicit Process Instance Entity**:
   - Created `public.process_instances` runtime execution table.
   - Enforced placement integrity checks and minimal technical lifecycle constraints.
   - Linked `public.tasks.process_instance_id` to `public.process_instances(id)`.

---

## 4. Database Schema Changes

| Table / Object | Change Type | Details |
| :--- | :--- | :--- |
| `public.milestones` | `ALTER TABLE` | Added `owner_id uuid REFERENCES public.profiles(id)` + index. |
| `public.task_lists` | `ALTER TABLE` | Added `owner_id uuid`, `phase_id uuid REFERENCES public.milestones(id)` + indexes + sync check. |
| `public.tasks` | `ALTER TABLE` | `project_id` made NULLABLE; added `phase_id uuid`, `parent_task_id uuid`, `process_instance_id uuid` + indexes + checks. |
| `public.phases` | `CREATE VIEW` | Compatibility view under `security_invoker = true` over `public.milestones`. |
| `public.process_instances` | `CREATE TABLE` | Dedicated runtime container for running processes with placement & status checks. |
| `sync_milestone_phase_id` | `CREATE FUNCTION` | Trigger function maintaining bidirectional equality between `milestone_id` and `phase_id`. |

---

## 5. Phase Compatibility & Dual-Sync Mechanism

To allow the frontend to gradually transition from "Milestone" to "Phase" terminology without breaking live operations:
- A `BEFORE INSERT OR UPDATE` trigger runs on both `public.tasks` and `public.task_lists`.
- If an insert/update provides only `milestone_id`, `phase_id` is automatically populated.
- If an insert/update provides only `phase_id`, `milestone_id` is automatically populated.
- Check constraints `chk_tasks_phase_milestone_sync` and `chk_task_lists_phase_milestone_sync` enforce `phase_id IS NOT DISTINCT FROM milestone_id`.

---

## 6. Process Instance Placement & Lifecycle Model

### Placement Types (`chk_process_instance_placement`)
- **`standalone`**: `project_id`, `phase_id`, `task_list_id` must all be NULL.
- **`project`**: `project_id` is NOT NULL; `phase_id`, `task_list_id`, `parent_task_id` are NULL.
- **`phase`**: `project_id` & `phase_id` are NOT NULL; `task_list_id` & `parent_task_id` are NULL.
- **`task_list`**: `project_id`, `phase_id`, `task_list_id` are NOT NULL; `parent_task_id` is NULL.
- **`task`**: `project_id` & `parent_task_id` are NOT NULL.

### Technical Lifecycle (`chk_process_instance_status_lifecycle`)
Status is strictly constrained to:
- `running` (default)
- `completed` (`completed_at` is NOT NULL)
- `cancelled` (`cancelled_at`, `cancelled_by`, `cancel_reason` are NOT NULL)

> [!NOTE]
> **Decision 32 (Parked)**: Rolling business health states (*On Track*, *At Risk*, *Delayed*) are intentionally excluded from the database schema pending stakeholder consensus.

---

## 7. Access Control & Security Model (Post P1-01A Hardening)

- **`public.process_instances`**:
  - RLS is **ENABLED**.
  - All direct table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) are **REVOKED** from `PUBLIC`, `anon`, and `authenticated`.
  - Zero direct client access until P1-02 implements granular, placement-aware RPCs.
  - Restricted exclusively to `service_role` and `postgres`.
- **`public.phases`**:
  - Configured with `security_invoker = true` (inherits underlying `public.milestones` RLS).
  - Explicit `SELECT` granted to `authenticated`; all mutations revoked.

---

## 8. Verification & Test Coverage

Automated test suite [`scripts/test-p1-01-foundation.mjs`](../../../scripts/test-p1-01-foundation.mjs) validates 45 contract assertions:
- **Canonical Migration**: 100% compliant with Supabase CLI chain.
- **Phase/Milestone Sync**: All 5 mutation permutations verified.
- **Placement Logic**: All valid placement combinations accepted; all invalid permutations rejected.
- **Lifecycle Integrity**: Invalid status transitions and unapproved status values rejected.
- **Security Assertions**: Verified zero client grants and fail-closed RLS posture.

---

## 9. Known Limitations & Dependencies for P1-02

1. **No Runtime Process Writes**: `public.process_instances` contains 0 rows. Starting a process through the runtime engine will be implemented in P1-02.
2. **Placement-Aware RPC**: `start_defined_process` currently instantiates processes into task lists; P1-02 will upgrade this to support all 5 placement targets.
3. **UI Terminology**: Frontend continues to read from `milestones` and `milestone_id` until Package 3 executes the UI cutover.

---

## 10. Change History

| Date | Author | Summary of Changes |
| :--- | :--- | :--- |
| 2026-08-17 | Principal Architect | Initial release of P1-01 Core Hierarchy & Process Instance Foundation (Commit `65efb78`). |
