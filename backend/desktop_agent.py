"""JSON-lines desktop bridge. Credentials arrive over stdin, never argv."""
import asyncio
import collections
import json
import logging
import math
import os
import sys
import threading
import time

import aiohttp
import numpy as np
import sounddevice as sd
from livekit import rtc
from livekit.agents import Agent, AgentSession, inference
from livekit.agents.voice import io
from livekit.plugins import openai, sarvam, silero

logging.basicConfig(level=logging.ERROR, stream=sys.stderr)
write_lock = threading.Lock()


def emit(kind, **data):
    with write_lock:
        print(json.dumps(dict(type=kind, **data), ensure_ascii=True), flush=True)


def devices():
    sd._terminate()
    sd._initialize()
    hosts = sd.query_hostapis()
    return [dict(id=i, name=d['name'], host=hosts[d['hostapi']]['name'],
                 inputs=d['max_input_channels'], outputs=d['max_output_channels'],
                 rate=int(d['default_samplerate']))
            for i, d in enumerate(sd.query_devices())
            if hosts[d['hostapi']]['name'] in ('MME', 'Windows WASAPI', 'Windows DirectSound')]


def select_devices(available, config):
    def explicit(key, direction):
        value = config.get(key, 'auto')
        if str(value) == 'auto':
            return None
        match = next((d for d in available if str(d['id']) == str(value) and d[direction]), None)
        if match is None:
            raise ValueError('Selected audio device is unavailable. Refresh the device list.')
        # Saved device identity guards against IDs changing after reconnect.
        identity = config.get(key + 'Name')
        if identity and identity != match['name'] + ' | ' + match['host']:
            raise ValueError('Audio devices changed. Refresh and reselect your device.')
        return match
    mic, speaker = explicit('inputDevice', 'inputs'), explicit('outputDevice', 'outputs')
    pair = None
    for label in ('CMF Buds 2a', 'Realtek'):
        for host in ('MME', 'Windows WASAPI', 'Windows DirectSound'):
            ins = [d for d in available if d['inputs'] and label in d['name'] and d['host'] == host]
            outs = [d for d in available if d['outputs'] and label in d['name'] and d['host'] == host]
            if ins and outs:
                pair = (ins[0], outs[0])
                break
        if pair:
            break
    if pair:
        return mic or pair[0], speaker or pair[1]
    default_in, default_out = sd.default.device
    return (mic or next(d for d in available if d['id'] == default_in),
            speaker or next(d for d in available if d['id'] == default_out))


class Microphone(io.AudioInput):
    def __init__(self, loop, device, output, interruptions):
        super().__init__(label=device['name'])
        self.loop, self.output = loop, output
        self.interruptions = interruptions
        self.rate = device['rate']
        self.queue = asyncio.Queue(maxsize=100)
        self.callbacks = 0
        self.last_meter = 0
        self.stream = sd.InputStream(device=device['id'], samplerate=self.rate,
            channels=1, dtype='int16', blocksize=int(self.rate * .02), callback=self.callback)

    def push(self, frame):
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(frame)

    def callback(self, data, frames, timing, status):
        self.callbacks += 1
        level = float(np.sqrt(np.mean(data.astype(np.float64) ** 2))) / 32768
        now = time.monotonic()
        if now - self.last_meter > .12:
            self.last_meter = now
            self.loop.call_soon_threadsafe(lambda v=level: emit('level', level=v))
        # Half duplex prevents the laptop speakers becoming the next user turn.
        audio = data.tobytes() if self.interruptions or not self.output.playing else bytes(data.nbytes)
        frame = rtc.AudioFrame(data=audio, sample_rate=self.rate, num_channels=1,
                               samples_per_channel=frames)
        self.loop.call_soon_threadsafe(self.push, frame)

    async def __anext__(self):
        return await self.queue.get()

    def close(self):
        self.stream.stop()
        self.stream.close()


