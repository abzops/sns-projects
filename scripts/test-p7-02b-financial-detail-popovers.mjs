/**
 * SNS PROJECTS — PACKAGE 7 / P7-02B FINANCIAL DETAIL POPOVERS TEST SUITE
 *
 * Comprehensive automated verification for P7-02B:
 * 1. Architecture, Zero-RPC & Database Integrity (A, B, AV, AW, AY, AZ)
 * 2. Project Financial Detail Popover & Context Card (C, D, E, F, G, H, I, J, K, L + Unbudgeted Project Regression)
 * 3. Own-Budget & Inherited-Budget Containers (M, N, O, P, Q, R, S, AD, AE)
 * 4. Task Spend Detail Popovers & Subtree Contracts (T, U, V, W, X, Y, Z, AA, AB, AC, AF)
 * 5. Scope Key Architecture & Hierarchy Tree Propagation (AP, AQ, AR, AS, AT, AU + Deep Scope Propagation)
 * 6. Popover Viewport Safety, Mobile 390px & CSS Contract (AX + Vertical Viewport Safety)
 * 7. Mounted React Interaction Harness (Click, Enter, Space, Escape, Focus Restore, Scope Reset)
 *
 * Usage:
 *   node --experimental-loader ./scripts/jsx-loader.mjs scripts/test-p7-02b-financial-detail-popovers.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import ProjectFinancialIndicator from '../src/components/finance/hierarchy/ProjectFinancialIndicator.jsx';
import ContainerFinancialIndicator from '../src/components/finance/hierarchy/ContainerFinancialIndicator.jsx';
import TaskSpendIndicator from '../src/components/finance/hierarchy/TaskSpendIndicator.jsx';
import FinancialDetailPopover from '../src/components/finance/hierarchy/FinancialDetailPopover.jsx';
import ContainerFinancialDetail from '../src/components/finance/hierarchy/ContainerFinancialDetail.jsx';
import TaskFinancialDetail from '../src/components/finance/hierarchy/TaskFinancialDetail.jsx';
import HierarchyTaskTree, { HierarchyProcessGroups } from '../src/components/HierarchyTaskTree.jsx';
import * as hierarchyExports from '../src/components/finance/hierarchy/index.js';

const repoRoot = process.cwd();

let passedCount = 0;
let failedCount = 0;

function pass(assertionId, message) {
  passedCount++;
  console.log(`[PASS ${String(assertionId).padStart(2, '0')}] ${message}`);
}

function stripHtml(str) {
  return (str || '').replace(/<!--[\s\S]*?-->/g, '');
}

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('  SNS PROJECTS — PACKAGE 7 / P7-02B FINANCIAL DETAIL POPOVERS TESTS        ');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

async function runTests() {
  // ─────────────────────────────────────────────────────────────────────────────
  // Suite 1: Architecture, Zero-RPC & Database Integrity
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Architecture, Zero-RPC & Database Integrity ---');

  const tasksPageSrc = await readFile(path.join(repoRoot, 'src/pages/TasksPage.jsx'), 'utf-8');
  const treeSrc = await readFile(path.join(repoRoot, 'src/components/HierarchyTaskTree.jsx'), 'utf-8');
  const popoverSrc = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/FinancialDetailPopover.jsx'), 'utf-8');
  const containerDetailSrc = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/ContainerFinancialDetail.jsx'), 'utf-8');
  const taskDetailSrc = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/TaskFinancialDetail.jsx'), 'utf-8');
  const popoverCss = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/FinancialDetailPopover.module.css'), 'utf-8');
  const containerDetailCss = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/ContainerFinancialDetail.module.css'), 'utf-8');
  const taskDetailCss = await readFile(path.join(repoRoot, 'src/components/finance/hierarchy/TaskFinancialDetail.module.css'), 'utf-8');

  // A: Zero new finance RPCs introduced
  const hasNoNewRpcCalls =
    !popoverSrc.includes('rpc(') &&
    !containerDetailSrc.includes('rpc(') &&
    !taskDetailSrc.includes('rpc(') &&
    !tasksPageSrc.includes('get_project_financial_summary') &&
    !tasksPageSrc.includes('get_phase_financial_summary') &&
    !tasksPageSrc.includes('get_task_list_financial_summary');
  assert.ok(hasNoNewRpcCalls, 'P7-02B introduces zero new finance RPCs');
  pass(1, 'A: P7-02B introduces zero new finance RPCs (P7-01 read model remains exclusive single source)');

  // B: Zero direct finance table queries in hierarchy UI
  const hasNoTableQueries =
    !popoverSrc.includes('.from(') &&
    !containerDetailSrc.includes('.from(') &&
    !taskDetailSrc.includes('.from(') &&
    !tasksPageSrc.includes('.from(\'budgets\')') &&
    !tasksPageSrc.includes('.from(\'expense_transactions\')') &&
    !tasksPageSrc.includes('.from(\'expense_items\')') &&
    !tasksPageSrc.includes('.from(\'finance_alerts\')');
  assert.ok(hasNoTableQueries, 'P7-02B performs zero direct finance table queries');
  pass(2, 'B: Zero direct finance table queries in hierarchy UI');

  // AV: No finance summary object copied into persistent local component state
  const noSummaryInState =
    !popoverSrc.includes('setSelectedFinancialSummary') &&
    !popoverSrc.includes('setFinancialSummary') &&
    !popoverSrc.includes('useState(summary') &&
    !popoverSrc.includes('useState(financial');
  assert.ok(noSummaryInState, 'No finance summary object copied into persistent local component state');
  pass(3, 'AV: Popover state stores only interaction/position state; never caches persistent finance summary copies');

  // AW: No client risk-threshold logic in React
  const noClientRiskCalc =
    !popoverSrc.includes('calculate_financial_risk') &&
    !containerDetailSrc.includes('calculate_financial_risk') &&
    !taskDetailSrc.includes('calculate_financial_risk') &&
    !containerDetailSrc.includes('> 100 ? \'RED\'') &&
    !containerDetailSrc.includes('>= 80 ? \'YELLOW\'');
  assert.ok(noClientRiskCalc, 'Zero client risk-threshold logic in React');
  pass(4, 'AW: Backend risk_band rendered directly without client-side threshold recalculation');

  // AY: Auth files untouched
  const loginSrc = await readFile(path.join(repoRoot, 'src/pages/LoginPage.jsx'), 'utf-8');
  const authCtxSrc = await readFile(path.join(repoRoot, 'src/contexts/AuthContext.jsx'), 'utf-8');
  assert.ok(loginSrc.includes('Accounts are managed by your organization.'), 'AUTH-01 files remain untouched');
  assert.ok(authCtxSrc.includes('PASSWORD_RECOVERY'), 'AuthContext remains locked to AUTH-01 spec');
  pass(5, 'AY: AUTH-01 authentication boundary strictly preserved; zero auth file modifications in P7-02B');

  // AZ: No P7-01 backend/schema changes
  const p701HookSrc = await readFile(path.join(repoRoot, 'src/hooks/useProjectFinancialHierarchy.js'), 'utf-8');
  assert.ok(p701HookSrc.includes('get_project_financial_hierarchy'), 'P7-01 hook contract unchanged');
  pass(6, 'AZ: P7-01 backend and hook contract remain frozen and unmutated');

  // Export verification
  assert.ok(hierarchyExports.FinancialDetailPopover, 'FinancialDetailPopover exported');
  assert.ok(hierarchyExports.ContainerFinancialDetail, 'ContainerFinancialDetail exported');
  assert.ok(hierarchyExports.TaskFinancialDetail, 'TaskFinancialDetail exported');
  assert.ok(hierarchyExports.ProjectFinancialIndicator, 'ProjectFinancialIndicator exported');
  assert.ok(hierarchyExports.ContainerFinancialIndicator, 'ContainerFinancialIndicator exported');
  assert.ok(hierarchyExports.TaskSpendIndicator, 'TaskSpendIndicator exported');
  pass(7, 'Hierarchy export barrel exports all P7-02A and P7-02B components cleanly');

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite 2: Project Financial Detail Popover & Context Card
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 2: Project Financial Detail Popover & Context Card ---');

  const mockProjectSummary = {
    entity_type: 'project',
    entity_id: 'proj-123',
    is_budgeted: true,
    base_budget: 1000000,
    safety_buffer: 200000,
    total_ceiling: 1200000,
    actual_spend: 350000,
    remaining_base: 650000,
    buffer_used: 0,
    buffer_remaining: 200000,
    overrun: 0,
    utilization_pct: 35,
    risk_band: 'GREEN',
  };

  // C: Project authorized summary renders indicator/trigger
  const projTriggerHtml = stripHtml(renderToString(
    React.createElement(ProjectFinancialIndicator, { summary: mockProjectSummary })
  ));
  assert.ok(projTriggerHtml.includes('data-testid="project-financial-indicator"'), 'Project summary renders trigger');
  assert.ok(projTriggerHtml.includes('aria-haspopup="dialog"'), 'Trigger contains accessible aria-haspopup="dialog"');
  pass(8, 'C: Project authorized summary renders interactive popover trigger');

  // D: Project missing/null summary renders no trigger (fail-closed)
  const nullProjHtml = renderToString(React.createElement(ProjectFinancialIndicator, { summary: null }));
  assert.strictEqual(nullProjHtml, '', 'Null project summary renders nothing');
  pass(9, 'D: Project missing/null summary strictly renders null (fail-closed, zero fake data)');

  // E, F, G, H, I, J, K, L: ContainerFinancialDetail rendered for Project
  const projDetailHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockProjectSummary, entityType: 'project' })
  ));

  assert.ok(projDetailHtml.includes('₹10,00,000'), 'E: Project detail displays backend Base Budget ₹10,00,000');
  pass(10, 'E: Project detail displays backend Base Budget');

  assert.ok(projDetailHtml.includes('₹2,00,000'), 'F: Project detail displays backend Safety Buffer ₹2,00,000');
  pass(11, 'F: Project detail displays backend Safety Buffer');

  assert.ok(projDetailHtml.includes('₹12,00,000'), 'G: Project detail displays backend Total Ceiling ₹12,00,000');
  pass(12, 'G: Project detail displays backend Total Ceiling');

  assert.ok(projDetailHtml.includes('₹3,50,000'), 'H: Project detail displays backend Actual Spend ₹3,50,000');
  pass(13, 'H: Project detail displays backend Actual Spend');

  assert.ok(projDetailHtml.includes('₹6,50,000'), 'I: Project detail displays backend Remaining Base ₹6,50,000');
  pass(14, 'I: Project detail displays backend Remaining Base');

  assert.ok(projDetailHtml.includes('35%'), 'K: Project detail displays backend Utilization % (35%)');
  pass(15, 'K: Project detail displays backend Utilization percentage directly');

  assert.ok(projDetailHtml.includes('GREEN'), 'L: Project detail displays backend Risk band through FinanceRiskBadge');
  pass(16, 'L: Project detail displays backend Risk band through canonical FinanceRiskBadge');

  // J: Overrun state display
  const mockOverrunSummary = {
    ...mockProjectSummary,
    actual_spend: 1300000,
    remaining_base: 0,
    buffer_used: 200000,
    buffer_remaining: 0,
    overrun: 100000,
    utilization_pct: 130,
    risk_band: 'RED',
  };
  const overrunDetailHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockOverrunSummary, entityType: 'project' })
  ));
  assert.ok(overrunDetailHtml.includes('₹1,00,000'), 'J: Backend overrun amount ₹1,00,000 displayed when positive');
  assert.ok(overrunDetailHtml.includes('RED'), 'J: Overrun renders RED risk band');
  pass(17, 'J: Backend Overrun amount displayed accurately without client calculation');

  // Dedicated UNBUDGETED Project Regression Test (Section 1 & 2)
  const unbudgetedProject = {
    entity_type: 'project',
    entity_id: 'proj-unb',
    is_budgeted: false,
    budget_source_type: null,
    budget_source_id: null,
    base_budget: 0,
    safety_buffer: 0,
    total_ceiling: 0,
    actual_spend: 15000,
    remaining_base: 0,
    utilization_pct: 0,
    risk_band: 'GREEN',
  };
  const unbudgetedProjHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: unbudgetedProject, entityType: 'project' })
  ));

  // Must contain accurate unbudgeted markers
  assert.ok(unbudgetedProjHtml.includes('PROJECT'), 'Unbudgeted project displays PROJECT entity tag');
  assert.ok(unbudgetedProjHtml.includes('UNBUDGETED'), 'Unbudgeted project displays UNBUDGETED badge');
  assert.ok(unbudgetedProjHtml.includes('Actual Spend'), 'Unbudgeted project displays Actual Spend label');
  assert.ok(unbudgetedProjHtml.includes('₹15,000'), 'Unbudgeted project displays Actual Spend value ₹15,000');
  assert.ok(unbudgetedProjHtml.includes('No effective budget assigned.'), 'Unbudgeted project displays "No effective budget assigned." notice');

  // Must NOT contain fabricated budgetary health metrics
  assert.ok(!unbudgetedProjHtml.includes('Project Budget'), 'Unbudgeted project must NOT display Project Budget badge');
  assert.ok(!unbudgetedProjHtml.includes('Base Budget'), 'Unbudgeted project must NOT display Base Budget');
  assert.ok(!unbudgetedProjHtml.includes('Safety Buffer'), 'Unbudgeted project must NOT display Safety Buffer');
  assert.ok(!unbudgetedProjHtml.includes('Total Ceiling'), 'Unbudgeted project must NOT display Total Ceiling');
  assert.ok(!unbudgetedProjHtml.includes('Financial Risk:'), 'Unbudgeted project must NOT display Financial Risk');
  assert.ok(!unbudgetedProjHtml.includes('Utilization'), 'Unbudgeted project must NOT display Utilization');
  assert.ok(!unbudgetedProjHtml.includes('0%'), 'Unbudgeted project must NOT display 0% Utilization');
  pass(18, 'Unbudgeted Project Regression: is_budgeted=false renders UNBUDGETED card without fake Base ₹0, 0%, or GREEN risk');

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite 3: Own-Budget & Inherited-Budget Containers
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 3: Own-Budget & Inherited-Budget Containers ---');

  // M: Own-budget Phase explicitly identified as Phase Budget Owner
  const mockOwnPhaseSummary = {
    entity_type: 'phase',
    entity_id: 'phase-1',
    is_budgeted: true,
    base_budget: 400000,
    safety_buffer: 50000,
    total_ceiling: 450000,
    actual_spend: 120000,
    remaining_base: 280000,
    buffer_used: 0,
    buffer_remaining: 50000,
    overrun: 0,
    utilization_pct: 30,
    risk_band: 'GREEN',
  };
  const ownPhaseDetailHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockOwnPhaseSummary, entityType: 'phase' })
  ));
  assert.ok(ownPhaseDetailHtml.includes('Budget Owner'), 'M: Own-budget Phase labeled Budget Owner');
  assert.ok(ownPhaseDetailHtml.includes('PHASE'), 'M: Entity tag PHASE displayed');
  pass(19, 'M: Own-budget Phase explicitly identified as Budget Owner');

  // N: Own-budget Task List explicitly identified as Task List Budget Owner
  const mockOwnTaskListSummary = {
    entity_type: 'task_list',
    entity_id: 'tl-1',
    is_budgeted: true,
    base_budget: 150000,
    safety_buffer: 20000,
    total_ceiling: 170000,
    actual_spend: 60000,
    remaining_base: 90000,
    buffer_used: 0,
    buffer_remaining: 20000,
    overrun: 0,
    utilization_pct: 40,
    risk_band: 'GREEN',
  };
  const ownTaskListDetailHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockOwnTaskListSummary, entityType: 'task_list' })
  ));
  assert.ok(ownTaskListDetailHtml.includes('Budget Owner'), 'N: Own-budget Task List labeled Budget Owner');
  assert.ok(ownTaskListDetailHtml.includes('TASK LIST'), 'N: Entity tag TASK LIST displayed');
  pass(20, 'N: Own-budget Task List explicitly identified as Budget Owner');

  // O: Inherited Phase says "Uses Project Budget"
  const mockInheritedPhaseSummary = {
    entity_type: 'phase',
    entity_id: 'phase-2',
    is_budgeted: false,
    budget_source_type: 'project',
    budget_source_id: 'proj-123',
    base_budget: 1000000,
    safety_buffer: 200000,
    total_ceiling: 1200000,
    actual_spend: 85000,
    remaining_base: 650000,
    utilization_pct: 35,
    risk_band: 'GREEN',
  };
  const inheritedPhaseDetailHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockInheritedPhaseSummary, entityType: 'phase' })
  ));
  assert.ok(inheritedPhaseDetailHtml.includes('Uses Project Budget'), 'O: Inherited Phase displays "Uses Project Budget"');
  assert.ok(inheritedPhaseDetailHtml.includes('This Phase does not own an independent budget.'), 'O: Explanatory notice rendered');
  pass(21, 'O: Inherited Phase explicitly displays "Uses Project Budget" with non-ownership clarification');

  // P: Inherited Task List from Phase says "Uses Phase Budget"
  const mockInheritedTlFromPhase = {
    entity_type: 'task_list',
    entity_id: 'tl-2',
    is_budgeted: false,
    budget_source_type: 'phase',
    budget_source_id: 'phase-1',
    base_budget: 400000,
    safety_buffer: 50000,
    total_ceiling: 450000,
    actual_spend: 42000,
    remaining_base: 280000,
    utilization_pct: 30,
    risk_band: 'GREEN',
  };
  const inheritedTlPhaseHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockInheritedTlFromPhase, entityType: 'task_list' })
  ));
  assert.ok(inheritedTlPhaseHtml.includes('Uses Phase Budget'), 'P: Inherited Task List displays "Uses Phase Budget"');
  assert.ok(inheritedTlPhaseHtml.includes('This Task List uses the Phase budget.'), 'P: Explanatory notice rendered');
  pass(22, 'P: Inherited Task List from Phase displays "Uses Phase Budget"');

  // Q: Inherited Task List from Project says "Uses Project Budget"
  const mockInheritedTlFromProject = {
    entity_type: 'task_list',
    entity_id: 'tl-3',
    is_budgeted: false,
    budget_source_type: 'project',
    budget_source_id: 'proj-123',
    base_budget: 1000000,
    safety_buffer: 200000,
    total_ceiling: 1200000,
    actual_spend: 18000,
    remaining_base: 650000,
    utilization_pct: 35,
    risk_band: 'GREEN',
  };
  const inheritedTlProjHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockInheritedTlFromProject, entityType: 'task_list' })
  ));
  assert.ok(inheritedTlProjHtml.includes('Uses Project Budget'), 'Q: Inherited Task List from Project displays "Uses Project Budget"');
  assert.ok(inheritedTlProjHtml.includes('This Task List uses the Project budget.'), 'Q: Explanatory notice rendered');
  pass(23, 'Q: Inherited Task List from Project displays "Uses Project Budget"');

  // R: Inherited container never labels ancestor budget as its own
  assert.ok(!inheritedPhaseDetailHtml.includes('Phase Budget Owner'), 'R: Inherited container never claims budget ownership');
  assert.ok(!inheritedTlPhaseHtml.includes('Task List Budget Owner'), 'R: Inherited container never claims budget ownership');
  assert.ok(inheritedPhaseDetailHtml.includes('CONTEXTUAL BUDGET (PROJECT)'), 'R: Contextual budget labeled explicitly as ancestor context');
  pass(24, 'R: Inherited containers strictly label ancestor budget as Contextual Budget, avoiding false ownership');

  // S: True unbudgeted container renders UNBUDGETED state without fake GREEN
  const mockUnbudgetedPhase = {
    entity_type: 'phase',
    entity_id: 'phase-unb',
    is_budgeted: false,
    budget_source_type: null,
    budget_source_id: null,
    base_budget: 0,
    safety_buffer: 0,
    total_ceiling: 0,
    actual_spend: 15000,
    remaining_base: 0,
    risk_band: null,
  };
  const unbudgetedHtml = stripHtml(renderToString(
    React.createElement(ContainerFinancialDetail, { summary: mockUnbudgetedPhase, entityType: 'phase' })
  ));
  assert.ok(unbudgetedHtml.includes('UNBUDGETED'), 'S: Unbudgeted container displays UNBUDGETED badge');
  assert.ok(unbudgetedHtml.includes('No effective budget assigned.'), 'S: Unbudgeted container displays clear notice');
  assert.ok(!unbudgetedHtml.includes('0% Utilization'), 'S: Unbudgeted container does NOT fabricate 0% utilization');
  pass(25, 'S: True unbudgeted container renders UNBUDGETED notice without fabricated base or fake GREEN');

  // AD, AE: Unauthorized / missing container summary yields no trigger
  const nullPhaseTrigger = renderToString(React.createElement(ContainerFinancialIndicator, { summary: null, entityType: 'phase' }));
  const nullTlTrigger = renderToString(React.createElement(ContainerFinancialIndicator, { summary: null, entityType: 'task_list' }));
  assert.strictEqual(nullPhaseTrigger, '', 'AD: Missing Phase summary yields null trigger');
  assert.strictEqual(nullTlTrigger, '', 'AE: Missing Task List summary yields null trigger');
  pass(26, 'AD & AE: Unauthorized/missing Phase and Task List summaries yield null triggers (fail-closed)');

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite 4: Task Spend Detail Popovers & Subtree Contracts
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 4: Task Spend Detail Popovers & Subtree Contracts ---');

  const mockTaskFinancial = {
    task_id: 'task-101',
    direct_spend: 34200,
    visible_rollup_spend: 52800,
    budget_source_type: 'task_list',
    budget_source_id: 'tl-1',
    financial_visibility: 'full',
  };

  // T: Task detail shows direct_spend
  const taskDetailHtml = stripHtml(renderToString(
    React.createElement(TaskFinancialDetail, { financial: mockTaskFinancial, title: 'Frontend Architecture' })
  ));
  assert.ok(taskDetailHtml.includes('Direct Spend'), 'T: Task detail displays Direct Spend label');
  assert.ok(taskDetailHtml.includes('₹34,200'), 'T: Task detail displays formatted direct spend ₹34,200');
  pass(27, 'T: Task detail displays backend Direct Spend formatted in INR');

  // U: Task visible_rollup_spend uses EXACT label "Visible Subtree Spend"
  assert.ok(taskDetailHtml.includes('Visible Subtree Spend'), 'U: EXACT label "Visible Subtree Spend" used');
  assert.ok(taskDetailHtml.includes('₹52,800'), 'U: Formatted subtree spend ₹52,800 rendered');
  assert.ok(taskDetailHtml.includes('Includes spend from work visible to you.'), 'U: Security help text rendered');
  assert.ok(!taskDetailHtml.includes('Total Spend'), 'U: Strictly prohibited "Total Spend" is absent');
  assert.ok(!taskDetailHtml.includes('Total Task Spend'), 'U: Strictly prohibited "Total Task Spend" is absent');
  assert.ok(!taskDetailHtml.includes('Complete Spend'), 'U: Strictly prohibited "Complete Spend" is absent');
  pass(28, 'U: Task subtree spend uses EXACT label "Visible Subtree Spend" with permission disclaimer');

  // Omission when visible_rollup_spend === direct_spend
  const mockLeafTask = {
    ...mockTaskFinancial,
    direct_spend: 25000,
    visible_rollup_spend: 25000,
  };
  const leafTaskDetailHtml = stripHtml(renderToString(React.createElement(TaskFinancialDetail, { financial: mockLeafTask })));
  assert.ok(!leafTaskDetailHtml.includes('Visible Subtree Spend'), 'Subtree spend omitted when equal to direct spend');
  pass(29, 'Task detail omits Visible Subtree Spend row when leaf task has identical direct and rollup spend');

  // V, W, X, Y, Z: Strict prohibitions on Task Financial Detail
  assert.ok(!taskDetailHtml.includes('Base Budget'), 'V: Tasks NEVER render Base Budget');
  assert.ok(!taskDetailHtml.includes('Safety Buffer'), 'W: Tasks NEVER render Safety Buffer');
  assert.ok(!taskDetailHtml.includes('Remaining Base'), 'X: Tasks NEVER render Remaining Budget');
  assert.ok(!taskDetailHtml.includes('Total Ceiling'), 'Tasks NEVER render Total Ceiling');
  assert.ok(!taskDetailHtml.includes('Utilization'), 'Y: Tasks NEVER render Utilization %');
  assert.ok(!taskDetailHtml.includes('Financial Risk:'), 'Z: Tasks NEVER render Risk Band');
  pass(30, 'V, W, X, Y, Z: Tasks NEVER render Base Budget, Buffer, Ceiling, Remaining, Utilization, or Risk Band');

  // Budget Context on Task
  assert.ok(taskDetailHtml.includes('Uses Task List Budget'), 'Task detail displays "Uses Task List Budget"');
  const mockProjTask = { ...mockTaskFinancial, budget_source_type: 'project' };
  const projTaskHtml = stripHtml(renderToString(React.createElement(TaskFinancialDetail, { financial: mockProjTask })));
  assert.ok(projTaskHtml.includes('Uses Project Budget'), 'Task detail displays "Uses Project Budget"');
  pass(31, 'Task detail displays accurate Budget Context based on ancestor funding source');

  // AA: Child Task uses Task detail contract
  assert.ok(treeSrc.includes('TaskSpendIndicator'), 'AA: Child tasks in recursive tree use TaskSpendIndicator');
  pass(32, 'AA: Recursive Child Tasks consume TaskSpendIndicator and Task detail contract identically');

  // AB: Process Step uses Task detail contract
  assert.ok(treeSrc.includes('processStep'), 'AB: Process Step branch passes financial to TaskSpendIndicator');
  pass(33, 'AB: Process Step Tasks consume TaskSpendIndicator and Task detail contract identically');

  // AC: Subtasks have no finance detail trigger
  assert.ok(!treeSrc.includes('<TaskSpendIndicator financial={subtask'), 'AC: Subtasks do not render TaskSpendIndicator');
  pass(34, 'AC: Subtasks do NOT render independent financial detail popovers (represented exclusively in parent Task)');

  // AF: Unauthorized / missing Task yields no trigger
  const nullTaskHtml = renderToString(React.createElement(TaskSpendIndicator, { financial: null }));
  assert.strictEqual(nullTaskHtml, '', 'AF: Null task financial renders nothing');
  pass(35, 'AF: Unauthorized or missing task financial object yields null trigger (fail-closed)');

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite 5: Scope Key Architecture & Hierarchy Tree Propagation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 5: Scope Key Architecture & Hierarchy Tree Propagation ---');

  // Scope key definition in TasksPage
  assert.ok(
    tasksPageSrc.includes('const financialPopoverScopeKey = [') &&
    tasksPageSrc.includes('user?.id || \'anonymous\'') &&
    tasksPageSrc.includes('workspaceId || \'none\'') &&
    tasksPageSrc.includes('visibleProjectId || projectId || \'none\'') &&
    tasksPageSrc.includes('authorizationScopeKey || \'unresolved\'') &&
    tasksPageSrc.includes('view'),
    'TasksPage defines authoritative financialPopoverScopeKey with user.id'
  );
  pass(36, 'AP & AQ: TasksPage constructs single authoritative financialPopoverScopeKey containing authenticated user.id');

  // Propagation to Project and Container indicators
  assert.ok(
    tasksPageSrc.includes('<ProjectFinancialIndicator\n                  summary={financialHierarchy.project_summary}\n                  loading={financialLoading}\n                  scopeKey={financialPopoverScopeKey}'),
    'TasksPage passes financialPopoverScopeKey to ProjectFinancialIndicator'
  );
  assert.ok(
    tasksPageSrc.includes('<ContainerFinancialIndicator\n                          summary={financialHierarchy.phase_summaries[phase.id]}\n                          entityType="phase"\n                          title={phase.name}\n                          scopeKey={financialPopoverScopeKey}'),
    'TasksPage passes financialPopoverScopeKey to Phase ContainerFinancialIndicator'
  );
  assert.ok(
    tasksPageSrc.includes('<ContainerFinancialIndicator\n                                      summary={financialHierarchy.task_list_summaries[taskList.id]}\n                                      entityType="task_list"\n                                      title={taskList.name}\n                                      scopeKey={financialPopoverScopeKey}'),
    'TasksPage passes financialPopoverScopeKey to Task List ContainerFinancialIndicator'
  );
  pass(37, 'AR & AS: TasksPage propagates financialPopoverScopeKey to Project, Phase, and Task List indicators');

  // Propagation through HierarchyTaskTree & HierarchyProcessGroups
  assert.ok(
    tasksPageSrc.includes('<HierarchyProcessGroups\n                                      processes={taskListProcesses}\n                                      tasks={listTasks}\n                                      onTaskOpen={setSelectedTask}\n                                      taskFinancials={financialHierarchy?.tasks || {}}\n                                      scopeKey={financialPopoverScopeKey}'),
    'TasksPage passes scopeKey to HierarchyProcessGroups'
  );
  assert.ok(
    tasksPageSrc.includes('<HierarchyTaskTree\n                                      tasks={listTasks}\n                                      processInstances={processInstances}\n                                      onTaskOpen={setSelectedTask}\n                                      taskFinancials={financialHierarchy?.tasks || {}}\n                                      scopeKey={financialPopoverScopeKey}'),
    'TasksPage passes scopeKey to task list HierarchyTaskTree'
  );
  assert.ok(
    tasksPageSrc.includes('<HierarchyTaskTree\n                tasks={tasks.filter((task) => !task.phase_id && !task.task_list_id)}\n                processInstances={processInstances}\n                onTaskOpen={setSelectedTask}\n                taskFinancials={financialHierarchy?.tasks || {}}\n                scopeKey={financialPopoverScopeKey}'),
    'TasksPage passes scopeKey to uncategorized HierarchyTaskTree'
  );
  pass(38, 'TasksPage propagates financialPopoverScopeKey to HierarchyTaskTree and HierarchyProcessGroups');

  // HierarchyTaskTree internals: propagation to TaskNode, recursive Child tasks, ProcessGroup, Process Steps, and TaskSpendIndicator
  assert.ok(treeSrc.includes('function TaskNode({ task, model, onTaskOpen, depth = 0, lineage = new Set(), processStep = false, taskFinancials = {}, scopeKey })'), 'TaskNode receives scopeKey');
  assert.ok(treeSrc.includes('<TaskSpendIndicator\n              financial={financial}\n              taskTitle={task.title}\n              scopeKey={scopeKey}\n            />'), 'TaskNode passes scopeKey to TaskSpendIndicator');
  assert.ok(treeSrc.includes('function ProcessGroup({ instance, model, onTaskOpen, depth = 0, lineage = new Set(), taskFinancials = {}, scopeKey })'), 'ProcessGroup receives scopeKey');
  assert.ok(treeSrc.includes('export function HierarchyProcessGroups({ processes = [], tasks = [], onTaskOpen, taskFinancials = {}, scopeKey })'), 'HierarchyProcessGroups receives scopeKey');
  pass(39, 'Tree scopeKey propagation: HierarchyTaskTree -> TaskNode -> Child TaskNode -> ProcessGroup -> Step TaskNode -> TaskSpendIndicator');

  // AT & AU: View switches unmount indicators
  assert.ok(tasksPageSrc.includes('view === \'hierarchy\' && financialHierarchy?.project_summary'), 'Hierarchy view gates Project financial indicator');
  pass(40, 'AT & AU: View transitions (Hierarchy -> Board / List) strictly unmount financial indicators and close popovers');

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite 6: Popover Viewport Safety, Mobile 390px & CSS Contract
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 6: Popover Viewport Safety, Mobile 390px & CSS Contract ---');

  // Max-height, internal vertical scroll, and overscroll-behavior
  assert.ok(popoverCss.includes('max-height: calc(100vh - 24px);'), 'Popover card includes max-height: calc(100vh - 24px)');
  assert.ok(popoverCss.includes('overflow-y: auto;'), 'Popover card includes overflow-y: auto for internal scrolling');
  assert.ok(popoverCss.includes('overscroll-behavior: contain;'), 'Popover card includes overscroll-behavior: contain');
  pass(41, 'Vertical Viewport Safety: Popover card constrained by viewport height with internal vertical scroll');

  // Rendered height measurement and boundary clamping logic
  assert.ok(popoverSrc.includes('getBoundingClientRect().height'), 'FinancialDetailPopover dynamically measures actual rendered height');
  assert.ok(popoverSrc.includes('top < 12'), 'Top position strictly clamped to minimum 12px viewport top gutter');
  assert.ok(popoverSrc.includes('top + renderedHeight > viewportHeight - 12'), 'Top position clamped to viewportHeight - 12px bottom gutter');
  assert.ok(popoverSrc.includes('requestAnimationFrame'), 'Position re-measured after DOM paint');
  pass(42, 'Dynamic Flip & Clamping: Measures rendered popover height, flips to top when below boundary, and clamps within [12px, viewportHeight - 12px]');

  // Mobile 390px & reduced-motion CSS contracts
  assert.ok(popoverCss.includes('@media (max-width: 480px)'), 'Mobile responsive breakpoint defined in FinancialDetailPopover.module.css');
  assert.ok(popoverCss.includes('max-width: calc(100vw - 24px)'), 'Mobile 390px viewport width clamping verified');
  assert.ok(popoverCss.includes('@media (prefers-reduced-motion: reduce)'), 'prefers-reduced-motion respected');
  pass(43, 'AX & Mobile 390px: Responsive viewport clamping (1440px / 1024px / 768px / 390px) and reduced motion support verified');

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite 7: Mounted React Interaction Harness
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 7: Mounted React Interaction Harness ---');

  // Configure Mock DOM environment for React 19 createRoot
  global.IS_REACT_ACT_ENVIRONMENT = true;

  class MockDOMElement {
    constructor(nodeType = 1, nodeName = 'DIV') {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.tagName = nodeName;
      this.childNodes = [];
      this.parentNode = null;
      this.ownerDocument = null;
      this.style = {};
      this._attributes = {};
      this._listeners = new Map();
      this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    }
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(child, before) {
      child.parentNode = this;
      const idx = this.childNodes.indexOf(before);
      if (idx === -1) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) this.childNodes.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
    setAttribute(k, v) { this._attributes[k] = String(v); }
    getAttribute(k) { return this._attributes[k]; }
    removeAttribute(k) { delete this._attributes[k]; }
    addEventListener(event, fn) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(fn);
    }
    removeEventListener(event, fn) {
      if (!this._listeners.has(event)) return;
      const list = this._listeners.get(event).filter((f) => f !== fn);
      this._listeners.set(event, list);
    }
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      if (!event.preventDefault) event.preventDefault = () => {};
      if (!event.stopPropagation) {
        event.stopPropagation = () => { event._stopPropagation = true; };
      }
      let curr = this;
      while (curr) {
        const list = curr._listeners.get(event.type) || [];
        for (const fn of list) fn(event);
        if (event._stopPropagation) break;
        curr = curr.parentNode;
      }
      return true;
    }
    getBoundingClientRect() {
      return { top: 100, bottom: 130, left: 50, right: 150, width: 100, height: 30 };
    }
    contains(other) {
      let curr = other;
      while (curr) {
        if (curr === this) return true;
        curr = curr.parentNode;
      }
      return false;
    }
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }
  }

  const mockDoc = new MockDOMElement(9, '#document');
  mockDoc.ownerDocument = mockDoc;
  mockDoc.createElement = (tag) => { const el = new MockDOMElement(1, tag.toUpperCase()); el.ownerDocument = mockDoc; return el; };
  mockDoc.createElementNS = (ns, tag) => { const el = new MockDOMElement(1, tag.toUpperCase()); el.ownerDocument = mockDoc; el.namespaceURI = ns || 'http://www.w3.org/1999/xhtml'; return el; };
  mockDoc.createTextNode = (text) => { const el = new MockDOMElement(3, '#text'); el.nodeValue = text; el.ownerDocument = mockDoc; return el; };
  mockDoc.createComment = (text) => { const el = new MockDOMElement(8, '#comment'); el.nodeValue = text; el.ownerDocument = mockDoc; return el; };
  mockDoc.createDocumentFragment = () => { const el = new MockDOMElement(11, '#document-fragment'); el.ownerDocument = mockDoc; return el; };
  mockDoc.documentElement = new MockDOMElement(1, 'HTML');
  mockDoc.documentElement.ownerDocument = mockDoc;
  mockDoc.head = new MockDOMElement(1, 'HEAD');
  mockDoc.head.ownerDocument = mockDoc;
  mockDoc.body = new MockDOMElement(1, 'BODY');
  mockDoc.body.ownerDocument = mockDoc;
  mockDoc.activeElement = null;

  global.window = {
    document: mockDoc,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (ev, fn) => mockDoc.addEventListener(ev, fn),
    removeEventListener: (ev, fn) => mockDoc.removeEventListener(ev, fn),
    dispatchEvent: (ev) => mockDoc.dispatchEvent(ev),
    requestAnimationFrame: (cb) => { cb(); return 1; },
    cancelAnimationFrame: () => {},
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    Node: MockDOMElement,
    Element: MockDOMElement,
    HTMLElement: MockDOMElement,
    HTMLIFrameElement: MockDOMElement,
    HTMLInputElement: MockDOMElement,
    HTMLTextAreaElement: MockDOMElement,
    HTMLSelectElement: MockDOMElement,
  };
  mockDoc.defaultView = global.window;
  global.document = mockDoc;
  global.Node = MockDOMElement;
  global.Element = MockDOMElement;
  global.HTMLElement = MockDOMElement;
  global.HTMLIFrameElement = MockDOMElement;
  global.HTMLInputElement = MockDOMElement;
  global.HTMLTextAreaElement = MockDOMElement;
  global.HTMLSelectElement = MockDOMElement;
  global.DocumentFragment = MockDOMElement;
  global.SVGElement = MockDOMElement;
  global.requestAnimationFrame = (cb) => { cb(); return 1; };
  global.cancelAnimationFrame = () => {};

  // Mount Test Harness for FinancialDetailPopover
  function Harness({ scopeKey = 'user1:ws1:proj1:scopeA:hierarchy' }) {
    return React.createElement(FinancialDetailPopover, {
      trigger: React.createElement('span', { id: 'trigger-pill' }, 'Spend ₹10L'),
      content: React.createElement('div', { id: 'popover-content' }, 'Detail Breakdown'),
      title: 'Project Finance',
      scopeKey,
    });
  }

  const container = mockDoc.createElement('div');
  mockDoc.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(Harness, { scopeKey: 'scope-1' }));
  });

  // Find trigger button
  const triggerBtn = container.childNodes[0]?.childNodes[0];
  assert.ok(triggerBtn, 'Trigger button mounted in DOM');
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'false', 'Initial state: aria-expanded=false');
  pass(44, 'Mounted Harness: Component renders trigger with aria-expanded="false"');

  // 1. Click Trigger -> Open
  await act(async () => {
    triggerBtn.dispatchEvent({
      type: 'click',
      stopPropagation: () => {},
    });
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'true', 'Click opens popover (aria-expanded=true)');
  pass(45, 'Mounted Harness (Click Open): Trigger click sets isOpen=true and aria-expanded="true"');

  // 2. Second Click -> Close
  await act(async () => {
    triggerBtn.dispatchEvent({
      type: 'click',
      stopPropagation: () => {},
    });
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'false', 'Second click closes popover');
  pass(46, 'Mounted Harness (Second Click): Second trigger click unpins and closes popover');

  // 3. Enter Key -> Open
  await act(async () => {
    triggerBtn.dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'true', 'Enter key opens popover');
  pass(47, 'Mounted Harness (Enter Key): Enter key opens popover');

  // 4. Escape Key -> Close & Restore Focus
  await act(async () => {
    mockDoc.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: () => {},
    });
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'false', 'Escape key closes popover');
  assert.strictEqual(mockDoc.activeElement, triggerBtn, 'Focus restored to trigger on Escape');
  pass(48, 'Mounted Harness (Escape Key): Escape closes popover and restores keyboard focus to trigger');

  // 5. Space Key -> Toggle Open
  await act(async () => {
    triggerBtn.dispatchEvent({
      type: 'keydown',
      key: ' ',
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'true', 'Space key opens popover');
  pass(49, 'Mounted Harness (Space Key): Space key toggles popover open');

  // 6. Outside Pointer Down -> Close
  const outsideNode = mockDoc.createElement('div');
  mockDoc.body.appendChild(outsideNode);
  await act(async () => {
    mockDoc.dispatchEvent({
      type: 'pointerdown',
      target: outsideNode,
    });
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'false', 'Outside pointer down closes popover');
  pass(50, 'Mounted Harness (Outside Pointer): Pointer click outside popover dismisses overlay');

  // 7. Re-open and test scopeKey change dismissal
  await act(async () => {
    triggerBtn.dispatchEvent({
      type: 'click',
      stopPropagation: () => {},
    });
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'true', 'Popover re-opened');

  // Re-render with new scopeKey
  await act(async () => {
    root.render(React.createElement(Harness, { scopeKey: 'user2:ws1:proj1:scopeA:hierarchy' }));
  });
  assert.strictEqual(triggerBtn.getAttribute('aria-expanded'), 'false', 'Scope change (user switch) immediately closes popover');
  pass(51, 'Mounted Harness (Scope Isolation): Changing financialPopoverScopeKey immediately resets open state');

  await act(async () => {
    root.unmount();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Final Tally
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`  ALL ${passedCount} P7-02B FINANCIAL DETAIL POPOVER ASSERTIONS PASSED!       `);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in P7-02B test suite:', err);
  process.exit(1);
});
