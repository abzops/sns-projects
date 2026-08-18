# SNS Projects Operational V1 Stability Certification

**Status**: **`READY FOR MANUAL FINAL ACCEPTANCE`**

**Certification Date**: 2026-08-18  
**Certified Application Commit**: `23c383bff49914e4e4e133ee1a92992e2138dc77`  
**Scope**: Current non-Finance SNS Projects application  
**Database Migration**: None

---

## 1. Certification Boundary

This certification covers the existing authentication, Dashboard, My Work, Projects, operational hierarchy, List, Board, Task Detail, Subtasks, Child Tasks, RACI, Departments, permission-gated administration, Process Catalog, process definition/version views, exposed process start/runtime surfaces, notifications, navigation, and deep-link contracts.

It preserves all verified P1, P2, and P3 behavior. It does not include Finance, Package 4, speculative features, fake production data, or a declaration of **FULL V1**.

---

## 2. Findings and Targeted Fixes

| Finding | Root-cause correction |
| :--- | :--- |
| Department Management used a hash URL under `BrowserRouter` | Replaced the Personnel link with React Router navigation. |
| Workspace and Project creation could close silently when hooks returned an error | Callers now inspect returned errors, keep the form open, and show success/error feedback accurately. |
| Task and workspace-member deletion could close or report success after a failed mutation | Callers now check mutation results and preserve the current UI on failure. |
| RACI and notification mutations could reject without user-visible feedback | Failure paths now show actionable toasts and RACI state is revalidated after an Accountable update failure. |
| Projects, Departments, Processes, and Workspaces could present fetch failures as legitimate empty data | Each surface now renders a distinct load-error state when no cached data is available. |
| Navigation regression still referenced the removed Milestone hook | The verifier now checks the Phase cache and rejects hash-only internal routing. |

No database, RLS, policy, function, trigger, or migration changes were made.
Supabase Security Advisor was therefore not rerun; the requirement applies only when database or security state changes.

---

## 3. Machine-Verified Evidence

| Gate | Result |
| :--- | :---: |
| Operational V1 route and failure-state regression | **PASS — 14 routes + 16 contracts** |
| Navigation and loading regression | **PASS — 34/34** |
| Authentication/password lifecycle contracts | **PASS — 30/30** |
| Explicit PostgREST relationship embeds | **PASS — 9/9** |
| Active Milestone terminology | **PASS — 0 matches** |
| P3-01 hierarchy regression | **PASS** |
| P3-02 Subtask hierarchy regression | **PASS — 9 contracts** |
| Production CORS and unauthenticated JWT gate | **PASS — 3/3** |
| Lint | **PASS — 0 errors; historical warnings unchanged** |
| Production build | **PASS** |
| GitHub Pages build and deployment | **PASS — run `32120210879`** |
| Deployed bundle contract | **PASS — 12/12** |
| Deployed Phase-native asset | **PASS — `index-9GcfT5bU.js`** |

The latest 100 production API requests returned HTTP 200, the latest 100 Edge Function requests returned HTTP 200, and the latest 100 Postgres log entries contained no `ERROR`, `FATAL`, or `PANIC` severity.

Read-only production integrity checks confirmed zero orphan Task→Project, Task→Phase, Task→Task List, Subtask→Task, and RACI→Task relationships; zero Tasks without status; one published Process version; all four explicit hierarchy embed constraints present; and migration tip `20260817142153`.

Production currently contains zero Process Instances. Process Instance visibility and live process-step interaction therefore remain manual acceptance items and must use an intentionally started real Process, not seeded or fake data.

---

## 4. Manual Final Acceptance Checklist

Browser automation could not initialize in the local certification environment. Only these interactive checks remain:

1. Sign in with an authorized existing user, refresh a deep-linked route to confirm session restore, then sign out and confirm protected history cannot be reopened.
2. Visit Dashboard, My Work, Projects, Departments, Process Catalog, and permission-appropriate administration routes; confirm visible data, empty/error states, mobile navigation, and no console-blocking errors.
3. Open a real Project and exercise Phase → Task List → Task → Subtask / Process / Child Task expansion, List, Board movement, Task Detail save, status change, Subtask mutation, and supported RACI assignment.
4. Verify Project creation only with an intended real record; confirm success feedback and that a deliberately rejected/unauthorized action remains visible as an error instead of false success.
5. View Process definitions and versions. If operationally approved, start one real Process and verify its Instance, hierarchy placement, process steps, and My Work visibility.
6. Open notifications, mark one and all as read, verify navigation from a project notification, and confirm state remains current after refresh.

---

## 5. Certification Decision

All machine-verifiable Operational V1 gates pass, confirmed blockers are corrected and deployed, production telemetry and relational integrity are clean, and no security boundary was weakened.

**SNS Projects Operational V1 = `READY FOR MANUAL FINAL ACCEPTANCE`**
