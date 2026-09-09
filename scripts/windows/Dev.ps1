#Requires -Version 5.1
# One-click dev loop: restarts the app when sources change.
. "$PSScriptRoot\_common.ps1"
Ensure-Node
Ensure-Dependencies
Write-Step 'Starting the development watcher...'
Invoke-Npm 'dev'
