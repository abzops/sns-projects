# SNS Projects Operational V1 Stability Certification

**Status**: **`READY FOR MANUAL FINAL ACCEPTANCE`**

**Certification Date**: 2026-08-18  
**Certified Application Commit**: `94fd1179cfc62ccde874e9c4f9f243d716c6dfff`
**Scope**: Current non-Finance SNS Projects application  
**Database Migration**: None

---

## 1. Certification Boundary

This certification covers the existing authentication, Dashboard, My Work, Projects, operational hierarchy, List, Board, Task Detail, Subtasks, Child Tasks, RACI, Departments, permission-gated administration, Process Catalog, process definition/version views, exposed process start/runtime surfaces, notifications, navigation, deep-link contracts, and the mandatory Operational V1 Visual Integrity / Cosmetic QA gate.

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
| Returning to a foreground browser tab could replace the current route with a full-screen auth spinner | Supabase foreground auth events now preserve the same-user identity reference when access claims are unchanged. `ProtectedRoute` keys authorization to stable identity/access values, keeps verified content mounted, and revalidates membership silently with request deduplication. |
| Authorization fallback treated some membership-check failures or missing memberships as active | Cold authorization now fails closed, missing/revoked membership renders access denied, pending and `must_change_password` still redirect, and a failed background revalidation retains only the last successfully verified view with a non-destructive warning. |
| Project hierarchy Task loading could repeat its Task/RACI/Subtask query set as Task count, statuses, and members settled | Remote Task loading now depends only on stable Project/user identity; status/member enrichment updates locally, and RACI/Subtask reads execute in parallel. |
| Task Detail RACI markup used a newer CSS Module contract while its stylesheet still exposed the retired selector names | The active RACI selectors now match exactly. A/R/C/I pills, role labels, assignment identity, department context, long-name handling, and remove controls have deliberate spacing, wrapping, and focus behavior. |
| The same missing-CSS-selector defect existed beyond RACI in onboarding/auth, workspace states, metric cards, and RACI badges | All deterministic CSS Module references in active JavaScript/JSX were audited and corrected. A reusable verifier now fails on missing dot, quoted-bracket, or static-template selector references. |
| Task Detail and first-login panels could lose actions or compress controls at shorter/narrower viewports | Panel height now follows the dynamic viewport, content owns the internal scroll, header/footer stay usable, and Subtask/RACI controls wrap predictably at tablet and mobile widths. |

No database, RLS, policy, function, trigger, or migration changes were made.
Supabase Security Advisor was therefore not rerun; the requirement applies only when database or security state changes.

---

## 3. Machine-Verified Evidence

| Gate | Result |
| :--- | :---: |
| Operational V1 route and failure-state regression | **PASS — 14 routes + 16 contracts** |
| Navigation and loading regression | **PASS — 34/34** |
| Authentication/password lifecycle contracts | **PASS — 30/30** |
| Foreground auth and loading-performance regression | **PASS — 19 contracts** |
| CSS Module missing-reference verifier | **PASS — 43 imports / 1,690 static references** |
| Operational V1 visual-integrity static audit | **PASS — 18 critical surfaces + RACI/responsive/control contracts** |
| Explicit PostgREST relationship embeds | **PASS — 9/9** |
| Active Milestone terminology | **PASS — 0 matches** |
| P3-01 hierarchy regression | **PASS** |
| P3-02 Subtask hierarchy regression | **PASS — 9 contracts** |
| Production CORS and unauthenticated JWT gate | **PASS — 3/3** |
| Lint | **PASS — 0 errors; historical warnings unchanged** |
| Production build | **PASS** |
| GitHub Pages build and deployment | **PASS — run `32122745668`** |
| Deployed bundle contract | **PASS — 12/12** |
| Deployed JavaScript asset | **PASS — `index-vpST-M4-.js`** |
| Deployed visual-integrity CSS asset | **PASS — `index-swKp5fQZ.css`** |

The deployed asset additionally contains all four auth-performance markers: same-user token-refresh reconciliation, visibility-driven silent revalidation, retained-content background warning, and fail-closed access denial.

The latest 100 production API requests returned HTTP 200, the latest 100 Edge Function requests returned HTTP 200, and the latest 100 Postgres log entries contained no `ERROR`, `FATAL`, or `PANIC` severity.

Read-only production integrity checks confirmed zero orphan Task→Project, Task→Phase, Task→Task List, Subtask→Task, and RACI→Task relationships; zero Tasks without status; one published Process version; all four explicit hierarchy embed constraints present; and migration tip `20260817142153`.

Production currently contains zero Process Instances. Process Instance visibility and live process-step interaction therefore remain manual acceptance items and must use an intentionally started real Process, not seeded or fake data.

---

## 4. Manual Final Acceptance Checklist

Browser automation could not initialize in the local certification environment because the browser kernel-assets bootstrap failed before launch. The static CSS/visual contracts and deployed assets are verified; only these interactive checks remain:

1. Sign in with an authorized existing user, refresh a deep-linked route to confirm session restore, then sign out and confirm protected history cannot be reopened.
2. On Dashboard, My Work, Projects, hierarchy/List/Board/Task Detail, Departments, and Processes, background and restore the tab. Confirm no full-screen spinner, route replacement, collapsed hierarchy, closed Task Detail, scroll jump, or page-data request storm; the last rendered content must remain visible during silent access revalidation.
3. Visit Dashboard, My Work, Projects, Departments, Process Catalog, and permission-appropriate administration routes; confirm visible data, empty/error states, mobile navigation, and no console-blocking errors.
4. Open a real Project and exercise Phase → Task List → Task → Subtask / Process / Child Task expansion, List, Board movement, Task Detail save, status change, Subtask mutation, and supported RACI assignment.
5. Verify Project creation only with an intended real record; confirm success feedback and that a deliberately rejected/unauthorized action remains visible as an error instead of false success.
6. View Process definitions and versions. If operationally approved, start one real Process and verify its Instance, hierarchy placement, process steps, and My Work visibility.
7. Open notifications, mark one and all as read, verify navigation from a project notification, and confirm state remains current after refresh.
8. At approximately 1440, 1024, 768, and 390 CSS-pixel widths, visually inspect Login, Dashboard, My Work, Projects/hierarchy/List/Board, Task Detail/Subtasks/RACI, Process Catalog/Builder/Instance, Departments, Admin Users/Departments, and Workspace Settings for overlap, clipping, unintended page-level horizontal scroll, inaccessible actions, weak dark-theme contrast, and long-name breakage.
9. In Task Detail specifically, confirm A/R/C/I pills and titles are separated, assignment chips contain avatar/name/optional department/remove control without collisions, Add controls align, Subtask inline creation remains usable, content scrolls once, and close/save/delete remain reachable at common laptop heights and mobile width.

---

## 5. Certification Decision

All machine-verifiable Operational V1 gates pass, confirmed blockers are corrected and deployed, production telemetry and relational integrity are clean, and no security boundary was weakened.

**SNS Projects Operational V1 = `READY FOR MANUAL FINAL ACCEPTANCE`**
