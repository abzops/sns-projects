# SNS Projects — Kanban Board Interaction Upgrade Report

**Date**: August 14, 2026  
**Status**: **KANBAN DND HOTFIX SUCCESS**  
**Target Workspace**: `dbcaddf1-cf02-4bad-8af1-974301cdfbea` (SNS Projects Dataset)  
**Live Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)  

---

## 1. Root Cause of Previous Interaction Issues

1. **Database Persistence inside `onDragOver`**:
   - The previous board implementation triggered asynchronous Supabase `reorderTask()` mutations on every pointer movement inside `onDragOver`.
   - This flooded network requests, caused asynchronous state collisions, and created severe card jumping and visual instability during dragging.

2. **Lack of Normalized Multi-Container State**:
   - The board lacked a normalized container state dictionary keyed by `system_code` (`todo`, `in_progress`, `in_review`, `blocked`, `done`).
   - Cards could not smoothly reorder or cross column boundaries in local React state prior to pointer release.

3. **Click vs. Drag Collision**:
   - The entire card surface served as both the click target (for `TaskDetailPanel`) and the drag initiator.
   - Clicking a card often initiated an unintended micro-drag, while completing a drag frequently triggered the task detail modal.

4. **Empty Columns as Invalid Drop Targets**:
   - Empty columns (e.g. `Blocked`, `In Progress`) lacked dedicated droppable body targets, requiring a task to already exist in a column to accept a drop.

5. **Non-Atomic Sibling Position Updates**:
   - Reordering tasks relied on multiple separate Supabase update calls where partial failures left inconsistent database state.

---

## 2. Technical Architecture & Hotfix Implementation

### A. Multi-Container Sortable Architecture
- **Normalized Local Board Model**: Board state is structured as `{ [system_code]: Task[] }`.
- **Sensors**: Configured `PointerSensor` (activation constraint: `distance: 6px`) and `KeyboardSensor` (`sortableKeyboardCoordinates`).
- **Custom Collision Strategy**: Combines `pointerWithin` (for direct target detection under cursor) and `closestCorners` fallback.

### B. Drag Handle & Click Separation
- Added a subtle `GripVertical` handle at the top-left of `TaskCard`.
- Drag attributes, listeners, and `setActivatorNodeRef` are attached **strictly to the drag handle**.
- Clicking anywhere else on the card opens `TaskDetailPanel` without initiating a drag.
- Added an accessible "Move to..." status menu fallback for touch/mobile devices.

### C. Live `onDragOver` Movement (Zero Database Calls during Drag)
- During `onDragOver`, active tasks move between containers in local React state immediately, allowing cards to reflow smoothly.
- Database persistence is deferred strictly to `onDragEnd`.

### D. Full-Column Droppables & Visual Feedback
- Each status column wraps its body in `useDroppable({ id: status.system_code })`.
- Empty columns render a full-height `.emptyDropZone` target (*"Drop task here"*).
- Columns highlight with `.columnOver` yellow-tinted background and border when hovered.

### E. DragOverlay
- Implemented a clean, floating presentational `TaskCard` inside `DragOverlay` with elevated shadow and grabbing cursor.
- The original card in the column renders in placeholder mode (`opacity: 0.35`, dashed yellow border).

### F. Progressive Horizontal Auto-Scroll
- Implemented edge-scrolling on the board scroll container using `requestAnimationFrame`.
- When dragging near the left or right edges (within 90px), the board viewport scrolls horizontally at a speed proportional to edge proximity, stopping immediately upon leaving the zone or drag completion.

### G. Atomic Database Persistence via RPC
- Created forward migration `20260814_05_reorder_kanban_tasks.sql` containing the `reorder_kanban_tasks` PostgreSQL function:
  - Configured as **`SECURITY INVOKER`** (runs with caller privileges, fully enforcing RLS).
  - Validates project boundary and status validity.
  - Atomically updates moved task status and renumbers all sibling positions with 1000 spacing (`1000, 2000, 3000...`).
  - Executed in ONE atomic database call.
  - Optimistic UI automatically rolls back to start-drag snapshot with an error toast if Supabase persistence fails.

### H. Authorization Model Reuse
- Checked permissions using the existing `useUserContext(workspaceId)` hook:
  - `const canMutateTasks = !userContextLoading && (isAdmin || isProjectAdmin || isCEO || isCTO || workspaceRole === 'member' || workspaceRole === 'owner' || workspaceRole === 'admin');`
  - Read-only viewers have sortable dragging disabled.

---

## 3. Verification & Regression Matrix

| Test Suite | Result | Details |
| :--- | :--- | :--- |
| **Kanban DnD Contracts** (`test-kanban-dnd-contracts.mjs`) | **13/13 PASSED** | Verified status mapping, atomic RPC, empty drop, RACI/subtask preservation, rollback on foreign status |
| **Task List Hierarchy** (`test-tasklist-hierarchy-hotfix.mjs`) | **17/17 PASSED** | All task list hierarchy queries and counts verified |
| **Structured Production Dataset** (`test-structured-production-data.mjs`) | **20/20 PASSED** | 3 projects, 6 milestones, 12 task lists, 24 tasks, 48 subtasks |
| **Release 2.5 Hierarchy Suite** (`test-r2_5-hierarchy.mjs`) | **32/32 PASSED** | Hierarchy constraints, composite keys, progress calculation |
| **Release 3 Go-Live Suite** (`test-r3-go-live.mjs`) | **25/25 PASSED** | Notifications, publication, viewer isolation, baseline integrity |
| **Linter** (`npm run lint`) | **0 Errors** | Clean |
| **Production Build** (`npm run build`) | **0 Errors** | Compiled in 734ms |
| **Secret Scan** (`secret-scan.mjs`) | **0 Leaks** | Verified |
