import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(file, 'utf8');

const [
  context, appLayout, dashboard, projects, tasks, processAccess,
  migration, ownershipHotfix, schema,
] = await Promise.all([
  read('src/hooks/useUserContext.js'),
  read('src/components/AppLayout.jsx'),
  read('src/pages/DashboardPage.jsx'),
  read('src/pages/ProjectsPage.jsx'),
  read('src/pages/TasksPage.jsx'),
  read('src/utils/processVersionAccess.js'),
  read('supabase/migrations/20260818110545_ov1_a_operational_visibility_closure.sql'),
  read('supabase/migrations/20260818120101_ov1_a_project_ownership_bootstrap_hotfix.sql'),
  read('supabase/schema.sql'),
]);

assert.doesNotMatch(context, /const isAdmin\s*=/, 'Legacy conflated isAdmin flag is removed.');
assert.match(context, /const canAdministerWorkspace = isOwner \|\| isWorkspaceAdmin \|\| isSystemAdmin/);
assert.match(context, /const hasGlobalOperationalVisibility = hasSystemRole/);
assert.match(context, /const canMutateOperationalData =/);
assert.match(context, /const isReadOnly = !canMutateOperationalData/);
assert.match(appLayout, /canAdministerWorkspace/);
assert.match(dashboard, /hasGlobalOperationalVisibility/);
assert.match(projects, /const canCreate = canMutateOperationalData/);
assert.match(tasks, /canMutateOperationalData/);
assert.match(processAccess, /canAdministerWorkspace/);

for (const role of ['ceo', 'cto', 'project_admin', 'system_admin']) {
  assert.match(migration, new RegExp(`'${role}'`), `${role} remains a broad System Role.`);
}
assert.match(migration, /private\.can_view_operational_project\(id\)/);
assert.match(migration, /private\.can_view_operational_phase\(id\)/);
assert.match(migration, /private\.can_view_operational_task_list\(id\)/);
assert.match(migration, /private\.can_view_operational_task\(id\)/);
assert.match(migration, /private\.can_view_operational_subtask\(id\)/);
assert.doesNotMatch(
  migration,
  /projects_select_member[\s\S]{0,240}get_user_workspace_role\(workspace_id\) IS NOT NULL/,
  'Project SELECT policy no longer treats workspace membership as broad access.',
);
assert.match(schema, /OV1-A operational visibility closure \(canonical post-dump delta\)/);
assert.match(schema, /private\.can_view_operational_process_instance\(id\)/);
assert.match(ownershipHotfix, /projects_select_project_owner/);
assert.match(ownershipHotfix, /private\.has_owned_project_visibility\(project_id\)/);
assert.match(ownershipHotfix, /process_instances_select_project_owner/);
assert.match(schema, /OV1-A Project ownership\/bootstrap hotfix \(canonical post-dump delta\)/);

console.log('[PASS] OV1-A frontend capability separation and migration contract verified.');
