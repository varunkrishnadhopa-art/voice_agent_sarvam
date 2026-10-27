import asyncio
import unittest
from unittest.mock import patch
import numpy as np
from livekit import rtc
from desktop_agent import Speaker


class FakeStream:
    latency=0
    def __init__(self,**kwargs):
        self.callback=kwargs['callback']
    def stop(self):
        pass
    def close(self):
        pass


class PlaybackTests(unittest.IsolatedAsyncioTestCase):
    async def test_audio_reaches_callback_and_finishes(self):
        with patch('desktop_agent.sd.OutputStream',FakeStream):
            sink=Speaker(asyncio.get_running_loop(),{'name':'Test','id':0,'rate':16000})
        samples=np.full(320,1000,dtype=np.int16)
        frame=rtc.AudioFrame(data=samples.tobytes(),sample_rate=16000,num_channels=1,samples_per_channel=320)
        await sink.capture_frame(frame)
        output=np.zeros((320,1),dtype=np.int16)
        sink.callback(output,320,None,None)
        self.assertTrue(np.array_equal(output[:,0],samples))
        sink.flush()
        event=await asyncio.wait_for(sink.wait_for_playout(),1)
        self.assertAlmostEqual(event.playback_position,.02)
        self.assertFalse(event.interrupted)
        self.assertFalse(sink.playing)
        sink.close()

    async def test_stop_discards_queued_audio(self):
        with patch('desktop_agent.sd.OutputStream',FakeStream):
            sink=Speaker(asyncio.get_running_loop(),{'name':'Test','id':0,'rate':16000})
        frame=rtc.AudioFrame(data=np.ones(320,dtype=np.int16).tobytes(),sample_rate=16000,num_channels=1,samples_per_channel=320)
        await sink.capture_frame(frame)
        sink.clear_buffer()
        event=await asyncio.wait_for(sink.wait_for_playout(),1)
        self.assertTrue(event.interrupted)
        output=np.ones((320,1),dtype=np.int16)
        sink.callback(output,320,None,None)
        self.assertFalse(output.any())
        sink.close()
