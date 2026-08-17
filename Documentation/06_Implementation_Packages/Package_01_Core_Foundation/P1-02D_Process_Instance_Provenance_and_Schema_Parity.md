# Package 1 / P1-02D: Process Instance Provenance, Schema Parity & Migration Closure

**Package**: [Package 01 — Core Foundation & Process Architecture](../../README.md)  
**Task ID**: P1-02D  
**Status**: `VERIFIED`  
**Target Supabase Project**: `gqerfixdmgbqahgslzsq`  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Authoritative Migration**: `20260817111751_p1_02d_process_instance_provenance_schema_parity.sql`  
**Preceding Deliverables**: [P1-02](./P1-02_Placement_Aware_Process_Runtime_Engine.md), [P1-02A](./P1-02A_Process_Runtime_Execution_and_Security_Closure.md), [P1-02B](./P1-02B_Production_Deployment_and_E2E_Verification.md), [P1-02C](./P1-02C_Workflow_RPC_Security_and_Real_E2E_Closure.md)

---

## 1. Executive Summary & Status

P1-02D establishes full schema parity between the canonical sequential migration chain and the production runtime environment, resolving all remaining provenance, foreign key, index, trigger, and RPC differences:
- Replaced the restrictive DP-1-D `chk_tasks_defined_provenance_coherence` check constraint with a unified 3-class check constraint accommodating normal tasks (Class A), standalone container tasks (Class B), and defined process step tasks (Class C1 legacy and Class C2 process instance).
- Dropped the inflexible composite foreign key `fk_tasks_task_list_version` and replaced it with a conditional validation trigger (`trg_validate_legacy_task_list_version`) that strictly validates `task_lists.defined_process_version_id` for legacy step tasks (`WHERE process_instance_id IS NULL`).
- Replaced table-wide unique constraint `uq_tasks_task_list_process_step` with dual partial unique indexes:
  - `uq_tasks_legacy_task_list_step`: `(task_list_id, process_step_id) WHERE process_step_id IS NOT NULL AND process_instance_id IS NULL`
  - `uq_tasks_instance_process_step`: `(process_instance_id, process_step_id) WHERE process_step_id IS NOT NULL AND process_instance_id IS NOT NULL`
- Preserved 100% backward compatibility for legacy RPC signatures:
  - `public.complete_responsible_part(uuid, text)`: Resolves current cycle and delegates to internal engine.
  - `public.reject_process_task(uuid, text, date)`: Resolves current cycle and delegates to internal engine.
- Rebuilt local database from pure sequential migrations (Migrations 1..23) with **0 manual DDL alterations**.
- Executed the expanded real database lifecycle E2E suite (`scripts/test-p1-02a-process-lifecycle.mjs`): **34/34 PASSED, 0 FAILED**.

---

## 2. Invariant Specifications

### 2.1 Task Provenance 3-Class Check Constraint
```sql
ALTER TABLE public.tasks
  ADD CONSTRAINT chk_tasks_defined_provenance_coherence CHECK (
    -- Class A: Normal / Custom Task (non-process)
    (
      process_step_id IS NULL
      AND defined_process_version_id IS NULL
      AND process_instance_id IS NULL
      AND workflow_state IS NULL
      AND current_cycle_number IS NULL
      AND ready_at IS NULL
      AND activated_at IS NULL
      AND workflow_completed_at IS NULL
      AND overdue_cycle_notified IS NULL
    )
    OR
    -- Class B: Standalone Process Container Task
    (
      process_instance_id IS NOT NULL
      AND process_step_id IS NULL
      AND defined_process_version_id IS NULL
      AND parent_task_id IS NULL
      AND project_id IS NULL
      AND milestone_id IS NULL
      AND phase_id IS NULL
      AND task_list_id IS NULL
    )
    OR
    -- Class C1: Legacy Defined Process Step Task
    (
      process_instance_id IS NULL
      AND process_step_id IS NOT NULL
      AND defined_process_version_id IS NOT NULL
      AND task_list_id IS NOT NULL
      AND milestone_id IS NOT NULL
      AND workflow_state IS NOT NULL
      AND current_cycle_number IS NOT NULL
      AND current_cycle_number >= 1
      AND overdue_cycle_notified IS NOT NULL
      AND assignee_id IS NULL
    )
    OR
    -- Class C2: New Process Instance Step Task
    (
      process_instance_id IS NOT NULL
      AND process_step_id IS NOT NULL
      AND defined_process_version_id IS NOT NULL
      AND workflow_state IS NOT NULL
      AND current_cycle_number IS NOT NULL
      AND current_cycle_number >= 1
      AND assignee_id IS NULL
    )
  );
```

