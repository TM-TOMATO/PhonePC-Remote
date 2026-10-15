"""
Ultra-fast Screen Streamer for PhonePC Remote
Captures desktop screen using mss / GDI, overlays cursor,
and encodes to efficient JPEG frames for real-time mobile streaming.
Supports dynamic quality/resolution presets:
- 'ultra': Native PC monitor resolution (e.g. 2560x1440), JPEG quality 85
- 'high': 1920x1080 (FHD), JPEG quality 78 (Default: Crisp text, smooth FPS)
- 'normal': 1280x720 (HD), JPEG quality 60 (Data saving / slow cellular)
"""

import asyncio
import ctypes
from ctypes import wintypes
import threading
import time
import cv2
import mss
import numpy as np
import pyautogui

user32 = ctypes.windll.user32

class ScreenStreamer:
    def __init__(self, preset="high"):
        # Screen dimensions
        self.screen_width = user32.GetSystemMetrics(0)
        self.screen_height = user32.GetSystemMetrics(1)

        self.lock = threading.Lock()
        self.preset = preset
        self.target_width = 1920
        self.target_height = 1080
        self.quality = 78
        self.set_preset(preset)

        self.latest_frame = None
        self.is_running = False
        self.thread = None

    def set_preset(self, preset="high"):
        with self.lock:
            self.preset = preset
            sw = self.screen_width
            sh = self.screen_height

            if preset == "ultra":
                # Native 1:1 pixel resolution (e.g. 2560x1440), high JPEG quality
                self.target_width = sw
                self.target_height = sh
                self.quality = 85
            elif preset == "high":
                # 1080p FHD (or native if native is smaller)
                if sw <= 1920:
                    self.target_width = sw
                    self.target_height = sh
                else:
                    self.target_width = 1920
                    self.target_height = int(1920 * (sh / sw))
                self.quality = 78
            else:  # "normal"
                # 720p HD
                if sw <= 1280:
                    self.target_width = sw
                    self.target_height = sh
                else:
                    self.target_width = 1280
                    self.target_height = int(1280 * (sh / sw))
                self.quality = 60

    def _attach_desktop(self):
        """Ensure current thread is attached to interactive desktop"""
        try:
            winsta = user32.OpenWindowStationW("WinSta0", False, 0x037F)
            if winsta:
                user32.SetProcessWindowStation(winsta)
            hdesk = user32.OpenInputDesktop(0, False, 0x01FF)
            if hdesk:
                user32.SetThreadDesktop(hdesk)
        except Exception:
            pass

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.is_running = False
        if self.thread:
            self.thread.join(timeout=1.0)

    def _capture_loop(self):
        self._attach_desktop()
        sct = mss.mss()
        monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]

        while self.is_running:
            t0 = time.time()
            try:
                with self.lock:
                    target_w = self.target_width
                    target_h = self.target_height
                    quality = self.quality
                    sw = self.screen_width
                    sh = self.screen_height

                scale_x = target_w / sw
                scale_y = target_h / sh
                encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]

                # Capture frame
                raw_img = np.array(sct.grab(monitor))

                # If target resolution matches native, NO resize needed!
                if target_w == sw and target_h == sh:
                    processed_img = raw_img
                else:
                    processed_img = cv2.resize(raw_img, (target_w, target_h), interpolation=cv2.INTER_LINEAR)

                # Overlay current mouse cursor position
                try:
                    pt = wintypes.POINT()
                    user32.GetCursorPos(ctypes.byref(pt))
                    cx = int(pt.x * scale_x)
                    cy = int(pt.y * scale_y)
                    if 0 <= cx < target_w and 0 <= cy < target_h:
                        # Draw high-visibility cursor marker
                        cv2.circle(processed_img, (cx, cy), 7, (0, 240, 255), 2)  # Yellow circle
                        cv2.circle(processed_img, (cx, cy), 3, (0, 0, 255), -1)   # Red dot
                except Exception:
                    pass

                # Encode to JPEG
                _, jpeg_bytes = cv2.imencode('.jpg', processed_img, encode_params)

                with self.lock:
                    self.latest_frame = jpeg_bytes.tobytes()

            except Exception:
                # Re-attach desktop if needed (e.g. lock screen change)
                self._attach_desktop()
                time.sleep(0.1)

            # Limit to ~30 FPS to conserve CPU and network bandwidth
            elapsed = time.time() - t0
            sleep_time = max(0.005, (1.0 / 30.0) - elapsed)
            time.sleep(sleep_time)

    def get_latest_frame(self):
        with self.lock:
            return self.latest_frame
