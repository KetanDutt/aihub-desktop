#Requires -Version 5.1
# Remove node_modules and build artefacts.
. "$PSScriptRoot\_common.ps1"
Write-Step 'Cleaning build output and dependencies...'
Push-Location (Get-RepoRoot)
node scripts/clean.js --deps
Pop-Location
Write-Okay 'Cleaned.'
