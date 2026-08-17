# P1-01A Process Instance Access Hardening

## Document Control
- **Status**: `VERIFIED`
- **Package**: Package 1 — Core Foundation
- **Implementation Commit**: Current working commit
- **Canonical Migration**: `20260817064609_p1_01_process_instance_access_hardening.sql`
- **Target Project**: `gqerfixdmgbqahgslzsq` (SNS Projects Production)
- **Date**: 2026-08-17
- **Last Verified Date**: 2026-08-17

---

## 1. Issue Found & Independent Verification

During independent post-deployment inspection of the P1-01 foundation migration (`20260817063502_core_hierarchy_process_instance_foundation.sql`), an access-control discrepancy was detected:
1. **Overly Broad Table Privileges**: The `authenticated` role inadvertently retained standard table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) on `public.process_instances`.
2. **Overly Broad SELECT Policy**: A workspace-wide policy (`process_instances_select_member`) allowed any active workspace member to read all `process_instances` records.

---

## 2. Risk & Root Cause Analysis

### Risk
Under the approved future access model, Standalone Process Instances and confidential operational workflows must only be visible to:
- Process Starter
- Assigned Process Owner
- RACI Participants
- Executive Oversight (Workspace Owner, CEO, CTO, System Admin)

Allowing arbitrary workspace members to query all `process_instances` rows would violate confidentiality boundaries once standalone and department-scoped processes are instantiated.

### Root Cause
The initial foundation migration included a standard workspace-member SELECT policy before the granular placement-aware and participant-aware authorization models were finalized for P1-02. Additionally, default table privileges were not explicitly stripped from the `authenticated` role.

---

## 3. Security Correction Implemented

Forward migration `20260817064609_p1_01_process_instance_access_hardening.sql` executes the following corrective actions:

1. **Dropped Broad SELECT Policy**:
   ```sql
   DROP POLICY IF EXISTS "process_instances_select_member" ON public.process_instances;
   ```
2. **Revoked All Direct Table Privileges**:
   ```sql
   REVOKE ALL ON TABLE public.process_instances FROM PUBLIC, anon, authenticated;
   ```
3. **Restricted Access to Internal Backend Roles**:
   ```sql
   GRANT ALL ON TABLE public.process_instances TO service_role, postgres;
   ```
4. **Maintained Row Level Security**:
   ```sql
   ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;
   ```

---

## 4. Final Security State

| Role | SELECT | INSERT | UPDATE | DELETE | RLS Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`anon`** | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | RLS Enabled (Fail-Closed) |
| **`authenticated`** | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | RLS Enabled (Fail-Closed) |
| **`service_role`** | ✅ ALLOWED | ✅ ALLOWED | ✅ ALLOWED | ✅ ALLOWED | Bypass RLS (Backend Only) |
| **`postgres`** | ✅ ALLOWED | ✅ ALLOWED | ✅ ALLOWED | ✅ ALLOWED | Superuser (Administrative) |

---

## 5. Verification & Tests

The automated test suite in [`scripts/test-p1-01-foundation.mjs`](file:///C:/Users/Abhinand/OneDrive/Desktop/stacknstock-projects/scripts/test-p1-01-foundation.mjs) confirms:
- `process_instances` RLS is enabled.
- Zero direct table privileges exist for `PUBLIC`, `anon`, and `authenticated`.
- `process_instances_select_member` policy does not exist.
- No direct DML policies exist.
- `process_instances` table row count remains **`0`**.

---

## 6. Residual Risks & Next Steps

- **Residual Risks**: None. Direct client access is completely blocked until explicit RPC interfaces and participant policies are introduced.
- **Next Step**: Package 1 / P1-02 will implement the placement-aware runtime RPCs and participant-filtered SELECT policies.
