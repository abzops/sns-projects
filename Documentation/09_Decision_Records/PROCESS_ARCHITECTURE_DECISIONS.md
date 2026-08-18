# Process & Hierarchy Architecture Decisions

## Document Control
- **Domain**: Process Engine, Hierarchy & Runtime Workflows
- **Status**: `APPROVED / ACTIVE`
- **Master Register**: [DECISION_REGISTER.md](DECISION_REGISTER.md)
- **Last Verified**: 2026-08-18

---

## 1. Hierarchy & Placement Model

### Decision 1 — Standalone Process Structure
- **Status**: APPROVED
- **Rule**: A Standalone Defined Process creates one standalone parent Task representing the Process container, with Process step Tasks instantiated below it.

### Decision 2 — Placement-Level Attachment
- **Status**: APPROVED
- **Rule**: When starting a Defined Process inside a Project, it attaches exactly at the hierarchy level selected by the user: `Project`, `Phase`, `Task List`, or `Task`. The system must never fabricate artificial placeholder containers.

### Decision 3 — Process Steps as Full Tasks
- **Status**: APPROVED
- **Rule**: When attached to an existing Task, Process steps appear visually as child work beneath the named Process group but technically remain **FULL Tasks**. They preserve independent RACI assignments, approval cycles, consultation responses, evidence submissions, DAG dependencies, rework lifecycles, notifications, immutable audit logs, and expense tracking.

### Decision 4 — Milestone to Phase Full Rename
- **Status**: APPROVED / IMPLEMENTED (Phase Compatibility Layer)
- **Rule**: Milestone $\to$ Phase is a controlled, full platform rename. The long-term target includes physical schema and RPC identifier cutovers. The current `milestone_id` $\leftrightarrow$ `phase_id` dual-sync trigger layer and `public.phases` view are temporary compatibility infrastructure for the transition period.

### Decision 26 — Process Group Rendering
- **Status**: APPROVED
- **Rule**: A Process attached at the Project, Phase, or Task List level renders in the interface as one named, expandable Process Instance container enclosing its constituent step tasks.

### Decision 27 — Multi-Process Task Support
- **Status**: APPROVED
- **Rule**: A single Task may have multiple attached Defined Processes running concurrently. Each Process is rendered as its own distinct named group. Ordinary simple subtasks render under an explicit `Other` section.

### Decision 28 — Hierarchy Chevron Interaction
- **Status**: APPROVED
- **Rule**: Hierarchy expansion utilizes interactive chevron toggles. Clicking the chevron expands/collapses child work. Clicking the Task title opens the Task Detail slide-over panel.

### Decision 29 — Progressive Start Process Modal
- **Status**: APPROVED
- **Rule**: Starting a Defined Process uses a unified progressive modal:
  1. Instance Name
  2. Overall Due Date
  3. Scope (Standalone vs Inside Project)
  4. Project Selection
  5. Phase Selection (optional)
  6. Task List Selection (optional)
  7. Parent Task Selection (optional)
  8. Placement Hierarchy Visual Preview

---

## 2. Process Lifecycle & Execution Rules

### Decision 30 — Parent Task Auto-Completion Rules
- **Status**: APPROVED
- **Rule**: A parent Task automatically transitions to Completed status if and only if:
  - All attached Process Instances are completed or cancelled.
  - All constituent Process step Tasks are completed or cancelled.
  - All ordinary simple subtasks are completed or cancelled.

### Decision 31 — Equal-Weight Process Progress
- **Status**: APPROVED
- **Rule**: Defined Process progress is calculated as equal-weight step completion:
  $$\text{Progress \%} = \left( \frac{\text{Completed Steps}}{\text{Total Steps}} \right) \times 100$$

### Decision 32 — Overall Process Business Status Model — PARKED
- **Status**: **PARKED / UNRESOLVED**
- **Rule**: The overall Process business status model (*On Track*, *At Risk*, *Blocked*, *Delayed*, *Needs Attention*) remains intentionally unresolved pending business consensus.
- **Enforcement**: The database schema and runtime engine are restricted strictly to minimal technical states:
  - `running`
  - `completed`
  - `cancelled`
- No speculative business status calculations or database columns may be introduced.

