@echo off
chcp 65001 > nul
cd /d "%~dp0"
title PhonePC Remote - Python Host

echo ========================================================
echo   📱 PhonePC Remote - Python 호스트 실행 프로그램
echo ========================================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] 파이썬(Python)이 시스템에 설치되어 있지 않거나 PATH에 없습니다.
    echo     Python을 설치한 후 다시 실행해 주세요: https://www.python.org
    echo.
    pause
    exit /b 1
)

echo [*] PhonePC Remote 호스트를 시작합니다...
python main.py

if %errorlevel% neq 0 (
    echo.
    echo [!] 프로그램이 오류로 종료되었습니다.
    echo     필수 패키지 자동 설치를 시도합니다...
    pip install -r requirements.txt
    echo.
    echo [*] 다시 실행합니다...
    python main.py
    pause
)
