const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, redact } = require('../app/settings.cjs');
test('unknown settings cannot become process arguments', () => {
  const settings = normalize({ executable: 'bad.exe', provider: 'ollama', interruptions: 'false' });
  assert.equal(settings.executable, undefined);
  assert.equal(settings.interruptions, false);
});
test('credentials are removed from diagnostic text', () => {
  assert.equal(redact('secret-key secret-key', { sarvamKey: 'secret-key' }), '[redacted] [redacted]');
});
test('invalid provider and URLs are rejected', () => {
  assert.throws(() => normalize({ provider:'unexpected' }));
  assert.throws(() => normalize({ ollamaUrl:'file:///secret' }));
});
