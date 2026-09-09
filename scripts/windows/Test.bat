@echo off
setlocal
title AI Hub Desktop - Test
rem Always operate from the repository root, even when double-clicked.
cd /d "%~dp0..\.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test.ps1"
set RC=%ERRORLEVEL%

if not "%RC%"=="0" (
    echo.
    echo [aihub] Test failed with exit code %RC%. This window stays open so you can read the log.
    pause
    exit /b %RC%
)

echo.
echo [aihub] Done. Press any key to close this window.
pause >nul
exit /b 0
