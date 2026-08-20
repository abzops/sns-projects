# Finance Architecture Decisions

## Document Control
- **Domain**: Financial Hierarchy, Budgets, Expense Ledgers & Rollups
- **Status**: `APPROVED / PLANNED` (Upcoming Packages 4–7)
- **Master Register**: [DECISION_REGISTER.md](DECISION_REGISTER.md)
- **Last Verified**: 2026-08-17

---

## 1. Budget Model & Safety Buffer

### Decision 5 — Base Budget & Safety Buffer
- **Status**: APPROVED
- **Rule**: Every budget-owning entity (`Project`, `Phase`, `Task List`) supports a **Base Budget** and an optional **Safety Buffer**.

### Decision 6 — Safety Buffer Characteristics
- **Status**: APPROVED
- **Rule**: The Safety Buffer is an optional, fixed monetary amount that is automatically usable when Base Budget is exhausted. It does not require manual unlock steps.

### Decision 48 — Safety Buffer Fixed Amount Only
- **Status**: APPROVED
- **Rule**: The Safety Buffer must always be specified as a fixed nominal amount (e.g. `$5,000`), never as a floating percentage.

### Decision 69 — Safety Buffer Not Allocatable
- **Status**: APPROVED
- **Rule**: A parent entity's Safety Buffer is **NOT** allocatable to child budgets. Child entity budgets consume allocation strictly from the parent's Base Budget.

---

## 2. Risk Bands, Utilization & Alerts

### Decision 7 — Financial Risk Bands
- **Status**: APPROVED
- **Rule**: Financial risk states are determined deterministically by Actual Spend relative to Base Budget and Safety Buffer:
  - **`GREEN`**: $\text{Actual Spend} < 80\% \times \text{Base Budget}$
  - **`YELLOW`**: $\text{Actual Spend} \ge 80\% \text{ and } \le 100\% \times \text{Base Budget}$
  - **`ORANGE`**: $\text{Actual Spend} > \text{Base Budget} \text{ and } \le (\text{Base Budget} + \text{Safety Buffer})$
  - **`RED`**: $\text{Actual Spend} > (\text{Base Budget} + \text{Safety Buffer})$ *(or $> \text{Base Budget}$ if no buffer exists)*

### Decision 18 — Consolidated with Decision 7
- **Status**: CONSOLIDATED into Decision 7.

### Decision 19 — Executive Alert Thresholds
- **Status**: APPROVED
- **Rule**: Executive roles (CEO, CTO) receive automated high-priority notifications only when a budget crosses into **ORANGE** or **RED** risk bands. Yellow threshold transitions do not generate notifications.

### Decision 54 — Persistent Finance Alert Center
- **Status**: APPROVED
- **Rule**: Orange and Red threshold breaches trigger real-time user notifications and create persistent entries in the dedicated **Finance Alert Center**.

### Decision 66 — Finance Alert Lifecycle
- **Status**: APPROVED
- **Rule**: Alerts transition through an explicit operational lifecycle:
  $$\text{Open} \longrightarrow \text{Acknowledged} \longrightarrow \text{Resolved}$$

---

## 3. Budget Ownership & Hierarchical Allocation

### Decision 11 — Hierarchical Budget Allocation
- **Status**: APPROVED
- **Rule**: Budgets allocate strictly from parent to child ($\text{Project} \to \text{Phase} \to \text{Task List}$). A parent entity may retain unallocated Base Budget for contingency.

### Decision 12 — Optional Child Budgets
- **Status**: APPROVED
- **Rule**: Allocating a budget to child entities (Phases, Task Lists) is optional. If unbudgeted, actual spend still accumulates and rolls up.

### Decision 14 — Budget Authority Roles
- **Status**: APPROVED
- **Rule**: Authority to set Base Budgets, modify Safety Buffers, and execute Budget Reallocations is restricted strictly to **Workspace Owner**, **Admin**, **CEO**, and **CTO**.

### Decision 20 — Latest Budget Value Drives Calculations
- **Status**: APPROVED
- **Rule**: Calculations and risk metrics always evaluate against the current active budget configuration. Historical revisions are preserved in immutable audit logs.

### Decision 21 — Unbudgeted Child Spend Rollups
- **Status**: APPROVED
- **Rule**: If a child entity has no budget of its own, its Actual Spend rolls up and evaluates against the nearest budget-owning ancestor.

