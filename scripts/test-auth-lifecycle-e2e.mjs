import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const repoRoot = process.cwd();
const envAppPath = path.join(repoRoot, '.env');

export const PRODUCTION_PROJECT_REF = 'gqerfixdmgbqahgslzsq';

/**
 * Hard fail-closed safety guard for Auth Lifecycle E2E testing.
 * 
 * Rules:
 * 1. If target Supabase URL matches production project ref (gqerfixdmgbqahgslzsq),
 *    auth lifecycle E2E testing is PERMANENTLY BLOCKED.
 * 2. No environment variable, flag, or override can bypass this production block.
 * 3. Production is strictly restricted to:
 *    - Deployed bundle checks (test-deployed-bundle.mjs)
 *    - Read-only checks & CORS preflight (test-production-readonly.mjs)
 *    - Unauthenticated 401 gate checks
 * 4. Auth lifecycle mutations and logins may ONLY run against local or staging instances.
 */
export function evaluateSafetyGuard({ supabaseUrl }) {
  const isProduction = typeof supabaseUrl === 'string' && supabaseUrl.includes(PRODUCTION_PROJECT_REF);

  if (isProduction) {
    return {
      isProduction: true,
      allowed: false,
      reason: `PERMANENTLY BLOCKED: Target is production project (${PRODUCTION_PROJECT_REF}). Auth lifecycle E2E testing is strictly forbidden against production. Run lifecycle tests exclusively against local Supabase (127.0.0.1) or an isolated non-production staging instance.`,
    };
  }

  return {
    isProduction: false,
    allowed: true,
    reason: 'Target is local/staging environment. Auth lifecycle execution permitted.',
  };
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

async function runAuthLifecycleE2E() {
  console.log('================================================================');
  console.log('SNS Projects — Auth Lifecycle E2E Test (Production Fail-Closed)');
  console.log('================================================================\n');

  const env = parseEnv(await readFile(envAppPath, 'utf8'));
  const supabaseUrl = env.VITE_SUPABASE_URL || '';

  const guard = evaluateSafetyGuard({ supabaseUrl });

  if (!guard.allowed) {
    console.log(`[SAFETY GUARD BLOCKED] ${guard.reason}`);
    console.log('[SAFETY GUARD] Execution halted safely. Zero network requests sent to backend.');
    return;
  }

  // ═════════════════════════════════════════════════════════════════════
  // LOCAL / STAGING EXECUTION ONLY
  // ═════════════════════════════════════════════════════════════════════
  const supabase = createClient(supabaseUrl, env.VITE_SUPABASE_ANON_KEY);
  const testEmail = process.env.LOCAL_AUTH_TEST_EMAIL;
  const testPassword = process.env.LOCAL_AUTH_TEST_PASSWORD;

  if (!testEmail || !testPassword) {
    console.log('[SKIP] LOCAL_AUTH_TEST_EMAIL and LOCAL_AUTH_TEST_PASSWORD not set for local/staging run.');
    return;
  }

  console.log(`Attempting single authentication on non-production target: ${testEmail}`);

  // Exactly 1 attempt — never loop, never guess
  const { data, error } = await supabase.auth.signInWithPassword({
    email: testEmail.trim(),
    password: testPassword,
  });

  if (error) {
    if (error.status === 429 || error.message?.includes('rate limit')) {
      console.error('[FAIL] Rate limit encountered (HTTP 429). Halting immediately without retrying.');
      process.exit(1);
    }
    console.error(`[FAIL] Authentication failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`[PASS] Successfully authenticated local/staging identity (ID: ${data.user.id}).`);

  // Safe local signOut
  await supabase.auth.signOut({ scope: 'local' });
  console.log('[PASS] Local test completed cleanly.');
}

if (process.argv[1] && process.argv[1].endsWith('test-auth-lifecycle-e2e.mjs')) {
  runAuthLifecycleE2E().catch((err) => {
    console.error('Fatal test error:', err.message);
    process.exit(1);
  });
}
