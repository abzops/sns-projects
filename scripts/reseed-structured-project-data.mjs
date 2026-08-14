import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

// 5 Core Departments Specification
const CORE_DEPARTMENTS = [
  {
    code: 'ENG',
    name: 'Engineering',
    description: 'Mechanical, electrical, automation, and hardware engineering',
    color: '#FDE215',
  },
  {
    code: 'SWIT',
    name: 'Software & IT',
    description: 'Software engineering, internal tooling, cloud infrastructure, and IT systems',
    color: '#8cc9ff',
  },
  {
    code: 'OPS',
    name: 'Operations',
    description: 'Site deployment, warehousing, installation, and field operations',
    color: '#60d394',
  },
  {
    code: 'PROC',
    name: 'Procurement',
    description: 'Vendor management, component sourcing, supply chain, and logistics',
    color: '#ffb020',
  },
  {
    code: 'COMM',
    name: 'Commercials & Partnerships',
    description: 'Business development, client relationships, commercial contracts, and partnerships',
    color: '#c084fc',
  },
];

// Structured Projects Dataset Specification
const DATASET = [
  {
    name: 'ASRS Product Development',
    description: 'Design, engineer, prototype and validate the Stack n Stock automated storage and retrieval product for controlled production release.',
    project_status: 'active',
    project_priority: 'high',
    start_date: '2026-08-01',
    target_end_date: '2026-10-31',
    color: '#FDE215',
    milestones: [
      {
        name: 'Design & Engineering',
        start_date: '2026-08-01',
        end_date: '2026-09-05',
        position: 0,
        task_lists: [
          {
            name: 'Mechanical Design',
            position: 0,
            tasks: [
              {
                title: 'Freeze Container & Rack Layout',
                priority: 'high',
                status_code: 'done',
                due_date: '2026-08-10',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                ],
                subtasks: [
                  { title: 'Confirm container envelope and access clearances', status: 'done', position: 0 },
                  { title: 'Freeze rack interfaces and installation points', status: 'done', position: 1 },
                ],
              },
              {
                title: 'Finalize Bin & Compartment Design',
                priority: 'high',
                status_code: 'in_progress',
                due_date: '2026-08-24',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                ],
                subtasks: [
                  { title: 'Review bin loading and compartment combinations', status: 'done', position: 0 },
                  { title: 'Release final production drawing', status: 'in_progress', position: 1 },
                ],
              },
            ],
          },
          {
            name: 'Electrical & Controls',
            position: 1,
            tasks: [
              {
                title: 'Freeze PLC I/O Map',
                priority: 'high',
                status_code: 'in_review',
                due_date: '2026-08-20',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'SWIT' },
                ],
                subtasks: [
                  { title: 'Consolidate motor and sensor I/O', status: 'done', position: 0 },
                  { title: 'Review safety and interlock signals', status: 'in_progress', position: 1 },
                ],
              },
              {
                title: 'Finalize Electrical Panel BOM',
                priority: 'medium',
                status_code: 'todo',
                due_date: '2026-09-02',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'PROC' },
                ],
                subtasks: [
                  { title: 'Freeze control component specifications', status: 'todo', position: 0 },
                  { title: 'Complete sourcing-ready BOM', status: 'todo', position: 1 },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'Prototype & Validation',
        start_date: '2026-09-06',
        end_date: '2026-10-31',
        position: 1,
        task_lists: [
          {
            name: 'Prototype Build',
            position: 0,
            tasks: [
              {
                title: 'Release Manufacturing Package',
                priority: 'high',
                status_code: 'todo',
                due_date: '2026-09-15',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                  { role: 'I', dept_code: 'PROC' },
                ],
                subtasks: [
                  { title: 'Release approved mechanical drawings', status: 'todo', position: 0 },
                  { title: 'Release electrical manufacturing pack', status: 'todo', position: 1 },
                ],
              },
              {
                title: 'Assemble ASRS Prototype',
                priority: 'high',
                status_code: 'todo',
                due_date: '2026-10-05',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'PROC' },
                ],
                subtasks: [
                  { title: 'Complete mechanical assembly', status: 'todo', position: 0 },
                  { title: 'Complete controls installation', status: 'todo', position: 1 },
                ],
              },
            ],
          },
          {
            name: 'Validation',
            position: 1,
            tasks: [
              {
                title: 'Run Integrated Functional Test',
                priority: 'urgent',
                status_code: 'todo',
                due_date: '2026-10-18',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'SWIT' },
                ],
                subtasks: [
                  { title: 'Execute retrieval and putaway scenarios', status: 'todo', position: 0 },
                  { title: 'Record performance and exception results', status: 'todo', position: 1 },
                ],
              },
              {
                title: 'Close Validation Actions & Release V1',
                priority: 'high',
                status_code: 'todo',
                due_date: '2026-10-31',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                  { role: 'I', dept_code: 'OPS' },
                ],
                subtasks: [
                  { title: 'Close critical validation observations', status: 'todo', position: 0 },
                  { title: 'Approve V1 release package', status: 'todo', position: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Warehouse Deployment Pilot',
    description: 'Plan, install, commission and hand over a Stack n Stock automated warehouse deployment through a controlled pilot implementation.',
    project_status: 'active',
    project_priority: 'critical',
    start_date: '2026-08-10',
    target_end_date: '2026-11-15',
    color: '#ffb020',
    milestones: [
      {
        name: 'Site & Deployment Planning',
        start_date: '2026-08-10',
        end_date: '2026-09-10',
        position: 0,
        task_lists: [
          {
            name: 'Site Readiness',
            position: 0,
            tasks: [
              {
                title: 'Freeze Site Layout',
                priority: 'high',
                status_code: 'done',
                due_date: '2026-08-14',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'ENG' },
                ],
                subtasks: [
                  { title: 'Confirm equipment footprint and access route', status: 'done', position: 0 },
                  { title: 'Freeze installation layout', status: 'done', position: 1 },
                ],
              },
              {
                title: 'Confirm Utility & Compliance Readiness',
                priority: 'urgent',
                status_code: 'in_progress',
                due_date: '2026-08-18',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'ENG' },
                ],
                subtasks: [
                  { title: 'Validate electrical/network requirements', status: 'in_progress', position: 0 },
                  { title: 'Close statutory/site readiness checklist', status: 'todo', position: 1 },
                ],
              },
            ],
          },
          {
            name: 'Deployment Planning',
            position: 1,
            tasks: [
              {
                title: 'Freeze Integrated Deployment Schedule',
                priority: 'high',
                status_code: 'in_review',
                due_date: '2026-08-25',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'ENG' },
                  { role: 'C', dept_code: 'PROC' },
                ],
                subtasks: [
                  { title: 'Consolidate internal workstream dates', status: 'done', position: 0 },
                  { title: 'Freeze site mobilization sequence', status: 'in_progress', position: 1 },
                ],
              },
              {
                title: 'Mobilize External Vendors',
                priority: 'medium',
                status_code: 'todo',
                due_date: '2026-09-05',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'PROC' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'OPS' },
                ],
                subtasks: [
                  { title: 'Confirm vendor scope and commercial readiness', status: 'todo', position: 0 },
                  { title: 'Confirm mobilization dates', status: 'todo', position: 1 },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'Installation & Go-Live',
        start_date: '2026-09-11',
        end_date: '2026-11-15',
        position: 1,
        task_lists: [
          {
            name: 'Installation & Commissioning',
            position: 0,
            tasks: [
              {
                title: 'Complete Mechanical Installation',
                priority: 'high',
                status_code: 'todo',
                due_date: '2026-10-10',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'ENG' },
                ],
                subtasks: [
                  { title: 'Install equipment and structural interfaces', status: 'todo', position: 0 },
                  { title: 'Complete mechanical inspection', status: 'todo', position: 1 },
                ],
              },
              {
                title: 'Commission PLC & HMI',
                priority: 'urgent',
                status_code: 'todo',
                due_date: '2026-10-25',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'ENG' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'SWIT' },
                ],
                subtasks: [
                  { title: 'Validate I/O and safety interlocks', status: 'todo', position: 0 },
                  { title: 'Complete operating sequence commissioning', status: 'todo', position: 1 },
                ],
              },
            ],
          },
          {
            name: 'Acceptance & Handover',
            position: 1,
            tasks: [
              {
                title: 'Complete Site Acceptance Test',
                priority: 'urgent',
                status_code: 'todo',
                due_date: '2026-11-05',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'ENG' },
                  { role: 'C', dept_code: 'SWIT' },
                ],
                subtasks: [
                  { title: 'Execute agreed SAT scenarios', status: 'todo', position: 0 },
                  { title: 'Close critical SAT observations', status: 'todo', position: 1 },
                ],
              },
              {
                title: 'Train Operations Team & Go Live',
                priority: 'high',
                status_code: 'todo',
                due_date: '2026-11-15',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'I', dept_code: 'COMM' },
                ],
                subtasks: [
                  { title: 'Complete operator/admin training', status: 'todo', position: 0 },
                  { title: 'Complete go-live handover and stabilization checklist', status: 'todo', position: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'SNS Projects Internal Rollout',
    description: 'Configure and adopt SNS Projects as Stack n Stock\'s internal project execution, responsibility and executive visibility platform.',
    project_status: 'active',
    project_priority: 'medium',
    start_date: '2026-08-14',
    target_end_date: '2026-09-15',
    color: '#60d394',
    milestones: [
      {
        name: 'Organization & Governance',
        start_date: '2026-08-14',
        end_date: '2026-08-25',
        position: 0,
        task_lists: [
          {
            name: 'Organization Setup',
            position: 0,
            tasks: [
              {
                title: 'Configure Department Structure',
                priority: 'high',
                status_code: 'done',
                due_date: '2026-08-16',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                ],
                subtasks: [
                  { title: 'Create core department records', status: 'done', position: 0 },
                  { title: 'Validate department workspace visibility', status: 'done', position: 1 },
                ],
              },
              {
                title: 'Onboard Core Users',
                priority: 'high',
                status_code: 'in_progress',
                due_date: '2026-08-22',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                ],
                subtasks: [
                  { title: 'Invite initial users', status: 'in_progress', position: 0 },
                  { title: 'Verify workspace access and profiles', status: 'todo', position: 1 },
                ],
              },
            ],
          },
          {
            name: 'Governance',
            position: 1,
            tasks: [
              {
                title: 'Configure System Roles',
                priority: 'medium',
                status_code: 'in_progress',
                due_date: '2026-08-20',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'SWIT' },
                ],
                subtasks: [
                  { title: 'Validate executive/admin role model', status: 'done', position: 0 },
                  { title: 'Assign appropriate system roles', status: 'in_progress', position: 1 },
                ],
              },
              {
                title: 'Establish RACI Working Standard',
                priority: 'high',
                status_code: 'in_review',
                due_date: '2026-08-25',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'I', dept_code: 'COMM' },
                ],
                subtasks: [
                  { title: 'Confirm Responsible / Accountable rules', status: 'done', position: 0 },
                  { title: 'Publish internal RACI usage guidance', status: 'in_progress', position: 1 },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'Adoption & Stabilization',
        start_date: '2026-08-26',
        end_date: '2026-09-15',
        position: 1,
        task_lists: [
          {
            name: 'Pilot Adoption',
            position: 0,
            tasks: [
              {
                title: 'Configure First Live Structured Project',
                priority: 'high',
                status_code: 'todo',
                due_date: '2026-08-30',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'ENG' },
                ],
                subtasks: [
                  { title: 'Create project hierarchy', status: 'todo', position: 0 },
                  { title: 'Assign owners and RACI', status: 'todo', position: 1 },
                ],
              },
              {
                title: 'Run Team Walkthrough',
                priority: 'medium',
                status_code: 'todo',
                due_date: '2026-09-03',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'I', dept_code: 'ENG' },
                  { role: 'I', dept_code: 'SWIT' },
                  { role: 'I', dept_code: 'PROC' },
                ],
                subtasks: [
                  { title: 'Demonstrate My Work and hierarchy', status: 'todo', position: 0 },
                  { title: 'Demonstrate admin and dashboard workflows', status: 'todo', position: 1 },
                ],
              },
            ],
          },
          {
            name: 'Stabilization',
            position: 1,
            tasks: [
              {
                title: 'Close P0 / P1 Application Defects',
                priority: 'urgent',
                status_code: 'in_progress',
                due_date: '2026-09-08',
                position: 0,
                raci: [
                  { role: 'R', dept_code: 'SWIT' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'OPS' },
                ],
                subtasks: [
                  { title: 'Resolve production workflow blockers', status: 'in_progress', position: 0 },
                  { title: 'Complete regression verification', status: 'todo', position: 1 },
                ],
              },
              {
                title: 'Publish Quick User Guide & BAU Handover',
                priority: 'medium',
                status_code: 'todo',
                due_date: '2026-09-15',
                position: 1,
                raci: [
                  { role: 'R', dept_code: 'OPS' },
                  { role: 'A', use_owner: true },
                  { role: 'C', dept_code: 'SWIT' },
                ],
                subtasks: [
                  { title: 'Publish role-based quick guide', status: 'todo', position: 0 },
                  { title: 'Confirm post-launch support workflow', status: 'todo', position: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

async function main() {
  const targetWorkspaceId = process.env.TARGET_WORKSPACE_ID || 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';
  const isConfirmed = process.env.CONFIRM_PRODUCTION_RESEED === 'YES';

  console.log('===============================================================');
  console.log('SNS Projects — Structured Production Reseed Script');
  console.log('Target Workspace:', targetWorkspaceId);
  console.log('Mode:', isConfirmed ? 'DESTRUCTIVE RESEED (CONFIRMED)' : 'DRY RUN (Preview Only)');
  console.log('===============================================================\n');

  if (!targetWorkspaceId) {
    console.error('ERROR: Target Workspace ID is required.');
    process.exit(1);
  }

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

  // 1. Verify target workspace exists
  const { rows: wsRows } = await client.query('SELECT * FROM public.workspaces WHERE id = $1;', [targetWorkspaceId]);
  if (wsRows.length === 0) {
    console.error(`ERROR: Workspace ${targetWorkspaceId} not found.`);
    await client.end();
    process.exit(1);
  }

  const workspace = wsRows[0];
  console.log(`Verified workspace: "${workspace.name}" (ID: ${workspace.id})`);

  // 2. Fetch active workspace owner ID
  const { rows: ownerRows } = await client.query(`
    SELECT user_id FROM public.workspace_members
    WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'
    LIMIT 1;
  `, [targetWorkspaceId]);

  if (ownerRows.length === 0 || !ownerRows[0].user_id) {
    console.error(`ERROR: No active workspace owner found in workspace ${targetWorkspaceId}.`);
    await client.end();
    process.exit(1);
  }

  const ownerId = ownerRows[0].user_id;
  console.log(`Active Workspace Owner ID: ${ownerId}`);

  // 3. Pre-Reseed Counts & Backup
  console.log('\n--- 1. PRE-RESEED INVENTORY & BACKUP ---');
  const { rows: preProjects } = await client.query('SELECT * FROM public.projects WHERE workspace_id = $1;', [targetWorkspaceId]);
  const projIds = preProjects.map(p => p.id);

  const { rows: preMilestones } = projIds.length > 0
    ? await client.query('SELECT * FROM public.milestones WHERE project_id = ANY($1::uuid[]);', [projIds])
    : { rows: [] };

  const { rows: preTaskLists } = projIds.length > 0
    ? await client.query('SELECT * FROM public.task_lists WHERE project_id = ANY($1::uuid[]);', [projIds])
    : { rows: [] };

  const { rows: preTasks } = projIds.length > 0
    ? await client.query('SELECT * FROM public.tasks WHERE project_id = ANY($1::uuid[]);', [projIds])
    : { rows: [] };
  const taskIds = preTasks.map(t => t.id);

  const { rows: preSubtasks } = taskIds.length > 0
    ? await client.query('SELECT * FROM public.subtasks WHERE task_id = ANY($1::uuid[]);', [taskIds])
    : { rows: [] };

  const { rows: preRaci } = taskIds.length > 0
    ? await client.query('SELECT * FROM public.task_raci_assignments WHERE task_id = ANY($1::uuid[]);', [taskIds])
    : { rows: [] };

  const { rows: preStatuses } = projIds.length > 0
    ? await client.query('SELECT * FROM public.task_statuses WHERE project_id = ANY($1::uuid[]);', [projIds])
    : { rows: [] };

  const { rows: preNotifications } = await client.query('SELECT * FROM public.notifications WHERE workspace_id = $1;', [targetWorkspaceId]);

  console.log(`Pre-reset counts for workspace ${targetWorkspaceId}:`);
  console.log(`  Projects: ${preProjects.length}`);
  console.log(`  Milestones: ${preMilestones.length}`);
  console.log(`  Task Lists: ${preTaskLists.length}`);
  console.log(`  Tasks: ${preTasks.length}`);
  console.log(`  Subtasks: ${preSubtasks.length}`);
  console.log(`  RACI assignments: ${preRaci.length}`);
  console.log(`  Task statuses: ${preStatuses.length}`);
  console.log(`  Notifications: ${preNotifications.length}`);

  // Create JSON Backup
  const backupData = {
    timestamp: new Date().toISOString(),
    workspaceId: targetWorkspaceId,
    workspaceName: workspace.name,
    counts: {
      projects: preProjects.length,
      milestones: preMilestones.length,
      task_lists: preTaskLists.length,
      tasks: preTasks.length,
      subtasks: preSubtasks.length,
      raci: preRaci.length,
      statuses: preStatuses.length,
      notifications: preNotifications.length,
    },
    data: {
      projects: preProjects,
      milestones: preMilestones,
      task_lists: preTaskLists,
      tasks: preTasks,
      subtasks: preSubtasks,
      task_raci_assignments: preRaci,
      task_statuses: preStatuses,
      notifications: preNotifications,
    },
  };

  const backupDir = path.join(repoRoot, 'data-backups');
  await mkdir(backupDir, { recursive: true });
  const backupFilePath = path.join(backupDir, 'pre_structured_reseed_20260814.json');
  await writeFile(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`✅ Backup created successfully at: ${backupFilePath}`);

  if (!isConfirmed) {
    console.log('\n[DRY RUN COMPLETED] Set CONFIRM_PRODUCTION_RESEED=YES to perform actual destructive reseed.');
    await client.end();
    return;
  }

  // 4. Perform Transactional Delete + Reseed
  console.log('\n--- 2. EXECUTING TRANSACTIONAL DELETE + STRUCTURED RESEED ---');

  try {
    await client.query('BEGIN;');
    await client.query("SET LOCAL lock_timeout = '5s';");
    await client.query("SET LOCAL statement_timeout = '60s';");

    // A. Delete execution data in child -> parent order for target workspace
    console.log('Deleting notifications for target workspace...');
    await client.query('DELETE FROM public.notifications WHERE workspace_id = $1;', [targetWorkspaceId]);

    console.log('Deleting RACI assignments for target workspace tasks...');
    await client.query(`
      DELETE FROM public.task_raci_assignments
      WHERE task_id IN (
        SELECT t.id FROM public.tasks t
        JOIN public.projects p ON p.id = t.project_id
        WHERE p.workspace_id = $1
      );
    `, [targetWorkspaceId]);

    console.log('Deleting subtasks for target workspace tasks...');
    await client.query(`
      DELETE FROM public.subtasks
      WHERE task_id IN (
        SELECT t.id FROM public.tasks t
        JOIN public.projects p ON p.id = t.project_id
        WHERE p.workspace_id = $1
      );
    `, [targetWorkspaceId]);

    console.log('Deleting tasks for target workspace projects...');
    await client.query(`
      DELETE FROM public.tasks
      WHERE project_id IN (
        SELECT id FROM public.projects WHERE workspace_id = $1
      );
    `, [targetWorkspaceId]);

    console.log('Deleting task lists for target workspace projects...');
    await client.query(`
      DELETE FROM public.task_lists
      WHERE project_id IN (
        SELECT id FROM public.projects WHERE workspace_id = $1
      );
    `, [targetWorkspaceId]);

    console.log('Deleting milestones for target workspace projects...');
    await client.query(`
      DELETE FROM public.milestones
      WHERE project_id IN (
        SELECT id FROM public.projects WHERE workspace_id = $1
      );
    `, [targetWorkspaceId]);

    console.log('Deleting task statuses for target workspace projects...');
    await client.query(`
      DELETE FROM public.task_statuses
      WHERE project_id IN (
        SELECT id FROM public.projects WHERE workspace_id = $1
      );
    `, [targetWorkspaceId]);

    console.log('Deleting projects for target workspace...');
    await client.query('DELETE FROM public.projects WHERE workspace_id = $1;', [targetWorkspaceId]);

    // B. Ensure Core 5 Departments Exist & Normalize Codes/Names
    console.log('\nEnsuring core 5 Stack n Stock departments...');
    const deptIdByCode = new Map();

    for (const deptSpec of CORE_DEPARTMENTS) {
      // Check by code or name
      const { rows: existingDepts } = await client.query(`
        SELECT id, code, name FROM public.departments
        WHERE workspace_id = $1 AND (code = $2 OR name ILIKE $3);
      `, [targetWorkspaceId, deptSpec.code, deptSpec.name]);

      let deptId;
      if (existingDepts.length > 0) {
        deptId = existingDepts[0].id;
        await client.query(`
          UPDATE public.departments
          SET code = $1, name = $2, description = $3, color = $4, is_active = true, updated_at = now()
          WHERE id = $5;
        `, [deptSpec.code, deptSpec.name, deptSpec.description, deptSpec.color, deptId]);
        console.log(`  Updated department ${deptSpec.code} (${deptSpec.name}) -> ${deptId}`);
      } else {
        const { rows: newDept } = await client.query(`
          INSERT INTO public.departments (workspace_id, code, name, description, color, is_active, created_by)
          VALUES ($1, $2, $3, $4, $5, true, $6)
          RETURNING id;
        `, [targetWorkspaceId, deptSpec.code, deptSpec.name, deptSpec.description, deptSpec.color, ownerId]);
        deptId = newDept[0].id;
        console.log(`  Created department ${deptSpec.code} (${deptSpec.name}) -> ${deptId}`);
      }
      deptIdByCode.set(deptSpec.code, deptId);
    }

    // C. Insert Structured Projects, Milestones, Task Lists, Tasks, Subtasks, RACI
    let totalProjects = 0;
    let totalMilestones = 0;
    let totalTaskLists = 0;
    let totalTasks = 0;
    let totalSubtasks = 0;
    let totalRaci = 0;

    for (const projSpec of DATASET) {
      console.log(`\nInserting Project: "${projSpec.name}"...`);
      const { rows: projRows } = await client.query(`
        INSERT INTO public.projects (
          workspace_id, name, description, color, owner_id,
          start_date, target_end_date, project_status, project_priority, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $5)
        RETURNING id;
      `, [
        targetWorkspaceId,
        projSpec.name,
        projSpec.description,
        projSpec.color,
        ownerId,
        projSpec.start_date,
        projSpec.target_end_date,
        projSpec.project_status,
        projSpec.project_priority,
      ]);

      const projectId = projRows[0].id;
      totalProjects++;

      // Fetch task statuses created by trigger for this project
      const { rows: statusRows } = await client.query(`
        SELECT id, system_code FROM public.task_statuses WHERE project_id = $1;
      `, [projectId]);

      const statusIdByCode = new Map(statusRows.map(s => [s.system_code, s.id]));

      // Verify all 5 system codes exist
      for (const code of ['todo', 'in_progress', 'in_review', 'blocked', 'done']) {
        if (!statusIdByCode.has(code)) {
          throw new Error(`Missing status with system_code '${code}' for project ${projectId}`);
        }
      }

      // Insert Milestones
      for (const msSpec of projSpec.milestones) {
        const { rows: msRows } = await client.query(`
          INSERT INTO public.milestones (
            project_id, name, start_date, end_date, position, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id;
        `, [
          projectId,
          msSpec.name,
          msSpec.start_date,
          msSpec.end_date,
          msSpec.position,
          ownerId,
        ]);

        const milestoneId = msRows[0].id;
        totalMilestones++;

        // Insert Task Lists
        for (const tlSpec of msSpec.task_lists) {
          const { rows: tlRows } = await client.query(`
            INSERT INTO public.task_lists (
              milestone_id, project_id, name, position, created_by
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id;
          `, [
            milestoneId,
            projectId,
            tlSpec.name,
            tlSpec.position,
            ownerId,
          ]);

          const taskListId = tlRows[0].id;
          totalTaskLists++;

          // Insert Tasks
          for (const taskSpec of tlSpec.tasks) {
            const statusId = statusIdByCode.get(taskSpec.status_code);
            if (!statusId) {
              throw new Error(`Invalid status code '${taskSpec.status_code}' for task '${taskSpec.title}'`);
            }

            const { rows: tRows } = await client.query(`
              INSERT INTO public.tasks (
                project_id, milestone_id, task_list_id, title,
                status_id, priority, due_date, position, created_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              RETURNING id;
            `, [
              projectId,
              milestoneId,
              taskListId,
              taskSpec.title,
              statusId,
              taskSpec.priority,
              taskSpec.due_date,
              taskSpec.position,
              ownerId,
            ]);

            const taskId = tRows[0].id;
            totalTasks++;

            // Insert Subtasks (Exactly 2)
            for (const stSpec of taskSpec.subtasks) {
              await client.query(`
                INSERT INTO public.subtasks (
                  task_id, title, status, position, created_by
                )
                VALUES ($1, $2, $3, $4, $5);
              `, [
                taskId,
                stSpec.title,
                stSpec.status,
                stSpec.position,
                ownerId,
              ]);
              totalSubtasks++;
            }

            // Insert RACI assignments
            for (const raciSpec of taskSpec.raci) {
              const targetUserId = raciSpec.use_owner ? ownerId : null;
              const targetDeptId = raciSpec.dept_code ? deptIdByCode.get(raciSpec.dept_code) : null;

              if (!targetUserId && !targetDeptId) {
                throw new Error(`RACI spec must have user or department for role ${raciSpec.role}`);
              }

              await client.query(`
                INSERT INTO public.task_raci_assignments (
                  task_id, raci_role, user_id, department_id, created_by
                )
                VALUES ($1, $2, $3, $4, $5);
              `, [
                taskId,
                raciSpec.role,
                targetUserId,
                targetDeptId,
                ownerId,
              ]);
              totalRaci++;
            }
          }
        }
      }
    }

    // D. Clean synthetic notifications generated during reseed
    console.log('\nCleaning synthetic notifications created during reseed...');
    await client.query('DELETE FROM public.notifications WHERE workspace_id = $1;', [targetWorkspaceId]);

    // Commit Transaction
    await client.query('COMMIT;');
    console.log('✅ TRANSACTION COMMITTED SUCCESSFULLY.');

    console.log('\n--- 3. RESEED SUMMARY ---');
    console.log(`  Projects Created: ${totalProjects} (Expected: 3)`);
    console.log(`  Milestones Created: ${totalMilestones} (Expected: 6)`);
    console.log(`  Task Lists Created: ${totalTaskLists} (Expected: 12)`);
    console.log(`  Tasks Created: ${totalTasks} (Expected: 24)`);
    console.log(`  Subtasks Created: ${totalSubtasks} (Expected: 48)`);
    console.log(`  RACI Assignments Created: ${totalRaci}`);

  } catch (err) {
    console.error('❌ RESEED FAILED. ROLLING BACK TRANSACTION...', err);
    await client.query('ROLLBACK;');
    await client.end();
    process.exit(1);
  }

  await client.end();
}

main().catch(console.error);
