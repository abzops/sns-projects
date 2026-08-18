# Package 2 / P2-03 — Parent Task Completion and Runtime Closure

**Status**: `VERIFIED`

**Target Supabase Project**: `gqerfixdmgbqahgslzsq`

**Authoritative Migration**: `20260817142153_p2_03_parent_completion_runtime.sql`

**Migration Number**: 29

**Preceding Deliverable**: [P2-02A Post-Cancellation Immutability Final Closure](./P2-02A_Post_Cancellation_Immutability_Closure.md)

---

## 1. Scope

P2-03 completes the server-side parent Task and Process Instance closure contract. It does not add Package 3 UI or Finance behavior.

A normal parent Task now closes automatically only when it has at least one closure dependency and both conditions are true:

1. Every ordinary direct child Task is in the project’s canonical Done status.
2. Every directly attached Process Instance is either `completed` or `cancelled`.

An ordinary child is exactly a Task with both `process_instance_id IS NULL` and `process_step_id IS NULL`. Materialized Process step Tasks are therefore excluded and cannot be double-counted.

---

## 2. Database Runtime

### 2.1 Closure helpers

- `private.resolve_project_done_status(uuid)` resolves `system_code = 'done'`, with an exact case-insensitive `Done` name fallback, and fails closed when no canonical status exists.
- `private.get_task_closure_state(uuid)` returns ordinary-child and attached-process totals, closed/open counts, and aggregate closure flags.
- `private.try_auto_complete_parent_task(uuid, uuid, boolean)` locks the candidate parent, excludes Defined Process steps and standalone containers, performs an idempotent Done transition, and emits one `PARENT_TASK_AUTO_COMPLETED` audit event.

The dependency-removal flag is used only when a child or Process Instance moves away or is deleted. It allows the previous host to close after its final dependency is removed without weakening the invariant that untouched leaf Tasks do not auto-complete.

### 2.2 Task hierarchy enforcement

Task triggers enforce these rules server-side:

- Manual Done transitions fail while any ordinary child or attached Process Instance remains open.
- Creating, attaching, or reopening an ordinary child beneath a Done parent fails until the parent is reopened.
- Final child completion propagates through nested ordinary parent Tasks.
- A Task with no closure dependencies remains manually controlled.

### 2.3 Process Instance enforcement

Process Instance triggers enforce these rules:

- A running instance cannot start or move onto a Done host Task.
- An instance can transition to `completed` only from `running` and only when every materialized Process step has `workflow_state = 'completed'`.
- Cancelled steps do not qualify a running instance for completion.
- Completion, cancellation, placement movement, and removal reevaluate the affected Task hosts.
- A standalone container Task mirrors terminal instance state: `completed` sets `workflow_completed_at`; `cancelled` remains cancelled.

`public.get_process_instance_progress(uuid)` already used the required equal-weight formula and counts only `workflow_state = 'completed'`. P2-03 preserves that implementation, so cancelled Process Instances can retain partial progress.

### 2.4 Security

All seven new private helpers/trigger functions are `SECURITY DEFINER` with `SET search_path = ''`. Direct execution is revoked from `PUBLIC`, `anon`, and `authenticated`, while trusted server roles retain execution. P2-03 does not alter the five accepted historical public `SECURITY DEFINER` warnings.

---

## 3. Verification

### 3.1 Clean migration replay

- `scripts/rebuild-local-db-from-migrations.mjs`: **29/29 migrations applied, 0 errors**.
- No historical migration was edited and no manual schema repair was used.

### 3.2 Focused real-PostgreSQL suite

`scripts/test-p2-03-parent-completion.mjs`: **17/17 PASS**.

The suite proves leaf behavior, manual closure rejection, final-child closure, nested propagation, running/completed/cancelled attached instances, multiple instances, combined child/process dependencies, standalone completion synchronization, strict Process completion eligibility, partial cancelled progress, movement-away reevaluation, Done-host placement rejection, ordinary-child placement rejection, idempotent audit behavior, and private-function hardening.

### 3.3 Impacted regressions

| Verification | Result |
| :--- | :---: |
| `scripts/test-p2-02-process-movement-cancellation.mjs` | **44/44 PASS** |
| `scripts/test-p1-02a-process-lifecycle.mjs` | **34/34 PASS** |
| `scripts/verify-p2-01-phase-rename.mjs` | **37/37 PASS** |
| `scripts/verify-zero-legacy-milestones.mjs` | **8/8 PASS** |
| `scripts/verify-doc-links.mjs` | **PASS** |
| `npm run lint` | **0 errors** |
| `npm run build` | **PASS** |

---

## 4. Production Deployment

Production deployment was completed through the Supabase CLI's direct PostgreSQL path:

- `supabase db push --dry-run --db-url ...` reported exactly one pending migration: `20260817142153_p2_03_parent_completion_runtime.sql`.
- `supabase db push --db-url ...` applied that migration successfully without `link`, `login`, migration repair, or `db pull`.
- Production migration history now ends at `20260817142153_p2_03_parent_completion_runtime`.
- Read-only catalog verification found all seven expected private `SECURITY DEFINER` functions and all four enabled triggers. Every function has an empty search path; direct execution is revoked from `anon` and `authenticated` and retained for `service_role`.
- Production source verification confirmed ordinary-child runtime exclusion, cancellation-as-closure, strict all-step completion, standalone container synchronization, and immutable parent auto-completion audit emission.
- The post-deployment data snapshot contained 0 Process Instances, 0 runtime Tasks, 30 total Tasks, and 9 Process audit events.
- Security Advisor remained at the accepted six-warning baseline: five historical public `SECURITY DEFINER` RPC warnings and one Auth leaked-password-protection warning, with no P2-03 warning added.
