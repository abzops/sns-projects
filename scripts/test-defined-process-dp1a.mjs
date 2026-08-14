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

async function runTests() {
  console.log('===============================================================');
  console.log('SNS Projects — DP-1-A Defined Process Catalog Verification');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = '') {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

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

  // Helper for role testing
  async function asRole(role, sub, fn) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if (sub) {
      await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${sub}"}'`);
    }
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }

  // 1 & 2. Check public.defined_processes and public.defined_process_versions exist
  const { rows: tables } = await client.query(`
    SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('defined_processes', 'defined_process_versions');
  `);
  const dpTable = tables.find(t => t.tablename === 'defined_processes');
  const dpvTable = tables.find(t => t.tablename === 'defined_process_versions');
  assert(!!dpTable, 'Test 1: public.defined_processes table exists');
  assert(!!dpvTable, 'Test 2: public.defined_process_versions table exists');

  // 3. RLS enabled on both
  assert(dpTable?.rowsecurity === true, 'Test 3a: RLS enabled on defined_processes');
  assert(dpvTable?.rowsecurity === true, 'Test 3b: RLS enabled on defined_process_versions');

  // 4. anon has no SELECT/INSERT/UPDATE/DELETE
  const { rows: anonGrants } = await client.query(`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name IN ('defined_processes', 'defined_process_versions') AND grantee = 'anon';
  `);
  assert(anonGrants.length === 0, 'Test 4: anon has NO table-level privileges (0 grants)');

  // 5. authenticated has SELECT only
  const { rows: authGrants } = await client.query(`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name IN ('defined_processes', 'defined_process_versions') AND grantee = 'authenticated';
  `);
  const authPrivs = authGrants.map(g => `${g.table_name}:${g.privilege_type}`);
  const hasOnlySelect = authPrivs.every(p => p.endsWith(':SELECT')) && authPrivs.length === 2;
  assert(hasOnlySelect, `Test 5: authenticated role has SELECT ONLY on both tables (${authPrivs.join(', ')})`);

  // Constraints inspection
  const { rows: dpConstraints } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'public.defined_processes'::regclass;
  `);

  const { rows: dpvConstraints } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'public.defined_process_versions'::regclass;
  `);

  // 6. unique workspace/code exists
  const uqCode = dpConstraints.find(c => c.def.includes('workspace_id') && c.def.includes('code'));
  assert(!!uqCode, 'Test 6: defined_processes unique (workspace_id, code) constraint exists');

  // 7. unique workspace/name exists
  const uqName = dpConstraints.find(c => c.def.includes('workspace_id') && c.def.includes('name'));
  assert(!!uqName, 'Test 7: defined_processes unique (workspace_id, name) constraint exists');

  // 8. source_type constraint exists
  const chkSourceType = dpConstraints.find(c => c.def.includes('source_type') && c.def.includes('manual') && c.def.includes('custom_conversion'));
  assert(!!chkSourceType, 'Test 8: source_type CHECK (manual, custom_conversion) exists');

  // 9. approval_state constraint exists
  const chkApproval = dpConstraints.find(c => c.def.includes('approval_state') && c.def.includes('pending_approval') && c.def.includes('approved'));
  assert(!!chkApproval, 'Test 9: approval_state CHECK constraint exists');

  // 10. source provenance constraint exists
  const chkProvenance = dpConstraints.find(c => c.conname === 'chk_defined_processes_source_provenance');
  assert(!!chkProvenance, 'Test 10: source provenance consistency constraint exists');

  // 11. process_owner FK exists
  const fkOwner = dpConstraints.find(c => c.def.includes('process_owner_id') && c.def.includes('profiles(id)'));
  assert(!!fkOwner, 'Test 11: process_owner_id foreign key constraint exists');

  // 12. owning department FK integrity exists (composite FK)
  const fkDeptWs = dpConstraints.find(c => c.conname === 'fk_defined_processes_dept_workspace');
  assert(!!fkDeptWs, 'Test 12: owning department workspace composite FK (department_id, workspace_id) exists');

  // 13. version_number >= 1 enforced
  const chkVersionNum = dpvConstraints.find(c => c.def.includes('version_number >= 1'));
  assert(!!chkVersionNum, 'Test 13: version_number >= 1 constraint exists');

  // 14. version status constraint exists
  const chkStatus = dpvConstraints.find(c => c.def.includes('draft') && c.def.includes('published') && c.def.includes('archived'));
  assert(!!chkStatus, 'Test 14: version status CHECK (draft, published, archived) exists');

  // 15. unique process/version number exists
  const uqProcVer = dpvConstraints.find(c => c.def.includes('defined_process_id') && c.def.includes('version_number'));
  assert(!!uqProcVer, 'Test 15: unique (defined_process_id, version_number) exists');

  // 16. unique (id, defined_process_id) exists
  const uqIdProc = dpvConstraints.find(c => c.def.includes('id') && c.def.includes('defined_process_id'));
  assert(!!uqIdProc, 'Test 16: unique (id, defined_process_id) exists for future provenance composite FK');

  // 17. single-published-version partial unique index exists
  const { rows: dpvIndexes } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'defined_process_versions';
  `);
  const idxSinglePublished = dpvIndexes.find(i => i.indexdef.includes('status = \'published\'') && i.indexdef.includes('UNIQUE'));
  assert(!!idxSinglePublished, 'Test 17: single-published-version partial unique index exists');

  // 18. publication field coherence constraint exists
  const chkPubCoherence = dpvConstraints.find(c => c.conname === 'chk_defined_process_versions_publication');
  assert(!!chkPubCoherence, 'Test 18: publication field coherence constraint exists');

  // 19. process versions FK cascade behavior is correct
  const fkProcessCascade = dpvConstraints.find(c => c.def.includes('defined_process_id') && c.def.includes('ON DELETE CASCADE'));
  assert(!!fkProcessCascade, 'Test 19: defined_process_versions ON DELETE CASCADE FK exists');

  // 20 & 21. Row counts must be exactly 0 in production
  const { rows: [{ count: dpCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_processes;`);
  const { rows: [{ count: dpvCount }] } = await client.query(`SELECT count(*)::int as count FROM public.defined_process_versions;`);
  assert(dpCount === 0, `Test 20: public.defined_processes contains exactly 0 rows (got ${dpCount})`);
  assert(dpvCount === 0, `Test 21: public.defined_process_versions contains exactly 0 rows (got ${dpvCount})`);

  // 22-25. Baseline business entities intact
  const { rows: [{ count: taskCount }] } = await client.query(`SELECT count(*)::int as count FROM public.tasks;`);
  const { rows: [{ count: tlCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_lists;`);
  const { rows: [{ count: raciCount }] } = await client.query(`SELECT count(*)::int as count FROM public.task_raci_assignments;`);
  const { rows: dupRows } = await client.query(`
    SELECT project_id, status_id, position, count(*) FROM public.tasks GROUP BY project_id, status_id, position HAVING count(*) > 1;
  `);

  assert(taskCount === 24, `Test 22: existing 24 Tasks unchanged (got ${taskCount})`);
  assert(tlCount === 12, `Test 23: existing 12 Task Lists unchanged (got ${tlCount})`);
  assert(raciCount === 72, `Test 24: existing 72 RACI assignments unchanged (got ${raciCount})`);
  assert(dupRows.length === 0, `Test 25: duplicate Kanban positions remain zero (got ${dupRows.length})`);

  console.log('\n===============================================================');
  console.log(`DP-1-A Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  await client.end();

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
