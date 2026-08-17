# Package 2 / P2-02A — Post-Cancellation Immutability Final Closure

**Status**: `VERIFIED`

**Target Supabase Project**: `gqerfixdmgbqahgslzsq`

**Authoritative Migration**: `20260817132234_p2_02a_post_cancellation_immutability.sql`

**Migration Number**: 28

**Preceding Deliverable**: [P2-02 Process Instance Movement, Cancellation, Authorization & Audit](./P2-02_Process_Instance_Movement_Cancellation_Authorization.md)

---

## 1. Closure Scope

P2-02A closes two independently verified post-cancellation mutation gaps without redesigning the Process Instance runtime or changing legacy Task-List Defined Process behavior:

1. `public.submit_task_evidence(uuid, uuid, text, jsonb)` previously allowed a Responsible participant to insert evidence after the parent Process Instance had been cancelled.
2. `private.complete_task_and_advance(uuid, uuid)` previously trusted its callers and could mutate a cancelled/non-running Process Instance if invoked directly or reached through an insufficiently guarded path.

No Package 3 or Finance functionality is included.

---

## 2. Database Fixes

### 2.1 Evidence Submission Guard

For tasks with a non-null `process_instance_id`, `public.submit_task_evidence` now:

1. Loads the parent `public.process_instances` row.
2. Rejects a missing parent row.
3. Requires `process_instances.status = 'running'`.
4. Rejects `tasks.workflow_state = 'cancelled'`.
5. Performs all checks before inserting into `public.task_evidence_submissions`.

The existing signature, `SECURITY DEFINER` configuration, fixed `search_path`, Responsible-participant authorization, evidence-definition validation, and legacy Task-List branch are preserved.

### 2.2 Internal DAG Advancement Guard

In the Process Instance branch, `private.complete_task_and_advance` now checks the loaded parent and task before any task update, downstream activation, notification, audit insertion, or Process Instance completion:

```sql
IF v_instance.status <> 'running' THEN
  RAISE EXCEPTION ...;
END IF;

IF v_task.workflow_state = 'cancelled' THEN
  RAISE EXCEPTION ...;
END IF;
```

The legacy Task-List Defined Process branch is unchanged.

### 2.3 Internal Privilege Hardening

Direct execution of `private.complete_task_and_advance(uuid, uuid)` is unnecessary for browser roles. P2-02A therefore revokes `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`, while retaining trusted internal execution for `service_role` and `postgres`.

---

## 3. Verification

### 3.1 Clean Migration Replay

- `scripts/rebuild-local-db-from-migrations.mjs`: **28/28 migrations applied, 0 errors**.
- No manual schema patches were applied.

### 3.2 Real PostgreSQL Regression Matrix

| Verification | Result |
| :--- | :---: |
| `scripts/test-p2-02-process-movement-cancellation.mjs` | **44/44 PASS** |
| `scripts/test-p1-02a-process-lifecycle.mjs` | **34/34 PASS** |
| `scripts/test-p1-02-process-runtime.mjs` | **45/45 PASS** |
| `scripts/test-p1-01-foundation.mjs` | **45/45 PASS** |
| `scripts/verify-p2-01-phase-rename.mjs` | **37/37 PASS** |
| `scripts/verify-zero-legacy-milestones.mjs` | **8/8 PASS** |

The expanded P2-02 suite proves that after cancellation:

- Responsible completion, consultation, approval, and rejection/rework fail.
- Evidence submission fails and `task_evidence_submissions` count does not increase.
- Direct internal advancement fails.
- The Process Instance remains `cancelled`; completed tasks remain completed; unfinished tasks remain cancelled.
- Rejected internal advancement creates no audit event or notification.
- Direct helper execution is unavailable to `authenticated` and `anon`.

---

## 4. Deployment and Production Verification

Production deployment and verification completed through the Supabase CLI and read-only database inspection:

- Local and production migration histories matched exactly through P2-02 before deployment.
- `npx supabase db push --dry-run` reported exactly one pending migration: `20260817132234_p2_02a_post_cancellation_immutability.sql`.
- `npx supabase db push` applied P2-02A directly; no wrapper, SQL Editor, fixtures, repair, pull, or database reset was used.
- Production migration tip is `20260817132234_p2_02a_post_cancellation_immutability`.
- Process Instance rows remained `0`; Process Instance step-task rows remained `0`.
- Production function definitions contain both running-state and cancelled-task guards.
- Direct internal-helper `EXECUTE` is false for `authenticated` and `anon`, and true for `service_role`.
- Movement and cancellation public/internal function-definition hashes exactly match the verified local database.
- Security Advisor remains the accepted baseline: 5 historical `authenticated_security_definer_function_executable` warnings plus 1 leaked-password-protection warning, with 0 new warnings.

---

## 5. Cleanup

The package-specific `scripts/apply-p2-02-migration.mjs` production deployment wrapper was removed. No replacement wrapper was created; production migration deployment remains a direct Supabase CLI operation.