### Decision 33 — Single Overall Process Due Date
- **Status**: APPROVED
- **Rule**: A Defined Process Instance has exactly one contractual Overall Due Date. Individual Process steps do not have contractual due dates, though they track execution durations.

### Decision 34 — Intra-Project Movement Only
- **Status**: APPROVED
- **Rule**: A Process Instance may be moved between placement targets only within the **same Project**. Cross-project relocation is prohibited to prevent budget and organizational corruption.

### Decision 35 — Permanent History of Cancelled Instances
- **Status**: APPROVED
- **Rule**: A cancelled Process Instance remains permanently recorded in the database for auditing and historical analysis. Restarting a process creates a **NEW** Process Instance. Completed historical step work, captured expenses, and audit logs are permanently preserved.

---

## 3. Authorization, RACI & Permissions

### Decision 36 — Process Starter Authorization
- **Status**: APPROVED
- **Rule**: Normal template RACI start permissions apply. Users with Workspace Admin, CEO, or CTO system roles may override and start any published Defined Process.

### Decision 37 — Process Cancellation Permissions
- **Status**: APPROVED
- **Rule**: Process cancellation is authorized strictly for:
  - The user who started the process (`started_by`)
  - The assigned Process Owner (`owner_id`)
  - Workspace Owner / Admin
  - CEO / CTO

### Decision 38 — Standalone Process Visibility
- **Status**: APPROVED / AMENDED BY DECISION 71
- **Rule**: Standalone Process Instances are visible strictly to:
  - Process Starter
  - Assigned Process Owner
  - RACI Participants on constituent steps
  - System Role Oversight (CEO, CTO, Project Admin, System Admin)
- Standalone processes are **NOT** visible workspace-wide.

### Decision 39 — Independent Process RACI
- **Status**: APPROVED
- **Rule**: Attached Defined Processes maintain their own step-level RACI assignments. Attaching a process to a parent task never alters or overrides the parent task's RACI matrix.

### Decision 40 — Process Step Tasks in My Work
- **Status**: APPROVED
- **Rule**: Assigned Process step Tasks appear normally within the user's `My Work` view, displaying the full parent process and project hierarchy context.

### Decision 41 — Process Movement Authority
- **Status**: APPROVED
- **Rule**: Authority to move a Process Instance resides with the nearest explicit placement owner:
  - Project Placement $\to$ Project Owner
  - Phase Placement $\to$ Phase Owner
  - Task List Placement $\to$ Task List Owner
  - Task Placement $\to$ Parent Task Owner / Responsible (R)
  - Executive Override $\to$ Workspace Owner, CEO, CTO, Admin

### Decision 42 — Reaffirmation of Single Due Date
- **Status**: APPROVED
- **Rule**: Reaffirms Decision 33: A Process Instance maintains exactly one contractual due date across its entire execution.

### Decision 43 — Process Expense Reattribution on Movement
- **Status**: APPROVED
- **Rule**: When an entire Process Instance moves within a Project, all historical and future Process expenses are financially reattributed to the new placement node. The relocation transaction is immutably recorded in the audit log.

### Decision 44 — Cancellation Step and Expense Preservation
- **Status**: APPROVED
- **Rule**: Upon Process cancellation:
  - Unfinished / waiting steps transition to `cancelled`.
  - Completed steps remain in `completed` state.
  - Incurred expenses and audit logs are permanently preserved.
  - The cancelled Process counts as closed for parent Task auto-completion evaluation.

### Decision 71 — Operational Visibility Is System-Role or Involvement Based
- **Status**: APPROVED / IMPLEMENTED
- **Rule**: Broad operational visibility is granted only by the active System Roles CEO, CTO, Project Admin, and System Admin. Workspace Owner, Admin, Member, and Viewer roles are tenancy/administration roles and do not independently expose all Projects or work.
- Users without a System Role see only direct Task participation (RACI A/R/C/I, active department-targeted RACI, or legacy direct assignee), assigned Subtasks, Process runtime participation, and the minimum parent Task, Task List, Phase, and Project ancestors required for context.
- Unrelated sibling work is not inherited through ancestor visibility. Viewer receives the same scoped SELECT model but no mutation authority. RLS is the security boundary; frontend filtering is presentation only.
