@echo off
setlocal
title AI Hub Desktop - Run
rem Always operate from the repository root, even when double-clicked.
cd /d "%~dp0..\.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run.ps1"
set RC=%ERRORLEVEL%

if not "%RC%"=="0" (
    echo.
    echo [aihub] Run failed with exit code %RC%. This window stays open so you can read the log.
    pause
    exit /b %RC%
)
exit /b 0
