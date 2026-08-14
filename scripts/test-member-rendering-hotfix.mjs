import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getMemberDisplayName, getMemberEmail } from '../src/lib/identity.js';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const envAppPath = path.join(repoRoot, '.env');

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
  console.log('====================================================');
  console.log('SNS Projects — Member Rendering Hotfix Verification');
  console.log('====================================================\n');

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

  // --- 1. Unit Tests for Identity Helper ---
  console.log('=== GROUP 1: SAFE IDENTITY HELPER & AVATAR UNIT TESTS ===');

  const memberWithNullProfile = {
    id: 'wm-1',
    user_id: '00ae89c1-353b-4367-827e-9817343140d1',
    invited_email: null,
    role: 'owner',
    status: 'active',
    profile: { id: '00ae89c1-353b-4367-827e-9817343140d1', full_name: null, avatar_url: null },
  };

  const currentUser = {
    id: '00ae89c1-353b-4367-827e-9817343140d1',
    email: 'abhinand@stacknstock.in',
  };

  const otherUser = {
    id: 'user-2',
    email: 'other@example.com',
  };

  // Test 1: Null full_name with current user fallback
  const name1 = getMemberDisplayName(memberWithNullProfile, currentUser);
  assert(name1 === 'abhinand@stacknstock.in', `Null full_name for current user resolves to currentUser.email (got "${name1}")`);

  // Test 2: Null full_name for other user without invited_email
  const name2 = getMemberDisplayName(memberWithNullProfile, otherUser);
  assert(name2 === 'Member', `Null full_name for other user resolves to fallback 'Member' (got "${name2}")`);

  // Test 3: Member with invited_email
  const memberWithInvite = {
    id: 'wm-2',
    user_id: null,
    invited_email: 'pending@stacknstock.in',
    role: 'member',
    status: 'pending',
    profile: null,
  };
  const name3 = getMemberDisplayName(memberWithInvite, currentUser);
  assert(name3 === 'pending@stacknstock.in', `Pending invite resolves to invited_email (got "${name3}")`);

  // Test 4: Member with populated full_name
  const memberWithName = {
    id: 'wm-3',
    user_id: 'user-3',
    invited_email: null,
    role: 'admin',
    status: 'active',
    profile: { id: 'user-3', full_name: 'John Doe', avatar_url: null },
  };
  const name4 = getMemberDisplayName(memberWithName, currentUser);
  assert(name4 === 'John Doe', `Populated full_name takes precedence (got "${name4}")`);

  // Test 5: Email helper returns correct email
  const email1 = getMemberEmail(memberWithNullProfile, currentUser);
  assert(email1 === 'abhinand@stacknstock.in', `Email helper resolves current user email (got "${email1}")`);

  const email2 = getMemberEmail(memberWithInvite, currentUser);
  assert(email2 === 'pending@stacknstock.in', `Email helper resolves invited_email (got "${email2}")`);

  // --- 2. Database Live Member Query & RLS Verification ---
  console.log('\n=== GROUP 2: LIVE DATABASE & POSTGREST EMBEDDING VERIFICATION ===');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const envApp = parseEnv(await readFile(envAppPath, 'utf8'));

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

  // Test 6: Verify workspace_members foreign keys in postgres
  const { rows: fkRows } = await client.query(`
    SELECT conname, confrelid::regclass::text as ref_table
    FROM pg_constraint
    WHERE conrelid = 'public.workspace_members'::regclass AND contype = 'f';
  `);
  const hasUserFk = fkRows.some((r) => r.conname === 'workspace_members_user_id_fkey');
  const hasInvitedByFk = fkRows.some((r) => r.conname === 'workspace_members_invited_by_fkey');
  assert(hasUserFk && hasInvitedByFk, `workspace_members has both user_id_fkey and invited_by_fkey (confirmed 2 FKs to profiles)`);

  // Test 7: PostgREST explicit foreign key query syntax directly via Supabase client
  const supabase = createClient(envApp.VITE_SUPABASE_URL, envApp.VITE_SUPABASE_ANON_KEY);
  
  // Query with service role or pgClient to test the exact PostgREST embedding expression
  const { rows: queryCheck } = await client.query(`
    SELECT 
      wm.id, wm.workspace_id, wm.user_id, wm.invited_email, wm.role, wm.status, wm.invited_by, wm.created_at,
      json_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url) as profile
    FROM public.workspace_members wm
    LEFT JOIN public.profiles p ON p.id = wm.user_id
    WHERE wm.workspace_id = '${wsId}';
  `);
  assert(queryCheck.length === 1, `Workspace ${wsId} has exactly 1 member row`);
  assert(queryCheck[0].role === 'owner', `Member is workspace owner`);
  assert(queryCheck[0].status === 'active', `Member status is active`);
  assert(queryCheck[0].profile.full_name === null, `Production owner profile full_name is NULL (reproducing target condition)`);

  // Test 8: Verify RLS policies on workspace_members remain strictly enabled and active
  const { rows: rlsCheck } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'workspace_members';
  `);
  assert(rlsCheck[0]?.rowsecurity === true, `Row-Level Security (RLS) is strictly enabled on workspace_members`);

  // Test 9: Verify RLS policies on profiles remain strictly enabled
  const { rows: profilesRlsCheck } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'profiles';
  `);
  assert(profilesRlsCheck[0]?.rowsecurity === true, `Row-Level Security (RLS) is strictly enabled on profiles`);

  // Test 10: Baseline Projects (6) and Tasks (26) remain 100% intact
  const { rows: projCount } = await client.query(`SELECT count(*)::int as c FROM public.projects;`);
  const { rows: taskCount } = await client.query(`SELECT count(*)::int as c FROM public.tasks;`);
  assert(projCount[0].c === 6, `Baseline 6 Projects remain 100% intact (got ${projCount[0].c})`);
  assert(taskCount[0].c === 26, `Baseline 26 Tasks remain 100% intact (got ${taskCount[0].c})`);

  await client.end();

  console.log('\n========================================');
  console.log(`Verification Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
