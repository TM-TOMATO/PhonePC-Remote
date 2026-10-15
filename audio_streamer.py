"""
Windows System Audio Loopback Streamer for PhonePC Remote
Captures default output device (speakers/headphones) using WASAPI Loopback via pyaudiowpatch,
and broadcasts PCM audio frames to subscribed clients.
"""

import threading
import time
import pyaudiowpatch as pyaudio

class AudioStreamer:
    def __init__(self, sample_rate=48000, channels=2, chunk_size=1024):
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_size = chunk_size
        self.is_running = False
        self.thread = None
        self.subscribers = set()
        self.lock = threading.Lock()
        self._p = None
        self._stream = None

    def add_subscriber(self, ws):
        with self.lock:
            self.subscribers.add(ws)

    def remove_subscriber(self, ws):
        with self.lock:
            self.subscribers.discard(ws)

    def has_subscribers(self):
        with self.lock:
            return len(self.subscribers) > 0

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.is_running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        self._cleanup()

    def _cleanup(self):
        if self._stream:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        if self._p:
            try:
                self._p.terminate()
            except Exception:
                pass
            self._p = None

    def _capture_loop(self):
        while self.is_running:
            try:
                self._p = pyaudio.PyAudio()
                wasapi_info = self._p.get_host_api_info_by_type(pyaudio.paWASAPI)
                default_speakers = self._p.get_device_info_by_index(wasapi_info['defaultOutputDevice'])

                loopback_device = None
                for loopback in self._p.get_loopback_device_info_generator():
                    if default_speakers['name'] in loopback['name']:
                        loopback_device = loopback
                        break

                if not loopback_device:
                    time.sleep(2.0)
                    self._cleanup()
                    continue

                rate = int(loopback_device['defaultSampleRate'])
                channels = loopback_device['maxInputChannels']

                self._stream = self._p.open(
                    format=pyaudio.paInt16,
                    channels=channels,
                    rate=rate,
                    input=True,
                    input_device_index=loopback_device['index'],
                    frames_per_buffer=self.chunk_size
                )

                while self.is_running:
                    # Read loopback PCM frame
                    try:
                        data = self._stream.read(self.chunk_size, exception_on_overflow=False)
                    except Exception:
                        break

                    # Only broadcast if there are active subscribers
                    if self.has_subscribers():
                        self._broadcast(data)
                    else:
                        time.sleep(0.05)

            except Exception as e:
                # Device might have changed or temporarily unavailable
                time.sleep(1.0)
            finally:
                self._cleanup()

    def _broadcast(self, data):
        with self.lock:
            dead_clients = []
            for ws in list(self.subscribers):
                try:
                    if ws.closed:
                        dead_clients.append(ws)
                    else:
                        # Non-blocking async send or queue handled by caller
                        ws._loop.call_soon_threadsafe(self._safe_send_bytes, ws, data)
                except Exception:
                    dead_clients.append(ws)

            for ws in dead_clients:
                self.subscribers.discard(ws)

    @staticmethod
    def _safe_send_bytes(ws, data):
        try:
            if not ws.closed:
                import asyncio
                asyncio.create_task(ws.send_bytes(data))
        except Exception:
            pass
