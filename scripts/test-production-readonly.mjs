import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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

async function runProductionReadOnlyTests() {
  console.log('================================================================');
  console.log('SNS Projects — Safe Production Read-Only Verification');
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
  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  try {
    // 1. CORS Preflight Check
    const preflightRes = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/admin-manage-workspace-user`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://abzops.github.io',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, apikey',
      },
    });
    assert(preflightRes.status === 200, '1. admin-manage-workspace-user CORS OPTIONS responds HTTP 200.');
    assert(preflightRes.headers.get('access-control-allow-origin') === 'https://abzops.github.io',
      '2. CORS header correctly echoes allowed origin https://abzops.github.io.');

    // 2. Unauthenticated JWT Gate Enforcement (verify_jwt=true platform level)
    const unauthRes = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/admin-manage-workspace-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action: 'get_onboarding_status', workspace_id: wsId }),
    });
    assert(unauthRes.status === 401, `3. Unauthenticated request rejected with HTTP 401 (got ${unauthRes.status}).`);
  } catch (err) {
    console.error('Read-only test error:', err.message);
    failed++;
  }

  console.log(`\n================================================================`);
  console.log(`PRODUCTION READ-ONLY TEST RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================================================`);

  if (failed > 0) process.exit(1);
}

runProductionReadOnlyTests().catch(console.error);
