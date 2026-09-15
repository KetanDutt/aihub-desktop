#Requires -Version 5.1
<#
.SYNOPSIS
  Headless API server for AI Hub Desktop on Windows.

.DESCRIPTION
  Checks and installs Node.js 20+, npm dependencies and the Electron runtime,
  then starts ONLY the local OpenAI-compatible API server: no desktop window,
  no tray, no UI.

  Prefer double-clicking RUN-SERVER.bat from File Explorer. This .ps1 is the
  PowerShell entry point used by RUN-SERVER.bat and can also be run directly:

      powershell -ExecutionPolicy Bypass -File .\RUN-SERVER.ps1
      powershell -ExecutionPolicy Bypass -File .\RUN-SERVER.ps1 -Port 8081 -PrintKey

  The server stays in the foreground; Ctrl+C stops it.
#>
param(
    [int]$Port = 0,
    [switch]$PrintKey,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $here

$shared = Join-Path $here 'scripts\windows\RunServer.ps1'
if (Test-Path $shared) {
    $sharedArgs = @()
    if ($Port -gt 0) { $sharedArgs += @('-Port', $Port) }
    if ($PrintKey) { $sharedArgs += '-PrintKey' }
    if ($ExtraArgs) { $sharedArgs += $ExtraArgs }
    & $shared @sharedArgs
    exit $LASTEXITCODE
}

# Inline fallback when scripts/windows is unavailable.
$common = Join-Path $here 'scripts\windows\_common.ps1'
if (Test-Path $common) {
    . $common
    Ensure-Node
    Ensure-Dependencies
    Write-Step 'Starting the headless API server (Ctrl+C to stop)...'
    Invoke-Npm 'serve'
    exit 0
}

Write-Host '[FAIL] scripts\windows helpers not found. Run from the repository root.' -ForegroundColor Red
exit 1
