@echo off
cd /d "%~dp0"
title PhonePC Remote (Anywhere Tunnel Mode)
echo ===================================================
echo     PhonePC Remote - Anywhere Tunnel Server
echo ===================================================
echo.
echo [*] Starting server with Internet Tunnel...
python server.py --tunnel
if errorlevel 1 (
    echo.
    echo [!] Server stopped with error.
    pause
)
