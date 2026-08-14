# SNS Projects — Production Hotfix Report: Task List Hierarchy Rendering

**Date**: August 14, 2026  
**Status**: **HOTFIX SUCCESS**  
**Workspace ID**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects Dataset)  
**Target Project**: `f60d8120-09f8-469c-9278-4b591dfe75a8` (ASRS Product Development)  
**Live Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)  

---

## 1. Exact Frontend Root Cause

1. **Malformed Foreign Key Join Query in `useTaskLists.js`**:
   - In `src/hooks/useTaskLists.js`, the primary query for fetching task lists was written as:
     ```javascript
     let query = supabase
       .from('task_lists')
       .select(`
         *,
         milestones:milestone_id (
           id,
           name,
           project_id
         )
       `)
       .eq('project_id', projectId);
     ```
   - In PostgREST syntax, `milestones:milestone_id(...)` instructs PostgREST to search for a relation named `milestone_id`.
   - PostgREST rejected this with error code `PGRST200`:
     > *"Searched for a foreign key relationship between 'task_lists' and 'milestone_id' in the schema 'public', but no matches were found. Perhaps you meant 'milestones' instead of 'milestone_id'."*
   - Because `lErr` was thrown, `useTaskLists` terminated with error state, leaving `taskLists = []`.
   - This caused:
     - Project summary header to calculate `taskLists.length = 0` ("2 Milestones, 0 Task Lists").
     - Hierarchy accordion under every milestone (`taskLists.filter(tl => tl.milestone_id === milestone.id)`) to evaluate to `[]`, displaying the fallback notice *"No task lists in this milestone"*.

2. **List View Contrast**:
   - The List and Board views fetch tasks via `useTasks(projectId)`, which stores the direct `task_list_id` and project task status directly. Hence, List view was able to display task list tags, proving that database data was intact and the issue was strictly isolated to `useTaskLists.js`.

---

## 2. Surgical Fix Implemented

- In `src/hooks/useTaskLists.js`, updated the select query to `select('*')`:
  ```javascript
  // 1. Query task lists
  let query = supabase
    .from('task_lists')
    .select('*')
    .eq('project_id', projectId);
  ```
- `select('*')` returns all necessary attributes (`id`, `name`, `description`, `project_id`, `milestone_id`, `position`, `created_at`) directly without throwing PostgREST relational ambiguity errors.
- Progress metrics, task counts (`task_count`, `completed_count`, `progress`), and reactive updates now resolve properly.

---

## 3. Stray "Test" Task List Cleanup

- Verified the presence of stray empty task list `a45089b8-098c-4ce7-a1d9-96ca5d90c252` ("Test") in project *ASRS Product Development*.
- Confirmed it had 0 tasks attached and safely removed it.
- ASRS Product Development now has exactly 4 canonical Task Lists:
  1. `Mechanical Design` (Design & Engineering — 2 tasks, 50% progress)
  2. `Electrical & Controls` (Design & Engineering — 2 tasks, 0% progress)
  3. `Prototype Build` (Prototype & Validation — 2 tasks, 0% progress)
  4. `Validation` (Prototype & Validation — 2 tasks, 0% progress)

---

## 4. Verification Across All 3 Projects

| Project | Milestones | Task Lists | Tasks | Progress | Hierarchy Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ASRS Product Development** | 2 | 4 | 8 | 13% | **All 4 Task Lists Visible & Structured** |
| **Warehouse Deployment Pilot** | 2 | 4 | 8 | 13% | **All 4 Task Lists Visible & Structured** |
| **SNS Projects Internal Rollout** | 2 | 4 | 8 | 13% | **All 4 Task Lists Visible & Structured** |

---

## 5. Security & RLS Preservation

- **RLS Unchanged**: Zero database security policies, triggers, or helper functions were modified.
- **Zero-Trust Maintained**: Authenticated workspace members have read/write access to project hierarchy, while anonymous and non-member access remains strictly denied.

---

## 6. Automated Test Suites & Regression Results

| Test Suite | Result | Details |
| :--- | :--- | :--- |
| **Task List Hierarchy Hotfix** (`test-tasklist-hierarchy-hotfix.mjs`) | **17/17 PASSED** | Verified useTaskLists query, 4 task lists for ASRS, dynamic creation/deletion |
| **Structured Production Dataset** (`test-structured-production-data.mjs`) | **20/20 PASSED** | Verified 3 projects, 6 milestones, 12 task lists, 24 tasks, 48 subtasks |
| **Release 2.5 Hierarchy Suite** (`test-r2_5-hierarchy.mjs`) | **32/32 PASSED** | Hierarchy constraints, composite keys, and progress formula verified |
| **Release 3 Go-Live Suite** (`test-r3-go-live.mjs`) | **25/25 PASSED** | Notifications, publication, viewer isolation, baseline integrity |
| **Linter** (`npm run lint`) | **0 Errors** | Clean |
| **Production Build** (`npm run build`) | **0 Errors** | Compiled bundle in 665ms |
