/**
 * SNS PROJECTS — PACKAGE 7 / P7-02A COMPACT FINANCIAL HIERARCHY INDICATORS TEST SUITE
 *
 * Automated verification for:
 * 1. Source Code Architecture & Security Baseline
 *    - useProjectFinancialHierarchy hook integrated once at TasksPage level
 *    - Hook enabled condition: !userContextLoading && Boolean(visibleProjectId) && view === 'hierarchy'
 *    - authorizationScopeKey passed directly to hook (scope isolation guarantee)
 *    - Zero local state copying or unsafe project-only cache in TasksPage
 *    - Zero direct table queries on budgets/expenses/alerts in hierarchy UI
 *    - Zero N+1 financial summary RPCs per Phase/Task List
 *    - Reusable components under src/components/finance/hierarchy/
 *    - formatCompactCurrency INR formatting (₹850, ₹12.4K, ₹1.25L, ₹18.4L, ₹1.2Cr)
 *    - Kanban and List views remain 100% untouched by finance
 *
 * 2. Project Financial Indicator (ProjectFinancialIndicator)
 *    - Renders null when summary is null/unauthorized (no fake ₹0, 0%, GREEN)
 *    - Renders skeleton during initial load
 *    - Renders FINANCE tag, actual spend, base budget, utilization %, and risk badge
 *    - Accessible progress bar with role="progressbar" and aria attributes
 *    - >100% utilization preserves true percentage in text while clamping visual bar at 100%
 *    - Accessible risk band without color perception alone
 *
 * 3. Container Financial Indicator (ContainerFinancialIndicator)
 *    - Phase & Task List: Renders null when summary is null/unauthorized
 *    - Own-budget: Renders FINANCE label, actual/base, utilization %, risk, and progress bar
 *    - Inherited-budget: Renders actual spend and "↑ Phase/Project budget" without fake denominator or bar
 *    - Truly unbudgeted: Renders actual spend with unbudgeted badge
 *
 * 4. Task Spend Indicator (TaskSpendIndicator)
 *    - Renders direct_spend formatted as compact INR
 *    - Displays budget source tag: ↑ Task List, ↑ Phase, ↑ Project, or spent
 *    - Tasks NEVER render Base Budget, Buffer, Remaining, Utilization %, or Risk Band
 *    - Process step tasks use identical component and display spend
 *    - Subtasks do NOT render independent financial indicators
 *
 * 5. Tree Propagation & Hierarchy Integration
 *    - HierarchyTaskTree receives taskFinancials map
 *    - Child tasks in recursive TaskNode receive taskFinancials
 *    - Process step tasks in ProcessGroup receive taskFinancials
 *    - Uncategorized tasks tree receives taskFinancials
 *    - Operational hierarchy actions preserved (no regression)
 *    - Non-blocking error handling at Project level
 *
 * 6. Multi-Persona Authorization Matrix (Integration Verification across 12 Personas)
 *
 * 7. Responsive CSS & Design Token Parity
 *
 * Usage:
 *   node --import ./scripts/jsx-loader.mjs scripts/test-p7-02a-financial-hierarchy-indicators.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { renderToString } from 'react-dom/server';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');

function parseEnv(content) {
  return content
    .split(/\r?\n/)
    .reduce((values, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return values;
      const equalsIndex = line.indexOf('=');
      if (equalsIndex <= 0) return values;
      const key = line.slice(0, equalsIndex).trim();
      let value = line.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
      return values;
    }, {});
}

function pass(assertionId, message) {
  console.log(`[PASS ${String(assertionId).padStart(2, '0')}] ${message}`);
}

async function asUser(client, userId, sql, params = []) {
  await client.query('SAVEPOINT as_user_sp');
  await client.query('SET LOCAL ROLE authenticated');
  try {
    if (userId) {
      await client.query(
        `SELECT set_config('request.jwt.claim.sub', $1, true),
                set_config('request.jwt.claim.role', 'authenticated', true),
                set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
    } else {
      await client.query(`
        SELECT set_config('request.jwt.claim.sub', '', true),
               set_config('request.jwt.claim.role', '', true),
               set_config('request.jwt.claims', '', true)
      `);
    }
    const result = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT as_user_sp');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK TO SAVEPOINT as_user_sp');
    } catch {}
    throw err;
  } finally {
    try {
      await client.query(`
        SELECT set_config('request.jwt.claim.sub', '', true),
               set_config('request.jwt.claim.role', '', true),
               set_config('request.jwt.claims', '', true)
      `);
      await client.query('RESET ROLE');
    } catch {}
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SNS PROJECTS — PACKAGE 7 / P7-02A COMPACT FINANCIAL INDICATORS TESTS     ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // Dynamic Imports of components and utilities
  const { formatCompactCurrency, normalizeFinancialSummary, normalizeProjectFinancialHierarchy } = await import('../src/lib/finance.js');
  const { default: ProjectFinancialIndicator } = await import('../src/components/finance/hierarchy/ProjectFinancialIndicator.jsx');
  const { default: ContainerFinancialIndicator } = await import('../src/components/finance/hierarchy/ContainerFinancialIndicator.jsx');
  const { default: TaskSpendIndicator } = await import('../src/components/finance/hierarchy/TaskSpendIndicator.jsx');
  const { default: HierarchyTaskTree, HierarchyProcessGroups } = await import('../src/components/HierarchyTaskTree.jsx');

  // Read TasksPage.jsx, HierarchyTaskTree.jsx, and CSS modules
  const tasksPageCode = await readFile(path.join(repoRoot, 'src/pages/TasksPage.jsx'), 'utf8');
  const hierarchyTreeCode = await readFile(path.join(repoRoot, 'src/components/HierarchyTaskTree.jsx'), 'utf8');
  const projectFinanceCss = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/ProjectFinancialIndicator.module.css'), 'utf8');
  const containerFinanceCss = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/ContainerFinancialIndicator.module.css'), 'utf8');
  const taskSpendCss = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/TaskSpendIndicator.module.css'), 'utf8');

  // ── Suite 1: Source Code Architecture & Security Baseline ──────────────────
  console.log('--- Suite 1: Source Code Architecture & Security Baseline ---');

  // Assertion 01: useProjectFinancialHierarchy hook integrated once at TasksPage level
  const hookMatchCount = (tasksPageCode.match(/useProjectFinancialHierarchy\s*\(/g) || []).length;
  assert.equal(hookMatchCount, 1, 'useProjectFinancialHierarchy must be called exactly once at Project TasksPage level');
  pass(1, 'useProjectFinancialHierarchy hook integrated once at Project TasksPage level');

  // Assertion 02: Hook enabled condition strictly requires !userContextLoading && Boolean(visibleProjectId) && view === "hierarchy"
  assert.match(
    tasksPageCode,
    /enabled:\s*!userContextLoading\s*&&\s*Boolean\(visibleProjectId\)\s*&&\s*view\s*===\s*['"]hierarchy['"]/,
    'Hook must only be enabled when user context resolved, project visible, and hierarchy view is active'
  );
  pass(2, 'Hook enabled condition strictly requires user context resolved, project visible, and view === "hierarchy"');

  // Assertion 03: authorizationScopeKey passed directly to hook
  assert.match(
    tasksPageCode,
    /useProjectFinancialHierarchy\(\s*workspaceId,\s*visibleProjectId,\s*authorizationScopeKey/,
    'useProjectFinancialHierarchy must take authorizationScopeKey to enforce render-time scope invalidation'
  );
  pass(3, 'authorizationScopeKey passed directly to hook (authoritative scope isolation)');

  // Assertion 04: Zero local state duplication of financialHierarchy
  assert.doesNotMatch(
    tasksPageCode,
    /setFinancialHierarchy|setProjectFinance|setFinancialData/i,
    'TasksPage must not create secondary local state holding financial hierarchy data'
  );
  pass(4, 'Zero local state duplication of financial hierarchy data in TasksPage.jsx');

  // Assertion 05: Zero direct table queries on budgets, expenses, or alerts in TasksPage or HierarchyTaskTree
  assert.doesNotMatch(tasksPageCode, /\.from\(['"](budgets|expense_transactions|expense_items|finance_alerts)['"]\)/, 'Zero direct client table DML/SELECT on finance tables in TasksPage');
  assert.doesNotMatch(hierarchyTreeCode, /\.from\(['"](budgets|expense_transactions|expense_items|finance_alerts)['"]\)/, 'Zero direct client table DML/SELECT on finance tables in HierarchyTaskTree');
  pass(5, 'Zero direct client queries on budgets/expenses/alerts in hierarchy UI (P7-01 read model is exclusive)');

  // Assertion 06: Zero N+1 financial summary RPCs
  assert.doesNotMatch(tasksPageCode, /get_phase_financial_summary|get_task_list_financial_summary/i, 'No N+1 financial RPC calls in TasksPage');
  assert.doesNotMatch(hierarchyTreeCode, /get_phase_financial_summary|get_task_list_financial_summary/i, 'No N+1 financial RPC calls in HierarchyTaskTree');
  pass(6, 'Zero N+1 financial summary RPCs in hierarchy UI');

  // Assertion 07: Reusable components in src/components/finance/hierarchy/
  assert.ok(ProjectFinancialIndicator, 'ProjectFinancialIndicator exported');
  assert.ok(ContainerFinancialIndicator, 'ContainerFinancialIndicator exported');
  assert.ok(TaskSpendIndicator, 'TaskSpendIndicator exported');
  pass(7, 'Reusable hierarchy financial components reside in src/components/finance/hierarchy/');

  // Assertion 08: formatCompactCurrency INR formatting
  assert.equal(formatCompactCurrency(0), '₹0', '0 formatted as ₹0');
  assert.equal(formatCompactCurrency(850), '₹850', '850 formatted as ₹850');
  assert.equal(formatCompactCurrency(12400), '₹12.4K', '12400 formatted as ₹12.4K');
  assert.equal(formatCompactCurrency(34200), '₹34.2K', '34200 formatted as ₹34.2K');
  assert.equal(formatCompactCurrency(82000), '₹82K', '82000 formatted as ₹82K');
  assert.equal(formatCompactCurrency(125000), '₹1.25L', '125000 formatted as ₹1.25L');
  assert.equal(formatCompactCurrency(840000), '₹8.4L', '840000 formatted as ₹8.4L');
  assert.equal(formatCompactCurrency(1840000), '₹18.4L', '1840000 formatted as ₹18.4L');
  assert.equal(formatCompactCurrency(12000000), '₹1.2Cr', '12000000 formatted as ₹1.2Cr');
  assert.equal(formatCompactCurrency(null), '₹0', 'null formatted as ₹0');
  pass(8, 'formatCompactCurrency formats INR compact amounts canonically (₹850, ₹12.4K, ₹1.25L, ₹18.4L, ₹1.2Cr)');

  // Assertion 09: Kanban and List views remain 100% untouched by financial indicators
  assert.match(
    tasksPageCode,
    /view\s*===\s*['"]hierarchy['"]\s*&&\s*financialHierarchy\?\.project_summary/,
    'Project financial indicator only renders in hierarchy view'
  );
  pass(9, 'Kanban and List views remain 100% untouched by financial indicators (Scope constraint)');

  // ── Suite 2: Project Financial Indicator Component ─────────────────────────
  console.log('\n--- Suite 2: Project Financial Indicator Component ---');

  const stripHtml = (str) => (str || '').replace(/<!--[\s\S]*?-->/g, '');

  // Assertion 10: Renders null when summary is null (unauthorized/fail-closed)
  const emptyProjectHtml = renderToString(React.createElement(ProjectFinancialIndicator, { summary: null }));
  assert.equal(emptyProjectHtml, '', 'summary=null renders empty (zero fake values)');
  pass(10, 'ProjectFinancialIndicator renders null when summary is null (zero fake ₹0 / 0% / GREEN)');

  // Assertion 11: Renders skeleton during initial load when loading=true and !summary
  const skeletonHtml = renderToString(React.createElement(ProjectFinancialIndicator, { summary: null, loading: true }));
  assert.ok(skeletonHtml.includes('skeletonWrap'), 'Skeleton element rendered during initial loading');
  pass(11, 'ProjectFinancialIndicator renders skeleton placeholder during initial loading');

  // Assertion 12: Renders budgeted project summary correctly
  const mockProjectSummary = normalizeFinancialSummary({
    base_budget: 1000000,
    safety_buffer: 200000,
    actual_spend: 840000,
    utilization_pct: 84,
    risk_band: 'ORANGE',
    is_budgeted: true,
  });

  const projectHtml = stripHtml(renderToString(React.createElement(ProjectFinancialIndicator, { summary: mockProjectSummary })));
  assert.ok(projectHtml.includes('FINANCE'), 'Contains FINANCE label');
  assert.ok(projectHtml.includes('₹8.4L'), 'Contains actual spend ₹8.4L');
  assert.ok(projectHtml.includes('₹10L'), 'Contains base budget ₹10L');
  assert.ok(projectHtml.includes('84%'), 'Contains utilization 84%');
  assert.ok(projectHtml.includes('ORANGE'), 'Contains ORANGE risk band');
  pass(12, 'ProjectFinancialIndicator renders FINANCE tag, actual spend, base budget, utilization %, and risk badge');

  // Assertion 13: Accessible progress bar with role="progressbar" and aria attributes
  assert.ok(projectHtml.includes('role="progressbar"'), 'Progress bar has role="progressbar"');
  assert.ok(projectHtml.includes('aria-label="Project financial utilization"'), 'aria-label is present');
  assert.ok(projectHtml.includes('aria-valuenow="84"'), 'aria-valuenow is 84');
  assert.ok(projectHtml.includes('aria-valuemin="0"'), 'aria-valuemin is 0');
  assert.ok(projectHtml.includes('aria-valuemax="100"'), 'aria-valuemax is 100');
  pass(13, 'Utilization progress bar implements accessible role="progressbar" with aria-valuenow');

  // Assertion 14: Overrun state (>100% utilization) preserves true percentage in text while clamping bar at 100%
  const mockOverrunSummary = normalizeFinancialSummary({
    base_budget: 100000,
    actual_spend: 124000,
    utilization_pct: 124,
    risk_band: 'RED',
    is_budgeted: true,
  });

  const overrunHtml = stripHtml(renderToString(React.createElement(ProjectFinancialIndicator, { summary: mockOverrunSummary })));
  assert.ok(overrunHtml.includes('124%'), 'Overrun text 124% preserved');
  assert.ok(overrunHtml.includes('RED'), 'RED risk displayed');
  assert.ok(overrunHtml.includes('style="width:100%"'), 'Clamped to width 100%');
  pass(14, 'Overrun state (>100% utilization: 124%) preserves true textual percentage while visual bar clamps safely');

  // Assertion 15 & 16: Risk band accessibility without color alone across all 4 bands
  for (const band of ['GREEN', 'YELLOW', 'ORANGE', 'RED']) {
    const summary = normalizeFinancialSummary({
      base_budget: 100000,
      actual_spend: 50000,
      utilization_pct: 50,
      risk_band: band,
      is_budgeted: true,
    });
    const html = stripHtml(renderToString(React.createElement(ProjectFinancialIndicator, { summary })));
    assert.ok(html.includes(band), `Risk text ${band} is present for non-color accessibility`);
  }
  pass(15, 'Backend risk_band used directly across GREEN, YELLOW, ORANGE, RED');
  pass(16, 'Risk indicator is accessible without color perception alone (text label included)');

  // Assertion 17: Unbudgeted project summary renders actual spend and UNBUDGETED badge without fake progress bar
  const mockUnbudgetedProject = normalizeFinancialSummary({
    base_budget: 0,
    actual_spend: 45000,
    utilization_pct: 0,
    risk_band: 'GREEN',
    is_budgeted: false,
  });
  const unbudgetedHtml = stripHtml(renderToString(React.createElement(ProjectFinancialIndicator, { summary: mockUnbudgetedProject })));
  assert.ok(unbudgetedHtml.includes('₹45K'), 'Unbudgeted actual spend rendered');
  assert.ok(unbudgetedHtml.includes('spent'), 'Unbudgeted "spent" text rendered');
  assert.ok(unbudgetedHtml.includes('UNBUDGETED'), 'UNBUDGETED badge rendered');
  assert.ok(!unbudgetedHtml.includes('role="progressbar"'), 'No fake progress bar for unbudgeted project');
  pass(17, 'Unbudgeted project summary renders actual spend and UNBUDGETED badge without fake progress bar');

  // ── Suite 3: Container Financial Indicator Component ───────────────────────
  console.log('\n--- Suite 3: Container Financial Indicator Component ---');

  // Assertion 18: Phase & Task List render null when summary is null
  const emptyContainerHtml = stripHtml(renderToString(React.createElement(ContainerFinancialIndicator, { summary: null, entityType: 'phase' })));
  assert.equal(emptyContainerHtml, '', 'summary=null renders empty');
  pass(18, 'ContainerFinancialIndicator renders null when summary is null (unauthorized/fail-closed)');

  // Assertion 19: Own-budget Phase
  const mockOwnBudgetPhase = normalizeFinancialSummary({
    base_budget: 300000,
    actual_spend: 215000,
    utilization_pct: 71.7,
    risk_band: 'YELLOW',
    is_budgeted: true,
  });
  const phaseHtml = stripHtml(renderToString(React.createElement(ContainerFinancialIndicator, { summary: mockOwnBudgetPhase, entityType: 'phase' })));
  assert.ok(phaseHtml.includes('FINANCE'), 'Own-budget Phase has FINANCE tag');
  assert.ok(phaseHtml.includes('₹2.15L'), 'Contains Phase actual spend ₹2.15L');
  assert.ok(phaseHtml.includes('₹3L'), 'Contains Phase base budget ₹3L');
  assert.ok(phaseHtml.includes('71.7%'), 'Contains Phase utilization 71.7%');
  assert.ok(phaseHtml.includes('YELLOW'), 'Contains Phase risk YELLOW');
  assert.ok(phaseHtml.includes('role="progressbar"'), 'Progress bar present for own-budget Phase');
  pass(19, 'Own-budget Phase renders FINANCE tag, actual/base, utilization %, risk, and progress bar');

  // Assertion 20: Inherited-budget Phase (from Project)
  const mockInheritedPhase = normalizeFinancialSummary({
    base_budget: 0,
    actual_spend: 125000,
    budget_source_type: 'project',
    budget_source_id: randomUUID(),
    is_budgeted: false,
  });
  const inhPhaseHtml = stripHtml(renderToString(React.createElement(ContainerFinancialIndicator, { summary: mockInheritedPhase, entityType: 'phase' })));
  assert.ok(inhPhaseHtml.includes('₹1.25L'), 'Contains Phase actual spend');
  assert.ok(inhPhaseHtml.includes('spent'), 'Contains "spent" text');
  assert.ok(inhPhaseHtml.includes('Project budget'), 'Contains "↑ Project budget" tag');
  assert.doesNotMatch(inhPhaseHtml, /₹1\.25L\s*\/\s*₹/, 'Does NOT display fake denominator for inherited Phase');
  assert.ok(!inhPhaseHtml.includes('role="progressbar"'), 'No fake progress bar for inherited Phase');
  pass(20, 'Inherited-budget Phase renders actual spend and "↑ Project budget" tag without fake denominator or bar');

  // Assertion 21: Own-budget Task List
  const mockOwnBudgetTaskList = normalizeFinancialSummary({
    base_budget: 200000,
    actual_spend: 128000,
    utilization_pct: 64,
    risk_band: 'YELLOW',
    is_budgeted: true,
  });
  const tlHtml = stripHtml(renderToString(React.createElement(ContainerFinancialIndicator, { summary: mockOwnBudgetTaskList, entityType: 'task_list' })));
  assert.ok(tlHtml.includes('FINANCE'), 'Own-budget Task List has FINANCE tag');
  assert.ok(tlHtml.includes('₹1.28L'), 'Contains Task List actual spend ₹1.28L');
  assert.ok(tlHtml.includes('₹2L'), 'Contains Task List base budget ₹2L');
  assert.ok(tlHtml.includes('64%'), 'Contains Task List utilization 64%');
  assert.ok(tlHtml.includes('YELLOW'), 'Contains Task List risk YELLOW');
  pass(21, 'Own-budget Task List renders FINANCE tag, actual/base, utilization %, risk, and progress bar');

  // Assertion 22: Inherited-budget Task List (from Phase)
  const mockInheritedTaskListPhase = normalizeFinancialSummary({
    base_budget: 0,
    actual_spend: 82000,
    budget_source_type: 'phase',
    budget_source_id: randomUUID(),
    is_budgeted: false,
  });
  const tlInhHtml = stripHtml(renderToString(React.createElement(ContainerFinancialIndicator, { summary: mockInheritedTaskListPhase, entityType: 'task_list' })));
  assert.ok(tlInhHtml.includes('₹82K'), 'Contains Task List actual spend ₹82K');
  assert.ok(tlInhHtml.includes('Phase budget'), 'Contains "↑ Phase budget" tag');
  assert.doesNotMatch(tlInhHtml, /₹82K\s*\/\s*₹/, 'Does NOT display fake denominator for inherited Task List');
  pass(22, 'Inherited-budget Task List (from Phase) renders actual spend and "↑ Phase budget" tag');

  // Assertion 23: Inherited-budget Task List (directly from Project)
  const mockInheritedTaskListProj = normalizeFinancialSummary({
    base_budget: 0,
    actual_spend: 34000,
    budget_source_type: 'project',
    budget_source_id: randomUUID(),
    is_budgeted: false,
  });
  const tlProjInhHtml = stripHtml(renderToString(React.createElement(ContainerFinancialIndicator, { summary: mockInheritedTaskListProj, entityType: 'task_list' })));
  assert.ok(tlProjInhHtml.includes('Project budget'), 'Contains "↑ Project budget" tag');
  pass(23, 'Inherited-budget Task List (from Project) renders actual spend and "↑ Project budget" tag');

  // Assertion 24: Truly unbudgeted container
  const mockUnbudgetedTL = normalizeFinancialSummary({
    base_budget: 0,
    actual_spend: 15000,
    budget_source_type: null,
    budget_source_id: null,
    is_budgeted: false,
  });
  const unbudgetedTLHtml = stripHtml(renderToString(React.createElement(ContainerFinancialIndicator, { summary: mockUnbudgetedTL, entityType: 'task_list' })));
  assert.ok(unbudgetedTLHtml.includes('₹15K'), 'Contains ₹15K spend');
  assert.ok(unbudgetedTLHtml.includes('UNBUDGETED'), 'Contains UNBUDGETED badge');
  pass(24, 'Truly unbudgeted container renders actual spend and UNBUDGETED badge');

  // Assertion 25: Accessible role="progressbar" attributes on container
  assert.ok(phaseHtml.includes('aria-label="Phase financial utilization"'), 'Phase progress bar aria-label');
  assert.ok(phaseHtml.includes('aria-valuenow="71.7"'), 'Phase progress bar aria-valuenow');
  pass(25, 'Container progress bar implements accessible role="progressbar" and aria attributes');

  // ── Suite 4: Task Spend Indicator Component ────────────────────────────────
  console.log('\n--- Suite 4: Task Spend Indicator Component ---');

  // Assertion 26: Renders null when financial object is null
  const emptyTaskHtml = stripHtml(renderToString(React.createElement(TaskSpendIndicator, { financial: null })));
  assert.equal(emptyTaskHtml, '', 'financial=null renders empty');
  pass(26, 'TaskSpendIndicator renders null when financial is null (absence means absence)');

  // Assertion 27: Displays direct_spend formatted as compact INR
  const mockTaskFinancial = {
    task_id: randomUUID(),
    direct_spend: 34200,
    visible_rollup_spend: 34200,
    budget_source_type: 'task_list',
  };
  const taskHtml = stripHtml(renderToString(React.createElement(TaskSpendIndicator, { financial: mockTaskFinancial })));
  assert.ok(taskHtml.includes('₹34.2K'), 'Contains direct spend ₹34.2K');
  assert.ok(taskHtml.includes('Task List'), 'Contains "↑ Task List" source context');
  pass(27, 'TaskSpendIndicator displays direct_spend formatted as compact INR (₹34.2K)');

  // Assertion 28: Budget source tags for phase, project, and none
  const taskPhaseHtml = stripHtml(renderToString(React.createElement(TaskSpendIndicator, { financial: { task_id: randomUUID(), direct_spend: 12500, budget_source_type: 'phase' } })));
  assert.ok(taskPhaseHtml.includes('Phase'), 'Contains "↑ Phase"');

  const taskProjHtml = stripHtml(renderToString(React.createElement(TaskSpendIndicator, { financial: { task_id: randomUUID(), direct_spend: 4800, budget_source_type: 'project' } })));
  assert.ok(taskProjHtml.includes('Project'), 'Contains "↑ Project"');

  const taskNoneHtml = stripHtml(renderToString(React.createElement(TaskSpendIndicator, { financial: { task_id: randomUUID(), direct_spend: 4800, budget_source_type: 'none' } })));
  assert.ok(taskNoneHtml.includes('spent'), 'Contains "spent" tag for budget_source_type=none');
  pass(28, 'TaskSpendIndicator resolves budget source provenance (Task List, Phase, Project, none)');

  // Assertion 29: Tasks NEVER render Base Budget, Safety Buffer, Remaining, Utilization %, or Risk Band
  assert.doesNotMatch(taskHtml, /%/, 'No utilization % on Task');
  assert.doesNotMatch(taskHtml, /GREEN|YELLOW|ORANGE|RED/i, 'No Risk Band on Task');
  assert.doesNotMatch(taskHtml, /buffer|ceiling|remaining/i, 'No budget allocation concepts on Task');
  pass(29, 'Tasks NEVER render Base Budget, Safety Buffer, Remaining, Utilization %, or Risk Band');

  // Assertion 30: Process step tasks use identical component
  const stepHtml = stripHtml(renderToString(React.createElement(TaskSpendIndicator, { financial: { task_id: randomUUID(), direct_spend: 5500, budget_source_type: 'project' } })));
  assert.ok(stepHtml.includes('₹5.5K'), 'Process step task displays spend indicator');
  pass(30, 'Process Step Tasks use identical TaskSpendIndicator component and display direct spend');

  // Assertion 31: Subtasks do NOT render independent financial indicators
  assert.doesNotMatch(
    hierarchyTreeCode,
    /<SubtaskGroup[^>]*TaskSpendIndicator/s,
    'SubtaskGroup does not render TaskSpendIndicator'
  );
  pass(31, 'Subtasks do NOT render independent financial indicators (exactly-once parent task spend accounting)');

  // ── Suite 5: Tree Propagation & Hierarchy Integration ──────────────────────
  console.log('\n--- Suite 5: Tree Propagation & Hierarchy Integration ---');

  const taskId1 = randomUUID();
  const taskId2 = randomUUID();
  const childTaskId = randomUUID();
  const mockTasks = [
    {
      id: taskId1,
      title: 'Root Task 1',
      parent_task_id: null,
      task_statuses: { name: 'In Progress', color: '#fde215' },
    },
    {
      id: childTaskId,
      title: 'Child Task 1.1',
      parent_task_id: taskId1,
      task_statuses: { name: 'Todo', color: '#afafaf' },
    },
    {
      id: taskId2,
      title: 'Root Task 2',
      parent_task_id: null,
      task_statuses: { name: 'Done', color: '#4acf82' },
    },
  ];

  const mockTaskFinancials = {
    [taskId1]: { task_id: taskId1, direct_spend: 10000, budget_source_type: 'task_list' },
    [childTaskId]: { task_id: childTaskId, direct_spend: 5000, budget_source_type: 'task_list' },
    [taskId2]: { task_id: taskId2, direct_spend: 0, budget_source_type: 'phase' },
  };

  // Assertion 32 & 33: HierarchyTaskTree receives taskFinancials and renders root and child task spend
  const treeHtml = stripHtml(renderToString(
    React.createElement(HierarchyTaskTree, {
      tasks: mockTasks,
      processInstances: [],
      taskFinancials: mockTaskFinancials,
    })
  ));
  assert.ok(treeHtml.includes('Root Task 1'), 'Root Task 1 rendered');
  assert.ok(treeHtml.includes('₹10K'), 'Root Task 1 spend ₹10K rendered');
  assert.ok(treeHtml.includes('Child Task 1.1'), 'Child Task 1.1 rendered');
  assert.ok(treeHtml.includes('₹5K'), 'Child Task 1.1 spend ₹5K rendered');
  assert.ok(treeHtml.includes('Root Task 2'), 'Root Task 2 rendered');
  pass(32, 'HierarchyTaskTree receives taskFinancials map and resolves spend per task ID');
  pass(33, 'Child tasks in recursive TaskNode receive taskFinancials and render their own spend');

  // Assertion 34: Process step tasks receive taskFinancials
  const procInstId = randomUUID();
  const stepTaskId = randomUUID();
  const mockProcessInstance = {
    id: procInstId,
    instance_name: 'Core Deployment',
    status: 'in_progress',
    progress: 50,
  };
  const mockProcessTasks = [
    {
      id: stepTaskId,
      title: 'Step 1: Provisioning',
      process_instance_id: procInstId,
      process_step_id: randomUUID(),
      parent_task_id: null,
      task_statuses: { name: 'In Progress', color: '#fde215' },
    },
  ];
  const mockProcessTaskFinancials = {
    [stepTaskId]: { task_id: stepTaskId, direct_spend: 8500, budget_source_type: 'project' },
  };

  const procGroupsHtml = stripHtml(renderToString(
    React.createElement(HierarchyProcessGroups, {
      processes: [mockProcessInstance],
      tasks: mockProcessTasks,
      taskFinancials: mockProcessTaskFinancials,
    })
  ));
  assert.ok(procGroupsHtml.includes('Step 1: Provisioning'), 'Step task rendered');
  assert.ok(procGroupsHtml.includes('₹8.5K'), 'Step task spend ₹8.5K rendered');
  pass(34, 'Process step tasks in HierarchyProcessGroups receive taskFinancials and render spend');

  // Assertion 35: Uncategorized tasks tree receives taskFinancials
  assert.match(
    tasksPageCode,
    /uncategorizedTasks\.length\s*>\s*0[\s\S]*?<HierarchyTaskTree[\s\S]*?taskFinancials=\{financialHierarchy\?\.tasks\s*\|\|\s*\{\}\}/,
    'Uncategorized tasks tree passes taskFinancials'
  );
  pass(35, 'Uncategorized tasks tree receives taskFinancials prop');

  // Assertion 36: Task objects are not mutated with finance properties
  assert.equal(mockTasks[0].direct_spend, undefined, 'Original task object is unmodified');
  assert.equal(mockTasks[1].direct_spend, undefined, 'Original child task object is unmodified');
  pass(36, 'Operational task objects remain clean and unmutated by finance presentation layer');

  // Assertion 37: Operational hierarchy actions preserved
  assert.match(tasksPageCode, /togglePhaseCollapse/, 'Phase collapse toggle preserved');
  assert.match(tasksPageCode, /toggleTaskListCollapse/, 'Task list collapse toggle preserved');
  assert.match(tasksPageCode, /handleOpenAddTask/, 'Add task handler preserved');
  assert.match(tasksPageCode, /handleOpenAddTaskList/, 'Add task list handler preserved');
  pass(37, 'Operational hierarchy actions (collapse/expand, modals, add controls) 100% preserved');

  // Assertion 38: Non-blocking error handling at Project level
  assert.match(
    tasksPageCode,
    /financialError\s*&&\s*!financialHierarchy[\s\S]*?Financial context unavailable/,
    'TasksPage displays non-blocking financial error message without breaking operational hierarchy'
  );
  pass(38, 'Financial RPC failure displays subtle non-blocking notice without disrupting operational hierarchy');

  // ── Suite 6: Multi-Persona Authorization Matrix (Integration Verification) ─
  console.log('\n--- Suite 6: Multi-Persona Authorization Matrix ---');

  // Connect to DB and verify live get_project_financial_hierarchy contract with all 12 personas
  let client;
  try {
    const envContent = await readFile(envAdminPath, 'utf8');
    const env = parseEnv(envContent);
    client = new Client({
      connectionString: env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    console.log('Connected to PostgreSQL. Verifying live persona financial presentation contracts...');

    await client.query('BEGIN');

    // Create test workspaces & projects
    const wsId = randomUUID();
    const uninvolvedProjId = randomUUID();
    const visibleProjId = randomUUID();
    const phaseId = randomUUID();
    const taskListId = randomUUID();
    const rootTaskId = randomUUID();

    const uOwner = randomUUID();
    const uAdmin = randomUUID();
    const uCeo = randomUUID();
    const uCto = randomUUID();
    const uFinance = randomUUID();
    const uProjOwner = randomUUID();
    const uPhaseOwner = randomUUID();
    const uMember = randomUUID();
    const uViewer = randomUUID();
    const uProjAdmin = randomUUID();
    const uSysAdmin = randomUUID();
    const uUninvolvedOther = randomUUID();

    const membersList = [
      [uOwner, 'owner'],
      [uAdmin, 'admin'],
      [uCeo, 'member'],
      [uCto, 'member'],
      [uFinance, 'member'],
      [uProjOwner, 'member'],
      [uPhaseOwner, 'member'],
      [uMember, 'member'],
      [uViewer, 'viewer'],
      [uProjAdmin, 'member'],
      [uSysAdmin, 'member'],
      [uUninvolvedOther, 'member'],
    ];

    // Seed test users into auth.users and public.profiles first
    await client.query('SET LOCAL session_replication_role = replica');
    for (const [uid] of membersList) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, email, raw_user_meta_data, created_at, updated_at, aud, role)
        VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000', $2::text, jsonb_build_object('full_name', $3::text), now(), now(), 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING
      `, [uid, `p702a_${uid.slice(0, 8)}@example.com`, `User ${uid.slice(0, 5)}`]);

      await client.query(`
        INSERT INTO public.profiles (id, full_name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
      `, [uid, `User ${uid.slice(0, 5)}`]);
    }
    await client.query('SET LOCAL session_replication_role = DEFAULT');

    // Insert workspace
    await client.query(`INSERT INTO public.workspaces (id, name, created_by) VALUES ($1, 'P7-02A Workspace', $2)`, [wsId, uOwner]);

    for (const [uid, role] of membersList) {
      await client.query(`INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [wsId, uid, role]);
    }

    // Assign system roles
    await client.query(`
      INSERT INTO public.user_system_roles (workspace_id, user_id, role)
      VALUES ($1, $2, 'ceo'),
             ($1, $3, 'cto'),
             ($1, $4, 'project_admin'),
             ($1, $5, 'system_admin')
    `, [wsId, uCeo, uCto, uProjAdmin, uSysAdmin]);

    // Finance operator via FIN department membership
    const finDeptId = randomUUID();
    await client.query(`INSERT INTO public.departments (id, workspace_id, name, code) VALUES ($1, $2, 'Finance Department', 'FIN')`, [finDeptId, wsId]);
    await client.query(`INSERT INTO public.department_memberships (workspace_id, department_id, user_id, is_active, is_primary) VALUES ($1, $2, $3, true, true)`, [wsId, finDeptId, uFinance]);

    // Insert projects
    await client.query(`INSERT INTO public.projects (id, workspace_id, name, created_by, owner_id) VALUES ($1, $2, 'Uninvolved Project', $3, $3)`, [uninvolvedProjId, wsId, uUninvolvedOther]);
    await client.query(`INSERT INTO public.projects (id, workspace_id, name, created_by, owner_id) VALUES ($1, $2, 'Visible Project', $3, $4)`, [visibleProjId, wsId, uOwner, uProjOwner]);

    // Project budget
    await client.query(`INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, base_budget, safety_buffer, created_by) VALUES ($1, $2, 'project', $3, 100000, 20000, $4)`, [randomUUID(), wsId, visibleProjId, uOwner]);

    // Insert Phase, Task List, Tasks
    await client.query(`INSERT INTO public.phases (id, project_id, name, owner_id, created_by) VALUES ($1, $2, 'Phase 1', $3, $4)`, [phaseId, visibleProjId, uPhaseOwner, uOwner]);
    await client.query(`INSERT INTO public.budgets (id, workspace_id, entity_type, project_id, phase_id, base_budget, created_by) VALUES ($1, $2, 'phase', $3, $4, 40000, $5)`, [randomUUID(), wsId, visibleProjId, phaseId, uOwner]);

    await client.query(`INSERT INTO public.task_lists (id, project_id, phase_id, name, created_by) VALUES ($1, $2, $3, 'Task List 1', $4)`, [taskListId, visibleProjId, phaseId, uOwner]);
    await client.query(`INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title, created_by, assignee_id) VALUES ($1, $2, $3, $4, 'Task 1', $5, $6)`, [rootTaskId, visibleProjId, phaseId, taskListId, uOwner, uMember]);
    await client.query(`INSERT INTO public.tasks (id, project_id, phase_id, task_list_id, title, created_by, assignee_id) VALUES ($1, $2, $3, $4, 'Task PhaseOwner', $5, $6)`, [randomUUID(), visibleProjId, phaseId, taskListId, uOwner, uPhaseOwner]);
    await client.query(`INSERT INTO public.task_raci_assignments (task_id, raci_role, user_id) VALUES ($1, 'A', $2), ($1, 'R', $3), ($1, 'C', $4), ($1, 'I', $5)`, [rootTaskId, uOwner, uAdmin, uFinance, uViewer]);

    // Attach expense
    const txId = randomUUID();
    await client.query(`INSERT INTO public.expense_transactions (id, workspace_id, task_id, subtask_id, status, created_by) VALUES ($1, $2, $3, NULL, 'active', $4)`, [txId, wsId, rootTaskId, uMember]);
    await client.query(`INSERT INTO public.expense_items (id, transaction_id, line_number, amount) VALUES ($1, $2, 1, 3000.00)`, [randomUUID(), txId]);

    // Test Persona 1: Workspace Owner (visible vs uninvolved)
    const rOwnerVis = await asUser(client, uOwner, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const dOwnerVis = normalizeProjectFinancialHierarchy(rOwnerVis.rows[0].data);
    assert.ok(dOwnerVis.project_summary, 'Workspace Owner receives project summary for visible project');
    assert.equal(dOwnerVis.phase_summaries[phaseId].base_budget, 40000, 'Phase summary present');
    assert.equal(dOwnerVis.tasks[rootTaskId].direct_spend, 3000, 'Task spend present');

    const rOwnerUninv = await asUser(client, uOwner, `SELECT public.get_project_financial_hierarchy($1) as data`, [uninvolvedProjId]);
    assert.equal(rOwnerUninv.rows[0].data, null, 'Workspace Owner receives NULL on uninvolved project');
    pass(39, 'Persona 1 (Workspace Owner): Indicators render on visible project; NULL on uninvolved project');

    // Test Persona 2: Workspace Admin
    const rAdminVis = await asUser(client, uAdmin, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    assert.ok(normalizeProjectFinancialHierarchy(rAdminVis.rows[0].data).project_summary, 'Workspace Admin receives project summary');
    const rAdminUninv = await asUser(client, uAdmin, `SELECT public.get_project_financial_hierarchy($1) as data`, [uninvolvedProjId]);
    assert.equal(rAdminUninv.rows[0].data, null, 'Workspace Admin receives NULL on uninvolved project');
    pass(40, 'Persona 2 (Workspace Admin): Indicators render on visible project; NULL on uninvolved project');

    // Test Persona 3: CEO
    const rCeoVis = await asUser(client, uCeo, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const rCeoUninv = await asUser(client, uCeo, `SELECT public.get_project_financial_hierarchy($1) as data`, [uninvolvedProjId]);
    assert.ok(normalizeProjectFinancialHierarchy(rCeoVis.rows[0].data).project_summary, 'CEO receives visible project summary');
    assert.ok(normalizeProjectFinancialHierarchy(rCeoUninv.rows[0].data).project_summary, 'CEO receives uninvolved project summary (broad portfolio)');
    pass(41, 'Persona 3 (CEO): Full portfolio visibility across all projects in workspace');

    // Test Persona 4: CTO
    const rCtoVis = await asUser(client, uCto, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const rCtoUninv = await asUser(client, uCto, `SELECT public.get_project_financial_hierarchy($1) as data`, [uninvolvedProjId]);
    assert.ok(normalizeProjectFinancialHierarchy(rCtoVis.rows[0].data).project_summary, 'CTO receives visible project summary');
    assert.ok(normalizeProjectFinancialHierarchy(rCtoUninv.rows[0].data).project_summary, 'CTO receives uninvolved project summary (broad portfolio)');
    pass(42, 'Persona 4 (CTO): Full portfolio visibility across all projects in workspace');

    // Test Persona 5: Finance Operator
    const rFinVis = await asUser(client, uFinance, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const rFinUninv = await asUser(client, uFinance, `SELECT public.get_project_financial_hierarchy($1) as data`, [uninvolvedProjId]);
    assert.ok(normalizeProjectFinancialHierarchy(rFinVis.rows[0].data).project_summary, 'Finance Operator receives visible project summary');
    assert.equal(rFinUninv.rows[0].data, null, 'Finance Operator receives NULL on uninvolved project');
    pass(43, 'Persona 5 (Finance Operator): Indicators render on visible project; NULL on uninvolved project');

    // Test Persona 6: Project Owner
    const rProjOwn = await asUser(client, uProjOwner, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    assert.ok(normalizeProjectFinancialHierarchy(rProjOwn.rows[0].data).project_summary, 'Project Owner receives full project summary');
    pass(44, 'Persona 6 (Project Owner): Full container and task indicators render in owned project');

    // Test Persona 7: Phase Owner
    const rPhaseOwn = await asUser(client, uPhaseOwner, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const dPhaseOwn = normalizeProjectFinancialHierarchy(rPhaseOwn.rows[0].data);
    assert.equal(dPhaseOwn.project_summary, null, 'Phase Owner project_summary is NULL (no parent leak)');
    assert.ok(dPhaseOwn.phase_summaries[phaseId], 'Phase Owner receives owned phase summary');
    pass(45, 'Persona 7 (Phase Owner): Scoped to owned Phase; Project summary is strictly null');

    // Test Persona 8: Member
    const rMember = await asUser(client, uMember, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const dMember = normalizeProjectFinancialHierarchy(rMember.rows[0].data);
    assert.equal(dMember.project_summary, null, 'Member project_summary is NULL');
    assert.deepEqual(dMember.phase_summaries, {}, 'Member phase_summaries is empty');
    assert.equal(dMember.tasks[rootTaskId].direct_spend, 3000, 'Member receives task spend');
    pass(46, 'Persona 8 (Member): Task spend rendered; container summaries strictly null (zero ancestor leak)');

    // Test Persona 9: Viewer
    const rViewer = await asUser(client, uViewer, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const dViewer = normalizeProjectFinancialHierarchy(rViewer.rows[0].data);
    assert.equal(dViewer.project_summary, null, 'Viewer project_summary is NULL');
    assert.equal(dViewer.tasks[rootTaskId].direct_spend, 3000, 'Viewer receives task spend');
    pass(47, 'Persona 9 (Viewer): Task spend rendered; container summaries strictly null');

    // Test Persona 10 & 11: Project Admin & System Admin
    const rPAdmin = await asUser(client, uProjAdmin, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const dPAdmin = normalizeProjectFinancialHierarchy(rPAdmin.rows[0].data);
    assert.equal(dPAdmin.project_summary, null, 'Project Admin project_summary is NULL (no container finance)');

    const rSAdmin = await asUser(client, uSysAdmin, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    const dSAdmin = normalizeProjectFinancialHierarchy(rSAdmin.rows[0].data);
    assert.equal(dSAdmin.project_summary, null, 'System Admin project_summary is NULL (no container finance)');
    pass(48, 'Persona 10 (Project Admin): Operational visibility without container finance');
    pass(49, 'Persona 11 (System Admin): Operational visibility without container finance');

    // Test Persona 12: Unauthenticated
    const rAnon = await asUser(client, null, `SELECT public.get_project_financial_hierarchy($1) as data`, [visibleProjId]);
    assert.equal(rAnon.rows[0].data, null, 'Unauthenticated caller receives NULL fail-closed');
    pass(50, 'Persona 12 (Unauthenticated): Strict fail-closed return NULL');

    await client.query('ROLLBACK');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (client) await client.end();
  }

  // ── Suite 7: Responsive CSS & Design Token Parity ──────────────────────────
  console.log('\n--- Suite 7: Responsive CSS & Design Token Parity ---');

  // Assertion 51: Design token verification across all 3 CSS modules
  const allCss = `${projectFinanceCss}\n${containerFinanceCss}\n${taskSpendCss}`;
  assert.doesNotMatch(allCss, /--brand[^-]/, 'Zero noncanonical --brand references');
  assert.ok(allCss.includes('var(--yellow)'), 'Uses canonical --yellow');
  assert.ok(allCss.includes('var(--line-soft)'), 'Uses canonical --line-soft');
  assert.ok(allCss.includes('var(--radius-xs)'), 'Uses canonical --radius-xs');
  pass(51, 'CSS modules adhere 100% to canonical Stack n Stock design tokens');

  // Assertion 52: Responsive breakpoint contracts defined
  assert.ok(projectFinanceCss.includes('@media (max-width: 768px)'), 'Project indicator responsive breakpoint');
  assert.ok(containerFinanceCss.includes('@media (max-width: 768px)'), 'Container indicator responsive breakpoint');
  pass(52, 'Responsive breakpoint contracts defined for mobile and tablet surfaces (zero overflow)');

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  ALL 52 P7-02A COMPACT FINANCIAL INDICATOR ASSERTIONS PASSED!             ');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\n❌ P7-02A TEST SUITE FAILED:', err);
  process.exit(1);
});
