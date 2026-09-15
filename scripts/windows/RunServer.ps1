#Requires -Version 5.1
<#
  Headless: verify toolchain + dependencies, then start ONLY the local
  OpenAI-compatible API server. No desktop window, no tray, no UI.

  Usage from PowerShell:
    .\RunServer.ps1                    # start on the configured port
    .\RunServer.ps1 -Port 8081         # start on a specific port
    .\RunServer.ps1 -PrintKey          # print the API key in the clear
    .\RunServer.ps1 -- --port 8081     # any extra switch goes to the app

  Anything after `--` is forwarded verbatim to `npm run serve`.
#>
param(
    [int]$Port = 0,
    [switch]$PrintKey,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

. "$PSScriptRoot\_common.ps1"

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '   AI Hub Desktop  -  Headless API Server' -ForegroundColor Cyan
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

Ensure-Node
Ensure-Dependencies

$root = Get-RepoRoot
Push-Location $root
try {
    Write-Step 'Quick environment check...'
    & npm run doctor
    if ($LASTEXITCODE -ne 0) {
        Write-WarnMsg 'Doctor reported problems - attempting to start anyway.'
    }

    $npmArgs = @('run', 'serve')
    $forwarded = @()
    if ($ExtraArgs) {
        $forwarded = $ExtraArgs | Where-Object { $_ -ne '--' }
    }
    if ($Port -gt 0) { $forwarded += @('--port', "$Port") }
    if ($PrintKey)   { $forwarded += '--print-key' }
    if ($forwarded.Count -gt 0) { $npmArgs += '--'; $npmArgs += $forwarded }

    Write-Step 'Starting the local API server (no desktop window)...'
    Write-Host '         Press Ctrl+C in this window to stop it.' -ForegroundColor DarkGray
    Write-Host ''

    & npm @npmArgs
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Fail "The API server exited with code $code"
        Pop-Location
        exit $code
    }
}
finally {
    if ((Get-Location).Path -ne $root) { Pop-Location }
}
