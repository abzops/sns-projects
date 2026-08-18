# Package 3 / P3-02 — Subtask Hierarchy and Operational Closure

**Status**: `VERIFIED` — manual signed-in production acceptance passed

**Preceding Deliverable**: [P3-01 Operational Hierarchy UI Cutover](./P3-01_Operational_Hierarchy_UI_Cutover.md)

**Database Migration**: None

---

## 1. Scope

P3-02 closes the missing Subtask level in the operational project hierarchy:

Project → Phase → Task List → Task → Subtasks / Attached Processes / Child Tasks.

It is a frontend-only extension of P3-01. It does not change P2-03 parent completion, Process Instance runtime behavior, RLS, or database schema.

---

## 2. Production and Schema Evidence

Read-only production inspection confirmed:

- 48 rows in `public.subtasks` across 24 Tasks.
- Status distribution: 31 `todo`, 8 `in_progress`, 9 `done`, and 0 `cancelled` at inspection time.
- The database constraint permits exactly `todo`, `in_progress`, `done`, and `cancelled`.
- `subtasks.task_id` has the existing `(task_id, position)` index and cascading Task foreign key.
- RLS is enabled, the authenticated role has SELECT, and the existing membership policy controls visibility.
- No schema defect or migration requirement exists.

---

## 3. Delivered Behavior

- A Task with one or more real Subtasks now has an expand/collapse chevron, including a Task whose only descendants are Subtasks.
- Expanded Tasks show a visually distinct **Subtasks** group with title, status, assignee when present, and due date when present.
- `done` and `cancelled` presentation is explicit. Cancelled rows remain visible and are excluded from completion denominators.
- Subtasks remain separate from ordinary Child Tasks and materialized Process step Tasks.
- Multiple descendant types use the deterministic order: **Subtasks → Processes → Child Tasks**.
- P3-01's **Other** grouping remains in place for ordinary Child Tasks when Processes coexist.
- Task titles continue to open the existing Task Detail panel.
- List, Board, My Work, Process hierarchy, and Task Detail task save behavior are unchanged.

---

## 4. Data Access and Task Detail Integration

`useTasks` already performed one bulk `public.subtasks` query for the current project Task IDs. P3-02 extends that same query with the display fields and an explicit `subtasks_assignee_id_fkey` embed, then groups rows by `task_id`. It does not add per-Task queries or a second hierarchy hook.

Task Detail continues to own Subtask CRUD through `useSubtasks`. Successful create, completion toggle, and delete operations now request one silent project-task refresh so the hierarchy updates immediately. The existing create/update/toggle/delete functions remain canonical. Cancelled Subtasks are displayed as cancelled and cannot be toggled directly to Done.

---

## 5. Verification

| Gate | Result |
| :--- | :---: |
| P3-01 hierarchy regression | **PASS** |
| P3-02 nine-contract Subtask regression | **PASS** |
| Bulk Subtask query verifier | **PASS** |
| Active frontend Milestone terminology | **PASS — 0 matches** |
| `npm run lint` | **PASS — 0 errors; historical warnings unchanged** |
| `npm run build` | **PASS** |
| Documentation links | **PASS** |
| GitHub Pages build and deployment | **PASS** |
| Deployed bundle contract and P3-02 markers | **PASS** |
| Signed-in production acceptance | **PASS — manually verified** |

The focused P3-02 suite proves Subtask-only chevrons, true leaf behavior, correct ownership grouping, separation from Child Tasks, all required mixed descendant combinations, deterministic ordering, cancelled semantics, bulk query structure, preserved Task Detail CRUD ownership, and zero active Milestone terminology.

---

## 6. Production Deployment

- Git commit `db1320b` was pushed to `main`.
- GitHub Pages workflow run `32115634545` completed successfully for that exact commit.
- Production serves `index-C8OWED_2.js` with the Subtasks group, cancelled-state guard, explicit `subtasks_assignee_id_fkey` relationship, and Child Tasks grouping markers.
- The established deployed-bundle regression completed **7/7 PASS**.
- Manual signed-in production acceptance subsequently passed, closing the P3-02 and Package 3 acceptance gates.

---

## 7. Scope Boundaries

- Package 3 is **`COMPLETE / VERIFIED`**; manual signed-in production acceptance passed.
- No database migration or production data mutation.
- No Finance or Package 4 work.
- No fake data or parallel hierarchy model.
