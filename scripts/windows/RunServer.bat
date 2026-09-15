@echo off
setlocal EnableExtensions
title AI Hub Desktop - Headless API Server
color 0A

rem ============================================================================
rem  AI Hub Desktop - headless API server (no desktop window)
rem
rem  Double-click this file. It will:
rem    1. Locate the repo (this file lives in scripts\windows)
rem    2. Check / install Node.js 20+ (winget, choco, or scoop)
rem    3. Install npm dependencies + the Electron runtime
rem    4. Start ONLY the local OpenAI-compatible API server
rem
rem  The console stays open and prints the base URL, the API key and a ready
rem  to paste curl example. Press Ctrl+C (or close the window) to stop.
rem
rem  Extra switches are passed through, for example:
rem     RunServer.bat --port 8081 --print-key
rem ============================================================================

cd /d "%~dp0\..\.."
if errorlevel 1 (
    echo [FAIL] Could not change to the project directory.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   AI Hub Desktop  -  Headless API Server
echo  ============================================================
echo.
echo  Project: %CD%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RunServer.ps1" %*
set RC=%ERRORLEVEL%

if not "%RC%"=="0" (
    echo.
    echo [aihub] The API server stopped with exit code %RC%.
    echo         This window stays open so you can read the log.
    echo.
    echo Tips:
    echo   - Another AI Hub instance may already own the port ^(close the app^)
    echo   - Or run: npm run serve -- --port 8081
    echo   - See docs\local-api.md for the endpoint reference
    echo.
    pause
    exit /b %RC%
)

exit /b 0
