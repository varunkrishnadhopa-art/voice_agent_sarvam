const defaults = {
  sarvamKey: '', livekitUrl: '', livekitKey: '', livekitSecret: '',
  provider: 'livekit', ollamaModel: 'gemma4:e2b', ollamaUrl: 'http://localhost:11434/v1',
  language: 'en-IN', languageName: 'English', inputDevice: 'auto', outputDevice: 'auto',
  inputDeviceName: '', outputDeviceName: '', interruptions: false
};
function normalize(input = {}) {
  const output = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (key === 'interruptions') output[key] = input[key] === true;
    else if (typeof input[key] === 'string' && input[key].length <= 4096) output[key] = input[key];
  }
  if (!['livekit', 'ollama'].includes(output.provider)) throw new Error('Choose a supported LLM provider.');
  if (!/^https?:\/\//.test(output.ollamaUrl)) throw new Error('Ollama URL must start with http:// or https://.');
  if (!['en-IN','hi-IN','ta-IN','te-IN','kn-IN','ml-IN','mr-IN','bn-IN','gu-IN','pa-IN'].includes(output.language))
    throw new Error('Choose a supported speech language.');
  return output;
}
function redact(text, settings) {
  for (const key of ['sarvamKey', 'livekitKey', 'livekitSecret']) {
    if (settings[key]) text = text.split(settings[key]).join('[redacted]');
  }
  return text;
}
module.exports = { defaults, normalize, redact };
