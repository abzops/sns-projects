# SNS Projects V2 — Day-0 Release 3: Go-Live & Production Verification Report

**Date**: August 14, 2026  
**Status**: **GO LIVE: YES (PRODUCTION DEPLOYED & VERIFIED)**  
**Commit Hash**: `2df254645705bf2bafb70a05277bb983612e5a05`  
**Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)  

---

## 1. Release 3 Changes

Release 3 successfully finalizes and deploys SNS Projects V2 Day-0 MVP to production:
- **In-App Notification Engine**: Trusted database-level event triggers in `private` schema with full hierarchy and RACI context.
- **Realtime Integration**: Configured `public.notifications` in `supabase_realtime` publication with reactive frontend subscription.
- **Interactive Notification UI**: Added polished `NotificationBell` component with unread badges, dropdown panel, mark as read, mark all read, relative timestamps, and one-click navigation to projects.
- **Safe Performance Hardening**: Added covering indexes on `task_lists(milestone_id, project_id)`, `tasks(task_list_id, milestone_id, project_id)`, `tasks(milestone_id, project_id)`, `projects(owner_id)`, and `notifications(user_id, is_read, created_at DESC)`.
- **PostgREST Relationship Resolution**: Added single-column foreign key constraints (`tasks_milestone_id_fkey`, `tasks_task_list_id_fkey`) with `ON DELETE RESTRICT` enabling seamless PostgREST resource embedding.
- **RLS Query Optimization**: Replaced direct `auth.uid()` with `(SELECT auth.uid())` in ownership policies.
- **CI/CD & GitHub Pages Deployment**: Configured Vite production base path `/sns-projects/`, GitHub Pages SPA routing fallback (`404.html`), and secrets/vars fallback in workflow.

---

## 2. Canonical Business Hierarchy

The system strictly adheres to and enforces the 5-level hierarchy across database constraints, hooks, and UI:

$$\begin{matrix}
\mathbf{Workspace} \\
\Downarrow \\
\mathbf{Project} \\
\Downarrow \\
\mathbf{Milestone} \\
\Downarrow \\
\mathbf{Task\ List} \\
\Downarrow \\
\mathbf{Task\ (RACI\ Governed)} \\
\Downarrow \\
\mathbf{Subtask\ (Lightweight\ Execution)}
\end{matrix}$$

- **Milestones**: Organization layer dividing projects into strategic phases.
- **Task Lists**: Functional grouping under Milestones.
- **Tasks**: Primary deliverables governed strictly by RACI assignments.
- **Subtasks**: Checklist execution items under Tasks with assignee and status (`todo`, `in_progress`, `done`, `cancelled`).

---

## 3. In-App Notification Architecture & Security

- **Database-Level Invariant**: Browser direct `INSERT` on `public.notifications` is strictly **REVOKED** from `authenticated` and `anon`.
- **Private Helper Function**: `private.emit_notification(...)` executes as `SECURITY DEFINER` with `SET search_path = ''`.
- **Deduplication Safeguard**: Automatically suppresses duplicate unread notifications created within a 10-second window.
- **Column-Level Update Security**: Authenticated browser users can ONLY update `is_read` and `read_at`. All other columns (`title`, `message`, `user_id`, `type`, `workspace_id`, `project_id`, `task_id`) are immutable from the client.

---

## 4. Supported Day-0 Notification Events

| Event Type | Trigger Table | Condition | Generated Title | Context Included |
| :--- | :--- | :--- | :--- | :--- |
| **R Assigned** | `task_raci_assignments` | `AFTER INSERT` (role='R') | `Task assigned to you` | Project › Milestone › Task List › Task |
| **A Assigned** | `task_raci_assignments` | `AFTER INSERT` (role='A') | `You are accountable for a task` | Project › Milestone › Task List › Task |
| **C Assigned** | `task_raci_assignments` | `AFTER INSERT` (role='C') | `Your input is requested` | Project › Milestone › Task List › Task |
| **I Assigned** | `task_raci_assignments` | `AFTER INSERT` (role='I') | `You are following a task` | Project › Milestone › Task List › Task |
| **Dept RACI** | `task_raci_assignments` | `AFTER INSERT` (department_id) | Role-specific title | Broadcast to all active department members |
| **Status Changed** | `tasks` | `AFTER UPDATE` (status_id changed) | `Task status updated: <Status>` | Notifies assigned R, A, and I users |
| **Subtask Assigned** | `subtasks` | `AFTER INSERT/UPDATE` (assignee_id) | `Subtask assigned to you` | Subtask title + Parent Task + Project hierarchy |

---

## 5. Realtime Implementation

- `public.notifications` added to `supabase_realtime` publication.
- `useNotifications` hook creates a dedicated channel listening to `postgres_changes` on `notifications` filtered by `user_id=eq.<user_id>`.
- Automatically handles `INSERT` (prepends to top of feed), `UPDATE` (updates unread/read state in-place), and `DELETE`.
- Automatically removes channel and unbinds listeners on component unmount.

---

## 6. Performance & Index Hardening

