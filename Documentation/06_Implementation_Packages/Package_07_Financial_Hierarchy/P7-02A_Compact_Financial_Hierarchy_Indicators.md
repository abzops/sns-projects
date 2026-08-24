# P7-02A: Compact Financial Hierarchy Indicators

**Package**: Package 7 — Financial Hierarchy UX  
**Slice**: P7-02A (Compact Hierarchy Indicators Presentation)  
**Status**: `VERIFIED / FROZEN`  
**Automated Verification**: `scripts/test-p7-02a-financial-hierarchy-indicators.mjs` (52/52 assertions passed)  
**NPM Script**: `npm run test:p7-02a`

---

## 1. Overview & Scope Boundaries

P7-02A implements compact, readable, non-blocking financial indicators inside the existing Project operational hierarchy UI (`src/pages/TasksPage.jsx` and `src/components/HierarchyTaskTree.jsx`), consuming the verified and frozen P7-01 project read model.

### Key Architectural Invariants
1. **Presentation-Only Mandate**: P7-02A is strictly presentational. Zero database migrations, zero changes to P7-01 read model functions, and zero client-side financial/risk calculations.
2. **Single Project Read Model**: Exactly one hook instance (`useProjectFinancialHierarchy`) invoked at the `TasksPage` level for the visible project.
3. **Strict Hook Enabled Gate**: Enabled only when `!userContextLoading && Boolean(visibleProjectId) && view === 'hierarchy'`. Kanban and List views remain 100% untouched by financial indicators.
4. **Task Financial Immutability & Model Separation**: Tasks **never** own budgets. Tasks display only direct spend (and ancestor budget provenance tag). Tasks never show budget progress bars, utilization %, remaining budget, or risk badges. Operational task objects are never mutated.
5. **Own vs. Inherited Budget Semantics**:
   - **Own Budget**: Container owns its budget (`is_budgeted === true`). Renders `FINANCE`, `₹Actual / ₹Base`, `utilization_pct%`, risk badge, and clamped progress bar.
   - **Inherited Budget**: Container inherits budget context (`is_budgeted === false`, `budget_source_type !== null`). Renders `₹Actual spent ↑ Phase/Project budget` without a misleading base denominator or fake progress bar.
   - **Unbudgeted**: Truly unbudgeted container renders `₹Actual spent` with an `UNBUDGETED` badge.
6. **Non-Blocking Resilience**: Financial RPC loading or failure never blocks operational hierarchy loading, task navigation, drag-and-drop, or subtask expansion.
7. **Accessibility & Design Token Parity**: Accessible progress bars (`role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`), colorblind-safe text risk labels (`GREEN`, `YELLOW`, `ORANGE`, `RED`), and 100% adherence to Stack n Stock design tokens.

---

## 2. Component Architecture

All reusable presentation components reside in `src/components/finance/hierarchy/`:

```
src/components/finance/hierarchy/
├── index.js
├── ProjectFinancialIndicator.jsx
├── ProjectFinancialIndicator.module.css
├── ContainerFinancialIndicator.jsx
├── ContainerFinancialIndicator.module.css
├── TaskSpendIndicator.jsx
└── TaskSpendIndicator.module.css
```

### Component Specification

| Component | Target Location | Data Consumed | Visual Contract |
| :--- | :--- | :--- | :--- |
| **`ProjectFinancialIndicator`** | `TasksPage.jsx` Project Command Header | `financialHierarchy.project_summary` | `FINANCE` tag, `₹Actual / ₹Base`, `utilization_pct%`, `FinanceRiskBadge`, clamped progress bar (0–100% width, true % text preserved) |
| **`ContainerFinancialIndicator`** | Phase & Task List Headers | `financialHierarchy.phase_summaries[id]` / `task_list_summaries[id]` | Own budget vs. Inherited budget (`↑ Project budget` / `↑ Phase budget`) vs. Unbudgeted |
| **`TaskSpendIndicator`** | `HierarchyTaskTree.jsx` Task Row Metadata | `financialHierarchy.tasks[id]` | Compact `₹Actual` pill + subtle ancestor context (`↑ Task List`, `↑ Phase`, `↑ Project`, `spent`). Subtasks receive zero independent indicators. |

---

## 3. Formatting Standards

Compact Indian currency formatting is implemented in `src/lib/finance.js` via `formatCompactCurrency(amount)`:
- `< 1,000`: Exact rupee formatting (e.g. `₹850`, `₹0`)
- `1,000` to `< 1,00,000` (`1 Lakh`): `K` notation (e.g. `₹12.4K`, `₹82K`)
- `1,00,000` (`1 Lakh`) to `< 1,00,00,000` (`1 Crore`): `L` notation (e.g. `₹1.25L`, `₹8.4L`, `₹18.4L`)
- `≥ 1,00,00,000` (`1 Crore`): `Cr` notation (e.g. `₹1.2Cr`)

---

## 4. Multi-Persona Authorization Matrix

| Persona | Project Indicator | Phase Indicator | Task List Indicator | Task Spend Indicator |
| :--- | :--- | :--- | :--- | :--- |
| **Workspace Owner** | Visible Project only; NULL on uninvolved | Scoped to visible phases | Scoped to visible task lists | Scoped to visible tasks |
| **Workspace Admin** | Visible Project only; NULL on uninvolved | Scoped to visible phases | Scoped to visible task lists | Scoped to visible tasks |
| **Active CEO / CTO** | Full portfolio visibility | Full portfolio visibility | Full portfolio visibility | Full portfolio visibility |
| **Finance Operator** | Visible Project only; NULL on uninvolved | Scoped to visible phases | Scoped to visible task lists | Scoped to visible tasks |
| **Project Owner** | Full in owned project | Full in owned project | Full in owned project | Full in owned project |
| **Phase Owner** | `NULL` (zero parent leak) | Owned Phase summary | Child Task List summaries | Scoped to visible tasks |
| **Ordinary Member** | `NULL` | `NULL` | `NULL` | Direct spend on assigned/RACI tasks |
| **Viewer** | `NULL` | `NULL` | `NULL` | Direct spend on assigned/RACI tasks |
| **Project Admin only** | `NULL` | `NULL` | `NULL` | Operational tasks only |
| **System Admin only** | `NULL` | `NULL` | `NULL` | Operational tasks only |
| **Unauthenticated** | `NULL` (fail-closed) | `NULL` (fail-closed) | `NULL` (fail-closed) | `NULL` (fail-closed) |

---

## 5. Automated Verification & Regression Suite

The automated test suite `scripts/test-p7-02a-financial-hierarchy-indicators.mjs` executes 52 exhaustive assertions across 7 test suites:
- **Suite 1**: Source Code Architecture & Security Baseline (Assertions 1–9)
- **Suite 2**: Project Financial Indicator Component (Assertions 10–17)
- **Suite 3**: Container Financial Indicator Component (Assertions 18–25)
- **Suite 4**: Task Spend Indicator Component (Assertions 26–31)
- **Suite 5**: Tree Propagation & Hierarchy Integration (Assertions 32–38)
- **Suite 6**: Multi-Persona Authorization Matrix (Assertions 39–50 with live PostgreSQL test fixtures)
- **Suite 7**: Responsive CSS & Design Token Parity (Assertions 51–52)

Execution command:
```bash
npm run test:p7-02a
```
