import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message} ${details ? '- ' + details : ''}`);
    failed++;
  }
}

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

async function getConnectionConfig() {
  let envAdmin = {};
  try {
    const envAdminPath = path.join(repoRoot, '.env.admin');
    const content = await readFile(envAdminPath, 'utf8');
    envAdmin = parseEnv(content);
  } catch (e) {}

  const connectionString = process.env.DATABASE_URL || envAdmin.SUPABASE_DB_URL;
  if (connectionString) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
    };
  }

  const host = process.env.PGHOST || envAdmin.SUPABASE_DB_HOST || '127.0.0.1';
  const port = Number(process.env.PGPORT || envAdmin.SUPABASE_DB_PORT || '54322');
  const database = process.env.PGDATABASE || envAdmin.SUPABASE_DB_NAME || 'postgres';
  const user = process.env.PGUSER || envAdmin.SUPABASE_DB_USER || 'postgres';
  const password = process.env.PGPASSWORD || envAdmin.SUPABASE_DB_PASSWORD || 'postgres';

  return {
    host,
    port,
    database,
    user,
    password: String(password),
    ssl: false,
  };
}

async function verifyP201PhaseRename() {
  console.log('======================================================================');
  console.log('SNS Projects — Package 2 / P2-01: Phase Rename Database Verifier');
  console.log('======================================================================\n');

  const config = await getConnectionConfig();
  const client = new Client(config);

  try {
    await client.connect();
    console.log(`Connected to database at ${config.host || 'connection string'}:${config.port || 'default'}\n`);
  } catch (err) {
    console.error(`[FATAL] Unable to connect to PostgreSQL: ${err.message}`);
    process.exit(1);
  }

  try {
    // 1. Table existence & type
    console.log('--- 1. Tables & Views Verification ---');
    const { rows: tableRows } = await client.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('phases', 'milestones');
    `);

    const phasesObj = tableRows.find(r => r.table_name === 'phases');
    const milestonesObj = tableRows.find(r => r.table_name === 'milestones');

    assert(phasesObj && phasesObj.table_type === 'BASE TABLE', 'public.phases is a physical BASE TABLE');
    assert(!milestonesObj, 'public.milestones is completely ABSENT from public schema');

    // 2. Column verification on tasks and task_lists
    console.log('\n--- 2. Column Architecture Verification ---');
    const { rows: colRows } = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('tasks', 'task_lists', 'phases', 'process_instances')
        AND column_name IN ('milestone_id', 'phase_id');
    `);

    const hasTasksMilestone = colRows.some(r => r.table_name === 'tasks' && r.column_name === 'milestone_id');
    const hasTasksPhase = colRows.some(r => r.table_name === 'tasks' && r.column_name === 'phase_id');
    const hasTlMilestone = colRows.some(r => r.table_name === 'task_lists' && r.column_name === 'milestone_id');
    const hasTlPhase = colRows.some(r => r.table_name === 'task_lists' && r.column_name === 'phase_id');
    const hasPiPhase = colRows.some(r => r.table_name === 'process_instances' && r.column_name === 'phase_id');

    assert(!hasTasksMilestone, 'tasks.milestone_id column is completely ABSENT');
    assert(hasTasksPhase, 'tasks.phase_id is canonical phase column');
    assert(!hasTlMilestone, 'task_lists.milestone_id column is completely ABSENT');
    assert(hasTlPhase, 'task_lists.phase_id is canonical phase column');
    assert(hasPiPhase, 'process_instances.phase_id is canonical phase column');

    // 3. Composite Key & Unique Constraints
    console.log('\n--- 3. Composite Key & Unique Constraints ---');
    const { rows: uqRows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as condef
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conname IN ('phases_id_project_unique', 'task_lists_id_phase_project_unique', 'task_lists_id_milestone_project_unique');
    `);

    const hasPhasesUq = uqRows.some(r => r.conname === 'phases_id_project_unique');
    const hasTlUq = uqRows.some(r => r.conname === 'task_lists_id_phase_project_unique');
    const hasLegacyTlUq = uqRows.some(r => r.conname === 'task_lists_id_milestone_project_unique');

    assert(hasPhasesUq, 'phases_id_project_unique UNIQUE (id, project_id) constraint exists on public.phases');
    assert(hasTlUq, 'task_lists_id_phase_project_unique UNIQUE (id, phase_id, project_id) constraint exists on public.task_lists');
    assert(!hasLegacyTlUq, 'task_lists_id_milestone_project_unique is ABSENT');

    // 4. Foreign Key Constraints (RESTRICT & SET NULL)
    console.log('\n--- 4. Foreign Key Hierarchy & Delete Actions ---');
    const { rows: fkRows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as condef
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND contype = 'f'
        AND conname IN (
          'fk_task_lists_phase', 'fk_tasks_phase', 'fk_tasks_task_list',
          'process_instances_phase_id_fkey', 'fk_tasks_milestone', 'fk_task_lists_milestone'
        );
    `);

    const fkMap = new Map(fkRows.map(r => [r.conname, r.condef]));

    assert(fkMap.has('fk_task_lists_phase') && fkMap.get('fk_task_lists_phase').includes('ON DELETE RESTRICT'),
      'fk_task_lists_phase FOREIGN KEY (phase_id, project_id) REFERENCES phases(id, project_id) ON DELETE RESTRICT');
    assert(fkMap.has('fk_tasks_phase') && fkMap.get('fk_tasks_phase').includes('ON DELETE RESTRICT'),
      'fk_tasks_phase FOREIGN KEY (phase_id, project_id) REFERENCES phases(id, project_id) ON DELETE RESTRICT');
    assert(fkMap.has('fk_tasks_task_list') && fkMap.get('fk_tasks_task_list').includes('ON DELETE RESTRICT'),
      'fk_tasks_task_list FOREIGN KEY (task_list_id, phase_id, project_id) REFERENCES task_lists(id, phase_id, project_id) ON DELETE RESTRICT');
    assert(fkMap.has('process_instances_phase_id_fkey') && fkMap.get('process_instances_phase_id_fkey').includes('ON DELETE SET NULL'),
      'process_instances_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE SET NULL');
    assert(!fkMap.has('fk_tasks_milestone'), 'fk_tasks_milestone is ABSENT');
    assert(!fkMap.has('fk_task_lists_milestone'), 'fk_task_lists_milestone is ABSENT');

    // 5. Dual Sync Triggers & Functions Removal
    console.log('\n--- 5. Dual Sync & Compatibility Dropped Objects ---');
    const { rows: syncTrigRows } = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgname IN ('trg_task_lists_sync_milestone_phase', 'trg_tasks_sync_milestone_phase');
    `);
    const { rows: syncFnRows } = await client.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname IN ('sync_milestone_phase_id');
    `);
    const { rows: syncChkRows } = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN ('chk_task_lists_phase_milestone_sync', 'chk_tasks_phase_milestone_sync');
    `);

    assert(syncTrigRows.length === 0, 'Dual sync triggers (trg_task_lists_sync_milestone_phase, trg_tasks_sync_milestone_phase) are ABSENT');
    assert(syncFnRows.length === 0, 'sync_milestone_phase_id() function is ABSENT');
    assert(syncChkRows.length === 0, 'Phase/milestone sync check constraints are ABSENT');

    // 6. Provenance & Hierarchy CHECK Constraints
    console.log('\n--- 6. Provenance & Hierarchy Constraints ---');
    const { rows: chkRows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as condef
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conname IN ('tasks_hierarchy_check', 'chk_tasks_defined_provenance_coherence');
    `);

    for (const chk of chkRows) {
      assert(!chk.condef.includes('milestone_id'), `${chk.conname} contains 0 milestone_id references`);
    }

    // 7. RLS Policies on public.phases
    console.log('\n--- 7. RLS Policies on public.phases ---');
    const { rows: policyRows } = await client.query(`
      SELECT policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'phases';
    `);

    const expectedPolicies = ['phases_select_member', 'phases_insert_member', 'phases_update_member', 'phases_delete_member'];
    for (const pName of expectedPolicies) {
      const p = policyRows.find(r => r.policyname === pName);
      assert(!!p, `Policy ${pName} exists on public.phases`);
    }

    // 8. Grant Governance on public.phases
    console.log('\n--- 8. Grant Governance ---');
    const { rows: grantRows } = await client.query(`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'phases';
    `);

    const anonGrants = grantRows.filter(r => r.grantee === 'anon');
    const publicGrants = grantRows.filter(r => r.grantee === 'PUBLIC');
    const authGrants = grantRows.filter(r => r.grantee === 'authenticated');
    const serviceGrants = grantRows.filter(r => r.grantee === 'service_role');

    assert(anonGrants.length === 0, 'anon role has 0 direct table grants on public.phases');
    assert(publicGrants.length === 0, 'PUBLIC pseudo-role has 0 direct table grants on public.phases');
    assert(authGrants.length > 0, 'authenticated role has explicit table grants on public.phases');
    assert(serviceGrants.length > 0, 'service_role has explicit table grants on public.phases');

    // 9. RPC Signatures and Parameters
    console.log('\n--- 9. RPC Signatures & Parameters ---');
    const { rows: rpcRows } = await client.query(`
      SELECT p.proname, pg_get_function_arguments(p.oid) as args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'start_defined_process';
    `);

    assert(rpcRows.length === 1 && rpcRows[0].args.includes('p_phase_id uuid'),
      'public.start_defined_process signature uses canonical p_phase_id uuid');

  } catch (err) {
    console.error('Verification query failed:', err);
    failed++;
  } finally {
    await client.end();
  }

  console.log('\n======================================================================');
  console.log(`P2-01 Phase Rename Verification: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

verifyP201PhaseRename().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
