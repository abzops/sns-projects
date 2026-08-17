# Package 1 / P1-02A: Process Runtime Execution, Security & Idempotency Closure

**Package**: [Package 01 — Core Foundation & Process Architecture](../../README.md)  
**Task ID**: P1-02A  
**Status**: `VERIFIED`  
**Authoritative Migration**: `20260817072340_p1_02a_process_runtime_execution_security_closure.sql`  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Preceding Delivery**: [P1-02 Placement-Aware Process Runtime Engine](./P1-02_Placement_Aware_Process_Runtime_Engine.md)

---

## 1. Executive Summary & Problem Statement

Independent production and security audits following the delivery of P1-02 identified eight critical runtime execution, idempotency, and security posture gaps:

1. **Advancement Engine Was Task List-Centric**: The execution engine (`private.complete_task_and_advance`) resolved context from `task_lists` where `id = v_task.task_list_id` and queried downstream tasks scoped by `task_list_id`. Standalone Process instances (`task_list_id IS NULL`) failed to advance downstream tasks.
2. **Process Completion Lifecycle Did Not Update `process_instances`**: Completion checks updated `task_lists.process_state = 'completed'`, causing two failures: Standalone/Task placements never marked the instance complete, and attached placements incorrectly mutated the host task list.
3. **No Isolation for Multiple Instances in a Shared Task List**: Two Process Instances running in the same Task List collided during downstream step activation.
4. **Step-Level Due Date Generation on DAG Activation**: Advancing steps dynamically calculated `due_date = add_working_days(...)`, violating Decisions 33 & 42 which mandate that Process Instances have overall due dates while individual constituent tasks have `due_date = NULL`.
5. **Lack of Server-Enforced Start Idempotency**: `p_start_request_id` was not stored or indexed as a unique constraint on `(workspace_id, started_by, start_request_id)`, allowing duplicate executions.
6. **Supabase Security Advisor Warnings**: Public functions `public.start_process_instance` and `public.get_process_instance_progress` were defined as `SECURITY DEFINER` in the `public` schema without an invoker wrapper.
7. **Unauthenticated / Unauthorized Progress Calculation**: `public.get_process_instance_progress` lacked caller access verification.
8. **Owner Arbitrary Injection & Dead Parameters**: `p_owner_id` permitted arbitrary owner assignment instead of strictly binding to `auth.uid()`, and `p_raci_overrides` was accepted without implementation.

P1-02A resolves all eight issues via a clean forward migration.

---

## 2. Architectural Changes & Key Decisions

### 2.1 Execution Engine Branching (`complete_task_and_advance`)
The engine now explicitly branches on `task.process_instance_id`:
- **When `v_task.process_instance_id IS NOT NULL` (New Runtime)**:
  - Context is fetched from `public.process_instances WHERE id = v_task.process_instance_id`.
  - Downstream DAG dependencies match strictly on `t.process_instance_id = v_instance.id`.
  - Predecessors are checked exclusively within `pred_task.process_instance_id = v_instance.id`.
  - Activated tasks are set to `workflow_state = 'ready'`, `ready_at = now()`, and `due_date = NULL`.
  - Process completion evaluates remaining tasks with `process_instance_id = v_instance.id`. When count reaches 0, `public.process_instances` is updated to `status = 'completed', completed_at = now()`.
  - Host task lists and parent tasks are **never mutated**.
- **When `v_task.process_instance_id IS NULL` (Legacy Runtime)**:
  - Existing `task_list_id` logic and `task_lists` status updates remain 100% preserved.

### 2.2 Server-Enforced Idempotency
- Added column `start_request_id uuid NOT NULL DEFAULT gen_random_uuid()` to `public.process_instances`.
- Added unique index: `idx_process_instances_start_request_unique ON public.process_instances(workspace_id, started_by, start_request_id)`.
- `public.start_process_instance` requires `p_start_request_id uuid`.
- Replaying the exact same `p_start_request_id` with an identical payload returns the existing instance with `is_replay: true`.
- Replaying the same `p_start_request_id` with a conflicting payload raises an exception: `'Idempotency conflict: start_request_id was previously used with different parameters.'`.

