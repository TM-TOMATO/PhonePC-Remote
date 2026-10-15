# 📱 PhonePC Remote (실시간 화면 & 소리 공유 원격 제어 앱)

> **팀뷰어(TeamViewer) / 애니데스크(AnyDesk) 스타일의 초경량 파이썬 기반 PC 원격 제어 솔루션**  
> 컴퓨터 화면과 사운드가 스마트폰에 실시간으로 전송되며, 터치패드와 가상 키보드로 컴퓨터의 모든 작업을 완벽하게 원격 제어할 수 있습니다.

---

## 🌟 핵심 특징

1. **내 컴퓨터에서 로컬로 직접 동작하는 파이썬 서버**
   - 무거운 외부 클라우드 중계기 없이, 컴퓨터 주인(Host)의 PC에서 순수 파이썬으로 가볍고 빠르게 동작합니다.
   - `실행.bat` 더블클릭 한 번으로 0.2초 만에 구동됩니다.
2. **웹 접속 시 스마트 앱 설치 안내**
   - 모바일 브라우저로 접속 시 전용 앱 설치 안내 창이 팝업됩니다.
   - **[📲 전용 앱 설치]** 선택 시 안드로이드 APK 파일이 즉시 다운로드되어 설치를 돕습니다.
   - **[🌐 웹으로 계속하기]** 선택 시 별도 설치 없이 모바일 웹 화면에서 바로 원격 제어가 시작됩니다.
3. **동일 Wi-Fi 로컬(초고속) & 인터넷 터널(어디서나) 듀얼 모드**
   - **📶 로컬 Wi-Fi 모드**: 같은 공유기 환경에서 0ms 수준의 초저지연 직접 스트리밍
   - **🌍 인터넷 터널 모드**: Cloudflare 보안 터널을 통해 공유기 포트포워딩 없이 외부/LTE 망 어디서나 원클릭 연결
4. **실시간 PC 사운드 & 고화질 화면 공유**
   - Windows WASAPI Loopback을 통한 고음질 스테레오 사운드 동기화
   - FHD 해상도(30 FPS) 초저지연 화면 전송 및 노란색 마우스 포인터 오버레이
5. **모바일 최적화 터치 & 제어 도구**
   - **직접 터치(Direct Touch)**: 스마트폰 화면의 아이콘이나 창을 콕 찍어 바로 클릭 & 더블클릭
   - **가상 트랙패드**: 노트북 터치패드처럼 조작 (설정에서 0.4x ~ 2.5x 감도 조절)
   - **화면 핀치 줌(확대/축소)**: 두 손가락 핀치 제스처로 작은 글씨도 시원하게 확대
   - **스마트 Shift 가상 키보드**: 짧게 탭하면 토글, 길게 누르면 홀드 기능 및 25%~100% 투명도 조절
   - **360° 회전 방사형(Radial) 메뉴**: 엄지손가락으로 드래그하여 회전 가능한 플로팅 메뉴
   - **저장된 컴퓨터(원클릭 접속)**: PC에서 본인 확인 승인 한 번으로 다음부터 비밀번호/QR 없이 즉시 연결

---

## 📥 다운로드 (Download)

