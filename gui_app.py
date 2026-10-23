"""
PhonePC Remote - Windows Native Desktop GUI Host Application
TeamViewer-style native desktop window displaying Partner ID, PIN, live QR code,
and automatic Cloudflare Internet Tunnel (works across different routers/LTE).
"""

import asyncio
import ctypes
import io
import json
import os
import random
import re
import socket
import subprocess
import sys
import threading
import time
import tempfile
import urllib.request
import uuid
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path
from PIL import Image, ImageTk
import qrcode
from aiohttp import web
from input_controller import InputController
from screen_streamer import ScreenStreamer
from audio_streamer import AudioStreamer

# Streamer instances
streamer = ScreenStreamer(preset="high")
audio_streamer = AudioStreamer()

# App directory resolution (supports both python script and compiled .exe)
if getattr(sys, "frozen", False):
    EXE_DIR = Path(sys.executable).parent.resolve()
    MEIPASS_DIR = Path(getattr(sys, "_MEIPASS", EXE_DIR)).resolve()
    BASE_DIR = EXE_DIR
    STATIC_DIR = MEIPASS_DIR / "web" if (MEIPASS_DIR / "web").exists() else EXE_DIR / "web"
    CLOUDFLARED_PATH = MEIPASS_DIR / "cloudflared.exe" if (MEIPASS_DIR / "cloudflared.exe").exists() else EXE_DIR / "cloudflared.exe"
else:
    BASE_DIR = Path(__file__).parent.resolve()
    STATIC_DIR = BASE_DIR / "web"
    CLOUDFLARED_PATH = BASE_DIR / "cloudflared.exe"

# Input controller
controller = InputController()

# -----------------------------------------------------------------------------
# Trusted Device (Passwordless Unattended Access) System
# -----------------------------------------------------------------------------
TRUSTED_DEVICES_FILE = BASE_DIR / "trusted_devices.json"

