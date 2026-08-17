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

async function verifyP102DSchemaParity() {
  console.log('======================================================================');
  console.log('SNS Projects — Package 1 / P1-02D: Schema Provenance & Parity Verification');
  console.log('======================================================================\n');

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

  let envAdmin = {};
  try {
    const content = await readFile(envAdminPath, 'utf8');
    envAdmin = parseEnv(content);
  } catch (e) {}

  const isRemote = Boolean(envAdmin.SUPABASE_DB_PASSWORD && envAdmin.SUPABASE_DB_PASSWORD.trim());
  const client = new Client({
    host: isRemote ? (envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co') : '127.0.0.1',
    port: isRemote ? 5432 : 54322,
    database: 'postgres',
    user: 'postgres',
    password: isRemote ? envAdmin.SUPABASE_DB_PASSWORD : 'postgres',
    ssl: isRemote ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  console.log(`Connected to PostgreSQL (${isRemote ? 'Remote Production' : 'Local Container 54322'})\n`);

  try {
    // 1. Verify chk_tasks_defined_provenance_coherence
    console.log('--- 1. Task Provenance Constraint ---');
    const { rows: provRows } = await client.query(`
      SELECT pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'chk_tasks_defined_provenance_coherence'
        AND conrelid = 'public.tasks'::regclass;
    `);
    assert(provRows.length === 1, 'chk_tasks_defined_provenance_coherence constraint exists on public.tasks');
    const provDef = provRows[0]?.def || '';
    assert(provDef.includes('process_instance_id IS NOT NULL'), 'chk_tasks_defined_provenance_coherence accommodates process instances');
    assert(provDef.includes('process_step_id IS NULL'), 'chk_tasks_defined_provenance_coherence accommodates standalone container tasks (Class B)');

    // 2. Verify tasks_hierarchy_check
    console.log('\n--- 2. Hierarchy Check Constraint ---');
    const { rows: hierRows } = await client.query(`
      SELECT pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'tasks_hierarchy_check'
        AND conrelid = 'public.tasks'::regclass;
    `);
    assert(hierRows.length === 1, 'tasks_hierarchy_check exists on public.tasks');
    const hierDef = hierRows[0]?.def || '';
    assert(hierDef.includes('process_instance_id IS NOT NULL'), 'tasks_hierarchy_check permits phase-level process instances without task_list_id');

    // 3. Verify fk_tasks_task_list_version dropped
    console.log('\n--- 3. Foreign Key Replacement Check ---');
    const { rows: fkRows } = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conname = 'fk_tasks_task_list_version'
        AND conrelid = 'public.tasks'::regclass;
    `);
    assert(fkRows.length === 0, 'fk_tasks_task_list_version is dropped (replaced by conditional validation trigger)');

    // 4. Verify trigger trg_validate_legacy_task_list_version
    console.log('\n--- 4. Legacy Validation Trigger ---');
    const { rows: trgRows } = await client.query(`
      SELECT tgname, proname
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE tgrelid = 'public.tasks'::regclass
        AND tgname = 'trg_validate_legacy_task_list_version';
    `);
    assert(trgRows.length === 1 && trgRows[0]?.proname === 'sync_validate_legacy_task_list_version',
      'trg_validate_legacy_task_list_version trigger is installed on public.tasks calling sync_validate_legacy_task_list_version');

    // 5. Verify Dual Partial Indexes
    console.log('\n--- 5. Dual Partial Unique Indexes ---');
    const { rows: idxRows } = await client.query(`
      SELECT indexname, indexdef as def
      FROM pg_indexes
      WHERE tablename = 'tasks'
        AND schemaname = 'public'
        AND indexname IN ('uq_tasks_legacy_task_list_step', 'uq_tasks_instance_process_step');
    `);
    const legacyIdx = idxRows.find(r => r.indexname === 'uq_tasks_legacy_task_list_step');
    const instanceIdx = idxRows.find(r => r.indexname === 'uq_tasks_instance_process_step');

    assert(Boolean(legacyIdx), 'uq_tasks_legacy_task_list_step partial index exists');
    assert(legacyIdx && legacyIdx.def.includes('process_instance_id IS NULL'),
      'uq_tasks_legacy_task_list_step index is filtered WHERE process_instance_id IS NULL');

    assert(Boolean(instanceIdx), 'uq_tasks_instance_process_step partial index exists');
    assert(instanceIdx && instanceIdx.def.includes('process_instance_id IS NOT NULL'),
      'uq_tasks_instance_process_step index is filtered WHERE process_instance_id IS NOT NULL');

    // 6. Verify RPC Signatures & Overloads
    console.log('\n--- 6. RPC Function Overloads & Security ---');
    const { rows: rpcRows } = await client.query(`
      SELECT
        n.nspname,
        p.proname,
        pg_get_function_identity_arguments(p.oid) as args,
        p.prosecdef as is_sec_definer,
        p.proconfig as config
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'private')
        AND p.proname IN ('complete_responsible_part', 'reject_process_task', 'start_process_instance_internal', 'complete_responsible_part_internal', 'reject_process_task_internal')
      ORDER BY n.nspname, p.proname, p.oid;
    `);

    // Public 3-arg complete_responsible_part
    const pubComp3 = rpcRows.find(r => r.nspname === 'public' && r.proname === 'complete_responsible_part' && r.args.includes('integer'));
    assert(pubComp3 && !pubComp3.is_sec_definer, 'public.complete_responsible_part(uuid, integer, text) is SECURITY INVOKER');

    // Public 2-arg complete_responsible_part (legacy)
    const pubComp2 = rpcRows.find(r => r.nspname === 'public' && r.proname === 'complete_responsible_part' && !r.args.includes('integer'));
    assert(pubComp2 && !pubComp2.is_sec_definer, 'public.complete_responsible_part(uuid, text) legacy wrapper is SECURITY INVOKER');

    // Public 3-arg reject_process_task (legacy wrapper)
    const pubRej = rpcRows.find(r => r.nspname === 'public' && r.proname === 'reject_process_task');
    assert(pubRej && !pubRej.is_sec_definer, 'public.reject_process_task(uuid, text, date) is SECURITY INVOKER');

    // Private engines
    const privStart = rpcRows.find(r => r.nspname === 'private' && r.proname === 'start_process_instance_internal');
    const privComp = rpcRows.find(r => r.nspname === 'private' && r.proname === 'complete_responsible_part_internal');
    const privRej = rpcRows.find(r => r.nspname === 'private' && r.proname === 'reject_process_task_internal');

    assert(privStart && privStart.is_sec_definer, 'private.start_process_instance_internal is SECURITY DEFINER in private schema');
    assert(privComp && privComp.is_sec_definer, 'private.complete_responsible_part_internal is SECURITY DEFINER in private schema');
    assert(privRej && privRej.is_sec_definer, 'private.reject_process_task_internal is SECURITY DEFINER in private schema');

    // 7. Verify Zero Production / DB Test Pollution
    console.log('\n--- 7. Zero Test Row Invariant ---');
    const { rows: [{ count: piCount }] } = await client.query('SELECT count(*)::int as count FROM public.process_instances;');
    const { rows: [{ count: taskPiCount }] } = await client.query('SELECT count(*)::int as count FROM public.tasks WHERE process_instance_id IS NOT NULL;');
    assert(piCount === 0, `process_instances table contains 0 rows (found ${piCount})`);
    assert(taskPiCount === 0, `tasks table contains 0 process_instance rows (found ${taskPiCount})`);

    console.log('\n======================================================================');
    console.log(`P1-02D Parity Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('======================================================================\n');

  } finally {
    await client.end();
  }

  if (failed > 0) process.exit(1);
}

verifyP102DSchemaParity().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
