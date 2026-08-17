# SNS Projects — Kanban Integrity Closure Report (Pre-DP1 Production Gate)

**Date:** August 14, 2026  
**Status:** Complete & Production Verified  
**Target Workspace:** `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects)  
**Database Host:** `db.gqerfixdmgbqahgslzsq.supabase.co`  
**Migration:** `supabase/migrations/20260814173224_enforce_deterministic_kanban_ordering.sql`  

---

## 1. Executive Summary

This report documents the complete resolution and closure of the pre-existing Kanban persistence integrity blocker prior to the Defined Process Engine (DP-1) migration.

All four integrity issues have been permanently resolved:
1. **Production Task Status Pollution:** All 24 structured business tasks across all 3 projects have been restored to their exact canonical statuses.
2. **Duplicate Persisted Positions:** All positions have been normalized to deterministic, monotonic multiples of `1000, 2000, 3000...`. Querying `GROUP BY project_id, status_id, position HAVING count(*) > 1` returns **0 duplicate groups**.
3. **RPC Contract Upgrade:** `public.reorder_kanban_tasks` has been upgraded to a strict 4-argument signature requiring complete source and destination arrays, row-level locking (`FOR UPDATE`), set-equality validation, and atomic renumbering under `SECURITY INVOKER`.
4. **Test Isolation Guarantee:** Automated Kanban tests now execute against isolated temporary task fixtures with guaranteed `try/finally` cleanup and assert zero mutation of baseline business tasks.

---

## 2. Root Cause Analysis

### A. Status Pollution in Prior Kanban Tests
Earlier automated test suites (`scripts/test-kanban-dnd-contracts.mjs` and `scripts/test-task-experience-hotfix.mjs`) mutated real business tasks (e.g. `Freeze Site Layout` and `Freeze PLC I/O Map`) in place during test execution and attempted naive manual restoration that drifted over subsequent test runs.

### B. Duplicate Positions & 3-Argument RPC Limitations
The previous RPC contract `reorder_kanban_tasks(p_task_id, p_new_status_id, p_task_ids)` accepted only a single array. When moving across columns:
- The destination column received updated positions based on the array.
- The source column was **not** renumbered, leaving gaps, duplicate indices, or non-deterministic ordering among remaining tasks.
- If a user filtered cards on the frontend, dragging a filtered card passed only visible IDs to the RPC, omitting hidden siblings.

---

## 3. Pre-Repair Backup & Verification

Prior to executing any database updates, a complete pre-repair snapshot of the entire workspace dataset was generated and stored locally in `data-backups/pre-kanban-repair-snapshot.json` (gitignored).

The snapshot captured:
- **3 Projects**
- **6 Milestones**
- **12 Task Lists**
- **24 Tasks**
- **48 Subtasks**
- **72 RACI Assignments**

---

## 4. Database Repair & Position Normalization

Using `scripts/repair-kanban-status-and-positions.mjs`, all 24 tasks were restored to canonical baseline statuses and sequentially assigned positions with exact 1000 spacing:

### Canonical Dataset State:
| Project | Milestone | Task List | Task Title | Canonical Status | Position |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ASRS Product Development** | Design & Engineering | Mechanical Design | Freeze Container & Rack Layout | `done` | 1000 |
| **ASRS Product Development** | Design & Engineering | Mechanical Design | Finalize Bin & Compartment Design | `in_progress` | 1000 |
| **ASRS Product Development** | Design & Engineering | Electrical & Controls | Freeze PLC I/O Map | `in_review` | 1000 |
| **ASRS Product Development** | Design & Engineering | Electrical & Controls | Finalize Electrical Panel BOM | `todo` | 1000 |
| **ASRS Product Development** | Prototype & Validation | Prototype Build | Release Manufacturing Package | `todo` | 2000 |
| **ASRS Product Development** | Prototype & Validation | Prototype Build | Assemble ASRS Prototype | `todo` | 3000 |
| **ASRS Product Development** | Prototype & Validation | Validation | Run Integrated Functional Test | `todo` | 4000 |
| **ASRS Product Development** | Prototype & Validation | Validation | Close Validation Actions & Release V1 | `todo` | 5000 |
| **Warehouse Deployment Pilot** | Site Readiness & Infrastructure | Civil & Utilities | Freeze Site Layout | `done` | 1000 |
| **Warehouse Deployment Pilot** | Site Readiness & Infrastructure | Civil & Utilities | Confirm Utility & Compliance Readiness | `in_progress` | 1000 |
| **Warehouse Deployment Pilot** | Site Readiness & Infrastructure | Equipment Ingress | Freeze Integrated Deployment Schedule | `in_review` | 1000 |
| **Warehouse Deployment Pilot** | Site Readiness & Infrastructure | Equipment Ingress | Mobilize External Vendors | `todo` | 1000 |
| **Warehouse Deployment Pilot** | Integration & Go-Live | Mechanical & Electrical Integration | Complete Mechanical Installation | `todo` | 2000 |
| **Warehouse Deployment Pilot** | Integration & Go-Live | Mechanical & Electrical Integration | Commission PLC & HMI | `todo` | 3000 |
| **Warehouse Deployment Pilot** | Integration & Go-Live | Commissioning & Handover | Complete Site Acceptance Test | `todo` | 4000 |
| **Warehouse Deployment Pilot** | Integration & Go-Live | Commissioning & Handover | Train Operations Team & Go Live | `todo` | 5000 |
| **SNS Projects Internal Rollout** | Foundation & Governance | Org Structure & Roles | Configure Department Structure | `done` | 1000 |
| **SNS Projects Internal Rollout** | Foundation & Governance | Org Structure & Roles | Onboard Core Users | `in_progress` | 1000 |
| **SNS Projects Internal Rollout** | Foundation & Governance | Org Structure & Roles | Configure System Roles | `in_progress` | 2000 |
| **SNS Projects Internal Rollout** | Foundation & Governance | Org Structure & Roles | Close P0 / P1 Application Defects | `in_progress` | 3000 |
| **SNS Projects Internal Rollout** | Foundation & Governance | RACI & Workflows | Establish RACI Working Standard | `in_review` | 1000 |
| **SNS Projects Internal Rollout** | Pilot Execution & Rollout | Pilot Project Execution | Configure First Live Structured Project | `todo` | 1000 |
| **SNS Projects Internal Rollout** | Pilot Execution & Rollout | Pilot Project Execution | Run Team Walkthrough | `todo` | 2000 |
| **SNS Projects Internal Rollout** | Pilot Execution & Rollout | Training & Enablement | Publish Quick User Guide & BAU Handover | `todo` | 3000 |

---

## 5. RPC Contract Upgrade Specification

### Migration: `20260814173224_enforce_deterministic_kanban_ordering.sql`

```sql
CREATE OR REPLACE FUNCTION public.reorder_kanban_tasks(
  p_task_id uuid,
  p_new_status_id uuid,
  p_source_task_ids uuid[],
  p_destination_task_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
```

### Security & Invariant Rules Enforced:
1. **`SECURITY INVOKER`**: Function executes in the security context of the authenticated user, enforcing all task RLS policies.
2. **Access Revocation**: `REVOKE ALL ON FUNCTION public.reorder_kanban_tasks(...) FROM PUBLIC, anon;` and `GRANT EXECUTE ... TO authenticated;`.
3. **Pessimistic Row Locking**: Row locks acquired with `FOR UPDATE` on the moved task and all sibling tasks in both source and destination columns to serialize concurrent moves safely.
4. **Strict Set-Equality Validation**:
   - For same-column reorders: Validates that `p_destination_task_ids` matches the exact set of tasks in that status in the database.
   - For cross-column moves: Validates that `p_source_task_ids` contains all remaining source tasks (excluding moved task) and `p_destination_task_ids` contains all destination tasks (including moved task).
   - Rejects duplicate UUIDs, foreign project IDs, and tasks belonging to other statuses.
5. **Deterministic Renumbering**: Renumbers source (if cross-column) and destination columns sequentially with `index * 1000`.

---

## 6. Frontend Filter-Safe Ordering & Optimistic Updates

### A. `src/hooks/useTasks.js`
- Upgraded `reorderTask(taskId, newStatusId, sourceTaskIds, destinationTaskIds)` to pass full source and destination arrays.
- Maintains backwards-compatible overloads for object and legacy parameter formats.
- Performs optimistic local state updates without triggering unmounts or loading spinners, followed by silent background revalidation.

### B. `src/pages/TasksPage.jsx`
- Implemented full canonical derivation during drag-and-drop:
  - When filtering is active (e.g. by priority, assignee, milestone, search), visible drag order is merged into the complete project task list for both source and destination columns.
  - Hidden tasks maintain their relative ordering in the full array.
  - Sibling arrays sent to the RPC are always complete, preventing any silent omission of hidden tasks.

---

## 7. Mandatory Test Isolation & Verification Suite

### A. Isolated Contract Test Suite (`scripts/test-kanban-dnd-contracts.mjs`)
The test suite implements:
- Pre-suite snapshot of all 24 production business tasks.
- Isolated temporary task fixtures (`TEMP-TEST-T1`, `TEMP-TEST-T2`, `TEMP-TEST-T3`, `TEMP-TEST-B1`).
- `try / finally` cleanup guaranteeing complete deletion of test tasks, subtasks, RACI records, and notifications.
- Post-suite equality assertion verifying that all 24 baseline tasks remain 100% untouched in both `status_id` and `position`.

### B. 18 Verified Test Cases:
1. `[PASS]` Test 1: same-column reorder executes successfully
2. `[PASS]` Test 2: cross-column reorder executes successfully
3. `[PASS]` Test 3: drop into empty column executes successfully
4. `[PASS]` Test 4: move only task out of source column executes successfully
5. `[PASS]` Test 5: complete source array validation rejects missing source tasks
6. `[PASS]` Test 6: complete destination array validation rejects incomplete destination arrays
7. `[PASS]` Test 7: duplicate UUID rejection in task arrays
8. `[PASS]` Test 8: wrong-project UUID rejection enforced
9. `[PASS]` Test 9: wrong-status sibling rejection in source array
10. `[PASS]` Test 10: moved task missing from destination array rejection
11. `[PASS]` Test 11: hidden/filtered tasks preserved deterministically in full-column derivation (C, B, A, D)
12. `[PASS]` Test 12: concurrent stale ordering rejected via set-equality check
13. `[PASS]` Test 13: all task positions are strictly positive multiples of 1000
14. `[PASS]` Test 14: duplicate position query returns exactly ZERO rows
15. `[PASS]` Test 15: RPC failure atomically rolls back both source and destination columns
16. `[PASS]` Test 16: unauthorized user / viewer rejected by RLS inside SECURITY INVOKER function
17. `[PASS]` Test 17: anonymous role execute permission strictly REVOKED (42501)
18. `[PASS]` Test 18: All 24 structured business tasks remain 100% IDENTICAL and UNPOLLUTED after test suite

---

## 8. Full Regression Suite Results

| Test Suite | Command | Result |
| :--- | :--- | :--- |
| Kanban DnD Contracts & Isolation | `node scripts/test-kanban-dnd-contracts.mjs` | **18 / 18 PASSED** |
| Task Experience & Decongestion | `node scripts/test-task-experience-hotfix.mjs` | **13 / 13 PASSED** |
| Kanban Board Hydration | `node scripts/test-kanban-board-hydration.mjs` | **15 / 15 PASSED** |
| Navigation & Loading UX | `node scripts/test-navigation-loading-ux.mjs` | **32 / 32 PASSED** |
| Task List Hierarchy & Lifecycle | `node scripts/test-tasklist-hierarchy-hotfix.mjs` | **17 / 17 PASSED** |
| Structured Production Dataset | `node scripts/test-structured-production-data.mjs` | **20 / 20 PASSED** |
| ESLint / Code Quality | `npm run lint` | **0 errors (54 warnings)** |
| Vite Production Build | `npm run build` | **0 errors (Success)** |
| Secret Scan | `node scripts/secret-scan.mjs` | **0 hardcoded secrets** |
| Security Advisor Audit | `node scripts/security-advisor.mjs` | **All security invariants PASS** |

---

## 9. Final Database Verification

Live verification via `scripts/check-live-kanban-closure.mjs` confirms:
- **Duplicate Position Groups:** `0`
- **Projects:** `3`
- **Milestones:** `6`
- **Task Lists:** `12`
- **Tasks:** `24`
- **Subtasks:** `48`
- **RACI Assignments:** `72`

The Kanban integrity blocker is completely closed, and the system is ready for the Defined Process Engine (DP-1) migration.
