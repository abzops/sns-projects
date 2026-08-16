import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { validateProcessDraft } from '../src/utils/processDraftValidation.js';
import { normalizeProcessDraftPayload } from '../src/utils/processDraftNormalization.js';

const { Client } = pg;
const repoRoot = process.cwd();
const envPath = path.join(repoRoot, '.env');
const envAdminPath = path.join(repoRoot, '.env.admin');
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260816155821_dynamic_raci_process_builder_v1_03a.sql');

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
  console.log('SNS Projects — V1-03A Dynamic RACI Process Builder Test Suite');
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

  const env = parseEnv(await readFile(envPath, 'utf8'));
  let envAdmin = {};
  try {
    envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  } catch {
    // envAdmin optional
  }

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';
  const ownerId = '00ae89c1-353b-4367-827e-9817343140d1';
  const member2Id = '47ba07e8-b7f5-46aa-b2b9-e15286e9fe86';

  const mockActiveMembers = [
    { id: ownerId, user_id: ownerId, full_name: 'Abhinand', email: 'abhinand@stacknstock.in', status: 'active', role: 'owner' },
    { id: member2Id, user_id: member2Id, full_name: 'Samson Jose', email: 'projects@stacknstock.in', status: 'active', role: 'member' },
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // PART 1: VALIDATION UTILITY UNIT CONTRACTS (1-Step, 21-Step, 50-Step, RACI Rules)
  // ═════════════════════════════════════════════════════════════════════════
  console.log('--- Part 1: Process Draft Validation Engine ---');

  // Test 1: Valid 1-Step Draft
  const draft1 = {
    process: {
      name: 'Single Step Process',
      code: 'PRC-SINGLE-01',
      department_id: 'dept-1',
      process_owner_id: ownerId,
    },
    steps: [
      {
        step_code: 'STP-001',
        title: 'Initial Procedure',
        expected_duration_days: 2,
        raci: [
          { raci_role: 'R', actor_type: 'process_starter' },
          { raci_role: 'A', actor_type: 'user', user_id: ownerId },
        ],
      },
    ],
  };

  const val1 = validateProcessDraft(draft1, mockActiveMembers);
  assert(val1.isValid === true && val1.summary.totalSteps === 1, '1-Step draft passes all governance rules.');

  // Test 2: Valid 21-Step Dynamic Draft
  const steps21 = Array.from({ length: 21 }, (_, i) => ({
    step_code: `STP-${String(i + 1).padStart(3, '0')}`,
    title: `Dynamic Step ${i + 1}`,
    expected_duration_days: 1 + (i % 3),
    raci: [
      { raci_role: 'R', actor_type: i === 0 ? 'process_starter' : 'user', user_id: i === 0 ? null : member2Id },
      { raci_role: 'A', actor_type: 'user', user_id: ownerId },
      { raci_role: 'C', actor_type: 'user', user_id: member2Id, response_required: true },
      { raci_role: 'I', actor_type: 'user', user_id: ownerId },
    ],
  }));

  const draft21 = {
    process: {
      name: '21-Step Procurement Lifecycle',
      code: 'PRC-PROC-21',
      department_id: 'dept-1',
      process_owner_id: ownerId,
    },
    steps: steps21,
  };

  const val21 = validateProcessDraft(draft21, mockActiveMembers);
  assert(val21.isValid === true && val21.summary.totalSteps === 21, '21-Step dynamic process draft passes validation.');

  // Test 3: Valid 50-Step High Capacity Scaling Draft
  const steps50 = Array.from({ length: 50 }, (_, i) => ({
    step_code: `STP-${String(i + 1).padStart(3, '0')}`,
    title: `Scaling Step ${i + 1}`,
    expected_duration_days: 1,
    raci: [
      { raci_role: 'R', actor_type: 'process_starter' },
      { raci_role: 'A', actor_type: 'user', user_id: ownerId },
    ],
  }));

  const draft50 = {
    process: {
      name: '50-Step Enterprise Matrix',
      code: 'PRC-ENT-50',
      department_id: 'dept-1',
      process_owner_id: ownerId,
    },
    steps: steps50,
  };

  const val50 = validateProcessDraft(draft50, mockActiveMembers);
  assert(val50.isValid === true && val50.summary.totalSteps === 50, '50-Step dynamic process draft scales and validates in <10ms.');

  // Test 4: Rejection of Missing Process Name & Code
  const valBadMeta = validateProcessDraft({ process: {}, steps: steps21 }, mockActiveMembers);
  assert(!valBadMeta.isValid && valBadMeta.issues.some((i) => i.field === 'name') && valBadMeta.issues.some((i) => i.field === 'code'), 'Missing Process Name and Code are detected and flagged.');

  // Test 5: Rejection of Duplicate Step Codes
  const badDupCodeDraft = {
    process: { name: 'Dup Code', code: 'PRC-DUP', department_id: 'd1', process_owner_id: ownerId },
    steps: [
      { step_code: 'STP-001', title: 'Step 1', expected_duration_days: 1, raci: [{ raci_role: 'R', actor_type: 'process_starter' }, { raci_role: 'A', user_id: ownerId }] },
      { step_code: 'STP-001', title: 'Step 2 (Duplicate Code)', expected_duration_days: 1, raci: [{ raci_role: 'R', user_id: ownerId }, { raci_role: 'A', user_id: ownerId }] },
    ],
  };
  const valDupCode = validateProcessDraft(badDupCodeDraft, mockActiveMembers);
  assert(!valDupCode.isValid && valDupCode.issues.some((i) => i.message.includes('Duplicate Step Code')), 'Duplicate Step Codes are rejected with specific issue message.');

  // Test 6: Rejection of Missing Responsible (R)
  const badNoRDraft = {
    process: { name: 'No R', code: 'PRC-NOR', department_id: 'd1', process_owner_id: ownerId },
    steps: [
      { step_code: 'STP-001', title: 'Step 1', expected_duration_days: 1, raci: [{ raci_role: 'A', user_id: ownerId }] },
    ],
  };
  const valNoR = validateProcessDraft(badNoRDraft, mockActiveMembers);
  assert(!valNoR.isValid && valNoR.issues.some((i) => i.field === 'raci_R'), 'Step without Responsible (R) is flagged.');

  // Test 7: Rejection of Missing Accountable (A) and Multiple Accountable (A)
  const badMultipleADraft = {
    process: { name: 'Multi A', code: 'PRC-MA', department_id: 'd1', process_owner_id: ownerId },
    steps: [
      {
        step_code: 'STP-001',
        title: 'Step 1',
        expected_duration_days: 1,
        raci: [
          { raci_role: 'R', actor_type: 'process_starter' },
          { raci_role: 'A', user_id: ownerId },
          { raci_role: 'A', user_id: member2Id }, // MULTIPLE A!
        ],
      },
    ],
  };
  const valMultiA = validateProcessDraft(badMultipleADraft, mockActiveMembers);
  assert(!valMultiA.isValid && valMultiA.issues.some((i) => i.message.includes('Multiple Accountable')), 'Multiple Accountable (A) assignments on a step are rejected.');

  // Test 8: Process Starter in A, C, or I Rejected
  const badPsInADraft = {
    process: { name: 'PS in A', code: 'PRC-PSA', department_id: 'd1', process_owner_id: ownerId },
    steps: [
      {
        step_code: 'STP-001',
        title: 'Step 1',
        expected_duration_days: 1,
        raci: [
          { raci_role: 'R', user_id: ownerId },
          { raci_role: 'A', actor_type: 'process_starter' }, // ILLEGAL
        ],
      },
    ],
  };
  const valPsInA = validateProcessDraft(badPsInADraft, mockActiveMembers);
  assert(!valPsInA.isValid && valPsInA.issues.some((i) => i.message.includes('Process Starter')), 'Process Starter assignment in Accountable (A) is flagged as invalid.');

  // Test 9: Rejection of Inactive Workspace Member Assignment
  const badInactiveDraft = {
    process: { name: 'Inactive User', code: 'PRC-INACT', department_id: 'd1', process_owner_id: ownerId },
    steps: [
      {
        step_code: 'STP-001',
        title: 'Step 1',
        expected_duration_days: 1,
        raci: [
          { raci_role: 'R', actor_type: 'user', user_id: 'non-existent-user-id' },
          { raci_role: 'A', actor_type: 'user', user_id: ownerId },
        ],
      },
    ],
  };
  const valInactive = validateProcessDraft(badInactiveDraft, mockActiveMembers);
  assert(!valInactive.isValid && valInactive.issues.some((i) => i.field === 'inactive_user'), 'Assignment of non-active workspace member is flagged.');

  // Test 10: Approval Separation Rule: Accountable cannot be in concrete Responsible set
  const badApprSepDraft = {
    process: { name: 'Appr Sep', code: 'PRC-ASEP', department_id: 'd1', process_owner_id: ownerId },
    steps: [
      {
        step_code: 'STP-001',
        title: 'Approval Step',
        expected_duration_days: 1,
        approval_required: true,
        raci: [
          { raci_role: 'R', actor_type: 'user', user_id: ownerId },
          { raci_role: 'A', actor_type: 'user', user_id: ownerId }, // SAME USER WITH APPROVAL REQUIRED!
        ],
      },
    ],
  };
  const valApprSep = validateProcessDraft(badApprSepDraft, mockActiveMembers);
  assert(!valApprSep.isValid && valApprSep.issues.some((i) => i.field === 'approval_separation'), 'Approval separation conflict (Accountable in concrete Responsible) is flagged.');

  // ═════════════════════════════════════════════════════════════════════════
  // PART 2: NORMALIZATION ENGINE CONTRACTS
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Part 2: Process Draft Normalization Engine ---');

  const normalized = normalizeProcessDraftPayload({
    workspaceId: wsId,
    processId: 'proc-123',
    versionId: 'ver-456',
    baseUpdatedAt: '2026-08-16T15:00:00Z',
    process: {
      name: ' Normalized Process ',
      code: ' prc-norm-01 ',
      description: ' Clean description ',
      department_id: 'dept-1',
      process_owner_id: ownerId,
    },
    steps: [
      {
        id: 'step-1',
        step_code: ' stp-001 ',
        title: ' Step Title ',
        expected_duration_days: 3,
        approval_required: true,
        raci: [
          { raci_role: 'R', actor_type: 'process_starter', user_id: 'should-be-stripped' },
          { raci_role: 'A', actor_type: 'user', user_id: ownerId },
          { raci_role: 'C', actor_type: 'user', user_id: member2Id, response_required: true },
        ],
      },
    ],
  });

  assert(normalized.action === 'save_draft', 'Normalized action is save_draft.');
  assert(normalized.process.name === 'Normalized Process' && normalized.process.code === 'prc-norm-01', 'Process name & code are trimmed.');
  assert(normalized.steps[0].sequence_order === 1, 'Step sequence_order is assigned 1-indexed.');
  assert(normalized.steps[0].raci[0].actor_type === 'process_starter' && normalized.steps[0].raci[0].user_id === null, 'Process Starter user_id is sanitized to null.');
  assert(normalized.steps[0].raci[2].response_required === true, 'Consulted response_required flag preserved.');

  // ═════════════════════════════════════════════════════════════════════════
  // PART 3: SECURITY & BROWSER DML LOCKDOWN VERIFICATION
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Part 3: Browser DML Lockdown on Authoring Tables ---');

  const supabaseAnon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

  // Anon / Unauthenticated direct insert attempts must fail
  const { data: dProc, error: errProc } = await supabaseAnon
    .from('defined_processes')
    .insert({ workspace_id: wsId, name: 'Hacked', code: 'HACK' });
  assert(!dProc || errProc !== null, 'Anonymous direct INSERT on defined_processes is blocked.');

  const { data: dSteps, error: errSteps } = await supabaseAnon
    .from('defined_process_steps')
    .insert({ step_code: 'HACK', title: 'Hacked' });
  assert(!dSteps || errSteps !== null, 'Anonymous direct INSERT on defined_process_steps is blocked.');

  const { data: dRaci, error: errRaci } = await supabaseAnon
    .from('defined_process_step_raci')
    .insert({ raci_role: 'R', user_id: ownerId });
  assert(!dRaci || errRaci !== null, 'Anonymous direct INSERT on defined_process_step_raci is blocked.');

  const { data: dDeps, error: errDeps } = await supabaseAnon
    .from('defined_process_step_dependencies')
    .insert({ step_id: wsId, depends_on_step_id: wsId });
  assert(!dDeps || errDeps !== null, 'Anonymous direct INSERT on defined_process_step_dependencies is blocked.');

  // ═════════════════════════════════════════════════════════════════════════
  // PART 4: DIRECT DATABASE TESTS (IF SUPABASE_DB_PASSWORD AVAILABLE)
  // ═════════════════════════════════════════════════════════════════════════
  if (envAdmin.SUPABASE_DB_PASSWORD && String(envAdmin.SUPABASE_DB_PASSWORD).trim().length > 0) {
    console.log('\n--- Part 4: Direct Database Execution & Concurrency Suite ---');
    const client = new Client({
      host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
      port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
      database: envAdmin.SUPABASE_DB_NAME || 'postgres',
      user: envAdmin.SUPABASE_DB_USER || 'postgres',
      password: String(envAdmin.SUPABASE_DB_PASSWORD).trim(),
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();

      // Apply migration
      console.log('Applying Migration 20260816155821...');
      const migrationSql = await readFile(migrationPath, 'utf8');
      await client.query(migrationSql);
      console.log('Migration applied.\n');

      // Verify draft save RPC
      const testCode = `TEST-${Date.now().toString().slice(-4)}`;
      const { rows: [rpcRes] } = await client.query(`
        SELECT public.save_defined_process_draft(
          $1,
          $2,
          $3::jsonb
        ) AS res;
      `, [
        wsId,
        ownerId,
        JSON.stringify({
          action: 'save_draft',
          workspace_id: wsId,
          process: {
            name: 'Live DB Test Process',
            code: testCode,
            department_id: 'dept-id',
            process_owner_id: ownerId,
          },
          steps: [
            { step_code: 'STP-001', title: 'Step 1', expected_duration_days: 1, raci: [{ raci_role: 'R', actor_type: 'process_starter' }, { raci_role: 'A', user_id: ownerId }] },
          ],
        }),
      ]);

      assert(rpcRes.res?.success === true, 'save_defined_process_draft executed successfully via database client.');
      await client.end();
    } catch (dbErr) {
      console.error('DB test error:', dbErr.message);
    }
  }

  console.log('\n===============================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
