"""
PhonePC Remote - Standalone Confirmation Dialog
Displays a modern, top-most confirmation window for saving trusted devices.
Exits with code 0 on [예(승인)], code 1 on [아니오(거부)] or timeout.
"""

import sys
import tkinter as tk

def main():
    device_name = sys.argv[1] if len(sys.argv) > 1 else "스마트폰"

    root = tk.Tk()
    root.title("PhonePC Remote - 본인 확인")
    root.geometry("460x290")
    root.resizable(False, False)
    root.configure(bg="#0b0f19")
    root.attributes("-topmost", True)

    root.update_idletasks()
    try:
        x = (root.winfo_screenwidth() - 460) // 2
        y = (root.winfo_screenheight() - 290) // 2
        root.geometry(f"+{x}+{y}")
    except Exception:
        pass

    try:
        root.bell()
    except Exception:
        pass

    # Header
    hdr = tk.Frame(root, bg="#111827", padx=18, pady=12)
    hdr.pack(fill=tk.X)
    tk.Label(hdr, text="📱 본인 확인 (컴퓨터 저장 승인)", font=("Malgun Gothic", 12, "bold"), fg="#38bdf8", bg="#111827").pack(anchor="w")

    # Body
    body = tk.Frame(root, bg="#0b0f19", padx=20, pady=16)
    body.pack(fill=tk.BOTH, expand=True)

    msg1 = f"스마트폰 [{device_name}]에서\n이 PC를 '저장된 컴퓨터'로 등록 요청했습니다."
    tk.Label(body, text=msg1, font=("Malgun Gothic", 11, "bold"), fg="#ffffff", bg="#0b0f19", justify="left").pack(anchor="w", pady=(0, 10))

    msg2 = (
        "승인하시면 다음 접속부터 비밀번호(PIN)나 QR 코드 없이\n"
        "원클릭으로 즉시 연결하여 원격 제어할 수 있습니다.\n\n"
        "본인이 직접 요청하신 것이 맞습니까?"
    )
    tk.Label(body, text=msg2, font=("Malgun Gothic", 9), fg="#94a3b8", bg="#0b0f19", justify="left").pack(anchor="w")

    # Buttons
    btn_box = tk.Frame(root, bg="#111827", padx=16, pady=12)
    btn_box.pack(fill=tk.X, side=tk.BOTTOM)

    def on_yes():
        root.destroy()
        sys.exit(0)

    def on_no():
        root.destroy()
        sys.exit(1)

    yes_btn = tk.Button(
        btn_box, text="✔ 예 (등록 승인)", font=("Malgun Gothic", 10, "bold"),
        bg="#0284c7", fg="#ffffff", activebackground="#0369a1", activeforeground="#ffffff",
        bd=0, padx=16, pady=8, cursor="hand2", command=on_yes
    )
    yes_btn.pack(side=tk.RIGHT, padx=(8, 0))

    no_btn = tk.Button(
        btn_box, text="✖ 아니오 (거부)", font=("Malgun Gothic", 10),
        bg="#334155", fg="#e2e8f0", activebackground="#475569", activeforeground="#ffffff",
        bd=0, padx=14, pady=8, cursor="hand2", command=on_no
    )
    no_btn.pack(side=tk.RIGHT)

    root.protocol("WM_DELETE_WINDOW", on_no)
    # Auto-reject after 60 seconds
    root.after(60000, on_no)

    root.lift()
    root.focus_force()
    root.mainloop()

if __name__ == "__main__":
    main()
