# SNS Projects Operational V1 Stability Certification

**Status**: **`OPERATIONAL V1 — STABLE / VERIFIED`**

**Certification Date**: 2026-08-19  

**Certified Repository Commit**: `0bd418dd2d5aac53e9b142c44e59e772b27a1fbc` (`0bd418d`)

**Scope**: Current non-Finance SNS Projects application  

**Database Migration Tip**: `20260818120101_ov1_a_project_ownership_bootstrap_hotfix.sql`

---

## 1. Certification Boundary

This certification covers the complete, stabilized Operational V1 platform: authentication, role-aware Dashboard Engine, My Work, Projects, operational hierarchy, List, Board, Task Detail, Subtasks, Child Tasks, RACI matrix, Departments, permission-gated administration, Process Catalog, process definition/version views, exposed process start/runtime surfaces, notifications, navigation, deep-link contracts, the mandatory Operational V1 Visual Integrity / Cosmetic QA gate, the OV1-A server-enforced operational visibility boundary, the OV1-B frontend visibility alignment, OV1-C role-aware Dashboard presentation, and OV1-D Final Production Acceptance & Stability Closure.

Operational V1 is **STABLE** for production operational use.

It preserves all verified P1, P2, P3, OV1-A, OV1-B, and OV1-C behavior. It does not include Finance (Packages 4–7), Defined Process Excel import (Package 8), speculative features, fake production data, or a declaration of **FULL V1**.

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
| A Published Defined Process exposed only Start Process, while the existing detail loader accepted Draft versions only; when Live and Draft coexisted, the Published card branch hid every Draft action | Added an exact-version, read-only Process Definition route that bulk-loads the requested snapshot's steps, RACI, dependencies, and evidence information under existing RLS. Catalog cards now represent Published-only, Draft-only, and Live+Draft states independently; Start remains bound exclusively to the current Published version, while edit/publish actions remain Draft-only and authority-gated. |
| Hierarchy Phase and Task List rows used verbose contextual create buttons, then required users to reselect hierarchy parents already known from the clicked row | Replaced both row actions with a consistent, accessible 32px `+` icon control. The existing Task List and Task modals now receive the clicked hierarchy context, display the locked Project/Phase/Task List path, and resolve mutation parent IDs from that immutable context. Global header creation remains editable, successful inserts still use the existing silent local refresh, and expansion state is untouched. |
| Active frontend surfaces exposed internal Accountable/Responsible and RACI terminology as primary user language | Completed a presentation-only cutover to Owner, Assignee/Assignees, Consulted, and Informed across Tasks, My Work, Dashboard, hierarchy cards/rows, Process Builder/Definition/runtime, Start Process, Process Instance, validation, help, empty states, and administration copy. A centralized display map fixes Owner→A and Assignee→R while all `raci_role`, A/R codes, backend identifiers, RPCs, authorization, and process-engine behavior remain unchanged. |
| Any active workspace role could read all Projects and descendant operational rows because broad SELECT policies treated membership as visibility authority | OV1-A replaces workspace-wide operational SELECT with `auth.uid()`-bound private helpers and scoped RLS. Only CEO, CTO, Project Admin, and System Admin retain broad reads; all other users receive involved work plus minimum ancestors, with unrelated siblings and deep links denied server-side. Frontend context now separates workspace administration, global operational visibility, mutation capability, and read-only state. |
| OV1-A made newly created empty Projects and Task Lists unreadable to their creator during `INSERT ... RETURNING`, because descendant involvement did not exist yet | Production rollback transactions reproduced both SQLSTATE `42501` failures. The acceptance hotfix makes `projects.owner_id = auth.uid()` direct involvement and gives that Owner complete active-member-gated visibility inside only the owned Project. Empty Project, Phase, Task List, Task, and Subtask return reads now succeed without restoring workspace-wide access. |
| Active frontend caches and presentation still assumed workspace-wide visibility: authorization-sensitive caches were keyed only by container ID, scoped empty states implied that no Projects existed, unauthorized deep links could surface raw query failures, Viewer mutation controls remained visible, and My Work omitted department-RACI and Subtask-assignee involvement | OV1-B keeps Supabase/RLS authoritative and consumes only returned rows. Caches are now keyed by user plus the refreshed authorization-scope identity; Projects/Dashboard/count labels and empty states distinguish visible scope; child hierarchy queries wait for a visible Project; unavailable Project/Process links reveal no metadata; Viewer mutation controls are removed across Task Detail, hierarchy, Board, Process Catalog, and runtime; and My Work bulk-loads direct, department-RACI, and Subtask involvement without per-Task authorization queries. |
| Dashboard remained a mostly shared portfolio whose title changed by role, so workspace-only roles could receive executive-style presentation and System Administration lacked access/department-first context | OV1-C introduces a deterministic primary-persona resolver with explicit precedence, a single user/workspace/`authorizationScopeKey`-scoped RLS data layer, and reusable persona modules. CEO and CTO share the Executive Dashboard; System Admin prioritizes users/access/departments; Project Admin prioritizes portfolio/delivery/assignment health; workspace-only Owner/Admin stay operationally scoped while retaining capability-gated administration links; Member is personal-work-first; Viewer is read-only. Counts use only rows returned by RLS, department metrics use real department-targeted RACI, and Tasks/RACI/Subtasks/Processes are bulk-loaded without per-Task authorization queries. An active-cache-key guard fails closed during role changes so prior-persona totals cannot flash before the new scope is current. |
| In-app route navigation intermittently flashed false empty states ("0 Projects", "Clear Inbox", "0 Defined Processes") and brief persona title snaps | OV1-D introduces an atomic, in-memory session cache for `useUserContext` keyed by `userId:workspaceId` and fail-closed scoped hooks (`useProjects`, `useDefinedProcesses`, `useProcessInstance`, `useTasks`). Unresolved `authorizationScopeKey` maintains `loading = true` rather than prematurely discharging empty arrays `[]`. UI pages enforce the Global State Contract (`AUTHORIZATION_RESOLVING` $\to$ `CURRENT_SCOPE_LOADING` $\to$ `CURRENT_SCOPE_READY` / `CURRENT_SCOPE_ERROR`), ensuring empty states only render once data queries are authoritative. |
| Cold application boots and manual browser refreshes rendered a generic unstyled spinner that appeared visually frozen | OV1-D implements `AppColdLoader`, a branded, centered industrial loading composition using official Stack n Stock assets, ambient breathing yellow glow, smooth rotating orbital accents, crisp typography, and an indeterminate progress bar with `@media (prefers-reduced-motion: reduce)` support. Integrated into `ProtectedRoute` strictly for genuine cold starts, with zero appearance during internal route navigation. |
| `DepartmentWorkspacePage.jsx` referenced an undeclared `setTasksLoading` setter when department task sets were empty | OV1-D declares `tasksLoading` state, adds proper try/finally loading termination, and renders localized `TaskRowSkeleton` fallbacks. |

