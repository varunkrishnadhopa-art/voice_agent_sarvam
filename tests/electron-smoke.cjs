const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
async function run() {
  const root = path.resolve(__dirname, '..');
  const userData = path.resolve(root, '../../work/electron-test-profile');
  fs.mkdirSync(userData, { recursive: true });
  const env = { ...process.env, VOICE_AGENT_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.VOICE_AGENT_EXECUTABLE ? { executablePath:process.env.VOICE_AGENT_EXECUTABLE, args:[] } : { args:[root] }),
    env, timeout: 60000
  });
  try {
    const window = await app.firstWindow();
    const errors = [];
    window.on('pageerror', error => errors.push(error.message));
    await window.locator('#inputDevice option').nth(1).waitFor({ state: 'attached', timeout: 45000 });
    assert.equal(await window.title(), 'Sarvam Voice');
    assert.equal(await window.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await window.locator('#stop').isDisabled(), true);
    await window.locator('#start').click();
    await window.locator('#settingsView').waitFor({ state: 'visible' });
    assert.match(await window.locator('#notice').innerText(), /credentials/);
    await window.locator('#sarvamKey').fill('desktop-test-only-not-a-real-key');
    await window.locator('#settingsForm button[type=submit]').click();
    await window.waitForFunction(() => document.querySelector('#notice').textContent.includes('Settings saved'));
    const ciphertext = fs.readFileSync(path.join(userData, 'settings.enc'));
    assert.equal(ciphertext.includes(Buffer.from('desktop-test-only-not-a-real-key')), false);
    await window.locator('#conversationTab').click();
    await window.locator('#clear').click();
    await window.evaluate(() => window.voiceApp.onEvent(() => {}));
    await window.evaluate(() => { window.scrollTo(0,0); document.querySelector('#notice').hidden=true; });
    if (!process.env.VOICE_AGENT_EXECUTABLE)
      await window.screenshot({ path: path.resolve(root, '../../work/desktop-preview.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: window, backend devices, renderer isolation, validation, encrypted settings and navigation.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