### 2.3 Security Architecture: Public Invoker + Private Definer
To eliminate Supabase Security Advisor warnings while maintaining transactional security:
- `public.start_process_instance` is a `SECURITY INVOKER` in the `public` schema. It performs parameter passing to `private.start_process_instance_internal`.
- `private.start_process_instance_internal` is `SECURITY DEFINER SET search_path = ''` in the `private` schema. It validates `auth.uid()`, workspace membership, starter authorization via `private.can_start_process_version`, and executes the atomic transaction.
- `public.get_process_instance_progress` is `SECURITY INVOKER` and explicitly checks `private.can_read_process_instance(p_instance_id, auth.uid())` before computing progress.
- Result: **0 new Supabase Security Advisor warnings**.

### 2.4 Owner & Due Date Contract Integrity
- `owner_id` is strictly set to `auth.uid()`. `p_owner_id` and `p_raci_overrides` were removed from the public API.
- `reject_process_task` enforces `p_new_due_date` behavior: raises exception if non-null in new runtime (keeps `due_date = NULL`), while enforcing mandatory due date in legacy runtime.
- `complete_responsible_part` and `submit_task_consultation` derive workspace and process display names from `process_instances` when `task_list_id` is null.

---

## 3. Canonical API Contracts

### 3.1 `public.start_process_instance` (SECURITY INVOKER)
```sql
CREATE OR REPLACE FUNCTION public.start_process_instance(
  p_version_id       uuid,
  p_instance_name    text,
  p_start_request_id uuid,
  p_overall_due_date date DEFAULT NULL,
  p_placement_type   text DEFAULT 'standalone',
  p_project_id       uuid DEFAULT NULL,
  p_phase_id         uuid DEFAULT NULL,
  p_task_list_id     uuid DEFAULT NULL,
  p_parent_task_id   uuid DEFAULT NULL
)
RETURNS jsonb
```

### 3.2 `public.get_process_instance_progress` (SECURITY INVOKER)
```sql
CREATE OR REPLACE FUNCTION public.get_process_instance_progress(p_instance_id uuid)
RETURNS numeric
```

---

## 4. Automated Verification Matrix

| Verification Category | Script / Test | Results |
| :--- | :--- | :--- |
| **Execution Engine & Advancement** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 1–6) | **PASSED** (6/6) |
| **Attached Placements & Host Immutability** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 7–9) | **PASSED** (3/3) |
| **Multiple Instance Isolation** | `scripts/test-p1-02a-process-lifecycle.mjs` (Test 10) | **PASSED** (1/1) |
| **Server-Enforced Idempotency** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 11–15) | **PASSED** (5/5) |
| **Security Invoker Architecture** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 16–21) | **PASSED** (6/6) |
| **Rework & Due Date Integrity** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 22–23) | **PASSED** (2/2) |
| **Consultation & Completion Context** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 24–25) | **PASSED** (2/2) |
| **Grants Matrix** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 26–28) | **PASSED** (3/3) |
| **Build & Type Safety** | `scripts/test-p1-02a-process-lifecycle.mjs` (Tests 29–30) | **PASSED** (2/2) |
| **Placement Runtime Static Tests** | `scripts/test-p1-02-process-runtime.mjs` | **PASSED** (45/45) |
| **Documentation Link Integrity** | `scripts/verify-doc-links.mjs` | **PASSED** (133/133 links) |

---

## 5. References & Cross-Links

- [Implementation Roadmap](../../00_Governance/IMPLEMENTATION_ROADMAP.md)
- [Defined Process Runtime API Contract](../../04_Defined_Processes/Defined_Process_Runtime_API_Contract.md)
- [P1-02C Workflow RPC Security & Real E2E Closure](./P1-02C_Workflow_RPC_Security_and_Real_E2E_Closure.md)
- [P1-02 Placement-Aware Process Runtime Engine](./P1-02_Placement_Aware_Process_Runtime_Engine.md)
- [Core Architecture Decisions Index](../../09_Decision_Records/DECISION_REGISTER.md)
