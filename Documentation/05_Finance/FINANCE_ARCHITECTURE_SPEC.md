# Finance Architecture Specification

## Document Control
- **Domain**: Financial Management, Budgets, Expenses & Rollups
- **Status**: `PLANNED / APPROVED ARCHITECTURE` (Not Implemented — Target for Packages 4–7)
- **Author**: Principal System Architect
- **Governing Decisions**: [Finance Decision Register](../09_Decision_Records/FINANCE_ARCHITECTURE_DECISIONS.md)
- **Last Verified**: 2026-08-17

---

## 1. Purpose & Core Philosophy

The SNS Projects Finance Engine provides operational cost tracking, budget governance, and financial visibility directly embedded within the task and project hierarchy.

### Core Principles
1. **Direct Operational Attachment**: Costs are captured directly at the point of work execution (leaf tasks and process steps).
2. **Zero Execution Blockers**: Budget overages and risk alerts never prevent users from completing tasks or advancing processes.
3. **No Financial Double Counting**: Parent spend totals are dynamically calculated rollups of leaf expenses, not duplicated entries.
4. **Lean Operational Scope**: Focuses strictly on project budgeting and expense tracking. ERP and accounting ledger complexities are explicitly excluded.

---

## 2. Financial Hierarchy

$$\begin{aligned}
\text{Total Company Actual Spend} &= \sum \text{Project Actuals} + \sum \text{Standalone Spend} \\
\text{Project Actual Spend} &= \sum \text{Phase Actuals} \\
\text{Phase Actual Spend} &= \sum \text{Task List Actuals} \\
\text{Task List Actual Spend} &= \sum \text{Task Actuals} \\
\text{Task Actual Spend} &= \text{Direct Task Expenses} + \sum \text{Child Process Step Expenses}
\end{aligned}$$

---

## 3. Budget-Owning Objects

Budgets exist exclusively on three structural hierarchy containers:
1. **`Project`**: Root budget container for structured initiatives.
2. **`Phase`**: High-level stage budget.
3. **`Task List`**: Functional milestone / workgroup budget.

> [!IMPORTANT]
> **Tasks DO NOT Own Budgets** (Decision 25). Tasks, Child Tasks, and Process Steps capture **Actual Spend only**.

---

## 4. Base Budget + Safety Buffer Model

Every budget-owning object supports two distinct monetary allocations:
- **`Base Budget`**: The authorized baseline funds planned for the entity.
- **`Safety Buffer`**: An optional, **fixed monetary amount** (Decision 48) that is automatically usable when Base Budget is depleted (Decision 6).

$$\text{Total Authorized Ceiling} = \text{Base Budget} + \text{Safety Buffer}$$

---

## 5. Deterministic Risk Calculations

Financial risk states evaluate continuously based on accumulated Actual Spend (Decision 7):

```mermaid
graph LR
    A[0% Spend] -->|Spend < 80% Base| Green[GREEN: Healthy]
    Green -->|80% <= Spend <= 100% Base| Yellow[YELLOW: Near Limit]
    Yellow -->|Base < Spend <= Base + Buffer| Orange[ORANGE: Buffer In Use]
    Orange -->|Spend > Base + Buffer| Red[RED: Over Budget]
```

- **`GREEN`**: $\text{Actual Spend} < 80\% \times \text{Base Budget}$
- **`YELLOW`**: $80\% \times \text{Base Budget} \le \text{Actual Spend} \le 100\% \times \text{Base Budget}$
- **`ORANGE`**: $\text{Base Budget} < \text{Actual Spend} \le (\text{Base Budget} + \text{Safety Buffer})$
- **`RED`**: $\text{Actual Spend} > (\text{Base Budget} + \text{Safety Buffer})$ *(or $> \text{Base Budget}$ if no buffer exists)*

---

## 6. Budget Allocation Model

