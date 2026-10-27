const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { defaults, normalize, redact } = require('./settings.cjs');

app.setName('Sarvam Voice');
app.setPath('userData', process.env.VOICE_AGENT_USER_DATA || path.join(app.getPath('appData'), 'Sarvam Voice'));
let window, backend, state = 'stopped', settings = { ...defaults }, quitting = false;
let pending = '', lastError = '', stopTimer;
const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
function send(event) { if (window && !window.isDestroyed()) window.webContents.send('agent:event', event); }
function status(value) { state = value; send({ type: 'status', state }); }
function saveSettings(input) {
  const next = normalize(input);
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Settings were not saved.');
  const folder = app.getPath('userData');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'settings.enc');
  fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(next)));
  fs.renameSync(file + '.tmp', file);
  settings = next;
  return true;
}
function loadSettings() {
  const file = path.join(app.getPath('userData'), 'settings.enc');
  if (fs.existsSync(file)) settings = normalize(JSON.parse(safeStorage.decryptString(fs.readFileSync(file))));
}
function launchBackend() {
  if (backend) return;
  const runtime = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'runtime', 'voice-backend', 'voice-backend.exe');
  const python = process.env.VOICE_AGENT_PYTHON || path.resolve(__dirname, '../../../work/.venv/Scripts/python.exe');
  const executable = fs.existsSync(runtime) ? runtime : python;
  const args = fs.existsSync(runtime) ? [] : ['-u', path.join(__dirname, '../backend/desktop_agent.py')];
  if (!fs.existsSync(executable)) throw new Error('Python backend is missing. Run the backend build step in README.md.');
  pending = ''; lastError = '';
  backend = spawn(executable, args, { windowsHide: true, stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' } });
  backend.stdout.on('data', chunk => {
    pending += chunk.toString('utf8');
    if (pending.length > 2_000_000) pending = '';
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === 'status') {
          state = event.state;
          if (state === 'stopped') clearTimeout(stopTimer);
        }
        if (event.type === 'error') event.message = redact(String(event.message), settings);
        send(event);
      } catch { /* Ignore third-party non-protocol output. */ }
    }
  });
  backend.stderr.on('data', chunk => { lastError = redact(chunk.toString('utf8'), settings).slice(-3000); });
  backend.on('error', error => send({ type: 'error', message: 'Backend could not launch: ' + error.message }));
  backend.on('close', code => {
    backend = null; clearTimeout(stopTimer); status('stopped');
    if (code && !quitting) send({ type: 'error', message: 'Audio backend exited unexpectedly. Restart the app or check the installation.' });
  });
  backend.stdin.on('error', () => {});
}
function command(action, config) {
  launchBackend();
  backend.stdin.write(JSON.stringify({ action, config }) + '\n');
}
function killBackend() {
  if (!backend) return;
  const child = backend;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio:'ignore', timeout:4000 });
    else child.kill('SIGKILL');
  } catch { child.kill(); }
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame?.url !== pageURL)
    throw new Error('Untrusted request.');
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => { trusted(event); return callback(...args); });
}
app.whenReady().then(() => {
  try { loadSettings(); } catch { lastError = 'Saved settings could not be decrypted. Enter and save them again.'; }
  window = new BrowserWindow({ width: 1180, height: 820, minWidth: 900, minHeight: 650,
    title: 'Sarvam Voice', backgroundColor: '#101218', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  handle('app:bootstrap', () => ({ settings, state, encrypted: safeStorage.isEncryptionAvailable(), warning: lastError }));
  handle('settings:save', input => saveSettings(input));
  handle('agent:devices', () => {
    if (!['stopped', 'idle'].includes(state)) throw new Error('Stop the agent before refreshing devices.');
    command('devices'); return true;
  });
  handle('agent:start', input => {
    if (!['stopped','idle'].includes(state)) throw new Error('The agent is already running.');
    const config = normalize(input); settings = config;
    status('starting');
    try { command('start', config); } catch (error) { status('stopped'); throw error; }
    return true;
  });
  handle('agent:stop', () => {
    if (!backend) { status('stopped'); return true; }
    status('stopping'); command('stop');
    stopTimer = setTimeout(killBackend, 6000); return true;
  });
  handle('agent:tone', input => {
    if (state !== 'stopped') throw new Error('Stop the agent before testing playback.');
    command('tone', normalize(input)); return true;
  });
  window.loadURL(pageURL);
  window.on('closed', () => { window = null; });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; killBackend(); });
