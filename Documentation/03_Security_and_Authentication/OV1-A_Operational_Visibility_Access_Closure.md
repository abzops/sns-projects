# SNS Projects — OV1-A Operational Visibility Access Closure

**Status**: **`VERIFIED`**  
**Date**: 2026-08-18  
**Implementation Commit**: `6fdfbbfa9d1f0f8c84a81ac848be75c4294dd8b8`  
**Production Migration**: `20260818110545_ov1_a_operational_visibility_closure.sql`

---

## 1. Enforced Visibility Model

Workspace membership is a tenancy prerequisite, not an organization-wide operational read grant.

- Active users with a System Role of `ceo`, `cto`, `project_admin`, or `system_admin` retain broad operational visibility.
- Active users without one of those System Roles see only Tasks in which they participate, assigned Subtasks, relevant Process runtime work, and the minimum Task List, Phase, Project, and parent-Task ancestors required for context.
- Direct legacy `tasks.assignee_id`, Task RACI A/R/C/I, active department-targeted RACI membership, Subtask assignment, Process starter/owner, and materialized Process-step participation are supported involvement paths.
- Unrelated sibling Tasks and unrelated Project hierarchies remain invisible. Direct queries and deep links return zero unauthorized rows.
- Workspace Owner/Admin/Member/Viewer roles do not independently grant broad operational visibility. Viewer remains read-only.

## 2. Database Enforcement

Private, `auth.uid()`-bound `SECURITY DEFINER` helpers enforce scoped reads for Projects, Phases, Task Lists, Tasks, Subtasks, and Process Instances. The helpers use an empty `search_path`; `PUBLIC` and `anon` execution are revoked; only the explicit policy-facing authenticated contract is granted.

Scoped SELECT policies cover:

- `projects`, `phases`, `task_lists`, `tasks`, `subtasks`, `task_statuses`
- `task_raci_assignments`
- `process_instances`, `process_audit_events`
- approval cycles, consultation responses, evidence submissions, and Assignee-completion rows

Six targeted indexes back active membership, Project tenancy, direct assignment, RACI, Subtask assignment, and active department membership predicates. P1/P2/P3 runtime transition, movement, cancellation, post-cancellation immutability, and parent-completion functions were not changed.

## 3. Frontend Capability Separation

`useUserContext` now exposes independent concepts instead of the retired conflated `isAdmin` flag:

- `canAdministerWorkspace`
- `hasGlobalOperationalVisibility`
- `canMutateOperationalData`
- `isViewer` / `isReadOnly`

Administration navigation and Process draft governance continue using workspace-administration authority. Operational screens consume RLS-filtered data, while mutation controls follow the separate mutation capability. Frontend filtering is not the security boundary.

## 4. Verification Evidence

| Gate | Result |
| :--- | :---: |
| Clean sequential migration replay | **PASS — 30/30** |
| OV1-A authorization matrix | **PASS — 30 assertions** |
| P1-02A lifecycle | **PASS — 34/34** |
| P2-02 movement/cancellation/immutability | **PASS — 44/44** |
| P2-03 parent/runtime closure | **PASS — 17/17** |
| Frontend capability contract | **PASS** |
| Operational auth/performance regression | **PASS — 19 contracts** |
| Process Definition access regression | **PASS — 10 contracts** |
| Zero active Milestone terminology | **PASS — 8/8** |
| Lint | **PASS — 0 errors** |
| Production build | **PASS** |
| Production migration tip | **PASS — `20260818110545`** |
| Production helper/policy/RLS/index verification | **PASS** |
| Production System Role and scoped-role reads | **PASS** |
| Production unrelated deep-link denial | **PASS** |

Supabase Security Advisor remains exactly the accepted six-warning baseline: five intentional signed-in workflow `SECURITY DEFINER` RPC warnings and one leaked-password-protection warning. OV1-A introduced no new Security Advisor warning. See the [function lint guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 5. Scope Boundary

OV1-A adds no dashboard, Finance, Package 4, fake production data, or parallel hierarchy model. Operational V1 remains **`READY FOR MANUAL FINAL ACCEPTANCE`**; this closure does not declare FULL V1.
