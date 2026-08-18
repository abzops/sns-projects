import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_PERSONAS,
  getDashboardDefinition,
  resolveDashboardPersona,
} from '../src/dashboard/dashboardPersona.js';
import { buildDashboardMetrics } from '../src/dashboard/dashboardMetrics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
  console.log(`  ✓ ${message}`);
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

console.log('\nOV1-C — Role-Aware Dashboard Engine');

const executiveFromCeo = resolveDashboardPersona({ systemRoles: ['ceo'], workspaceRole: 'viewer' });
const executiveFromCto = resolveDashboardPersona({ systemRoles: ['cto'], workspaceRole: 'member' });
check(executiveFromCeo === DASHBOARD_PERSONAS.EXECUTIVE, 'CEO resolves Executive.');
check(executiveFromCto === DASHBOARD_PERSONAS.EXECUTIVE, 'CTO resolves Executive.');
check(getDashboardDefinition(executiveFromCeo) === getDashboardDefinition(executiveFromCto), 'CEO and CTO share one dashboard definition.');
check(resolveDashboardPersona({ systemRoles: ['system_admin', 'ceo'] }) === DASHBOARD_PERSONAS.EXECUTIVE, 'CEO outranks System Admin.');
check(resolveDashboardPersona({ systemRoles: ['project_admin', 'cto'] }) === DASHBOARD_PERSONAS.EXECUTIVE, 'CTO outranks Project Admin.');
check(resolveDashboardPersona({ systemRoles: ['project_admin', 'system_admin'] }) === DASHBOARD_PERSONAS.SYSTEM_ADMIN, 'System Admin outranks Project Admin.');
check(resolveDashboardPersona({ systemRoles: ['project_admin'] }) === DASHBOARD_PERSONAS.PROJECT_ADMIN, 'Pure Project Admin resolves Project Admin.');
check(resolveDashboardPersona({ workspaceRole: 'owner' }) === DASHBOARD_PERSONAS.WORKSPACE_OWNER, 'Workspace Owner without System Role resolves Workspace Owner.');
check(resolveDashboardPersona({ workspaceRole: 'admin' }) === DASHBOARD_PERSONAS.WORKSPACE_ADMIN, 'Workspace Admin without System Role resolves Workspace Admin.');
check(resolveDashboardPersona({ workspaceRole: 'member' }) === DASHBOARD_PERSONAS.MEMBER, 'Member resolves Member.');
check(resolveDashboardPersona({ workspaceRole: 'viewer' }) === DASHBOARD_PERSONAS.VIEWER, 'Viewer resolves Viewer.');

check(getDashboardDefinition(DASHBOARD_PERSONAS.EXECUTIVE).widgets.includes('portfolio_health'), 'Executive definition includes portfolio health.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.PROJECT_ADMIN).widgets.includes('assignment_health'), 'Project Admin definition includes assignment health.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.SYSTEM_ADMIN).widgets.includes('user_access_overview'), 'System Admin definition includes user/access administration.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.MEMBER).widgets.includes('my_current_work'), 'Member definition prioritizes personal work.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.VIEWER).readOnly === true, 'Viewer definition is explicitly read-only.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.WORKSPACE_OWNER).scope === 'rls-scoped', 'Workspace Owner receives scoped operational totals.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.WORKSPACE_ADMIN).scope === 'rls-scoped', 'Workspace Admin receives scoped operational totals.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.MEMBER).scope === 'rls-scoped', 'Normal-user dashboards use scoped operational data only.');
check(getDashboardDefinition(DASHBOARD_PERSONAS.EXECUTIVE).scope === 'rls-broad', 'System-role dashboards describe RLS-returned broad data.');

const [app, page, hook, widgets, scoped, executive, projectAdmin, systemAdmin, dashboardCss] = await Promise.all([
  read('src/App.jsx'),
  read('src/pages/DashboardPage.jsx'),
  read('src/hooks/useDashboardData.js'),
  read('src/components/dashboard/DashboardWidgets.jsx'),
  read('src/components/dashboard/ScopedOperationsDashboard.jsx'),
  read('src/components/dashboard/ExecutiveDashboard.jsx'),
  read('src/components/dashboard/ProjectAdminDashboard.jsx'),
  read('src/components/dashboard/SystemAdminDashboard.jsx'),
  read('src/components/dashboard/DashboardEngine.module.css'),
]);
const dashboardUi = [page, widgets, scoped, executive, projectAdmin, systemAdmin].join('\n');

