@echo off
setlocal EnableExtensions
title AI Hub Desktop - One-Click Run
color 0B

rem ============================================================================
rem  AI Hub Desktop — one-click run for Windows
rem
rem  Double-click this file. It will:
rem    1. Locate the repo (this file lives at the root)
rem    2. Check / install Node.js 20+ (winget, choco, or scoop)
rem    3. Install npm dependencies + the Electron runtime
rem    4. Launch the desktop app (web UI shell inside Electron)
rem
rem  No terminal knowledge required. On failure the window stays open.
rem ============================================================================

cd /d "%~dp0"
if errorlevel 1 (
    echo [FAIL] Could not change to the project directory.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   AI Hub Desktop  -  One-Click Run
echo  ============================================================
echo.
echo  Project: %CD%
echo.

rem Prefer the shared PowerShell helpers under scripts\windows when present.
if exist "%~dp0scripts\windows\Run.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\Run.ps1"
    set RC=%ERRORLEVEL%
) else (
    rem Fallback: inline bootstrap if the scripts folder is missing.
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ErrorActionPreference='Stop';" ^
      "function Test-Cmd($c){ [bool](Get-Command $c -EA SilentlyContinue) };" ^
      "function NodeMajor { if(-not (Test-Cmd node)){return 0}; $r=& node --version 2>$null; if($r -match 'v(\d+)'){[int]$Matches[1]}else{0} };" ^
      "Write-Host '[aihub] Checking Node.js...' -ForegroundColor Cyan;" ^
      "$m=NodeMajor; if($m -lt 20){" ^
      "  Write-Host '[aihub] Installing Node.js LTS...' -ForegroundColor Cyan;" ^
      "  if(Test-Cmd winget){ winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements }" ^
      "  elseif(Test-Cmd choco){ choco install nodejs-lts -y }" ^
      "  elseif(Test-Cmd scoop){ scoop install nodejs-lts }" ^
      "  else { Write-Host '[FAIL] Install Node.js 20+ from https://nodejs.org' -ForegroundColor Red; exit 1 };" ^
      "  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path;" ^
      "  if((NodeMajor) -lt 20){ Write-Host '[FAIL] Node.js still missing. Open a NEW terminal and re-run.' -ForegroundColor Red; exit 1 }" ^
      "};" ^
      "Write-Host ('[ ok ] Node.js ' + (node --version)) -ForegroundColor Green;" ^
      "if(-not (Test-Path 'node_modules\electron\package.json')){" ^
      "  Write-Host '[aihub] Installing npm dependencies (first run can take a minute)...' -ForegroundColor Cyan;" ^
      "  npm install --no-audit --no-fund; if($LASTEXITCODE -ne 0){exit 1}" ^
      "};" ^
      "if(-not (Test-Path 'node_modules\electron\path.txt')){" ^
      "  Write-Host '[aihub] Downloading Electron runtime...' -ForegroundColor Cyan;" ^
      "  npm rebuild electron; if($LASTEXITCODE -ne 0){exit 1}" ^
      "};" ^
      "Write-Host '[aihub] Launching AI Hub Desktop...' -ForegroundColor Cyan;" ^
      "npm start; exit $LASTEXITCODE"
    set RC=%ERRORLEVEL%
)

if not "%RC%"=="0" (
    echo.
    echo [aihub] Run failed with exit code %RC%.
    echo         This window stays open so you can read the log.
    echo.
    echo Tips:
    echo   - Install Node.js 20+ from https://nodejs.org and re-run
    echo   - Or double-click scripts\windows\Setup.bat first
    echo   - See docs\troubleshooting.md for common fixes
    echo.
    pause
    exit /b %RC%
)

exit /b 0
