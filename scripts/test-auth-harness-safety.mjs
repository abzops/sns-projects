import { evaluateSafetyGuard, PROTECTED_PRODUCTION_EMPLOYEES } from './test-auth-lifecycle-e2e.mjs';
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

  const prodUrl = 'https://gqerfixdmgbqahgslzsq.supabase.co';
  const localUrl = 'http://127.0.0.1:54321';

  // ═════════════════════════════════════════════════════════════════════
  // 1. DEFAULT PRODUCTION REJECTION (Fail-Closed)
  // ═════════════════════════════════════════════════════════════════════
  console.log('--- 1. Default Production Execution Guard ---');

  // Test 1: No env vars provided against production -> MUST REJECT
  const defaultProdCheck = evaluateSafetyGuard({
    supabaseUrl: prodUrl,
    allowProduction: undefined,
    testEmail: undefined,
  });
  assert(defaultProdCheck.allowed === false, 'Test 1: Default execution against production is refused.');
  assert(defaultProdCheck.isProduction === true, 'Test 2: Correctly identifies production project gqerfixdmgbqahgslzsq.');

  // Test 2: allowProduction is false -> MUST REJECT
  const falseProdCheck = evaluateSafetyGuard({
    supabaseUrl: prodUrl,
    allowProduction: false,
    testEmail: 'test.bot@stacknstock.in',
  });
  assert(falseProdCheck.allowed === false, 'Test 3: ALLOW_PRODUCTION_AUTH_E2E=false is refused.');

  // Test 3: allowProduction is true but NO testEmail -> MUST REJECT
  const noEmailCheck = evaluateSafetyGuard({
    supabaseUrl: prodUrl,
    allowProduction: true,
    testEmail: undefined,
  });
  assert(noEmailCheck.allowed === false, 'Test 4: Missing AUTH_E2E_TEST_EMAIL is refused even if ALLOW_PRODUCTION=true.');

  // ═════════════════════════════════════════════════════════════════════
  // 2. PRODUCTION EMPLOYEE BLACKLIST ENFORCEMENT
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n--- 2. Production Employee Blacklist Enforcement ---');

  for (const empEmail of PROTECTED_PRODUCTION_EMPLOYEES) {
    const empCheck = evaluateSafetyGuard({
      supabaseUrl: prodUrl,
      allowProduction: true,
      testEmail: empEmail,
    });
    assert(empCheck.allowed === false && empCheck.reason.includes('SAFETY VIOLATION'),
      `Test: Protected employee '${empEmail}' cannot be targeted by automated lifecycle test.`);
  }

  // Case-insensitivity check
  const upperCaseJithin = evaluateSafetyGuard({
    supabaseUrl: prodUrl,
    allowProduction: true,
    testEmail: 'JITHINSTALIN@STACKNSTOCK.IN',
  });
  assert(upperCaseJithin.allowed === false, 'Test: Case-insensitive match protects Jithin Stalin.');

  // ═════════════════════════════════════════════════════════════════════
  // 3. ALLOWED DEDICATED TEST IDENTITIES
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n--- 3. Authorized Dedicated Test Identity ---');

  const approvedIdentityCheck = evaluateSafetyGuard({
    supabaseUrl: prodUrl,
    allowProduction: 'true',
    testEmail: 'e2e.test.bot@stacknstock.in',
  });
  assert(approvedIdentityCheck.allowed === true, 'Test: Explicitly allowed non-employee test identity passes guard.');

  // ═════════════════════════════════════════════════════════════════════
  // 4. LOCAL / STAGING ENVIRONMENT FREEDOM
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n--- 4. Local / Staging Environment Policy ---');

  const localCheck = evaluateSafetyGuard({
    supabaseUrl: localUrl,
    allowProduction: false,
    testEmail: undefined,
  });
  assert(localCheck.allowed === true && localCheck.isProduction === false,
    'Test: Local/staging environment allows E2E testing without production flags.');

  // ═════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═════════════════════════════════════════════════════════════════════
  console.log(`\n================================================================`);
  console.log(`HARNESS SAFETY TEST RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================================================`);

  if (failed > 0) process.exit(1);
}

runSafetyHarnessTests().catch(console.error);
