# Package 3 / P3-01 — Operational Hierarchy UI Cutover

**Status**: `VERIFIED` — manual signed-in production acceptance passed

**Preceding Deliverable**: [P2-03 Parent Task Completion and Runtime Closure](../Package_02_Process_Runtime/P2-03_Parent_Task_Completion_and_Runtime_Closure.md)

**Database Migration**: None

---

## 1. Scope

P3-01 makes the existing hierarchy operational as Workspace → Project → Phase → Task List → Task → Child Task. It is a frontend-only cutover that preserves every verified P1/P2 database rule, including P2-03 parent and Process Instance closure behavior.

The active frontend uses Phase terminology only. List, Board, My Work, and the existing Task Detail save path remain in place.

---

## 2. Delivered Behavior

- Phase and Task List accordions continue to use accessible chevrons.
- Task nodes recursively expand through ordinary Child Tasks; selecting a task title opens the existing Task Detail panel.
- Task-attached Process Instances render under their exact host Task. Multiple instances remain separate groups.
- Materialized Process steps render only inside their Process Instance group and never as ordinary Child Tasks.
- When a host has both Process Instances and ordinary Child Tasks, ordinary children appear beneath an explicit **Other** label.
- Project-, Phase-, and Task-List-placed Process Instances render at their exact placement without synthetic hierarchy containers.
- Process name/version, technical status, contractual due date, and progress are displayed. Progress comes from the existing `public.get_process_instance_progress(uuid)` RPC and is not reimplemented in the client.
- Explicit PostgREST foreign-key names are used for ambiguous or renamed relationships.
- Loading, partial-error, no-Phase, no-Task-List, no-task, and no-visible-step states are explicit.
- The hierarchy adapts to narrow screens while the established visual system, List table, and Board drag-and-drop remain intact.

---

## 3. Implementation

| Area | Canonical implementation |
| :--- | :--- |
| Hierarchy model | `src/lib/hierarchy.js` |
| Task / Process tree | `src/components/HierarchyTaskTree.jsx` |
| Responsive styling | `src/components/HierarchyTaskTree.module.css` |
| Project Process data | `src/hooks/useProjectProcessInstances.js` |
| Project hierarchy integration | `src/pages/TasksPage.jsx` |
| Task runtime fields | `src/hooks/useTasks.js` |
| Regression gate | `scripts/test-p3-01-hierarchy-ui.mjs` |

Production was read-only inspected before implementation. It contained 30 Tasks, zero ordinary Child Tasks, and zero Process Instances. P3-01 therefore does not create demonstration data; populated child/process states are covered by deterministic fixtures, while production acceptance uses the real empty states.

---

## 4. Verification

| Gate | Result |
| :--- | :---: |
| Focused hierarchy/process regression | **PASS** |
| Active frontend Milestone terminology | **PASS — 0 matches** |
| `npm run lint` | **PASS — 0 errors; historical warnings unchanged** |
| `npm run build` | **PASS** |
| GitHub Pages build and deployment | **PASS** |
| Deployed bundle contract and P3 markers | **PASS** |
| Signed-in production browser acceptance | **PASS — manually verified** |

The in-app browser controller was unavailable during the first acceptance attempt because its persistent Node kernel could not initialize its assets. This was an acceptance-tool blocker, not an application error. Manual signed-in production acceptance subsequently exercised the deployed Projects, hierarchy, Task Detail, List, Board, and My Work routes and passed, closing the P3-01 acceptance gate.

---

## 5. Production Deployment

- Git commit `9028df0` was pushed to `main`.
- GitHub Pages workflow run `32114200734` completed successfully for that exact commit.
- Production `index.html` and its JavaScript asset returned HTTP 200.
- The deployed bundle contains the P3-01 hierarchy empty state, Phase Process placement label, and `get_process_instance_progress` integration.
- The established deployed-bundle regression completed **7/7 PASS**.
- Browser-controller initialization was retried after deployment and failed before opening a tab with the same local kernel-assets error.
- Manual signed-in production acceptance subsequently passed against the deployed application.

---

## 6. Scope Boundaries

- No database schema or migration changes.
- No changes to P2-03 runtime functions, triggers, RLS, or closure semantics.
- No Finance or Package 4 work.
- No P3-02 work.
- No fake production data.
