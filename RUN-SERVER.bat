@echo off
setlocal EnableExtensions
title AI Hub Desktop - Headless API Server
color 0A

rem ============================================================================
rem  AI Hub Desktop - headless API server (no desktop window)
rem
rem  Double-click this file. It will:
rem    1. Locate the repo (this file lives at the root)
rem    2. Check / install Node.js 20+ (winget, choco, or scoop)
rem    3. Install npm dependencies + the Electron runtime
rem    4. Start ONLY the local OpenAI-compatible API server
rem
rem  The console stays open and prints the base URL, the API key and a
rem  ready-to-paste curl example. Press Ctrl+C (or close the window) to stop.
rem
rem  Extra switches are passed straight through, for example:
rem     RUN-SERVER.bat --port 8081 --print-key
rem ============================================================================

cd /d "%~dp0"
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

if exist "%~dp0scripts\windows\RunServer.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\RunServer.ps1" -- %*
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
      "Write-Host '[aihub] Starting the headless API server (Ctrl+C to stop)...' -ForegroundColor Cyan;" ^
      "npm run serve; exit $LASTEXITCODE"
    set RC=%ERRORLEVEL%
)

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
