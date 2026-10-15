"""
Windows Input Controller for PhonePC Remote
Uses ctypes user32 for zero-latency mouse operations,
and pyautogui/pyperclip for reliable keyboard & unicode text typing.
"""
import ctypes
import time
import pyautogui
import pyperclip

# Disable PyAutoGUI artificial pause to allow 60fps real-time tracking
pyautogui.PAUSE = 0
pyautogui.FAILSAFE = False

# Windows mouse_event flags
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800

user32 = ctypes.windll.user32

class InputController:
    def __init__(self):
        self.is_dragging = False

    def mouse_move(self, dx: float, dy: float):
        """Ultra-fast relative mouse movement via Windows API"""
        idx = int(round(dx))
        idy = int(round(dy))
        if idx != 0 or idy != 0:
            user32.mouse_event(MOUSEEVENTF_MOVE, idx, idy, 0, 0)

    def mouse_move_abs(self, rx: float, ry: float):
        """Move cursor directly to normalized screen coordinates (0.0 ~ 1.0)"""
        screen_w = user32.GetSystemMetrics(0)
        screen_h = user32.GetSystemMetrics(1)
        x = int(round(rx * screen_w))
        y = int(round(ry * screen_h))
        x = max(0, min(screen_w - 1, x))
        y = max(0, min(screen_h - 1, y))
        user32.SetCursorPos(x, y)

    def mouse_down(self, button: str = "left"):
        """Press and hold mouse button"""
        if button == "left":
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        elif button == "right":
            user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
        elif button == "middle":
            user32.mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)

    def mouse_up(self, button: str = "left"):
        """Release mouse button"""
        if button == "left":
            user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        elif button == "right":
            user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        elif button == "middle":
            user32.mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)

    def mouse_click(self, button: str = "left", action: str = "click"):
        """Handle single click, double click, down, or up"""
        if action == "down":
            self.mouse_down(button)
        elif action == "up":
            self.mouse_up(button)
        elif action == "double":
            self.mouse_down(button)
            self.mouse_up(button)
            time.sleep(0.04)
            self.mouse_down(button)
            self.mouse_up(button)
        else: # single click
            self.mouse_down(button)
            time.sleep(0.01)
            self.mouse_up(button)

    def mouse_scroll(self, amount: float):
        """Scroll vertical wheel. Positive = up, Negative = down"""
        # Windows wheel tick is typically 120 per notch
        wheel_delta = int(round(amount * 120))
        if wheel_delta != 0:
            user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, wheel_delta, 0)

    def _resolve_key(self, key: str) -> str:
        key_lower = key.lower()
        key_map = {
            "enter": "enter",
            "backspace": "backspace",
            "bksp": "backspace",
            "tab": "tab",
            "esc": "esc",
            "escape": "esc",
            "space": "space",
            "win": "win",
            "windows": "win",
            "ctrl": "ctrl",
            "alt": "alt",
            "shift": "shift",
            "del": "delete",
            "delete": "delete",
            "up": "up",
            "down": "down",
            "left": "left",
            "right": "right",
            "volumeup": "volumeup",
            "volumedown": "volumedown",
            "volumemute": "volumemute",
        }
        return key_map.get(key_lower, key_lower)

    def key_down(self, key: str):
        """Press and hold key down (for multi-touch & combos like Alt+Tab)"""
        target = self._resolve_key(key)
        try:
            pyautogui.keyDown(target)
        except Exception:
            pass

    def key_up(self, key: str):
        """Release a pressed key"""
        target = self._resolve_key(key)
        try:
            pyautogui.keyUp(target)
        except Exception:
            pass

    def release_all_keys(self):
        """Release common modifier keys to prevent keys from being stuck"""
        for k in ["ctrl", "alt", "shift", "win"]:
            try:
                pyautogui.keyUp(k)
            except Exception:
                pass

    def key_press(self, key: str, modifiers: list = None):
        """Press a key or key combination"""
        target_key = self._resolve_key(key)

        if modifiers and len(modifiers) > 0:
            combo = [self._resolve_key(m) for m in modifiers] + [target_key]
            try:
                pyautogui.hotkey(*combo)
            except Exception:
                pass
        else:
            try:
                pyautogui.press(target_key)
            except Exception:
                pass

    def text_input(self, text: str):
        """Type unicode text (including Korean) by fast clipboard paste"""
        if not text:
            return
        old_clipboard = pyperclip.paste()
        try:
            pyperclip.copy(text)
            pyautogui.hotkey('ctrl', 'v')
            # Slight pause to let OS process paste before restoring
            time.sleep(0.05)
        finally:
            pyperclip.copy(old_clipboard)

