# Package 1 / P1-02E: Legacy Version Trigger Security Closure

**Package**: [Package 01 — Core Foundation & Process Architecture](../../README.md)  
**Task ID**: P1-02E  
**Status**: `VERIFIED`  
**Target Supabase Project**: `gqerfixdmgbqahgslzsq`  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Authoritative Migration**: `20260817113427_p1_02e_legacy_version_trigger_security_closure.sql`  
**Preceding Deliverables**: [P1-02D](./P1-02D_Process_Instance_Provenance_and_Schema_Parity.md)

---

## 1. Executive Summary & Status

P1-02E resolves the remaining Supabase Security Advisor warning introduced during P1-02D:
- **Root Cause**: `public.sync_validate_legacy_task_list_version()` was created in the `public` schema with `SECURITY DEFINER` and granted to `authenticated`, causing an `authenticated_security_definer_function_executable` Security Advisor warning.
- **Remediation**:
  1. Created `private.sync_validate_legacy_task_list_version()` with `SECURITY DEFINER` and fixed `SET search_path = ''`.
  2. Revoked direct `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`, granting execution strictly to `service_role` and `postgres`.
  3. Re-bound `trg_validate_legacy_task_list_version` on `public.tasks` to target `private.sync_validate_legacy_task_list_version()`.
  4. Dropped `public.sync_validate_legacy_task_list_version()` from the public API surface.
- Clean sequential migration rebuild (Migrations 1..24) executed with **0 errors**.
- Real PostgreSQL database lifecycle E2E suite (`scripts/test-p1-02a-process-lifecycle.mjs`): **34/34 PASSED, 0 FAILED**.
- Test 31 explicitly verified that legacy version mismatch protection remains 100% active and enforced.

---

## 2. Security Invariants & DDL Specification

### 2.1 Private Trigger Helper Function
```sql
CREATE OR REPLACE FUNCTION private.sync_validate_legacy_task_list_version()
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

REVOKE ALL ON FUNCTION private.sync_validate_legacy_task_list_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_validate_legacy_task_list_version() TO service_role, postgres;
```

### 2.2 Trigger Rebinding
```sql
DROP TRIGGER IF EXISTS trg_validate_legacy_task_list_version ON public.tasks;
CREATE TRIGGER trg_validate_legacy_task_list_version
  BEFORE INSERT OR UPDATE OF task_list_id, process_step_id, defined_process_version_id, process_instance_id
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_validate_legacy_task_list_version();
```

---

## 3. Security Advisor Baseline

Following P1-02E, the single newly introduced warning for `sync_validate_legacy_task_list_version` is eliminated. The expected baseline is exactly **6 warnings**:
- **5 Historical Workflow RPC Warnings** (to be addressed in subsequent workflow packages):
  1. `public.approve_process_task`
  2. `public.publish_defined_process_version`
  3. `public.start_defined_process`
  4. `public.submit_task_consultation`
  5. `public.submit_task_evidence`
- **1 Auth Warning**:
  - `Leaked Password Protection Disabled` (Managed via Supabase Project Settings).

---

## 4. Verification Evidence

- `scripts/verify-p1-02d-schema-parity.mjs`: **25/25 PASSED, 0 FAILED**
- `scripts/test-p1-02a-process-lifecycle.mjs`: **34/34 PASSED, 0 FAILED**
- `scripts/test-p1-02-process-runtime.mjs`: **45/45 PASSED, 0 FAILED**
- `scripts/test-p1-01-foundation.mjs`: **45/45 PASSED, 0 FAILED**
- `scripts/test-p0-auth-hotfix.mjs`: **30/30 PASSED, 0 FAILED**
- `scripts/test-auth-harness-safety.mjs`: **7/7 PASSED, 0 FAILED**
- `scripts/test-v1-03a-hotfix.mjs`: **20/20 PASSED, 0 FAILED**
- `scripts/verify-doc-links.mjs`: **175/175 Links Verified (0 errors)**
- `npm run lint`: **0 errors**
- `npm run build`: **Built in 775ms (0 errors)**
