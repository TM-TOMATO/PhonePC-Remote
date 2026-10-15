import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  PanResponder,
  Animated,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Vibration,
  Platform,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function App() {
  const [serverIp, setServerIp] = useState('192.168.0.2:8080');
  const [connected, setConnected] = useState(false);
  const [ping, setPing] = useState(null);

  // Controller states
  const [clickMode, setClickMode] = useState('left'); // 'left' or 'right'
  const [dragMode, setDragMode] = useState(false);
  const [isScrollOpen, setIsScrollOpen] = useState(false);
  const [isKbOpen, setIsKbOpen] = useState(false);
  const [isRadialOpen, setIsRadialOpen] = useState(false);
  const [kbScale, setKbScale] = useState(1.0);
  const [textInputVal, setTextInputVal] = useState('');

  // Floating Keyboard Position
  const kbPan = useRef(new Animated.ValueXY({ x: 16, y: 70 })).current;

  // Refs for tracking
  const wsRef = useRef(null);
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const touchStartRef = useRef({ time: 0, x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const hasMovedRef = useRef(false);
  const isDraggingNowRef = useRef(false);
  const dragModeRef = useRef(dragMode);
  dragModeRef.current = dragMode;
  const clickModeRef = useRef(clickMode);
  clickModeRef.current = clickMode;

  // Wheel tracking
  const lastWheelYRef = useRef(0);

  // --------------------------------------------------------------------------
  // WebSocket Connection
  // --------------------------------------------------------------------------
  const connectWs = () => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {}
    }

    try {
      const url = `ws://${serverIp.trim()}/ws`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        Vibration.vibrate(30);
      };

      ws.onclose = () => {
        setConnected(false);
        setPing(null);
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'pong') {
            setPing(Date.now() - data.time);
          }
        } catch (err) {}
      };

      wsRef.current = ws;
    } catch (err) {
      setConnected(false);
    }
  };

  useEffect(() => {
    connectWs();
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping', payload: { time: Date.now() } }));
      }
    }, 2500);

    return () => {
      clearInterval(pingInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [serverIp]);

  const sendPayload = (type, payload = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  };

  // --------------------------------------------------------------------------
  // Main Touchpad PanResponder
  // --------------------------------------------------------------------------
  const touchpadPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          // 2-finger tap -> Right click
          sendPayload('mouse_click', { button: 'right', action: 'click' });
          Vibration.vibrate(20);
          return;
        }

        const touch = touches[0];
        lastTouchRef.current = { x: touch.pageX, y: touch.pageY };
        touchStartRef.current = { time: Date.now(), x: touch.pageX, y: touch.pageY };
        hasMovedRef.current = false;

        if (dragModeRef.current) {
          sendPayload('mouse_click', { button: 'left', action: 'down' });
          isDraggingNowRef.current = true;
          Vibration.vibrate(25);
        }
      },
      onPanResponderMove: (evt) => {
        const touch = evt.nativeEvent.touches[0];
        if (!touch) return;

        const dx = touch.pageX - lastTouchRef.current.x;
        const dy = touch.pageY - lastTouchRef.current.y;

        if (Math.abs(touch.pageX - touchStartRef.current.x) > 4 || Math.abs(touch.pageY - touchStartRef.current.y) > 4) {
          hasMovedRef.current = true;
        }

        const dist = Math.hypot(dx, dy);
        let accel = 1.0;
        if (dist > 8) {
          accel = Math.min(2.4, 1.0 + (dist - 8) * 0.04);
        }

        sendPayload('mouse_move', { dx: dx * accel, dy: dy * accel });

        lastTouchRef.current = { x: touch.pageX, y: touch.pageY };
      },
      onPanResponderRelease: (evt) => {
        const now = Date.now();
        const duration = now - touchStartRef.current.time;

        if (dragModeRef.current) {
          if (isDraggingNowRef.current) {
            sendPayload('mouse_click', { button: 'left', action: 'up' });
            isDraggingNowRef.current = false;
          }
          return;
        }

        if (!hasMovedRef.current && duration < 280) {
          const timeSinceLastTap = now - lastTapRef.current;
          if (timeSinceLastTap > 0 && timeSinceLastTap < 300) {
            // Double Tap -> Double Click!
            sendPayload('mouse_click', { button: 'left', action: 'double' });
            Vibration.vibrate([15, 30, 15]);
            lastTapRef.current = 0;
          } else {
            // Single Tap
            sendPayload('mouse_click', { button: clickModeRef.current, action: 'click' });
            Vibration.vibrate(15);
            lastTapRef.current = now;
          }
        }
      },
    })
  ).current;

  // --------------------------------------------------------------------------
  // Keyboard Draggable PanResponder
  // --------------------------------------------------------------------------
  const kbPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        kbPan.setOffset({
          x: kbPan.x._value,
          y: kbPan.y._value,
        });
        kbPan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: kbPan.x, dy: kbPan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        kbPan.flattenOffset();
      },
    })
  ).current;

  // --------------------------------------------------------------------------
  // Right Scroll Wheel PanResponder
  // --------------------------------------------------------------------------
  const wheelPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        lastWheelYRef.current = evt.nativeEvent.pageY;
      },
      onPanResponderMove: (evt) => {
        const currentY = evt.nativeEvent.pageY;
        const dy = currentY - lastWheelYRef.current;
        if (Math.abs(dy) >= 6) {
          const amount = -Math.sign(dy) * (Math.abs(dy) / 8);
          sendPayload('mouse_scroll', { amount });
          lastWheelYRef.current = currentY;
          Vibration.vibrate(5);
        }
      },
    })
  ).current;

  // Text send
  const submitText = () => {
    if (textInputVal) {
      sendPayload('text_input', { text: textInputVal });
      setTextInputVal('');
      Vibration.vibrate(15);
    }
  };

  const pressKey = (key, modifiers = []) => {
    sendPayload('key_press', { key, modifiers });
    Vibration.vibrate(15);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />

      {/* Top Header & Connection Bar */}
      <View style={styles.topBar}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, connected ? styles.dotGreen : styles.dotRed]} />
          <Text style={styles.statusText}>{connected ? '연결됨' : '연결안됨'}</Text>
          {ping !== null && <Text style={styles.pingText}>{ping}ms</Text>}
        </View>

        <View style={styles.ipContainer}>
          <TextInput
            style={styles.ipInput}
            value={serverIp}
            onChangeText={setServerIp}
            placeholder="IP:Port"
            placeholderTextColor="#64748b"
          />
          <TouchableOpacity style={styles.reconnectBtn} onPress={connectWs}>
            <Text style={styles.reconnectBtnText}>재연결</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.topToggles}>
          <TouchableOpacity
            style={[styles.toggleBtn, clickMode === 'left' && styles.toggleBtnActive]}
            onPress={() => { setClickMode('left'); Vibration.vibrate(15); }}
          >
            <Text style={[styles.toggleBtnText, clickMode === 'left' && styles.toggleBtnTextActive]}>L</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toggleBtn, clickMode === 'right' && styles.toggleBtnActive]}
            onPress={() => { setClickMode('right'); Vibration.vibrate(15); }}
          >
            <Text style={[styles.toggleBtnText, clickMode === 'right' && styles.toggleBtnTextActive]}>R</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toggleBtn, dragMode && styles.dragBtnActive]}
            onPress={() => { setDragMode(!dragMode); Vibration.vibrate(20); }}
          >
            <Text style={[styles.toggleBtnText, dragMode && styles.dragBtnTextActive]}>
              ✋ {dragMode ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Touchpad Area */}
      <View style={styles.touchpad} {...touchpadPanResponder.panHandlers}>
        <View style={styles.hintBox} pointerEvents="none">
          <Text style={styles.hintIcon}>👆</Text>
          <Text style={styles.hintTitle}>터치하여 마우스 조작</Text>
          <Text style={styles.hintSub}>빠르게 2번 탭: 더블클릭 | 두 손가락 탭: 우클릭</Text>
        </View>
      </View>

      {/* Right Scroll Wheel Panel */}
      {isScrollOpen && (
        <View style={styles.scrollPanel}>
          <TouchableOpacity style={styles.closePanelBtn} onPress={() => setIsScrollOpen(false)}>
            <Text style={styles.closeBtnText}>✖</Text>
          </TouchableOpacity>
          <Text style={styles.wheelGuide}>▲ 위로</Text>
          <View style={styles.wheelTrack} {...wheelPanResponder.panHandlers}>
            <Text style={styles.wheelThumb}>📜</Text>
          </View>
          <Text style={styles.wheelGuide}>▼ 아래로</Text>
        </View>
      )}

      {/* Floating Draggable & Resizable Keyboard */}
      {isKbOpen && (
        <Animated.View
          style={[
            styles.floatingKb,
            {
              transform: [
                { translateX: kbPan.x },
                { translateY: kbPan.y },
                { scale: kbScale },
              ],
            },
          ]}
        >
          {/* Header & Drag Handle */}
          <View style={styles.kbHeader} {...kbPanResponder.panHandlers}>
            <Text style={styles.kbDragTitle}>🖐️ 잡고 이동</Text>
            <View style={styles.scaleRow}>
              <TouchableOpacity
                onPress={() => setKbScale(Math.max(0.7, kbScale - 0.1))}
                style={styles.scaleBtn}
              >
                <Text style={styles.scaleBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.scaleLabel}>{Math.round(kbScale * 100)}%</Text>
              <TouchableOpacity
                onPress={() => setKbScale(Math.min(1.3, kbScale + 0.1))}
                style={styles.scaleBtn}
              >
                <Text style={styles.scaleBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setIsKbOpen(false)} style={styles.closePanelBtn}>
              <Text style={styles.closeBtnText}>✖</Text>
            </TouchableOpacity>
          </View>

          {/* Keyboard Body */}
          <View style={styles.kbBody}>
            {/* Native Text Input */}
            <View style={styles.textRow}>
              <TextInput
                style={styles.textInput}
                value={textInputVal}
                onChangeText={setTextInputVal}
                placeholder="글자 입력 후 전송..."
                placeholderTextColor="#64748b"
                onSubmitEditing={submitText}
              />
              <TouchableOpacity style={styles.sendBtn} onPress={submitText}>
                <Text style={styles.sendBtnText}>전송</Text>
              </TouchableOpacity>
            </View>

            {/* Special Keys */}
            <View style={styles.kbRow}>
              {['esc', 'tab', 'win', 'alt', 'ctrl', 'shift', 'del'].map((k) => (
                <TouchableOpacity key={k} style={styles.keyBtn} onPress={() => pressKey(k)}>
                  <Text style={styles.keyText}>{k.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Arrows & Enter */}
            <View style={styles.kbRow}>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('left')}>
                <Text style={styles.keyText}>◀</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('up')}>
                <Text style={styles.keyText}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('down')}>
                <Text style={styles.keyText}>▼</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('right')}>
                <Text style={styles.keyText}>▶</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.keyBtn, styles.wideKey]} onPress={() => pressKey('enter')}>
                <Text style={styles.keyText}>Enter</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('backspace')}>
                <Text style={styles.keyText}>Bksp</Text>
              </TouchableOpacity>
            </View>

            {/* Shortcuts */}
            <View style={styles.kbRow}>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('c', ['ctrl'])}>
                <Text style={styles.keyText}>Ctrl+C</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('v', ['ctrl'])}>
                <Text style={styles.keyText}>Ctrl+V</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('z', ['ctrl'])}>
                <Text style={styles.keyText}>Ctrl+Z</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('tab', ['alt'])}>
                <Text style={styles.keyText}>Alt+Tab</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('d', ['win'])}>
                <Text style={styles.keyText}>Win+D</Text>
              </TouchableOpacity>
            </View>

            {/* Volume */}
            <View style={styles.kbRow}>
              <TouchableOpacity style={[styles.keyBtn, styles.mediaKey]} onPress={() => pressKey('volumedown')}>
                <Text style={styles.keyText}>🔉 볼륨-</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.keyBtn, styles.mediaKey]} onPress={() => pressKey('volumeup')}>
                <Text style={styles.keyText}>🔊 볼륨+</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.keyBtn, styles.mediaKey]} onPress={() => pressKey('volumemute')}>
                <Text style={styles.keyText}>🔇 음소거</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.keyBtn} onPress={() => pressKey('space')}>
                <Text style={styles.keyText}>Space</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Radial Orbital Floating Action Menu */}
      <View style={styles.radialContainer}>
        {isRadialOpen && (
          <View style={styles.radialItems}>
            <TouchableOpacity
              style={[styles.radialItem, { bottom: 100, left: 10 }, dragMode && styles.dragBtnActive]}
              onPress={() => { setDragMode(!dragMode); setIsRadialOpen(false); }}
            >
              <Text style={styles.radialIcon}>✋</Text>
              <Text style={styles.radialLabel}>드래그</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.radialItem, { bottom: 85, left: 75 }, isScrollOpen && styles.toggleBtnActive]}
              onPress={() => { setIsScrollOpen(!isScrollOpen); setIsRadialOpen(false); }}
            >
              <Text style={styles.radialIcon}>📜</Text>
              <Text style={styles.radialLabel}>스크롤휠</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.radialItem, { bottom: 35, left: 105 }, isKbOpen && styles.toggleBtnActive]}
              onPress={() => { setIsKbOpen(!isKbOpen); setIsRadialOpen(false); }}
            >
              <Text style={styles.radialIcon}>⌨️</Text>
              <Text style={styles.radialLabel}>키보드</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.radialItem, { bottom: -20, left: 95 }, clickMode === 'right' && styles.toggleBtnActive]}
              onPress={() => { setClickMode('right'); setIsRadialOpen(false); }}
            >
              <Text style={styles.radialIcon}>🖱️</Text>
              <Text style={styles.radialLabel}>우클릭</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.radialItem, { bottom: -60, left: 45 }, clickMode === 'left' && styles.toggleBtnActive]}
              onPress={() => { setClickMode('left'); setIsRadialOpen(false); }}
            >
              <Text style={styles.radialIcon}>🖱️</Text>
              <Text style={styles.radialLabel}>좌클릭</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.fabBtn}
          onPress={() => { setIsRadialOpen(!isRadialOpen); Vibration.vibrate(15); }}
        >
          <Text style={styles.fabText}>{isRadialOpen ? '✖' : '☰'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  topBar: {
    height: 54,
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    zIndex: 50,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: '#10b981',
  },
  dotRed: {
    backgroundColor: '#ef4444',
  },
  statusText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  pingText: {
    color: '#64748b',
    fontSize: 10,
  },
  ipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  ipInput: {
    color: '#f8fafc',
    fontSize: 11,
    paddingVertical: 3,
    paddingHorizontal: 6,
    width: 105,
  },
  reconnectBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  reconnectBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  topToggles: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.25)',
    borderColor: '#06b6d4',
  },
  toggleBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  toggleBtnTextActive: {
    color: '#06b6d4',
  },
  dragBtnActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.3)',
    borderColor: '#f97316',
  },
  dragBtnTextActive: {
    color: '#f97316',
  },
  touchpad: {
    flex: 1,
    backgroundColor: '#0b0f19',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hintBox: {
    alignItems: 'center',
    opacity: 0.25,
  },
  hintIcon: {
    fontSize: 36,
    marginBottom: 6,
  },
  hintTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  hintSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 4,
  },
  scrollPanel: {
    position: 'absolute',
    top: 60,
    right: 0,
    bottom: 0,
    width: 68,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    zIndex: 60,
  },
  closePanelBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 11,
  },
  wheelGuide: {
    color: '#06b6d4',
    fontSize: 10,
    fontWeight: '700',
  },
  wheelTrack: {
    flex: 1,
    width: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wheelThumb: {
    fontSize: 22,
  },
  floatingKb: {
    position: 'absolute',
    width: SCREEN_WIDTH - 32,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 70,
    elevation: 8,
  },
  kbHeader: {
    height: 38,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  kbDragTitle: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scaleBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleBtnText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  scaleLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  kbBody: {
    padding: 8,
    gap: 6,
  },
  textRow: {
    flexDirection: 'row',
    gap: 6,
  },
  textInput: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    color: '#ffffff',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sendBtn: {
    backgroundColor: '#06b6d4',
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnText: {
    color: '#042f2e',
    fontSize: 12,
    fontWeight: '700',
  },
  kbRow: {
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'space-between',
  },
  keyBtn: {
    flex: 1,
    height: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wideKey: {
    flex: 1.4,
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
    borderColor: '#3b82f6',
  },
  mediaKey: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: '#10b981',
  },
  keyText: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '700',
  },
  radialContainer: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    zIndex: 100,
  },
  fabBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#0ea5e9',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#0ea5e9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  fabText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  radialItems: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 1,
    height: 1,
  },
  radialItem: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  radialIcon: {
    fontSize: 16,
  },
  radialLabel: {
    color: '#94a3b8',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
  },
});
