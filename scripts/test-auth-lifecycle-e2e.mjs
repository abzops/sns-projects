import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const repoRoot = process.cwd();
const envAppPath = path.join(repoRoot, '.env');

const PRODUCTION_PROJECT_REF = 'gqerfixdmgbqahgslzsq';

// Blacklist of real production employees protected from automated destructive auth testing
export const PROTECTED_PRODUCTION_EMPLOYEES = [
  'jithinstalin@stacknstock.in',
  'abhijith.gopi@stacknstock.in',
  'hari@stacknstock.in',
  'ops@stacknstock.in',
  'joseph.george@stacknstock.in',
  'projects@stacknstock.in',
  'saravana@stacknstock.in',
  'siva@stacknstock.in',
  'sourav@stacknstock.in',
  'surya@stacknstock.in',
  'sourcing@stacknstock.in',
  'abhinand@stacknstock.in',
];

export function evaluateSafetyGuard({ supabaseUrl, allowProduction, testEmail }) {
  const isProduction = typeof supabaseUrl === 'string' && supabaseUrl.includes(PRODUCTION_PROJECT_REF);

  if (!isProduction) {
    return { isProduction: false, allowed: true, reason: 'Target is local/staging environment.' };
  }

  if (allowProduction !== true && allowProduction !== 'true') {
    return {
      isProduction: true,
      allowed: false,
      reason: `Refusing auth lifecycle mutation against production project (${PRODUCTION_PROJECT_REF}). Requires ALLOW_PRODUCTION_AUTH_E2E=true.`,
    };
  }

  if (!testEmail || typeof testEmail !== 'string' || !testEmail.trim()) {
    return {
      isProduction: true,
      allowed: false,
      reason: 'Production auth lifecycle test requires explicit AUTH_E2E_TEST_EMAIL environment variable.',
    };
  }

  const normalizedEmail = testEmail.toLowerCase().trim();
  if (PROTECTED_PRODUCTION_EMPLOYEES.includes(normalizedEmail)) {
    return {
      isProduction: true,
      allowed: false,
      reason: `SAFETY VIOLATION: '${testEmail}' is a protected production employee account. Automated credential lifecycle tests are strictly prohibited.`,
    };
  }

  return {
    isProduction: true,
    allowed: true,
    reason: `Targeting production with approved dedicated test identity: ${normalizedEmail}`,
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
  console.log('SNS Projects — Auth Lifecycle E2E Test (Production-Guarded)');
  console.log('================================================================\n');

  const env = parseEnv(await readFile(envAppPath, 'utf8'));
  const supabaseUrl = env.VITE_SUPABASE_URL || '';
  const allowProduction = process.env.ALLOW_PRODUCTION_AUTH_E2E;
  const testEmail = process.env.AUTH_E2E_TEST_EMAIL;

  const guard = evaluateSafetyGuard({ supabaseUrl, allowProduction, testEmail });

  if (!guard.allowed) {
    console.log(`[SAFETY GUARD BLOCKED] ${guard.reason}`);
    console.log('[SAFETY GUARD] Execution halted safely. Zero auth requests sent to backend.');
    console.log('[SAFETY GUARD] To run auth lifecycle tests against production:');
    console.log('  1. Provision a dedicated disposable test account (e.g. e2e.test.bot@stacknstock.in)');
    console.log('  2. Set ALLOW_PRODUCTION_AUTH_E2E=true');
    console.log('  3. Set AUTH_E2E_TEST_EMAIL=e2e.test.bot@stacknstock.in');
    console.log('  4. Set AUTH_E2E_TEST_PASSWORD=<current_temp_or_perm_password>');
    return;
  }

  // ═════════════════════════════════════════════════════════════════════
  // SAFE CONTROLLED EXECUTION (Only reached if explicit guard passes)
  // ═════════════════════════════════════════════════════════════════════
  const supabase = createClient(supabaseUrl, env.VITE_SUPABASE_ANON_KEY);
  const testPassword = process.env.AUTH_E2E_TEST_PASSWORD;

  if (!testPassword) {
    console.error('[FAIL] AUTH_E2E_TEST_PASSWORD is required when running authorized lifecycle test.');
    process.exit(1);
  }

  console.log(`Attempting single authentication for authorized test identity: ${testEmail}`);

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
    console.error(`[FAIL] Authentication failed for test identity: ${error.message}`);
    process.exit(1);
  }

  console.log(`[PASS] Successfully authenticated test identity (ID: ${data.user.id}).`);
  console.log(`[PASS] must_change_password flag: ${data.user.app_metadata?.must_change_password ?? 'none'}`);

  // Safe signOut
  await supabase.auth.signOut({ scope: 'local' });
  console.log('[PASS] Test completed cleanly.');
}

if (process.argv[1] && process.argv[1].endsWith('test-auth-lifecycle-e2e.mjs')) {
  runAuthLifecycleE2E().catch((err) => {
    console.error('Fatal test error:', err.message);
    process.exit(1);
  });
}
