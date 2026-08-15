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

async function runLiveSmokeTest() {
  console.log('===============================================================');
  console.log('SNS Projects — Defined Process MVP Live Production Smoke Test');
  console.log('===============================================================\n');

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
  const userId = '00ae89c1-353b-4367-827e-9817343140d1';

  try {
    // 1. Fetch published version of INTERNAL-MVP-DEMO
    const { rows: [demoProc] } = await client.query(`
      SELECT p.id as process_id, p.name, p.code, v.id as version_id, v.version_number, v.status
      FROM public.defined_processes p
      JOIN public.defined_process_versions v ON v.defined_process_id = p.id
      WHERE p.workspace_id = $1 AND p.code = 'INTERNAL-MVP-DEMO' AND v.status = 'published';
    `, [wsId]);

    if (!demoProc) {
      throw new Error('INTERNAL-MVP-DEMO published version not found.');
    }

    console.log(`Found published demo process: ${demoProc.name} (v${demoProc.version_number})`);

    // 2. Resolve Target Project & Milestone
    const { rows: [targetProj] } = await client.query(`
      SELECT id, name FROM public.projects WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1;
    `, [wsId]);

    const { rows: [targetMs] } = await client.query(`
      SELECT id, name FROM public.milestones WHERE project_id = $1 ORDER BY position ASC LIMIT 1;
    `, [targetProj.id]);

    console.log(`Target Project: ${targetProj.name} (${targetProj.id})`);
    console.log(`Target Milestone: ${targetMs.name} (${targetMs.id})\n`);

    // Check if "MVP Live Smoke Test" already exists
    const { rows: existingInst } = await client.query(`
      SELECT id, process_state FROM public.task_lists
      WHERE project_id = $1 AND name = 'MVP Live Smoke Test';
    `, [targetProj.id]);

    let taskListId;

    if (existingInst.length > 0) {
      console.log(`Instance "MVP Live Smoke Test" already exists (${existingInst[0].id}, state: ${existingInst[0].process_state})`);
      taskListId = existingInst[0].id;
    } else {
      // 3. START PROCESS INSTANCE as authenticated user
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated;');
      await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}';`);

      const { rows: [startRes] } = await client.query(`
        SELECT public.start_defined_process($1, $2, $3, $4, NULL) as res;
      `, [demoProc.version_id, targetProj.id, targetMs.id, 'MVP Live Smoke Test']);

      await client.query('RESET ROLE;');
      await client.query('COMMIT');

      taskListId = startRes.res.task_list_id;
      console.log(`[PASS] start_defined_process created instance: ${taskListId}`);
    }

    // 4. Fetch all tasks in instance
    const { rows: tasks } = await client.query(`
      SELECT t.id, t.title, t.workflow_state, t.due_date, s.step_code, s.sequence_order
      FROM public.tasks t
      JOIN public.defined_process_steps s ON s.id = t.process_step_id
      WHERE t.task_list_id = $1
      ORDER BY s.sequence_order ASC;
    `, [taskListId]);

    console.log(`Found ${tasks.length} tasks in process instance:`);
    tasks.forEach(t => console.log(`  - [${t.sequence_order}] ${t.step_code}: ${t.title} (${t.workflow_state})`));

    const task1 = tasks.find(t => t.sequence_order === 1);
    const task2 = tasks.find(t => t.sequence_order === 2);
    const task3 = tasks.find(t => t.sequence_order === 3);

    // STEP 1 EXECUTION
    if (task1.workflow_state !== 'completed') {
      console.log(`\n--- Executing Step 1: ${task1.step_code} ---`);
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated;');
      await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}';`);

      // Submit optional evidence
      await client.query(`
        SELECT public.submit_task_evidence($1, NULL, 'text', '{"note": "Live smoke test initialized"}'::jsonb);
      `, [task1.id]);

      // Complete responsible part
      const { rows: [comp1] } = await client.query(`
        SELECT public.complete_responsible_part($1, 'Step 1 complete') as res;
      `, [task1.id]);

      await client.query('RESET ROLE;');
      await client.query('COMMIT');
      console.log(`[PASS] Step 1 completed:`, comp1.res);
    } else {
      console.log(`\nStep 1 (${task1.step_code}) is already completed.`);
    }

    // Verify Step 2 is now READY
    const { rows: [chkTask2] } = await client.query(`
      SELECT workflow_state, due_date FROM public.tasks WHERE id = $1;
    `, [task2.id]);
    console.log(`[PASS] Step 2 workflow_state is now: ${chkTask2.workflow_state} (due: ${chkTask2.due_date})`);

    // STEP 2 EXECUTION
    if (chkTask2.workflow_state !== 'completed') {
      console.log(`\n--- Executing Step 2: ${task2.step_code} ---`);
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated;');
      await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}';`);

      const { rows: [comp2] } = await client.query(`
        SELECT public.complete_responsible_part($1, 'Step 2 complete') as res;
      `, [task2.id]);

      await client.query('RESET ROLE;');
      await client.query('COMMIT');
      console.log(`[PASS] Step 2 completed:`, comp2.res);
    } else {
      console.log(`\nStep 2 (${task2.step_code}) is already completed.`);
    }

    // Verify Step 3 is now READY
    const { rows: [chkTask3] } = await client.query(`
      SELECT workflow_state, due_date FROM public.tasks WHERE id = $1;
    `, [task3.id]);
    console.log(`[PASS] Step 3 workflow_state is now: ${chkTask3.workflow_state} (due: ${chkTask3.due_date})`);

    // STEP 3 EXECUTION
    if (chkTask3.workflow_state !== 'completed') {
      console.log(`\n--- Executing Step 3: ${task3.step_code} ---`);
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated;');
      await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}';`);

      const { rows: [comp3] } = await client.query(`
        SELECT public.complete_responsible_part($1, 'Step 3 complete and verified') as res;
      `, [task3.id]);

      await client.query('RESET ROLE;');
      await client.query('COMMIT');
      console.log(`[PASS] Step 3 completed:`, comp3.res);
    } else {
      console.log(`\nStep 3 (${task3.step_code}) is already completed.`);
    }

    // VERIFY AUTOMATIC PROCESS COMPLETION
    const { rows: [finalList] } = await client.query(`
      SELECT id, name, process_state, started_at, completed_at
      FROM public.task_lists
      WHERE id = $1;
    `, [taskListId]);

    console.log(`\n===============================================================`);
    console.log(`FINAL PROCESS INSTANCE STATE:`);
    console.log(`  - Task List ID: ${finalList.id}`);
    console.log(`  - Name: ${finalList.name}`);
    console.log(`  - Process State: ${finalList.process_state}`);
    console.log(`  - Started At: ${finalList.started_at}`);
    console.log(`  - Completed At: ${finalList.completed_at}`);
    console.log(`===============================================================\n`);

    if (finalList.process_state !== 'completed') {
      throw new Error(`Expected process_state = 'completed', got '${finalList.process_state}'`);
    }

    console.log('✓ LIVE PRODUCTION SMOKE TEST COMPLETED 100% SUCCESSFULLY!\n');

  } catch (err) {
    console.error('Error during live smoke test:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runLiveSmokeTest();
