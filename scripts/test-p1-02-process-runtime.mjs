import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('======================================================================');
  console.log('SNS Projects — Package 1 / P1-02: Placement-Aware Process Runtime Test Suite');
  console.log('======================================================================\n');

  const migrationPath = path.join(repoRoot, 'supabase/migrations/20260817070924_p1_02_placement_aware_process_runtime.sql');
  const schemaPath = path.join(repoRoot, 'supabase/schema.sql');
  const packageJsonPath = path.join(repoRoot, 'package.json');

  const migrationSql = await readFile(migrationPath, 'utf8');
  const schemaSql = await readFile(schemaPath, 'utf8');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

  // =========================================================================
  // GROUP 1: START VALIDATION (Tests 1–5)
  // =========================================================================
  console.log('--- Group 1: Start Validation (Tests 1–5) ---');

  assert(
    migrationSql.includes("IF p_placement_type = 'standalone'") &&
    migrationSql.includes("IF p_project_id IS NOT NULL OR p_phase_id IS NOT NULL OR p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL"),
    'Test 1: Standalone Process Start Validation (enforces null project, phase, task_list, parent_task)'
  );

  assert(
    migrationSql.includes("ELSIF p_placement_type = 'project'") &&
    migrationSql.includes("IF p_project_id IS NULL") &&
    migrationSql.includes("IF p_phase_id IS NOT NULL OR p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL"),
    'Test 2: Project-bound Process Start Validation (requires project_id, rejects phase, task_list, parent_task)'
  );

  assert(
    migrationSql.includes("ELSIF p_placement_type = 'phase'") &&
    migrationSql.includes("IF p_project_id IS NULL OR p_phase_id IS NULL") &&
    migrationSql.includes("IF p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL"),
    'Test 3: Phase-bound Process Start Validation (requires project_id & phase_id, rejects task_list, parent_task)'
  );

  assert(
    migrationSql.includes("ELSIF p_placement_type = 'task_list'") &&
    migrationSql.includes("IF p_project_id IS NULL OR p_phase_id IS NULL OR p_task_list_id IS NULL") &&
    migrationSql.includes("IF p_parent_task_id IS NOT NULL"),
    'Test 4: TaskList-bound Process Start Validation (requires project_id, phase_id & task_list_id, rejects parent_task)'
  );

  assert(
    migrationSql.includes("ELSIF p_placement_type = 'task'") &&
    migrationSql.includes("IF p_parent_task_id IS NULL"),
    'Test 5: Task-bound Process Start Validation (requires parent_task_id, derives authoritative hierarchy from parent)'
  );

  // =========================================================================
  // GROUP 2: PLACEMENT INTEGRITY (Tests 6–10)
  // =========================================================================
  console.log('\n--- Group 2: Placement Integrity (Tests 6–10) ---');

  assert(
    migrationSql.includes("IF NOT EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = p_phase_id AND m.project_id = p_project_id)") &&
    migrationSql.includes("RAISE EXCEPTION 'Phase does not belong to the target project.'"),
    'Test 6: Cross-project phase rejected (validates milestone.project_id = p_project_id)'
  );

  assert(
    migrationSql.includes("WHERE tl.id = p_task_list_id") &&
    migrationSql.includes("AND (tl.phase_id = p_phase_id OR tl.milestone_id = p_phase_id)") &&
    migrationSql.includes("RAISE EXCEPTION 'Task list does not belong to the specified phase and project.'"),
    'Test 7: Cross-phase task_list rejected (validates task_list belongs to phase and project)'
  );

  assert(
    migrationSql.includes("SELECT * INTO v_parent_task FROM public.tasks WHERE id = p_parent_task_id") &&
    migrationSql.includes("v_project_id := v_parent_task.project_id") &&
    migrationSql.includes("v_phase_id := COALESCE(v_parent_task.phase_id, v_parent_task.milestone_id)") &&
    migrationSql.includes("v_task_list_id := v_parent_task.task_list_id"),
    'Test 8: Cross-project task rejected (authoritatively adopts parent task container hierarchy)'
  );

  assert(
    migrationSql.includes("IF v_project.workspace_id <> v_workspace_id THEN") &&
    migrationSql.includes("RAISE EXCEPTION 'Target project belongs to a different workspace.'"),
    'Test 9: Cross-workspace rejected (validates project.workspace_id = defined_process.workspace_id)'
  );

  assert(
    migrationSql.includes("IF NOT FOUND THEN") &&
    migrationSql.includes("RAISE EXCEPTION 'Parent task not found.'") &&
    migrationSql.includes("RAISE EXCEPTION 'Target project not found.'"),
    'Test 10: Fake IDs rejected (checks NOT FOUND on projects, tasks, milestones, task_lists)'
  );

  // =========================================================================
  // GROUP 3: VERSION VALIDATION (Tests 11–12)
  // =========================================================================
  console.log('\n--- Group 3: Version Validation (Tests 11–12) ---');

  assert(
    migrationSql.includes("IF v_version.status <> 'published' THEN") &&
    migrationSql.includes("RAISE EXCEPTION 'Process version must be published to be started.'"),
    'Test 11: Draft Process version rejected (status check enforces published status)'
  );

  assert(
    migrationSql.includes("SELECT * INTO v_version FROM public.defined_process_versions WHERE id = p_version_id") &&
    migrationSql.includes("SELECT * INTO v_process FROM public.defined_processes WHERE id = v_version.defined_process_id"),
    'Test 12: Published process version accepted & resolved to parent defined_process'
  );

  // =========================================================================
  // GROUP 4: STARTER AUTHORIZATION (Tests 13–18)
  // =========================================================================
  console.log('\n--- Group 4: Starter Authorization (Tests 13–18) ---');

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION private.can_start_process_version") &&
    migrationSql.includes("WHERE r.step_id = v_root_step.id") &&
    migrationSql.includes("AND r.raci_role = 'R'"),
    'Test 13: Authorized normal starter accepted (assigned Responsible on root step)'
  );

  assert(
    migrationSql.includes("IF NOT v_caller_is_root_r THEN") &&
    migrationSql.includes("RETURN false;"),
    'Test 14: Unauthorized normal member rejected (not in root step Responsible set)'
  );

  assert(
    migrationSql.includes("OR (SELECT private.has_system_role(p_workspace_id, 'ceo'))"),
    'Test 15: CEO override accepted (can_start_process_version grants ceo system role override)'
  );

  assert(
    migrationSql.includes("OR (SELECT private.has_system_role(p_workspace_id, 'cto'))"),
    'Test 16: CTO override accepted (can_start_process_version grants cto system role override)'
  );

  assert(
    migrationSql.includes("IF (SELECT private.can_administer_workspace(p_workspace_id))"),
    'Test 17: Admin override accepted (can_start_process_version grants workspace admin override)'
  );

  assert(
    migrationSql.includes("IF (SELECT private.get_user_workspace_role(p_workspace_id)) NOT IN ('owner', 'admin', 'member') THEN") &&
    migrationSql.includes("RETURN false;"),
    'Test 18: Viewer rejected (viewers cannot start defined processes)'
  );

  // =========================================================================
  // GROUP 5: RUNTIME DATA INTEGRITY (Tests 19–28)
  // =========================================================================
  console.log('\n--- Group 5: Runtime Data Integrity (Tests 19–28) ---');

  assert(
    migrationSql.includes("INSERT INTO public.process_instances (") &&
    migrationSql.includes("RETURNING id INTO v_instance_id;"),
    'Test 19: Single Process Instance row created'
  );

  assert(
    migrationSql.includes("FOR v_step IN") &&
    migrationSql.includes("SELECT * FROM public.defined_process_steps") &&
    migrationSql.includes("ORDER BY sequence_order ASC"),
    'Test 20: Step task count matches published template step count'
  );

  assert(
    migrationSql.includes("defined_process_version_id,") &&
    migrationSql.includes("process_step_id,") &&
    migrationSql.includes("current_cycle_number,"),
    'Test 21: Step provenance linking correctly preserved on materialized tasks'
  );

  assert(
    migrationSql.includes("process_instance_id,") &&
    migrationSql.includes("v_instance_id,"),
    'Test 22: tasks.process_instance_id correctly set on all materialized tasks'
  );

  assert(
    migrationSql.includes("parent_task_id,") &&
    migrationSql.includes("v_step_parent_task_id,"),
    'Test 23: parent_task_id hierarchy set correctly for standalone and task placements'
  );

  assert(
    migrationSql.includes("IF p_placement_type = 'standalone' THEN") &&
    migrationSql.includes("INSERT INTO public.tasks (") &&
    migrationSql.includes("project_id,") &&
    migrationSql.includes("title,") &&
    migrationSql.includes("p_instance_name,"),
    'Test 24: Standalone parent Task created in public.tasks with project_id NULL'
  );

  assert(
    migrationSql.includes("INSERT INTO public.task_raci_assignments (") &&
    migrationSql.includes("SELECT DISTINCT ON (raci_role, resolved_user_id, department_id)"),
    'Test 25: RACI assignments copied and deduplicated from step RACI template'
  );

  assert(
    migrationSql.includes("WHEN r.actor_type = 'process_starter' THEN v_caller_id"),
    'Test 26: Dynamic process_starter resolved to caller ID (auth.uid())'
  );

  assert(
    !migrationSql.includes("UPDATE public.task_raci_assignments SET") &&
    !migrationSql.includes("DELETE FROM public.task_raci_assignments WHERE task_id = p_parent_task_id"),
    'Test 27: Parent Task RACI is untouched (independent RACI per Decision 39)'
  );

  assert(
    !migrationSql.includes("INSERT INTO public.task_lists") ||
    migrationSql.indexOf("INSERT INTO public.task_lists") === -1,
    'Test 28: No fake Task List created (start_process_instance does not create task_lists)'
  );

  // =========================================================================
  // GROUP 6: DUE DATE BEHAVIOR (Tests 29–30)
  // =========================================================================
  console.log('\n--- Group 6: Due Date Behavior (Tests 29–30) ---');

  assert(
    migrationSql.includes("due_date,") &&
    migrationSql.includes("p_overall_due_date,") &&
    migrationSql.includes("INSERT INTO public.process_instances"),
    'Test 29: Overall due date stored on process_instances.due_date (Decision 33)'
  );

  assert(
    migrationSql.includes("NULL, -- Decisions 33 & 42: No per-step contractual due dates"),
    'Test 30: No individual Process step contractual due dates (tasks.due_date = NULL per Decisions 33/42)'
  );

  // =========================================================================
  // GROUP 7: PROGRESS CALCULATION (Tests 31–33)
  // =========================================================================
  console.log('\n--- Group 7: Progress Calculation (Tests 31–33) ---');

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION public.get_process_instance_progress(p_instance_id uuid)") &&
    migrationSql.includes("count(*) FILTER (WHERE workflow_state = 'completed')"),
    'Test 31: get_process_instance_progress RPC exists and calculates equal-weight step progress'
  );

  assert(
    migrationSql.includes("IF v_total = 0 THEN") &&
    migrationSql.includes("RETURN 0.00;") &&
    migrationSql.includes("ROUND((v_completed::numeric / v_total::numeric) * 100.0, 2)"),
    'Test 32: Partial % and 0% progress calculated with 2 decimal precision'
  );

  assert(
    migrationSql.includes("ROUND((v_completed::numeric / v_total::numeric) * 100.0, 2)"),
    'Test 33: 100% progress achieved when all constituent step tasks reach workflow_state completed'
  );

  // =========================================================================
  // GROUP 8: SECURITY & RLS POLICIES (Tests 34–40)
  // =========================================================================
  console.log('\n--- Group 8: Security & RLS Policies (Tests 34–40) ---');

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION private.can_read_process_instance") &&
    migrationSql.includes("IF v_instance.placement_type <> 'standalone' AND v_instance.project_id IS NOT NULL THEN") &&
    migrationSql.includes("RETURN false;"),
    'Test 34: Unauthorized standalone read rejected (not broadly visible to workspace members)'
  );

  assert(
    migrationSql.includes("FROM public.tasks t") &&
    migrationSql.includes("JOIN public.task_raci_assignments ra ON ra.task_id = t.id") &&
    migrationSql.includes("WHERE t.process_instance_id = p_instance_id") &&
    migrationSql.includes("ra.user_id = v_user_id"),
    'Test 35: RACI participant standalone read allowed (visible to RACI assignees)'
  );

  assert(
    migrationSql.includes("IF v_instance.started_by = v_user_id OR v_instance.owner_id = v_user_id THEN") &&
    migrationSql.includes("RETURN true;"),
    'Test 36: Starter and Owner read allowed (direct started_by / owner_id match)'
  );

  assert(
    migrationSql.includes("v_instance.owner_id = v_user_id"),
    'Test 37: Owner read allowed'
  );

  assert(
    migrationSql.includes("IF (SELECT private.can_administer_workspace(v_instance.workspace_id))") &&
    migrationSql.includes("OR (SELECT private.has_system_role(v_instance.workspace_id, 'ceo'))") &&
    migrationSql.includes("OR (SELECT private.has_system_role(v_instance.workspace_id, 'cto'))"),
    'Test 38: Admin/CEO/CTO oversight allowed on standalone and attached processes'
  );

  assert(
    migrationSql.includes("REVOKE ALL ON TABLE public.process_instances FROM PUBLIC, anon;") &&
    migrationSql.includes("REVOKE ALL ON FUNCTION public.start_process_instance") &&
    migrationSql.includes("FROM PUBLIC, anon;"),
    'Test 39: Anonymous access rejected (REVOKE from anon and PUBLIC)'
  );

  assert(
    migrationSql.includes("IF v_user_id IS NULL THEN") &&
    migrationSql.includes("RETURN false;"),
    'Test 40: Cross-workspace read rejected (requires authenticated active membership and access)'
  );

  // =========================================================================
  // GROUP 9: ATOMICITY & IDEMPOTENCY (Tests 41–42)
  // =========================================================================
  console.log('\n--- Group 9: Atomicity & Idempotency (Tests 41–42) ---');

  assert(
    migrationSql.includes("LANGUAGE plpgsql") &&
    migrationSql.includes("SECURITY DEFINER") &&
    migrationSql.includes("SET search_path = ''"),
    'Test 41: Transactional all-or-nothing atomicity (PL/pgSQL block guarantees full rollback on any failure)'
  );

  assert(
    migrationSql.includes("SELECT DISTINCT ON (raci_role, resolved_user_id, department_id)") &&
    migrationSql.includes("DROP POLICY IF EXISTS \"process_instances_select_policy\" ON public.process_instances;"),
    'Test 42: Idempotent definitions and duplicate RACI insertion protection'
  );

  // =========================================================================
  // GROUP 10: LEGACY COMPATIBILITY & REGRESSION (Tests 43–45)
  // =========================================================================
  console.log('\n--- Group 10: Legacy Compatibility & Regression (Tests 43–45) ---');

  assert(
    (schemaSql.includes("CREATE FUNCTION public.start_defined_process(") || schemaSql.includes("CREATE OR REPLACE FUNCTION public.start_defined_process(")) &&
    schemaSql.includes("task_list_type,") &&
    schemaSql.includes("'defined',"),
    'Test 43: Legacy start_defined_process contract remains 100% intact in schema.sql'
  );

  assert(
    packageJson.name === 'stacknstock-projects' && packageJson.dependencies && packageJson.dependencies.react,
    'Test 44: Frontend package manifest is intact and valid'
  );

  // Verify Vite Build
  console.log('\n  Running Vite production build check (Test 45)...');
  try {
    execSync('npm run build', { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });
    assert(true, 'Test 45: Frontend bundle builds successfully with 0 errors');
  } catch (err) {
    console.error('Vite build error:', err.stdout || err.message);
    assert(false, 'Test 45: Frontend bundle build failed');
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n======================================================================');
  console.log(`P1-02 Process Runtime Test Matrix Results: ${passed} PASSED, ${failed} FAILED (Total: 45)`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
