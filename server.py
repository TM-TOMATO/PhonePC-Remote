import asyncio
import io
import json
import os
import random
import socket
import subprocess
import sys
import time as _time
import webbrowser
from pathlib import Path
from aiohttp import web
import qrcode
from input_controller import InputController

# Ensure UTF-8 output for Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import uuid
import ctypes

STATIC_DIR = Path(__file__).parent / "web"
controller = InputController()

from screen_streamer import ScreenStreamer
from audio_streamer import AudioStreamer
streamer = ScreenStreamer(preset="high")
audio_streamer = AudioStreamer()

# -----------------------------------------------------------------------------
# Trusted Device (Passwordless Unattended Access) System
# -----------------------------------------------------------------------------
TRUSTED_DEVICES_FILE = Path(__file__).parent / "trusted_devices.json"

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
        "created_at": int(_time.time()),
        "created_date": _time.strftime("%Y-%m-%d %H:%M:%S")
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
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _show_native_confirm_box, device_name)

HOST_CONFIG_FILE = Path(__file__).parent / "host_config.json"

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
        try:
            with open(HOST_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving host config: {e}")

    return config

# Persistent Credentials (TeamViewer style)
_host_cfg = load_or_create_host_config()
SESSION_ID_RAW = _host_cfg["partner_id"]
FORMATTED_ID = f"{SESSION_ID_RAW[0:3]} {SESSION_ID_RAW[3:6]} {SESSION_ID_RAW[6:9]}"
SESSION_PIN = _host_cfg["pin"]

# Active WebSocket connections
host_websockets = set()
authenticated_clients = set()

def get_local_ip():
    """Detect local LAN IP address"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip

async def notify_host_status(is_connected, client_addr=""):
    """Notify PC host dashboard about client connection state"""
    msg = {
        "type": "client_status",
        "payload": {
            "connected": is_connected,
            "client": client_addr
        }
    }
    for ws in list(host_websockets):
        try:
            await ws.send_json(msg)
        except Exception:
            host_websockets.discard(ws)

PUBLIC_TUNNEL_URL = ""

def get_effective_url(local_ip, port):
    base = PUBLIC_TUNNEL_URL if PUBLIC_TUNNEL_URL else f"http://{local_ip}:{port}"
    return f"{base}/?id={SESSION_ID_RAW}&pin={SESSION_PIN}"

APP_VERSION = "2.2.0"
BUILD_TIME = int(_time.time())

async def handle_index(request):
    index_file = STATIC_DIR / "index.html"
    return web.FileResponse(
        index_file,
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

async def handle_host(request):
    host_file = STATIC_DIR / "host.html"
    return web.FileResponse(host_file)

async def handle_download_apk(request):
    apk_file = STATIC_DIR / "PhonePC_Remote_v2.2.0.apk"
    if not apk_file.exists():
        apk_file = Path(__file__).parent / "PhonePC_Remote_v2.2.0.apk"
    if apk_file.exists():
        return web.FileResponse(apk_file, headers={
            'Content-Disposition': 'attachment; filename="PhonePC_Remote_v2.2.0.apk"',
            'Content-Type': 'application/vnd.android.package-archive'
        })
    return web.Response(text="APK not found", status=404)

async def handle_download_setup(request):
    setup_file = STATIC_DIR / "PhonePC_Remote_v2.2.0_Setup.exe"
    if not setup_file.exists():
        setup_file = Path(__file__).parent / "PhonePC_Remote_v2.2.0_Setup.exe"
    if setup_file.exists():
        return web.FileResponse(setup_file, headers={
            'Content-Disposition': 'attachment; filename="PhonePC_Remote_v2.2.0_Setup.exe"',
            'Content-Type': 'application/octet-stream'
        })
    return web.Response(text="Setup installer not found", status=404)

async def handle_download_pc(request):
    pc_file = STATIC_DIR / "PhonePC_Remote.exe"
    if not pc_file.exists():
        pc_file = Path(__file__).parent / "PhonePC_Remote.exe"
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
                await response.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
            await asyncio.sleep(0.033)
    except Exception:
        pass
    return response

async def handle_session_info(request):
    port = request.app['port']
    local_ip = request.app['local_ip']
    connect_url = get_effective_url(local_ip, port)
    return web.json_response({
        "id": SESSION_ID_RAW,
        "formatted_id": FORMATTED_ID,
        "pin": SESSION_PIN,
        "ip": local_ip,
        "port": port,
        "url": connect_url,
        "is_tunnel": bool(PUBLIC_TUNNEL_URL)
    })

async def handle_qr_image(request):
    """Serve QR code PNG embedding ID and PIN for 1-touch pairing"""
    port = request.app['port']
    local_ip = request.app['local_ip']
    connect_url = get_effective_url(local_ip, port)
    
    img = qrcode.make(connect_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return web.Response(body=buf.read(), content_type="image/png")

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    role = request.query.get("role", "client")
    client_ip = request.remote

    if role == "host":
        host_websockets.add(ws)
        # Send current client status to host immediately
        await ws.send_json({
            "type": "client_status",
            "payload": {
                "connected": len(authenticated_clients) > 0,
                "client": next(iter(authenticated_clients), "")
            }
        })
        try:
            async for _ in ws:
                pass
        finally:
            host_websockets.discard(ws)
        return ws

    # Mobile Client Handling
    is_authenticated = False
    print(f"[+] 모바일 기기 접속 시도: {client_ip}")

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    msg_type = data.get("type")
                    payload = data.get("payload", {})

                    # 1. Authentication Handshake
                    if msg_type == "auth":
                        req_id = str(payload.get("id", "")).replace(" ", "").strip()
                        req_pin = str(payload.get("pin", "")).strip()

                        if req_id == SESSION_ID_RAW and req_pin == SESSION_PIN:
                            is_authenticated = True
                            authenticated_clients.add(client_ip)
                            print(f"[★] 인증 성공! 원격 제어 시작: {client_ip}")
                            await ws.send_json({
                                "type": "auth_success",
                                "payload": { "message": "인증 성공! 원격 제어가 활성화되었습니다." }
                            })
                            await notify_host_status(True, client_ip)
                        else:
                            print(f"[!] 인증 실패 (ID/PIN 불일치): {client_ip}")
                            await ws.send_json({
                                "type": "auth_fail",
                                "payload": { "message": "접속 ID 또는 비밀번호가 올바르지 않습니다." }
                            })
                        continue

                    elif msg_type == "auth_token":
                        req_token = str(payload.get("token", "")).strip()

                        if verify_trusted_token(req_token):
                            is_authenticated = True
                            authenticated_clients.add(client_ip)
                            print(f"[★] 저장된 기기 토큰 인증 성공! (비번/QR 생략 즉시 연결): {client_ip}")
                            await ws.send_json({
                                "type": "auth_success",
                                "payload": {
                                    "message": "저장된 컴퓨터 인증 성공!",
                                    "pc_id": SESSION_ID_RAW,
                                    "pc_name": socket.gethostname()
                                }
                            })
                            await notify_host_status(True, client_ip)
                        else:
                            print(f"[!] 저장된 기기 토큰 인증 실패: {client_ip}")
                            await ws.send_json({
                                "type": "auth_fail",
                                "payload": { "message": "저장된 컴퓨터 인증 토큰이 유효하지 않거나 등록이 해제되었습니다." }
                            })
                        continue

                    # Reject any control command if not authenticated
                    if not is_authenticated:
                        await ws.send_json({
                            "type": "auth_required",
                            "payload": { "message": "인증이 필요합니다." }
                        })
                        continue

                    # Request to save PC / Trusted Device
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

                    # 2. Control Commands
                    if msg_type == "mouse_move":
                        dx = float(payload.get("dx", 0))
                        dy = float(payload.get("dy", 0))
                        controller.mouse_move(dx, dy)

                    elif msg_type == "mouse_click":
                        button = payload.get("button", "left")
                        action = payload.get("action", "click")
                        controller.mouse_click(button, action)

                    elif msg_type == "mouse_scroll":
                        amount = float(payload.get("amount", 0))
                        controller.mouse_scroll(amount)

                    elif msg_type == "key_press":
                        key = payload.get("key", "")
                        modifiers = payload.get("modifiers", [])
                        controller.key_press(key, modifiers)

                    elif msg_type == "key_down":
                        controller.key_down(payload.get("key", ""))

                    elif msg_type == "key_up":
                        controller.key_up(payload.get("key", ""))

                    elif msg_type == "release_all_keys":
                        controller.release_all_keys()

                    elif msg_type == "text_input":
                        text = payload.get("text", "")
                        controller.text_input(text)

                    elif msg_type == "audio_enable":
                        if payload.get("enabled", True):
                            audio_streamer.add_subscriber(ws)
                        else:
                            audio_streamer.remove_subscriber(ws)

                    elif msg_type == "screen_quality":
                        preset = payload.get("preset", "high")
                        streamer.set_preset(preset)

                    elif msg_type == "ping":
                        await ws.send_json({"type": "pong", "time": payload.get("time")})

                except Exception:
                    pass
    finally:
        authenticated_clients.discard(client_ip)
        audio_streamer.remove_subscriber(ws)
        controller.release_all_keys()
        print(f"[-] 모바일 기기 연결 종료: {client_ip}")
        await notify_host_status(len(authenticated_clients) > 0)

    return ws

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def free_port(port):
    """Kill any process occupying the given port (Windows only)"""
    if sys.platform != 'win32':
        return
    try:
        result = subprocess.run(
            ['netstat', '-ano', '-p', 'TCP'],
            capture_output=True, text=True, encoding='utf-8', errors='ignore'
        )
        for line in result.stdout.splitlines():
            if f':{port}' in line and 'LISTENING' in line:
                pid = line.strip().split()[-1]
                subprocess.run(['taskkill', '/F', '/PID', pid], capture_output=True)
        _time.sleep(0.8)
    except Exception:
        pass

def start_tunnel(port):
    global PUBLIC_TUNNEL_URL
    try:
        print("[*] 외부 인터넷 연결용 터널(localtunnel)을 시작합니다...")
        proc = subprocess.Popen(
            ["npx", "localtunnel", "--port", str(port)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            shell=True
        )
        for line in iter(proc.stdout.readline, ""):
            if "your url is:" in line:
                url = line.split("your url is:")[-1].strip()
                PUBLIC_TUNNEL_URL = url
                print(f"\n[★] 외부 인터넷 접속 주소 생성 완료: {url}")
                print(f"[★] 다른 공유기 / LTE / 5G에서도 즉시 연결 가능합니다!\n")
                break
    except Exception as e:
        print(f"[!] 터널 시작 실패: {e}")

def print_banner(local_ip, port):
    connect_url = get_effective_url(local_ip, port)
    host_url = f"http://localhost:{port}/host"

    print("=" * 62)
    print(" 🚀 PhonePC Remote - 팀뷰어 스타일 PC 원격 제어 서버")
    print("=" * 62)
    print(f" 🖥️  내 파트너 ID   :  {FORMATTED_ID}")
    print(f" 🔑  비밀번호 (PIN) :  {SESSION_PIN}")
    print("-" * 62)
    print(f" 🌐  PC 제어 화면   :  {host_url}")
    print(f" 📱  모바일 로컬    :  http://{local_ip}:{port}")
    if PUBLIC_TUNNEL_URL:
        print(f" 🌍  인터넷 터널    :  {PUBLIC_TUNNEL_URL}")
    print("=" * 62)
    print(" 📷 스마트폰 카메라로 아래 QR 코드를 스캔하면 즉시 연결됩니다:\n")
    try:
        qr = qrcode.QRCode(border=2)
        qr.add_data(connect_url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except Exception:
        pass
    print("\n" + "=" * 62)
    print(" 💡 PC 브라우저에 팀뷰어 안내 화면(대시보드)이 열립니다.")
    print(" ⌨️  종료하려면 Ctrl+C를 누르세요.")
    print("=" * 62 + "\n")

async def init_app(port=8080):
    local_ip = get_local_ip()
    app = web.Application()
    app['port'] = port
    app['local_ip'] = local_ip

    app.router.add_get("/", handle_index)
    app.router.add_get("/host", handle_host)
    app.router.add_get("/download/apk", handle_download_apk)
    app.router.add_get("/download/setup", handle_download_setup)
    app.router.add_get("/download/pc", handle_download_pc)
    app.router.add_get("/screen_stream", handle_screen_stream)
    app.router.add_get("/api/session-info", handle_session_info)
    app.router.add_get("/api/version", handle_version)
    app.router.add_get("/qr.png", handle_qr_image)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_static("/", path=STATIC_DIR, name="static")

    return app, local_ip, port

def open_host_browser(port):
    _time.sleep(1.2)
    try:
        webbrowser.open(f"http://localhost:{port}/host")
    except Exception:
        pass

def main():
    port = 8080
    use_tunnel = "--tunnel" in sys.argv

    if is_port_in_use(port):
        print(f"[!] 포트 {port} 사용 중 감지. 기존 프로세스를 정리합니다...")
        free_port(port)
        if is_port_in_use(port):
            print(f"[!] 포트 {port} 해제 실패. 수동 확인이 필요합니다.")
            return

    import threading
    if use_tunnel:
        t = threading.Thread(target=start_tunnel, args=(port,), daemon=True)
        t.start()
        _time.sleep(2.5)  # Allow tunnel to obtain URL

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    app, local_ip, port = loop.run_until_complete(init_app(port))
    
    # Start screen and audio capture loops
    streamer.start()
    audio_streamer.start()

    print_banner(local_ip, port)
    
    # Auto-open host dashboard on PC
    threading.Thread(target=open_host_browser, args=(port,), daemon=True).start()

    web.run_app(app, host="0.0.0.0", port=port, print=None)

if __name__ == "__main__":
    main()
