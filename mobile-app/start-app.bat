@echo off
cd /d "%~dp0"
title PhonePC Remote Mobile App (Expo)
echo ===================================================
echo     PhonePC Remote - Mobile App (Expo)
echo ===================================================
echo.
echo [*] Installing dependencies if needed...
call npm install --silent
echo.
echo [*] Starting Expo dev server...
echo [!] Open Expo Go app on your phone and scan the QR code!
call npx expo start
if errorlevel 1 (
    echo.
    echo [!] App failed to start.
    pause
)
