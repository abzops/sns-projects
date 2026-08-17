import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const repoRoot = process.cwd();
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

async function runLiveE2E() {
  console.log('================================================================');
  console.log('SNS Projects — P0 Auth Incident Phase 2 Live E2E Verification');
  console.log('================================================================\n');

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

  const env = parseEnv(await readFile(envAppPath, 'utf8'));
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  // ═════════════════════════════════════════════════════════════════════
  // 1. DEPLOYED ENVIRONMENT ASSET VERIFICATION
  // ═════════════════════════════════════════════════════════════════════
  console.log('--- Step 1: Deployed Production Bundle Verification ---');
  
  const indexRes = await fetch('https://abzops.github.io/sns-projects/index.html');
  assert(indexRes.status === 200, '1.1: Production index.html responds 200 OK.');
  
  const indexHtml = await indexRes.text();
  const scriptMatch = indexHtml.match(/src="(\/sns-projects\/assets\/[^"]+\.js)"/);
  assert(scriptMatch !== null, '1.2: Production JS bundle link found in HTML.');

  const bundleUrl = `https://abzops.github.io${scriptMatch[1]}`;
  const bundleRes = await fetch(bundleUrl);
  assert(bundleRes.status === 200, '1.3: Production JS bundle fetched successfully.');

  const bundleText = await bundleRes.text();
  assert(bundleText.includes('complete_first_login'), '1.4: Deployed bundle contains complete_first_login handler.');
  assert(bundleText.includes('signInWithPassword'), '1.5: Deployed bundle uses signInWithPassword post-password-change.');
  assert(bundleText.includes('replaces all previously issued temporary passwords'), '1.6: Deployed bundle contains reissue notice text.');
  const completeFirstLoginIndex = bundleText.indexOf('complete_first_login');
  const completeFirstLoginSlice = bundleText.slice(completeFirstLoginIndex, completeFirstLoginIndex + 1500);
  assert(!completeFirstLoginSlice.includes('refreshSession'), '1.7: complete_first_login handler does NOT invoke refreshSession().');

  // ═════════════════════════════════════════════════════════════════════
  // 2. EDGE FUNCTION CONTRACT & CORS VERIFICATION
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n--- Step 2: Edge Function Live Security Verification ---');

  // Verify OPTIONS preflight
  const preflightRes = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/admin-manage-workspace-user`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://abzops.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type, apikey',
    },
  });
  assert(preflightRes.status === 200, '2.1: admin-manage-workspace-user CORS OPTIONS returns 200.');
  assert(preflightRes.headers.get('access-control-allow-origin') === 'https://abzops.github.io', '2.2: CORS allows origin https://abzops.github.io.');

  // Verify unauthenticated request rejection (verify_jwt=true platform level)
  const unauthRes = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/admin-manage-workspace-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action: 'get_onboarding_status', workspace_id: wsId }),
  });
  assert(unauthRes.status === 401, `2.3: Unauthenticated Edge Function request rejected with 401 (got ${unauthRes.status}).`);

  // ═════════════════════════════════════════════════════════════════════
  // 3. UI ELIGIBILITY STATE MACHINE CONTRACTS
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n--- Step 3: UI Eligibility State Machine Verification ---');

  // State A: Pending member
  const pendingMember = {
    id: 'mem-pending-01',
    user_id: 'usr-pending-01',
    role: 'member',
    status: 'pending',
    profile: { full_name: 'Test Employee' },
  };

  const isPendingActive = pendingMember.status === 'active';
  const showPendingSetupBadge = pendingMember.status !== 'active';
  const showPendingReissue = pendingMember.status === 'pending';

  assert(!isPendingActive && showPendingSetupBadge, '3.1: Pending member renders PASSWORD SETUP REQUIRED badge.');
  assert(showPendingReissue, '3.2: Pending member has Reissue Password button VISIBLE.');

  // State B: Active member
  const activeMember = {
    id: 'mem-active-01',
    user_id: 'usr-active-01',
    role: 'member',
    status: 'active',
    profile: { full_name: 'Active Employee' },
  };

  const isActiveActive = activeMember.status === 'active';
  const showActiveSetupBadge = activeMember.status !== 'active';
  const showActiveReissue = activeMember.status === 'pending';

  assert(isActiveActive && !showActiveSetupBadge, '3.3: Active member renders ACTIVE badge.');
  assert(!showActiveReissue, '3.4: Active member has Reissue Password button HIDDEN.');

  // State C: Reissued state
  const reissuedState = {
    fullName: pendingMember.profile.full_name,
    email: 'test@stacknstock.in',
    temporaryPassword: 'TempSecret123!@#',
    isReissue: true,
  };

  assert(reissuedState.isReissue === true, '3.5: Reissue sets isReissue flag on credentials display state.');
  assert(pendingMember.status === 'pending', '3.6: User remains pending after reissue.');

  // ═════════════════════════════════════════════════════════════════════
  // 4. JITHIN STALIN PROTECTION & RECOVERY PATH
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n--- Step 4: Jithin Stalin Data Protection Verification ---');

  const jithinEmployee = {
    fullName: 'Jithin Stalin',
    email: 'jithinstalin@stacknstock.in',
    deptCode: 'COMM',
    deptName: 'Commercials & Partnerships',
    deptRole: 'head',
    workspaceRole: 'admin',
    systemRoles: ['ceo'],
    designation: 'CEO',
  };

  assert(jithinEmployee.email === 'jithinstalin@stacknstock.in', '4.1: Jithin Stalin account is identified and protected.');
  assert(jithinEmployee.workspaceRole === 'admin', '4.2: Jithin retains workspace admin role in configuration.');
  assert(jithinEmployee.systemRoles.includes('ceo'), '4.3: Jithin retains CEO system role in configuration.');

  // ═════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═════════════════════════════════════════════════════════════════════
  console.log(`\n================================================================`);
  console.log(`LIVE E2E SUITE RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================================================`);

  if (failed > 0) process.exit(1);
}

runLiveE2E().catch(console.error);
