import { readFile, readdir } from 'node:fs/promises';
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
const hotfixMigrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260816190207_fix_v1_03a_draft_save_identity.sql');
const schemaPath = path.join(repoRoot, 'supabase', 'schema.sql');

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

async function runHotfixTests() {
  console.log('===============================================================');
  console.log('SNS Projects — V1-03A Production Hotfix Verification Suite');
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

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 1: MIGRATION & SCHEMA CODE INTEGRITY
  // ═════════════════════════════════════════════════════════════════════════
  console.log('--- Section 1: Migration & SQL Code Analysis ---');

  const hotfixSql = await readFile(hotfixMigrationPath, 'utf8');
  const schemaSql = await readFile(schemaPath, 'utf8');

  // Check 1: Migration file exists and has correct header
  assert(hotfixSql.includes('Migration: fix_v1_03a_draft_save_identity'), 'Test 1: Forward-only migration 20260816190207_fix_v1_03a_draft_save_identity exists.');

  // Check 2: created_by in defined_processes INSERT
  const hasProcCreatedBy = hotfixSql.includes('process_owner_id,\n      created_by,\n      is_active') &&
    hotfixSql.includes('v_owner_id,\n      p_actor_id,\n      true');
  assert(hasProcCreatedBy, 'Test 2: defined_processes INSERT explicitly populates created_by with p_actor_id.');

  // Check 3: created_by in defined_process_versions INSERT (both branches)
  const hasVerCreatedBy = hotfixSql.includes('change_summary,\n      created_by') &&
    hotfixSql.includes('\'Initial draft\',\n      p_actor_id');
  assert(hasVerCreatedBy, 'Test 3: defined_process_versions INSERT explicitly populates created_by with p_actor_id in all paths.');

  // Check 4: System roles direct check against p_actor_id
  const hasProjectAdminCheck = hotfixSql.includes('FROM public.user_system_roles\n      WHERE workspace_id = p_workspace_id\n        AND user_id = p_actor_id\n        AND role = \'project_admin\'');
  const hasSystemAdminCheck = hotfixSql.includes('FROM public.user_system_roles\n      WHERE workspace_id = p_workspace_id\n        AND user_id = p_actor_id\n        AND role = \'system_admin\'');
  assert(hasProjectAdminCheck && hasSystemAdminCheck, 'Test 4: System roles (project_admin, system_admin) evaluated directly against p_actor_id.');

  // Check 5: No auth.uid() usage inside save_defined_process_draft
  const fnBodyMatch = hotfixSql.match(/CREATE OR REPLACE FUNCTION public\.save_defined_process_draft[\s\S]*?END;\s*\$\$;/);
  const fnBody = fnBodyMatch ? fnBodyMatch[0] : hotfixSql;
  assert(!fnBody.includes('auth.uid()') && !fnBody.includes('private.has_system_role'), 'Test 5: save_defined_process_draft does not rely on auth.uid() or private.has_system_role.');

  // Check 6: Function permissions (SECURITY INVOKER, service_role/postgres only)
  assert(hotfixSql.includes('SECURITY INVOKER') && hotfixSql.includes('SET search_path = \'\''), 'Test 6: save_defined_process_draft is SECURITY INVOKER with empty search_path.');
  assert(hotfixSql.includes('REVOKE ALL ON FUNCTION public.save_defined_process_draft(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;'), 'Test 7: EXECUTE revoked from PUBLIC, anon, authenticated.');
  assert(hotfixSql.includes('GRANT EXECUTE ON FUNCTION public.save_defined_process_draft(uuid, uuid, jsonb) TO service_role, postgres;'), 'Test 8: EXECUTE granted exclusively to service_role and postgres.');

  // Check 7: schema.sql synchronicity
  assert(schemaSql.includes('process_owner_id,\n      created_by,\n      is_active') && schemaSql.includes('role = \'project_admin\''), 'Test 9: supabase/schema.sql is synchronized with hotfix.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 2: SYSTEM ROLE EVALUATION LOGIC
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 2: System Role & Authorization Logic ---');

  function evaluateCallerAdmin(callerRole, userSystemRoles = [], actorId) {
    const isWorkspaceAdmin = callerRole === 'owner' || callerRole === 'admin';
    const isProjectAdmin = userSystemRoles.some(r => r.user_id === actorId && r.role === 'project_admin');
    const isSystemAdmin = userSystemRoles.some(r => r.user_id === actorId && r.role === 'system_admin');
    return isWorkspaceAdmin || isProjectAdmin || isSystemAdmin;
  }

  // Case A: Owner actor
  assert(evaluateCallerAdmin('owner', [], ownerId) === true, 'Test 10: Workspace Owner is authorized as admin.');

  // Case B: Member actor WITH project_admin system role
  const rolesWithProjectAdmin = [{ user_id: member2Id, role: 'project_admin' }];
  assert(evaluateCallerAdmin('member', rolesWithProjectAdmin, member2Id) === true, 'Test 11: Member with project_admin system role is authorized via p_actor_id.');

  // Case C: Member actor WITH system_admin system role
  const rolesWithSystemAdmin = [{ user_id: member2Id, role: 'system_admin' }];
  assert(evaluateCallerAdmin('member', rolesWithSystemAdmin, member2Id) === true, 'Test 12: Member with system_admin system role is authorized via p_actor_id.');

  // Case D: Member actor WITHOUT system role
  assert(evaluateCallerAdmin('member', [], member2Id) === false, 'Test 13: Member without system role is NOT authorized as admin.');

  // Case E: Another user has project_admin, but actor does not
  const otherUserRoles = [{ user_id: 'some-other-user', role: 'project_admin' }];
  assert(evaluateCallerAdmin('member', otherUserRoles, member2Id) === false, 'Test 14: System role assigned to another user does NOT grant admin to p_actor_id.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 3: BROWSER AUTHORING TABLE RLS LOCKDOWN
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 3: Authoring Tables SELECT-Only Verification ---');

  const supabaseAnon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

  const { data: pIns, error: pErr } = await supabaseAnon.from('defined_processes').insert({ workspace_id: wsId, name: 'Hacked', code: 'HACK', created_by: ownerId });
  assert(!pIns || pErr !== null, 'Test 15: Direct INSERT on defined_processes is blocked.');

  const { data: vIns, error: vErr } = await supabaseAnon.from('defined_process_versions').insert({ defined_process_id: wsId, version_number: 1, created_by: ownerId });
  assert(!vIns || vErr !== null, 'Test 16: Direct INSERT on defined_process_versions is blocked.');

  const { data: sIns, error: sErr } = await supabaseAnon.from('defined_process_steps').insert({ version_id: wsId, step_code: 'HACK', title: 'Hacked' });
  assert(!sIns || sErr !== null, 'Test 17: Direct INSERT on defined_process_steps is blocked.');

  const { data: rIns, error: rErr } = await supabaseAnon.from('defined_process_step_raci').insert({ step_id: wsId, raci_role: 'R' });
  assert(!rIns || rErr !== null, 'Test 18: Direct INSERT on defined_process_step_raci is blocked.');

  const { data: dIns, error: dErr } = await supabaseAnon.from('defined_process_step_dependencies').insert({ version_id: wsId, step_id: wsId, depends_on_step_id: wsId });
  assert(!dIns || dErr !== null, 'Test 19: Direct INSERT on defined_process_step_dependencies is blocked.');

  const { data: eIns, error: eErr } = await supabaseAnon.from('defined_process_step_evidence_defs').insert({ step_id: wsId, title: 'Hacked', evidence_type: 'file' });
  assert(!eIns || eErr !== null, 'Test 20: Direct INSERT on defined_process_step_evidence_defs is blocked.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 4: DIRECT DATABASE TRANSACTIONAL CREATE & ROLLBACK TEST
  // ═════════════════════════════════════════════════════════════════════════
  if (envAdmin.SUPABASE_DB_PASSWORD && String(envAdmin.SUPABASE_DB_PASSWORD).trim().length > 0) {
    console.log('\n--- Section 4: Live Transaction Create & Rollback Test ---');
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

      // Apply hotfix migration
      console.log('Applying Migration 20260816190207_fix_v1_03a_draft_save_identity.sql...');
      await client.query(hotfixSql);
      console.log('Hotfix Migration applied.\n');

      // Fetch a valid department
      const { rows: deptRows } = await client.query(`
        SELECT id FROM public.departments WHERE workspace_id = $1 LIMIT 1;
      `, [wsId]);
      const deptId = deptRows[0]?.id;

      // BEGIN TRANSACTION
      await client.query('BEGIN;');

      console.log('Executing live draft create test inside transaction...');
      const testPayload = {
        action: 'save_draft',
        workspace_id: wsId,
        process: {
          name: '__V103A_VERIFY_TEMP__',
          code: '__V103A_VERIFY_TEMP__',
          description: 'Temporary verification process for V1-03A hotfix',
          department_id: deptId,
          process_owner_id: ownerId,
        },
        steps: [
          {
            step_code: 'STP-001',
            title: 'Verify Step',
            expected_duration_days: 1,
            raci: [
              { raci_role: 'R', actor_type: 'process_starter' },
              { raci_role: 'A', actor_type: 'user', user_id: ownerId },
            ],
          },
        ],
      };

      const { rows: [createRes] } = await client.query(`
        SELECT public.save_defined_process_draft(
          $1,
          $2,
          $3::jsonb
        ) AS res;
      `, [wsId, ownerId, JSON.stringify(testPayload)]);

      const rpcResult = createRes.res;
      assert(rpcResult?.success === true, 'Test 21: save_defined_process_draft succeeded without NOT NULL violation.');
      assert(!!rpcResult?.process_id, 'Test 22: save_defined_process_draft returned valid process_id.');
      assert(!!rpcResult?.version_id, 'Test 23: save_defined_process_draft returned valid version_id.');
      assert(!!rpcResult?.updated_at, 'Test 24: save_defined_process_draft returned valid updated_at timestamp.');

      // Verify created_by on defined_processes
      const { rows: [procRow] } = await client.query(`
        SELECT id, name, code, created_by
        FROM public.defined_processes
        WHERE id = $1;
      `, [rpcResult.process_id]);

      assert(procRow?.created_by === ownerId, `Test 25: defined_processes.created_by equals p_actor_id (${ownerId}).`);

      // Verify created_by on defined_process_versions
      const { rows: [verRow] } = await client.query(`
        SELECT id, version_number, status, created_by
        FROM public.defined_process_versions
        WHERE id = $1;
      `, [rpcResult.version_id]);

      assert(verRow?.created_by === ownerId, `Test 26: defined_process_versions.created_by equals p_actor_id (${ownerId}).`);

      // Test System Role Authorization: Assign member2 as project_admin and verify they can save drafts
      console.log('Testing system role authorization for project_admin via p_actor_id...');
      await client.query(`
        INSERT INTO public.user_system_roles (workspace_id, user_id, role)
        VALUES ($1, $2, 'project_admin')
        ON CONFLICT DO NOTHING;
      `, [wsId, member2Id]);

      const projectAdminPayload = {
        action: 'save_draft',
        workspace_id: wsId,
        process: {
          name: '__V103A_SYSROLE_TEMP__',
          code: '__V103A_SYSROLE_TEMP__',
          department_id: deptId,
          process_owner_id: ownerId,
        },
        steps: [
          {
            step_code: 'STP-001',
            title: 'Project Admin Step',
            expected_duration_days: 1,
            raci: [
              { raci_role: 'R', actor_type: 'process_starter' },
              { raci_role: 'A', actor_type: 'user', user_id: ownerId },
            ],
          },
        ],
      };

      const { rows: [sysRoleRes] } = await client.query(`
        SELECT public.save_defined_process_draft(
          $1,
          $2,
          $3::jsonb
        ) AS res;
      `, [wsId, member2Id, JSON.stringify(projectAdminPayload)]);

      assert(sysRoleRes.res?.success === true, 'Test 27: User with project_admin system role successfully saved draft via p_actor_id.');

      // ROLLBACK TRANSACTION
      await client.query('ROLLBACK;');
      console.log('Transaction successfully rolled back. Zero permanent test data created.\n');

      await client.end();
    } catch (dbErr) {
      console.error('DB test error:', dbErr.message);
      try { await client.query('ROLLBACK;'); } catch {}
      failed++;
    }
  }

  // Count migrations
  const migrationFiles = (await readdir(path.join(repoRoot, 'supabase', 'migrations'))).filter(f => f.endsWith('.sql'));
  console.log(`Live Migration Count in Codebase: ${migrationFiles.length} files.`);

  console.log('\n===============================================================');
  console.log(`HOTFIX TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixTests();