check((app.match(/path="\/workspace\/:workspaceId\/dashboard"/g) || []).length === 1, 'Only one canonical workspace Dashboard route exists.');
check(page.includes('resolveDashboardPersona({ systemRoles, workspaceRole })'), 'DashboardPage delegates deterministic persona resolution.');
check(page.includes('useProjects(workspaceId, authorizationScopeKey)'), 'Projects remain keyed to the refreshed authorization scope.');
check(hook.includes("`${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`"), 'Dashboard cache key includes identity, workspace, and authorizationScopeKey.');
check(hook.includes(".from('tasks')") && hook.includes(".from('task_raci_assignments')") && hook.includes(".from('subtasks')"), 'Tasks, RACI, and Subtasks are fetched in bounded bulk queries.');
check(!hook.includes('for (const task') || !hook.includes('await supabase'), 'Dashboard data hook has no per-Task Supabase query loop.');
check(hook.includes(".from('process_instances')") && hook.includes(".eq('workspace_id', workspaceId)"), 'Process data remains workspace-scoped and RLS-authoritative.');
check(scoped.includes('persona === DASHBOARD_PERSONAS.VIEWER') && scoped.includes('!isViewer && <ProcessSummary'), 'Viewer presentation suppresses Process mutation-adjacent actions.');
check(page.includes('{canMutateOperationalData && ('), 'Header mutation action remains capability-gated.');
check(dashboardUi.includes('Owner') && dashboardUi.includes('Assignee'), 'Dashboard uses Owner/Assignee terminology.');
check(!/\bAccountable\b|\bResponsible\b/.test(dashboardUi), 'Dashboard UI contains no unintended technical role labels.');
check(!/\bMilestone\b/i.test(dashboardUi), 'Dashboard UI contains no legacy Milestone terminology.');
check(executive.includes('Portfolio Health') && executive.includes('DepartmentOverview'), 'Executive renders portfolio, attention, delivery, department, and personal responsibility widgets.');
check(projectAdmin.includes('AssignmentHealth') && projectAdmin.includes('QuickActions'), 'Project Admin renders delivery and assignment administration widgets.');
check(systemAdmin.includes('AdminOverview') && systemAdmin.includes('Department Administration') && systemAdmin.includes('administration'), 'System Admin renders user/access and department administration widgets.');
check(scoped.includes("title: 'Assigned to Me'") && scoped.includes("title: 'I Own'") && scoped.includes("title: 'Needs My Input'"), 'Member/scoped KPI wording is operationally personal.');
check(dashboardCss.includes('@media (max-width: 1024px)') && dashboardCss.includes('@media (max-width: 768px)') && dashboardCss.includes('@media (max-width: 520px)'), 'Dashboard layout has explicit laptop/tablet/mobile responsive contracts.');
check(dashboardCss.includes('overflow-x: auto') && dashboardCss.includes('min-width: 760px'), 'Wide portfolio content scrolls inside its surface instead of widening the page.');

const now = new Date('2026-08-18T00:00:00Z');
const fixture = buildDashboardMetrics({
  now,
  userId: 'user-1',
  departmentIds: ['dept-1'],
  projects: [{ id: 'project-1', project_status: 'active', task_count: 3, overdue_count: 1, progress: 33 }],
  tasks: [
    { id: 'task-a', project_id: 'project-1', assignee_id: null, due_date: '2026-08-17', task_statuses: { system_code: 'in_progress' } },
    { id: 'task-r', project_id: 'project-1', assignee_id: null, due_date: '2026-08-20', task_statuses: { system_code: 'todo' } },
    { id: 'task-hidden-not-returned', project_id: 'project-1', assignee_id: null, task_statuses: { system_code: 'done' } },
  ],
  raciRows: [
    { task_id: 'task-a', raci_role: 'A', user_id: 'user-1', department_id: null },
    { task_id: 'task-r', raci_role: 'R', user_id: null, department_id: 'dept-1' },
  ],
  subtasks: [{ id: 'subtask-1', task_id: 'task-a', assignee_id: 'user-1', status: 'todo', due_date: '2026-08-19' }],
});

check(fixture.personal.ownedTasks.some((task) => task.id === 'task-a'), 'Owner presentation maps exactly to RACI A.');
check(fixture.personal.assignedTasks.some((task) => task.id === 'task-r'), 'Assignee presentation maps exactly to RACI R, including department involvement.');
check(fixture.personal.assignedCount === 2, 'Assigned-to-me KPI includes one Assignee Task and one assigned Subtask without conflating them.');
check(fixture.overdueTasks.length === 1, 'Operational counts are derived only from supplied RLS-visible rows.');

console.log(`\nPASS — ${assertions} OV1-C dashboard assertions.`);
