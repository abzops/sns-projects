# Package 2 / P2-02 — Process Instance Movement, Cancellation, Authorization & Audit

**Status**: IMPLEMENTED & VERIFIED  
**Target Migration**: `supabase/migrations/20260817123556_p2_02_process_instance_movement_cancellation.sql`  
**Migration Number**: 27  
**Parent Package**: [Package 02 — Process Runtime Foundation](../)  

---

## 1. Executive Summary

P2-02 delivers the core lifecycle management features for Defined Process Instances:
1. **Process Instance Movement**: Safe relocation of running attached Process Instances across hierarchical placement targets (`project`, `phase`, `task_list`, `task`) within the same project, preserving instance data, progression, RACIs, evidence, and audit trails while preventing cycle creation.
2. **Process Instance Cancellation**: Idempotent, permanent cancellation of running Process Instances where completed tasks remain completed, unfinished tasks become cancelled, no data is lost, and all subsequent mutations are blocked.
3. **Multi-tier Authorization Hierarchy**: Server-enforced authorization for movement and cancellation with nearest-placement ownership resolution and executive overrides (Admin, CEO, CTO).
4. **Visibility Isolation**: Read authorization rules isolating standalone vs attached instances via RLS and `private.can_view_process_instance`.
5. **Post-Cancellation Runtime Protection**: Fail-closed guards across `complete_responsible_part`, `reject_process_task`, `approve_process_task`, consultation, evidence submission, and DAG activation.
6. **Task Owner Foundation**: Added `tasks.owner_id uuid NULL REFERENCES public.profiles(id)` for task ownership resolution.
7. **Audit & Permissions RPC**: Immutable `PROCESS_MOVED` and `PROCESS_CANCELLED` events with detailed payloads, and `public.get_process_instance_permissions` for frontend integration.

---

## 2. Architectural Invariants & Rules

### 2.1 Process Instance Movement Rules
- **Same Project Boundary**: Movement is strictly constrained within the same `project_id`. Cross-project movement is rejected.
- **Placement Restrictions**:
  - `standalone` instances can NEVER be converted to attached.
  - `attached` instances can NEVER be converted to standalone.
  - `completed` and `cancelled` instances cannot be moved.
- **Cycle Prevention**: A Process Instance cannot be moved under one of its own step tasks or any descendant of its step tasks (enforced via recursive CTE ancestry traversal).
- **Materialized Tasks Synchronization**: When an instance moves, all its constituent step tasks (`public.tasks`) update their `phase_id`, `task_list_id`, and `parent_task_id` authoritatively to match the new placement target.
- **Audit Logging**: Every movement writes an immutable `PROCESS_MOVED` event into `public.process_audit_events` with previous placement, new placement, reason, and moved task count.
- **Idempotent No-Ops**: Moving an instance to its exact current placement target returns `{ success: true, is_noop: true }` without inserting redundant audit events.

### 2.2 Process Instance Cancellation Rules
- **Permanence**: Cancellation is permanent; cancelled instances cannot be restarted or moved.
- **State Partitioning**:
  - Completed step tasks (`workflow_state = 'completed'`) remain `completed`.
  - Unfinished step tasks (`workflow_state NOT IN ('completed', 'cancelled')`) transition to `cancelled`.
  - RACI assignees, evidence submissions, consultation responses, and approval logs are preserved.
- **Idempotency**: Replaying cancellation returns `{ success: true, is_replay: true, status: 'cancelled' }` without duplicate audit events.
- **Post-Cancellation Guard**: Any attempt to advance, complete, reject, or submit consultation/evidence on a task belonging to a cancelled instance is rejected with a descriptive exception.

---

## 3. Authorization Hierarchy

### 3.1 Nearest Placement Owner Resolution
When checking authorization for placement-bound actions, ownership resolves up the hierarchy:
1. **Task Placement**: `tasks.owner_id` $\to$ Task Responsible (`R`) $\to$ `task_lists.owner_id` $\to$ `phases.owner_id` $\to$ `projects.owner_id`.
2. **Task List Placement**: `task_lists.owner_id` $\to$ `phases.owner_id` $\to$ `projects.owner_id`.
3. **Phase Placement**: `phases.owner_id` $\to$ `projects.owner_id`.
4. **Project Placement**: `projects.owner_id`.

### 3.2 Action Authorization Matrix

| Action | Allowed Roles |
| :--- | :--- |
| **Move Instance** | Process Owner (`process_instances.owner_id`), Nearest Current Placement Owner / Task Responsible (`R`), Executive Override (Admin, CEO, CTO, Workspace Owner/Admin) |
| **Cancel Instance** | Process Starter (`process_instances.started_by`), Process Owner (`process_instances.owner_id`), Executive Override (Admin, CEO, CTO, Workspace Owner/Admin) |
| **View Standalone Instance** | Starter, Owner, Step RACI Participants (`R`, `A`, `C`, `I`), Executive Override |
| **View Attached Instance** | Workspace members with access to host project/phase/task list, Starter, Owner, Step RACI Participants, Executive Override |

---

## 4. API & Function Signatures

### 4.1 Movement RPC
```sql
public.move_process_instance(
  p_instance_id           uuid,
  p_target_placement_type text,
  p_target_phase_id       uuid DEFAULT NULL,
  p_target_task_list_id   uuid DEFAULT NULL,
  p_target_parent_task_id uuid DEFAULT NULL,
  p_reason                text DEFAULT NULL
) RETURNS jsonb (SECURITY INVOKER, search_path = '')
```

### 4.2 Cancellation RPC
```sql
public.cancel_process_instance(
  p_instance_id uuid,
  p_reason      text
) RETURNS jsonb (SECURITY INVOKER, search_path = '')
```

### 4.3 Permissions RPC
```sql
public.get_process_instance_permissions(
  p_instance_id uuid
) RETURNS jsonb (SECURITY INVOKER, search_path = '')
-- Returns: { can_view: bool, can_move: bool, can_cancel: bool, placement_type: text, status: text, project_id: uuid, phase_id: uuid, task_list_id: uuid, parent_task_id: uuid }
```

---

## 5. Test Coverage & Verification

All test suites pass with 100% success on PostgreSQL 15 / Supabase:
- `scripts/test-p2-02-process-movement-cancellation.mjs`: **36/36 PASS**
- `scripts/test-p1-02a-process-lifecycle.mjs`: **34/34 PASS**
- `scripts/test-p1-02-process-runtime.mjs`: **45/45 PASS**
- `scripts/test-p1-01-foundation.mjs`: **45/45 PASS**
- `scripts/verify-p2-01-phase-rename.mjs`: **37/37 PASS**
- `scripts/verify-zero-legacy-milestones.mjs`: **8/8 PASS**
- `scripts/test-p2-01a-local-browser-flows.mjs`: **14/14 PASS**
- `scripts/verify-doc-links.mjs`: **197/197 PASS**
- `npm run lint`: **0 errors**
- `npm run build`: **0 errors (912ms)**