OV1-A changes SELECT authorization only. It does not alter P1/P2/P3 runtime transitions, RACI codes, process movement/cancellation, post-cancellation immutability, or parent-completion behavior.  
OV1-B adds no database migration and does not filter authorization results in JavaScript. Project Owner completeness and normal-user sibling exclusion remain direct consequences of the verified OV1-A/OV1-A.1 policies.  
OV1-C adds no route, database migration, RLS change, new authority, or demo-data mutation.  
OV1-D introduces no database migrations, schema alterations, or RLS changes. The production migration tip remains `20260818120101`.  
Supabase Security Advisor remains exactly the accepted six-warning baseline: five historical intentional workflow RPC warnings plus leaked-password protection, with zero new warnings.

---

## 3. Machine-Verified Evidence

| Gate | Result |
| :--- | :---: |
| Operational V1 route and failure-state regression | **PASS — 14 routes + 16 contracts** |
| Operational V1 loading & navigation stabilization suite | **PASS — 24/24 assertions** |
| Navigation and loading regression | **PASS — 35/35** |
| Authentication/password lifecycle contracts | **PASS — 30/30** |
| Foreground auth and loading-performance regression | **PASS — 19 contracts** |
| CSS Module missing-reference verifier | **PASS — 48 imports / 1,833 static references** |
| Operational V1 visual-integrity static audit | **PASS — 19 critical surfaces + RACI/responsive/control contracts** |
| Process Definition exact-version/access regression | **PASS — 10 required contracts** |
| Contextual hierarchy creation regression | **PASS — 8 required contracts** |
| User-facing operational terminology regression | **PASS — 9 required contracts** |
| OV1-A clean migration replay | **PASS — 31/31 migrations** |
| OV1-A authorization matrix | **PASS — 30 assertions** |
| Ownership/bootstrap authorization matrix | **PASS — 20 assertions** |
| OV1-A frontend capability separation | **PASS** |
| OV1-B frontend visibility/persona/deep-link regression | **PASS — 37 assertions** |
| OV1-C role-aware Dashboard persona/data/widget regression | **PASS — 43 assertions** |
| P1-02A / P2-02 / P2-03 lifecycle preservation | **PASS — 34/34 · 44/44 · 17/17** |
| OV1-A production policy/helper/RLS/index verification | **PASS** |
| OV1-A production System Role/scoped-role/deep-link verification | **PASS** |
| OV1-A production ownership/bootstrap transaction | **PASS — 5/5 returned rows + full hierarchy read; rolled back** |
| Supabase Security Advisor | **PASS — accepted 6-warning baseline unchanged** |
| Explicit PostgREST relationship embeds | **PASS — 9/9** |
| Active Milestone terminology | **PASS — 0 matches** |
| P3-01 hierarchy regression | **PASS** |
| P3-02 Subtask hierarchy regression | **PASS — 9 contracts** |
| Production CORS and unauthenticated JWT gate | **PASS — 3/3** |
| Documentation link integrity & portability audit | **PASS — 240 relative links checked, 0 errors** |
| Lint | **PASS — 0 errors; historical warnings unchanged** |
| Production build | **PASS** |
| GitHub Pages build and deployment | **PASS — OV1-D run `32150807393`** |
| Deployed JavaScript asset | **PASS — `index-D9yNtP1g.js`** |
| Deployed visual-integrity CSS asset | **PASS — `index-CVDxZAOV.css`** |
| Deployed brand asset | **PASS — `Logomark-01-DggrmBVL.png`** |