- **Parent-to-Child Flow**: Budgets allocate top-down ($\text{Project} \to \text{Phase} \to \text{Task List}$) (Decision 11).
- **Optional Allocations**: Allocating budget to children is optional; unallocated funds remain at the parent level as contingency (Decision 11, 12).
- **Safety Buffer Non-Allocatable**: Safety Buffer cannot be passed down to child budgets; children draw allocations strictly from the parent's Base Budget (Decision 69).

---

## 7. Budget Reallocation Model

- **Sibling-Only Transactions**: Direct budget movement is permitted strictly between sibling entities sharing the same immediate parent (Decision 68).
- **Audited Transaction Record**: Every reallocation creates an immutable transaction: `From Entity`, `To Entity`, `Amount`, `Reason`, `Actor ID`, `Timestamp` (Decision 52).
- **Overspent Reallocations**: Funds may be reallocated away from overspent nodes, immediately surfacing the increased deficit (Decision 62).

---

## 8. Expense Source of Truth & Capture

- **Source of Truth**: The Expense Ledger records physical, itemized expense transactions incurred during work completion.
- **Atomic Completion Intercept**: When completing leaf work, the system intercepts with an atomic choice: *Complete without Expense* vs *Add Expense & Complete* (Decision 16).
- **Capture Flexibility**: Supports single total amounts or itemized splits without forcing vendor/invoice metadata (Decision 24).
- **Rework Accumulation**: Step rework expenses accumulate cumulatively into the task's total actual spend (Decision 61).

---

## 9. Expense Lifecycle, Corrections & Deletions

1. **Active**: Standard recorded expense.
2. **Corrected**: Effective value updated by Finance/Admin while immutably preserving previous value, actor, and reason (Decision 49).
3. **Voided**: Marked void with mandatory explanation; value zeroed in rollups (Decision 57, 67).
4. **Hard-Deleted (Admin Only)**: Removed from active ledger; leaves an immutable **Audit Tombstone** (Decision 57).

---

## 10. Standalone Spend

- Defined Processes or Tasks executed outside of a Project accumulate into **Standalone / Unallocated Spend** (Decision 23).
- Standalone spend does not consume project budgets and rolls directly into Total Company Actual Spend (Decision 50).

---

## 11. Movement & Reattribution Rules

- **Process Movement**: When a Process Instance moves within a Project, all historical and future expenses are financially reattributed to the new placement node (Decision 43).
- **Task Movement**: When an ordinary Task moves to a new Task List or Phase, all historical task expenses move financially with it (Decision 63).

---

## 12. Roles & Permissions

| Role | View Financials | Set Base / Buffer | Reallocate Budget | Correct / Void Expense | Admin Hard-Delete |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Workspace Owner / Admin** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **CEO / CTO** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Finance Department** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Project / Phase Owner** | ✅ (Scoped) | ❌ | ❌ | ❌ | ❌ |
| **General Member** | ✅ (Task view) | ❌ | ❌ | ❌ | ❌ |

---

## 13. Finance Screens & User Interface

1. **Overview Dashboard**: High-level burn rate, project financial health, and company-wide spend (Decision 46).
2. **Financial Explorer**: Multi-dimensional search with custom grouping, saved views, and export filters (Decision 53).
3. **Alert Center**: Persistent risk notifications supporting an explicit lifecycle: $\text{Open} \to \text{Acknowledged} \to \text{Resolved}$ (Decision 54, 66).
4. **Hierarchy Hover Summary**: Popover displaying `Base Budget`, `Safety Buffer`, `Actual Spend`, `Remaining Base`, `Buffer Used / Remaining`, `Utilization %`, and `Risk Status` (Decision 55).

---

## 14. Explicitly Out of Scope for V1

The following ERP and accounting capabilities are **EXPLICITLY OUT OF SCOPE** for SNS Projects V1 and must not be implemented:
- ❌ Cost Centers / Cost Allocation Codes
- ❌ General Ledger (GL) Accounts / Double-Entry Ledgers
- ❌ Purchase Orders (PO) / Requisition Approvals
- ❌ Accounts Payable (AP) / Accounts Receivable (AR)
- ❌ Vendor Management & Invoice Processing
- ❌ Payment Scheduling & Disbursement Workflows
