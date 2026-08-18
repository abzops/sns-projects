# SNS Projects Operational V1 Stability Certification

**Status**: **`READY FOR MANUAL FINAL ACCEPTANCE`**

**Certification Date**: 2026-08-18  

**Certified Repository Commit**: `c1768353d2ddc0355c7b7f1cb676b2874c3b13c4`

**Scope**: Current non-Finance SNS Projects application  

**Database Migration Tip**: `20260818120101_ov1_a_project_ownership_bootstrap_hotfix.sql`

---

## 1. Certification Boundary

This certification covers the existing authentication, Dashboard, My Work, Projects, operational hierarchy, List, Board, Task Detail, Subtasks, Child Tasks, RACI, Departments, permission-gated administration, Process Catalog, process definition/version views, exposed process start/runtime surfaces, notifications, navigation, deep-link contracts, the mandatory Operational V1 Visual Integrity / Cosmetic QA gate, the OV1-A server-enforced operational visibility boundary, and the OV1-B frontend visibility alignment.

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
| A Published Defined Process exposed only Start Process, while the existing detail loader accepted Draft versions only; when Live and Draft coexisted, the Published card branch hid every Draft action | Added an exact-version, read-only Process Definition route that bulk-loads the requested snapshot's steps, RACI, dependencies, and evidence information under existing RLS. Catalog cards now represent Published-only, Draft-only, and Live+Draft states independently; Start remains bound exclusively to the current Published version, while edit/publish actions remain Draft-only and authority-gated. |
| Hierarchy Phase and Task List rows used verbose contextual create buttons, then required users to reselect hierarchy parents already known from the clicked row | Replaced both row actions with a consistent, accessible 32px `+` icon control. The existing Task List and Task modals now receive the clicked hierarchy context, display the locked Project/Phase/Task List path, and resolve mutation parent IDs from that immutable context. Global header creation remains editable, successful inserts still use the existing silent local refresh, and expansion state is untouched. |
| Active frontend surfaces exposed internal Accountable/Responsible and RACI terminology as primary user language | Completed a presentation-only cutover to Owner, Assignee/Assignees, Consulted, and Informed across Tasks, My Work, Dashboard, hierarchy cards/rows, Process Builder/Definition/runtime, Start Process, Process Instance, validation, help, empty states, and administration copy. A centralized display map fixes Owner→A and Assignee→R while all `raci_role`, A/R codes, backend identifiers, RPCs, authorization, and process-engine behavior remain unchanged. |
| Any active workspace role could read all Projects and descendant operational rows because broad SELECT policies treated membership as visibility authority | OV1-A replaces workspace-wide operational SELECT with `auth.uid()`-bound private helpers and scoped RLS. Only CEO, CTO, Project Admin, and System Admin retain broad reads; all other users receive involved work plus minimum ancestors, with unrelated siblings and deep links denied server-side. Frontend context now separates workspace administration, global operational visibility, mutation capability, and read-only state. |
| OV1-A made newly created empty Projects and Task Lists unreadable to their creator during `INSERT ... RETURNING`, because descendant involvement did not exist yet | Production rollback transactions reproduced both SQLSTATE `42501` failures. The acceptance hotfix makes `projects.owner_id = auth.uid()` direct involvement and gives that Owner complete active-member-gated visibility inside only the owned Project. Empty Project, Phase, Task List, Task, and Subtask return reads now succeed without restoring workspace-wide access. |
| Active frontend caches and presentation still assumed workspace-wide visibility: authorization-sensitive caches were keyed only by container ID, scoped empty states implied that no Projects existed, unauthorized deep links could surface raw query failures, Viewer mutation controls remained visible, and My Work omitted department-RACI and Subtask-assignee involvement | OV1-B keeps Supabase/RLS authoritative and consumes only returned rows. Caches are now keyed by user plus the refreshed authorization-scope identity; Projects/Dashboard/count labels and empty states distinguish visible scope; child hierarchy queries wait for a visible Project; unavailable Project/Process links reveal no metadata; Viewer mutation controls are removed across Task Detail, hierarchy, Board, Process Catalog, and runtime; and My Work bulk-loads direct, department-RACI, and Subtask involvement without per-Task authorization queries. |

