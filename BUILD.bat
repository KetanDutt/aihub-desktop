@echo off
setlocal EnableExtensions
title AI Hub Desktop - One-Click Build
color 0B

rem ============================================================================
rem  AI Hub Desktop - one-click build for Windows
rem
rem  Double-click this file. It will:
rem    1. Check / install Node.js 20+ and the npm dependencies
rem    2. Refresh the service catalogue and cached icons
rem    3. Run lint + tests
rem    4. Build the Windows installer into dist\
rem
rem  On failure the window stays open so the log is readable.
rem ============================================================================

cd /d "%~dp0"
if errorlevel 1 (
    echo [FAIL] Could not change to the project directory.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   AI Hub Desktop  -  One-Click Build
echo  ============================================================
echo.
echo  Project: %CD%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\Build.ps1" %*
set RC=%ERRORLEVEL%

if not "%RC%"=="0" (
    echo.
    echo [aihub] Build failed with exit code %RC%.
    pause
    exit /b %RC%
)

echo.
echo [aihub] Installers are in the dist folder. Press any key to close.
pause >nul
exit /b 0
