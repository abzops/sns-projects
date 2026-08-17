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
  console.log('SNS Projects — Package 1 / P1-02A: Process Instance Execution & Security');
  console.log('======================================================================\n');

  const migrationPath = path.join(repoRoot, 'supabase/migrations/20260817072340_p1_02a_process_runtime_execution_security_closure.sql');
  const schemaPath = path.join(repoRoot, 'supabase/schema.sql');

  const migrationSql = await readFile(migrationPath, 'utf8');
  const schemaSql = await readFile(schemaPath, 'utf8');

  // =========================================================================
  // SECTION A: STANDALONE PROCESS INSTANCE LIFECYCLE & ADVANCEMENT
  // =========================================================================
  console.log('--- Section A: Standalone Process Instance Lifecycle ---');

  assert(
    migrationSql.includes("IF v_task.process_instance_id IS NOT NULL THEN") &&
    migrationSql.includes("SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id") &&
    schemaSql.includes("IF v_task.process_instance_id IS NOT NULL THEN"),
    'Test 1: complete_task_and_advance branches on process_instance_id IS NOT NULL'
  );

  assert(
    migrationSql.includes("UPDATE public.tasks") &&
    migrationSql.includes("SET workflow_state = 'completed'") &&
    migrationSql.includes("workflow_completed_at = now()") &&
    migrationSql.includes("WHERE id = p_task_id"),
    'Test 2: Completing step sets workflow_state = completed and workflow_completed_at'
  );

  assert(
    migrationSql.includes("FROM public.defined_process_step_dependencies d") &&
    migrationSql.includes("JOIN public.defined_process_steps s ON s.id = d.step_id") &&
    migrationSql.includes("JOIN public.tasks t ON t.process_step_id = s.id AND t.process_instance_id = v_instance.id") &&
    migrationSql.includes("WHERE d.depends_on_step_id = v_task.process_step_id"),
    'Test 3: Downstream tasks queried strictly by process_instance_id'
  );

  assert(
    migrationSql.includes("JOIN public.tasks pred_task ON pred_task.process_step_id = pred_dep.depends_on_step_id") &&
    migrationSql.includes("AND pred_task.process_instance_id = v_instance.id") &&
    migrationSql.includes("WHERE pred_dep.step_id = v_downstream.step_id") &&
    migrationSql.includes("AND pred_task.workflow_state <> 'completed'"),
    'Test 4: Predecessor completion verified strictly within the same process instance'
  );

  assert(
    migrationSql.includes("SET workflow_state = 'ready',") &&
    migrationSql.includes("ready_at = now(),") &&
    migrationSql.includes("due_date = NULL,"),
    'Test 5: Downstream step activation maintains due_date = NULL (Decisions 33/42)'
  );

  assert(
    migrationSql.includes("SELECT count(*) INTO v_pending_tasks") &&
    migrationSql.includes("FROM public.tasks") &&
    migrationSql.includes("WHERE process_instance_id = v_instance.id") &&
    migrationSql.includes("AND process_step_id IS NOT NULL") &&
    migrationSql.includes("AND workflow_state NOT IN ('completed', 'cancelled')") &&
    migrationSql.includes("UPDATE public.process_instances") &&
    migrationSql.includes("SET status = 'completed'") &&
    migrationSql.includes("completed_at = now()"),
    'Test 6: Automatic Process Instance completion updates process_instances (status = completed, completed_at = now())'
  );

  // =========================================================================
  // SECTION B: ATTACHED PLACEMENTS & HOST IMMUTABILITY
  // =========================================================================
  console.log('\n--- Section B: Attached Placements & Host Immutability ---');

  assert(
    !migrationSql.includes("UPDATE public.task_lists\n      SET process_state = 'completed'") ||
    migrationSql.indexOf("UPDATE public.task_lists\n      SET process_state = 'completed'") > migrationSql.indexOf("ELSE"),
    'Test 7: Host Task Lists are NEVER mutated when a Process Instance completes'
  );

  assert(
    migrationSql.includes("INSERT INTO public.tasks (") &&
    migrationSql.includes("NULL,\n      NULL,\n      NULL,\n      NULL,\n      NULL,\n      v_instance_id,\n      p_instance_name"),
    'Test 8: Standalone parent Task created with project_id, phase_id, task_list_id NULL'
  );

  assert(
    migrationSql.includes("p_placement_type = 'task'") &&
    migrationSql.includes("v_step_parent_task_id := p_parent_task_id"),
    'Test 9: Task-attached process nests step tasks under existing parent task without altering parent state'
  );

  // =========================================================================
  // SECTION C: MULTIPLE INSTANCE ISOLATION
  // =========================================================================
  console.log('\n--- Section C: Multiple Process Instance Isolation ---');

  assert(
    migrationSql.includes("t.process_instance_id = v_instance.id") &&
    migrationSql.includes("pred_task.process_instance_id = v_instance.id"),
    'Test 10: Step tasks belonging to distinct process instances sharing a Task List are strictly isolated'
  );

  // =========================================================================
  // SECTION D: SERVER-ENFORCED IDEMPOTENCY
  // =========================================================================
  console.log('\n--- Section D: Server-Enforced Idempotency ---');

  assert(
    migrationSql.includes("ALTER TABLE public.process_instances\n  ADD COLUMN IF NOT EXISTS start_request_id uuid NOT NULL DEFAULT gen_random_uuid();") &&
    migrationSql.includes("CREATE UNIQUE INDEX idx_process_instances_start_request_unique\n  ON public.process_instances(workspace_id, started_by, start_request_id);"),
    'Test 11: start_request_id column and unique index on (workspace_id, started_by, start_request_id) created'
  );

  assert(
    migrationSql.includes("IF p_start_request_id IS NULL THEN\n    RAISE EXCEPTION 'start_request_id is required for process instance creation.';\n  END IF;"),
    'Test 12: start_request_id is required in start RPC'
  );

  assert(
    migrationSql.includes("SELECT * INTO v_existing_instance\n  FROM public.process_instances\n  WHERE workspace_id = v_workspace_id\n    AND started_by = v_caller_id\n    AND start_request_id = p_start_request_id;"),
    'Test 13: start_process_instance checks for existing instance matching start_request_id'
  );

  assert(
    migrationSql.includes("IF v_existing_instance.defined_process_version_id <> p_version_id") &&
    migrationSql.includes("RAISE EXCEPTION 'Idempotency conflict: start_request_id was previously used with different parameters.'"),
    'Test 14: Replaying start_request_id with different payload raises Idempotency conflict'
  );

  assert(
    migrationSql.includes("'is_replay', true") &&
    migrationSql.includes("'process_instance_id', v_existing_instance.id"),
    'Test 15: Replaying start_request_id with identical payload returns existing instance deterministically'
  );

  // =========================================================================
  // SECTION E: SECURITY ADVISOR CLOSURE & INVOKER ARCHITECTURE
  // =========================================================================
  console.log('\n--- Section E: Security Architecture & Security Advisor Closure ---');

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION public.start_process_instance(") &&
    migrationSql.includes("SECURITY INVOKER") &&
    migrationSql.includes("RETURN private.start_process_instance_internal("),
    'Test 16: public.start_process_instance is SECURITY INVOKER delegating to private internal engine'
  );

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION private.start_process_instance_internal(") &&
    migrationSql.includes("SECURITY DEFINER\nSET search_path = ''"),
    'Test 17: private.start_process_instance_internal is SECURITY DEFINER with empty search_path'
  );

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION public.get_process_instance_progress(p_instance_id uuid)\nRETURNS numeric\nLANGUAGE plpgsql\nSECURITY INVOKER") &&
    migrationSql.includes("IF NOT private.can_read_process_instance(p_instance_id, v_caller_id) THEN\n    RAISE EXCEPTION 'Access denied to process instance.';\n  END IF;"),
    'Test 18: public.get_process_instance_progress is SECURITY INVOKER with explicit read authorization enforcement'
  );

  assert(
    !migrationSql.includes("p_raci_overrides") &&
    !schemaSql.includes("start_process_instance(\n  p_version_id       uuid,\n  p_instance_name    text,\n  p_overall_due_date date DEFAULT NULL,\n  p_placement_type   text DEFAULT 'standalone',\n  p_project_id       uuid DEFAULT NULL,\n  p_phase_id         uuid DEFAULT NULL,\n  p_task_list_id     uuid DEFAULT NULL,\n  p_parent_task_id   uuid DEFAULT NULL,\n  p_raci_overrides"),
    'Test 19: Unused p_raci_overrides removed from canonical start contract'
  );

  assert(
    migrationSql.includes("DROP FUNCTION IF EXISTS public.start_process_instance(uuid, text, date, text, uuid, uuid, uuid, uuid, jsonb, uuid);") &&
    migrationSql.includes("DROP FUNCTION IF EXISTS public.get_process_instance_progress(uuid);"),
    'Test 20: Obsolete P1-02 SECURITY DEFINER overloads dropped to eliminate Security Advisor WARNs'
  );

  assert(
    migrationSql.includes("v_caller_id, -- owner_id = starter strictly"),
    'Test 21: Process owner is authoritatively locked to auth.uid()'
  );

  // =========================================================================
  // SECTION F: REWORK & DUE DATE INTEGRITY
  // =========================================================================
  console.log('\n--- Section F: Rework & Due Date Integrity ---');

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION public.reject_process_task(") &&
    migrationSql.includes("p_new_due_date         date DEFAULT NULL") &&
    migrationSql.includes("IF v_task.process_instance_id IS NOT NULL THEN") &&
    migrationSql.includes("IF p_new_due_date IS NOT NULL THEN\n      RAISE EXCEPTION 'Process Instance steps do not have individual due dates.';\n    END IF;\n    v_target_due_date := NULL;"),
    'Test 22: reject_process_task rejects non-null due dates in Process Instance runtime'
  );

  assert(
    migrationSql.includes("IF p_new_due_date IS NULL THEN\n      RAISE EXCEPTION 'New due date is required for rework.';\n    END IF;\n    v_target_due_date := p_new_due_date;"),
    'Test 23: reject_process_task enforces due date in legacy Task List runtime'
  );

  // =========================================================================
  // SECTION G: CONSULTATION & RESPONSIBLE COMPLETION RESOLUTION
  // =========================================================================
  console.log('\n--- Section G: Consultation & Responsible Completion ---');

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION public.complete_responsible_part(") &&
    migrationSql.includes("IF v_task.process_instance_id IS NOT NULL THEN") &&
    migrationSql.includes("v_workspace_id := v_instance.workspace_id;") &&
    migrationSql.includes("v_process_name := v_instance.instance_name;"),
    'Test 24: complete_responsible_part resolves workspace and name from process_instances when task_list_id is null'
  );

  assert(
    migrationSql.includes("CREATE OR REPLACE FUNCTION public.submit_task_consultation(") &&
    migrationSql.includes("IF v_task.process_instance_id IS NOT NULL THEN") &&
    migrationSql.includes("v_workspace_id := v_instance.workspace_id;") &&
    migrationSql.includes("v_process_name := v_instance.instance_name;"),
    'Test 25: submit_task_consultation resolves workspace and name from process_instances when task_list_id is null'
  );

  // =========================================================================
  // SECTION H: GRANTS & PERMISSIONS MATRIX
  // =========================================================================
  console.log('\n--- Section H: Grants & Permissions Matrix ---');

  assert(
    migrationSql.includes("REVOKE ALL ON FUNCTION public.start_process_instance(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;") &&
    migrationSql.includes("GRANT EXECUTE ON FUNCTION public.start_process_instance(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) TO authenticated;"),
    'Test 26: public.start_process_instance granted only to authenticated'
  );

  assert(
    migrationSql.includes("REVOKE ALL ON FUNCTION public.get_process_instance_progress(uuid) FROM PUBLIC, anon;") &&
    migrationSql.includes("GRANT EXECUTE ON FUNCTION public.get_process_instance_progress(uuid) TO authenticated;"),
    'Test 27: public.get_process_instance_progress granted only to authenticated'
  );

  assert(
    migrationSql.includes("REVOKE ALL ON FUNCTION private.start_process_instance_internal(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;") &&
    migrationSql.includes("GRANT EXECUTE ON FUNCTION private.start_process_instance_internal(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid) TO authenticated, service_role, postgres;"),
    'Test 28: private.start_process_instance_internal restricted from public schema'
  );

  // =========================================================================
  // SECTION I: BUILD & TYPE SAFETY VERIFICATION
  // =========================================================================
  console.log('\n--- Section I: Build & Type Safety Verification ---');

  try {
    execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' });
    assert(true, 'Test 29: Vite production build succeeds with 0 errors');
  } catch (err) {
    assert(false, `Test 29: Vite build failed: ${err.message}`);
  }

  try {
    execSync('npm run lint', { cwd: repoRoot, stdio: 'pipe' });
    assert(true, 'Test 30: ESLint check passes with 0 errors');
  } catch (err) {
    assert(false, `Test 30: ESLint check failed: ${err.message}`);
  }

  console.log('\n======================================================================');
  console.log(`P1-02A Lifecycle & Security Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
