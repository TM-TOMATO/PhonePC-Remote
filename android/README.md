# PhonePC Remote - Android Client (Google Play Store Ready)

이 프로젝트는 **PhonePC Remote** 모바일 클라이언트를 구글 플레이 스토어(Google Play Console)에 즉시 출시 가능한 형태로 패키징한 안드로이드 네이티브 앱 프로젝트입니다.

---

## 📱 주요 사양 및 플레이스토어 정책 준수
- **Application ID**: `com.phonepc.remote`
- **Target SDK**: `API 34 (Android 14)` (구글 플레이 스토어 최신 요구사항 완벽 충족)
- **Min SDK**: `API 24 (Android 7.0+)` (전 세계 98% 이상 안드로이드 기기 지원)
- **Version Code**: `1`
- **Version Name**: `2.2.0`
- **하드웨어 가속**: `android:hardwareAccelerated="true"` 적용 (초당 30~60프레임 저지연 스트리밍)
- **권한 명시**:
  - `INTERNET`, `ACCESS_NETWORK_STATE`: PC와의 WebSocket/HTTP 연결
  - `CAMERA`: PC 화면의 1초 간편 페어링 QR 코드 스캔
  - `MODIFY_AUDIO_SETTINGS`, `WAKE_LOCK`: 실시간 무지연 PC 사운드 스트리밍 및 조작 중 화면 꺼짐 방지
  - `VIBRATE`: 햅틱 터치 피드백

---

## 🚀 빌드 및 APK/AAB 생성 방법

### 방법 1: Android Studio를 통한 1-클릭 빌드 (권장)
1. **Android Studio**를 실행하고 `Open` 메뉴를 클릭합니다.
2. 이 디렉토리(`phone connect/android`)를 선택하여 엽니다.
3. Gradle Sync가 완료되면 상단 메뉴에서:
   - **테스트용 APK 생성**: `Build` > `Build Bundle(s) / APK(s)` > `Build APK(s)`
   - **구글 플레이 스토어 업로드용 AAB 생성**: `Build` > `Generate Signed Bundle / APK...` > `Android App Bundle` 선택 후 서명 키스토어(Keystore)를 지정하여 생성합니다.
4. 생성된 `.aab` 파일을 [Google Play Console](https://play.google.com/console)의 **프로덕션** 또는 **내부 테스트** 트랙에 업로드하시면 됩니다.

### 방법 2: 명령줄(CLI) Gradle 빌드
터미널에서 아래 명령을 실행합니다:
```bash
cd android
./gradlew assembleRelease   # Release APK 생성
./gradlew bundleRelease     # Play Store 배포용 AAB 생성
```
생성 위치:
- APK: `android/app/build/outputs/apk/release/app-release-unsigned.apk`
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`

---

## 💡 구글 플레이 콘솔 등록 팁
1. **앱 카테고리**: 도구(Tools) 또는 생산성(Productivity)
2. **콘텐츠 등급**: 전체 이용가 (PEGI 3, USK 0, ESRB Everyone)
3. **개인정보처리방침 (Privacy Policy)**:
   - 카메라 권한: PC 연결용 QR 코드를 스캔하기 위해서만 카메라를 사용하며, 촬영된 영상이나 사진은 기기 외부로 전송되거나 저장되지 않음을 명시하시면 승인이 수월합니다.
   - 마이크/소리 권한: PC 시스템 사운드를 폰으로 재생하기 위해 오디오 설정을 사용함을 명시하세요.