### Decision 22 — Unconstrained Budget Revisions
- **Status**: APPROVED
- **Rule**: Authorized budget managers may adjust allocations to any value, including below the currently spent amount. The financial risk band recalculates immediately and the change is audited.

### Decision 25 — Tasks Do Not Own Budgets
- **Status**: APPROVED
- **Rule**: Tasks and Child Tasks **DO NOT** own budgets. Tasks are pure work execution entities that capture Actual Spend only.

### Decision 47 — Budget Configuration Surfaces
- **Status**: APPROVED
- **Rule**: Budget configuration is accessible in Project, Phase, and Task List creation/edit dialogs as well as centralized Finance management views. Editing is restricted by role.

### Decision 51 — Child-by-Child Allocation UI
- **Status**: APPROVED
- **Rule**: Child budget allocation is performed child-by-child within hierarchy management views. A mandatory central bulk allocation spreadsheet is not required.

### Decision 52 — Explicit Budget Reallocation Transactions
- **Status**: APPROVED
- **Rule**: Moving budget funds between entities requires an explicit Reallocation Transaction recording: `From Entity`, `To Entity`, `Amount`, `Reason`, `Actor ID`, and `Timestamp`.

### Decision 62 — Reallocation from Overspent Nodes
- **Status**: APPROVED
- **Rule**: Budget may be reallocated away from an entity even if it is already overspent. The resulting increased overrun is surfaced immediately.

### Decision 68 — Sibling-Only Budget Reallocation
- **Status**: APPROVED
- **Rule**: Direct horizontal Budget Reallocation is permitted strictly between sibling entities sharing the same immediate budget parent.

---

## 4. Expense Capture, Ledger & Atomic Intercepts

### Decision 8 — Superseded by Decision 24
- **Status**: SUPERSEDED by Decision 24.

### Decision 16 — Atomic Completion Expense Intercept
- **Status**: APPROVED
- **Rule**: When completing a leaf task or process step, the UI presents an atomic completion dialog:
  - `Complete without Expense`
  - `Add Expense & Complete`
  Task completion and expense persistence execute within a single atomic database transaction.

### Decision 17 — Parent Tasks Do Not Prompt Expenses
- **Status**: APPROVED
- **Rule**: Parent tasks that complete automatically (via child completion) do not prompt for expense capture; their Actual Spend is derived entirely from children.

### Decision 24 — Expense Capture Modes
- **Status**: APPROVED
- **Rule**: Expense entry supports:
  1. A single total monetary amount, OR
  2. Multiple itemized line items.
  Splits are optional. The platform does not force vendor, invoice number, or accounting category inputs in V1.

### Decision 61 — Cumulative Rework Expenses
- **Status**: APPROVED
- **Rule**: When a Defined Process step undergoes rework, expenses incurred across initial execution and all subsequent rework cycles accumulate cumulatively into the Task's Actual Spend.

### Decision 65 — Editable Expense Incurrence Date
- **Status**: APPROVED
- **Rule**: The Expense Date defaults to the current completion timestamp, but users may manually edit it to reflect the actual historical date of cost incurrence.

---

## 5. Expense Auditing, Corrections, Voids & Tombstones

### Decision 10 — Audited Expense Corrections
- **Status**: APPROVED
- **Rule**: Expenses may only be modified by authorized Finance operators or Administrators with mandatory audit logging.

### Decision 49 — Audited Effective Expense Correction
- **Status**: APPROVED
- **Rule**: Correcting an expense modifies its effective value while preserving an immutable history of: `Previous Value`, `New Value`, `Actor ID`, `Timestamp`, and `Reason`. Rollups immediately reflect the corrected value.

### Decision 56 — Finance Department Operator Boundaries
- **Status**: APPROVED
- **Rule**: The Finance Department acts as a **Financial Operator**:
  - **Permitted**: View all financials, inspect expense details, correct expenses, void expenses, acknowledge alerts, use Financial Explorer, export reports.
  - **Prohibited**: Set Base Budgets, modify Safety Buffers, reallocate budgets (reserved for Admin/CEO/CTO).

### Decision 57 — Expense Correction, Void, and Tombstone
- **Status**: APPROVED
- **Rule**:
  - **Finance Operators** may `Correct` or `Void` expenses.
  - **Administrators** additionally possess `Hard-Delete` authority.
  - Hard deletion must leave an immutable **Audit Tombstone** in the financial audit log.

### Decision 67 — Mandatory Reason for Financial Edits
- **Status**: APPROVED
- **Rule**: Every expense Correction, Void, or Hard-Delete requires a non-empty, mandatory explanation recorded immutably in the audit ledger.

