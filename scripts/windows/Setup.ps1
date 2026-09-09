#Requires -Version 5.1
# One-click: install/verify Node.js and all dependencies, then run the doctor.
. "$PSScriptRoot\_common.ps1"
Ensure-Node
Ensure-Dependencies
Write-Step 'Running the environment doctor...'
$root = Get-RepoRoot
Push-Location $root
& npm run doctor
Pop-Location
Write-Okay 'Setup complete. Use Run.bat to launch or Build.bat to package.'
