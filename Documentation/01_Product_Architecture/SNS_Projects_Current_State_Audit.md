# SNS Projects — Current-State Technical Audit

## Document Control
- **Status**: `HISTORICAL AUDIT` (Point-in-time audit of V1 baseline prior to V2 architecture)
- **Audit Date**: August 14, 2026  
- **Audited Repository**: `stacknstock-projects`  
- **Audit Type**: Read-Only Full Architecture & Workflow Inspection  
- **Target Goal**: Provide a complete technical and functional baseline to guide the design and implementation of **SNS Projects V2**.

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Current Technology Stack](#2-current-technology-stack)
3. [Repository Architecture](#3-repository-architecture)
4. [Application Startup Flow](#4-application-startup-flow)
5. [Routing & Navigation](#5-routing--navigation)
6. [Authentication](#6-authentication)
7. [User & Permission Model](#7-user--permission-model)
8. [Supabase Integration](#8-supabase-integration)
9. [Database Model](#9-database-model)
10. [Workspace Workflow](#10-workspace-workflow)
11. [Project Workflow](#11-project-workflow)
12. [Task/Kanban Workflow](#12-taskkanban-workflow)
13. [Existing Business Logic](#13-existing-business-logic)
14. [Current Dashboards](#14-current-dashboards)
15. [Departments](#15-departments)
16. [RACI](#16-raci)
17. [Approvals](#17-approvals)
18. [Dependencies](#18-dependencies)
19. [Notifications & Alerts](#19-notifications--alerts)
20. [Comments & Activity](#20-comments--activity)
21. [Files & Attachments](#21-files--attachments)
22. [UI/UX Current State](#22-uiux-current-state)
23. [GitHub Pages Deployment](#23-github-pages-deployment)
24. [Complete Current Algorithm](#24-complete-current-algorithm)
25. [Existing Feature Matrix](#25-existing-feature-matrix)
26. [Mock / Hardcoded Data](#26-mock--hardcoded-data)
27. [Legacy / Unused Code](#27-legacy--unused-code)
28. [Technical Debt](#28-technical-debt)
29. [Security Concerns](#29-security-concerns)
30. [What Should Be Preserved](#30-what-should-be-preserved)
31. [Missing Capabilities](#31-missing-capabilities)
32. [Recommended V2 Migration Considerations](#32-recommended-v2-migration-considerations)
33. [Important Source Files](#33-important-source-files)
34. [Open Questions](#34-open-questions)

---

## 1. Executive Summary

The current **SNS Projects** (StacknStock Projects) application is a lightweight, single-page React application (SPA) built with Vite and Supabase. It functions primarily as a **multi-workspace Kanban and task list manager** modelled after basic project management tools (e.g., Trello / Zoho Projects basics).

### Key Findings at a Glance:
- **Core Architecture:** Client-side rendered React 19 + React Router 7 + Supabase JS Client v2 + PostgreSQL with Row-Level Security (RLS).
- **Entities:** 6 database tables: `profiles`, `workspaces`, `workspace_members`, `projects`, `task_statuses`, and `tasks`.
- **Primary Workflows:**
  - Workspace management (creation, deletion, rename, email-based team invitations).
  - Project management (color-coded projects partitioned by workspace).
  - Task management (Kanban board with `@dnd-kit` drag-and-drop, sortable list view, priority, assignee, due date, status changes, and slide-in task edit drawer).
- **Gaps for V2:** The application currently has **no concept of organizational departments**, **no RACI framework** (only a single `assignee_id`), **no approval workflows**, **no task dependencies or milestones**, **no CEO/CTO/executive dashboards**, **no comments or activity history logs**, and **no file storage/attachment integration**.

---

## 2. Current Technology Stack

| Technology Layer | Tool / Library | Exact Version in Repo | Purpose / Implementation Detail |
| :--- | :--- | :--- | :--- |
| **Framework / Library** | React | `^19.2.7` | UI library rendering components, contexts, and hooks |
| **DOM Renderer** | React DOM | `^19.2.7` | DOM rendering & Portals (`createPortal` for Modals/Drawers/Toasts) |
| **Build Tool & Dev Server** | Vite | `^8.1.1` (runner `v8.1.3`) | Fast ESM bundler, dev server with HMR |
| **Language** | JavaScript (ESM) | ES2022+ | `.jsx` and `.js` modules (No TypeScript compilation enabled in src) |
| **Package Manager** | npm | `package-lock.json` v3 | Dependency resolution and scripts |
| **Routing** | React Router DOM | `^7.18.1` | Client-side routing (`BrowserRouter`, `Routes`, `Route`, `Outlet`, `NavLink`, `useParams`, `useNavigate`) |
| **Drag & Drop** | `@dnd-kit/core` | `^6.3.1` | Pointer sensor drag-and-drop context for Kanban board |
| **DnD Sorting** | `@dnd-kit/sortable` | `^10.0.0` | Vertical list sorting strategy & `useSortable` hook |
| **DnD Utilities** | `@dnd-kit/utilities`| `^3.2.2` | CSS transform utilities for drag animations |
| **Backend & Auth Client**| `@supabase/supabase-js`| `^2.110.0` | Supabase Postgres REST client & GoTrue authentication client |
| **Database Driver (Admin)**| `pg` | `^8.22.0` | Node.js PostgreSQL client used exclusively in `scripts/apply-supabase-db.mjs` |
| **Icons** | `lucide-react` | `^1.23.0` | Comprehensive vector icon set across layout, badges, buttons, and inputs |
| **Linter** | `oxlint` | `^1.71.0` | High-performance Rust-based JavaScript linter configured via `.oxlintrc.json` |
| **Vite React Plugin** | `@vitejs/plugin-react` | `^6.0.3` | Babel/Babel-free Fast Refresh plugin for React |
| **Type Definitions** | `@types/react`, `@types/react-dom` | `^19.2.17`, `^19.2.3` | TypeScript types for IDE auto-completion |
| **CSS Architecture** | Vanilla CSS + CSS Modules | Native CSS3 | Global tokens in `src/index.css`, scoped styles via `*.module.css` |
| **State Management** | React Context + Custom Hooks | Native React | `AuthContext`, `ToastContext`, and 6 modular state hooks |
| **Form Handling** | Native Controlled Forms | Native React | `useState` handlers, native inputs, textareas, selects |
| **Date/Time Library** | Native JavaScript `Date` | Built-in | `Intl.DateTimeFormat` / `toLocaleDateString()` helpers |

---

## 3. Repository Architecture

```text
stacknstock-projects/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml               # GitHub Actions CI/CD deploying dist to GitHub Pages
├── public/
│   ├── favicon.svg                        # SVG logo mark
│   ├── icons.svg                          # Legacy SVG symbol sheet
│   ├── stacknstock-horizontal.png         # Official dark-mode horizontal brand logo
│   ├── stacknstock-logo.png               # Official brand square logomark (PNG)
│   └── stacknstock-logo.svg               # Official brand square logomark (SVG)
├── scripts/
│   └── apply-supabase-db.mjs              # Node.js automation script executing schema.sql & seed dataset via pg
├── src/
│   ├── assets/
│   │   ├── 01_Logo/                       # Master brand vector & raster assets directory
│   │   │   ├── 01_Horizontal_Logo/
│   │   │   ├── 02_Vertical_Logo/
│   │   │   ├── 03_Logomark/
│   │   │   └── 04_Wordmark/
│   │   ├── hero.png                       # Static visual asset
│   │   └── vite.svg                       # Default Vite logo
│   ├── components/
│   │   ├── AppLayout.jsx & .module.css    # Main dashboard shell (collapsible sidebar, brand header, mobile menu)
│   │   ├── Avatar.jsx & .module.css       # Dynamic user avatar (initials gradient or image)
│   │   ├── EmptyState.jsx & .module.css   # Reusable empty data placeholder with action button
│   │   ├── Modal.jsx & .module.css        # Accessible portal dialog with backdrop blur & ESC listener
│   │   ├── PriorityIcon.jsx & .module.css # Colored priority dot indicator with optional pulse animation
│   │   ├── ProtectedRoute.jsx             # Auth guard wrapper redirecting unauthenticated users to /login
│   │   ├── Spinner.jsx & .module.css      # Animated golden arc spinner
│   │   ├── StatusBadge.jsx & .module.css  # Tinted pill badge with color dot for task statuses
│   │   ├── TaskCard.jsx & .module.css     # Kanban work item card (title, clamped description, due badge, avatar)
│   │   ├── TaskDetailPanel.jsx & .module.css # Slide-in drawer for editing/deleting tasks
│   │   ├── TaskRow.jsx & .module.css      # Table row component for list view
│   │   └── Toast.jsx & .module.css        # Portal notification toast system with auto-dismiss progress bar
│   ├── contexts/
│   │   └── AuthContext.jsx                # React Context wrapping Supabase session, user, login, signup, logout
│   ├── hooks/
│   │   ├── useMembers.js                  # Workspace members data fetcher, role updater, invitation creator
│   │   ├── useProfile.js                  # User profile state & updater
│   │   ├── useProjects.js                 # Project CRUD hook filtered by workspaceId
│   │   ├── useTasks.js                    # Task CRUD and Kanban reordering hook joined with status & assignee
│   │   ├── useTaskStatuses.js             # Project Kanban status columns ordered by position
│   │   └── useWorkspaces.js               # Workspace fetcher (with aggregate project/member counts) & CRUD
│   ├── lib/
│   │   └── supabase.js                    # Supabase client instantiation, URL validation, and config verification
│   ├── pages/
│   │   ├── LoginPage.jsx & .module.css    # Email/password authentication login card
│   │   ├── SignUpPage.jsx & .module.css   # User registration form with email confirmation notices
│   │   ├── WorkspacesPage.jsx & .module.css # Grid of workspaces with member/project counters
│   │   ├── ProjectsPage.jsx & .module.css # Workspace projects grid with color picker and create modal
│   │   ├── TasksPage.jsx & .module.css    # Core screen: Kanban Board + List Table + Filters + Detail Drawer
│   │   └── WorkspaceSettingsPage.jsx & .module.css # General tab (rename/delete) + Members tab (roles/invites)
│   ├── App.jsx                            # Router provider, AuthProvider, ToastProvider hierarchy
│   ├── index.css                          # Global design tokens (colors, typography, transitions, animations)
│   └── main.jsx                           # Application DOM entry point (`createRoot`)
├── supabase/
│   ├── fix_rls_and_cleanup.sql            # Idempotent SQL script for fixing permissions and removing duplicates
│   ├── schema.sql                         # Canonical production schema, tables, triggers, indexes, and RLS policies
│   ├── seed_sns_projects_dataset.sql      # Dataset importer converting SNS operations/engineering tasks into projects
│   └── setup.sql                          # Monolithic setup script combining schema and seed data
├── .env                                   # Client environment configuration (VITE_SUPABASE_URL, ANON_KEY)
├── .env.admin                             # Admin DB connection variables for automated script migrations
├── .env.example                           # Example template for client environment
├── .gitignore                             # Git exclusion list
├── .oxlintrc.json                         # Oxlint code quality configuration
├── brand guideline stack n stock TM.pdf   # Official brand identity manual
├── index.html                             # Single-page HTML shell with Google Fonts & favicon
├── package.json                           # NPM package manifest
├── package-lock.json                      # Exact dependency lockfile
├── README.md                              # Local setup and deployment documentation
└── vite.config.js                         # Vite build configuration (base path, React plugin)
```

---

## 4. Application Startup Flow

```text
1. Browser loads index.html
   ├── Loads Montserrat / Inter Google Fonts & /stacknstock-logo.png
   └── Executes /src/main.jsx

2. main.jsx Initialisation
   ├── Loads global styles: src/index.css
   └── Mounts <App /> into #root container

3. App.jsx Router & Provider Setup
   ├── Calculates router basename dynamically from import.meta.env.BASE_URL
   ├── Wraps application in <BrowserRouter basename={routerBasename}>
   ├── Mounts <AuthProvider> (src/contexts/AuthContext.jsx)
   └── Mounts <ToastProvider> (src/components/Toast.jsx)

4. Authentication Check (AuthContext.jsx)
   ├── Verifies Supabase configuration via src/lib/supabase.js
   ├── Calls supabase.auth.getSession() to retrieve active JWT session
   ├── Binds supabase.auth.onAuthStateChange listener
   └── While loading is true, blocks route evaluation

5. Route Resolution & Protection (ProtectedRoute.jsx)
   ├── If session is null -> Navigates to /login
   └── If session exists -> Renders <Outlet /> inside <AppLayout>

6. Shell & Workspace Hydration (AppLayout.jsx)
   ├── Renders sidebar with active user profile (useAuth)
   ├── Evaluates URL parameters (:workspaceId)
   └── If route is "/", renders <WorkspacesPage> fetching user's workspaces via useWorkspaces()
```

---

## 5. Routing & Navigation

### Current Route Map

| Path Pattern | Component | Purpose | Auth Required | Role Guard |
| :--- | :--- | :--- | :--- | :--- |
| `/login` | `LoginPage` | User login with email/password | No (redirects to `/` if logged in) | Public |
| `/signup` | `SignUpPage` | Registration with full name, email, password | No (redirects to `/` if logged in) | Public |
| `/` | `WorkspacesPage` | Workspaces overview & creation hub | Yes (`ProtectedRoute`) | Any active workspace member |
| `/workspace/:workspaceId` | `ProjectsPage` | Projects overview for a specific workspace | Yes (`ProtectedRoute`) | Active member of workspace |
| `/workspace/:workspaceId/project/:projectId` | `TasksPage` | Task management (Kanban & List views) | Yes (`ProtectedRoute`) | Active member of workspace |
| `/workspace/:workspaceId/settings` | `WorkspaceSettingsPage` | Workspace profile edit, deletion, members list | Yes (`ProtectedRoute`) | General tab: Owner/Admin; Delete: Owner only |
| `/workspace/:workspaceId/members` | `WorkspaceSettingsPage` | Direct link to Members tab | Yes (`ProtectedRoute`) | Invite/Role edit: Owner/Admin |

### Navigation Architecture Details:
- **Sidebar (`src/components/AppLayout.jsx`):**
  - Always shows top link to **Workspaces** (`/`).
  - When within a workspace (`workspaceId` present in URL), dynamically exposes:
    - **Projects** (`/workspace/:workspaceId`)
    - **Members** (`/workspace/:workspaceId/members`)
    - **Settings** (`/workspace/:workspaceId/settings`)
- **Breadcrumbs / Back Navigation:**
  - `ProjectsPage` contains a back button to `/` (`WorkspacesPage`).
  - `TasksPage` contains a back button to `/workspace/:workspaceId` (`ProjectsPage`).
- **404 & SPA Handling:**
  - In development: Vite handles fallback to `/index.html`.
  - In GitHub Pages production: `.github/workflows/deploy-pages.yml` copies `dist/index.html` to `dist/404.html` so client-side routes do not result in HTTP 404 on page reload.

---

## 6. Authentication

### Implementation Source: `src/contexts/AuthContext.jsx` & `src/lib/supabase.js`

- **Provider:** Supabase GoTrue Auth (`supabase.auth`).
- **Auth Methods:**
  - `signInWithPassword({ email, password })`
  - `signUp({ email, password, options: { data: { full_name } } })`
  - `signOut()`
- **Session Handling:**
  - Supabase client persists tokens in `localStorage` under `sb-<project-ref>-auth-token`.
  - `onAuthStateChange` listener ensures automatic token refresh and instantaneous UI session syncing across tabs.
- **Profile Creation Trigger (`supabase/schema.sql` lines 144–168):**
  - PostgreSQL trigger `on_auth_user_created` fires on `AFTER INSERT ON auth.users`.
  - Executes `handle_new_user()` function which automatically extracts `raw_user_meta_data->>'full_name'` and inserts a new row into `public.profiles`.

---

## 7. User & Permission Model

### Workspace Role Hierarchy
The application implements four roles defined by `CHECK (role IN ('owner', 'admin', 'member', 'viewer'))`:

```text
   [ Owner ]      -> Full control: rename workspace, delete workspace, invite/remove members, manage projects/tasks
       ↓
   [ Admin ]      -> Workspace management: invite/remove members (except owner), manage projects/tasks
       ↓
   [ Member ]     -> Operational work: create projects, create/edit/move/delete tasks
       ↓
   [ Viewer ]     -> Read-only: view projects, statuses, and tasks
```

### Role Capabilities Matrix in Existing Code:

| Action | Owner | Admin | Member | Viewer | Enforcement Mechanism |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Delete Workspace** | Yes | No | No | No | RLS `workspaces_delete_owner` + UI check |
| **Rename Workspace** | Yes | Yes | No | No | RLS `workspaces_update_owner` + UI input disabled |
| **Invite Team Member** | Yes | Yes | No | No | RLS `workspace_members_insert_admin_owner` + UI modal |
| **Change Member Role** | Yes | Yes (restricted) | No | No | RLS + UI weight check (`roleWeights`) |
| **Remove Member** | Yes | Yes | No | No | RLS `workspace_members_delete_admin_owner` + UI button |
| **Create Project** | Yes | Yes | Yes | No | RLS `projects_insert_member` |
| **Delete Project** | Yes | Yes | No | No | RLS `projects_delete_admin_owner` |
| **Create / Move Task** | Yes | Yes | Yes | No | RLS `tasks_insert_member` / `tasks_update_member` |
| **Delete Task** | Yes | Yes | Yes | No | RLS `tasks_delete_member` |
| **View Project / Tasks**| Yes | Yes | Yes | Yes | RLS `*_select_member` |

### Existing vs Missing System Roles:
- **Existing:** `owner`, `admin`, `member`, `viewer` (Scoped strictly per workspace).
- **Completely Missing in Current System:**
  - System-wide / Super-Admin role
  - Executive Roles: **CEO**, **CTO**
  - Functional Roles: **Project Administrator**, **Department Head**, **Approver**, **Reviewer**
  - RACI designations (Responsible, Accountable, Consulted, Informed)

---

## 8. Supabase Integration

### Implementation Source: `src/lib/supabase.js`

- **Client Initialization:**
  - Initialized with `createClient(supabaseUrl, supabaseAnonKey)`.
  - Includes validation helper `isValidSupabaseUrl` and placeholder detection pattern (`/your-|project-ref|anon-key|change_me/i`).
- **Environment Variables Used:**
  - `VITE_SUPABASE_URL` (Client URL)
  - `VITE_SUPABASE_ANON_KEY` (Public anonymous JWT key)
  - `SUPABASE_DB_URL` / `SUPABASE_DB_PASSWORD` (Admin setup script only in `.env.admin`)
  - `SUPABASE_SEED_EMAIL` (Seed user identifier in `.env.admin`)
- **Query Patterns:**
  - Uses direct PostgREST table queries: `.from('table').select(...)`.
  - Batching / Aggregations: Handled client-side (e.g. `useWorkspaces` loads all workspace IDs, then queries `workspace_members` and `projects` with `.in('workspace_id', ids)` and calculates counts in memory).
- **Realtime:** No Supabase Realtime subscriptions (`supabase.channel`) are currently attached.
- **Storage:** No Supabase Storage buckets or file APIs are currently integrated.
- **Edge Functions:** No Supabase Edge Functions (`supabase.functions`) are used.

---

## 9. Database Model

### Entity Relationship Diagram

```text
                  +-------------------------+
                  |       auth.users        |
                  +-------------------------+
                               |
                               | (1 : 1 via trigger)
                               v
                  +-------------------------+
                  |     public.profiles     |
                  +-------------------------+
                    |          |          |
         (created)  |          |          | (assignee / created)
                    v          |          v
  +--------------------+       |    +--------------------+
  | public.workspaces  |       |    |    public.tasks    |
  +--------------------+       |    +--------------------+
            |                  |              ^
            | (1 : N)          |              |
            +------------+     |              | (N : 1)
            |            |     |              |
            v            v     v              |
  +------------------+ +--------------------+ |
  | public.projects  | | workspace_members  | |
  +------------------+ +--------------------+ |
            |                                 |
            | (1 : N)                         |
            v                                 |
  +--------------------+                      |
  |public.task_statuses|----------------------+
  +--------------------+
```

### Table Specifications

#### 1. `public.profiles`
- **Purpose:** Stores public user metadata synchronized with `auth.users`.
- **Columns:** `id` (uuid, PK, references `auth.users`), `full_name` (text), `avatar_url` (text), `created_at` (timestamptz), `updated_at` (timestamptz).
- **Operations:** Read by all authenticated users; updated only by profile owner.

#### 2. `public.workspaces`
- **Purpose:** Top-level tenancy container.
- **Columns:** `id` (uuid, PK), `name` (text), `created_by` (uuid, references `profiles.id`), `created_at` (timestamptz), `updated_at` (timestamptz).
- **Operations:** Created by any authenticated user; updated/deleted only by workspace `owner`.

#### 3. `public.workspace_members`
- **Purpose:** Membership association linking users to workspaces with roles and status.
- **Columns:** `id` (uuid, PK), `workspace_id` (uuid, references `workspaces.id`), `user_id` (uuid, nullable, references `profiles.id`), `invited_email` (text), `role` (text: owner/admin/member/viewer), `status` (text: active/pending/declined), `invited_by` (uuid, references `profiles.id`), `created_at` (timestamptz).
- **Constraints:**
  - Unique index `uq_workspace_member_user` on `(workspace_id, user_id)` WHERE `user_id IS NOT NULL`.
  - Unique index `uq_workspace_member_pending_email` on `(workspace_id, invited_email)` WHERE `status = 'pending'`.

#### 4. `public.projects`
- **Purpose:** Project bucket containing tasks.
- **Columns:** `id` (uuid, PK), `workspace_id` (uuid, references `workspaces.id`), `name` (text), `description` (text), `color` (text, default `#FDE215`), `created_by` (uuid, references `profiles.id`), `created_at` (timestamptz), `updated_at` (timestamptz).
- **Operations:** Read by workspace members; created/updated by members/admins/owners; deleted by admins/owners.

#### 5. `public.task_statuses`
- **Purpose:** Kanban status columns for a project.
- **Columns:** `id` (uuid, PK), `project_id` (uuid, references `projects.id`), `name` (text), `color` (text), `position` (integer), `created_at` (timestamptz).
- **Default Seed (Trigger `on_project_created`):**
  1. `To Do` (`#a0a0a0`, position 0)
  2. `In Progress` (`#8cc9ff`, position 1)
  3. `In Review` (`#ffb020`, position 2)
  4. `Done` (`#60d394`, position 3)

#### 6. `public.tasks`
- **Purpose:** Individual actionable work items.
- **Columns:** `id` (uuid, PK), `project_id` (uuid, references `projects.id`), `title` (text), `description` (text), `status_id` (uuid, references `task_statuses.id`), `priority` (text: none/low/medium/high/urgent), `assignee_id` (uuid, references `profiles.id`), `due_date` (date), `position` (integer, default 0), `created_by` (uuid, references `profiles.id`), `created_at` (timestamptz), `updated_at` (timestamptz).

---

## 10. Workspace Workflow

### Lifecycle Algorithm:
1. **Creation:**
   - Any authenticated user enters a name on `WorkspacesPage`.
   - `useWorkspaces.createWorkspace()` creates a new UUID, inserts the row into `public.workspaces`, and immediately inserts a row into `public.workspace_members` setting `user_id = auth.uid()`, `role = 'owner'`, and `status = 'active'`.
2. **Membership & Invites:**
   - On `WorkspaceSettingsPage`, Admins/Owners invite via email (`invited_email`, `role`, `status = 'pending'`).
   - RLS allows users to claim pending invites when their logged-in email matches `invited_email`.
   - Owners can change member roles (`admin`, `member`, `viewer`). Admins cannot modify owners or promote to higher roles.
3. **Workspace Switching:**
   - Multi-tenancy is URL-driven (`/workspace/:workspaceId`).
   - A user can belong to infinite workspaces. Returning to `/` displays all workspaces where the user has active membership.
4. **Deletion:**
   - Owner clicks "Delete Workspace" -> triggers cascading delete (`ON DELETE CASCADE` removes all associated `workspace_members`, `projects`, `task_statuses`, and `tasks`).

---

## 11. Project Workflow

### Lifecycle Algorithm:
1. **Creation:**
   - Triggered via "New Project" button on `ProjectsPage`.
   - Requires: `name`, optional `description`, and a choice of 6 preset colors (`#FDE215`, `#60d394`, `#8cc9ff`, `#ff6666`, `#c084fc`, `#ff8c42`) or custom hex.
   - Database trigger `on_project_created` automatically generates the 4 default Kanban statuses.
2. **Project Partitioning:**
   - Projects are strictly scoped to `workspace_id`.
   - There are **no project-specific memberships**; all workspace members automatically have access to all projects in that workspace according to their workspace role.
3. **Missing Project Features:**
   - No project start/end dates
   - No project milestones or phases (imported dataset stored phases as text inside task descriptions)
   - No project manager / lead assignment
   - No project health indicator (On Track / At Risk / Delayed)
   - No progress percentage calculations

---

## 12. Task/Kanban Workflow

### Complete Task Lifecycle:

```text
[Create Task Modal]
  ├── Input: title (required), description, status dropdown, priority dropdown, assignee dropdown, due date
  └── useTasks.createTask() computes max(position) + 1 in target column and inserts into public.tasks

[Kanban Board View]
  ├── Status columns render tasks ordered by position ASC
  ├── DndContext intercepts drag start and drag end
  └── onDragEnd calculates target column & target index
        └── useTasks.reorderTask() computes updated positional indexes
              └── Batches Promise.all(supabase.from('tasks').update({ status_id, position }))

[List View]
  ├── Renders tasks in an HTML <table> with sortable column headers (Title, Status, Priority, Assignee, Due Date)
  └── Clicking a column sorts client-side in ASC/DESC order

[Task Detail Drawer]
  ├── Clicking any task opens right-side slide-in panel (TaskDetailPanel)
  ├── Fields (title, description, status, priority, assignee, due date) are editable
  └── "Save Changes" updates database; "Delete Task" prompts confirmation and removes row
```

---

## 13. Existing Business Logic

1. **Auto-Profile Generation:** PostgreSQL trigger `on_auth_user_created` guarantees profile existence.
2. **Auto-Status Provisioning:** PostgreSQL trigger `seed_default_statuses` guarantees 4 Kanban buckets per project.
3. **RLS Role Resolution Helper:** Function `get_user_workspace_role(p_workspace_id)` evaluates active role in sub-queries.
4. **Drag-and-Drop Reordering Logic (`src/hooks/useTasks.js` lines 23–66):**
   - In same-column drag: Splices item into new array position and re-indexes `0..N`.
   - In cross-column drag: Splices item out of old column (re-indexes `0..N-1`), inserts into new column at target index, and updates `status_id` and positions `0..N`.
5. **Overdue Date Calculation (`src/components/TaskCard.jsx` / `TaskRow.jsx`):**
   - Compares `task.due_date` against `new Date().setHours(0, 0, 0, 0)`.
   - Overdue tasks render in red (`var(--bad)`). Tasks due today render in gold (`var(--accent)`).
6. **Task Enrichment Join (`src/hooks/useTasks.js` lines 7–21):**
   - Joins raw tasks with `useTaskStatuses` and `useMembers` in client memory to attach `task_statuses: { name, color }` and `assignee: { full_name, avatar_url }`.

---

## 14. Current Dashboards

### Inspection Findings:
- **Does a central executive dashboard exist?** **No.**
- **Does a project summary / portfolio dashboard exist?** **No.**
- **Current Home Screen:** A workspace card selector grid (`WorkspacesPage.jsx`).
- **Cards Shown on Workspaces Page:**
  - Workspace Name
  - Member Count (calculated from `workspace_members`)
  - Project Count (calculated from `projects`)
  - Creation Date
- **Cards Shown on Projects Page:**
  - Project Name & Color Accent
  - Description
  - Task Count (calculated from `tasks`)
  - Creation Date
- **Missing Executive Dashboards:**
  - CEO / Executive Overview Dashboard
  - CTO / Engineering Velocity Dashboard
  - Departmental KPI Trackers
  - Portfolio Health & Milestone Gauges

---

## 15. Departments

### Codebase Search Results:
- Searched for: `department`, `division`, `team`, `engineering`, `operations`, `procurement`, `commercial`.
- **Finding:** There is **no database column, table, or UI control for departments**.
- **Current Workaround in Seed Data:** In the seed dataset (`seed_sns_projects_dataset.sql`), departmental operations (e.g. *Operations & Procurement*, *Mechanical Design*, *Finance Strategy*, *Manufacturing & Supply Chain*) were artificially converted into separate **Projects** under a single workspace.

---

## 16. RACI (Responsible, Accountable, Consulted, Informed)

### Inspection Results:
- **Finding:** RACI is **completely non-existent** in the current system.
- **Current Reality:** Each task has only one optional foreign key: `assignee_id` referencing `profiles(id)`.
- **Gaps for V2:**
  - No *Accountable* (Owner / Manager responsible for sign-off)
  - No *Consulted* (Subject matter experts / Reviewers)
  - No *Informed* (Stakeholders copied on status updates)

---

## 17. Approvals

### Inspection Results:
- **Finding:** There is **zero approval workflow logic** implemented.
- **Gaps for V2:**
  - No task review / stage completion requests
  - No approve / reject action buttons or history
  - No conditional transitions (e.g., preventing a task moving to "Done" without approver sign-off)

---

## 18. Dependencies

### Inspection Results:
- **Finding:** No dependency modeling exists.
- **Gaps for V2:**
  - No `blocked_by` or `depends_on` task relationships
  - No Gantt or timeline view
  - No dependency cycle validation or blocked alerts

---

## 19. Notifications & Alerts

### 1. UI Notifications (Present):
- **Toast Provider (`src/components/Toast.jsx`):**
  - In-app transient notification popups for user actions (e.g., "Workspace renamed successfully", "Task updated", "Invitation sent", error popups).
  - Auto-dismisses after 4 seconds with animated countdown progress bar.

### 2. Business & System Notifications (Completely Missing):
- No email dispatch (e.g. Resend, SendGrid, SMTP)
- No in-app notification center / bell icon
- No overdue deadline alerts
- No task assignment alerts
- No webhooks or integrations (Zoho Cliq, Slack, Teams)

---

## 20. Comments & Activity

### Inspection Results:
- **Finding:** Neither comments nor activity logs exist in the database or UI.
- **Gaps for V2:**
  - No `comments` table for task discussions
  - No `@mentions`
  - No `activity_logs` or audit trail recording who changed statuses, priorities, or due dates

---

## 21. Files & Attachments

### Inspection Results:
- **Finding:** No file attachment system exists.
- **Gaps for V2:**
  - No integration with Supabase Storage (`storage.buckets`)
  - No file upload input or attachment preview panel on tasks or projects

---

## 22. UI/UX Current State

### Design System Inspection:
- **Brand Tokens (`src/index.css`):**
  - Primary Accent: Brand Golden Yellow (`#FDE215`)
  - Background: Deep Black & Dark Ink (`#000000` / `#050505` / `#070707` with subtle gold radial gradients)
  - Panels: Layered Dark Panels (`#111111`, `#171717`, `#202020`)
  - Typography: Montserrat / Inter font family
- **Components:**
  - Sleek modern cards with micro-hover lift animations (`translateY(-2px)` and gold border glow).
  - Slide-in side drawer for task details with backdrop blur.
  - Kanban board features clean column header indicators and inline task creators.
- **UX Weaknesses Identified:**
  - Mobile view for Kanban requires horizontal scrolling which can feel cramped on narrow phones.
  - Lack of search/filtering across projects on the workspace level.
  - No bulk actions on tasks.

---

## 23. GitHub Pages Deployment

### Implementation Source: `.github/workflows/deploy-pages.yml` & `vite.config.js`

- **Build Trigger:** Push to `main` branch or manual `workflow_dispatch`.
- **Workflow Pipeline:**
  1. Checks out repository on `ubuntu-latest`.
  2. Sets up Node.js v22.
  3. Executes `npm ci` and `npm run build`.
  4. Injects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from GitHub Repository Variables.
  5. Copies `dist/index.html` to `dist/404.html` (crucial SPA routing workaround).
  6. Deploys artifact via `actions/deploy-pages@v4`.
- **Live URL Target:** `https://abzops.github.io/sns-projects/`

---

## 24. Complete Current Algorithm

```text
================================================================================
                    SNS PROJECTS CURRENT SYSTEM ALGORITHM
================================================================================

[ 1. AUTHENTICATION & BOOTSTRAP ]
  User navigates to App URL
    │
    ├─► If Session Token absent / invalid:
    │     └─► Redirect to /login
    │           ├─► User submits Email + Password
    │           ├─► supabase.auth.signInWithPassword()
    │           └─► AuthContext receives session -> Redirects to /
    │
    └─► If Session Token valid:
          ├─► AuthContext stores user & session state
          └─► ProtectedRoute allows access to AppLayout

[ 2. WORKSPACE RESOLUTION ]
  User is on Route "/"
    │
    ├─► useWorkspaces hook executes
    │     ├─► Query: SELECT * FROM workspaces WHERE member.user_id = auth.uid()
    │     ├─► Query: SELECT workspace_id FROM workspace_members (Aggregates member_count)
    │     └─► Query: SELECT workspace_id FROM projects (Aggregates project_count)
    │
    ├─► If no workspaces exist:
    │     └─► Render EmptyState -> Prompt user to "Create Workspace"
    │
    └─► User clicks a Workspace Card:
          └─► Navigate to /workspace/:workspaceId

[ 3. PROJECT RESOLUTION ]
  User is on Route "/workspace/:workspaceId"
    │
    ├─► useProjects(workspaceId) hook executes
    │     ├─► Query: SELECT * FROM projects WHERE workspace_id = :workspaceId
    │     └─► Query: SELECT project_id FROM tasks (Aggregates task_count)
    │
    ├─► User can create Project:
    │     ├─► Modal inputs: name, description, color
    │     ├─► INSERT INTO projects
    │     └─► DB Trigger: Automatically creates 4 statuses (To Do, In Progress, In Review, Done)
    │
    └─► User clicks a Project Card:
          └─► Navigate to /workspace/:workspaceId/project/:projectId

[ 4. TASK MANAGEMENT & EXECUTION ]
  User is on Route "/workspace/:workspaceId/project/:projectId"
    │
    ├─► Parallel Data Fetching:
    │     ├─► useTaskStatuses(projectId) -> SELECT * FROM task_statuses WHERE project_id = :projectId
    │     ├─► useMembers(workspaceId)     -> SELECT * FROM workspace_members WHERE workspace_id = :workspaceId
    │     └─► useTasks(projectId)         -> SELECT * FROM tasks WHERE project_id = :projectId ORDER BY position
    │
    ├─► In-Memory Data Enrichment:
    │     └─► Merge status colors/names & assignee profiles into task objects
    │
    ├─► View Mode 1: Kanban Board
    │     ├─► Distribute tasks into columns matching status_id
    │     ├─► User drags TaskCard between / within columns
    │     └─► onDragEnd: Compute updated position indexes -> Batch UPDATE tasks table
    │
    ├─► View Mode 2: List Table
    │     ├─► Display tabular rows
    │     └─► Client-side column header sorting (Title, Status, Priority, Assignee, Due Date)
    │
    └─► Task Editing:
          ├─► User clicks task -> Opens TaskDetailPanel drawer
          ├─► User edits fields / status / priority / assignee / due date
          └─► Click "Save Changes" -> UPDATE tasks table -> Refetch tasks
================================================================================
```

---

## 25. Existing Feature Matrix

| Feature Area | Exists | Partial | Missing | Technical Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Email/Password Authentication** | **Yes** | | | Managed via Supabase GoTrue Auth |
| **User Profiles** | **Yes** | | | Synced from `auth.users` via trigger |
| **Multi-Tenancy Workspaces** | **Yes** | | | Partitioned via `workspaces` & `workspace_members` |
| **Workspace Roles** | **Yes** | | | 4 roles: `owner`, `admin`, `member`, `viewer` |
| **Project Creation & Custom Color** | **Yes** | | | Supported with color swatches |
| **Kanban Board (Drag & Drop)** | **Yes** | | | Powered by `@dnd-kit/core` & `@dnd-kit/sortable` |
| **List View Table** | **Yes** | | | Tabular layout with column sorting |
| **Task Priority Levels** | **Yes** | | | 5 levels: `none`, `low`, `medium`, `high`, `urgent` |
| **Single Task Assignment** | **Yes** | | | `assignee_id` referencing single user profile |
| **Due Date Tracking** | **Yes** | | | Basic date comparison with overdue styling |
| **Departmental Hierarchy** | | | **Missing** | No department entity in DB or frontend |
| **RACI Matrix Assignment** | | | **Missing** | Only single assignee supported |
| **Executive (CEO/CTO) Dashboards** | | | **Missing** | No metrics, velocity, or high-level views |
| **Departmental Workspaces / Views**| | | **Missing** | No department filtering |
| **Task Dependencies** | | | **Missing** | No predecessor / successor links |
| **Project Milestones / Phases** | | | **Missing** | No milestone entity (embedded in descriptions) |
| **Project Stage Gates** | | | **Missing** | No stage-gate approval logic |
| **Approval Workflows** | | | **Missing** | No sign-off or approval actions |
| **Task Discussion & Comments** | | | **Missing** | No comments table or UI |
| **Activity History & Audit Log** | | | **Missing** | No change tracking in DB |
| **File Attachments (Storage)** | | | **Missing** | No Supabase storage integration |
| **Realtime Collaboration** | | | **Missing** | Relies on manual refetches; no WebSocket channels |
| **Email / Push Notifications** | | | **Missing** | Only in-memory UI toasts exist |
| **Zoho Cliq / Slack Integration** | | | **Missing** | No external webhook support |
| **Project Health & KPI Analytics** | | | **Missing** | No progress percentages or health flags |

---

## 26. Mock / Hardcoded Data

- **Supabase Integration Status:** Fully live. All hardcoded mock hooks were previously reverted. The app connects directly to Supabase Postgres.
- **Residual Static References:**
  - `src/assets/01_Logo/` contains unused raster/vector brand assets.
  - `public/icons.svg` contains unused SVG symbol definitions from previous template code.

---

## 27. Legacy / Unused Code

1. `public/icons.svg`: Legacy SVG sprite sheet not imported by any React component (Lucide icons are used exclusively).
2. `src/assets/hero.png` and `src/assets/vite.svg`: Unreferenced demo assets.
3. `supabase/setup.sql`: Redundant monolithic duplicate of `supabase/schema.sql` + `supabase/seed_sns_projects_dataset.sql`.
4. `supabase/fix_rls_and_cleanup.sql`: Scratch/patch SQL script containing hardcoded developer email queries.

---

## 28. Technical Debt

| Priority | Issue Description | Impact |
| :--- | :--- | :--- |
| **High** | **No Centralized State Store:** Each hook independently calls Supabase on mount without shared cache or SWR/React Query. | Redundant network requests when navigating between routes. |
| **High** | **Sequential DnD Updates:** `reorderTask` performs `Promise.all` mapping over individual row updates instead of a single batch RPC or SQL transaction. | Potential partial reorder failures if one request times out. |
| **Medium** | **Client-Side Aggregations:** `useWorkspaces` and `useProjects` calculate child counts in memory by querying all child rows with `.in('workspace_id', ids)`. | Will degrade in performance as projects and tasks scale into thousands. |
| **Medium** | **No Realtime Subscriptions:** If two team members work on the same board, changes made by one user do not appear for the other without page refresh. | Risk of overwriting concurrent task updates. |
| **Low** | **Pure JavaScript (No TypeScript in src):** Code lacks compile-time type validation on data payloads. | Risk of runtime type errors during complex refactors. |

---

## 29. Security Concerns

1. **Client-Side Permission Dependency in UI:**
   - In `WorkspaceSettingsPage.jsx`, role comparisons (`roleWeights`) prevent UI elements from rendering, but backend security depends entirely on RLS.
   - **Current RLS Status:** RLS policies in `supabase/schema.sql` are well-structured and enforce database-level access checks using `get_user_workspace_role()`.
2. **Missing Rate Limiting:** Invitation endpoints in frontend allow rapid invitation insertions without rate limits.
3. **Public Exposure of Project Data to All Workspace Members:** There are no private projects; every member of a workspace can read all projects within it.

---

## 30. What Should Be Preserved for V2

The following architectural foundations are solid and should be retained during the V2 upgrade:
1. **Supabase Auth & Profiles Bridge:** The `handle_new_user()` trigger and auth flow work cleanly.
2. **Design Tokens & Brand Theme:** The dark command-center aesthetic (`src/index.css`), brand golden yellow (`#FDE215`), and typography are verified brand-compliant.
3. **Core Reusable UI Components:** `Modal.jsx`, `Toast.jsx`, `Avatar.jsx`, `Spinner.jsx`, `StatusBadge.jsx`, and `PriorityIcon.jsx` are well-isolated and reusable.
4. **Drag-and-Drop Foundation:** The `@dnd-kit` implementation in `TasksPage.jsx` provides a stable base for Kanban workflows.
5. **CI/CD GitHub Actions Workflow:** `.github/workflows/deploy-pages.yml` with SPA 404 routing is clean and fully operational.

---

## 31. Missing Capabilities for V2

To evolve into the enterprise-grade **SNS Projects V2**, the following capabilities must be engineered:
1. **Departmental Multi-Structure:** Departments (Operations, Hardware/ASRS, Software Systems, Supply Chain, Commercial, Finance) with dedicated heads and budgets.
2. **Executive Command Centers:**
   - **CEO Dashboard:** Cross-department progress, strategic milestone status, blocker alerts, operational delivery health.
   - **CTO Dashboard:** Technical workstream velocity, ASRS build milestones, software integration progress, critical path bottlenecks.
3. **Formal RACI Matrix:** Each task and project phase must support distinct assignments for Responsible (R), Accountable (A), Consulted (C), and Informed (I).
4. **Approval & Stage Gate Engine:** Formal workflow gates requiring designated approver sign-off before advancing project phases or marking high-priority tasks complete.
5. **Realtime Communication & Audit Trail:**
   - In-app task comments with file attachments (Supabase Storage).
   - Detailed change log recording every field edit and status movement.
   - Live WebSocket notifications and integration with Zoho Cliq / Mail.

---

## 32. Recommended V2 Migration Considerations

1. **Database Schema Expansion:**
   - Add `departments` table linked to `workspaces`.
   - Add `project_members` table to allow granular project-level team assignment.
   - Add `task_raci_assignments` table (`task_id`, `user_id`, `raci_type`).
   - Add `task_comments` and `task_attachments` tables.
   - Add `task_dependencies` table (`task_id`, `depends_on_task_id`, `dependency_type`).
   - Add `approvals` table (`entity_type`, `entity_id`, `requested_by`, `approver_id`, `status`, `notes`).
2. **State Management & Query Optimization:**
   - Adopt `@tanstack/react-query` or centralized store for automated caching, background refetching, and optimistic updates.
3. **TypeScript Adoption:**
   - Migrate `.jsx` files to `.tsx` for strict type enforcement across RACI roles and complex workflow payloads.

---

## 33. Important Source Files Reference

| Area | Key Source Files |
| :--- | :--- |
| **App Entry & Routing** | `src/main.jsx`, `src/App.jsx`, `src/components/ProtectedRoute.jsx` |
| **Authentication** | `src/contexts/AuthContext.jsx`, `src/lib/supabase.js`, `src/pages/LoginPage.jsx`, `src/pages/SignUpPage.jsx` |
| **Database Schema & Triggers** | `supabase/schema.sql`, `scripts/apply-supabase-db.mjs` |
| **Layout & Shell** | `src/components/AppLayout.jsx`, `src/components/AppLayout.module.css` |
| **Workspace Management** | `src/hooks/useWorkspaces.js`, `src/pages/WorkspacesPage.jsx`, `src/pages/WorkspaceSettingsPage.jsx` |
| **Project Management** | `src/hooks/useProjects.js`, `src/pages/ProjectsPage.jsx` |
| **Task Management & Kanban** | `src/hooks/useTasks.js`, `src/hooks/useTaskStatuses.js`, `src/pages/TasksPage.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskDetailPanel.jsx`, `src/components/TaskRow.jsx` |
| **Design System & Global Tokens** | `src/index.css` |
| **CI/CD Deployment** | `.github/workflows/deploy-pages.yml`, `vite.config.js` |

---

## 34. Open Questions

1. **Department Scope:** Should departments sit *inside* workspaces as sub-containers, or should workspaces *represent* departments under a single overarching organization entity?
2. **RACI Sign-off Enforcement:** Should a task's movement to "Done" be strictly blocked in the database via RLS/triggers if the Accountable (A) user has not submitted an approval record?
3. **Notification Channels:** Should V2 prioritize direct Supabase Realtime in-app notifications first, or immediate webhook dispatch to Zoho Cliq / Slack?
4. **Data Migration:** When migrating existing dataset tasks to V2, should the milestone/subtask text currently embedded in `tasks.description` be parsed into structured `milestones` and `subtasks` database rows?

---
*End of Audit Report.*