---

## 6. Financial Rollups & Hierarchy Reattribution

### Decision 13 — Child Expense Rollup to Task
- **Status**: APPROVED
- **Rule**: All expenses incurred by Child Tasks and Process steps automatically roll into the parent Task's Actual Spend.

### Decision 15 — Financial Drill-Down Hierarchy
- **Status**: APPROVED
- **Rule**: Full financial drill-down is supported across all 6 levels:
  $$\text{Company} \longrightarrow \text{Project} \longrightarrow \text{Phase} \longrightarrow \text{Task List} \longrightarrow \text{Task} \longrightarrow \text{Child Process/Task} \longrightarrow \text{Expense Entry}$$

### Decision 23 — Standalone Unallocated Spend
- **Status**: APPROVED
- **Rule**: Expenses attached to Standalone Tasks or Standalone Processes accumulate into **Standalone / Unallocated Spend** and do not consume Project budgets.

### Decision 50 — Total Company Spend Formula
- **Status**: APPROVED
- **Rule**: Total organizational actual expenditure is calculated as:
  $$\text{Total Company Actual Spend} = \text{Total Project Spend} + \text{Standalone Spend}$$

### Decision 58 — Task Expense Visibility
- **Status**: APPROVED
- **Rule**: Any authenticated user authorized to view a Task is permitted to view its exact associated expense values.

### Decision 59 — Process Expense Attribution Hierarchy
- **Status**: APPROVED
- **Rule**: Defined Process expenses attribute directly to the Process placement node and roll cleanly up through the enclosing Project hierarchy.

### Decision 60 — Standalone Process Actual Spend Rollup
- **Status**: APPROVED
- **Rule**: A Standalone Process parent Task has no direct expense entry. Its Actual Spend is the exact rollup of its constituent Process step Tasks.

### Decision 63 — Task Expense Reattribution on Movement
- **Status**: APPROVED
- **Rule**: If an ordinary Task is moved to a different Task List or Phase within the Project, all historical expenses move financially with it. The relocation is recorded in audit logs.

### Decision 70 — No Financial Double Counting
- **Status**: APPROVED
- **Rule**: **ZERO DOUBLE COUNTING**. Only physical leaf expense entries exist in the expense ledger. All parent spend figures (Task, Task List, Phase, Project, Company) are computed rollups.

---

## 7. User Experience & Non-Blocking Execution

### Decision 9 — Non-Blocking Execution on Overspend
- **Status**: APPROVED
- **Rule**: Exceeding a Base Budget or Safety Buffer **never** blocks task completion, step advancement, or project progress. Overspends are flagged visually through indicators and alerts.

### Decision 46 — Finance Primary Screens
- **Status**: APPROVED
- **Rule**: The Finance module provides:
  1. **Overview Dashboard**: High-level company spend, project budgets, risk summary.
  2. **Financial Explorer**: Deep operational search and grouped hierarchy views.
  3. **Alert Center**: Persistent risk notifications and resolution workflows.

### Decision 53 — Financial Explorer Advanced Filtering
- **Status**: APPROVED
- **Rule**: Financial Explorer supports multi-dimensional filtering across: Project, Phase, Task List, Task, Standalone, Owner, Department, Date Range, Active/Completed, Risk Band, Over-Budget Only, Creator, Amount Range, Text Search, Custom Grouping, and Saved Views.

### Decision 55 — Hierarchy Financial Hover Summary
- **Status**: APPROVED
- **Rule**: Hovering over financial indicators in the project hierarchy displays a rich popover: `Base Budget`, `Safety Buffer`, `Actual Spend`, `Remaining Base`, `Buffer Used / Remaining`, `Overrun Amount`, `Utilization %`, and `Risk Status`.

### Decision 62 — Subtask Expense Capture & Traceability
- **Status**: APPROVED (P5-03)
- **Rule**: `public.subtasks` are optional expense capture sources during subtask completion. Subtask expenses record `task_id = parent Task ID` and `subtask_id = Subtask ID` with `cycle_number = NULL`. Finance actual spend queries naturally aggregate subtask expenses under the parent Task without query modifications or double counting. Subtasks with expenses cannot be hard-deleted (`ON DELETE RESTRICT`).

### Decision 64 — Overrun Never Blocks Project Completion
- **Status**: APPROVED
- **Rule**: Financial overruns never prevent closing tasks or completing projects.

