# SNS Projects — Task Experience & Zero-Flicker DnD Hotfix Report

**Date**: August 14, 2026  
**Status**: **HOTFIX SUCCESS**  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects Dataset)  
**Live Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)  

---

## 1. Executive Summary & Root Cause Analysis

### Part A: Post-Drop Loading & Screen Flicker Root Cause:
1. **Unconditional `loading = true` in `useTasks.js`**:
   - Every execution of `fetchTasks()` executed `setLoading(true)`.
   - When a Kanban card was dropped, `reorderTask()` persisted the atomic RPC and subsequently called `await fetchTasks()`.
   - Setting `loading = true` immediately triggered `TasksPage.jsx`'s top-level loading check (`const loading = tasksLoading || ...`), which replaced the entire page DOM with `<Spinner size="lg" />`, destroying the active Board, resetting `scrollLeft` to 0, and forcing a full remount cycle once `fetchTasks()` completed.
2. **Resolution — Silent Background Revalidation**:
   - Introduced `initialLoading` (true ONLY on initial mount when `tasks.length === 0`) vs `refreshing` (true during background revalidations).
   - In `useTasks.js`, `fetchTasks({ silent: true })` bypasses full loading states.
   - `reorderTask()` optimistically updates the local tasks cache and revalidates canonically via `await fetchTasks({ silent: true })` without flashing or unmounting.
   - Preserves horizontal `scrollLeft`, active tab view, filter states, and DOM tree.

---

### Part B: List View UX Decongestion & RACI Readability:
1. **Two-Level Title Hierarchy**:
   - **Primary Line**: Crisp task title (bold 700, 0.90rem) with subtle blocked badge if applicable.
   - **Secondary Line**: Muted metadata with small icon, Task List / Milestone name, and inline subtask counter (`Installation & Commissioning · 0/2 subtasks`). Replaces loud bright yellow pills with clean, elegant typography.
2. **Compact Grouped RACI**:
   - High visual distinction for **Accountable [A]** (gold accent with owner name) and **Responsible [R]** (blue accent with avatar / department).
   - Gracefully collapsed **Consulted [C +2]** and **Informed [I +1]** badges.
   - Multi-line hover tooltips showing full roles, department codes, and assignee names for dense scanning.
3. **Balanced Column Widths & Sticky Header**:
   - Column layout: Title (`44%`), Status (`12%`), Priority (`11%`), RACI (`20%`), Due Date (`13%`).
   - Sticky header with understated dark panel styling.
   - Clean date formatting (`25 Oct 2026`) with soft overdue dots.
4. **Responsive Layouts**:
   - Desktop (1440px): Full tabular view with sticky headers.
   - Tablet (1024px): Compact column padding with secondary metadata underneath titles.
   - Mobile (390px): Clean horizontal scroll cards with touch-friendly targets.

---

## 2. Verification Suite Results

- `test-task-experience-hotfix.mjs`: **13/13 PASSED**
- `test-kanban-board-hydration.mjs`: **15/15 PASSED**
- `test-kanban-dnd-contracts.mjs`: **13/13 PASSED**
- `test-tasklist-hierarchy-hotfix.mjs`: **17/17 PASSED**
- `test-structured-production-data.mjs`: **20/20 PASSED**
- `npm run lint`: **0 Errors**
- `npm run build`: **0 Errors** (Compiled in 666ms)
- `secret-scan.mjs`: **0 Leaks**
