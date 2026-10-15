@echo off
cd /d "%~dp0"
title PhonePC Remote

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ========================================================
    echo [ERROR] Python is not installed or not in system PATH.
    echo Please install Python: https://www.python.org
    echo ========================================================
    echo.
    pause
    exit /b 1
)

python main.py %*
if %errorlevel% neq 0 (
    echo.
    echo [*] Checking and installing dependencies...
    pip install -r requirements.txt
    echo.
    echo [*] Restarting PhonePC Remote...
    python main.py %*
    pause
)
