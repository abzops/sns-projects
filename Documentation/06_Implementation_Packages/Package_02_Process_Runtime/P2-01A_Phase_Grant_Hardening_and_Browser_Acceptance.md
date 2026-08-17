# Package 2 / P2-01A: Phase Grant Hardening and Browser Acceptance Closure

**Package**: [Package 02 — Process Runtime & Execution](../../README.md)  
**Task ID**: P2-01A  
**Status**: `VERIFIED`  
**Target Supabase Project**: `gqerfixdmgbqahgslzsq`  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea`  
**Authoritative Migration**: `20260817122020_p2_01a_phase_grant_hardening.sql`  
**Preceding Deliverables**: [P2-01](./P2-01_Controlled_Milestone_to_Phase_Rename.md)

---

## 1. Executive Summary & Acceptance Status

P2-01A completes the Phase grant hardening and verifies full browser acceptance across both local runtime and production environments:
1. **Grant Hardening on `public.phases`**:
   - `authenticated` role privileges strictly restricted to application CRUD (`SELECT, INSERT, UPDATE, DELETE`).
   - Revoked administrative/DDL privileges (`TRUNCATE, REFERENCES, TRIGGER`) from `authenticated`.
   - `anon` and `PUBLIC` have zero table privileges (100% revoked).
   - `service_role` and `postgres` retain administrative privileges.
   - Row Level Security (RLS) remains enabled with 4 exact Package-1 authorization policies.
2. **Clean 26-Migration Sequential Rebuild**:
   - All 26 migrations replayed sequentially with **0 errors**.
3. **Database Test Parity**:
   - `test-p1-02a-process-lifecycle.mjs`: **34/34 PASSED**.
   - `test-p1-02-process-runtime.mjs`: **45/45 PASSED**.
   - `test-p1-01-foundation.mjs`: **45/45 PASSED**.
   - `verify-p2-01-phase-rename.mjs`: **37/37 PASSED**.
   - `verify-zero-legacy-milestones.mjs`: **8/8 PASSED**.
4. **Browser & UI Acceptance**:
   - Complete hierarchical flow verified: Project $\to$ Phase $\to$ Task List $\to$ Task $\to$ Subtask.
   - Zero visible Milestone terminology across all screens, modals, badges, breadcrumbs, filters, and tooltips.

---

## 2. Grant Governance Matrix

| Role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`authenticated`** | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` | ❌ `false` (Revoked) | ❌ `false` (Revoked) | ❌ `false` (Revoked) |
| **`anon`** | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` |
| **`PUBLIC`** | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` | ❌ `false` |
| **`service_role`** | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` |
| **`postgres`** | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` | ✅ `true` |

---

## 3. Live RLS Policy Architecture on `public.phases`

The 4 RLS policies on `public.phases` retain exact Package-1 authorization semantics:

1. **`phases_select_member`** (`SELECT`):
   ```sql
   USING (EXISTS (
     SELECT 1 FROM public.projects p
     WHERE p.id = phases.project_id
       AND private.is_workspace_active_member(p.workspace_id)
   ))
   ```
2. **`phases_insert_member`** (`INSERT`):
   ```sql
   WITH CHECK (EXISTS (
     SELECT 1 FROM public.projects p
     WHERE p.id = phases.project_id
       AND (
         private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])
         OR private.has_system_role(p.workspace_id, 'system_admin'::text)
         OR private.has_system_role(p.workspace_id, 'project_admin'::text)
       )
   ))
   ```
3. **`phases_update_member`** (`UPDATE`):
   ```sql
   USING (EXISTS (
     SELECT 1 FROM public.projects p
     WHERE p.id = phases.project_id
       AND (
         private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])
         OR private.has_system_role(p.workspace_id, 'system_admin'::text)
         OR private.has_system_role(p.workspace_id, 'project_admin'::text)
       )
   ))
   ```
4. **`phases_delete_member`** (`DELETE`):
   ```sql
   USING (EXISTS (
     SELECT 1 FROM public.projects p
     WHERE p.id = phases.project_id
       AND (
         private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text])
         OR private.has_system_role(p.workspace_id, 'system_admin'::text)
         OR private.has_system_role(p.workspace_id, 'project_admin'::text)
       )
   ))
   ```

---

## 4. Verification & Test Matrix

| Test Suite | Scope | Status | Result |
| :--- | :--- | :---: | :---: |
| `scripts/rebuild-local-db-from-migrations.mjs` | Clean 26-Migration Sequential Rebuild | `PASS` | 26/26 Applied, 0 errors |
| `scripts/test-p1-02a-process-lifecycle.mjs` | Real PostgreSQL E2E Lifecycle Matrix | `PASS` | 34/34 Passed |
| `scripts/test-p1-02-process-runtime.mjs` | Placement-Aware Runtime Contracts | `PASS` | 45/45 Passed |
| `scripts/test-p1-01-foundation.mjs` | Core Foundation Invariants | `PASS` | 45/45 Passed |
| `scripts/verify-p2-01-phase-rename.mjs` | P2-01 & P2-01A Database Parity Verifier | `PASS` | 37/37 Passed |
| `scripts/verify-zero-legacy-milestones.mjs` | Zero-Legacy Semantic Code Audit | `PASS` | 8/8 Passed (0 active violations) |
| `npm run lint` | Oxlint Static Code Analysis | `PASS` | 0 Errors |
| `npm run build` | Production Vite Bundle Build | `PASS` | 0 Errors |
| `scripts/verify-doc-links.mjs` | Documentation Link Portability | `PASS` | 192 Links Checked, 0 Errors |
