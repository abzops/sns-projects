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

  // App.jsx routing
  const appSrc = await readFile(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  assert(appSrc.includes('/workspace/:workspaceId/processes'), 'Test 1: App.jsx includes /workspace/:workspaceId/processes route');
  assert(appSrc.includes('/workspace/:workspaceId/project/:projectId/process/:taskListId'), 'Test 2: App.jsx includes process instance route');
  assert(appSrc.includes('ProcessesPage'), 'Test 3: App.jsx imports ProcessesPage');
  assert(appSrc.includes('ProcessInstancePage'), 'Test 4: App.jsx imports ProcessInstancePage');

  // AppLayout sidebar
  const layoutSrc = await readFile(path.join(repoRoot, 'src/components/AppLayout.jsx'), 'utf8');
  assert(layoutSrc.includes('/processes'), 'Test 5: AppLayout sidebar includes Processes navigation link');
  assert(layoutSrc.includes('<Workflow'), 'Test 6: AppLayout uses Lucide Workflow icon for Processes');

  // useDefinedProcesses hook
  const useProcSrc = await readFile(path.join(repoRoot, 'src/hooks/useDefinedProcesses.js'), 'utf8');
  assert(useProcSrc.includes('publish_defined_process_version'), 'Test 7: useDefinedProcesses integrates publish_defined_process_version RPC');
  assert(useProcSrc.includes('start_defined_process'), 'Test 8: useDefinedProcesses integrates start_defined_process RPC');

  // useProcessInstance hook
  const useInstSrc = await readFile(path.join(repoRoot, 'src/hooks/useProcessInstance.js'), 'utf8');
  assert(useInstSrc.includes('complete_responsible_part'), 'Test 9: useProcessInstance integrates complete_responsible_part RPC');
  assert(useInstSrc.includes('submit_task_evidence'), 'Test 10: useProcessInstance integrates submit_task_evidence RPC');
  assert(useInstSrc.includes('submit_task_consultation'), 'Test 11: useProcessInstance integrates submit_task_consultation RPC');
  assert(useInstSrc.includes('approve_process_task'), 'Test 12: useProcessInstance integrates approve_process_task RPC');
  assert(useInstSrc.includes('reject_process_task'), 'Test 13: useProcessInstance integrates reject_process_task RPC');

  // StartProcessModal
  const modalSrc = await readFile(path.join(repoRoot, 'src/components/StartProcessModal.jsx'), 'utf8');
  assert(modalSrc.includes('Only a Responsible user on the first step can start this process'), 'Test 14: StartProcessModal enforces root Responsible authority check');
  assert(modalSrc.includes('start_defined_process'), 'Test 15: StartProcessModal calls start_defined_process RPC');

  // ProcessesPage
  const procPageSrc = await readFile(path.join(repoRoot, 'src/pages/ProcessesPage.jsx'), 'utf8');
  assert(procPageSrc.includes('INTERNAL-MVP-DEMO'), 'Test 16: ProcessesPage badges INTERNAL-MVP-DEMO as Internal Demo');
  assert(procPageSrc.includes('StartProcessModal'), 'Test 17: ProcessesPage integrates StartProcessModal');

  // ProcessInstancePage
  const instPageSrc = await readFile(path.join(repoRoot, 'src/pages/ProcessInstancePage.jsx'), 'utf8');
  assert(instPageSrc.includes('stateWaiting'), 'Test 18: ProcessInstancePage has Waiting state badge styling');
  assert(instPageSrc.includes('stateReady'), 'Test 19: ProcessInstancePage has Ready state badge styling');
  assert(instPageSrc.includes('Process Completed'), 'Test 20: ProcessInstancePage renders Process Completed banner upon completion');
  assert(instPageSrc.includes('completeResponsiblePart'), 'Test 21: ProcessInstancePage has Complete My Part action');
  assert(instPageSrc.includes('submitEvidence'), 'Test 22: ProcessInstancePage has Add Evidence action');
  assert(instPageSrc.includes('submitConsultation'), 'Test 23: ProcessInstancePage has Consultation response action');
  assert(instPageSrc.includes('approveTask'), 'Test 24: ProcessInstancePage has Accountable Approve action');
  assert(instPageSrc.includes('rejectTask'), 'Test 25: ProcessInstancePage has Accountable Reject/Rework action');

  // TaskDetailPanel Defined Task mode
  const panelSrc = await readFile(path.join(repoRoot, 'src/components/TaskDetailPanel.jsx'), 'utf8');
  assert(panelSrc.includes('isDefinedTask'), 'Test 26: TaskDetailPanel detects Defined Task mode via process_step_id');
  assert(panelSrc.includes('complete_responsible_part'), 'Test 27: TaskDetailPanel integrates complete_responsible_part');
  assert(panelSrc.includes('submit_task_evidence'), 'Test 28: TaskDetailPanel integrates submit_task_evidence');
  assert(panelSrc.includes('submit_task_consultation'), 'Test 29: TaskDetailPanel integrates submit_task_consultation');
  assert(panelSrc.includes('approve_process_task'), 'Test 30: TaskDetailPanel integrates approve_process_task');
  assert(panelSrc.includes('reject_process_task'), 'Test 31: TaskDetailPanel integrates reject_process_task');
  assert(panelSrc.includes('disabled={isDefinedTask}'), 'Test 32: TaskDetailPanel disables manual status, title, and due date edits on Defined Tasks');

  // TasksPage Kanban & Hierarchy protection
  const tasksPageSrc = await readFile(path.join(repoRoot, 'src/pages/TasksPage.jsx'), 'utf8');
  assert(tasksPageSrc.includes('Status controlled by Defined Process workflow'), 'Test 33: TasksPage blocks cross-column DnD for Defined Tasks with feedback toast');
  assert(tasksPageSrc.includes('definedListTag'), 'Test 34: TasksPage differentiates Defined Task Lists in hierarchy view');
  assert(tasksPageSrc.includes('viewProcessBtn'), 'Test 35: TasksPage provides View Process button on Defined Task Lists');

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
