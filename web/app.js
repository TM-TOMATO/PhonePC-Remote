/* ==========================================================================
   PhonePC Remote - Client Controller v2.2.0
   Features:
   - Auth (ID/PIN & QR Camera Scanner)
   - Screen Mirroring (MJPEG) & Touchpad (Direct + Trackpad)
   - Configurable Trackpad Sensitivity
   - Persistent Zoom State (Stays zoomed even when zoom tool is toggled off)
   - Clickable Zoom Indicator for 1-Tap 1x Reset
   - Multi-Touch Keyboard (Alt+Tab concurrent press, Modifier Latch)
   - Smart Shift Key (Short tap = Toggle, Long press = Hold)
   - Floating Keyboard Opacity Slider (25% ~ 100%)
   - Full QWERTY Layout with Esc, Win, Tab, Del, Arrow keys
   - Smooth Rotatable Radial Menu (Drag around menu to spin 360°)
   - 1-Tap App Update (Clear CacheStorage, unregister SW, cache-busting reload)
   ========================================================================== */

(function () {
  'use strict';

  const APP_VERSION = '2.2.0';

  // --------------------------------------------------------------------------
  // State Variables
  // --------------------------------------------------------------------------
  let ws = null;
  let isAuthenticated = false;
  let currentId = '';
  let currentPin = '';
  let serverHost = '';
  let serverProtocol = '';
  try {
    serverHost = localStorage.getItem('phonepc_last_host') || '';
    serverProtocol = localStorage.getItem('phonepc_last_proto') || '';
  } catch (e) {}

  let currentAuthToken = '';

  let clickMode = 'left';      // 'left' or 'right'
  let dragMode = false;        // true = drag mode toggle ON
  let isDraggingNow = false;   // true when mouse down is currently active in drag mode
  let isScrollOpen = false;
  let isKbOpen = false;
  let isRadialOpen = false;

  // Touchpad tracking & sensitivity
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartTime = 0;
  let lastTapTime = 0;
  let hasMoved = false;
  let trackpadSensitivity = 1.0; // 0.4x ~ 2.5x

  // Wheel tracking
  let lastWheelY = 0;

  // Keyboard window dragging & opacity
  let isKbDragging = false;
  let kbOffsetLeft = 0;
  let kbOffsetTop = 0;
  let keyboardOpacity = 0.95;

  // Camera video stream
  let cameraStream = null;
  let isScanningQr = false;

  // Keyboard layout mode & Shift state
  let kbMode = 'shortcuts'; // 'shortcuts' or 'qwerty'
  let isShiftActive = false;
  let shiftHoldTimer = null;
  let isShiftHolding = false;
  let shiftTouchStartTime = 0;

  // Multi-touch keyboard tracking
  const activeKeyTouches = new Map(); // touchId -> { key, btn, isLatched }
  const latchedKeys = new Set();       // keys latched ON (e.g. 'alt', 'ctrl')
  const lastModifierTapTimes = {};    // key -> timestamp for double-tap latch detection

  // Zoom state (persistent even when zoom tool toggle is OFF)
  let isZoomMode = false;
  let zoomLevel = 1.0;
  let zoomPanX = 0;
  let zoomPanY = 0;
  let lastPinchDist = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartZoomX = 0;
  let panStartZoomY = 0;
  let lastZoomDoubleTap = 0;

  // Radial menu rotation state
  let radialAngleOffset = 0; // degrees
  let isRotatingRadial = false;
  let rotTouchStartX = 0;
  let rotTouchStartY = 0;
  let rotStartTouchAngle = 0;
  let rotInitialOffset = 0;
  let rotHasMoved = false;
  let rotSuppressedUntil = 0;

  // Custom shortcuts (loaded from localStorage)
  let customShortcuts = [
    { label: 'Ctrl+C', hotkey: 'ctrl+c' },
    { label: 'Ctrl+V', hotkey: 'ctrl+v' },
    { label: 'Ctrl+Z', hotkey: 'ctrl+z' },
    { label: 'Alt+Tab', hotkey: 'alt+tab' },
    { label: 'Win+D', hotkey: 'win+d' },
  ];

  // DOM Elements - Screens
  const authScreen = document.getElementById('auth-screen');
  const controllerScreen = document.getElementById('controller-screen');
  const cameraModal = document.getElementById('camera-scanner-modal');

  // DOM Elements - Auth
  const authForm = document.getElementById('auth-form');
  const inputPartnerId = document.getElementById('input-partner-id');
  const inputPin = document.getElementById('input-pin');
  const inputServerHost = document.getElementById('input-server-host');
  const checkAutoSavePc = document.getElementById('check-auto-save-pc');
  const authError = document.getElementById('auth-error');
  const openInAppBanner = document.getElementById('open-in-app-banner');
  const btnOpenInApp = document.getElementById('btn-open-in-app');
  const btnBannerDownload = document.getElementById('btn-banner-download');
  if (inputServerHost) {
    inputServerHost.value = serverHost || '';
  }
  if (checkAutoSavePc) {
    checkAutoSavePc.checked = false;
  }
  const btnOpenScanner = document.getElementById('btn-open-scanner');
  const btnCloseScanner = document.getElementById('btn-close-scanner');
  const qrVideo = document.getElementById('qr-video');
  const qrCanvas = document.getElementById('qr-canvas');
  const btnDisconnect = document.getElementById('btn-disconnect');

  // DOM Elements - Controller
  const connDot = document.getElementById('conn-dot');
  const connText = document.getElementById('conn-text');
  const pingText = document.getElementById('ping-text');

  const btnToggleLClick = document.getElementById('toggle-lclick');
  const btnToggleRClick = document.getElementById('toggle-rclick');
  const btnToggleDrag = document.getElementById('toggle-drag');
  const dragStatusBadge = document.getElementById('drag-status-badge');
  const btnInstallPwa = document.getElementById('btn-install-pwa');
  const toggleScreenStream = document.getElementById('toggle-screen-stream');
  const toggleTouchMode = document.getElementById('toggle-touch-mode');
  const toggleZoomBtn = document.getElementById('toggle-zoom');
  const toggleQualityBtn = document.getElementById('toggle-quality');
  const qualityIcon = document.getElementById('quality-icon');
  const qualityStatusBadge = document.getElementById('quality-status-badge');

  const touchpad = document.getElementById('touchpad');
  const touchpadHint = document.getElementById('touchpad-hint');
  const touchRipple = document.getElementById('touch-ripple');
  const screenViewport = document.getElementById('screen-viewport');
  const liveScreenImg = document.getElementById('live-screen-img');
  const zoomWrapper = document.getElementById('zoom-wrapper');

  const btnAuthUpdate = document.getElementById('btn-auth-update');
  const authAppVersion = document.getElementById('auth-app-version');

  // DOM Elements - Saved PCs & Verification Modal
  const savedPcsContainer = document.getElementById('saved-pcs-container');
  const savedPcsList = document.getElementById('saved-pcs-list');
  const btnSavePc = document.getElementById('btn-save-pc');
  const btnSettingsSavePc = document.getElementById('btn-settings-save-pc');
  const savePcModal = document.getElementById('save-pc-modal');
  const btnCancelSavePc = document.getElementById('btn-cancel-save-pc');

  function hideTouchpadHint() {
    if (touchpadHint && touchpadHint.style.display !== 'none') {
      touchpadHint.style.transition = 'opacity 0.3s ease-out';
      touchpadHint.style.opacity = '0';
      touchpadHint.style.pointerEvents = 'none';
      setTimeout(() => {
        touchpadHint.style.display = 'none';
        touchpadHint.classList.add('hidden');
      }, 350);
    }
  }

  let currentQuality = localStorage.getItem('phonepc_screen_quality') || 'high';

  function setQualityPreset(preset, sendToServer = true) {
    currentQuality = preset || 'high';
    try {
      localStorage.setItem('phonepc_screen_quality', currentQuality);
    } catch (e) {}

    const settingsScreenQuality = document.getElementById('settings-screen-quality');
    if (settingsScreenQuality) {
      settingsScreenQuality.value = currentQuality;
    }

    if (qualityStatusBadge) {
      if (currentQuality === 'ultra') {
        qualityStatusBadge.textContent = '원본';
        if (qualityIcon) qualityIcon.textContent = '💎';
        if (toggleQualityBtn) toggleQualityBtn.title = '화질: 초고화질 (PC 원본 해상도 85%) - 클릭 시 변경';
      } else if (currentQuality === 'high') {
        qualityStatusBadge.textContent = 'FHD';
        if (qualityIcon) qualityIcon.textContent = '✨';
        if (toggleQualityBtn) toggleQualityBtn.title = '화질: 고화질 (1080p FHD 78%) - 클릭 시 변경';
      } else {
        qualityStatusBadge.textContent = '720p';
        if (qualityIcon) qualityIcon.textContent = '⚡';
        if (toggleQualityBtn) toggleQualityBtn.title = '화질: 일반 (720p HD 60%) - 클릭 시 변경';
      }
    }

    if (sendToServer && ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
      sendPayload('screen_quality', { preset: currentQuality });
    }
  }

  let touchMode = 'direct';      // 'direct' (screen touch) or 'trackpad' (relative)
  let isScreenMirrorOn = true;

  const scrollPanel = document.getElementById('scroll-wheel-panel');
  const wheelTrack = document.getElementById('wheel-track');
  const closeScrollBtn = document.getElementById('close-scroll-btn');

  const floatingKb = document.getElementById('floating-keyboard');
  const kbDragHandle = document.getElementById('kb-drag-handle');
  const kbScaleSlider = document.getElementById('kb-scale-slider');
  const kbRatioSlider = document.getElementById('kb-ratio-slider');
  const kbHeightSlider = document.getElementById('kb-height-slider');
  const kbOpacitySlider = document.getElementById('kb-opacity-slider');
  const closeKbBtn = document.getElementById('close-kb-btn');
  const pcTextInput = document.getElementById('pc-text-input');
  const btnSendText = document.getElementById('btn-send-text');

  const kbLayoutGame = document.getElementById('kb-layout-game');
  const kbLayoutShortcuts = document.getElementById('kb-layout-shortcuts');
  const kbLayoutQwerty = document.getElementById('kb-layout-qwerty');
  const qwertyShiftBtn = document.getElementById('qwerty-shift-btn');

  const radialMenuContainer = document.getElementById('radial-menu-container');
  const mainMenuFab = document.getElementById('main-menu-fab');
  const radialItems = document.getElementById('radial-items');
  const radialBackdrop = document.getElementById('radial-backdrop');

  const radialBtnDrag = document.getElementById('radial-btn-drag');
  const radialBtnScroll = document.getElementById('radial-btn-scroll');
  const radialBtnKb = document.getElementById('radial-btn-kb');
  const radialBtnSavePc = document.getElementById('radial-btn-save-pc');
  const radialBtnSettings = document.getElementById('radial-btn-settings');

  // Settings DOM
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const settingsOrientation = document.getElementById('settings-orientation');
  const settingsKbLayout = document.getElementById('settings-kb-layout');
  const settingsKbScale = document.getElementById('settings-kb-scale');
  const settingsKbScaleVal = document.getElementById('settings-kb-scale-val');
  const settingsKbRatio = document.getElementById('settings-kb-ratio');
  const settingsKbRatioVal = document.getElementById('settings-kb-ratio-val');
  const settingsKbHeight = document.getElementById('settings-kb-height');
  const settingsKbHeightVal = document.getElementById('settings-kb-height-val');
  const settingsKbOpacity = document.getElementById('settings-kb-opacity');
  const kbOpacityVal = document.getElementById('kb-opacity-val');
  const settingsSensitivity = document.getElementById('settings-sensitivity');
  const sensitivityValue = document.getElementById('sensitivity-value');
  const shortcutEditorList = document.getElementById('shortcut-editor-list');
  const btnAddShortcut = document.getElementById('btn-add-shortcut');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  // App Update DOM
  const btnCheckUpdate = document.getElementById('btn-check-update');
  const appCurrentVersion = document.getElementById('app-current-version');
  const appUpdateBadge = document.getElementById('app-update-badge');
  const updateToast = document.getElementById('update-toast');
  const btnToastUpdate = document.getElementById('btn-toast-update');

  // --------------------------------------------------------------------------
  // Haptic Feedback Helper
  // --------------------------------------------------------------------------
  function vibrate(ms) {
    if (window.AndroidBridge && window.AndroidBridge.vibrate) {
      window.AndroidBridge.vibrate(Array.isArray(ms) ? ms[0] : ms);
    } else if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  // --------------------------------------------------------------------------
  // Screen Wake Lock
  // --------------------------------------------------------------------------
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try { await navigator.wakeLock.request('screen'); } catch (err) {}
    }
  }
  requestWakeLock();

  // --------------------------------------------------------------------------
  // Orientation Lock Helpers (Portrait for Auth, Landscape for Controller)
  // --------------------------------------------------------------------------
  async function lockPortrait() {
    if (window.AndroidBridge && window.AndroidBridge.lockPortrait) {
      window.AndroidBridge.lockPortrait();
    }
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('portrait');
      }
    } catch (e) {}
  }

  async function lockLandscape() {
    if (window.AndroidBridge && window.AndroidBridge.lockLandscape) {
      window.AndroidBridge.lockLandscape();
    }
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // Server Origin & Screen Stream Lifecycle Management
  // --------------------------------------------------------------------------
  function getBaseOrigin() {
    if (serverHost) {
      return `${serverProtocol || 'http:'}//${serverHost}`;
    }
    const savedHost = localStorage.getItem('phonepc_last_host');
    const savedProto = localStorage.getItem('phonepc_last_proto') || 'http:';
    if (savedHost) {
      serverHost = savedHost;
      serverProtocol = savedProto;
      return `${serverProtocol}//${serverHost}`;
    }
    if (location.protocol === 'file:' || !location.host) {
      return 'http://127.0.0.1:8080';
    }
    return '';
  }

  const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  let streamRetryTimer = null;

  function startScreenStream() {
    if (!liveScreenImg || !isScreenMirrorOn || !isAuthenticated) return;
    const baseOrigin = getBaseOrigin();
    const newSrc = `${baseOrigin}/screen_stream?t=${Date.now()}`;
    console.log('[Stream] Starting live screen stream:', newSrc);
    if (screenViewport) {
      screenViewport.classList.remove('hidden');
    }
    liveScreenImg.style.display = 'block';
    // Clear with 1x1 transparent gif first to forcibly terminate any prior connection
    liveScreenImg.src = BLANK_IMAGE;
    setTimeout(() => {
      if (isScreenMirrorOn && isAuthenticated) {
        liveScreenImg.src = newSrc;
      }
    }, 40);
  }

  function stopScreenStream() {
    if (liveScreenImg) {
      liveScreenImg.src = BLANK_IMAGE;
    }
    if (streamRetryTimer) {
      clearTimeout(streamRetryTimer);
      streamRetryTimer = null;
    }
  }

  function restartScreenStream() {
    if (!liveScreenImg || !isScreenMirrorOn || !isAuthenticated) return;
    console.log('[Stream] Restarting screen stream...');
    stopScreenStream();
    setTimeout(() => {
      if (isScreenMirrorOn && isAuthenticated) {
        startScreenStream();
      }
    }, 100);
  }

  if (liveScreenImg) {
    liveScreenImg.onerror = () => {
      if (!isAuthenticated || !isScreenMirrorOn) return;
      console.warn('[Stream] liveScreenImg disconnected or errored. Auto-recovering in 800ms...');
      if (streamRetryTimer) clearTimeout(streamRetryTimer);
      streamRetryTimer = setTimeout(() => {
        if (isAuthenticated && isScreenMirrorOn) {
          restartScreenStream();
        }
      }, 800);
    };
  }

  // --------------------------------------------------------------------------
  // Phone Sleep/Wake & Screen Off/On Lifecycle Recovery
  // --------------------------------------------------------------------------
  let resumeWatchdogTimer = null;
  let lastResumeTimestamp = 0;

  function handleAppResume() {
    const now = Date.now();
    // Debounce rapid events
    if (now - lastResumeTimestamp < 350) return;
    lastResumeTimestamp = now;

    console.log('[Lifecycle] App resumed / Screen turned ON. Restoring connection & screen stream...');

    requestWakeLock();

    if (!isAuthenticated) return;

    lockLandscape();

    // 1. Verify WebSocket health
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      console.log('[Lifecycle] WebSocket disconnected during sleep. Reconnecting immediately...');
      connectWebSocket(currentId, currentPin, currentAuthToken);
    } else if (ws.readyState === WebSocket.OPEN) {
      console.log('[Lifecycle] WebSocket OPEN. Sending ping to verify responsiveness...');
      const pingTime = Date.now();
      lastPingSentTime = pingTime;
      sendPayload('ping', { time: pingTime });
      startPingInterval();

      // If no message was received for > 4s, set watchdog: if still no response in 2s, force reconnect
      if (Date.now() - lastPongReceivedTime > 4000) {
        if (resumeWatchdogTimer) clearTimeout(resumeWatchdogTimer);
        resumeWatchdogTimer = setTimeout(() => {
          if (isAuthenticated && (!ws || ws.readyState !== WebSocket.OPEN || lastPongReceivedTime < pingTime)) {
            console.warn('[Lifecycle] Resume ping watchdog timed out! Force reconnecting socket...');
            try { ws.close(); } catch (e) {}
            connectWebSocket(currentId, currentPin, currentAuthToken);
          }
        }, 2000);
      }
    }

    // 2. Always refresh screen stream when screen is turned back ON!
    if (isScreenMirrorOn) {
      restartScreenStream();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleAppResume();
    } else {
      console.log('[Lifecycle] App visibility changed to hidden (Screen turned OFF or minimized).');
    }
  });

  window.addEventListener('pageshow', () => handleAppResume());
  window.addEventListener('focus', () => handleAppResume());
  window.handleAppResume = handleAppResume;

  // --------------------------------------------------------------------------
  // Web Visit App Install Prompt Modal
  // --------------------------------------------------------------------------
  let deferredPrompt = null;
  const appInstallModal = document.getElementById('app-install-modal');
  const btnAcceptInstall = document.getElementById('btn-accept-install');
  const btnDeclineInstall = document.getElementById('btn-decline-install');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstallPwa) btnInstallPwa.classList.remove('hidden');
  });

  function checkShowInstallPrompt() {
    // 1. Don't show if already inside Android Native WebView app
    const isAndroidApp = !!window.AndroidBridge || navigator.userAgent.includes('PhonePCRemoteApp');
    if (isAndroidApp) return;

    // 2. Don't show if already running in standalone PWA window
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) return;

    // 3. Don't show if user already declined in this browsing session
    try {
      if (sessionStorage.getItem('phonepc_install_dismissed') === 'true') {
        return;
      }
    } catch (e) {}

    // Show after 600ms for smooth entrance
    setTimeout(() => {
      if (appInstallModal) {
        appInstallModal.classList.remove('hidden');
      }
    }, 600);
  }

  function handleAcceptInstall() {
    if (appInstallModal) {
      appInstallModal.classList.add('hidden');
    }
    try {
      sessionStorage.setItem('phonepc_install_dismissed', 'true');
    } catch (e) {}

    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        deferredPrompt = null;
      });
    }

    if (isAndroid) {
      const baseOrigin = serverHost ? `${serverProtocol || 'http:'}//${serverHost}` : (location.protocol === 'file:' ? 'http://127.0.0.1:8080' : '');
      const apkUrl = (baseOrigin || '') + '/download/apk?t=' + Date.now();
      window.location.href = apkUrl;
      alert('📱 안드로이드 전용 앱(APK) 다운로드가 시작되었습니다.\n\n다운로드 완료 후 상단 알림창에서 파일을 터치하여 설치를 진행해 주세요!');
    } else if (isIOS) {
      alert('📱 아이폰/아이패드 설치 안내:\n\n사파리(Safari) 브라우저 하단의 [공유 버튼(⎋)]을 누른 후, [홈 화면에 추가]를 선택하시면 앱으로 설치됩니다.');
    } else {
      const baseOrigin = serverHost ? `${serverProtocol || 'http:'}//${serverHost}` : (location.protocol === 'file:' ? 'http://127.0.0.1:8080' : '');
      window.location.href = (baseOrigin || '') + '/download/apk';
    }
  }

  function handleDeclineInstall() {
    if (appInstallModal) {
      appInstallModal.classList.add('hidden');
    }
    try {
      sessionStorage.setItem('phonepc_install_dismissed', 'true');
    } catch (e) {}
  }

  if (btnAcceptInstall) btnAcceptInstall.addEventListener('click', handleAcceptInstall);
  if (btnDeclineInstall) btnDeclineInstall.addEventListener('click', handleDeclineInstall);

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', handleAcceptInstall);
  }

  checkShowInstallPrompt();

  // --------------------------------------------------------------------------
  // Real-Time Audio Streaming (Web Audio API)
  // --------------------------------------------------------------------------
  const toggleAudioBtn = document.getElementById('toggle-audio');
  let audioContext = null;
  let isAudioEnabled = false;
  let nextAudioTime = 0;
  const AUDIO_SAMPLE_RATE = 48000;
  const AUDIO_CHANNELS = 2;

  function initAudioContext() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx({ sampleRate: AUDIO_SAMPLE_RATE });
      }
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }

  function playAudioChunk(arrayBuffer) {
    if (!isAudioEnabled || !audioContext) return;
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const int16Array = new Int16Array(arrayBuffer);
    const numFrames = Math.floor(int16Array.length / AUDIO_CHANNELS);
    if (numFrames <= 0) return;

    const audioBuffer = audioContext.createBuffer(AUDIO_CHANNELS, numFrames, AUDIO_SAMPLE_RATE);
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = audioBuffer.getChannelData(1);

    for (let i = 0; i < numFrames; i++) {
      leftChannel[i] = int16Array[i * 2] / 32768.0;
      rightChannel[i] = int16Array[i * 2 + 1] / 32768.0;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    const currentTime = audioContext.currentTime;
    if (nextAudioTime < currentTime) {
      nextAudioTime = currentTime + 0.035; // 35ms jitter buffer
    }
    source.start(nextAudioTime);
    nextAudioTime += audioBuffer.duration;
  }

  function toggleAudio(forceState) {
    isAudioEnabled = typeof forceState === 'boolean' ? forceState : !isAudioEnabled;
    if (isAudioEnabled) {
      initAudioContext();
      if (toggleAudioBtn) toggleAudioBtn.classList.add('active');
      sendPayload('audio_enable', { enabled: true });
    } else {
      if (toggleAudioBtn) toggleAudioBtn.classList.remove('active');
      sendPayload('audio_enable', { enabled: false });
      nextAudioTime = 0;
    }
    vibrate(20);
  }

  if (toggleAudioBtn) {
    toggleAudioBtn.addEventListener('click', () => toggleAudio());
  }

  // --------------------------------------------------------------------------
  // WebSocket Connection & Authentication
  // --------------------------------------------------------------------------
  function connectWebSocket(id, pin, token = null) {
    currentId = (id || currentId || '').replace(/\s+/g, '');
    currentPin = (pin || currentPin || '').trim();
    if (token !== null) {
      currentAuthToken = token || '';
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      sendAuthPayload();
      return;
    }

    const effectiveProtocol = (serverProtocol === 'https:' || location.protocol === 'https:') ? 'wss:' : 'ws:';
    const effectiveHost = serverHost || location.host || '127.0.0.1:8080';
    const wsUrl = `${effectiveProtocol}//${effectiveHost}/ws`;

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      connDot.className = 'dot green';
      connText.textContent = '연결됨';
      startPingInterval();
      sendAuthPayload();
      checkAppVersion();
    };

    ws.onclose = () => {
      connDot.className = 'dot red';
      connText.textContent = '연결 끊김';
      pingText.textContent = '--ms';
      stopPingInterval();
      if (isAuthenticated) {
        setTimeout(() => connectWebSocket(currentId, currentPin, currentAuthToken), 1500);
      } else {
        authError.textContent = `PC에 연결할 수 없습니다 (${effectiveHost}).\n• PC 프로그램이 켜져 있는지 확인하세요.\n• 같은 Wi-Fi인 경우 PC 주소(예: 192.168.0.2:8080)를 입력하세요.\n• PC 화면의 QR 코드를 스캔하면 주소가 자동 입력됩니다.`;
        authError.classList.remove('hidden');
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      lastPongReceivedTime = Date.now();
      if (resumeWatchdogTimer) {
        clearTimeout(resumeWatchdogTimer);
        resumeWatchdogTimer = null;
      }

      if (event.data instanceof ArrayBuffer) {
        playAudioChunk(event.data);
        return;
      }

      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_success') {
          handleAuthSuccess(msg.payload || {});
        } else if (msg.type === 'auth_fail') {
          handleAuthFail(msg.payload?.message || '인증에 실패했습니다.');
        } else if (msg.type === 'save_pc_success') {
          handleSavePcSuccess(msg.payload || {});
        } else if (msg.type === 'save_pc_rejected') {
          handleSavePcRejected(msg.payload?.message || 'PC에서 등록 승인이 거부되었습니다.');
        } else if (msg.type === 'pong') {
          const latency = Date.now() - msg.time;
          pingText.textContent = `${latency}ms`;
        }
      } catch (e) {}
    };
  }

  function sendAuthPayload() {
    if (currentAuthToken) {
      sendPayload('auth_token', { token: currentAuthToken });
    } else if (currentId && currentPin) {
      sendPayload('auth', { id: currentId, pin: currentPin });
    }
  }

  function handleAuthSuccess(payload = {}) {
    isAuthenticated = true;
    authError.classList.add('hidden');
    authScreen.classList.add('hidden');
    controllerScreen.classList.remove('hidden');

    lockLandscape();

    if (liveScreenImg && isScreenMirrorOn) {
      startScreenStream();
    }
    sendPayload('screen_quality', { preset: currentQuality });
    setTimeout(hideTouchpadHint, 2500);

    // If connected using token, keep saved PC record up to date
    if (currentAuthToken) {
      try {
        let list = getSavedPcs();
        let idx = list.findIndex((p) => p.token === currentAuthToken);
        if (idx !== -1) {
          if (payload.pc_name) list[idx].name = payload.pc_name;
          if (payload.pc_id) list[idx].id = payload.pc_id;
          if (serverHost) list[idx].host = serverHost;
          if (serverProtocol) list[idx].proto = serverProtocol;
          localStorage.setItem('phonepc_saved_pcs', JSON.stringify(list));
        }
      } catch (e) {}
    } else {
      try {
        localStorage.setItem('phonepc_last_id', currentId);
        localStorage.setItem('phonepc_last_pin', currentPin);
      } catch (e) {}
    }

    checkAppVersion();
    vibrate(40);

    // Update PC Save button appearance in top bar
    updateSavePcButtonUI();

    // Auto-save PC if requested and not already authenticated by token
    const checkAutoSavePc = document.getElementById('check-auto-save-pc');
    if (checkAutoSavePc && checkAutoSavePc.checked && !currentAuthToken) {
      setTimeout(() => {
        if (isAuthenticated) {
          requestSavePc();
        }
      }, 700);
    }
  }

  function handleAuthFail(errMsg) {
    isAuthenticated = false;
    currentAuthToken = '';
    authError.textContent = errMsg;
    authError.classList.remove('hidden');
    authScreen.classList.remove('hidden');
    controllerScreen.classList.add('hidden');
    vibrate([40, 60, 40]);
  }

  let pingTimer = null;
  let lastPingSentTime = 0;
  let lastPongReceivedTime = Date.now();

  function startPingInterval() {
    stopPingInterval();
    lastPongReceivedTime = Date.now();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
        if (Date.now() - lastPongReceivedTime > 12000) {
          console.warn('[Ping] No message received from PC in 12s. Half-open socket detected, reconnecting...');
          try { ws.close(); } catch (e) {}
          connectWebSocket(currentId, currentPin, currentAuthToken);
          return;
        }
        lastPingSentTime = Date.now();
        sendPayload('ping', { time: lastPingSentTime });
      }
    }, 2500);
  }

  function stopPingInterval() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  function sendPayload(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  // --------------------------------------------------------------------------
  // Auth Form & Disconnect
  // --------------------------------------------------------------------------
  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = inputPartnerId.value;
    const pin = inputPin.value;

    if (inputServerHost && inputServerHost.value.trim()) {
      let hostVal = inputServerHost.value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      serverHost = hostVal;
      serverProtocol = hostVal.includes('trycloudflare.com') ? 'https:' : 'http:';
      try {
        localStorage.setItem('phonepc_last_host', serverHost);
        localStorage.setItem('phonepc_last_proto', serverProtocol);
      } catch (e) {}
    }

    if (!serverHost && !location.host) {
      authError.textContent = 'PC 주소를 입력하거나, 위의 [📷 PC 화면의 QR 코드 스캔]을 눌러 연결하세요.';
      authError.classList.remove('hidden');
      return;
    }

    if (!id || !pin) {
      authError.textContent = '파트너 ID와 비밀번호를 모두 입력해 주세요.';
      authError.classList.remove('hidden');
      return;
    }
    authError.classList.add('hidden');
    currentAuthToken = '';
    connectWebSocket(id, pin);
  });

  inputPartnerId.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 9) val = val.slice(0, 9);
    if (val.length > 6) {
      val = `${val.slice(0, 3)} ${val.slice(3, 6)} ${val.slice(6)}`;
    } else if (val.length > 3) {
      val = `${val.slice(0, 3)} ${val.slice(3)}`;
    }
    e.target.value = val;
  });

  btnDisconnect.addEventListener('click', () => {
    if (confirm('원격 제어를 종료하고 연결을 해제하시겠습니까?')) {
      try {
        sessionStorage.setItem('phonepc_manual_disconnect', '1');
      } catch (e) {}
      isAuthenticated = false;
      currentAuthToken = '';
      sendPayload('release_all_keys');
      if (isAudioEnabled) toggleAudio(false);
      stopScreenStream();
      if (ws) ws.close();
      controllerScreen.classList.add('hidden');
      authScreen.classList.remove('hidden');
      lockPortrait();
      renderSavedPcs();
    }
  });

  // --------------------------------------------------------------------------
  // Camera QR Code Scanner (Live Video + Photo Fallback)
  // --------------------------------------------------------------------------
  const qrFileInput = document.getElementById('qr-file-input');
  const btnCameraFallback = document.getElementById('btn-camera-fallback');
  const scannerStatusText = document.getElementById('scanner-status-text');
  const btnToggleCameraFit = document.getElementById('btn-toggle-camera-fit');
  let isCameraContain = false;

  if (btnToggleCameraFit) {
    btnToggleCameraFit.addEventListener('click', () => {
      isCameraContain = !isCameraContain;
      if (isCameraContain) {
        qrVideo.style.objectFit = 'contain';
        btnToggleCameraFit.textContent = '🔍 확대';
      } else {
        qrVideo.style.objectFit = 'cover';
        btnToggleCameraFit.textContent = '📐 비율';
      }
      vibrate(15);
    });
  }

  async function startCameraScanner() {
    cameraModal.classList.remove('hidden');
    isScanningQr = true;
    if (scannerStatusText) scannerStatusText.textContent = '카메라를 준비하고 있습니다...';

    // 1. In Android native app: request camera permission if not yet granted
    if (window.AndroidBridge && window.AndroidBridge.requestCameraPermission) {
      if (window.AndroidBridge.hasCameraPermission && !window.AndroidBridge.hasCameraPermission()) {
        window.onCameraPermissionGranted = () => {
          window.onCameraPermissionGranted = null;
          startCameraScanner();
        };
        window.AndroidBridge.requestCameraPermission();
        return;
      }
    }

    // 2. Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (scannerStatusText) {
        scannerStatusText.textContent = '웹 브라우저 보안 정책으로 실시간 카메라가 지원되지 않습니다. 아래 [카메라 앱으로 직접 촬영] 버튼을 눌러주세요.';
      }
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      qrVideo.srcObject = cameraStream;
      qrVideo.style.objectFit = isCameraContain ? 'contain' : 'cover';
      qrVideo.setAttribute('playsinline', 'true');
      qrVideo.setAttribute('autoplay', 'true');
      qrVideo.setAttribute('muted', 'true');
      await qrVideo.play();
      if (scannerStatusText) scannerStatusText.textContent = 'QR 코드가 사각형 안에 들어오면 자동으로 인식됩니다.';
      requestAnimationFrame(scanQrFrame);
    } catch (err) {
      console.warn('getUserMedia error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        if (scannerStatusText) {
          scannerStatusText.textContent = '카메라 접근 권한이 필요합니다. 아래 [카메라 앱으로 직접 촬영]을 이용하시거나 설정에서 권한을 허용해 주세요.';
        }
        if (window.AndroidBridge && window.AndroidBridge.openAppSettings) {
          if (confirm('카메라 권한이 거부되었습니다. 앱 설정으로 이동하여 카메라 권한을 켜시겠습니까?')) {
            window.AndroidBridge.openAppSettings();
          }
        }
      } else {
        if (scannerStatusText) {
          scannerStatusText.textContent = '카메라 실행 실패. 아래 [카메라 앱으로 직접 촬영] 버튼을 눌러주세요.';
        }
      }
    }
  }

  function stopCameraScanner() {
    isScanningQr = false;
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    if (qrVideo) {
      qrVideo.srcObject = null;
    }
    cameraModal.classList.add('hidden');
  }

  function scanQrFrame() {
    if (!isScanningQr) return;

    if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
      const canvas = qrCanvas;
      const ctx = canvas.getContext('2d');
      canvas.width = qrVideo.videoWidth;
      canvas.height = qrVideo.videoHeight;
      ctx.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          vibrate(40);
          stopCameraScanner();
          handleScannedData(code.data);
          return;
        }
      }
    }

    if (isScanningQr) {
      requestAnimationFrame(scanQrFrame);
    }
  }

  function handleQrFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (scannerStatusText) scannerStatusText.textContent = '사진에서 QR 코드를 분석 중...';
    const reader = new FileReader();
    reader.onload = function (evt) {
      const img = new Image();
      img.onload = function () {
        const canvas = qrCanvas;
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if (window.jsQR) {
          const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
          });
          if (code && code.data) {
            vibrate(40);
            stopCameraScanner();
            handleScannedData(code.data);
            return;
          }
        }
        if (scannerStatusText) {
          scannerStatusText.textContent = 'QR 코드를 찾지 못했습니다. 다시 촬영해 주세요.';
        }
        alert('QR 코드를 인식하지 못했습니다. QR 코드가 선명하게 나오도록 다시 촬영해 주세요.');
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleScannedData(dataStr) {
    try {
      let id = null;
      let pin = null;

      if (dataStr.includes('?')) {
        const url = dataStr.includes('://') ? new URL(dataStr) : new URL(dataStr, 'http://dummy.com');
        id = url.searchParams.get('id');
        pin = url.searchParams.get('pin');
        const scannedHost = url.searchParams.get('host');
        const scannedProto = url.searchParams.get('proto');

        if (scannedHost) {
          serverHost = scannedHost;
          if (inputServerHost) inputServerHost.value = serverHost;
          try { localStorage.setItem('phonepc_last_host', serverHost); } catch (e) {}
        } else if (dataStr.includes('://') && url.host && url.host !== 'dummy.com') {
          serverHost = url.host;
          if (inputServerHost) inputServerHost.value = serverHost;
          try { localStorage.setItem('phonepc_last_host', serverHost); } catch (e) {}
        }

        if (scannedProto) {
          serverProtocol = scannedProto.endsWith(':') ? scannedProto : (scannedProto + ':');
          try { localStorage.setItem('phonepc_last_proto', serverProtocol); } catch (e) {}
        } else if (dataStr.includes('://') && url.protocol && url.protocol !== 'http:' && url.protocol !== 'file:') {
          serverProtocol = url.protocol;
          try { localStorage.setItem('phonepc_last_proto', serverProtocol); } catch (e) {}
        }
      } else if (dataStr.includes(':')) {
        const parts = dataStr.split(':');
        id = parts[0].trim();
        pin = parts[1].trim();
      }

      if (id && pin) {
        inputPartnerId.value = id;
        inputPin.value = pin;
        currentAuthToken = '';
        connectWebSocket(id, pin);
      } else {
        alert('올바른 PhonePC Remote QR 코드가 아닙니다: ' + dataStr);
      }
    } catch (e) {
      alert('QR 코드 인식 실패: ' + e.message);
    }
  }

  btnOpenScanner.addEventListener('click', startCameraScanner);
  btnCloseScanner.addEventListener('click', stopCameraScanner);
  if (btnCameraFallback && qrFileInput) {
    btnCameraFallback.addEventListener('click', () => qrFileInput.click());
    qrFileInput.addEventListener('change', handleQrFileSelected);
  }

  // --------------------------------------------------------------------------
  // Auto-Connect from URL parameters or LocalStorage & App Deep Linking
  // --------------------------------------------------------------------------
  function checkUrlAutoConnect() {
    const params = new URLSearchParams(window.location.search);
    const paramId = params.get('id');
    const paramPin = params.get('pin');
    const paramHost = params.get('host');
    const paramProto = params.get('proto');

    if (paramHost) {
      serverHost = paramHost;
      try {
        localStorage.setItem('phonepc_last_host', serverHost);
      } catch (e) {}
      if (inputServerHost) inputServerHost.value = serverHost;
    }
    if (paramProto) {
      serverProtocol = paramProto.endsWith(':') ? paramProto : (paramProto + ':');
      try {
        localStorage.setItem('phonepc_last_proto', serverProtocol);
      } catch (e) {}
    }

    // Configure open-in-app banner and deep link intent for mobile browsers
    setupAppLauncher(paramId, paramPin, paramHost, paramProto);

    if (paramId && paramPin) {
      inputPartnerId.value = paramId;
      inputPin.value = paramPin;
      connectWebSocket(paramId, paramPin);
      return;
    }

    // Check if user explicitly clicked disconnect in this session
    let isManualDisconnect = false;
    try {
      isManualDisconnect = sessionStorage.getItem('phonepc_manual_disconnect') === '1';
    } catch (e) {}

    if (!isManualDisconnect) {
      const savedPcs = getSavedPcs();
      if (savedPcs.length > 0) {
        // Find matching saved PC by current host, or default to first saved PC
        const matched = savedPcs.find((p) => p.host && location.host && p.host === location.host) || (savedPcs.length === 1 ? savedPcs[0] : null);
        if (matched && matched.token) {
          console.log('[AutoConnect] 등록된 컴퓨터 발견! 토큰으로 즉시 자동 연결합니다...');
          connectWithSavedPc(matched);
          return;
        }
      }
    }

    try {
      const lastId = localStorage.getItem('phonepc_last_id');
      if (lastId && inputPartnerId) {
        let val = lastId.replace(/\D/g, '');
        if (val.length === 9) {
          inputPartnerId.value = `${val.slice(0, 3)} ${val.slice(3, 6)} ${val.slice(6)}`;
        } else {
          inputPartnerId.value = lastId;
        }
      }
      // Note: Do NOT prefill inputPin with stale expired PIN
    } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // Mobile Browser to Native App Launcher & Intent Dispatcher
  // --------------------------------------------------------------------------
  function setupAppLauncher(paramId, paramPin, paramHost, paramProto) {
    const isNativeApp = !!(window.AndroidBridge && typeof window.AndroidBridge.isNativeApp === 'function' && window.AndroidBridge.isNativeApp());
    if (isNativeApp) {
      if (openInAppBanner) openInAppBanner.classList.add('hidden');
      return;
    }

    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid || !openInAppBanner) {
      return;
    }

    const targetHost = paramHost || location.host || serverHost || '127.0.0.1:8080';
    const targetProto = (paramProto || location.protocol || 'http:').replace(':', '');
    const cleanId = (paramId || (inputPartnerId ? inputPartnerId.value : '') || '').replace(/\D/g, '');
    const cleanPin = (paramPin || (inputPin ? inputPin.value : '') || '').trim();

    // Construct Android Chrome Intent URL
    // When clicked or navigated, Chrome automatically hands off to com.phonepc.remote if installed
    const intentUrl = `intent://connect?id=${encodeURIComponent(cleanId)}&pin=${encodeURIComponent(cleanPin)}&host=${encodeURIComponent(targetHost)}&proto=${encodeURIComponent(targetProto)}#Intent;scheme=phonepc;package=com.phonepc.remote;end`;

    if (btnOpenInApp) {
      btnOpenInApp.href = intentUrl;
    }

    // Show the banner so the user can easily tap to open in app or download APK
    openInAppBanner.classList.remove('hidden');

    // If opened via QR scan with valid ID & PIN, automatically trigger intent to launch the native app!
    if (cleanId && cleanPin) {
      try {
        const attemptKey = `phonepc_intent_attempt_${cleanId}_${cleanPin}`;
        if (!sessionStorage.getItem(attemptKey)) {
          sessionStorage.setItem(attemptKey, '1');
          console.log('[AppLauncher] Auto-dispatching intent to open native app:', intentUrl);
          setTimeout(() => {
            window.location.href = intentUrl;
          }, 150);
        }
      } catch (e) {
        console.warn('[AppLauncher] Auto intent trigger error:', e);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Deep Link handler exposed to Android Native Bridge
  // --------------------------------------------------------------------------
  window.handleDeepLinkConnect = function(id, pin, host, proto) {
    console.log('[DeepLink] Received deep link connect:', { id, pin, host, proto });
    if (host) {
      serverHost = host;
      try {
        localStorage.setItem('phonepc_last_host', host);
      } catch (e) {}
      if (inputServerHost) inputServerHost.value = host;
    }
    if (proto) {
      serverProtocol = proto.endsWith(':') ? proto : (proto + ':');
      try {
        localStorage.setItem('phonepc_last_proto', serverProtocol);
      } catch (e) {}
    }
    if (id && pin) {
      if (inputPartnerId) inputPartnerId.value = id;
      if (inputPin) inputPin.value = pin;
      if (ws) {
        try {
          ws.close();
        } catch (e) {}
      }
      connectWebSocket(id, pin);
    }
  };

  // --------------------------------------------------------------------------
  // Saved PCs & Passwordless Instant Connection
  // --------------------------------------------------------------------------
  function getOrCreateDeviceId() {
    let id = localStorage.getItem('phonepc_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('phonepc_device_id', id);
    }
    return id;
  }

  function getSavedPcs() {
    try {
      const data = localStorage.getItem('phonepc_saved_pcs');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function savePcRecord(pcRecord) {
    try {
      let list = getSavedPcs();
      list = list.filter((p) => p.token !== pcRecord.token && p.id !== pcRecord.id);
      list.unshift(pcRecord);
      localStorage.setItem('phonepc_saved_pcs', JSON.stringify(list));
      renderSavedPcs();
    } catch (e) {}
  }

  function deleteSavedPc(tokenOrId) {
    if (confirm('저장된 컴퓨터를 목록에서 삭제하시겠습니까?')) {
      let list = getSavedPcs().filter((p) => p.token !== tokenOrId && p.id !== tokenOrId);
      localStorage.setItem('phonepc_saved_pcs', JSON.stringify(list));
      renderSavedPcs();
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function renderSavedPcs() {
    if (!savedPcsContainer || !savedPcsList) return;

    const saved = getSavedPcs();
    savedPcsContainer.classList.remove('hidden');
    savedPcsList.innerHTML = '';

    if (saved.length === 0) {
      savedPcsList.innerHTML = `
        <div class="saved-pcs-empty">
          <div class="empty-icon">💡</div>
          <div class="empty-title">등록된 컴퓨터가 없습니다</div>
          <div class="empty-sub">PC에 연결된 후 상단바의 <strong>[💾 PC 저장]</strong> 버튼을 누르면, 다음부터 비밀번호나 QR 없이 즉시 연결할 수 있습니다.</div>
        </div>
      `;
      return;
    }

    saved.forEach((pc) => {
      const item = document.createElement('div');
      item.className = 'saved-pc-item';

      const formattedId = pc.id && pc.id.length === 9
        ? `${pc.id.slice(0, 3)} ${pc.id.slice(3, 6)} ${pc.id.slice(6)}`
        : (pc.id || '');

      item.innerHTML = `
        <div class="saved-pc-info">
          <div class="saved-pc-name">🖥️ ${escapeHtml(pc.name || '내 컴퓨터')}</div>
          <div class="saved-pc-id">
            <span class="badge-pw-free">⚡ 비번/QR 불필요</span>
            ${pc.host ? '<span class="pc-host-tag">' + escapeHtml(pc.host) + '</span>' : ''}
          </div>
        </div>
        <div class="saved-pc-actions">
          <button type="button" class="btn-saved-connect" title="비밀번호 없이 즉시 연결">🚀 즉시 연결</button>
          <button type="button" class="btn-saved-delete" title="저장 삭제">🗑️</button>
        </div>
      `;

      item.querySelector('.btn-saved-connect').addEventListener('click', () => {
        vibrate(20);
        connectWithSavedPc(pc);
      });

      item.querySelector('.btn-saved-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSavedPc(pc.token || pc.id);
      });

      savedPcsList.appendChild(item);
    });
  }

  function connectWithSavedPc(pc) {
    try {
      if (sessionStorage) sessionStorage.removeItem('phonepc_manual_disconnect');
    } catch (e) {}

    // Priority: If current browser is already connected to the host web server (not file: and not local dummy)
    if (location.host && location.protocol.startsWith('http') && !location.host.includes('localhost') && !location.host.includes('127.0.0.1')) {
      serverHost = location.host;
      serverProtocol = location.protocol;
    } else if (pc.host) {
      serverHost = pc.host;
      if (pc.proto) serverProtocol = pc.proto;
    } else if (location.host && location.protocol.startsWith('http')) {
      serverHost = location.host;
      serverProtocol = location.protocol;
    }

    if (inputServerHost) inputServerHost.value = serverHost || '';
    if (inputPartnerId) {
      inputPartnerId.value = pc.id && pc.id.length === 9
        ? `${pc.id.slice(0, 3)} ${pc.id.slice(3, 6)} ${pc.id.slice(6)}`
        : (pc.id || '');
    }
    if (inputPin) inputPin.value = '';

    currentId = pc.id || '';
    currentPin = '';
    currentAuthToken = pc.token || '';

    authError.classList.add('hidden');
    connectWebSocket(currentId, '', currentAuthToken);
  }

  function updateSavePcButtonUI() {
    const savedList = getSavedPcs();
    const isAlreadySaved = !!(currentAuthToken || savedList.some((p) => p.token && (p.id === currentId || (p.host && p.host === serverHost))));
    if (btnSavePc) {
      if (isAlreadySaved) {
        btnSavePc.classList.remove('btn-save-highlight');
        btnSavePc.classList.add('active');
        const label = btnSavePc.querySelector('.toggle-label');
        if (label) label.textContent = '저장됨';
        const icon = btnSavePc.querySelector('.icon');
        if (icon) icon.textContent = '✅';
        btnSavePc.title = '이 PC는 이미 등록되어 있습니다 (비밀번호 없이 즉시 연결)';
      } else {
        btnSavePc.classList.add('btn-save-highlight');
        btnSavePc.classList.remove('active');
        const label = btnSavePc.querySelector('.toggle-label');
        if (label) label.textContent = 'PC 저장';
        const icon = btnSavePc.querySelector('.icon');
        if (icon) icon.textContent = '💾';
        btnSavePc.title = '이 컴퓨터를 등록 (다음부터 비번/QR 없이 원클릭 즉시 연결)';
      }
    }
  }

  let savePcTimeoutTimer = null;
  function requestSavePc() {
    if (!isAuthenticated) return;

    if (currentAuthToken) {
      alert('이미 이 컴퓨터가 "저장된 컴퓨터"로 등록되어 있습니다.\n\n다음 접속부터 비밀번호나 QR 없이 즉시 연결됩니다.');
      return;
    }

    // 1. Temporarily pause mirroring/sharing
    stopScreenStream();

    // 2. Open confirmation modal on phone
    if (savePcModal) {
      savePcModal.classList.remove('hidden');
    }

    // Close settings modal if open
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
      settingsModal.classList.add('hidden');
    }

    const devId = getOrCreateDeviceId();
    let devName = '내 스마트폰';
    if (navigator.userAgent.includes('Android')) devName = '안드로이드폰';
    else if (navigator.userAgent.includes('iPhone')) devName = '아이폰';

    if (savePcTimeoutTimer) clearTimeout(savePcTimeoutTimer);
    savePcTimeoutTimer = setTimeout(() => {
      if (savePcModal && !savePcModal.classList.contains('hidden')) {
        savePcModal.classList.add('hidden');
        if (liveScreenImg && isScreenMirrorOn) {
          restartScreenStream();
        }
        alert('PC에서 본인 확인 응답 시간이 초과되었습니다.\nPC 화면에 확인 창이 나타나지 않은 경우 PC 호스트를 확인해 주세요.');
      }
    }, 65000);

    vibrate(30);
    sendPayload('request_save_pc', {
      device_id: devId,
      device_name: devName
    });
  }

  function cancelSavePc() {
    if (savePcTimeoutTimer) clearTimeout(savePcTimeoutTimer);
    if (savePcModal) {
      savePcModal.classList.add('hidden');
    }
    // Resume screen mirroring
    if (liveScreenImg && isScreenMirrorOn) {
      restartScreenStream();
    }
  }

  function handleSavePcSuccess(payload) {
    if (savePcTimeoutTimer) clearTimeout(savePcTimeoutTimer);
    if (savePcModal) {
      savePcModal.classList.add('hidden');
    }

    // Resume screen streaming
    if (liveScreenImg && isScreenMirrorOn) {
      restartScreenStream();
    }

    const token = payload.token;
    const pcId = payload.pc_id || currentId;
    const pcName = payload.pc_name || '내 컴퓨터';

    currentAuthToken = token;

    savePcRecord({
      id: pcId,
      name: pcName,
      token: token,
      host: serverHost || location.host || '',
      proto: serverProtocol || location.protocol || 'http:',
      savedAt: Date.now()
    });

    updateSavePcButtonUI();
    vibrate([50, 100, 50]);
    alert(`🎉 '${pcName}' 등록이 완료되었습니다!\n\n이제 앱 첫 화면의 [저장된 컴퓨터] 목록에서 비밀번호나 QR 없이 원클릭으로 즉시 연결할 수 있습니다.`);
  }

  function handleSavePcRejected(reason) {
    if (savePcTimeoutTimer) clearTimeout(savePcTimeoutTimer);
    if (savePcModal) {
      savePcModal.classList.add('hidden');
    }

    // Resume screen streaming
    if (liveScreenImg && isScreenMirrorOn) {
      restartScreenStream();
    }

    vibrate([40, 80, 40]);
    alert(reason || 'PC에서 컴퓨터 등록 승인이 거부되었습니다.');
  }

  if (btnSavePc) btnSavePc.addEventListener('click', requestSavePc);
  if (btnSettingsSavePc) btnSettingsSavePc.addEventListener('click', requestSavePc);
  if (btnCancelSavePc) btnCancelSavePc.addEventListener('click', cancelSavePc);

  // --------------------------------------------------------------------------
  // Click & Drag Mode Management
  // --------------------------------------------------------------------------
  function setClickMode(mode) {
    clickMode = mode;
    if (mode === 'left') {
      btnToggleLClick.classList.add('active');
      btnToggleRClick.classList.remove('active');
    } else {
      btnToggleLClick.classList.remove('active');
      btnToggleRClick.classList.add('active');
    }
    vibrate(15);
  }

  function toggleDragMode(forceState) {
    if (typeof forceState === 'boolean') {
      dragMode = forceState;
    } else {
      dragMode = !dragMode;
    }

    if (dragMode) {
      btnToggleDrag.classList.add('active');
      radialBtnDrag.classList.add('active');
      dragStatusBadge.textContent = 'ON';
      vibrate([20, 40, 20]);
    } else {
      btnToggleDrag.classList.remove('active');
      radialBtnDrag.classList.remove('active');
      dragStatusBadge.textContent = 'OFF';
      if (isDraggingNow) {
        sendPayload('mouse_click', { button: 'left', action: 'up' });
        isDraggingNow = false;
      }
      vibrate(15);
    }
  }

  btnToggleLClick.addEventListener('click', () => setClickMode('left'));
  btnToggleRClick.addEventListener('click', () => setClickMode('right'));
  btnToggleDrag.addEventListener('click', () => toggleDragMode());

  // Screen stream & Touch mode toggles
  if (toggleScreenStream) {
    toggleScreenStream.addEventListener('click', () => {
      isScreenMirrorOn = !isScreenMirrorOn;
      if (isScreenMirrorOn) {
        toggleScreenStream.classList.add('active');
        screenViewport.classList.remove('hidden');
        hideTouchpadHint();
        startScreenStream();
      } else {
        toggleScreenStream.classList.remove('active');
        screenViewport.classList.add('hidden');
        stopScreenStream();
        if (touchpadHint) {
          touchpadHint.innerHTML = '<div class="hint-icon">🖥️</div><p class="hint-main">화면 공유 꺼짐</p><p class="hint-sub">상단의 [🖥️ 화면] 버튼을 누르면 다시 켜집니다</p>';
          touchpadHint.style.display = 'block';
          touchpadHint.style.opacity = '1';
          touchpadHint.style.pointerEvents = 'none';
        }
      }
      vibrate(15);
    });
  }

  if (toggleTouchMode) {
    toggleTouchMode.addEventListener('click', () => {
      touchMode = touchMode === 'direct' ? 'trackpad' : 'direct';
      const label = toggleTouchMode.querySelector('.toggle-label') || toggleTouchMode;
      const icon = toggleTouchMode.querySelector('.icon');
      if (touchMode === 'direct') {
        toggleTouchMode.classList.add('active');
        if (label) label.textContent = '직접터치';
        if (icon) icon.textContent = '🎯';
      } else {
        toggleTouchMode.classList.remove('active');
        if (label) label.textContent = '트랙패드';
        if (icon) icon.textContent = '🖱️';
      }
      vibrate(15);
    });
  }

  // --------------------------------------------------------------------------
  // Zoom Tool (Persistent Zoom: Stays zoomed when tool is OFF)
  // --------------------------------------------------------------------------
  function toggleZoom(forceState) {
    isZoomMode = typeof forceState === 'boolean' ? forceState : !isZoomMode;
    if (isZoomMode) {
      toggleZoomBtn.classList.add('active');
      // Release any active mouse drag immediately so it doesn't get stuck down on the PC
      if (isDraggingNow) {
        const activeBtn = clickMode === 'right' ? 'right' : (clickMode || 'left');
        sendPayload('mouse_click', { button: activeBtn, action: 'up' });
        isDraggingNow = false;
      }
    } else {
      toggleZoomBtn.classList.remove('active');
    }
    isPanning = false;
    applyZoomTransform();
    vibrate(15);
  }

  function resetZoom() {
    zoomLevel = 1.0;
    zoomPanX = 0;
    zoomPanY = 0;
    applyZoomTransform();
    vibrate(20);
  }

  function applyZoomTransform() {
    if (zoomWrapper) {
      if (zoomLevel <= 1.01) {
        zoomWrapper.style.transform = 'none';
        zoomWrapper.style.transformOrigin = 'center center';
      } else {
        const maxPanX = (zoomLevel - 1) * 50;
        const maxPanY = (zoomLevel - 1) * 50;
        zoomPanX = Math.max(-maxPanX, Math.min(maxPanX, zoomPanX));
        zoomPanY = Math.max(-maxPanY, Math.min(maxPanY, zoomPanY));
        zoomWrapper.style.transformOrigin = '50% 50%';
        zoomWrapper.style.transform = `scale(${zoomLevel}) translate(${-zoomPanX}%, ${-zoomPanY}%)`;
      }
    }
    showZoomIndicator();
  }

  function showZoomIndicator() {
    let indicator = document.getElementById('zoom-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'zoom-indicator';
      indicator.title = '탭하여 1x 원래 크기로 리셋';
      indicator.addEventListener('click', (e) => {
        e.stopPropagation();
        resetZoom();
      });
      touchpad.appendChild(indicator);
    }
    if (isZoomMode) {
      if (zoomLevel > 1.01) {
        indicator.innerHTML = `<span>🔍 확대 ${zoomLevel.toFixed(1)}x (마우스 차단됨)</span> <span style="opacity:0.8;font-size:9px">| 탭: 1x 리셋</span>`;
      } else {
        indicator.innerHTML = `<span>🔍 확대 모드 ON (마우스 차단됨)</span> <span style="opacity:0.8;font-size:9px">| 두 손가락 핀치/더블탭</span>`;
      }
      indicator.classList.add('visible');
    } else {
      if (zoomLevel > 1.01) {
        indicator.innerHTML = `<span>🔍 ${zoomLevel.toFixed(1)}x (마우스 조작 모드)</span> <span style="opacity:0.8;font-size:9px">| 탭: 1x 리셋</span>`;
        indicator.classList.add('visible');
      } else {
        indicator.classList.remove('visible');
      }
    }
  }

  function getPinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  if (toggleZoomBtn) {
    toggleZoomBtn.addEventListener('click', () => toggleZoom());
  }

  // --------------------------------------------------------------------------
  // Touchpad Mouse Controller (Direct Touch + Trackpad + Configurable Sensitivity)
  // --------------------------------------------------------------------------
  function getNormalizedCoords(clientX, clientY) {
    if (!liveScreenImg || liveScreenImg.clientWidth === 0) return null;
    const rect = liveScreenImg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    let rx = (clientX - rect.left) / rect.width;
    let ry = (clientY - rect.top) / rect.height;
    rx = Math.max(0, Math.min(1, rx));
    ry = Math.max(0, Math.min(1, ry));
    return { rx, ry };
  }

  function showRipple(x, y) {
    touchRipple.style.left = `${x}px`;
    touchRipple.style.top = `${y}px`;
    touchRipple.classList.remove('hidden');
    touchRipple.classList.add('animate');
    setTimeout(() => {
      touchRipple.classList.remove('animate');
      touchRipple.classList.add('hidden');
    }, 250);
  }

  function findTouchById(touchList, id) {
    if (id === null || id === undefined || !touchList) return null;
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === id) return touchList[i];
    }
    return null;
  }

  function getTouchpadTouches(e) {
    const list = [];
    if (!e || !e.touches) return list;
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      if (touchpad && touchpad.contains(t.target)) {
        list.push(t);
      }
    }
    return list;
  }

  let activeTouchpadId = null;
  let touchpadTouchCount = 0;

  touchpad.addEventListener('touchstart', (e) => {
    hideTouchpadHint();
    const screenTouches = getTouchpadTouches(e);
    touchpadTouchCount = screenTouches.length;

    // =========================================================================
    // 1. ZOOM MODE (화면 확대 켜짐): 마우스 조작(이동, 클릭, 드래그) 100% 완전 차단
    // =========================================================================
    if (isZoomMode) {
      // 2 fingers in Zoom Mode: Pinch to Zoom
      if (touchpadTouchCount === 2) {
        lastPinchDist = getPinchDistance(screenTouches);
        isPanning = false;
        return;
      }

      // 1 finger in Zoom Mode: Double-tap to zoom or drag to pan view
      if (touchpadTouchCount === 1) {
        const touch = screenTouches[0];
        activeTouchpadId = touch.identifier;

        // Double-tap zoom when in zoom mode
        const now = Date.now();
        if (now - lastZoomDoubleTap < 300) {
          if (zoomLevel <= 1.01) {
            zoomLevel = 2.0;
            const vpRect = screenViewport.getBoundingClientRect();
            zoomPanX = ((touch.clientX - vpRect.left) / vpRect.width - 0.5) * 50;
            zoomPanY = ((touch.clientY - vpRect.top) / vpRect.height - 0.5) * 50;
            applyZoomTransform();
          } else {
            resetZoom();
          }
          lastZoomDoubleTap = 0;
          isPanning = false;
          return;
        }
        lastZoomDoubleTap = now;

        // Start 1-finger panning (view navigation)
        isPanning = true;
        panStartX = touch.clientX;
        panStartY = touch.clientY;
        panStartZoomX = zoomPanX;
        panStartZoomY = zoomPanY;
        return;
      }

      // In Zoom Mode, all other touches are strictly ignored (NO mouse action!)
      return;
    }

    // =========================================================================
    // 2. NORMAL MODE: 마우스 조작 (확대 모드가 꺼져있을 때만 동작)
    // =========================================================================
    // 3 fingers on screen mirror = middle click
    if (touchpadTouchCount === 3) {
      activeTouchpadId = null;
      sendPayload('mouse_click', { button: 'middle', action: 'click' });
      vibrate(25);
      return;
    }

    // 2 fingers on screen mirror = right click
    if (touchpadTouchCount === 2) {
      activeTouchpadId = null;
      sendPayload('mouse_click', { button: 'right', action: 'click' });
      vibrate(25);
      return;
    }

    if (touchpadTouchCount !== 1) return;

    // Exactly 1 finger on touchpad (completely independent of keyboard touches!)
    const touch = screenTouches[0];
    activeTouchpadId = touch.identifier;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    lastTouchX = touch.clientX;
    lastTouchY = touch.clientY;
    touchStartTime = Date.now();
    hasMoved = false;

    // Direct touch mode: move cursor immediately to touched position
    if (touchMode === 'direct' && isScreenMirrorOn) {
      const coords = getNormalizedCoords(touch.clientX, touch.clientY);
      if (coords) {
        sendPayload('mouse_move_abs', coords);
      }
    }

    // RIGHT-CLICK DRAG or DRAG MODE:
    // If Right-Click is active (clickMode === 'right') OR dragMode is ON:
    // Immediately press down the active button so dragging rotates 3D camera or drags!
    if (clickMode === 'right' || dragMode) {
      const activeBtn = clickMode === 'right' ? 'right' : (clickMode || 'left');
      sendPayload('mouse_click', { button: activeBtn, action: 'down' });
      isDraggingNow = true;
      vibrate(20);
    }

    showRipple(touch.clientX, touch.clientY);
  }, { passive: false });

  touchpad.addEventListener('touchmove', (e) => {
    const screenTouches = getTouchpadTouches(e);
    touchpadTouchCount = screenTouches.length;

    // =========================================================================
    // 1. ZOOM MODE: 마우스 이동 완전 차단 (핀치 줌 및 화면 이동만)
    // =========================================================================
    if (isZoomMode) {
      e.preventDefault();
      // 2 fingers: Pinch to zoom
      if (touchpadTouchCount === 2) {
        const newDist = getPinchDistance(screenTouches);
        if (lastPinchDist > 0) {
          const scale = newDist / lastPinchDist;
          zoomLevel = Math.max(1.0, Math.min(5.0, zoomLevel * scale));
          applyZoomTransform();
        }
        lastPinchDist = newDist;
        return;
      }

      // 1 finger: Pan the magnified screen
      if (touchpadTouchCount === 1 && isPanning) {
        let touch = findTouchById(screenTouches, activeTouchpadId) || screenTouches[0];
        if (zoomLevel > 1.01) {
          const dx = touch.clientX - panStartX;
          const dy = touch.clientY - panStartY;
          const vpRect = screenViewport.getBoundingClientRect();
          zoomPanX = panStartZoomX - (dx / vpRect.width) * 100 / zoomLevel;
          zoomPanY = panStartZoomY - (dy / vpRect.height) * 100 / zoomLevel;
          applyZoomTransform();
        }
        return;
      }

      return; // DO NOT SEND MOUSE MOVES IN ZOOM MODE!
    }

    // =========================================================================
    // 2. NORMAL MODE: 마우스 이동
    // =========================================================================
    if (touchpadTouchCount !== 1) return;
    e.preventDefault();

    let touch = findTouchById(screenTouches, activeTouchpadId);
    if (!touch) {
      touch = screenTouches[0];
      activeTouchpadId = touch.identifier;
    }

    const dx = touch.clientX - lastTouchX;
    const dy = touch.clientY - lastTouchY;

    if (Math.abs(touch.clientX - touchStartX) > 12 || Math.abs(touch.clientY - touchStartY) > 12) {
      hasMoved = true;
      hideTouchpadHint();
    }

    // In Right-Click mode (e.g. 3D camera rotation) or Trackpad mode:
    // ALWAYS send relative mouse_move { dx, dy } with sensitivity!
    if (clickMode === 'right' || touchMode !== 'direct') {
      const dist = Math.hypot(dx, dy);
      let accel = 1.0;
      if (dist > 8) {
        accel = Math.min(2.4, 1.0 + (dist - 8) * 0.04);
      }
      const moveX = dx * accel * trackpadSensitivity;
      const moveY = dy * accel * trackpadSensitivity;
      sendPayload('mouse_move', { dx: moveX, dy: moveY });
    } else {
      // Pure direct touch mode with left click
      const coords = getNormalizedCoords(touch.clientX, touch.clientY);
      if (coords) {
        sendPayload('mouse_move_abs', coords);
      }
    }

    lastTouchX = touch.clientX;
    lastTouchY = touch.clientY;
  }, { passive: false });

  function handleTouchpadTouchEnd(e) {
    const screenTouches = getTouchpadTouches(e);
    touchpadTouchCount = screenTouches.length;

    // =========================================================================
    // 1. ZOOM MODE: 마우스 클릭 완전 차단
    // =========================================================================
    if (isZoomMode) {
      isPanning = false;
      lastPinchDist = 0;
      if (screenTouches.length === 0) {
        activeTouchpadId = null;
      }
      return; // DO NOT SEND ANY MOUSE CLICKS IN ZOOM MODE!
    }

    // =========================================================================
    // 2. NORMAL MODE: 마우스 클릭 / 드래그 해제
    // =========================================================================
    const now = Date.now();
    const duration = now - touchStartTime;

    let endedTrackedTouch = false;
    if (activeTouchpadId !== null && e.changedTouches) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchpadId) {
          endedTrackedTouch = true;
          break;
        }
      }
    } else {
      endedTrackedTouch = true;
    }

    // Release mouse button if dragging was active (Right-click drag or dragMode)
    if (isDraggingNow) {
      const activeBtn = clickMode === 'right' ? 'right' : (clickMode || 'left');
      sendPayload('mouse_click', { button: activeBtn, action: 'up' });
      isDraggingNow = false;
      if (screenTouches.length === 0) activeTouchpadId = null;
      return;
    }

    // Quick tap left-click
    if (duration < 280 && endedTrackedTouch && screenTouches.length === 0) {
      const timeSinceLastTap = now - lastTapTime;

      if (timeSinceLastTap > 0 && timeSinceLastTap < 300) {
        sendPayload('mouse_click', { button: 'left', action: 'double' });
        vibrate([20, 40, 20]);
        lastTapTime = 0;
      } else {
        sendPayload('mouse_click', { button: clickMode, action: 'click' });
        vibrate(20);
        lastTapTime = now;
      }
    }

    if (screenTouches.length === 0) {
      activeTouchpadId = null;
    } else if (endedTrackedTouch) {
      activeTouchpadId = screenTouches[0].identifier;
      lastTouchX = screenTouches[0].clientX;
      lastTouchY = screenTouches[0].clientY;
    }
  }

  touchpad.addEventListener('touchend', handleTouchpadTouchEnd, { passive: false });
  touchpad.addEventListener('touchcancel', handleTouchpadTouchEnd, { passive: false });

  // --------------------------------------------------------------------------
  // Virtual Scroll Wheel Panel
  // --------------------------------------------------------------------------
  function toggleScrollPanel(forceState) {
    isScrollOpen = typeof forceState === 'boolean' ? forceState : !isScrollOpen;
    if (isScrollOpen) {
      scrollPanel.classList.remove('hidden');
      radialBtnScroll.classList.add('active');
    } else {
      scrollPanel.classList.add('hidden');
      radialBtnScroll.classList.remove('active');
    }
    vibrate(15);
  }

  closeScrollBtn.addEventListener('click', () => toggleScrollPanel(false));

  scrollPanel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  wheelTrack.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    if (e.targetTouches.length !== 1) return;
    lastWheelY = e.targetTouches[0].clientY;
  }, { passive: true });

  wheelTrack.addEventListener('touchmove', (e) => {
    e.stopPropagation();
    if (e.targetTouches.length !== 1) return;
    e.preventDefault();

    const currentY = e.targetTouches[0].clientY;
    const dy = currentY - lastWheelY;

    if (Math.abs(dy) >= 6) {
      const amount = -Math.sign(dy) * (Math.abs(dy) / 8);
      sendPayload('mouse_scroll', { amount });
      lastWheelY = currentY;
      vibrate(6);
    }
  }, { passive: false });

  // --------------------------------------------------------------------------
  // Floating Keyboard (Drag, Scale, Opacity)
  // --------------------------------------------------------------------------
  function toggleKeyboard(forceState) {
    isKbOpen = typeof forceState === 'boolean' ? forceState : !isKbOpen;
    if (isKbOpen) {
      floatingKb.classList.remove('hidden');
      radialBtnKb.classList.add('active');
    } else {
      floatingKb.classList.add('hidden');
      radialBtnKb.classList.remove('active');
      if (document.activeElement === pcTextInput) pcTextInput.blur();
      releaseAllKeyboardKeys();
    }
    vibrate(15);
  }

  function releaseAllKeyboardKeys() {
    activeKeyTouches.clear();
    latchedKeys.clear();
    isShiftHolding = false;
    if (shiftHoldTimer) clearTimeout(shiftHoldTimer);
    sendPayload('release_all_keys');
    document.querySelectorAll('.key-btn').forEach((b) => {
      b.classList.remove('pressed', 'latched');
    });
  }

  closeKbBtn.addEventListener('click', () => toggleKeyboard(false));

  // Scale slider
  function setKeyboardScale(scale) {
    const val = Math.max(0.5, Math.min(1.6, parseFloat(scale) || 1.0));
    document.documentElement.style.setProperty('--kb-scale', val);
    if (kbScaleSlider) kbScaleSlider.value = val;
    if (settingsKbScale) settingsKbScale.value = val;
    if (settingsKbScaleVal) settingsKbScaleVal.textContent = `${Math.round(val * 100)}%`;
    try { localStorage.setItem('phonepc_kb_scale', val); } catch (err) {}
  }

  if (kbScaleSlider) {
    kbScaleSlider.addEventListener('input', (e) => setKeyboardScale(e.target.value));
  }
  if (settingsKbScale) {
    settingsKbScale.addEventListener('input', (e) => setKeyboardScale(e.target.value));
  }

  // Width ratio slider
  function setKeyboardWidthRatio(ratio) {
    const val = Math.max(0.6, Math.min(1.6, parseFloat(ratio) || 1.0));
    document.documentElement.style.setProperty('--kb-width-ratio', val);
    if (kbRatioSlider) kbRatioSlider.value = val;
    if (settingsKbRatio) settingsKbRatio.value = val;
    if (settingsKbRatioVal) settingsKbRatioVal.textContent = `${Math.round(val * 100)}%`;
    try { localStorage.setItem('phonepc_kb_ratio', val); } catch (err) {}
  }

  if (kbRatioSlider) {
    kbRatioSlider.addEventListener('input', (e) => setKeyboardWidthRatio(e.target.value));
  }
  if (settingsKbRatio) {
    settingsKbRatio.addEventListener('input', (e) => setKeyboardWidthRatio(e.target.value));
  }

  // Height ratio slider
  function setKeyboardHeightRatio(ratio) {
    const val = Math.max(0.6, Math.min(1.8, parseFloat(ratio) || 1.0));
    document.documentElement.style.setProperty('--kb-height-ratio', val);
    if (kbHeightSlider) kbHeightSlider.value = val;
    if (settingsKbHeight) settingsKbHeight.value = val;
    if (settingsKbHeightVal) settingsKbHeightVal.textContent = `${Math.round(val * 100)}%`;
    try { localStorage.setItem('phonepc_kb_height', val); } catch (err) {}
  }

  if (kbHeightSlider) {
    kbHeightSlider.addEventListener('input', (e) => setKeyboardHeightRatio(e.target.value));
  }
  if (settingsKbHeight) {
    settingsKbHeight.addEventListener('input', (e) => setKeyboardHeightRatio(e.target.value));
  }

  // Opacity slider
  function setKeyboardOpacity(opacity) {
    keyboardOpacity = Math.max(0.25, Math.min(1.0, parseFloat(opacity) || 0.95));
    document.documentElement.style.setProperty('--kb-opacity', keyboardOpacity);
    if (kbOpacitySlider) kbOpacitySlider.value = keyboardOpacity;
    if (settingsKbOpacity) settingsKbOpacity.value = keyboardOpacity;
    if (kbOpacityVal) kbOpacityVal.textContent = `${Math.round(keyboardOpacity * 100)}%`;
    try { localStorage.setItem('phonepc_kb_opacity', keyboardOpacity); } catch (err) {}
  }

  if (kbOpacitySlider) {
    kbOpacitySlider.addEventListener('input', (e) => setKeyboardOpacity(e.target.value));
  }
  if (settingsKbOpacity) {
    settingsKbOpacity.addEventListener('input', (e) => setKeyboardOpacity(e.target.value));
  }

  // Keyboard window dragging
  let activeKbDragTouchId = null;

  kbDragHandle.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    if (e.targetTouches.length !== 1) return;
    isKbDragging = true;
    const touch = e.targetTouches[0];
    activeKbDragTouchId = touch.identifier;
    const rect = floatingKb.getBoundingClientRect();
    kbOffsetLeft = touch.clientX - rect.left;
    kbOffsetTop = touch.clientY - rect.top;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isKbDragging) return;
    const touch = findTouchById(e.touches, activeKbDragTouchId);
    if (!touch) return;
    const newLeft = touch.clientX - kbOffsetLeft;
    const newTop = touch.clientY - kbOffsetTop;

    const maxLeft = window.innerWidth - 60;
    const maxTop = window.innerHeight - 60;

    floatingKb.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
    floatingKb.style.top = `${Math.max(40, Math.min(newTop, maxTop))}px`;
    floatingKb.style.right = 'auto';
    floatingKb.style.margin = '0';
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (!isKbDragging) return;
    if (activeKbDragTouchId !== null && e.changedTouches) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeKbDragTouchId) {
          isKbDragging = false;
          activeKbDragTouchId = null;
          break;
        }
      }
    } else {
      isKbDragging = false;
    }
  }, { passive: true });

  ['touchstart', 'touchend', 'touchcancel'].forEach((evt) => {
    floatingKb.addEventListener(evt, (e) => {
      if (e.target === pcTextInput || e.target === kbScaleSlider || e.target === kbOpacitySlider) return;
      e.stopPropagation();
    }, { passive: false });
  });

  function submitTextInput() {
    const text = pcTextInput.value;
    if (text) {
      sendPayload('text_input', { text });
      pcTextInput.value = '';
      vibrate(20);
    }
  }

  btnSendText.addEventListener('click', submitTextInput);
  pcTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitTextInput();
  });

  // --------------------------------------------------------------------------
  // Smart Shift Key (Short tap = Toggle, Long press = Hold) & Multi-Touch Keys
  // --------------------------------------------------------------------------
  function getKeyFromBtn(btn) {
    if (btn.dataset.hotkey) return { type: 'hotkey', val: btn.dataset.hotkey };
    if (btn.dataset.key) return { type: 'key', val: btn.dataset.key };
    if (btn.dataset.qkey) {
      const qk = btn.dataset.qkey;
      const finalKey = isShiftActive ? qk.toUpperCase() : qk;
      return { type: 'qkey', val: finalKey };
    }
    return null;
  }

  function isModifierKey(k) {
    return ['ctrl', 'alt', 'shift', 'win'].includes(k.toLowerCase());
  }

  function handleShiftTouchStart(btn) {
    shiftTouchStartTime = Date.now();
    isShiftHolding = false;
    btn.classList.add('pressed');

    if (shiftHoldTimer) clearTimeout(shiftHoldTimer);

    // If held for more than 280ms, switch to HOLD mode
    shiftHoldTimer = setTimeout(() => {
      isShiftHolding = true;
      isShiftActive = true;
      btn.classList.add('active');
      sendPayload('key_down', { key: 'shift' });
      updateQwertyLabels();
      vibrate(25);
    }, 280);
  }

  function handleShiftTouchEnd(btn) {
    if (shiftHoldTimer) clearTimeout(shiftHoldTimer);
    const duration = Date.now() - shiftTouchStartTime;

    if (isShiftHolding) {
      // Long press HOLD finished: release Shift
      isShiftHolding = false;
      isShiftActive = false;
      btn.classList.remove('active', 'pressed');
      sendPayload('key_up', { key: 'shift' });
      updateQwertyLabels();
      vibrate(15);
    } else if (duration < 280) {
      // Short press: TOGGLE Shift!
      isShiftActive = !isShiftActive;
      if (isShiftActive) {
        btn.classList.add('active');
        btn.classList.remove('pressed');
        sendPayload('key_down', { key: 'shift' });
        updateQwertyLabels();
      } else {
        btn.classList.remove('active', 'pressed');
        sendPayload('key_up', { key: 'shift' });
        updateQwertyLabels();
      }
      vibrate(15);
    } else {
      btn.classList.remove('pressed');
    }
  }

  function handleKeyTouchStart(e, btn) {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    const touchId = touch.identifier !== undefined ? touch.identifier : 'mouse';

    // Dedicated mouse action key on game keyboard (L-Click / R-Click)
    if (btn.dataset.mouse) {
      const mouseBtn = btn.dataset.mouse;
      btn.classList.add('pressed');
      sendPayload('mouse_click', { button: mouseBtn, action: 'down' });
      activeKeyTouches.set(touchId, { mouseBtn, btn, isMouseBtn: true });
      vibrate(20);
      return;
    }

    // Special Shift handling (Short tap = Toggle, Long press = Hold)
    if (btn.id === 'qwerty-shift-btn' || btn.dataset.key === 'shift') {
      handleShiftTouchStart(btn);
      activeKeyTouches.set(touchId, { key: 'shift', btn, isShiftBtn: true });
      return;
    }

    const keyInfo = getKeyFromBtn(btn);
    if (!keyInfo) return;

    vibrate(15);

    // Pre-made Hotkey combination button (e.g. Ctrl+C, Alt+Tab, Win+D)
    if (keyInfo.type === 'hotkey') {
      const parts = keyInfo.val.split('+');
      const modifiers = parts.slice(0, parts.length - 1);
      const targetKey = parts[parts.length - 1];
      sendPayload('key_press', { key: targetKey, modifiers });
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 180);
      return;
    }

    const key = keyInfo.val;
    const isMod = isModifierKey(key);

    // Modifier double-tap to LATCH (sticky lock for 1-hand usage)
    const now = Date.now();
    if (isMod && (now - (lastModifierTapTimes[key] || 0) < 320)) {
      if (latchedKeys.has(key)) {
        latchedKeys.delete(key);
        btn.classList.remove('latched', 'pressed');
        sendPayload('key_up', { key });
      } else {
        latchedKeys.add(key);
        btn.classList.add('latched');
        sendPayload('key_down', { key });
      }
      lastModifierTapTimes[key] = 0;
      return;
    }
    if (isMod) {
      lastModifierTapTimes[key] = now;
    }

    if (latchedKeys.has(key)) {
      latchedKeys.delete(key);
      btn.classList.remove('latched', 'pressed');
      sendPayload('key_up', { key });
      return;
    }

    // Normal multi-touch press: send key_down and register finger
    btn.classList.add('pressed');
    sendPayload('key_down', { key });
    activeKeyTouches.set(touchId, { key, btn });

    // Auto-release Shift toggle after typing a letter if NOT holding Shift
    if (keyInfo.type === 'qkey' && isShiftActive && !isShiftHolding) {
      isShiftActive = false;
      qwertyShiftBtn?.classList.remove('active');
      sendPayload('key_up', { key: 'shift' });
      updateQwertyLabels();
    }
  }

  function handleKeyTouchEnd(e, btn) {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    const touchId = touch.identifier !== undefined ? touch.identifier : 'mouse';

    if (activeKeyTouches.has(touchId)) {
      const entry = activeKeyTouches.get(touchId);
      activeKeyTouches.delete(touchId);

      if (entry.isMouseBtn) {
        sendPayload('mouse_click', { button: entry.mouseBtn, action: 'up' });
        entry.btn.classList.remove('pressed');
        return;
      }

      if (entry.isShiftBtn) {
        handleShiftTouchEnd(btn);
        return;
      }

      if (!latchedKeys.has(entry.key)) {
        sendPayload('key_up', { key: entry.key });
        entry.btn.classList.remove('pressed');
      }
    }
  }

  function setupKeyMultiTouch(btn) {
    btn.addEventListener('touchstart', (e) => handleKeyTouchStart(e, btn), { passive: false });
    btn.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    btn.addEventListener('touchend', (e) => handleKeyTouchEnd(e, btn), { passive: false });
    btn.addEventListener('touchcancel', (e) => handleKeyTouchEnd(e, btn), { passive: false });

    // Pointer/Mouse support
    btn.addEventListener('mousedown', (e) => {
      if ('ontouchstart' in window) return;
      handleKeyTouchStart(e, btn);
    });
    btn.addEventListener('mouseup', (e) => {
      if ('ontouchstart' in window) return;
      handleKeyTouchEnd(e, btn);
    });
    btn.addEventListener('mouseleave', (e) => {
      if ('ontouchstart' in window) return;
      handleKeyTouchEnd(e, btn);
    });
  }

  function bindAllKeyButtons() {
    document.querySelectorAll('.key-btn').forEach((btn) => {
      setupKeyMultiTouch(btn);
    });
  }

  function updateQwertyLabels() {
    kbLayoutQwerty.querySelectorAll('.qwerty-key[data-qkey]').forEach((btn) => {
      const qk = btn.dataset.qkey;
      if (qk && qk.match(/^[a-z]$/i)) {
        btn.textContent = isShiftActive ? qk.toUpperCase() : qk.toLowerCase();
      }
    });
  }

  // Keyboard layout tab switching
  document.querySelectorAll('.kb-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.kbMode;
      switchKbMode(mode);
    });
  });

  function switchKbMode(mode) {
    kbMode = mode || 'game';
    document.querySelectorAll('.kb-tab').forEach((t) => t.classList.remove('active'));
    document.querySelector(`.kb-tab[data-kb-mode="${kbMode}"]`)?.classList.add('active');

    kbLayoutGame?.classList.add('hidden');
    kbLayoutShortcuts?.classList.add('hidden');
    kbLayoutQwerty?.classList.add('hidden');

    if (kbMode === 'game') {
      kbLayoutGame?.classList.remove('hidden');
    } else if (kbMode === 'shortcuts') {
      kbLayoutShortcuts?.classList.remove('hidden');
    } else {
      kbLayoutQwerty?.classList.remove('hidden');
    }

    try { localStorage.setItem('phonepc_kb_mode', kbMode); } catch (err) {}
  }

  // --------------------------------------------------------------------------
  // Settings Panel & Shortcut Editor
  // --------------------------------------------------------------------------
  function openSettings() {
    settingsModal.classList.remove('hidden');
    if (settingsKbLayout) settingsKbLayout.value = kbMode;
    if (settingsKbScale && kbScaleSlider) {
      settingsKbScale.value = kbScaleSlider.value;
      if (settingsKbScaleVal) settingsKbScaleVal.textContent = `${Math.round(kbScaleSlider.value * 100)}%`;
    }
    if (settingsKbRatio && kbRatioSlider) {
      settingsKbRatio.value = kbRatioSlider.value;
      if (settingsKbRatioVal) settingsKbRatioVal.textContent = `${Math.round(kbRatioSlider.value * 100)}%`;
    }
    if (settingsKbHeight && kbHeightSlider) {
      settingsKbHeight.value = kbHeightSlider.value;
      if (settingsKbHeightVal) settingsKbHeightVal.textContent = `${Math.round(kbHeightSlider.value * 100)}%`;
    }
    if (settingsSensitivity) settingsSensitivity.value = trackpadSensitivity;
    if (sensitivityValue) sensitivityValue.textContent = `${trackpadSensitivity.toFixed(1)}x`;
    if (settingsKbOpacity) settingsKbOpacity.value = keyboardOpacity;
    if (kbOpacityVal) kbOpacityVal.textContent = `${Math.round(keyboardOpacity * 100)}%`;

    renderShortcutEditor();
    checkAppVersion();
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
  }

  if (settingsSensitivity) {
    settingsSensitivity.addEventListener('input', (e) => {
      trackpadSensitivity = parseFloat(e.target.value) || 1.0;
      if (sensitivityValue) sensitivityValue.textContent = `${trackpadSensitivity.toFixed(1)}x`;
      try { localStorage.setItem('phonepc_sensitivity', trackpadSensitivity); } catch (err) {}
    });
  }

  function renderShortcutEditor() {
    shortcutEditorList.innerHTML = '';
    customShortcuts.forEach((sc, idx) => {
      const item = document.createElement('div');
      item.className = 'shortcut-edit-item';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = sc.label;
      labelInput.placeholder = '표시 이름';
      labelInput.dataset.idx = idx;

      const hotkeyInput = document.createElement('input');
      hotkeyInput.type = 'text';
      hotkeyInput.value = sc.hotkey;
      hotkeyInput.placeholder = '예: ctrl+c';
      hotkeyInput.dataset.idx = idx;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove-shortcut';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        customShortcuts.splice(idx, 1);
        renderShortcutEditor();
      });

      item.appendChild(labelInput);
      item.appendChild(hotkeyInput);
      item.appendChild(removeBtn);
      shortcutEditorList.appendChild(item);
    });
  }

  function saveSettings() {
    const items = shortcutEditorList.querySelectorAll('.shortcut-edit-item');
    const newShortcuts = [];
    items.forEach((item) => {
      const inputs = item.querySelectorAll('input');
      const label = inputs[0].value.trim();
      const hotkey = inputs[1].value.trim();
      if (label && hotkey) {
        newShortcuts.push({ label, hotkey });
      }
    });
    customShortcuts = newShortcuts;

    try {
      localStorage.setItem('phonepc_custom_shortcuts', JSON.stringify(customShortcuts));
      localStorage.setItem('phonepc_kb_layout', settingsKbLayout.value);
      localStorage.setItem('phonepc_kb_mode', settingsKbLayout.value);
      localStorage.setItem('phonepc_sensitivity', trackpadSensitivity);
    } catch (e) {}

    const settingsScreenQuality = document.getElementById('settings-screen-quality');
    if (settingsScreenQuality) {
      setQualityPreset(settingsScreenQuality.value, true);
    }

    switchKbMode(settingsKbLayout.value);

    const orientation = settingsOrientation.value;
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock(orientation).catch(() => {});
      }
    } catch (e) {}

    rebuildCustomShortcuts();
    closeSettings();
    vibrate(20);
  }

  function rebuildCustomShortcuts() {
    const row = document.getElementById('custom-shortcuts-row');
    if (!row) return;
    row.innerHTML = '';
    customShortcuts.forEach((sc) => {
      const btn = document.createElement('button');
      btn.className = 'key-btn shortcut-btn';
      btn.dataset.hotkey = sc.hotkey;
      btn.textContent = sc.label;
      setupKeyMultiTouch(btn);
      row.appendChild(btn);
    });
  }

  function loadSettings() {
    try {
      const saved = localStorage.getItem('phonepc_custom_shortcuts');
      if (saved) {
        customShortcuts = JSON.parse(saved);
        rebuildCustomShortcuts();
      }
      const savedLayout = localStorage.getItem('phonepc_kb_layout') || localStorage.getItem('phonepc_kb_mode') || 'game';
      switchKbMode(savedLayout);

      const savedSens = localStorage.getItem('phonepc_sensitivity');
      if (savedSens) {
        trackpadSensitivity = parseFloat(savedSens) || 1.0;
        if (settingsSensitivity) settingsSensitivity.value = trackpadSensitivity;
        if (sensitivityValue) sensitivityValue.textContent = `${trackpadSensitivity.toFixed(1)}x`;
      }
      const savedOpacity = localStorage.getItem('phonepc_kb_opacity');
      if (savedOpacity) {
        setKeyboardOpacity(savedOpacity);
      }
      const savedScale = localStorage.getItem('phonepc_kb_scale');
      if (savedScale) {
        setKeyboardScale(savedScale);
      }
      const savedRatio = localStorage.getItem('phonepc_kb_ratio');
      if (savedRatio) {
        setKeyboardWidthRatio(savedRatio);
      }
      const savedHeight = localStorage.getItem('phonepc_kb_height');
      if (savedHeight) {
        setKeyboardHeightRatio(savedHeight);
      }
      const savedQuality = localStorage.getItem('phonepc_screen_quality') || 'high';
      setQualityPreset(savedQuality, false);
    } catch (e) {}
  }

  if (toggleQualityBtn) {
    toggleQualityBtn.addEventListener('click', () => {
      let next = 'high';
      if (currentQuality === 'high') next = 'ultra';
      else if (currentQuality === 'ultra') next = 'normal';
      else next = 'high';
      setQualityPreset(next, true);
      vibrate(20);
    });
  }

  const settingsScreenQualityEl = document.getElementById('settings-screen-quality');
  if (settingsScreenQualityEl) {
    settingsScreenQualityEl.addEventListener('change', (e) => {
      setQualityPreset(e.target.value, true);
    });
  }

  closeSettingsBtn.addEventListener('click', closeSettings);
  document.querySelector('.settings-overlay')?.addEventListener('click', closeSettings);
  btnAddShortcut.addEventListener('click', () => {
    customShortcuts.push({ label: '', hotkey: '' });
    renderShortcutEditor();
  });
  btnSaveSettings.addEventListener('click', saveSettings);

  // --------------------------------------------------------------------------
  // Rotatable Radial Orbital Menu (Drag to rotate 360° smoothly!)
  // --------------------------------------------------------------------------
  const RADIAL_RADIUS = 96; // px distance from center FAB
  // 5 orbital items spread across comfortable arc
  const radialBaseAngles = [-90, -50, -10, 30, 70]; // degrees
  const radialItemButtons = [
    radialBtnDrag,
    radialBtnScroll,
    radialBtnKb,
    radialBtnSavePc,
    radialBtnSettings
  ];

  function updateRadialItemPositions(isDragging) {
    if (isDragging) {
      radialItems.classList.add('dragging');
    } else {
      radialItems.classList.remove('dragging');
    }

    radialItemButtons.forEach((btn, idx) => {
      if (!btn) return;
      if (!isRadialOpen) {
        btn.style.transform = 'translate(0px, 0px) scale(0.4)';
        return;
      }
      const deg = radialBaseAngles[idx] + radialAngleOffset;
      const rad = deg * Math.PI / 180;
      const x = Math.round(RADIAL_RADIUS * Math.cos(rad));
      const y = Math.round(RADIAL_RADIUS * Math.sin(rad));
      btn.style.transform = `translate(${x}px, ${y}px) scale(1)`;
    });
  }

  function toggleRadialMenu(forceState) {
    isRadialOpen = typeof forceState === 'boolean' ? forceState : !isRadialOpen;

    if (isRadialOpen) {
      radialItems.classList.remove('collapsed');
      radialItems.classList.add('open');
      radialBackdrop.classList.remove('hidden');
      mainMenuFab.classList.add('open');
      document.getElementById('fab-icon').textContent = '✖';
      updateRadialItemPositions(false);
    } else {
      radialItems.classList.remove('open');
      radialItems.classList.add('collapsed');
      radialBackdrop.classList.add('hidden');
      mainMenuFab.classList.remove('open');
      document.getElementById('fab-icon').textContent = '☰';
      updateRadialItemPositions(false);
    }
    vibrate(15);
  }

  // Circular drag-to-rotate handling
  let activeRotTouchId = null;

  function onRadialTouchStart(e) {
    if (!isRadialOpen) return;
    const touch = e.changedTouches ? e.changedTouches[0] : (e.touches ? e.touches[0] : e);
    activeRotTouchId = touch.identifier !== undefined ? touch.identifier : null;
    const fabRect = mainMenuFab.getBoundingClientRect();
    const cx = fabRect.left + fabRect.width / 2;
    const cy = fabRect.top + fabRect.height / 2;

    rotTouchStartX = touch.clientX;
    rotTouchStartY = touch.clientY;
    rotStartTouchAngle = Math.atan2(touch.clientY - cy, touch.clientX - cx) * 180 / Math.PI;
    rotInitialOffset = radialAngleOffset;
    rotHasMoved = false;
    isRotatingRadial = true;
  }

  function onRadialTouchMove(e) {
    if (!isRotatingRadial || !isRadialOpen) return;
    let touch = null;
    if (activeRotTouchId !== null && e.touches) {
      touch = findTouchById(e.touches, activeRotTouchId);
    }
    if (!touch) touch = e.touches ? e.touches[0] : e;
    const fabRect = mainMenuFab.getBoundingClientRect();
    const cx = fabRect.left + fabRect.width / 2;
    const cy = fabRect.top + fabRect.height / 2;

    const moveDist = Math.hypot(touch.clientX - rotTouchStartX, touch.clientY - rotTouchStartY);
    const curAngle = Math.atan2(touch.clientY - cy, touch.clientX - cx) * 180 / Math.PI;
    let delta = curAngle - rotStartTouchAngle;

    if (moveDist > 6 || Math.abs(delta) > 2.5 || rotHasMoved) {
      rotHasMoved = true;
      radialAngleOffset = rotInitialOffset + delta;
      updateRadialItemPositions(true); // immediate transform without CSS delay
      if (e.cancelable) e.preventDefault();
    }
  }

  function onRadialTouchEnd(e) {
    if (!isRotatingRadial) return;
    if (activeRotTouchId !== null && e.changedTouches) {
      let ended = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeRotTouchId) {
          ended = true;
          break;
        }
      }
      if (!ended) return;
    }
    isRotatingRadial = false;
    activeRotTouchId = null;
    radialItems.classList.remove('dragging');

    if (rotHasMoved) {
      // Suppress any accidental click that fires right after rotation drag
      rotSuppressedUntil = Date.now() + 250;
    }
  }

  // Listen for rotation gestures on both backdrop and menu container
  [radialBackdrop, radialMenuContainer].forEach((el) => {
    el.addEventListener('touchstart', onRadialTouchStart, { passive: false });
  });

  window.addEventListener('touchmove', onRadialTouchMove, { passive: false });
  window.addEventListener('touchend', onRadialTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onRadialTouchEnd, { passive: true });

  // Mouse fallback for rotation
  radialBackdrop.addEventListener('mousedown', onRadialTouchStart);
  window.addEventListener('mousemove', onRadialTouchMove);
  window.addEventListener('mouseup', onRadialTouchEnd);

  // FAB button click (toggle open/close)
  mainMenuFab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() < rotSuppressedUntil) return;
    toggleRadialMenu();
  });

  // Backdrop tap (close menu if user tapped without dragging)
  radialBackdrop.addEventListener('click', (e) => {
    if (Date.now() < rotSuppressedUntil || rotHasMoved) return;
    toggleRadialMenu(false);
  });

  // Bind clicks for all 6 radial items
  function bindRadialItemClick(btn, action) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() < rotSuppressedUntil || rotHasMoved) return;
      action();
      toggleRadialMenu(false);
    });
  }

  bindRadialItemClick(radialBtnDrag, () => toggleDragMode());
  bindRadialItemClick(radialBtnScroll, () => toggleScrollPanel());
  bindRadialItemClick(radialBtnKb, () => toggleKeyboard());
  bindRadialItemClick(radialBtnSavePc, () => requestSavePc());
  bindRadialItemClick(radialBtnSettings, () => openSettings());

  // --------------------------------------------------------------------------
  // App Version & 1-Tap Update System (Android APK & Web PWA)
  // --------------------------------------------------------------------------
  let latestApkUrl = 'https://github.com/TM-TOMATO/PhonePC-Remote/releases/latest/download/PhonePC_Remote_v2.2.0.apk';

  function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const p1 = String(v1).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
    const p2 = String(v2).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
      const a = p1[i] || 0;
      const b = p2[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  async function checkAppVersion() {
    try {
      let serverVersion = APP_VERSION;
      let serverBuild = 0;
      let foundUrl = '';

      // 1. Check PC Host if host is known
      const targetHost = serverHost || (location.host && !location.host.includes('localhost') ? location.host : '');
      if (targetHost) {
        const proto = (serverProtocol === 'https:' || location.protocol === 'https:') ? 'https:' : 'http:';
        try {
          const res = await fetch(`${proto}//${targetHost}/api/version?t=${Date.now()}`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            serverVersion = data.version || serverVersion;
            serverBuild = data.build_time || 0;
            foundUrl = `${proto}//${targetHost}/download/apk`;
          }
        } catch (e) {}
      }

      // 2. Check Saved PCs if not found yet
      if (!foundUrl) {
        const savedList = getSavedPcs();
        for (const sp of savedList) {
          if (sp.host) {
            const spProto = (sp.host.includes('trycloudflare.com') || sp.host.includes('https')) ? 'https:' : 'http:';
            try {
              const res = await fetch(`${spProto}//${sp.host}/api/version?t=${Date.now()}`, { cache: 'no-store' });
              if (res.ok) {
                const data = await res.json();
                serverVersion = data.version || serverVersion;
                serverBuild = data.build_time || 0;
                foundUrl = `${spProto}//${sp.host}/download/apk`;
                break;
              }
            } catch (e) {}
          }
        }
      }

      // 3. Check GitHub Releases API for latest APK release
      try {
        const ghRes = await fetch('https://api.github.com/repos/TM-TOMATO/PhonePC-Remote/releases/latest', { cache: 'no-store' });
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          const ghTag = (ghData.tag_name || '').replace(/^v/, '');
          if (ghTag && compareVersions(ghTag, serverVersion) > 0) {
            serverVersion = ghTag;
          }
          const apkAsset = (ghData.assets || []).find((a) => a.name && a.name.endsWith('.apk'));
          if (apkAsset && apkAsset.browser_download_url) {
            if (!foundUrl) foundUrl = apkAsset.browser_download_url;
          }
        }
      } catch (e) {}

      if (foundUrl) {
        latestApkUrl = foundUrl;
      }

      // Display current version
      const isNativeApp = !!(window.AndroidBridge && typeof window.AndroidBridge.downloadAndInstallApk === 'function');
      const currentVer = isNativeApp && window.AndroidBridge.getAppVersionName ? window.AndroidBridge.getAppVersionName() : APP_VERSION;

      if (authAppVersion) {
        authAppVersion.textContent = `PhonePC Remote v${currentVer}${isNativeApp ? ' (Android App)' : ' (Web)'}`;
      }
      if (appCurrentVersion) {
        appCurrentVersion.textContent = `현재 버전: v${currentVer}${isNativeApp ? ' (Android)' : ''}`;
      }

      // Check if update is needed
      const isNewerVer = compareVersions(serverVersion, currentVer) > 0;
      const localBuild = parseInt(localStorage.getItem('phonepc_app_build') || '0', 10);
      const isNewerBuild = localBuild > 0 && serverBuild > localBuild;

      if (isNewerVer || isNewerBuild) {
        if (appUpdateBadge) {
          appUpdateBadge.textContent = `v${serverVersion} 업데이트 있음!`;
          appUpdateBadge.style.background = '#0ea5e9';
        }
        if (btnAuthUpdate) {
          btnAuthUpdate.textContent = `⚡ v${serverVersion} 앱 자동 업데이트!`;
          btnAuthUpdate.style.borderColor = 'var(--accent-cyan)';
          btnAuthUpdate.style.background = 'rgba(6, 182, 212, 0.28)';
          btnAuthUpdate.style.color = '#ffffff';
        }
        if (updateToast) {
          const toastText = updateToast.querySelector('.update-toast-text');
          if (toastText) toastText.textContent = `⚡ 최신 버전(v${serverVersion})이 있습니다!`;
          updateToast.classList.remove('hidden');
        }
      } else {
        if (serverBuild > 0) {
          localStorage.setItem('phonepc_app_build', String(serverBuild));
        }
      }
    } catch (e) {}
  }

  async function performAppUpdate() {
    vibrate([40, 60, 40]);
    const isNativeApp = !!(window.AndroidBridge && typeof window.AndroidBridge.downloadAndInstallApk === 'function');

    if (btnAuthUpdate) btnAuthUpdate.textContent = '⏳ 업데이트 진행 중...';
    if (btnCheckUpdate) btnCheckUpdate.textContent = '⏳ 업데이트 진행 중...';
    if (btnToastUpdate) btnToastUpdate.textContent = '⏳ 다운로드 중...';

    // 1. If running inside native Android App -> Trigger native in-app APK download & system install!
    if (isNativeApp) {
      let apkUrl = latestApkUrl;
      if (!apkUrl) {
        const targetHost = serverHost || location.host;
        if (targetHost && !targetHost.includes('localhost') && !targetHost.includes('127.0.0.1')) {
          const proto = (serverProtocol === 'https:' || location.protocol === 'https:') ? 'https:' : 'http:';
          apkUrl = `${proto}//${targetHost}/download/apk`;
        } else {
          apkUrl = 'https://github.com/TM-TOMATO/PhonePC-Remote/releases/latest/download/PhonePC_Remote_v2.2.0.apk';
        }
      }
      console.log('[AppUpdate] Native Android APK download trigger:', apkUrl);
      window.AndroidBridge.downloadAndInstallApk(apkUrl);
      setTimeout(() => {
        if (btnAuthUpdate) btnAuthUpdate.textContent = '📥 다운로드 완료 대기...';
        if (btnCheckUpdate) btnCheckUpdate.textContent = '📥 다운로드 완료 대기...';
      }, 1500);
      return;
    }

    // 2. If running in web browser / PWA:
    // Clear CacheStorage
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch (e) {}
    }

    // Unregister Service Workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let reg of registrations) {
          await reg.unregister();
        }
      } catch (e) {}
    }

    // Update build time in localStorage
    try {
      const res = await fetch('/api/version?t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();
      if (data.build_time) {
        localStorage.setItem('phonepc_app_build', String(data.build_time));
      }
    } catch (e) {}

    // Force hard reload with unique timestamp
    setTimeout(() => {
      const bustUrl = window.location.origin + window.location.pathname + '?update=' + Date.now();
      window.location.replace(bustUrl);
    }, 250);
  }

  if (btnAuthUpdate) {
    btnAuthUpdate.addEventListener('click', performAppUpdate);
  }

  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', performAppUpdate);
  }

  if (btnToastUpdate) {
    btnToastUpdate.addEventListener('click', performAppUpdate);
  }

  const btnAuthApk = document.getElementById('btn-auth-apk');
  if (btnAuthApk) {
    btnAuthApk.addEventListener('click', (e) => {
      const isNativeApp = !!(window.AndroidBridge && typeof window.AndroidBridge.downloadAndInstallApk === 'function');
      if (isNativeApp) {
        e.preventDefault();
        vibrate(20);
        performAppUpdate();
      } else if (location.protocol === 'file:') {
        e.preventDefault();
        window.open('https://github.com/TM-TOMATO/PhonePC-Remote/releases/latest/download/PhonePC_Remote_v2.2.0.apk', '_blank');
      }
    });
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  bindAllKeyButtons();
  setClickMode('left');
  loadSettings();
  lockPortrait(); // Lock to portrait mode on auth/connection hub
  renderSavedPcs();
  checkUrlAutoConnect();
  checkAppVersion();

})();