OV1-A changes SELECT authorization only. It does not alter P1/P2/P3 runtime transitions, RACI codes, process movement/cancellation, post-cancellation immutability, or parent-completion behavior.
OV1-B adds no database migration and does not filter authorization results in JavaScript. Project Owner completeness and normal-user sibling exclusion remain direct consequences of the verified OV1-A/OV1-A.1 policies.
Supabase Security Advisor was rerun after production deployment and remains exactly the accepted six-warning baseline: five historical intentional workflow RPC warnings plus leaked-password protection, with zero new OV1-A warnings.

---

## 3. Machine-Verified Evidence

| Gate | Result |
| :--- | :---: |
| Operational V1 route and failure-state regression | **PASS — 14 routes + 16 contracts** |
| Navigation and loading regression | **PASS — 34/34** |
| Authentication/password lifecycle contracts | **PASS — 30/30** |
| Foreground auth and loading-performance regression | **PASS — 19 contracts** |
| CSS Module missing-reference verifier | **PASS — 45 imports / 1,813 static references** |
| Operational V1 visual-integrity static audit | **PASS — 19 critical surfaces + RACI/responsive/control contracts** |
| Process Definition exact-version/access regression | **PASS — 10 required contracts** |
| Contextual hierarchy creation regression | **PASS — 8 required contracts** |
| User-facing operational terminology regression | **PASS — 9 required contracts** |
| OV1-A clean migration replay | **PASS — 31/31 migrations** |
| OV1-A authorization matrix | **PASS — 30 assertions** |
| OV1-A Project ownership/bootstrap matrix | **PASS — 20 assertions** |
| OV1-A frontend capability separation | **PASS** |
| OV1-B frontend visibility/persona/deep-link regression | **PASS — 37 assertions** |
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
| Lint | **PASS — 0 errors; historical warnings unchanged** |
| Production build | **PASS** |
| GitHub Pages build and deployment | **PASS — OV1-B run `32138145503`** |
| Deployed bundle contract | **PASS — 12/12** |
| Deployed hierarchy context markers | **PASS — 4/4** |
| Deployed terminology markers | **PASS — 6 required present / 6 retired absent** |
| Deployed JavaScript asset | **PASS — `index-9QEQBPHU.js`** |
| Deployed visual-integrity CSS asset | **PASS — `index-O1SIsU9n.css`** |

The deployed asset additionally contains all four auth-performance markers: same-user token-refresh reconciliation, visibility-driven silent revalidation, retained-content background warning, and fail-closed access denial. OV1-B deployment verification also found all four scoped-visibility markers: personal-scope empty state, metadata-safe Project unavailable state, My Subtasks involvement, and metadata-safe Process Instance unavailable state.

The latest 100 production API requests returned HTTP 200, the latest 100 Edge Function requests returned HTTP 200, and the latest 100 Postgres log entries contained no `ERROR`, `FATAL`, or `PANIC` severity.

Read-only production integrity checks confirmed zero orphan Task→Project, Task→Phase, Task→Task List, Subtask→Task, and RACI→Task relationships; zero Tasks without status; one published Process version; all four explicit hierarchy embed constraints present; and migration tip `20260818120101`.

OV1-A production checks additionally confirmed RLS on all 13 operational/runtime tables, exact scoped policy bindings, ten hardened private policy helpers, 13 ownership policy branches, seven relevant predicate/ownership indexes, broad visibility for active CEO/CTO/Project Admin/System Admin actors, exact policy-authorized Project sets for no-System-Role actors, and zero rows for an unrelated direct Project query.

Read-only Process catalog verification found one Published-only definition, two Draft-only definitions, and no current Live+Draft coexistence record. Coexistence behavior is regression-covered without creating fake production data. The current production Defined Process RACI schema supports user and Process Starter actors; no department actor column or independent schema defect was found.

Production currently contains zero Process Instances. Process Instance visibility and live process-step interaction therefore remain manual acceptance items and must use an intentionally started real Process, not seeded or fake data.

