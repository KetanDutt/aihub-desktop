#Requires -Version 5.1
<#
  One-click: verify toolchain + dependencies, then launch the app
  (web UI shell inside the Electron desktop window).
#>
. "$PSScriptRoot\_common.ps1"

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '   AI Hub Desktop  -  One-Click Run' -ForegroundColor Cyan
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

Ensure-Node
Ensure-Dependencies

Write-Step 'Quick environment check...'
$root = Get-RepoRoot
Push-Location $root
try {
    & npm run doctor
    if ($LASTEXITCODE -ne 0) {
        Write-WarnMsg 'Doctor reported problems - attempting launch anyway.'
    }
}
finally {
    Pop-Location
}

Write-Step 'Launching AI Hub Desktop (close the app window to stop)...'
Write-Host ''
Invoke-Npm 'start'
