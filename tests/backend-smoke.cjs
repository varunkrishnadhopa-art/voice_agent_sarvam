const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const executable = process.env.VOICE_AGENT_BACKEND || path.join(root, 'runtime/voice-backend/voice-backend.exe');
const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
let pending = '', stderr = '', ready = false, selftest = false;
const timeout = setTimeout(() => { child.kill(); throw new Error('Backend self-test timed out: '+stderr.slice(-1000)); },90000);
child.stderr.on('data', chunk => stderr += chunk);
child.stdout.on('data', chunk => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0,newline); pending=pending.slice(newline+1);
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'ready') { ready=true; child.stdin.write(JSON.stringify({action:'selftest'})+'\n'); }
    if (event.type === 'selftest') {
      assert.equal(event.ok,true); assert.ok(event.device_count>0); selftest=true;
      assert.equal(event.model_clients,true);
      child.stdin.write(JSON.stringify({action:'quit'})+'\n');
    }
    if (event.type === 'error') { child.kill(); throw new Error(event.message); }
  }
});
child.on('error', error => { clearTimeout(timeout); throw error; });
child.on('exit', code => {
  clearTimeout(timeout);
  assert.equal(code,0,stderr.slice(-1500)); assert.equal(ready,true); assert.equal(selftest,true);
  console.log('PASS: frozen hosted/Ollama model clients, native model/audio assets, device listing and shutdown. No API requests sent.');
});