### 2.2 Legacy Version Coherence Validation Trigger
```sql
CREATE OR REPLACE FUNCTION public.sync_validate_legacy_task_list_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_list_version_id uuid;
BEGIN
  IF NEW.process_instance_id IS NULL AND NEW.process_step_id IS NOT NULL THEN
    IF NEW.task_list_id IS NULL THEN
      RAISE EXCEPTION 'Legacy defined process step task must have a task_list_id.';
    END IF;

    SELECT defined_process_version_id INTO v_list_version_id
    FROM public.task_lists
    WHERE id = NEW.task_list_id;

    IF v_list_version_id IS NULL OR v_list_version_id <> NEW.defined_process_version_id THEN
      RAISE EXCEPTION 'Version coherence violation: task_list % (version: %) does not match task defined_process_version_id %.',
        NEW.task_list_id, v_list_version_id, NEW.defined_process_version_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
```

### 2.3 Dual Partial Unique Step Indexes
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_legacy_task_list_step
  ON public.tasks (task_list_id, process_step_id)
  WHERE process_step_id IS NOT NULL AND process_instance_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_instance_process_step
  ON public.tasks (process_instance_id, process_step_id)
  WHERE process_step_id IS NOT NULL AND process_instance_id IS NOT NULL;
```

---

## 3. Real Database Lifecycle Test Matrix Evidence

Command: `node scripts/test-p1-02a-process-lifecycle.mjs`  
Database: `127.0.0.1:54322` (Local PostgreSQL Container, rebuilt from migrations 1..23)  
Result: **34 PASSED, 0 FAILED**

| Suite | Tests | Scope | Status |
| :--- | :--- | :--- | :--- |
| **Suite 1** | Tests 1–6 | Standalone Process Lifecycle & DAG Advancement | **PASS** |
| **Suite 2** | Test 7 | Task List Placement & Host Immutability | **PASS** |
| **Suite 3** | Tests 8–9 | Multiple Process Instance Isolation | **PASS** |
| **Suite 4** | Tests 10–12 | Server-Enforced Idempotency & Conflict Guard | **PASS** |
| **Suite 5** | Test 13 | Live Progress Calculation Contract | **PASS** |
| **Suite 6** | Tests 14–21 | RPC Privileges, Fixed Search Path & Definer Invariants | **PASS** |
| **Suite 7** | Test 22 | Consultation & Approval Lifecycle Execution | **PASS** |
| **Suite 8** | Tests 23–27 | Comprehensive 5-Placement Lifecycle (Standalone, Project, Phase, Task List, Task) | **PASS** |
| **Suite 9** | Tests 28–30 | Same-Process Multi-Instance Collision Invariant | **PASS** |
| **Suite 10** | Tests 31–34 | Legacy Defined Process Invariants & Backward Compatibility | **PASS** |

---

- `scripts/verify-p1-02d-schema-parity.mjs`: **19/19 PASSED, 0 FAILED**
- `scripts/test-p1-02-process-runtime.mjs`: **45/45 PASSED, 0 FAILED**
- `scripts/test-p1-01-foundation.mjs`: **45/45 PASSED, 0 FAILED**
- `scripts/test-p0-auth-hotfix.mjs`: **30/30 PASSED, 0 FAILED**
- `scripts/test-auth-harness-safety.mjs`: **7/7 PASSED, 0 FAILED**
- `scripts/test-v1-03a-hotfix.mjs`: **20/20 PASSED, 0 FAILED**
- `scripts/verify-doc-links.mjs`: **159/159 Links Verified (0 errors)**
- `npm run lint`: **0 errors**
- `npm run build`: **Built successfully with 0 errors (846ms)**

> [!NOTE]
> **Security Advisor Baseline Clarification**: In P1-02D, `public.sync_validate_legacy_task_list_version` was initially created in the `public` schema as a `SECURITY DEFINER` function, which introduced an `authenticated_security_definer_function_executable` warning. This was cleanly resolved in [P1-02E](./P1-02E_Legacy_Version_Trigger_Security_Closure.md) by moving the trigger function to `private.sync_validate_legacy_task_list_version()`, preserving the expected baseline of 6 warnings (5 historical workflow functions + 1 auth leaked-password warning).