---

## 4. Manual Final Acceptance Checklist

Browser automation could not initialize in the local certification environment because the browser kernel-assets bootstrap failed before launch. The static CSS/visual contracts and deployed assets are verified; only these interactive checks remain:

1. Sign in with an authorized existing user, refresh a deep-linked route to confirm session restore, then sign out and confirm protected history cannot be reopened.
2. On Dashboard, My Work, Projects, hierarchy/List/Board/Task Detail, Departments, and Processes, background and restore the tab. Confirm no full-screen spinner, route replacement, collapsed hierarchy, closed Task Detail, scroll jump, or page-data request storm; the last rendered content must remain visible during silent access revalidation.
3. Visit Dashboard, My Work, Projects, Departments, Process Catalog, and permission-appropriate administration routes; confirm visible data, empty/error states, mobile navigation, and no console-blocking errors.
4. Open a real Project and exercise Phase → Task List → Task → Subtask / Process / Child Task expansion, List, Board movement, Task Detail save, status change, Subtask mutation, and supported RACI assignment. In Hierarchy, use two different Phase-row `+` controls and confirm each Task List modal shows and preserves the clicked locked Phase; use two different Task List-row `+` controls and confirm each Task modal shows the current Project plus the clicked locked Phase and Task List. Create only intended real records, confirm each appears immediately under the exact parent, and confirm all existing expansion state remains unchanged. Verify the global `+ Task List` and `Add Task` actions still allow normal parent selection.
5. Reaccept the corrected production bootstrap with intended real records: create a Project owned by the signed-in creator, then create an empty Phase and Task List inside it. Confirm each success response returns normally and the new hierarchy remains visible. Confirm a workspace-only Owner/Admin without a System Role still cannot open an unrelated Project.
6. On the real Published-only card, confirm View Definition and Start Process are both visible; on Draft-only cards, confirm View Draft plus Edit/Publish only for authorized roles. Verify the viewer shows exact version metadata, ordered steps, RACI/response markers, requirements, and dependency flow with no mutation controls. If a real Live+Draft pair is later created, confirm both version blocks remain visible and Start uses Live only. If operationally approved, start one real Process and verify its Instance, hierarchy placement, process steps, and My Work visibility.
7. Open notifications, mark one and all as read, verify navigation from a project notification, and confirm state remains current after refresh.
8. At approximately 1440, 1024, 768, and 390 CSS-pixel widths, visually inspect Login, Dashboard, My Work, Projects/hierarchy/List/Board, Task Detail/Subtasks/assignments, Process Catalog/Definition/Builder/Instance, Departments, Admin Users/Departments, and Workspace Settings for overlap, clipping, unintended page-level horizontal scroll, inaccessible actions, weak dark-theme contrast, and long-name breakage. Confirm normal users see Owner, Assignee/Assignees, Consulted, and Informed throughout; small A/R/C/I badges may remain only as secondary context.
9. In Task Detail specifically, confirm A/R/C/I pills and the Owner/Assignees/Consulted/Informed titles are separated, assignment chips contain avatar/name/optional department/remove control without collisions, Add controls align, Subtask inline creation remains usable, content scrolls once, and close/save/delete remain reachable at common laptop heights and mobile width.
10. Exercise representative users for each System Role and each workspace-only role. Confirm CEO/CTO/Project Admin/System Admin retain their expected portfolio visibility; a Project Owner sees the complete owned Project; workspace-only Owner/Admin/Member/Viewer see only involved work and ancestor context; unrelated Phase B, Task List B, sibling Tasks, counts, and deep links remain absent; Viewer has no mutation controls; Subtask and department-RACI involvement appear in My Work; and removing a System Role falls back to scoped rows after authorization refresh without briefly restoring the broad cached portfolio.

---

## 5. Certification Decision

All machine-verifiable Operational V1 gates pass, confirmed blockers are corrected and deployed, production telemetry and relational integrity are clean, and no security boundary was weakened.

**SNS Projects Operational V1 = `READY FOR MANUAL FINAL ACCEPTANCE`**