Covering indexes applied and verified in production:
1. `idx_task_lists_milestone_proj` on `public.task_lists(milestone_id, project_id)`
2. `idx_tasks_hierarchy_covering` on `public.tasks(task_list_id, milestone_id, project_id)`
3. `idx_tasks_milestone_proj` on `public.tasks(milestone_id, project_id)`
4. `idx_projects_owner` on `public.projects(owner_id)`
5. `idx_notifications_user_unread` on `public.notifications(user_id, is_read, created_at DESC)`

---

## 7. Browser & Smoke Testing Summary

All critical workflows tested and verified:
- **Authentication**: Login with official Stack n Stock logo and token-based redirect.
- **Application Shell**: Collapsible sidebar, workspace switcher, command center badge, and sticky topbar with `NotificationBell`.
- **CEO & CTO Dashboards**: Real metrics, health calculations, attention queues, and overdue/blocked task counters.
- **Projects**: Grid cards, color accents, progress metrics, and creation modals.
- **Project Hierarchy (Tree View)**: Expandable Milestones → Task Lists → Tasks, Uncategorized legacy tasks section, progress bars, and cascading Milestone/Task List filters.
- **Task Management**: Kanban board drag & drop, List view sorting, TaskDetailPanel slide-in drawer.
- **RACI Governance**: Mandatory $\ge 1$ Responsible user and exactly 1 Accountable user with automated compensating rollback.
- **Subtasks**: Interactive checklist inside TaskDetailPanel with checkbox completion, assignee assignment, and real-time subtask counter badge on Kanban cards.
- **Notifications**: Real-time bell counter badge, slide-down panel, mark single as read, mark all as read, and click-to-navigate.

---

## 8. Responsive Design Testing

- **Desktop (1440px)**: Full multi-column layout, Kanban boards, and sidebars.
- **Tablet / Laptop (1024px)**: Responsive grids, adaptive drawer navigation.
- **Mobile (390px)**: Hamburger drawer navigation, sticky topbar with notification bell, full-width modals, touch-friendly task list and detail drawers.

---

## 9. Comprehensive Automated Test Suites

| Test Suite | File | Tests Run | Result |
| :--- | :--- | :--- | :--- |
| **Release 1.1 Security Hardening** | `scripts/test-r1_1-security.mjs` | 20 | **20/20 PASSED** |
| **Release 2 Data Contracts** | `scripts/test-r2-data-contracts.mjs` | 7 | **7/7 PASSED** |
| **Release 2.5 Hierarchy Alignment** | `scripts/test-r2_5-hierarchy.mjs` | 32 | **32/32 PASSED** |
| **Release 3 Go-Live Verification** | `scripts/test-r3-go-live.mjs` | 25 | **25/25 PASSED** |
| **Total Automated Tests** | | **84** | **84/84 PASSED (100%)** |

---

## 10. Security & Compliance Assessment

- **Supabase Security Advisor**:
  - All 14 public tables have Row-Level Security (RLS) strictly enabled.
  - `private` schema contains all internal security helper functions and is NOT exposed via PostgREST.
  - `public.notifications` table-level `INSERT` is revoked from `authenticated` and `anon`.
  - Default function privileges in `public` revoke automatic `EXECUTE` from `PUBLIC`.
  - Auth Advisory: Leaked Password Protection is an Auth dashboard configuration toggle (documented for post-launch Auth hardening).
- **Secret Scan**: Clean. No database passwords, service role keys, or personal access tokens committed.

---

## 11. Baseline Data Integrity

| Entity | Baseline Count | Final Production Count | Status |
| :--- | :--- | :--- | :--- |
| **Projects** | 6 | 6 | **100% Intact** |
| **Legacy Tasks** | 26 | 26 | **100% Intact (Uncategorized)** |
| **RACI Assignments** | 0 | 0 | **100% Intact** |
| **Milestones** | 0 | 0 | **Ready for user creation** |
| **Task Lists** | 0 | 0 | **Ready for user creation** |
| **Subtasks** | 0 | 0 | **Ready for user creation** |

---

## 12. Deployment Verification

- **Repository**: [https://github.com/abzops/sns-projects.git](https://github.com/abzops/sns-projects.git)
- **Branch**: `main`
- **Commit**: `2df2546`
- **Build Output**: `dist/index.html`, `dist/assets/index-BFMT-Vdh.js`, `dist/assets/index-CaOHx-yp.css`, `dist/assets/white-01-B5rbAPg-.png`
- **SPA 404 Fallback**: `dist/404.html` generated in CI workflow.
- **Production URL**: [https://abzops.github.io/sns-projects/](https://abzops.github.io/sns-projects/)

---

## 13. Day-0 Known Limitations & Post-Launch Roadmap

1. **Email / SMS / WhatsApp Dispatch**: In-app notifications are live for Day-0; external email and WhatsApp webhooks scheduled for Phase 2.
2. **Scheduled Overdue Cron**: Due date monitoring currently relies on client-side and dashboard queries; `pg_cron` daily notification scheduler scheduled for Phase 2.
3. **Advanced Hierarchy Drag-and-Drop**: Re-parenting tasks across task lists via drag-and-drop planned for post-launch enhancement.

---

## 14. Conclusion

All 26 Day-0 requirements, architectural invariants, security policies, and deployment criteria have been satisfied and verified.

**SNS PROJECTS IS LIVE.**
