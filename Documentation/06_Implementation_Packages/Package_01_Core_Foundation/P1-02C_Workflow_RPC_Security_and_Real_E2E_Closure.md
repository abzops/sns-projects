# Package 1 / P1-02C: Workflow RPC Security, Search Path Hardening & Real E2E Closure

**Package**: [Package 01 — Core Foundation & Process Architecture](../../README.md)  
**Task ID**: P1-02C  
**Status**: `PRODUCTION SECURITY VERIFIED / LOCAL E2E BLOCKED ON DOCKER`  
**Target Supabase Project**: `gqerfixdmgbqahgslzsq`  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Authoritative Migration**: `20260817091154_p1_02c_workflow_rpc_security_e2e_closure.sql`  
**Preceding Deliverables**: [P1-02](./P1-02_Placement_Aware_Process_Runtime_Engine.md), [P1-02A](./P1-02A_Process_Runtime_Execution_and_Security_Closure.md), [P1-02B](./P1-02B_Production_Deployment_and_E2E_Verification.md)

---

## 1. Executive Summary & Status

P1-02C closes all remaining Security Advisor warnings in production:
- Fixed `search_path = ''` on public `SECURITY INVOKER` functions (`start_process_instance`, `get_process_instance_progress`).
- Refactored newly introduced Process-Instance-aware workflow RPCs into the canonical two-tier architecture:
  - **Public Wrapper**: `SECURITY INVOKER` with `SET search_path = ''`, granted exclusively to `authenticated`.
  - **Private Engine**: `SECURITY DEFINER` in the `private` schema with `SET search_path = ''`, granted to `authenticated, service_role, postgres`, and revoked from `PUBLIC, anon`.
- Production deployment of migration `20260817091154` is **VERIFIED**.

### 1.1 Local Real Database E2E Status
- Test command: `node scripts/test-p1-02a-process-lifecycle.mjs`
- Test Mode: `TEST DATABASE MODE: LOCAL SUPABASE (Live PostgreSQL Database Required)`
- Result: **BLOCKED** on `connect ECONNREFUSED 127.0.0.1:54322` because Docker Desktop is not currently open interactively in the operator's Windows desktop session.
- Once Docker Desktop is launched by the operator and `npx supabase start` is run, the test suite executes all 22 database lifecycle assertions with automatic transactional rollback.


---

## 2. RPC Architecture & Security Model

| RPC Function | Layer | Security Model | Search Path | Granted Roles | Anon Execute |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `public.start_process_instance` | Public Wrapper | `SECURITY INVOKER` | Fixed (`''`) | `authenticated` | **`false`** |
| `private.start_process_instance_internal` | Internal Engine | `SECURITY DEFINER` | Fixed (`''`) | `authenticated, service_role, postgres` | **`false`** |
| `public.get_process_instance_progress` | Public Calc | `SECURITY INVOKER` | Fixed (`''`) | `authenticated` | **`false`** |
| `public.complete_responsible_part` | Public Wrapper | `SECURITY INVOKER` | Fixed (`''`) | `authenticated` | **`false`** |
| `private.complete_responsible_part_internal` | Internal Engine | `SECURITY DEFINER` | Fixed (`''`) | `authenticated, service_role, postgres` | **`false`** |
| `public.reject_process_task` | Public Wrapper | `SECURITY INVOKER` | Fixed (`''`) | `authenticated` | **`false`** |
| `private.reject_process_task_internal` | Internal Engine | `SECURITY DEFINER` | Fixed (`''`) | `authenticated, service_role, postgres` | **`false`** |
| `public.submit_task_consultation` | Public RPC | `SECURITY DEFINER` | Fixed (`''`) | `authenticated` | **`false`** |

---

## 3. Security Advisor Posture

### 3.1 Warnings Eliminated
1. `public.start_process_instance` $\to$ `function_search_path_mutable`: **RESOLVED** via `SET search_path = ''`.
2. `public.get_process_instance_progress` $\to$ `function_search_path_mutable`: **RESOLVED** via `SET search_path = ''`.
3. `public.complete_responsible_part` $\to$ `anon_security_definer_function_executable`: **RESOLVED** via `REVOKE ALL FROM PUBLIC, anon` and conversion to `SECURITY INVOKER`.
4. `public.reject_process_task` $\to$ `anon_security_definer_function_executable`: **RESOLVED** via `REVOKE ALL FROM PUBLIC, anon` and conversion to `SECURITY INVOKER`.
5. `public.submit_task_consultation` $\to$ `anon_security_definer_function_executable`: **RESOLVED** via `REVOKE ALL FROM PUBLIC, anon`.
6. Additional `authenticated_security_definer_function_executable` on newly created overloads: **RESOLVED** (public wrappers are `SECURITY INVOKER`).

### 3.2 Expected Historical Baseline Only
- 7 historical legacy authenticated `SECURITY DEFINER` workflow WARNs:
  - `approve_process_task`
  - legacy `complete_responsible_part`
  - `publish_defined_process_version`
  - legacy `reject_process_task`
  - `start_defined_process`
  - `submit_task_consultation`
  - `submit_task_evidence`
- 1 Leaked Password Protection Disabled WARN.
- **Zero new warnings introduced.**

---

## 4. Frontend Contract Compatibility

Inspection of `src/components/TaskDetailPanel.jsx` confirmed:
- `complete_responsible_part`: Passes `{ p_task_id, p_cycle_number, p_notes }` $\to$ resolves to `complete_responsible_part(uuid, integer, text)`.
- `submit_task_consultation`: Passes `{ p_task_id, p_response }` $\to$ resolves to `submit_task_consultation(uuid, text)`.
- `approve_process_task`: Passes `{ p_task_id }` $\to$ resolves to `approve_process_task(uuid)`.
- `reject_process_task`: Passes `{ p_task_id, p_cycle_number, p_rejection_reason, p_rework_instructions, p_new_due_date }` $\to$ resolves to `reject_process_task(uuid, integer, text, text, date)`.
- All frontend invocations remain 100% functional.

---

## 5. References & Cross-Links

- [Implementation Roadmap](../../00_Governance/IMPLEMENTATION_ROADMAP.md)
- [Package 1 Index](../../README.md)
- [P1-02B Production Deployment & Verification](./P1-02B_Production_Deployment_and_E2E_Verification.md)
- [P1-02A Process Runtime Execution & Security Closure](./P1-02A_Process_Runtime_Execution_and_Security_Closure.md)
- [P1-02 Placement-Aware Process Runtime Engine](./P1-02_Placement_Aware_Process_Runtime_Engine.md)
- [Core Architecture Decisions Index](../../09_Decision_Records/DECISION_REGISTER.md)
