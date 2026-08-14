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

// Canonical Specification: status and within-status sequence order
const CANONICAL_BASELINE = {
  'ASRS Product Development': [
    { title: 'Freeze Container & Rack Layout', system_code: 'done', order: 1 },
    { title: 'Finalize Bin & Compartment Design', system_code: 'in_progress', order: 1 },
    { title: 'Freeze PLC I/O Map', system_code: 'in_review', order: 1 },
    { title: 'Finalize Electrical Panel BOM', system_code: 'todo', order: 1 },
    { title: 'Release Manufacturing Package', system_code: 'todo', order: 2 },
    { title: 'Assemble ASRS Prototype', system_code: 'todo', order: 3 },
    { title: 'Run Integrated Functional Test', system_code: 'todo', order: 4 },
    { title: 'Close Validation Actions & Release V1', system_code: 'todo', order: 5 },
  ],
  'Warehouse Deployment Pilot': [
    { title: 'Freeze Site Layout', system_code: 'done', order: 1 },
    { title: 'Confirm Utility & Compliance Readiness', system_code: 'in_progress', order: 1 },
    { title: 'Freeze Integrated Deployment Schedule', system_code: 'in_review', order: 1 },
    { title: 'Mobilize External Vendors', system_code: 'todo', order: 1 },
    { title: 'Complete Mechanical Installation', system_code: 'todo', order: 2 },
    { title: 'Commission PLC & HMI', system_code: 'todo', order: 3 },
    { title: 'Complete Site Acceptance Test', system_code: 'todo', order: 4 },
    { title: 'Train Operations Team & Go Live', system_code: 'todo', order: 5 },
  ],
  'SNS Projects Internal Rollout': [
    { title: 'Configure Department Structure', system_code: 'done', order: 1 },
    { title: 'Onboard Core Users', system_code: 'in_progress', order: 1 },
    { title: 'Configure System Roles', system_code: 'in_progress', order: 2 },
    { title: 'Close P0 / P1 Application Defects', system_code: 'in_progress', order: 3 },
    { title: 'Establish RACI Working Standard', system_code: 'in_review', order: 1 },
    { title: 'Configure First Live Structured Project', system_code: 'todo', order: 1 },
    { title: 'Run Team Walkthrough', system_code: 'todo', order: 2 },
    { title: 'Publish Quick User Guide & BAU Handover', system_code: 'todo', order: 3 },
  ],
};

async function runRepair() {
  console.log('===============================================================');
  console.log('SNS Projects — Kanban Status & Position Normalization Repair');
  console.log('===============================================================\n');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));

  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  // 1. Fetch projects
  const { rows: projects } = await client.query(`
    SELECT id, name FROM public.projects WHERE workspace_id = $1 ORDER BY name;
  `, [wsId]);

  console.log(`Found ${projects.length} target projects in workspace.`);

  // 2. Fetch statuses for all projects
  const { rows: allStatuses } = await client.query(`
    SELECT id, project_id, name, system_code, position 
    FROM public.task_statuses 
    WHERE project_id = ANY($1::uuid[])
    ORDER BY project_id, position;
  `, [projects.map(p => p.id)]);

  const statusesByProject = {};
  for (const s of allStatuses) {
    if (!statusesByProject[s.project_id]) statusesByProject[s.project_id] = {};
    statusesByProject[s.project_id][s.system_code] = s.id;
  }

  // 3. Fetch current tasks
  const { rows: currentTasks } = await client.query(`
    SELECT t.id, t.project_id, p.name as project_name, t.title, t.status_id, ts.system_code, t.position
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    JOIN public.task_statuses ts ON ts.id = t.status_id
    WHERE p.workspace_id = $1;
  `, [wsId]);

  console.log(`Found ${currentTasks.length} current tasks.`);

  // Begin transaction
  await client.query('BEGIN;');

  try {
    let updatedCount = 0;

    for (const project of projects) {
      const canonicalTasks = CANONICAL_BASELINE[project.name];
      if (!canonicalTasks) {
        throw new Error(`No canonical baseline found for project: ${project.name}`);
      }

      const projectStatusMap = statusesByProject[project.id];
      if (!projectStatusMap) {
        throw new Error(`No statuses found for project: ${project.name}`);
      }

      for (const spec of canonicalTasks) {
        const matchingTask = currentTasks.find(
          t => t.project_id === project.id && t.title === spec.title
        );

        if (!matchingTask) {
          throw new Error(`Task "${spec.title}" not found in project "${project.name}"!`);
        }

        const targetStatusId = projectStatusMap[spec.system_code];
        if (!targetStatusId) {
          throw new Error(`Status system_code "${spec.system_code}" not found in project "${project.name}"!`);
        }

        const targetPosition = spec.order * 1000;

        const needsStatusUpdate = matchingTask.status_id !== targetStatusId;
        const needsPosUpdate = matchingTask.position !== targetPosition;

        if (needsStatusUpdate || needsPosUpdate) {
          console.log(`[UPDATE] "${spec.title}" in ${project.name}: status (${matchingTask.system_code} -> ${spec.system_code}), pos (${matchingTask.position} -> ${targetPosition})`);
          await client.query(`
            UPDATE public.tasks
            SET status_id = $1, position = $2, updated_at = now()
            WHERE id = $3;
          `, [targetStatusId, targetPosition, matchingTask.id]);
          updatedCount++;
        } else {
          console.log(`[OK] "${spec.title}" already matches canonical state: ${spec.system_code} pos ${targetPosition}`);
        }
      }
    }

    // 4. Assert zero duplicate positions
    const { rows: dups } = await client.query(`
      SELECT project_id, status_id, position, count(*) as cnt 
      FROM public.tasks 
      WHERE project_id = ANY($1::uuid[])
      GROUP BY project_id, status_id, position 
      HAVING count(*) > 1;
    `, [projects.map(p => p.id)]);

    if (dups.length > 0) {
      throw new Error(`Assertion failed! Found ${dups.length} duplicate position groups after normalization.`);
    }

    console.log(`\n✓ Zero duplicate position groups confirmed across all projects.`);

    // 5. Verify total counts
    const { rows: counts } = await client.query(`
      SELECT
        (SELECT count(*) FROM public.projects WHERE workspace_id = $1) as projects,
        (SELECT count(*) FROM public.milestones WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1)) as milestones,
        (SELECT count(*) FROM public.task_lists WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1)) as task_lists,
        (SELECT count(*) FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1)) as tasks,
        (SELECT count(*) FROM public.subtasks WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1))) as subtasks,
        (SELECT count(*) FROM public.task_raci_assignments WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1))) as raci
    `, [wsId]);

    console.log('\nProduction Count Verification:');
    console.log(JSON.stringify(counts[0], null, 2));

    if (
      Number(counts[0].projects) !== 3 ||
      Number(counts[0].milestones) !== 6 ||
      Number(counts[0].task_lists) !== 12 ||
      Number(counts[0].tasks) !== 24 ||
      Number(counts[0].subtasks) !== 48 ||
      Number(counts[0].raci) !== 72
    ) {
      throw new Error('Counts mismatch after normalization!');
    }

    await client.query('COMMIT;');
    console.log(`\nTransaction COMMITTED successfully. ${updatedCount} tasks updated/normalized.`);

  } catch (err) {
    await client.query('ROLLBACK;');
    console.error('\n[ROLLBACK] Normalization failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

runRepair().catch(() => process.exit(1));