최신 버전(v2.2.0)을 GitHub Releases에서 다운로드하실 수 있습니다:
👉 **[GitHub Releases v2.2.0 바로가기](https://github.com/TM-TOMATO/PhonePC-Remote/releases/tag/v2.2.0)**

| 파일명 | 종류 | 설명 | 다운로드 |
|---|---|---|---|
| **`PhonePC_Remote_v2.2.0_Setup.exe`** | PC용 윈도우 설치형 | 파이썬 미설치 PC에서도 즉시 실행 가능한 독립 설치형 파일 (권장) | [다운로드](https://github.com/TM-TOMATO/PhonePC-Remote/releases/download/v2.2.0/PhonePC_Remote_v2.2.0_Setup.exe) |
| **`PhonePC_Remote_v2.2.0_Windows_Portable.zip`** | PC용 파이썬 포터블 | 압축 풀고 `실행.bat`으로 0.2초 즉시 구동되는 초경량 패키지 | [다운로드](https://github.com/TM-TOMATO/PhonePC-Remote/releases/download/v2.2.0/PhonePC_Remote_v2.2.0_Windows_Portable.zip) |
| **`PhonePC_Remote_v2.2.0.apk`** | 스마트폰용 앱 | Android 14+ 지원, 카메라 QR 스캔 탑재 초경량 앱 (119KB) | [다운로드](https://github.com/TM-TOMATO/PhonePC-Remote/releases/download/v2.2.0/PhonePC_Remote_v2.2.0.apk) |

---

## 🚀 PC 호스트 (서버) 실행 방법

### 방법 1: 윈도우 설치형 (`_Setup.exe`)
- `PhonePC_Remote_v2.2.0_Setup.exe`를 다운로드하여 실행하면 바탕화면에 바로가기가 생성되고 파이썬 설치 없이도 즉시 작동합니다.

### 방법 2: 파이썬 포터블 또는 소스코드 직접 실행
1. 압축 해제 후 **`실행.bat`**을 더블클릭합니다.
   *(필수 패키지가 없을 경우 자동으로 `pip install -r requirements.txt`가 실행된 후 호스트가 시작됩니다)*
2. 또는 터미널에서 직접 실행:
   ```bash
   pip install -r requirements.txt
   python main.py
   ```

---

## 📱 스마트폰에서 연결하는 방법

### 방법 1: 전용 안드로이드 앱으로 연결 (권장)
1. 스마트폰에 [PhonePC_Remote_v2.2.0.apk](https://github.com/TM-TOMATO/PhonePC-Remote/releases/download/v2.2.0/PhonePC_Remote_v2.2.0.apk)를 다운로드하여 설치합니다.
2. 앱 실행 후 **[📷 PC 화면의 QR 코드 스캔]**을 누르고 PC 모니터의 QR 코드를 비추면 즉시 연결됩니다!

### 방법 2: 웹 브라우저로 연결
1. 스마트폰 웹 브라우저(Chrome, Safari 등)에서 PC 화면에 표시된 주소를 입력하거나 QR 코드를 촬영합니다.
2. 접속 시 나타나는 안내 창에서:
   - **[📲 전용 앱 설치하기]**: APK 다운로드 후 앱으로 전환
   - **[🌐 웹으로 계속하기]**: 설치 없이 브라우저에서 바로 원격 제어 이용

---

## 🛠️ 기술 스택 및 구조

```
phone-connect/
├── main.py                  # 통합 메인 진입점
├── gui_app.py               # Tkinter GUI 호스트, 터널 및 인증 관리
├── server.py                # 터미널 기반 CLI 호스트
├── screen_streamer.py       # mss & OpenCV 초저지연 화면 캡처 및 MJPEG 스트리머
├── audio_streamer.py        # WASAPI Loopback 오디오 캡처 & PCM 브로드캐스터
├── input_controller.py      # pyautogui 기반 마우스/키보드 네이티브 제어기
├── requirements.txt         # 파이썬 의존성 패키지 목록
├── 실행.bat / start.bat      # 원클릭 실행 스크립트
├── start_background.vbs     # 콘솔 창 없는 백그라운드 런처
├── PhonePC_Remote_v2.2.0.apk # 119 KB 안드로이드 네이티브 앱
├── web/                     # 모바일 웹 컨트롤러 프론트엔드
│   ├── index.html           # 반응형 컨트롤러 및 인증 UI
│   ├── app.js               # WebSocket 통신, 멀티터치, 가상 키보드 제어
│   └── style.css            # 다크 테마 Cyber UI 스타일시트
└── android/                 # 안드로이드 스튜디오 네이티브 프로젝트 (SDK 34)
```

---

## 📄 라이선스
MIT License
