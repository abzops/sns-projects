# SNS Projects — Master Architecture Decision Register

## Overview

This register is the master index of all approved and active Architecture Decision Records (ADRs) for StacknStock Projects (SNS Projects). All platform implementations must strictly adhere to these canonical decisions.

Decisions are organized into domain-specific registers while preserving their original, authoritative SNS Projects Decision IDs.

---

## Decision Domain Indexes

1. **[Process & Hierarchy Architecture Decisions](PROCESS_ARCHITECTURE_DECISIONS.md)**
   - Covers Work Hierarchy, Phase Cutover, Standalone Processes, Process Instances, Placement Integrity, Multi-Process Tasks, Due Dates, Movement Reattribution, and Process Lifecycle.
   - Preserves **Decision 32 = PARKED** (Overall Process Business Status Model).
2. **[Finance Architecture Decisions](FINANCE_ARCHITECTURE_DECISIONS.md)**
   - Covers Budget Objects, Base Budget + Safety Buffer Model, Risk Bands, Expense Ledgers, Hierarchical Rollups, Reallocation Transactions, Financial Explorer, and Operator Roles.
   - Enforces **No Financial Double Counting** and explicitly restricts ERP/Accounting scope drift.

---

## Complete Decision Registry

| Decision ID | Domain | Title / Summary | Status | Authoritative Reference |
| :--- | :--- | :--- | :--- | :--- |
| **Decision 1** | Process | Standalone Process creates one standalone parent Task with step Tasks below | APPROVED | [PROCESS ADR-01](PROCESS_ARCHITECTURE_DECISIONS.md#decision-1--standalone-process-structure) |
| **Decision 2** | Process | Starting a Process inside Project attaches at exact level (Project/Phase/List/Task) | APPROVED | [PROCESS ADR-02](PROCESS_ARCHITECTURE_DECISIONS.md#decision-2--placement-level-attachment) |
| **Decision 3** | Process | Attached Process steps appear visually as child work but technically remain FULL Tasks | APPROVED | [PROCESS ADR-03](PROCESS_ARCHITECTURE_DECISIONS.md#decision-3--process-steps-as-full-tasks) |
| **Decision 4** | Process | Milestone $\to$ Phase is a controlled FULL rename; dual-sync compatibility is temporary | APPROVED | [PROCESS ADR-04](PROCESS_ARCHITECTURE_DECISIONS.md#decision-4--milestone-to-phase-full-rename) |
| **Decision 5** | Finance | Budget structure uses Base Budget + optional Safety Buffer | APPROVED | [FINANCE ADR-05](FINANCE_ARCHITECTURE_DECISIONS.md#decision-5--base-budget--safety-buffer) |
| **Decision 6** | Finance | Safety Buffer is an optional, fixed amount, automatically usable | APPROVED | [FINANCE ADR-06](FINANCE_ARCHITECTURE_DECISIONS.md#decision-6--safety-buffer-characteristics) |
| **Decision 7** | Finance | Financial risk bands: Green (<80%), Yellow (80-100%), Orange (>Base <=Base+Buffer), Red (>Base+Buffer) | APPROVED | [FINANCE ADR-07](FINANCE_ARCHITECTURE_DECISIONS.md#decision-7--financial-risk-bands) |
| **Decision 8** | Finance | *Superseded by Decision 24* (Single vs split amounts) | SUPERSEDED | [FINANCE ADR-08](FINANCE_ARCHITECTURE_DECISIONS.md#decision-8--superseded-by-decision-24) |
| **Decision 9** | Finance | Overspend does NOT block execution; hierarchy uses compact utilization indicator | APPROVED | [FINANCE ADR-09](FINANCE_ARCHITECTURE_DECISIONS.md#decision-9--non-blocking-execution-on-overspend) |
| **Decision 10** | Finance | Expenses may only be corrected by authorized Finance/Admin capability with immutable audit | APPROVED | [FINANCE ADR-10](FINANCE_ARCHITECTURE_DECISIONS.md#decision-10--audited-expense-corrections) |
| **Decision 11** | Finance | Budgets allocate parent $\to$ child; parent may retain unallocated Base Budget | APPROVED | [FINANCE ADR-11](FINANCE_ARCHITECTURE_DECISIONS.md#decision-11--hierarchical-budget-allocation) |
| **Decision 12** | Finance | Child budget is optional; actual spend still accumulates | APPROVED | [FINANCE ADR-12](FINANCE_ARCHITECTURE_DECISIONS.md#decision-12--optional-child-budgets) |
| **Decision 13** | Finance | All Child Task / Process expenses automatically roll into Task Actual Spend | APPROVED | [FINANCE ADR-13](FINANCE_ARCHITECTURE_DECISIONS.md#decision-13--child-expense-rollup-to-task) |
| **Decision 14** | Finance | Budget authority restricted to Admin / CEO / CTO only | APPROVED | [FINANCE ADR-14](FINANCE_ARCHITECTURE_DECISIONS.md#decision-14--budget-authority-roles) |
| **Decision 15** | Finance | Finance drill-down: Company $\to$ Project $\to$ Phase $\to$ Task List $\to$ Task $\to$ Child Process/Subtask $\to$ Expense | APPROVED | [FINANCE ADR-15](FINANCE_ARCHITECTURE_DECISIONS.md#decision-15--financial-drill-down-hierarchy) |
| **Decision 16** | Finance | Leaf-work completion uses atomic completion intercept (No Expense or Add Expense) | APPROVED | [FINANCE ADR-16](FINANCE_ARCHITECTURE_DECISIONS.md#decision-16--atomic-completion-expense-intercept) |
| **Decision 17** | Finance | Automatically completed parent Tasks do NOT prompt for expenses (derived from children) | APPROVED | [FINANCE ADR-17](FINANCE_ARCHITECTURE_DECISIONS.md#decision-17--parent-tasks-do-not-prompt-expenses) |
| **Decision 18** | Finance | *Consolidated with Decision 7* (Risk bands) | CONSOLIDATED | [FINANCE ADR-18](FINANCE_ARCHITECTURE_DECISIONS.md#decision-18--consolidated-with-decision-7) |
| **Decision 19** | Finance | CEO and CTO receive ORANGE and RED alerts; no YELLOW notifications | APPROVED | [FINANCE ADR-19](FINANCE_ARCHITECTURE_DECISIONS.md#decision-19--executive-alert-thresholds) |
| **Decision 20** | Finance | Latest budget value drives calculations; old values remain in change history | APPROVED | [FINANCE ADR-20](FINANCE_ARCHITECTURE_DECISIONS.md#decision-20--latest-budget-value-drives-calculations) |
| **Decision 21** | Finance | If child has no budget, Actual Spend rolls against nearest budget-owning ancestor | APPROVED | [FINANCE ADR-21](FINANCE_ARCHITECTURE_DECISIONS.md#decision-21--unbudgeted-child-spend-rollups) |
| **Decision 22** | Finance | Admin / CEO / CTO may change allocation to any value (including below spent); immediate recalculation | APPROVED | [FINANCE ADR-22](FINANCE_ARCHITECTURE_DECISIONS.md#decision-22--unconstrained-budget-revisions) |
| **Decision 23** | Finance | Standalone expenses are Standalone / Unallocated Spend; do NOT consume Project budgets | APPROVED | [FINANCE ADR-23](FINANCE_ARCHITECTURE_DECISIONS.md#decision-23--standalone-unallocated-spend) |
| **Decision 24** | Finance | Expense capture supports one total amount OR multiple individual amounts; no forced vendor/invoice | APPROVED | [FINANCE ADR-24](FINANCE_ARCHITECTURE_DECISIONS.md#decision-24--expense-capture-modes) |
| **Decision 25** | Finance | Tasks do NOT own budgets; Tasks and Child Tasks hold Actual Spend only | APPROVED | [FINANCE ADR-25](FINANCE_ARCHITECTURE_DECISIONS.md#decision-25--tasks-do-not-own-budgets) |
| **Decision 26** | Process | Process attached at Project/Phase/List level appears as one named, expandable group containing steps | APPROVED | [PROCESS ADR-26](PROCESS_ARCHITECTURE_DECISIONS.md#decision-26--process-group-rendering) |
| **Decision 27** | Process | A Task may have multiple attached Defined Processes; ordinary subtasks appear under "Other" | APPROVED | [PROCESS ADR-27](PROCESS_ARCHITECTURE_DECISIONS.md#decision-27--multi-process-task-support) |
| **Decision 28** | Process | Hierarchy uses expandable chevrons for expansion; Task name opens Task Detail | APPROVED | [PROCESS ADR-28](PROCESS_ARCHITECTURE_DECISIONS.md#decision-28--hierarchy-chevron-interaction) |
| **Decision 29** | Process | Start Process UI is one progressive modal with placement preview | APPROVED | [PROCESS ADR-29](PROCESS_ARCHITECTURE_DECISIONS.md#decision-29--progressive-start-process-modal) |
| **Decision 30** | Process | Parent Task auto-completes only when all attached Processes, step Tasks, and subtasks complete | APPROVED | [PROCESS ADR-30](PROCESS_ARCHITECTURE_DECISIONS.md#decision-30--parent-task-auto-completion-rules) |
| **Decision 31** | Process | Process progress is equal-weight step-count: $(\text{completed steps} / \text{total steps}) \times 100$ | APPROVED | [PROCESS ADR-31](PROCESS_ARCHITECTURE_DECISIONS.md#decision-31--equal-weight-process-progress) |
| **Decision 32** | Process | Overall Process BUSINESS status model is **PARKED** (Technical states `running`, `completed`, `cancelled` only) | **PARKED** | [PROCESS ADR-32](PROCESS_ARCHITECTURE_DECISIONS.md#decision-32--overall-process-business-status-model--parked) |
| **Decision 33** | Process | One overall Process due date; no individual contractual due dates on Process steps | APPROVED | [PROCESS ADR-33](PROCESS_ARCHITECTURE_DECISIONS.md#decision-33--single-overall-process-due-date) |
| **Decision 34** | Process | A Process may move only inside the same Project; no cross-Project movement | APPROVED | [PROCESS ADR-34](PROCESS_ARCHITECTURE_DECISIONS.md#decision-34--intra-project-movement-only) |
| **Decision 35** | Process | Cancelled Process Instance remains permanently historical; restart creates a NEW Instance | APPROVED | [PROCESS ADR-35](PROCESS_ARCHITECTURE_DECISIONS.md#decision-35--permanent-history-of-cancelled-instances) |
| **Decision 36** | Process | Normal RACI start permissions apply; Admin / CEO / CTO may override and start any published Process | APPROVED | [PROCESS ADR-36](PROCESS_ARCHITECTURE_DECISIONS.md#decision-36--process-starter-authorization) |
| **Decision 37** | Process | Process cancellation permitted to: starter, Process Owner, Admin, CEO, CTO | APPROVED | [PROCESS ADR-37](PROCESS_ARCHITECTURE_DECISIONS.md#decision-37--process-cancellation-permissions) |
| **Decision 38** | Process | Standalone Process visibility: starter, Process Owner, RACI participants, plus Admin/CEO/CTO | APPROVED | [PROCESS ADR-38](PROCESS_ARCHITECTURE_DECISIONS.md#decision-38--standalone-process-visibility) |
| **Decision 39** | Process | Attached Process has independent RACI; attaching a Process never mutates parent Task RACI | APPROVED | [PROCESS ADR-39](PROCESS_ARCHITECTURE_DECISIONS.md#decision-39--independent-process-raci) |
| **Decision 40** | Process | Assigned Process step Tasks appear normally in My Work with Process + hierarchy context | APPROVED | [PROCESS ADR-40](PROCESS_ARCHITECTURE_DECISIONS.md#decision-40--process-step-tasks-in-my-work) |
| **Decision 41** | Process | Process movement authority is nearest explicit placement owner; Admin/CEO/CTO override | APPROVED | [PROCESS ADR-41](PROCESS_ARCHITECTURE_DECISIONS.md#decision-41--process-movement-authority) |
| **Decision 42** | Process | Reaffirms Decision 33: one overall Process due date only | APPROVED | [PROCESS ADR-42](PROCESS_ARCHITECTURE_DECISIONS.md#decision-42--reaffirmation-of-single-due-date) |
| **Decision 43** | Process | Process movement reattributes historical AND future Process expenses to new placement | APPROVED | [PROCESS ADR-43](PROCESS_ARCHITECTURE_DECISIONS.md#decision-43--process-expense-reattribution-on-movement) |
| **Decision 44** | Process | On cancellation: unfinished steps $\to$ Cancelled; completed steps, expenses, and audit preserved | APPROVED | [PROCESS ADR-44](PROCESS_ARCHITECTURE_DECISIONS.md#decision-44--cancellation-step-and-expense-preservation) |
| **Decision 45** | Finance | Finance access: CEO, CTO, Admin (full + budget authority); Finance Dept (operator, no budget authority) | APPROVED | [FINANCE ADR-45](FINANCE_ARCHITECTURE_DECISIONS.md#decision-45--finance-access-and-operator-separation) |
| **Decision 46** | Finance | Finance primary screens: Overview, Financial Explorer, persistent Alerts | APPROVED | [FINANCE ADR-46](FINANCE_ARCHITECTURE_DECISIONS.md#decision-46--finance-primary-screens) |
| **Decision 47** | Finance | Budget configuration surfaced in hierarchy modals and Finance views; authorized roles only | APPROVED | [FINANCE ADR-47](FINANCE_ARCHITECTURE_DECISIONS.md#decision-47--budget-configuration-surfaces) |
| **Decision 48** | Finance | Safety Buffer is a FIXED amount only | APPROVED | [FINANCE ADR-48](FINANCE_ARCHITECTURE_DECISIONS.md#decision-48--safety-buffer-fixed-amount-only) |
| **Decision 49** | Finance | Expense correction edits effective value while preserving immutable historical audit | APPROVED | [FINANCE ADR-49](FINANCE_ARCHITECTURE_DECISIONS.md#decision-49--audited-effective-expense-correction) |
| **Decision 50** | Finance | $\text{Total Company Actual Spend} = \text{Total Project Spend} + \text{Standalone Spend}$ | APPROVED | [FINANCE ADR-50](FINANCE_ARCHITECTURE_DECISIONS.md#decision-50--total-company-spend-formula) |
| **Decision 51** | Finance | Child budget allocation UI uses child-by-child editing (no mandatory central bulk table) | APPROVED | [FINANCE ADR-51](FINANCE_ARCHITECTURE_DECISIONS.md#decision-51--child-by-child-allocation-ui) |
| **Decision 52** | Finance | Budget movement uses explicit Budget Reallocation transaction (From, To, Amount, Reason, Actor, Time) | APPROVED | [FINANCE ADR-52](FINANCE_ARCHITECTURE_DECISIONS.md#decision-52--explicit-budget-reallocation-transactions) |
| **Decision 53** | Finance | Financial Explorer provides advanced V1 operational filtering, custom grouping, and saved views | APPROVED | [FINANCE ADR-53](FINANCE_ARCHITECTURE_DECISIONS.md#decision-53--financial-explorer-advanced-filtering) |
| **Decision 54** | Finance | Orange/Red produces normal notification plus persistent Finance Alert Center entry | APPROVED | [FINANCE ADR-54](FINANCE_ARCHITECTURE_DECISIONS.md#decision-54--persistent-finance-alert-center) |
| **Decision 55** | Finance | Hierarchy financial hover displays Base, Buffer, Actual, Remaining, Buffer Used, Utilization %, Risk | APPROVED | [FINANCE ADR-55](FINANCE_ARCHITECTURE_DECISIONS.md#decision-55--hierarchy-financial-hover-summary) |
| **Decision 56** | Finance | Finance Department is a financial OPERATOR (view, inspect, correct, void, export, acknowledge alerts) | APPROVED | [FINANCE ADR-56](FINANCE_ARCHITECTURE_DECISIONS.md#decision-56--finance-department-operator-boundaries) |
| **Decision 57** | Finance | Finance may correct/void; Admin additionally may hard-delete (leaves immutable audit tombstone) | APPROVED | [FINANCE ADR-57](FINANCE_ARCHITECTURE_DECISIONS.md#decision-57--expense-correction-void-and-tombstone) |
| **Decision 58** | Finance | Anyone who can view a Task may see its exact expense values | APPROVED | [FINANCE ADR-58](FINANCE_ARCHITECTURE_DECISIONS.md#decision-58--task-expense-visibility) |
| **Decision 59** | Finance | Process expense attribution follows Process placement and rolls through the exact hierarchy | APPROVED | [FINANCE ADR-59](FINANCE_ARCHITECTURE_DECISIONS.md#decision-59--process-expense-attribution-hierarchy) |
| **Decision 60** | Finance | Standalone Process parent Task has no direct expense entry; Actual Spend = sum of child Tasks | APPROVED | [FINANCE ADR-60](FINANCE_ARCHITECTURE_DECISIONS.md#decision-60--standalone-process-actual-spend-rollup) |
| **Decision 61** | Finance | Rework expense is cumulative (Initial execution + all rework cycles = Task Actual Spend) | APPROVED | [FINANCE ADR-61](FINANCE_ARCHITECTURE_DECISIONS.md#decision-61--cumulative-rework-expenses) |
| **Decision 62** | Finance | Budget may be reallocated away from an overspent child; increased overrun displays immediately | APPROVED | [FINANCE ADR-62](FINANCE_ARCHITECTURE_DECISIONS.md#decision-62--reallocation-from-overspent-nodes) |
| **Decision 63** | Finance | If an ordinary Task moves hierarchy, ALL historical expenses move financially with it | APPROVED | [FINANCE ADR-63](FINANCE_ARCHITECTURE_DECISIONS.md#decision-63--task-expense-reattribution-on-movement) |
| **Decision 64** | Finance | Financial overrun never blocks Project completion | APPROVED | [FINANCE ADR-64](FINANCE_ARCHITECTURE_DECISIONS.md#decision-64--overrun-never-blocks-project-completion) |
| **Decision 65** | Finance | Expense Date defaults to completion date, but user may change to actual cost-incurrence date | APPROVED | [FINANCE ADR-65](FINANCE_ARCHITECTURE_DECISIONS.md#decision-65--editable-expense-incurrence-date) |
| **Decision 66** | Finance | Finance Alert lifecycle: Open $\to$ Acknowledged $\to$ Resolved | APPROVED | [FINANCE ADR-66](FINANCE_ARCHITECTURE_DECISIONS.md#decision-66--finance-alert-lifecycle) |
| **Decision 67** | Finance | Correction, Void, and Admin Delete require mandatory reason and immutable audit record | APPROVED | [FINANCE ADR-67](FINANCE_ARCHITECTURE_DECISIONS.md#decision-67--mandatory-reason-for-financial-edits) |
| **Decision 68** | Finance | Direct Budget Reallocation is strictly between siblings sharing the same budget parent | APPROVED | [FINANCE ADR-68](FINANCE_ARCHITECTURE_DECISIONS.md#decision-68--sibling-only-budget-reallocation) |
| **Decision 69** | Finance | Safety Buffer is NOT allocatable to child budgets (consumed from Base Budget only) | APPROVED | [FINANCE ADR-69](FINANCE_ARCHITECTURE_DECISIONS.md#decision-69--safety-buffer-not-allocatable) |
| **Decision 70** | Finance | NO FINANCIAL DOUBLE COUNTING: Parent Actual Spend values are calculated rollups | APPROVED | [FINANCE ADR-70](FINANCE_ARCHITECTURE_DECISIONS.md#decision-70--no-financial-double-counting) |
| **Decision 71** | Process | Broad operational visibility is System-Role based; other users see involved work plus minimum ancestors only | APPROVED / IMPLEMENTED | [PROCESS ADR-71](PROCESS_ARCHITECTURE_DECISIONS.md#decision-71--operational-visibility-is-system-role-or-involvement-based) |
| **Decision 72** | Finance | Subtasks are optional expense capture sources recording `task_id = parent.id` and `subtask_id = subtask.id`; rollups naturally sum into parent Task with zero double counting | APPROVED / IMPLEMENTED | [FINANCE ADR-72](FINANCE_ARCHITECTURE_DECISIONS.md#decision-72--subtask-expense-capture--traceability) |