The deployed production asset contains all required stabilization markers: atomic cached context, fail-closed scoped hooks, persona persistence, `AppColdLoader` brand composition, reduced-motion media query handling, visibility-driven silent revalidation, and fail-closed access denial.

---

## 4. Manual Final Acceptance Verification

**Manual Acceptance Status**: **`PASSED / COMPLETED (2026-08-19)`**

Production manual verification on the live deployment (`https://abzops.github.io/sns-projects/`) confirmed all interactive and visual contracts across authorized users:

1. **Authentication & Session Lifecycle**: Signed in with existing authorized users, refreshed deep-linked routes confirming clean session restoration with zero layout shifts, and confirmed sign out locks protected routes.
2. **Tab Backgrounding & Foreground Return**: On Dashboard, My Work, Projects, Tasks, Departments, and Processes, backgrounded and restored the browser tab. Confirmed zero full-screen spinner storms, no collapsed hierarchy, no scroll jumps, and silent background revalidation preserving existing rendered data.
3. **Route Navigation & Loading Stability**: Internal navigation across all routes is instantaneous using memory-cached context and localized skeletons. Confirmed zero false "0 Projects", "Clear Inbox", or "0 Defined Processes" empty flashes, and zero persona title flicks.
4. **Hierarchy, Modals & RACI Operations**: Opened active Projects and verified Phase $\to$ Task List $\to$ Task $\to$ Subtask / Child Task expansion, Kanban board movement, Task Detail persistence, and RACI assignment updates. Confirmed context-locked row creation (`+`) populates and locks the parent hierarchy.
5. **Project Owner Bootstrap**: Created a Project owned by the signed-in creator, created child Phase and Task List containers, and verified immediate `INSERT ... RETURNING` visibility.
6. **Defined Processes & Runtime**: Verified Published-only cards display View Definition and Start Process; verified Draft cards display View Draft and edit controls for authorized roles; verified metadata-safe inspection.
7. **Notifications**: Opened notifications, marked as read, and verified project navigation from notifications.
8. **Responsive Layouts**: Tested at 1440px, 1024px, 768px, and 390px CSS widths. Confirmed zero horizontal clipping, zero horizontal page scroll, clean navigation wrapping, and accessible dark-theme contrast.
9. **Task Detail UX**: Confirmed separated Owner/Assignee/Consulted/Informed titles, collision-free assignment chips, responsive Subtask inline creation, and single internal scroll.
10. **Multi-Persona Dashboard Engine**: Verified deterministic persona resolution across CEO/CTO (Executive Portfolio), System Admin (User & Access Admin), Project Admin (Delivery & Assignment Health), Workspace Owner/Admin (Scoped Operations), Member (My Operations), and Viewer (Read-Only). Verified that role reductions immediately switch persona without flashing broader cached data.
11. **Cold-Start Loader**: Hard browser refresh displays the animated Stack n Stock `AppColdLoader` with breathing glow, orbit ring, and progress highlight. Confirmed normal internal route navigation never shows `AppColdLoader`.

---

## 5. Certification Decision

All automated regression suites pass, full signed-in production manual acceptance has passed, production telemetry and relational integrity are clean, and no security boundary was weakened.

**SNS Projects Operational V1 = `STABLE / VERIFIED`**

**Next Execution Package**: **`Package 4 — Finance Database Foundation`**