class Speaker(io.AudioOutput):
    def __init__(self, loop, device):
        super().__init__(label=device['name'], capabilities=io.AudioOutputCapabilities(pause=False),
                         sample_rate=device['rate'])
        self.loop, self.rate = loop, device['rate']
        self.lock = threading.Lock()
        self.buffer = bytearray()
        self.duration = 0
        self.played = 0
        self.generation = 0
        self.finisher = None
        self.playing = False
        self.started = False
        self.stream = sd.OutputStream(device=device['id'], samplerate=self.rate, channels=1,
            dtype='int16', blocksize=int(self.rate * .02), callback=self.callback)

    def callback(self, outdata, frames, timing, status):
        with self.lock:
            count = min(len(self.buffer), frames * 2)
            outdata.fill(0)
            if count:
                if not self.started:
                    self.started = True
                    self.loop.call_soon_threadsafe(lambda: self.on_playback_started(created_at=time.time()))
                outdata[:count // 2, 0] = np.frombuffer(self.buffer[:count], dtype=np.int16)
                del self.buffer[:count]
                self.played += count / (2 * self.rate)

    async def capture_frame(self, frame):
        if self.finisher and not self.finisher.done():
            await self.finisher
        await super().capture_frame(frame)
        while len(self.buffer) > self.rate * 2 * 3:
            await asyncio.sleep(.02)
        with self.lock:
            self.buffer.extend(frame.data)
        self.duration += frame.duration
        self.playing = True

    def flush(self):
        super().flush()
        if not self.duration:
            return
        token = self.generation
        async def finish():
            while self.buffer and token == self.generation:
                await asyncio.sleep(.02)
            await asyncio.sleep(float(self.stream.latency))
            if token == self.generation:
                self.on_playback_finished(playback_position=self.played, interrupted=False)
                self.duration = self.played = 0
                self.playing = self.started = False
        self.finisher = asyncio.create_task(finish())

    def clear_buffer(self):
        with self.lock:
            self.buffer.clear()
        self.generation += 1
        if self.finisher:
            self.finisher.cancel()
        if self.duration:
            self.on_playback_finished(playback_position=self.played, interrupted=True)
        self.duration = self.played = 0
        self.playing = self.started = False

    def close(self):
        self.clear_buffer()
        self.stream.stop()
        self.stream.close()


class DesktopAgent:
    def __init__(self):
        self.session = self.mic = self.speaker = self.http = None
        self.tasks = set()

    async def stop(self):
        for task in self.tasks:
            task.cancel()
        self.tasks.clear()
        if self.mic:
            self.mic.close()
            self.mic = None
        if self.session:
            try:
                await asyncio.wait_for(self.session.aclose(), timeout=4)
            except (Exception, asyncio.CancelledError):
                pass
            self.session = None
        if self.speaker:
            self.speaker.close()
            self.speaker = None
        if self.http:
            await self.http.close()
            self.http = None
        emit('status', state='stopped')

    async def start(self, config):
        await self.stop()
        if not config.get('sarvamKey', '').strip():
            raise ValueError('Add your Sarvam API key in Settings.')
        provider = config.get('provider', 'livekit')
        if provider == 'livekit' and not all(config.get(k, '').strip() for k in ('livekitKey','livekitSecret','livekitUrl')):
            raise ValueError('Add the LiveKit URL, API key and API secret in Settings.')
        emit('status', state='starting')
        for field, env in [('sarvamKey','SARVAM_API_KEY'),('livekitKey','LIVEKIT_API_KEY'),
                           ('livekitSecret','LIVEKIT_API_SECRET'),('livekitUrl','LIVEKIT_URL')]:
            os.environ[env] = config.get(field, '').strip()
        available = devices()
        mic_device, speaker_device = select_devices(available, config)
        self.http = aiohttp.ClientSession()
        self.speaker = Speaker(asyncio.get_running_loop(), speaker_device)
        self.mic = Microphone(asyncio.get_running_loop(), mic_device, self.speaker,
                              config.get('interruptions', False))
        language = config.get('language', 'en-IN')
        llm = (openai.LLM.with_ollama(model=config.get('ollamaModel','gemma4:e2b'),
                    base_url=config.get('ollamaUrl','http://localhost:11434/v1'))
               if provider == 'ollama' else inference.LLM(model='google/gemma-4-31b-it'))
        self.session = AgentSession(
            stt=sarvam.STT(model='saaras:v4',language=language,mode='transcribe',http_session=self.http),
            tts=sarvam.TTS(model='bulbul:v3',speaker='shubh',target_language_code=language,
                           http_session=self.http), llm=llm, vad=silero.VAD.load(),
            turn_handling={'turn_detection':'vad', 'interruption':{
                'enabled':config.get('interruptions',False),'mode':'vad'}},
        )
        self.session.input.audio = self.mic
        self.session.output.audio = self.speaker
        @self.session.on('agent_state_changed')
        def state(event):
            emit('status',state=event.new_state)
        @self.session.on('user_input_transcribed')
        def transcript(event):
            if event.is_final:
                emit('transcript',role='user',text=event.transcript)
        @self.session.on('conversation_item_added')
        def conversation(event):
            if event.item.role == 'assistant':
                emit('transcript',role='assistant',text=event.item.text_content)
        @self.session.on('error')
        def error(event):
            # Do not send SDK exception objects or HTTP headers to the renderer.
            emit('error',message='A speech or model request failed. Check your keys, connection and provider quota.')
        self.speaker.stream.start()
        self.mic.stream.start()
        emit('selected', microphone=mic_device['name'],speaker=speaker_device['name'])
        await self.session.start(agent=Agent(instructions=
            'You are a friendly voice assistant. Speak in '+config.get('languageName','English')+
            '. Keep answers to one or two short spoken sentences. No Markdown. '
            'You have no external action tools; never claim to book or send anything.'))
        async def watch():
            await asyncio.sleep(3)
            if self.mic and not self.mic.callbacks:
                emit('error',message='The microphone opened but is delivering no audio. Reconnect it or select the laptop microphone.')
        self.tasks.add(asyncio.create_task(watch()))
        self.tasks.add(asyncio.ensure_future(self.session.generate_reply(
            instructions='Briefly introduce yourself as an AI assistant and ask how you can help.')))


async def main():
    app = DesktopAgent()
    commands = asyncio.Queue()
    loop = asyncio.get_running_loop()
    def reader():
        for line in sys.stdin:
            try:
                command = json.loads(line)
                loop.call_soon_threadsafe(commands.put_nowait,command)
            except (ValueError,RuntimeError):
                pass
        try:
            loop.call_soon_threadsafe(commands.put_nowait,{'action':'quit'})
        except RuntimeError:
            pass
    threading.Thread(target=reader,daemon=True).start()
    emit('ready')
    while True:
        command = await commands.get()
        try:
            action = command.get('action')
            if action == 'quit':
                await app.stop()
                break
            if action == 'devices':
                if app.session:
                    raise ValueError('Stop the agent before refreshing audio devices.')
                emit('devices',devices=devices())
            elif action == 'selftest':
                silero.VAD.load()
                rtc.AudioResampler(input_rate=48000,output_rate=16000,num_channels=1)
                # Constructors load HTTP transports lazily: imports alone missed
                # missing distribution metadata in the first frozen release.
                hosted = inference.LLM(model='google/gemma-4-31b-it',
                    api_key='offline-selftest',api_secret='x'*48,
                    base_url='http://127.0.0.1:1/v1')
                local = openai.LLM.with_ollama(model='gemma4:e2b',
                    base_url='http://127.0.0.1:1/v1')
                await hosted.aclose()
                await local.aclose()
                emit('selftest',ok=True,model_clients=True,device_count=len(devices()))
            elif action == 'start':
                await app.start(command.get('config',{}))
            elif action == 'stop':
                await app.stop()
            elif action == 'tone':
                if app.session:
                    raise ValueError('Stop the agent before testing playback.')
                _, output = select_devices(devices(),command.get('config',{}))
                rate=output['rate']
                t=np.arange(int(rate*.5))/rate
                tone=(.07*np.sin(2*np.pi*660*t)*np.minimum(t*100,1)*np.minimum((t[-1]-t)*100,1)).astype('float32')
                await asyncio.to_thread(sd.play,tone,rate,device=output['id'],blocking=True)
                emit('notice',message='Test tone played through '+output['name'])
        except Exception as error:
            await app.stop()
            # Error text may contain request URLs but never serialize configuration.
            text = str(error)
            for value in command.get('config',{}).values():
                if isinstance(value,str) and len(value)>8:
                    text=text.replace(value,'[redacted]')
            emit('error',message=text[:400] or 'The audio backend could not start.')


if __name__ == '__main__':
    asyncio.run(main())
