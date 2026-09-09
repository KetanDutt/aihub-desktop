#Requires -Version 5.1
# One-click: install what is needed, then run lint + the test suite.
. "$PSScriptRoot\_common.ps1"
Ensure-Node
Ensure-Dependencies
Invoke-Npm 'check'
Write-Okay 'Lint and tests passed.'
