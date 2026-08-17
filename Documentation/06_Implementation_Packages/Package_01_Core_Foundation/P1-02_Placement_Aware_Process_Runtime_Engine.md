# SNS Projects — Package 1 / P1-02: Placement-Aware Process Runtime Engine

**Target Supabase Project:** `gqerfixdmgbqahgslzsq`  
**Workspace:** `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Migration:** `20260817070924_p1_02_placement_aware_process_runtime.sql`  
**Status:** `COMPLETE`  
**Author:** Antigravity Lead Agent & Specialized Engineering Subagents  

---

## 1. Executive Summary

Package 1 / P1-02 establishes the placement-aware runtime execution engine for SNS Projects Defined Processes. Prior to P1-02, starting a Defined Process instantiated a legacy Task List container (`task_list_type = 'defined'`) exclusively within a Project and Milestone hierarchy.

P1-02 implements the new canonical process runtime:
1. **Explicit Process Instance Container**: Every process execution creates an explicit row in `public.process_instances`.
2. **Server-Side Placement Validation**: Validates and enforces hierarchy constraints across 5 supported placement modes: `standalone`, `project`, `phase`, `task_list`, and `task`.
3. **Standalone Process Architecture (Decisions 1 & 8)**: Creates a single standalone parent Task (`project_id = NULL`, `phase_id = NULL`, `task_list_id = NULL`, `parent_task_id = NULL`, `process_instance_id = instance.id`) in `public.tasks` with constituent step tasks linked via `parent_task_id = standalone_parent_id`.
4. **Task-Level Placement (Decisions 3, 10 & 27)**: Step tasks are attached directly as children under an existing parent task (`parent_task_id = target_parent_task_id`), with project and phase hierarchy authoritatively derived from the parent task. Parent task RACI is strictly preserved and never mutated (Decision 39).
5. **Contractual Due Date Model (Decisions 33 & 42)**: Single overall due date stored on `process_instances.due_date`. Materialized runtime step tasks receive `due_date = NULL`.
6. **Dynamic RACI Resolution (Decision 12 & 39)**: Dynamic template placeholder `actor_type = 'process_starter'` resolves to the caller user ID (`auth.uid()`) during runtime instantiation, with automated role deduplication.
7. **Equal-Weight Progress Calculation (Decision 31)**: New canonical RPC `public.get_process_instance_progress(p_instance_id uuid)` computes progress as `(completed_steps / total_steps) * 100.0`.
8. **Granular Security & RLS Model (Decision 38)**: `public.process_instances` SELECT access is restricted to Starter, Owner, RACI participants, and Workspace Executives (Admin/Owner/CEO/CTO). Standalone tasks in `public.tasks` are accessible only to authorized process viewers via `private.can_read_process_instance`.
9. **Zero-Regression Legacy Compatibility**: The existing `public.start_defined_process` RPC and all legacy frontend contracts remain 100% untouched and functional.

> [!NOTE]
> **P1-02A Execution & Security Closure**: Follow-up package [P1-02A](./P1-02A_Process_Runtime_Execution_and_Security_Closure.md) completed the execution engine branching (`complete_task_and_advance` scoped by `process_instance_id`), multiple instance isolation in shared Task Lists, server-enforced start idempotency via `start_request_id`, and converted public RPCs to `SECURITY INVOKER` eliminating all Supabase Security Advisor warnings.

---

## 2. Placement Type Specification

| Placement Type | Required Arguments | Enforced Null Columns | Derived Hierarchy / Parent Task |
| :--- | :--- | :--- | :--- |
| `standalone` | `p_version_id`, `p_instance_name` | `project_id`, `phase_id`, `task_list_id`, `parent_task_id` (caller input) | Creates standalone parent task (`project_id = NULL`), sets `process_instances.parent_task_id = standalone_parent_id`, sets step `parent_task_id = standalone_parent_id`. |
| `project` | `p_version_id`, `p_instance_name`, `p_project_id` | `phase_id`, `task_list_id`, `parent_task_id` | Enclosing project; steps receive `project_id = p_project_id`, `parent_task_id = NULL`. |
| `phase` | `p_version_id`, `p_instance_name`, `p_project_id`, `p_phase_id` | `task_list_id`, `parent_task_id` | Enclosing phase validated against project; steps receive `project_id`, `phase_id` (synced `milestone_id`). |
| `task_list` | `p_version_id`, `p_instance_name`, `p_project_id`, `p_phase_id`, `p_task_list_id` | `parent_task_id` | Enclosing task list validated against phase and project; steps receive `project_id`, `phase_id`, `task_list_id`. |
| `task` | `p_version_id`, `p_instance_name`, `p_parent_task_id` | N/A | Target parent task validated; authoritatively derives `project_id`, `phase_id`, `task_list_id` from parent task. Steps receive `parent_task_id = p_parent_task_id`. |

---

## 3. Database Objects & RPC Contracts

### 3.1 `public.start_process_instance` (New Canonical Engine RPC)

```sql
CREATE OR REPLACE FUNCTION public.start_process_instance(
  p_version_id       uuid,
  p_instance_name    text,
  p_overall_due_date date DEFAULT NULL,
  p_placement_type   text DEFAULT 'standalone',
  p_project_id       uuid DEFAULT NULL,
  p_phase_id         uuid DEFAULT NULL,
  p_task_list_id     uuid DEFAULT NULL,
  p_parent_task_id   uuid DEFAULT NULL,
  p_raci_overrides   jsonb DEFAULT NULL,
  p_owner_id         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
```

**JSON Return Structure**:
```json
{
  "process_instance_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "placement_type": "standalone",
  "root_task_id": "a12bc34d-56ef-7890-abcd-ef1234567890",
  "parent_task_id": "b23cd45e-67fa-8901-bcde-fa2345678901",
  "task_count": 5
}
```

### 3.2 `public.get_process_instance_progress` (Equal-Weight Progress RPC)

```sql
CREATE OR REPLACE FUNCTION public.get_process_instance_progress(p_instance_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
```

Computes:
$$\text{Progress} = \text{ROUND}\left(\frac{\text{Completed Step Tasks}}{\text{Total Step Tasks}} \times 100.0, 2\right)$$

### 3.3 `private.can_read_process_instance` (Read Authorization Helper)

Evaluates viewing authority:
1. Direct Starter (`started_by = auth.uid()`) or Owner (`owner_id = auth.uid()`).
2. Workspace Executive Oversight (`private.can_administer_workspace` or system role `'ceo'` or `'cto'`).
3. Assigned RACI Participant on any constituent task belonging to the process instance.
4. Attached Project Member (if `placement_type <> 'standalone'` and user is member/owner of enclosing project).

### 3.4 `private.can_start_process_version` (Starter Authorization Helper)

Evaluates starting authority:
1. Executive Override (Workspace Owner/Admin or CEO/CTO system role).
2. Workspace Role Gate (Active non-viewer member).
3. Root Step Responsible Check (Assigned concrete user, dynamic `process_starter`, or active department).
4. Dynamic R/A Separation Check (Caller cannot be both Responsible and Accountable on approval-required steps).

---

## 4. Security & RLS Policy Implementation

```sql
-- Process Instances RLS Policy
ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.process_instances TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.process_instances FROM authenticated;

CREATE POLICY "process_instances_select_policy" ON public.process_instances
  FOR SELECT TO authenticated
  USING (private.can_read_process_instance(id, auth.uid()));

-- Standalone Task RLS Policy on public.tasks
CREATE POLICY "tasks_select_standalone" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    project_id IS NULL
    AND process_instance_id IS NOT NULL
    AND private.can_read_process_instance(process_instance_id, auth.uid())
  );
```

---

## 5. Automated Test Matrix & Verification

Automated test suite `scripts/test-p1-02-process-runtime.mjs` executes all 45 test cases defined in the Package 1 specification:

| Group | Test Cases | Description | Status |
| :--- | :--- | :--- | :--- |
| **Group 1: Start Validation** | Tests 1–5 | Validates standalone, project, phase, task_list, and task placement inputs. | **45/45 PASSED** |
| **Group 2: Placement Integrity** | Tests 6–10 | Enforces cross-project, cross-phase, cross-workspace, and nonexistent ID rejection. | **PASSED** |
| **Group 3: Version Validation** | Tests 11–12 | Rejects draft versions; accepts published versions. | **PASSED** |
| **Group 4: Starter Authorization** | Tests 13–18 | Validates root-step Responsible assignees, CEO/CTO/Admin overrides, rejects viewers. | **PASSED** |
| **Group 5: Runtime Data Integrity** | Tests 19–28 | Verifies single process instance row, step count, provenance, standalone parent task, RACI cloning, no fake task lists. | **PASSED** |
| **Group 6: Due Date Behavior** | Tests 29–30 | Enforces single overall due date on instance and NULL due dates on steps (Decisions 33/42). | **PASSED** |
| **Group 7: Progress Calculation** | Tests 31–33 | Verifies 0.00%, partial percentage, and 100.00% equal-weight progress calculations. | **PASSED** |
| **Group 8: Security & RLS** | Tests 34–40 | Verifies fail-closed standalone visibility, participant access, executive oversight, and anon rejection. | **PASSED** |
| **Group 9: Atomicity & Idempotency** | Tests 41–42 | Enforces all-or-nothing transactional execution and deduplication. | **PASSED** |
| **Group 10: Compatibility & Build** | Tests 43–45 | Confirms legacy `start_defined_process` intact and Vite bundle builds with 0 errors. | **PASSED** |

---

## 6. Authoritative Decision Compliance Register

- **Decision 1 & 8 (Standalone Process Container)**: Implemented via standalone parent task in `public.tasks` with `project_id = NULL` and constituent step tasks linked via `parent_task_id`.
- **Decision 3, 10 & 27 (Task-Level Placement)**: Implemented with authoritative hierarchy derivation from parent task.
- **Decision 12 & 39 (Dynamic RACI Resolution & Independent RACI)**: `process_starter` resolved to caller ID at runtime; parent task RACI is never modified when child process is attached.
- **Decision 31 (Equal-Weight Progress)**: Implemented in `public.get_process_instance_progress`.
- **Decision 32 (Minimal Lifecycle - PARKED)**: Strict lifecycle domain preserved (`running`, `completed`, `cancelled`).
- **Decision 33 & 42 (Contractual Due Date Boundary)**: One contractual due date on `process_instances.due_date`; step tasks have `due_date = NULL`.
- **Decision 38 (Standalone Process Visibility Gate)**: Standalone processes restricted to starter, owner, RACI assignees, and Workspace Executives.
