async function verifyLivePages() {
  console.log('Fetching live index.html from https://abzops.github.io/sns-projects/index.html ...');
  const res = await fetch('https://abzops.github.io/sns-projects/index.html');
  const html = await res.text();
  console.log('Fetched index.html successfully. Status:', res.status);

  const match = html.match(/src="(\/sns-projects\/assets\/index-[^"]+\.js)"/);
  if (!match) {
    console.log('Could not find JS bundle in index.html. HTML snippet:');
    console.log(html.slice(0, 500));
    return;
  }

  const jsUrl = `https://abzops.github.io${match[1]}`;
  console.log('Fetching live bundle:', jsUrl);
  const jsRes = await fetch(jsUrl);
  const jsCode = await jsRes.text();

  console.log('Live bundle fetched. Size:', jsCode.length, 'bytes');
  console.log('Asserting Phase-native symbols:');
  console.log('  - Contains phase_id:', jsCode.includes('phase_id'));
  console.log('  - Contains p_phase_id:', jsCode.includes('p_phase_id'));
  console.log('  - Contains Target Phase:', jsCode.includes('Target Phase') || jsCode.includes('Phase'));
  console.log('  - Contains usePhases logic:', jsCode.includes('phases') || jsCode.includes('phase'));
}

verifyLivePages().catch(console.error);