def load_trusted_devices():
    if TRUSTED_DEVICES_FILE.exists():
        try:
            with open(TRUSTED_DEVICES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_trusted_device(device_id, token, device_name=""):
    devices = load_trusted_devices()
    devices[token] = {
        "device_id": device_id,
        "device_name": device_name,
        "created_at": int(time.time()),
        "created_date": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    try:
        with open(TRUSTED_DEVICES_FILE, "w", encoding="utf-8") as f:
            json.dump(devices, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving trusted device: {e}")

def verify_trusted_token(token):
    if not token:
        return False
    devices = load_trusted_devices()
    return token in devices

def clear_trusted_devices():
    try:
        if TRUSTED_DEVICES_FILE.exists():
            TRUSTED_DEVICES_FILE.unlink()
    except Exception:
        pass

def _show_native_confirm_box(device_name):
    title = "PhonePC Remote - 본인 확인 (기기 등록)"
    message = (
        f"📱 스마트폰 [{device_name}]에서 이 PC를 '저장된 컴퓨터'로 등록하여,\n"
        f"앞으로 비밀번호나 QR 코드 없이 즉시 원격 제어할 수 있도록 요청했습니다.\n\n"
        f"본인이 직접 요청하신 것이 맞습니까?\n\n"
        f"• [예]를 누르면 등록되어 다음부터 원클릭으로 바로 연결됩니다.\n"
        f"• [아니오]를 누르면 등록 요청이 취소됩니다."
    )
    # MB_YESNO | MB_ICONQUESTION | MB_TOPMOST | MB_SETFOREGROUND | MB_SYSTEMMODAL
    flags = 0x00000004 | 0x00000020 | 0x00040000 | 0x00010000 | 0x00001000
    res = ctypes.windll.user32.MessageBoxW(0, message, title, flags)
    return res == 6  # IDYES == 6

async def show_pc_confirm_dialog(device_name):
    # 1. Try dedicated standalone Tkinter confirmation dialog subprocess (when running as python script)
    dialog_script = BASE_DIR / "confirm_dialog.py"
    if not getattr(sys, "frozen", False) and dialog_script.exists():
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                str(dialog_script),
                str(device_name)
            )
            try:
                await asyncio.wait_for(proc.wait(), timeout=65.0)
                return proc.returncode == 0
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except Exception:
                    pass
                return False
        except Exception as e:
            print(f"[Confirm] Subprocess dialog error, falling back to GUI root: {e}")

    # 2. Try GUI root popup if available
    global gui_root
    loop = asyncio.get_running_loop()
    if gui_root:
        future = loop.create_future()
        def _invoke():
            try:
                gui_root.show_device_confirm_popup(device_name, future, loop)
            except Exception as e:
                print(f"[Confirm] GUI popup error, using fallback: {e}")
                def _fallback():
                    res = _show_native_confirm_box(device_name)
                    loop.call_soon_threadsafe(future.set_result, res)
                threading.Thread(target=_fallback, daemon=True).start()
        gui_root.after(0, _invoke)
        return await future
    else:
        return await loop.run_in_executor(None, _show_native_confirm_box, device_name)

HOST_CONFIG_FILE = BASE_DIR / "host_config.json"

def load_or_create_host_config():
    config = {}
    if HOST_CONFIG_FILE.exists():
        try:
            with open(HOST_CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            config = {}

    modified = False
    raw_id = str(config.get("partner_id", "")).strip().replace(" ", "")
    if not raw_id.isdigit() or len(raw_id) != 9:
        config["partner_id"] = str(random.randint(100000000, 999999999))
        modified = True

    raw_pin = str(config.get("pin", "")).strip()
    if not raw_pin.isdigit() or len(raw_pin) != 4:
        config["pin"] = str(random.randint(1000, 9999))
        modified = True

    if modified:
        save_host_config(config)

    return config

def save_host_config(config):
    try:
        with open(HOST_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving host config: {e}")

# Persistent Credentials (TeamViewer style: ID stays consistent, PIN persists or can be refreshed)
_host_cfg = load_or_create_host_config()
SESSION_ID_RAW = _host_cfg["partner_id"]
FORMATTED_ID = f"{SESSION_ID_RAW[0:3]} {SESSION_ID_RAW[3:6]} {SESSION_ID_RAW[6:9]}"
SESSION_PIN = _host_cfg["pin"]

# URLs
LOCAL_IP = "127.0.0.1"
PORT = 8080
PUBLIC_TUNNEL_URL = ""
CURRENT_CONNECT_URL = ""

# Status tracking
is_client_connected = False
cloudflared_proc = None
server_runner = None
gui_root = None

def get_local_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip

LOCAL_IP = get_local_lan_ip()
CURRENT_CONNECT_URL = f"http://{LOCAL_IP}:{PORT}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"

# -----------------------------------------------------------------------------
# AioHTTP Web & WebSocket Server
# -----------------------------------------------------------------------------
APP_VERSION = "2.2.0"
BUILD_TIME = int(time.time())
authenticated_clients = set()

async def handle_index(request):
    return web.FileResponse(
        STATIC_DIR / "index.html",
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    )

async def handle_version(request):
    return web.json_response({
        "version": APP_VERSION,
        "build_time": BUILD_TIME
    }, headers={
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*'
    })

async def handle_qr_image(request):
    img = qrcode.make(CURRENT_CONNECT_URL)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return web.Response(body=buf.read(), content_type="image/png")

async def handle_download_apk(request):
    apk_file = STATIC_DIR / "PhonePC_Remote_v2.2.0.apk"
    if not apk_file.exists():
        apk_file = BASE_DIR / "PhonePC_Remote_v2.2.0.apk"
    if apk_file.exists():
        return web.FileResponse(apk_file, headers={
            'Content-Disposition': 'attachment; filename="PhonePC_Remote_v2.2.0.apk"',
            'Content-Type': 'application/vnd.android.package-archive'
        })
    return web.Response(text="APK not found", status=404)

async def handle_download_setup(request):
    setup_file = STATIC_DIR / "PhonePC_Remote_v2.2.0_Setup.exe"
    if not setup_file.exists():
        setup_file = BASE_DIR / "PhonePC_Remote_v2.2.0_Setup.exe"
    if setup_file.exists():
        return web.FileResponse(setup_file, headers={
            'Content-Disposition': 'attachment; filename="PhonePC_Remote_v2.2.0_Setup.exe"',
            'Content-Type': 'application/octet-stream'
        })
    return web.Response(text="Setup installer not found", status=404)

async def handle_download_pc(request):
    pc_file = STATIC_DIR / "PhonePC_Remote.exe"
    if not pc_file.exists():
        pc_file = BASE_DIR / "PhonePC_Remote.exe"
    if pc_file.exists():
        return web.FileResponse(pc_file, headers={
            'Content-Disposition': 'attachment; filename="PhonePC_Remote.exe"',
            'Content-Type': 'application/octet-stream'
        })
    return web.Response(text="PC executable not found", status=404)


async def handle_screen_stream(request):
    """Multipart MJPEG live desktop screen streaming"""
    response = web.StreamResponse(
        status=200,
        reason='OK',
        headers={
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*'
        }
    )
    await response.prepare(request)
    try:
        while True:
            frame = streamer.get_latest_frame()
            if frame:
                try:
                    await asyncio.wait_for(
                        response.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'),
                        timeout=4.0
                    )
                except (asyncio.TimeoutError, ConnectionResetError, Exception):
                    break
            await asyncio.sleep(0.033)  # ~30 FPS
    except Exception:
        pass
    return response

async def handle_session_info(request):
    return web.json_response({
        "id": SESSION_ID_RAW,
        "formatted_id": FORMATTED_ID,
        "pin": SESSION_PIN,
        "url": CURRENT_CONNECT_URL,
        "is_tunnel": bool(PUBLIC_TUNNEL_URL)
    })

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    ws._loop = asyncio.get_running_loop()
    client_ip = request.remote
    is_authenticated = False

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    msg_type = data.get("type")
                    payload = data.get("payload", {})

                    if msg_type == "auth":
                        req_id = str(payload.get("id", "")).replace(" ", "").strip()
                        req_pin = str(payload.get("pin", "")).strip()

                        if req_id == SESSION_ID_RAW and req_pin == SESSION_PIN:
                            is_authenticated = True
                            authenticated_clients.add(client_ip)
                            audio_streamer.add_subscriber(ws)
                            await ws.send_json({"type": "auth_success"})
                            update_gui_status(True, client_ip)
                        else:
                            await ws.send_json({
                                "type": "auth_fail",
                                "payload": {"message": "ID 또는 비밀번호가 일치하지 않습니다."}
                            })
                        continue

                    elif msg_type == "auth_token":
                        req_token = str(payload.get("token", "")).strip()

                        if verify_trusted_token(req_token):
                            is_authenticated = True
                            authenticated_clients.add(client_ip)
                            audio_streamer.add_subscriber(ws)
                            print(f"[★] 저장된 기기 토큰 인증 성공! (비번/QR 생략 즉시 연결): {client_ip}")
                            await ws.send_json({
                                "type": "auth_success",
                                "payload": {
                                    "message": "저장된 컴퓨터 인증 성공!",
                                    "pc_id": SESSION_ID_RAW,
                                    "pc_name": socket.gethostname()
                                }
                            })
                            update_gui_status(True, client_ip)
                        else:
                            print(f"[!] 저장된 기기 토큰 인증 실패: {client_ip}")
                            await ws.send_json({
                                "type": "auth_fail",
                                "payload": {"message": "저장된 컴퓨터 인증 토큰이 유효하지 않거나 등록이 해제되었습니다."}
                            })
                        continue

                    if not is_authenticated:
                        await ws.send_json({"type": "auth_required"})
                        continue

                    # Input & Control handlers
                    if msg_type == "request_save_pc":
                        dev_id = str(payload.get("device_id", "unknown")).strip()
                        dev_name = str(payload.get("device_name", "스마트폰 기기")).strip()

                        confirmed = await show_pc_confirm_dialog(dev_name)
                        if confirmed:
                            tok = uuid.uuid4().hex
                            save_trusted_device(dev_id, tok, dev_name)
                            await ws.send_json({
                                "type": "save_pc_success",
                                "payload": {
                                    "token": tok,
                                    "pc_id": SESSION_ID_RAW,
                                    "pc_name": socket.gethostname()
                                }
                            })
                        else:
                            await ws.send_json({
                                "type": "save_pc_rejected",
                                "payload": {"message": "PC 화면에서 등록 승인이 거부되었습니다."}
                            })
                        continue

                    # Input handlers
                    if msg_type == "mouse_move_abs":
                        rx = float(payload.get("rx", 0))
                        ry = float(payload.get("ry", 0))
                        controller.mouse_move_abs(rx, ry)
                    elif msg_type == "mouse_move":
                        controller.mouse_move(float(payload.get("dx", 0)), float(payload.get("dy", 0)))
                    elif msg_type == "mouse_click":
                        controller.mouse_click(payload.get("button", "left"), payload.get("action", "click"))
                    elif msg_type == "mouse_scroll":
                        controller.mouse_scroll(float(payload.get("amount", 0)))
                    elif msg_type == "key_press":
                        controller.key_press(payload.get("key", ""), payload.get("modifiers", []))
                    elif msg_type == "key_down":
                        controller.key_down(payload.get("key", ""))
                    elif msg_type == "key_up":
                        controller.key_up(payload.get("key", ""))
                    elif msg_type == "release_all_keys":
                        controller.release_all_keys()
                    elif msg_type == "audio_enable":
                        if payload.get("enabled", True):
                            audio_streamer.add_subscriber(ws)
                        else:
                            audio_streamer.remove_subscriber(ws)
                    elif msg_type == "screen_quality":
                        preset = payload.get("preset", "high")
                        streamer.set_preset(preset)
                    elif msg_type == "text_input":
                        controller.text_input(payload.get("text", ""))
                    elif msg_type == "ping":
                        await ws.send_json({"type": "pong", "time": payload.get("time")})
                except Exception:
                    pass
    finally:
        authenticated_clients.discard(client_ip)
        audio_streamer.remove_subscriber(ws)
        controller.release_all_keys()
        update_gui_status(len(authenticated_clients) > 0)

    return ws

def free_port(port):
    try:
        result = subprocess.run(['netstat', '-ano', '-p', 'TCP'], capture_output=True, text=True, errors='ignore')
        for line in result.stdout.splitlines():
            if f':{port}' in line and 'LISTENING' in line:
                pid = line.strip().split()[-1]
                subprocess.run(['taskkill', '/F', '/PID', pid], capture_output=True)
        time.sleep(0.5)
    except Exception:
        pass

def run_server_loop():
    free_port(PORT)
    # Start screen and audio capture loops
    streamer.start()
    audio_streamer.start()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    app = web.Application()
    app.router.add_get("/", handle_index)
    app.router.add_get("/download/apk", handle_download_apk)
    app.router.add_get("/download/setup", handle_download_setup)
    app.router.add_get("/download/pc", handle_download_pc)
    app.router.add_get("/screen_stream", handle_screen_stream)
    app.router.add_get("/qr.png", handle_qr_image)
    app.router.add_get("/api/session-info", handle_session_info)
    app.router.add_get("/api/version", handle_version)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_static("/", path=STATIC_DIR, name="static")

    runner = web.AppRunner(app)
    loop.run_until_complete(runner.setup())
    site = web.TCPSite(runner, "0.0.0.0", PORT)
    loop.run_until_complete(site.start())
    loop.run_forever()


# -----------------------------------------------------------------------------
# Cloudflare Tunnel Background Worker
# -----------------------------------------------------------------------------
def cleanup_cloudflared():
    try:
        subprocess.run(['taskkill', '/F', '/IM', 'cloudflared.exe'], capture_output=True)
        time.sleep(0.3)
    except Exception:
        pass
    try:
        for f in BASE_DIR.glob("tunnel_*.log"):
            try: f.unlink()
            except Exception: pass
        old_log = BASE_DIR / "tunnel.log"
        if old_log.exists():
            try: old_log.unlink()
            except Exception: pass
    except Exception:
        pass

def ensure_cloudflared():
    if not CLOUDFLARED_PATH.exists():
        print("[Tunnel] cloudflared.exe not found. Downloading from official Cloudflare...")
        try:
            import urllib.request
            url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
            urllib.request.urlretrieve(url, str(CLOUDFLARED_PATH))
            print(f"[Tunnel] Download complete: {CLOUDFLARED_PATH}")
        except Exception as e:
            print(f"[Tunnel] Failed to auto-download cloudflared: {e}")

def run_tunnel_worker():
    global PUBLIC_TUNNEL_URL, CURRENT_CONNECT_URL, cloudflared_proc
    ensure_cloudflared()
    if not CLOUDFLARED_PATH.exists():
        print("[Tunnel] cloudflared.exe not available at", CLOUDFLARED_PATH)
        return

    while True:
        cleanup_cloudflared()

        unique_id = f"{os.getpid()}_{int(time.time())}"
        log_path = BASE_DIR / f"tunnel_{unique_id}.log"

        cmd = [str(CLOUDFLARED_PATH), "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--logfile", str(log_path)]
        startupinfo = None
        if sys.platform == "win32":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0  # SW_HIDE

        acquired = False
        try:
            cloudflared_proc = subprocess.Popen(cmd, startupinfo=startupinfo)
            print(f"[Tunnel] Started cloudflared PID {cloudflared_proc.pid}, logging to {log_path.name}")

            for _ in range(60):  # up to 30s
                time.sleep(0.5)
                if cloudflared_proc.poll() is not None:
                    print(f"[Tunnel] cloudflared exited early code={cloudflared_proc.returncode}")
                    break
                if log_path.exists():
                    try:
                        content = log_path.read_text(encoding="utf-8", errors="ignore")
                        matches = re.findall(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", content)
                        if matches:
                            new_url = matches[-1]
                            print(f"[Tunnel] Acquired active tunnel URL: {new_url}")
                            PUBLIC_TUNNEL_URL = new_url
                            acquired = True
                            if gui_root and getattr(gui_root, 'current_mode', 'tunnel') == 'tunnel':
                                CURRENT_CONNECT_URL = f"{PUBLIC_TUNNEL_URL}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
                                gui_root.after(0, on_tunnel_ready)
                            break
                    except Exception:
                        pass
        except Exception as e:
            print("[Tunnel] Failed to run cloudflared:", e)

        # Watchdog loop: keep checking health of the tunnel
        while acquired and cloudflared_proc and cloudflared_proc.poll() is None:
            time.sleep(6)
            if log_path.exists():
                try:
                    tail = log_path.read_text(encoding="utf-8", errors="ignore")[-4096:]
                    if "Unauthorized: Tunnel not found" in tail or "Register tunnel error from server side" in tail:
                        print("[Tunnel] Cloudflare tunnel expired or revoked. Restarting...")
                        break
                except Exception:
                    pass

        print("[Tunnel] Cloudflare tunnel lost or process ended. Reconnecting in 3 seconds...")
        cleanup_cloudflared()
        time.sleep(3)

# -----------------------------------------------------------------------------
# Desktop Native GUI (Tkinter Modern Dark Theme)
# -----------------------------------------------------------------------------
class PhonePCApp(tk.Tk):
    def __init__(self):
        super().__init__()
        global gui_root
        gui_root = self

        self.title("PhonePC Remote - PC 원격 제어 호스트")
        self.geometry("480x760")
        self.resizable(False, False)
        self.configure(bg="#0b0f19")
        self.current_mode = "tunnel"

        # Try setting taskbar icon
        try:
            icon_img = Image.open(STATIC_DIR / "manifest.json")
        except Exception:
            pass

        self.build_ui()
        self.update_qr_image()

        # Handle window close
        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def build_ui(self):
        # Header Frame
        header = tk.Frame(self, bg="#111827", height=65)
        header.pack(fill=tk.X, side=tk.TOP)
        header.pack_propagate(False)

        title_lbl = tk.Label(header, text="🖥️ PhonePC Remote", font=("Malgun Gothic", 15, "bold"), fg="#f8fafc", bg="#111827")
        title_lbl.pack(side=tk.LEFT, padx=18, pady=12)

        self.status_badge = tk.Label(header, text="● 대기 중", font=("Malgun Gothic", 10, "bold"), fg="#facc15", bg="#1f2937", padx=10, pady=4)
        self.status_badge.pack(side=tk.RIGHT, padx=18, pady=12)

        # Main Scrollable / Content
        content = tk.Frame(self, bg="#0b0f19", padx=20, pady=15)
        content.pack(fill=tk.BOTH, expand=True)

        # TeamViewer Credentials Card
        card = tk.Frame(content, bg="#161f31", bd=1, relief=tk.SOLID, highlightbackground="#334155", highlightthickness=1)
        card.pack(fill=tk.X, pady=(0, 10))

        # ID Row
        id_frame = tk.Frame(card, bg="#161f31", padx=16, pady=10)
        id_frame.pack(fill=tk.X)
        tk.Label(id_frame, text="파트너 접속 ID (고정)", font=("Malgun Gothic", 9), fg="#94a3b8", bg="#161f31").pack(anchor=tk.W)
        id_val_box = tk.Frame(id_frame, bg="#161f31")
        id_val_box.pack(fill=tk.X, pady=2)
        self.id_lbl = tk.Label(id_val_box, text=FORMATTED_ID, font=("Consolas", 18, "bold"), fg="#38bdf8", bg="#161f31")
        self.id_lbl.pack(side=tk.LEFT)
        copy_id_btn = tk.Button(id_val_box, text="복사", font=("Malgun Gothic", 9), bg="#334155", fg="#ffffff", bd=0, padx=8, pady=2, command=self.copy_id, cursor="hand2")
        copy_id_btn.pack(side=tk.RIGHT)
        regen_id_btn = tk.Button(id_val_box, text="🔄 ID 변경", font=("Malgun Gothic", 8), bg="#1e293b", fg="#94a3b8", bd=0, padx=6, pady=2, command=self.regen_id, cursor="hand2")
        regen_id_btn.pack(side=tk.RIGHT, padx=(0, 4))

        # Divider
        tk.Frame(card, bg="#334155", height=1).pack(fill=tk.X)

        # PIN Row
        pin_frame = tk.Frame(card, bg="#161f31", padx=16, pady=10)
        pin_frame.pack(fill=tk.X)
        tk.Label(pin_frame, text="접속 비밀번호 (PIN)", font=("Malgun Gothic", 9), fg="#94a3b8", bg="#161f31").pack(anchor=tk.W)
        pin_val_box = tk.Frame(pin_frame, bg="#161f31")
        pin_val_box.pack(fill=tk.X, pady=2)
        self.pin_lbl = tk.Label(pin_val_box, text=SESSION_PIN, font=("Consolas", 18, "bold"), fg="#06b6d4", bg="#161f31")
        self.pin_lbl.pack(side=tk.LEFT)
        copy_pin_btn = tk.Button(pin_val_box, text="복사", font=("Malgun Gothic", 9), bg="#334155", fg="#ffffff", bd=0, padx=8, pady=2, command=self.copy_pin, cursor="hand2")
        copy_pin_btn.pack(side=tk.RIGHT)
        regen_pin_btn = tk.Button(pin_val_box, text="🔄 새 PIN", font=("Malgun Gothic", 8), bg="#1e293b", fg="#94a3b8", bd=0, padx=6, pady=2, command=self.regen_pin, cursor="hand2")
        regen_pin_btn.pack(side=tk.RIGHT, padx=(0, 4))

        # QR Code Display
        qr_box = tk.Frame(content, bg="#161f31", bd=1, relief=tk.SOLID, highlightbackground="#334155", highlightthickness=1, pady=10)
        qr_box.pack(fill=tk.X, pady=(0, 10))

        self.qr_label = tk.Label(qr_box, bg="#ffffff", bd=0)
        self.qr_label.pack(pady=4)

        qr_guide = tk.Label(qr_box, text="📷 스마트폰 카메라로 QR 코드를 비추면 즉시 페어링됩니다", font=("Malgun Gothic", 9, "bold"), fg="#cbd5e1", bg="#161f31")
        qr_guide.pack(pady=2)

        # Connection Mode Switcher
        mode_box = tk.Frame(content, bg="#0b0f19")
        mode_box.pack(fill=tk.X, pady=(0, 6))

        self.btn_mode_tunnel = tk.Button(
            mode_box,
            text="🌍 인터넷 (LTE/외부)",
            font=("Malgun Gothic", 9, "bold"),
            bg="#0284c7", fg="#ffffff",
            bd=0, padx=6, pady=5,
            command=self.set_mode_tunnel,
            cursor="hand2"
        )
        self.btn_mode_tunnel.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 2))

        self.btn_tunnel_refresh = tk.Button(
            mode_box,
            text="🔄 갱신",
            font=("Malgun Gothic", 8, "bold"),
            bg="#0369a1", fg="#ffffff",
            bd=0, padx=5, pady=5,
            command=self.refresh_tunnel,
            cursor="hand2"
        )
        self.btn_tunnel_refresh.pack(side=tk.LEFT, padx=(0, 3))

        self.btn_mode_wifi = tk.Button(
            mode_box,
            text="📶 Wi-Fi 로컬",
            font=("Malgun Gothic", 9),
            bg="#1e293b", fg="#94a3b8",
            bd=0, padx=6, pady=5,
            command=self.set_mode_wifi,
            cursor="hand2"
        )
        self.btn_mode_wifi.pack(side=tk.RIGHT, expand=True, fill=tk.X, padx=(3, 0))

        # Connection Mode Banner
        self.conn_type_box = tk.Frame(content, bg="#1e293b", padx=12, pady=7)
        self.conn_type_box.pack(fill=tk.X, pady=(0, 4))

        self.conn_type_lbl = tk.Label(
            self.conn_type_box,
            text="🌍 인터넷 터널 생성 중 (공유기 무관/LTE 지원)...",
            font=("Malgun Gothic", 9),
            fg="#94a3b8",
            bg="#1e293b",
            anchor="w",
            wraplength=420
        )
        self.conn_type_lbl.pack(fill=tk.X)

        # LAN Direct IP info banner
        self.lan_info_lbl = tk.Label(
            content,
            text=f"💡 동일 Wi-Fi 접속 주소: http://{LOCAL_IP}:{PORT}",
            font=("Malgun Gothic", 8),
            fg="#64748b",
            bg="#0b0f19"
        )
        self.lan_info_lbl.pack(anchor="w", pady=(0, 6))

        # Bottom Buttons
        btn_box = tk.Frame(content, bg="#0b0f19")
        btn_box.pack(fill=tk.X, side=tk.BOTTOM, pady=4)

        new_pin_btn = tk.Button(btn_box, text="🔄 새 비밀번호", font=("Malgun Gothic", 9), bg="#1e293b", fg="#e2e8f0", bd=0, padx=8, pady=7, command=self.regen_pin, cursor="hand2")
        new_pin_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 4))

        self.update_btn = tk.Button(btn_box, text=f"⚡ 버전 v{APP_VERSION} 확인", font=("Malgun Gothic", 9, "bold"), bg="#0284c7", fg="#ffffff", bd=0, padx=8, pady=7, command=self.check_update, cursor="hand2")
        self.update_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)

        exit_btn = tk.Button(btn_box, text="❌ 종료", font=("Malgun Gothic", 9), bg="#ef4444", fg="#ffffff", bd=0, padx=8, pady=7, command=self.on_close, cursor="hand2")
        exit_btn.pack(side=tk.RIGHT, expand=True, fill=tk.X, padx=(4, 0))

        # Background update check state
        self.latest_release_info = None
        self.is_downloading_update = False
        threading.Thread(target=self._background_check_update, daemon=True).start()

    def set_mode_tunnel(self):
        global CURRENT_CONNECT_URL
        self.current_mode = "tunnel"
        self.btn_mode_tunnel.configure(bg="#0284c7", fg="#ffffff", font=("Malgun Gothic", 9, "bold"))
        self.btn_mode_wifi.configure(bg="#1e293b", fg="#94a3b8", font=("Malgun Gothic", 9))
        if PUBLIC_TUNNEL_URL:
            CURRENT_CONNECT_URL = f"{PUBLIC_TUNNEL_URL}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
            self.conn_type_lbl.configure(
                text=f"🌍 인터넷 터널 활성화 (LTE/외부 어디서나):\n{PUBLIC_TUNNEL_URL}",
                fg="#38bdf8"
            )
        else:
            CURRENT_CONNECT_URL = f"http://{LOCAL_IP}:{PORT}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
            self.conn_type_lbl.configure(
                text="🌍 인터넷 터널 생성 중 (잠시만 기다려주세요)...",
                fg="#facc15"
            )
        self.update_qr_image()

    def refresh_tunnel(self):
        self.set_mode_tunnel()
        self.conn_type_lbl.configure(
            text="🌍 인터넷 터널 새 주소 발급 중 (잠시만 기다려주세요)...",
            fg="#facc15"
        )
        cleanup_cloudflared()

    def set_mode_wifi(self):
        global CURRENT_CONNECT_URL
        self.current_mode = "wifi"
        self.btn_mode_wifi.configure(bg="#10b981", fg="#ffffff", font=("Malgun Gothic", 9, "bold"))
        self.btn_mode_tunnel.configure(bg="#1e293b", fg="#94a3b8", font=("Malgun Gothic", 9))
        CURRENT_CONNECT_URL = f"http://{LOCAL_IP}:{PORT}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
        self.conn_type_lbl.configure(
            text=f"📶 동일 Wi-Fi 로컬 연결 (공유기 내 초고속):\nhttp://{LOCAL_IP}:{PORT}",
            fg="#34d399"
        )
        self.update_qr_image()

    def update_qr_image(self):
        qr = qrcode.QRCode(box_size=6, border=1)
        qr.add_data(CURRENT_CONNECT_URL)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#000000", back_color="#ffffff")
        img = img.resize((190, 190), Image.Resampling.LANCZOS)
        self.tk_qr_img = ImageTk.PhotoImage(img)
        self.qr_label.configure(image=self.tk_qr_img)

    def copy_id(self):
        self.clipboard_clear()
        self.clipboard_append(SESSION_ID_RAW)
        messagebox.showinfo("복사 완료", f"파트너 ID [{SESSION_ID_RAW}] 가 클립보드에 복사되었습니다.")

    def copy_pin(self):
        self.clipboard_clear()
        self.clipboard_append(SESSION_PIN)
        messagebox.showinfo("복사 완료", f"비밀번호 [{SESSION_PIN}] 가 클립보드에 복사되었습니다.")

    def regen_id(self):
        global SESSION_ID_RAW, FORMATTED_ID, CURRENT_CONNECT_URL
        if messagebox.askyesno("파트너 ID 변경", "파트너 접속 ID를 새로 생성하시겠습니까?\n\n(참고: ID를 변경해도 이미 '저장된 컴퓨터'로 등록된 스마트폰은 즉시 연결이 유지됩니다.)"):
            SESSION_ID_RAW = str(random.randint(100000000, 999999999))
            FORMATTED_ID = f"{SESSION_ID_RAW[0:3]} {SESSION_ID_RAW[3:6]} {SESSION_ID_RAW[6:9]}"
            _cfg = load_or_create_host_config()
            _cfg["partner_id"] = SESSION_ID_RAW
            save_host_config(_cfg)
            self.id_lbl.configure(text=FORMATTED_ID)
            if getattr(self, 'current_mode', 'tunnel') == 'wifi' or not PUBLIC_TUNNEL_URL:
                CURRENT_CONNECT_URL = f"http://{LOCAL_IP}:{PORT}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
            else:
                CURRENT_CONNECT_URL = f"{PUBLIC_TUNNEL_URL}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
            self.update_qr_image()
            messagebox.showinfo("ID 변경 완료", f"새 파트너 ID [{FORMATTED_ID}] 가 설정되었습니다.")

    def regen_pin(self):
        global SESSION_PIN, CURRENT_CONNECT_URL
        SESSION_PIN = str(random.randint(1000, 9999))
        _cfg = load_or_create_host_config()
        _cfg["pin"] = SESSION_PIN
        save_host_config(_cfg)
        self.pin_lbl.configure(text=SESSION_PIN)
        if getattr(self, 'current_mode', 'tunnel') == 'wifi' or not PUBLIC_TUNNEL_URL:
            CURRENT_CONNECT_URL = f"http://{LOCAL_IP}:{PORT}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
        else:
            CURRENT_CONNECT_URL = f"{PUBLIC_TUNNEL_URL}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"
        self.update_qr_image()
        messagebox.showinfo("비밀번호 갱신", f"새 비밀번호 [{SESSION_PIN}] 가 설정되었습니다.\n(참고: '저장된 컴퓨터'로 등록된 스마트폰은 비밀번호 변경과 무관하게 즉시 연결됩니다.)")

    def _background_check_update(self):
        time.sleep(3)
        try:
            req = urllib.request.Request(
                "https://api.github.com/repos/TM-TOMATO/PhonePC-Remote/releases/latest",
                headers={"User-Agent": "PhonePC-Remote-PC"}
            )
            with urllib.request.urlopen(req, timeout=8) as res:
                data = json.loads(res.read().decode("utf-8"))
                remote_tag = data.get("tag_name", "").lstrip("v")
                assets = data.get("assets", [])
                setup_url = ""
                for a in assets:
                    if a.get("name", "").endswith("_Setup.exe"):
                        setup_url = a.get("browser_download_url")
                        break
                if not setup_url:
                    for a in assets:
                        if a.get("name", "").endswith(".exe"):
                            setup_url = a.get("browser_download_url")
                            break
                if remote_tag and self._is_newer_version(remote_tag, APP_VERSION):
                    self.latest_release_info = (remote_tag, setup_url, data.get("body", ""))
                    self.after(0, self._on_update_detected)
        except Exception as e:
            print(f"[Update] Background update check: {e}")

    def _is_newer_version(self, remote_ver, local_ver):
        try:
            r_parts = [int(x) for x in re.findall(r'\d+', remote_ver)]
            l_parts = [int(x) for x in re.findall(r'\d+', local_ver)]
            for r, l in zip(r_parts, l_parts):
                if r > l:
                    return True
                if r < l:
                    return False
            return len(r_parts) > len(l_parts)
        except Exception:
            return False

    def _on_update_detected(self):
        if not self.latest_release_info:
            return
        tag, setup_url, _ = self.latest_release_info
        if hasattr(self, 'update_btn'):
            self.update_btn.configure(
                text=f"⚡ v{tag} 업데이트 가능!",
                bg="#e11d48",
                activebackground="#be123c"
            )

    def check_update(self):
        if self.is_downloading_update:
            messagebox.showinfo("다운로드 진행 중", "현재 최신 버전 설치 프로그램을 다운로드하고 있습니다.\n잠시만 기다려주세요.")
            return

        if self.latest_release_info:
            tag, setup_url, notes = self.latest_release_info
            note_preview = ("\n\n[주요 변경 사항]\n" + notes[:200] + "...") if notes else ""
            if messagebox.askyesno(
                "새 버전 업데이트",
                f"새로운 버전 (v{tag})이 출시되었습니다!{note_preview}\n\n"
                f"지금 바로 최신 설치 프로그램을 다운로드하여\n"
                f"자동으로 업데이트를 진행하시겠습니까?"
            ):
                self.start_auto_update_download(setup_url, tag)
            return

        # Direct check
        self.update_btn.configure(text="⏳ 확인 중...")
        def _check_direct():
            try:
                req = urllib.request.Request(
                    "https://api.github.com/repos/TM-TOMATO/PhonePC-Remote/releases/latest",
                    headers={"User-Agent": "PhonePC-Remote-PC"}
                )
                with urllib.request.urlopen(req, timeout=6) as res:
                    data = json.loads(res.read().decode("utf-8"))
                    remote_tag = data.get("tag_name", "").lstrip("v")
                    assets = data.get("assets", [])
                    setup_url = ""
                    for a in assets:
                        if a.get("name", "").endswith("_Setup.exe"):
                            setup_url = a.get("browser_download_url")
                            break
                    if not setup_url:
                        for a in assets:
                            if a.get("name", "").endswith(".exe"):
                                setup_url = a.get("browser_download_url")
                                break
                    if remote_tag and self._is_newer_version(remote_tag, APP_VERSION):
                        self.latest_release_info = (remote_tag, setup_url, data.get("body", ""))
                        self.after(0, self.check_update)
                    else:
                        def _show_latest():
                            self.update_btn.configure(text=f"⚡ 버전 v{APP_VERSION} 확인", bg="#0284c7")
                            messagebox.showinfo(
                                "최신 버전",
                                f"PhonePC Remote v{APP_VERSION}\n\n"
                                f"현재 최신 버전이 실행 중입니다.\n새로운 업데이트가 없습니다."
                            )
                        self.after(0, _show_latest)
            except Exception as e:
                def _show_err():
                    self.update_btn.configure(text=f"⚡ 버전 v{APP_VERSION} 확인", bg="#0284c7")
                    messagebox.showinfo("업데이트 확인", f"현재 버전: v{APP_VERSION}\n\n(업데이트 서버 연결 확인 실패: {e})")
                self.after(0, _show_err)

        threading.Thread(target=_check_direct, daemon=True).start()

    def start_auto_update_download(self, setup_url, tag):
        if not setup_url:
            setup_url = f"https://github.com/TM-TOMATO/PhonePC-Remote/releases/download/v{tag}/PhonePC_Remote_v{tag}_Setup.exe"

        self.is_downloading_update = True
        self.update_btn.configure(text="📥 다운로드 중...", bg="#d97706")

        def _do_download():
            try:
                temp_dir = Path(tempfile.gettempdir())
                installer_path = temp_dir / f"PhonePC_Remote_v{tag}_Setup.exe"

                req = urllib.request.Request(setup_url, headers={"User-Agent": "PhonePC-Remote-PC"})
                with urllib.request.urlopen(req, timeout=60) as res:
                    total_size = int(res.headers.get("Content-Length", 0))
                    downloaded = 0
                    block_size = 1024 * 64

                    with open(installer_path, "wb") as f:
                        while True:
                            chunk = res.read(block_size)
                            if not chunk:
                                break
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total_size > 0:
                                percent = int(downloaded * 100 / total_size)
                                self.after(0, lambda p=percent: self.update_btn.configure(text=f"📥 다운로드 중 ({p}%)..."))

                def _launch_installer():
                    messagebox.showinfo("다운로드 완료", "최신 버전 다운로드가 완료되었습니다.\n업데이트 설치 프로그램을 실행합니다.")
                    try:
                        subprocess.Popen([str(installer_path)])
                    except Exception as ex:
                        print(f"Failed to launch installer: {ex}")
                    self.after(600, self.destroy)

                self.after(0, _launch_installer)
            except Exception as e:
                def _fail():
                    self.is_downloading_update = False
                    self.update_btn.configure(text=f"⚡ v{tag} 업데이트 가능!", bg="#e11d48")
                    messagebox.showerror("업데이트 다운로드 실패", f"설치 프로그램 다운로드 중 오류가 발생했습니다:\n{e}\n\n웹 브라우저에서 직접 다운로드해 주세요.")
                self.after(0, _fail)

        threading.Thread(target=_do_download, daemon=True).start()
    def show_device_confirm_popup(self, device_name, future, loop):
        try:
            self.deiconify()
            self.lift()
            self.attributes('-topmost', True)
            self.focus_force()
            self.bell()
        except Exception:
            pass

        dialog = tk.Toplevel(self)
        dialog.title("PhonePC Remote - 본인 확인")
        dialog.geometry("460x290")
        dialog.resizable(False, False)
        dialog.configure(bg="#0b0f19")
        dialog.attributes('-topmost', True)

        dialog.update_idletasks()
        try:
            x = (dialog.winfo_screenwidth() - 460) // 2
            y = (dialog.winfo_screenheight() - 290) // 2
            dialog.geometry(f"+{x}+{y}")
        except Exception:
            pass

        hdr = tk.Frame(dialog, bg="#111827", padx=18, pady=12)
        hdr.pack(fill=tk.X)
        tk.Label(hdr, text="📱 본인 확인 (컴퓨터 저장 승인)", font=("Malgun Gothic", 12, "bold"), fg="#38bdf8", bg="#111827").pack(anchor="w")

        body = tk.Frame(dialog, bg="#0b0f19", padx=20, pady=16)
        body.pack(fill=tk.BOTH, expand=True)

        msg1 = f"스마트폰 [{device_name}]에서\n이 PC를 '저장된 컴퓨터'로 등록 요청했습니다."
        tk.Label(body, text=msg1, font=("Malgun Gothic", 11, "bold"), fg="#ffffff", bg="#0b0f19", justify="left").pack(anchor="w", pady=(0, 10))

        msg2 = (
            "승인하시면 다음 접속부터 비밀번호(PIN)나 QR 코드 없이\n"
            "원클릭으로 즉시 연결하여 원격 제어할 수 있습니다.\n\n"
            "본인이 직접 요청하신 것이 맞습니까?"
        )
        tk.Label(body, text=msg2, font=("Malgun Gothic", 9), fg="#94a3b8", bg="#0b0f19", justify="left").pack(anchor="w")

        resolved = [False]
        def on_confirm(choice):
            if not resolved[0]:
                resolved[0] = True
                try:
                    dialog.grab_release()
                except Exception:
                    pass
                try:
                    dialog.destroy()
                except Exception:
                    pass
                try:
                    self.attributes('-topmost', False)
                except Exception:
                    pass
                loop.call_soon_threadsafe(future.set_result, choice)

        dialog.protocol("WM_DELETE_WINDOW", lambda: on_confirm(False))
        dialog.after(60000, lambda: on_confirm(False))

        btn_box = tk.Frame(dialog, bg="#111827", padx=16, pady=12)
        btn_box.pack(fill=tk.X, side=tk.BOTTOM)

        yes_btn = tk.Button(
            btn_box, text="✔ 예 (등록 승인)", font=("Malgun Gothic", 10, "bold"),
            bg="#0284c7", fg="#ffffff", activebackground="#0369a1", activeforeground="#ffffff",
            bd=0, padx=16, pady=8, cursor="hand2", command=lambda: on_confirm(True)
        )
        yes_btn.pack(side=tk.RIGHT, padx=(8, 0))

        no_btn = tk.Button(
            btn_box, text="✖ 아니오 (거부)", font=("Malgun Gothic", 10),
            bg="#334155", fg="#e2e8f0", activebackground="#475569", activeforeground="#ffffff",
            bd=0, padx=14, pady=8, cursor="hand2", command=lambda: on_confirm(False)
        )
        no_btn.pack(side=tk.RIGHT)

        try:
            dialog.transient(self)
            dialog.grab_set()
            dialog.attributes('-topmost', True)
            dialog.lift()
            dialog.focus_force()
        except Exception:
            pass

    def on_close(self):
        try:
            streamer.stop()
        except Exception:
            pass
        cleanup_cloudflared()
        self.destroy()
        sys.exit(0)

def on_tunnel_ready():
    if gui_root:
        if getattr(gui_root, 'current_mode', 'tunnel') == 'tunnel':
            gui_root.set_mode_tunnel()

def update_gui_status(connected, client_ip=""):
    if gui_root:
        def update():
            if connected:
                gui_root.status_badge.configure(text="● 스마트폰 연결됨", fg="#10b981", bg="#064e3b")
            else:
                gui_root.status_badge.configure(text="● 대기 중", fg="#facc15", bg="#1f2937")
        gui_root.after(0, update)

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    # Start web server thread
    server_thread = threading.Thread(target=run_server_loop, daemon=True)
    server_thread.start()

    # Start Cloudflare tunnel thread
    tunnel_thread = threading.Thread(target=run_tunnel_worker, daemon=True)
    tunnel_thread.start()

    # Run native desktop GUI
    app = PhonePCApp()
    app.mainloop()
