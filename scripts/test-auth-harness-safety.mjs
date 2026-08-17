import { evaluateSafetyGuard, PRODUCTION_PROJECT_REF } from './test-auth-lifecycle-e2e.mjs';
import process from 'node:process';

async function runSafetyHarnessTests() {
  console.log('================================================================');
  console.log('SNS Projects — Auth Test Harness Safety Guard Verification');
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

  const prodUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
  const localUrl = 'http://127.0.0.1:54321';
  const stagingUrl = 'https://staging-project-ref.supabase.co';

  // ═════════════════════════════════════════════════════════════════════
  // 1. PERMANENT PRODUCTION FAIL-CLOSED PROTECTION (NO OVERRIDES)
  // ═════════════════════════════════════════════════════════════════════
  console.log('--- 1. Permanent Production Fail-Closed Policy ---');

  // Test 1: Production URL is permanently blocked by default
  const defaultProdCheck = evaluateSafetyGuard({ supabaseUrl: prodUrl });
  assert(defaultProdCheck.allowed === false, 'Test 1: Default execution against production is refused.');
  assert(defaultProdCheck.isProduction === true, 'Test 2: Correctly identifies production project ref.');
  assert(defaultProdCheck.reason.includes('PERMANENTLY BLOCKED'), 'Test 3: Explains permanent production block.');

  // Test 2: Attempted override with ALLOW_PRODUCTION_AUTH_E2E=true must STILL BE BLOCKED
  const overrideAttemptCheck = evaluateSafetyGuard({
    supabaseUrl: prodUrl,
    allowProduction: true,
    ALLOW_PRODUCTION_AUTH_E2E: 'true',
    testEmail: 'bot@test.com',
  });
  assert(overrideAttemptCheck.allowed === false,
    'Test 4: Environment flags (ALLOW_PRODUCTION_AUTH_E2E) CANNOT bypass production block.');

  // Test 3: Attempted override with any email or parameters must STILL BE BLOCKED
  const customEmailCheck = evaluateSafetyGuard({
    supabaseUrl: prodUrl,
    testEmail: 'custom.disposable@example.com',
  });
  assert(customEmailCheck.allowed === false,
    'Test 5: Custom test emails cannot bypass production block.');

  // ═════════════════════════════════════════════════════════════════════
  // 2. LOCAL & STAGING ENVIRONMENT PERMISSIONS
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n--- 2. Local & Staging Environment Execution Policy ---');

  // Test 4: Local development URL is allowed
  const localCheck = evaluateSafetyGuard({ supabaseUrl: localUrl });
  assert(localCheck.allowed === true && localCheck.isProduction === false,
    'Test 6: Local Supabase instance (127.0.0.1) allows auth lifecycle execution.');

  // Test 5: Non-production staging instance is allowed
  const stagingCheck = evaluateSafetyGuard({ supabaseUrl: stagingUrl });
  assert(stagingCheck.allowed === true && stagingCheck.isProduction === false,
    'Test 7: Separate non-production staging instance allows auth lifecycle execution.');

  // ═════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═════════════════════════════════════════════════════════════════════
  console.log(`\n================================================================`);
  console.log(`HARNESS SAFETY TEST RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================================================`);

  if (failed > 0) process.exit(1);
}

runSafetyHarnessTests().catch(console.error);
