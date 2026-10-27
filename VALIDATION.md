# Verification — 27 October 2026

## 1.0.1 packaging correction

The first release omitted HTTP distribution metadata used by the lazy LLM-client
startup path. This caused `No package metadata was found for httpcore2` on Start.
The build now copies httpcore2/httpx2 metadata and LiveKit's dependency metadata,
and collects both HTTP packages' dynamically loaded transport modules.
The frozen-backend self-test now constructs both hosted and Ollama model clients
with dummy credentials and closes them without making API requests.
This expanded test passed in the rebuilt standalone executable, including the
previously failing hosted-client constructor. Both HTTP metadata directories are
present in the frozen runtime.

- Three Node.js settings tests passed: normalization, rejected invalid settings, credential redaction.
- Six Python tests passed: connected/disconnected device selection, device-ID changes,
  independent input/output selection, sample delivery to the playback callback,
  playback completion, and clearing queued sound on Stop.
- Electron source UI test passed: window launch, device discovery, renderer isolation,
  credential validation, Windows-encrypted settings, and navigation. Visually inspected
  a source-app screenshot.
- Frozen Python executable self-test passed: Silero ONNX model initialization,
  LiveKit native audio resampling, audio-device enumeration, and clean shutdown.
- Packaged Windows app functional test passed with its bundled Python executable:
  UI launch, device discovery, renderer isolation, validation, encrypted settings,
  and navigation. The packaged-window screenshot step timed out, so its functional
  checks were rerun independently; visual inspection used the source-app screenshot.
- Built the portable Windows x64 executable. Python and Node.js are bundled and are
  unnecessary on the user's PC. No code-signing certificate is configured.

No real API keys were used by these desktop-app tests. A live end-to-end conversation,
actual Bluetooth microphone quality, device switching during use, and latency targets
remain unverified in the new desktop interface. Add credentials in Settings and use
Test speaker, then Start conversation to complete the live check.

The earlier console implementation's laptop speech path was verified with the user;
that does not substitute for a live test of this new desktop audio bridge.
