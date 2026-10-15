"""
PhonePC Remote - PC Host Application (Python)
TeamViewer-style remote control host written in pure Python.

Usage:
    python main.py          (Runs modern Tkinter GUI host - Default)
    python main.py --cli    (Runs headless / terminal dashboard server)
"""

import sys
import threading

def main():
    if "--cli" in sys.argv or "--headless" in sys.argv:
        import server
        server.main()
    else:
        import gui_app
        # Start web & screen/audio streamer server in background thread
        server_thread = threading.Thread(target=gui_app.run_server_loop, daemon=True)
        server_thread.start()

        # Start Cloudflare tunnel worker in background thread
        tunnel_thread = threading.Thread(target=gui_app.run_tunnel_worker, daemon=True)
        tunnel_thread.start()

        # Run native modern dark-theme GUI
        app = gui_app.PhonePCApp()
        app.mainloop()

if __name__ == "__main__":
    main()
