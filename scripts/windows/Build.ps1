#Requires -Version 5.1
# One-click: verify toolchain, run lint+tests, then build the Windows installer.
. "$PSScriptRoot\_common.ps1"
Ensure-Node
Ensure-Dependencies
Write-Step 'Running lint and tests...'
Invoke-Npm 'check'
Write-Step 'Building the NSIS installer...'
Invoke-Npm 'build:win'
$dist = Join-Path (Get-RepoRoot) 'dist'
Write-Okay "Build finished. Installers are in: $dist"
Get-ChildItem $dist -Filter '*.exe' | ForEach-Object { Write-Host "  $($_.Name)" }
