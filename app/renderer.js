const $ = id => document.getElementById(id);
let settings = {}, devices = [], currentState = 'stopped';
const fields = ['sarvamKey','livekitUrl','livekitKey','livekitSecret','provider','ollamaModel','ollamaUrl','language'];
function notice(message, success = false) {
  $('notice').textContent = message; $('notice').hidden = !message;
  $('notice').classList.toggle('success', success);
}
function showView(view) {
  $('conversationView').hidden = view !== 'conversation';
  $('settingsView').hidden = view !== 'settings';
  $('conversationTab').classList.toggle('active', view === 'conversation');
  $('settingsTab').classList.toggle('active', view === 'settings');
}
function providerView() {
  const hosted = $('provider').value === 'livekit';
  $('livekitSettings').hidden = !hosted; $('ollamaSettings').hidden = hosted;
}
function readSettings() {
  const value = { ...settings };
  for (const key of fields) value[key] = $(key).value;
  value.languageName = $('language').selectedOptions[0].textContent;
  value.interruptions = $('interruptions').checked;
  for (const key of ['inputDevice','outputDevice']) {
    value[key] = $(key).value;
    value[key + 'Name'] = $(key).selectedOptions[0]?.dataset.identity || '';
  }
  return value;
}
function setState(state) {
  currentState = state;
  const stopped = ['stopped','idle'].includes(state), busy = ['starting','initializing','stopping'].includes(state);
  $('status').querySelector('span').textContent = state.charAt(0).toUpperCase() + state.slice(1);
  $('status').classList.toggle('live', !stopped && !busy);
  $('start').disabled = !stopped;
  $('stop').disabled = stopped || state === 'stopping';
  ['refresh','testTone','inputDevice','outputDevice'].forEach(id => $(id).disabled = !stopped);
  $('orb').classList.toggle('live', !stopped); $('orb').classList.toggle('speaking', state === 'speaking');
  const titles = { stopped:'A conversation away.', starting:'Connecting your voice…', initializing:'Warming up…',
    listening:'I’m listening.', thinking:'A moment of thought.', speaking:'Let’s keep talking.', stopping:'Wrapping up…' };
  $('sessionTitle').textContent = titles[state] || 'Your voice session';
  $('sessionHint').textContent = stopped ? 'Choose your audio devices, then start talking.' :
    (state === 'speaking' && !$('interruptions').checked ? 'Microphone pauses during replies to prevent echo.' : 'Speak naturally. Your transcript appears on the right.');
  $('sessionFooter').textContent = stopped ? 'Ready when you are' : $('sessionTitle').textContent;
  if (stopped) { $('meterFill').style.width = '0%'; $('levelText').textContent = 'Off'; }
}
function updateDevices(list) {
  devices = list;
  for (const [id, direction] of [['inputDevice','inputs'],['outputDevice','outputs']]) {
    const previous = $(id).selectedOptions[0]?.dataset.identity || settings[id+'Name'];
    const wasAuto = ($(id).value || settings[id] || 'auto') === 'auto';
    $(id).replaceChildren();
    const auto = new Option('Automatic · earbuds → laptop','auto'); $(id).add(auto);
    for (const device of list.filter(d => d[direction])) {
      const identity = device.name + ' | ' + device.host;
      const option = new Option(device.name + ' · ' + device.host,String(device.id));
      option.dataset.identity = identity; $(id).add(option);
      if (!wasAuto && previous === identity) $(id).value = String(device.id);
    }
  }
}
function transcript(role,text) {
  if (!text) return;
  $('empty')?.remove();
  const article = document.createElement('article'); article.className = 'message ' + (role === 'user' ? 'user' : 'assistant');
  const label = document.createElement('div'); label.className = 'role'; label.textContent = role === 'user' ? 'YOU' : 'SARVAM VOICE';
  const paragraph = document.createElement('p'); paragraph.textContent = text;
  article.append(label,paragraph); $('transcripts').append(article);
  if ($('transcripts').children.length > 200) $('transcripts').firstElementChild.remove();
  $('transcripts').scrollTop = $('transcripts').scrollHeight;
}
async function action(callback) {
  try { await callback(); } catch (error) { notice(error.message || String(error)); }
}
window.voiceApp.onEvent(event => {
  if (event.type === 'devices') updateDevices(event.devices);
  if (event.type === 'status') setState(event.state);
  if (event.type === 'level') {
    const db = 20 * Math.log10(Math.max(event.level, .000001));
    $('meterFill').style.width = Math.max(0,Math.min(100,(db + 60) * 100 / 55)) + '%';
    $('levelText').textContent = event.level > .001 ? Math.round(db) + ' dB' : 'Very quiet';
  }
  if (event.type === 'transcript') transcript(event.role,event.text);
  if (event.type === 'error') notice(event.message);
  if (event.type === 'notice') notice(event.message,true);
  if (event.type === 'selected') $('selected').textContent = 'Input: ' + event.microphone + ' · Output: ' + event.speaker;
});
$('conversationTab').onclick = () => showView('conversation');
$('settingsTab').onclick = () => showView('settings');
$('provider').onchange = providerView;
$('settingsForm').onsubmit = event => {
  event.preventDefault(); action(async () => {
    settings = readSettings(); await window.voiceApp.save(settings);
    $('modelLabel').textContent = settings.provider === 'ollama' ? 'OLLAMA' : 'GEMMA 4';
    $('footerLlm').textContent = settings.provider === 'ollama' ? 'LOCAL LLM' : 'GEMMA 4 INTELLIGENCE';
    notice('Settings saved with Windows encryption.',true);
  });
};
$('start').onclick = () => action(async () => {
  const config = readSettings();
  if (!config.sarvamKey || (config.provider === 'livekit' && (!config.livekitKey || !config.livekitSecret || !config.livekitUrl))) {
    showView('settings'); notice('Enter your API credentials, then save your settings.'); return;
  }
  notice(''); await window.voiceApp.start(config);
});
$('stop').onclick = () => action(() => window.voiceApp.stop());
$('refresh').onclick = () => action(() => window.voiceApp.devices());
$('testTone').onclick = () => action(() => window.voiceApp.tone(readSettings()));
$('clear').onclick = () => $('transcripts').replaceChildren();
action(async () => {
  const initial = await window.voiceApp.bootstrap(); settings = initial.settings;
  for (const key of fields) $(key).value = settings[key];
  $('interruptions').checked = settings.interruptions;
  providerView(); setState(initial.state);
  if (initial.warning) notice(initial.warning);
  $('encryptionState').textContent = initial.encrypted ? 'Windows encrypted storage' : 'Encryption unavailable';
  await window.voiceApp.devices();
});
