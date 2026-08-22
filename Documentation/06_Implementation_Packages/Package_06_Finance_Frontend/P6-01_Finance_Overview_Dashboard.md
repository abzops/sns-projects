# Package 6 — P6-01: Finance Overview / Dashboard Specification & Verification

## 1. Executive Summary

**P6-01** delivers the first full Finance management view in SNS Projects: the **Workspace Finance Overview / Dashboard**. This is a **read-only command-center view** designed for authorized workspace-level leadership and finance operators.

It provides real-time, tamper-proof financial visibility without client-side calculation risks, false-green loading flashes, or unauthorized metadata leakage.

---

## 2. Core Capabilities & Architectural Invariants

### 2.1 Authorized Access Matrix (Fail-Closed)
Broad workspace-level Finance Overview access is granted strictly to:
- **Active Workspace Owner**
- **Active Workspace Admin**
- **Active CEO** (with active workspace tenancy)
- **Active CTO** (with active workspace tenancy)
- **Active Finance Operator** (`FIN` department membership + active workspace tenancy)

Unapproved roles (Project Admin only, System Admin only, normal Member, Viewer, or CEO/CTO without active workspace tenancy):
1. **Sidebar Navigation**: Finance link is completely hidden from the workspace sidebar.
2. **Direct URL Route** (`/workspace/:workspaceId/finance`): Fails closed to a secure "Finance Overview Unavailable" state.
3. **Backend RPC**: `public.get_workspace_financial_summary` returns `NULL`, which is handled safely without converting to ₹0 or fake green metrics.

### 2.2 Canonical Backend Financial Contract (Zero Client Calculation)
All financial figures, rollups, risk assessments, utilization percentages, and spend compositions are computed exclusively by PostgreSQL engine functions (`public.get_workspace_financial_summary` and `public.get_project_financial_summary`).

The React frontend does **not** duplicate business calculations or threshold evaluations:
- `base_budget`: Approved primary ceiling
- `safety_buffer`: Contingency allocation
- `total_ceiling`: Base + Safety Buffer
- `actual_spend`: Net sum of approved active expense transactions
- `remaining_base`: Base budget minus actual spend (clamped to 0)
- `buffer_used`: Portion of safety buffer consumed
- `buffer_remaining`: Remaining safety buffer
- `overrun`: Amount by which spend exceeds Base + Buffer
- `utilization_pct`: Exact backend percentage of Base Budget used
- `risk_band`: Backend enum (`GREEN`, `YELLOW`, `ORANGE`, `RED`)
- `project_spend`: Actual spend linked to Project tasks
- `standalone_spend`: Actual spend linked to Standalone Process tasks

### 2.3 Command-Center UI Architecture
1. **Primary KPI Grid**:
   - Base Budget (Ceiling context or neutral "No Budget Configured" pill)
   - Actual Spend (% of Base or unbudgeted context)
   - Remaining Base (Buffer consumption or overrun warning)
   - Safety Buffer (Used vs. Remaining breakdown)
   - Portfolio Risk (Accessible risk pill with backend-derived band and text)
2. **Overrun Warning Callout**:
   - Informational banner displayed only when `summary.overrun > 0`. Highlights that operational work continues without disruption.
3. **Analytics & Composition Grid**:
   - **Budget Utilization Panel**: Progress bar with visual clamping, exact percentage display, and full ceiling breakdown.
   - **Spend Composition Panel**: Proportional visual split between Project Work and Standalone Processes.
   - **Portfolio Health Distribution**: Portfolio-wide count of projects across each risk band.
4. **Project Financial Portfolio**:
   - Responsive table on desktop / stacked cards on mobile.
   - Project name with color dot, link to project workspace, Base Budget, Safety Buffer, Actual Spend, Utilization %, Remaining Base, and Risk Band.
   - Graceful handling of unbudgeted projects and isolated project summary failures.

---

## 3. Implementation Details

| Layer | File / Symbol | Role |
| :--- | :--- | :--- |
| **Route** | `src/App.jsx` | Mounts `/workspace/:workspaceId/finance` with `FinanceOverviewPage` |
| **Navigation** | `src/components/AppLayout.jsx` | Adds Finance link under `OPERATIONS` with `WalletCards` icon |
| **Access Hook** | `src/hooks/useFinanceAccess.js` | Derives workspace Finance permissions based on active tenancy and role matrix |
| **Data Hook** | `src/hooks/useFinanceOverview.js` | Fetches workspace & project summaries via canonical RPCs with cache isolation |
| **View** | `src/pages/FinanceOverviewPage.jsx` | Command-center dashboard component |
| **Styles** | `src/pages/FinanceOverviewPage.module.css` | Industrial dark command-center design system styles |
| **Risk Pill** | `src/components/finance/FinanceRiskBadge.jsx` | Presentation component for canonical risk states |
| **Test Suite** | `scripts/test-p6-01-finance-overview.mjs` | Automated 30-assertion validation suite |

---

## 4. Verification Evidence

All 30 assertions in `scripts/test-p6-01-finance-overview.mjs` passed:
- **Suite 1**: Frontend Authorization & Active-Tenancy Matrix (11 assertions passed)
- **Suite 2**: Summary Normalization & Canonical Contract (4 assertions passed)
- **Suite 3**: Source Code Contracts & UI Architecture (8 assertions passed)
- **Suite 4**: PostgreSQL Live RPC Integration (7 assertions passed)

Full platform regression suite results:
- `test-p4-01-finance-foundation.mjs`: 74/74 assertions passed
- `test-p5-01-expense-execution.mjs`: 39/39 assertions passed
- `test-p5-02-expense-frontend.mjs`: 77/77 assertions passed
- `test-p5-03-subtask-completion.mjs`: 37/37 assertions passed
- `security-advisor.mjs`: Baseline 6 accepted warnings maintained (0 new warnings)
- `verify-doc-links.mjs`: 100% link integrity verified
- `npm run build`: Production client build succeeded with 0 errors

---

## 5. Status & Next Steps

- **P6-01 Status**: **`IMPLEMENTED / MANUAL ACCEPTANCE PENDING`**
- **Do NOT start P6-02** until manual production acceptance of P6-01 is certified.
