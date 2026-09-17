#Requires -Version 5.1
<#
  One-click Windows build.

  Verifies the toolchain, then hands over to the cross-platform builder in
  scripts/one-click-build.js, which refreshes the cached service catalogue,
  runs lint + tests and produces the NSIS installer in dist/.

  Extra flags are forwarded, e.g.:
      .\Build.ps1 --fast      # skip lint + tests
      .\Build.ps1 --dir       # unpacked build, no installer
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$BuildArgs)

. "$PSScriptRoot\_common.ps1"

Ensure-Node
Ensure-Dependencies

$root = Get-RepoRoot
Write-Step 'Starting the one-click build...'

& node (Join-Path $root 'scripts\one-click-build.js') @BuildArgs
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

$dist = Join-Path $root 'dist'
if (Test-Path $dist) {
    Write-Okay "Build finished. Installers are in: $dist"
    Get-ChildItem $dist -Include '*.exe','*.msi' -File -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "  $($_.Name)" }
}
