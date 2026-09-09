#Requires -Version 5.1
# One-click: verify toolchain + dependencies, then launch the app.
. "$PSScriptRoot\_common.ps1"
Ensure-Node
Ensure-Dependencies
Write-Step 'Launching AI Hub Desktop (close this window to stop logging)...'
Invoke-Npm 'start'
