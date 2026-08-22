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
| **Normalizer** | `src/lib/finance.js` | Single canonical financial summary normalizer across frontend |
| **View** | `src/pages/FinanceOverviewPage.jsx` | Command-center dashboard component (consumes backend `utilization_pct`) |
| **Styles** | `src/pages/FinanceOverviewPage.module.css` | Industrial dark command-center design system styles |
| **Risk Pill** | `src/components/finance/FinanceRiskBadge.jsx` | Presentation component for canonical risk states |
| **Test Suite** | `scripts/test-p6-01-finance-overview.mjs` | Automated 34-assertion validation suite |

---

## 4. Certified Behavior & Acceptance Evidence

### 4.1 Certified Production Behavior
- **Route**: `/workspace/:workspaceId/finance` mounted under workspace context.
- **Access Guard**: Navigation and route visible only for active Workspace Owner, Workspace Admin, CEO, CTO, and `FIN` Department Operator (CEO/CTO strictly require active workspace tenancy; Project Admin alone, System Admin alone, normal Member, Viewer fail closed).
- **Backend RPC Ownership**: `public.get_workspace_financial_summary` and `public.get_project_financial_summary` own 100% of financial calculations (rollups, utilization, risk bands, buffer usage, overruns).
- **Zero Client Calculation**: Frontend does not recalculate risk bands or financial thresholds.
- **Contract Parity**: Single canonical summary normalizer in `src/lib/finance.js`; `FinanceOverviewPage.jsx` consumes backend `utilization_pct` directly.
- **Read-Only**: Zero mutation UI or DML in P6-01.
- **Cold Load & Caching**: Skeletons for cold load (no false ₹0 flash), isolated cache per `${userId}:${workspaceId}`, manual refresh without page reload.
- **Responsive**: Command-center layout verified across 1440px desktop, 1024px tablet, and 390px mobile screens.
- **Database**: Zero Supabase migrations required.

### 4.2 Automated Test Evidence
All 34 assertions in `scripts/test-p6-01-finance-overview.mjs` passed:
- **Suite 1**: Frontend Authorization & Active-Tenancy Matrix (11 assertions passed)
- **Suite 2**: Summary Normalization & Canonical Contract (4 assertions passed)
- **Suite 3**: Source Code Contracts & UI Architecture (12 assertions passed)
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

## 5. Certification Status

- **P6-01 Status**: **`VERIFIED / FROZEN`**
- **P6-01A Status**: **`VERIFIED`**
- **User Manual Production Acceptance**: **`PASSED`**
- **Frontend Baseline**: `2bf3fd19740a2a7418e50808af1f90f2b9d1d276`
- **Package 6 Status**: **`IN PROGRESS`** (P6-01 certified; Package 6 remains in progress)

