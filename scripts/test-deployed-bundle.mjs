import process from 'node:process';

async function runDeployedTests() {
  console.log('================================================================');
  console.log('SNS Projects — Deployed Bundle Contract Verification (Read-Only)');
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

  try {
    const indexRes = await fetch('https://abzops.github.io/sns-projects/index.html');
    assert(indexRes.status === 200, '1. Production index.html responds HTTP 200.');

    const indexHtml = await indexRes.text();
    const scriptMatch = indexHtml.match(/src="(\/sns-projects\/assets\/[^"]+\.js)"/);
    assert(scriptMatch !== null, '2. Production JS bundle link found in HTML.');

    const bundleUrl = `https://abzops.github.io${scriptMatch[1]}`;
    const bundleRes = await fetch(bundleUrl);
    assert(bundleRes.status === 200, '3. Production JS bundle fetched successfully.');

    const bundleText = await bundleRes.text();
    assert(bundleText.includes('complete_first_login'), '4. Deployed bundle contains complete_first_login handler.');
    assert(bundleText.includes('signInWithPassword'), '5. Deployed bundle uses signInWithPassword post-password-change.');
    assert(bundleText.includes('replaces all previously issued temporary passwords'), '6. Deployed bundle contains reissue notice text.');

    const completeFirstLoginIndex = bundleText.indexOf('complete_first_login');
    const completeFirstLoginSlice = bundleText.slice(completeFirstLoginIndex, completeFirstLoginIndex + 1500);
    assert(!completeFirstLoginSlice.includes('refreshSession'), '7. complete_first_login handler does NOT invoke refreshSession().');

    assert(bundleText.includes('Unable to load projects'), '8. Deployed bundle contains explicit Projects load-error state.');
    assert(bundleText.includes('Unable to load defined processes'), '9. Deployed bundle contains explicit Process Catalog load-error state.');
    assert(bundleText.includes('Failed to delete task'), '10. Deployed bundle contains Task deletion failure handling.');
    assert(bundleText.includes('Failed to remove member'), '11. Deployed bundle contains personnel removal failure handling.');
    assert(bundleText.includes('Failed to mark notification as read'), '12. Deployed bundle contains notification mutation failure handling.');
  } catch (err) {
    console.error('Bundle test error:', err.message);
    failed++;
  }

  console.log(`\n================================================================`);
  console.log(`DEPLOYED BUNDLE TEST RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================================================`);

  if (failed > 0) process.exit(1);
}

runDeployedTests().catch(console.error);
