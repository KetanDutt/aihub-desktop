#Requires -Version 5.1
<#
.SYNOPSIS
  One-click run for AI Hub Desktop on Windows.

.DESCRIPTION
  Checks and installs Node.js 20+, npm dependencies and the Electron
  runtime, then launches the desktop app (web UI shell inside Electron).

  Prefer double-clicking RUN.bat from File Explorer. This .ps1 is the
  PowerShell entry point used by RUN.bat and can also be run directly:

      powershell -ExecutionPolicy Bypass -File .\RUN.ps1
#>

$ErrorActionPreference = 'Stop'

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $here

$shared = Join-Path $here 'scripts\windows\Run.ps1'
if (Test-Path $shared) {
    & $shared
    exit $LASTEXITCODE
}

# Inline fallback when scripts/windows is unavailable.
$common = Join-Path $here 'scripts\windows\_common.ps1'
if (Test-Path $common) {
    . $common
    Ensure-Node
    Ensure-Dependencies
    Write-Step 'Launching AI Hub Desktop...'
    Invoke-Npm 'start'
    exit 0
}

Write-Host '[FAIL] scripts\windows helpers not found. Run from the repository root.' -ForegroundColor Red
exit 1
