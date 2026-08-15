import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

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
      const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      values[key] = value;
      return values;
    }, {});
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function runFrontendMVPTests() {
  console.log('===============================================================');
  console.log('SNS Projects — Defined Process Frontend MVP Verification Suite');
  console.log('===============================================================\n');

  // --- 1. SOURCE CODE CONTRACTS & COMPONENT VERIFICATION ---
  console.log('--- Static Code & Route Contracts ---');

  // Load all source files
  const appSrc = await readFile(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const layoutSrc = await readFile(path.join(repoRoot, 'src/components/AppLayout.jsx'), 'utf8');
  const useProcSrc = await readFile(path.join(repoRoot, 'src/hooks/useDefinedProcesses.js'), 'utf8');
  const useInstSrc = await readFile(path.join(repoRoot, 'src/hooks/useProcessInstance.js'), 'utf8');
  const modalSrc = await readFile(path.join(repoRoot, 'src/components/StartProcessModal.jsx'), 'utf8');
  const procPageSrc = await readFile(path.join(repoRoot, 'src/pages/ProcessesPage.jsx'), 'utf8');
  const instPageSrc = await readFile(path.join(repoRoot, 'src/pages/ProcessInstancePage.jsx'), 'utf8');
  const panelSrc = await readFile(path.join(repoRoot, 'src/components/TaskDetailPanel.jsx'), 'utf8');
  const tasksPageSrc = await readFile(path.join(repoRoot, 'src/pages/TasksPage.jsx'), 'utf8');

  // App.jsx routing
  assert(appSrc.includes('/workspace/:workspaceId/processes'), 'Test 1: App.jsx includes /workspace/:workspaceId/processes route');
  assert(appSrc.includes('/workspace/:workspaceId/project/:projectId/process/:taskListId'), 'Test 2: App.jsx includes process instance route');
  assert(appSrc.includes('ProcessesPage'), 'Test 3: App.jsx imports ProcessesPage');
  assert(appSrc.includes('ProcessInstancePage'), 'Test 4: App.jsx imports ProcessInstancePage');

  // AppLayout sidebar
  assert(layoutSrc.includes('/processes'), 'Test 5: AppLayout sidebar includes Processes navigation link');
  assert(layoutSrc.includes('<Workflow'), 'Test 6: AppLayout uses Lucide Workflow icon for Processes');

  // useDefinedProcesses hook
  assert(useProcSrc.includes('publish_defined_process_version'), 'Test 7: useDefinedProcesses integrates publish_defined_process_version RPC');
  assert(useProcSrc.includes('start_defined_process'), 'Test 8: useDefinedProcesses integrates start_defined_process RPC');

  // useProcessInstance hook
  assert(useInstSrc.includes('complete_responsible_part'), 'Test 9: useProcessInstance integrates complete_responsible_part RPC');
  assert(useInstSrc.includes('submit_task_evidence'), 'Test 10: useProcessInstance integrates submit_task_evidence RPC');
  assert(useInstSrc.includes('submit_task_consultation'), 'Test 11: useProcessInstance integrates submit_task_consultation RPC');
  assert(useInstSrc.includes('approve_process_task'), 'Test 12: useProcessInstance integrates approve_process_task RPC');
  assert(useInstSrc.includes('reject_process_task'), 'Test 13: useProcessInstance integrates reject_process_task RPC');

  // --- Strict Literal RPC Parameter Contract Checks ---
  // complete_responsible_part: must use p_note, must NOT use p_notes
  assert(useInstSrc.includes('p_note:'), 'Test 9a: useProcessInstance uses literal p_note parameter');
  assert(!useInstSrc.includes('p_notes:'), 'Test 9b: useProcessInstance strictly avoids invalid p_notes parameter');
  assert(panelSrc.includes('p_note:'), 'Test 9c: TaskDetailPanel uses literal p_note parameter');
  assert(!panelSrc.includes('p_notes:'), 'Test 9d: TaskDetailPanel strictly avoids invalid p_notes parameter');

  // submit_task_evidence: must use p_evidence_type, p_payload
  assert(useInstSrc.includes('p_evidence_type:'), 'Test 10a: useProcessInstance uses literal p_evidence_type parameter');
  assert(useInstSrc.includes('p_payload:'), 'Test 10b: useProcessInstance uses literal p_payload parameter');

  // submit_task_consultation: must use p_response, must NOT use p_feedback
  assert(useInstSrc.includes('p_response:'), 'Test 11a: useProcessInstance uses literal p_response parameter');
  assert(!useInstSrc.includes('p_feedback:'), 'Test 11b: useProcessInstance strictly avoids invalid p_feedback parameter');
  assert(panelSrc.includes('p_response:'), 'Test 11c: TaskDetailPanel uses literal p_response parameter');
  assert(!panelSrc.includes('p_feedback:'), 'Test 11d: TaskDetailPanel strictly avoids invalid p_feedback parameter');

  // approve_process_task: must pass ONLY p_task_id, must NOT pass p_comments
  assert(useInstSrc.includes('approve_process_task\', {\n        p_task_id: taskId,\n      })') || useInstSrc.includes('p_task_id: taskId'), 'Test 12a: useProcessInstance passes only p_task_id to approve_process_task');
  assert(!useInstSrc.includes('p_comments'), 'Test 12b: useProcessInstance strictly avoids invalid p_comments parameter');
  assert(!panelSrc.includes('p_comments'), 'Test 12c: TaskDetailPanel strictly avoids invalid p_comments parameter');

  // reject_process_task: must pass p_reason and p_new_due_date
  assert(useInstSrc.includes('p_reason:'), 'Test 13a: useProcessInstance passes literal p_reason to reject_process_task');
  assert(useInstSrc.includes('p_new_due_date:'), 'Test 13b: useProcessInstance passes literal p_new_due_date to reject_process_task');
  assert(panelSrc.includes('p_new_due_date:'), 'Test 13c: TaskDetailPanel passes literal p_new_due_date to reject_process_task');
  assert(instPageSrc.includes('rejectDueDate'), 'Test 13d: ProcessInstancePage requires new due date in Reject UI');

  // Evidence UI: ONLY text and link, NO file_ref
  assert(!instPageSrc.includes('file_ref'), 'Test 14a: ProcessInstancePage strictly does not offer file_ref evidence option');
  assert(!panelSrc.includes('file_ref'), 'Test 14b: TaskDetailPanel strictly does not offer file_ref evidence option');

  // Start Authority: user-specific root Responsible check, NO department membership shortcut
  assert(modalSrc.includes('r.raci_role === \'R\' && r.user_id === user.id'), 'Test 15a: StartProcessModal enforces exact user ID root Responsible check');
  assert(!modalSrc.includes('department_membership') && !modalSrc.includes('departmentMemberships'), 'Test 15b: StartProcessModal contains no department membership shortcut');

  // StartProcessModal
  assert(modalSrc.includes('Only a Responsible user on the first step can start this process'), 'Test 16: StartProcessModal enforces root Responsible authority check');
  assert(modalSrc.includes('start_defined_process'), 'Test 17: StartProcessModal calls start_defined_process RPC');

  // ProcessesPage
  assert(procPageSrc.includes('INTERNAL-MVP-DEMO'), 'Test 18: ProcessesPage badges INTERNAL-MVP-DEMO as Internal Demo');
  assert(procPageSrc.includes('StartProcessModal'), 'Test 19: ProcessesPage integrates StartProcessModal');

  // ProcessInstancePage
  assert(instPageSrc.includes('stateWaiting'), 'Test 20: ProcessInstancePage has Waiting state badge styling');
  assert(instPageSrc.includes('stateReady'), 'Test 21: ProcessInstancePage has Ready state badge styling');
  assert(instPageSrc.includes('Process Completed'), 'Test 22: ProcessInstancePage renders Process Completed banner upon completion');
  assert(instPageSrc.includes('completeResponsiblePart'), 'Test 23: ProcessInstancePage has Complete My Part action');
  assert(instPageSrc.includes('submitEvidence'), 'Test 24: ProcessInstancePage has Add Evidence action');
  assert(instPageSrc.includes('submitConsultation'), 'Test 25: ProcessInstancePage has Consultation response action');
  assert(instPageSrc.includes('approveTask'), 'Test 26: ProcessInstancePage has Accountable Approve action');
  assert(instPageSrc.includes('rejectTask'), 'Test 27: ProcessInstancePage has Accountable Reject/Rework action');

  // TaskDetailPanel Defined Task mode
  assert(panelSrc.includes('isDefinedTask'), 'Test 28: TaskDetailPanel detects Defined Task mode via process_step_id');
  assert(panelSrc.includes('complete_responsible_part'), 'Test 29: TaskDetailPanel integrates complete_responsible_part');
  assert(panelSrc.includes('submit_task_evidence'), 'Test 30: TaskDetailPanel integrates submit_task_evidence');
  assert(panelSrc.includes('submit_task_consultation'), 'Test 31: TaskDetailPanel integrates submit_task_consultation');
  assert(panelSrc.includes('approve_process_task'), 'Test 32: TaskDetailPanel integrates approve_process_task');
  assert(panelSrc.includes('reject_process_task'), 'Test 33: TaskDetailPanel integrates reject_process_task');
  assert(panelSrc.includes('disabled={isDefinedTask}'), 'Test 34: TaskDetailPanel disables manual status, title, and due date edits on Defined Tasks');

  // TasksPage Kanban & Hierarchy protection
  assert(tasksPageSrc.includes('Status controlled by Defined Process workflow'), 'Test 35: TasksPage blocks cross-column DnD for Defined Tasks with feedback toast');
  assert(tasksPageSrc.includes('definedListTag'), 'Test 36: TasksPage differentiates Defined Task Lists in hierarchy view');
  assert(tasksPageSrc.includes('viewProcessBtn'), 'Test 37: TasksPage provides View Process button on Defined Task Lists');

  // --- 2. LIVE DATABASE ARTIFACTS & SMOKE TEST VERIFICATION ---
  console.log('\n--- Production Database State Verification ---');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  try {
    // 1. Check INTERNAL-MVP-DEMO process
    const { rows: demoRows } = await client.query(`
      SELECT p.id, p.name, p.code, v.version_number, v.status
      FROM public.defined_processes p
      JOIN public.defined_process_versions v ON v.defined_process_id = p.id
      WHERE p.workspace_id = $1 AND p.code = 'INTERNAL-MVP-DEMO';
    `, [wsId]);

    assert(demoRows.length > 0, 'Test 36: INTERNAL-MVP-DEMO process exists in production DB');
    assert(demoRows[0]?.status === 'published', 'Test 37: INTERNAL-MVP-DEMO version 1 is published');

    // 2. Check 3 demo steps
    const { rows: stepRows } = await client.query(`
      SELECT s.step_code, s.sequence_order, s.expected_duration_days
      FROM public.defined_process_steps s
      WHERE s.version_id = (SELECT id FROM public.defined_process_versions WHERE defined_process_id = $1)
      ORDER BY s.sequence_order ASC;
    `, [demoRows[0]?.id]);

    assert(stepRows.length === 3, `Test 38: Exactly 3 demo steps exist (got ${stepRows.length})`);
    assert(stepRows[0]?.step_code === 'DEMO-001', 'Test 39: Step 1 code is DEMO-001');
    assert(stepRows[1]?.step_code === 'DEMO-002', 'Test 40: Step 2 code is DEMO-002');
    assert(stepRows[2]?.step_code === 'DEMO-003', 'Test 41: Step 3 code is DEMO-003');

    // 3. Check Live Smoke Test Instance
    const { rows: smokeRows } = await client.query(`
      SELECT tl.id, tl.name, tl.process_state, tl.task_list_type, tl.started_at, tl.completed_at
      FROM public.task_lists tl
      WHERE tl.name = 'MVP Live Smoke Test';
    `);

    assert(smokeRows.length > 0, 'Test 42: "MVP Live Smoke Test" instance exists in production DB');
    assert(smokeRows[0]?.task_list_type === 'defined', 'Test 43: Instance task_list_type is defined');
    assert(smokeRows[0]?.process_state === 'completed', 'Test 44: Instance process_state is completed');
    assert(smokeRows[0]?.completed_at !== null, 'Test 45: Instance has valid completed_at timestamp');

    // 4. Check all 3 tasks in smoke instance are completed
    const { rows: taskRows } = await client.query(`
      SELECT workflow_state, current_cycle_number FROM public.tasks WHERE task_list_id = $1;
    `, [smokeRows[0]?.id]);

    assert(taskRows.length === 3, `Test 46: Smoke instance has exactly 3 tasks (got ${taskRows.length})`);
    const allCompleted = taskRows.every(t => t.workflow_state === 'completed');
    assert(allCompleted, 'Test 47: All 3 tasks in smoke instance transitioned to completed');

    // 5. Check Process Audit Events
    const { rows: auditRows } = await client.query(`
      SELECT event_type FROM public.process_audit_events WHERE task_list_id = $1;
    `, [smokeRows[0]?.id]);

    const auditEvents = new Set(auditRows.map(a => a.event_type));
    assert(auditEvents.has('PROCESS_STARTED'), 'Test 48: Audit trail records PROCESS_STARTED');
    assert(auditEvents.has('TASK_READY'), 'Test 49: Audit trail records TASK_READY');
    assert(auditEvents.has('TASK_COMPLETED'), 'Test 50: Audit trail records TASK_COMPLETED');
    assert(auditEvents.has('PROCESS_COMPLETED'), 'Test 51: Audit trail records PROCESS_COMPLETED');

  } finally {
    await client.end();
  }

  console.log(`\n===============================================================`);
  console.log(`Defined Process Frontend MVP Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log(`===============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runFrontendMVPTests();
