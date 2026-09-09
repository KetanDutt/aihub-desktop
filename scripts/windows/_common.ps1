#Requires -Version 5.1
<#
  Shared helpers for the one-click Windows scripts.

  Not meant to be launched directly; the *.ps1 entry points dot-source it.
#>

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
    # scripts/windows/_common.ps1 -> repository root is two levels up.
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Write-Step   { param([string]$Message) Write-Host "[aihub] $Message" -ForegroundColor Cyan }
function Write-Okay   { param([string]$Message) Write-Host "[ ok ] $Message" -ForegroundColor Green }
function Write-WarnMsg{ param([string]$Message) Write-Host "[warn] $Message" -ForegroundColor Yellow }
function Write-Fail   { param([string]$Message) Write-Host "[FAIL] $Message" -ForegroundColor Red }

function Test-Command {
    param([string]$Command)
    return [bool](Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-NodeMajorVersion {
    if (-not (Test-Command 'node')) { return 0 }
    $raw = & node --version 2>$null
    if ($raw -match 'v(\d+)') { return [int]$Matches[1] }
    return 0
}

function Install-Node {
    Write-Step 'Node.js is missing or too old - trying package managers...'

    if (Test-Command 'winget') {
        Write-Step 'winget: installing OpenJS.NodeJS.LTS'
        & winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    }
    elseif (Test-Command 'choco') {
        Write-Step 'Chocolatey: installing nodejs-lts'
        & choco install nodejs-lts -y
    }
    elseif (Test-Command 'scoop') {
        Write-Step 'Scoop: installing nodejs-lts'
        & scoop install nodejs-lts
    }
    else {
        Write-Fail 'No package manager found (winget/choco/scoop).'
        Write-Host 'Please install Node.js 20+ from https://nodejs.org and re-run this script.'
        exit 1
    }

    # Refresh PATH for the current session so a freshly installed node is found.
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath;$env:Path"
}

function Ensure-Node {
    param([int]$Minimum = 20)
    $major = Get-NodeMajorVersion
    if ($major -ge $Minimum) {
        Write-Okay "Node.js $(node --version) detected"
        return
    }
    if ($major -gt 0) {
        Write-WarnMsg "Node.js $(node --version) is older than the required v$Minimum"
    }
    Install-Node
    $major = Get-NodeMajorVersion
    if ($major -lt $Minimum) {
        Write-Fail "Node.js v$Minimum or newer is required (found v$major)."
        Write-Host 'Open a NEW terminal (to reload PATH) and re-run, or install from https://nodejs.org.'
        exit 1
    }
    Write-Okay "Node.js $(node --version) installed"
}

function Test-NodeModulesHealthy {
    $root = Get-RepoRoot
    $electronPkg = Join-Path $root 'node_modules\electron\package.json'
    $jestPkg     = Join-Path $root 'node_modules\jest\package.json'
    return (Test-Path $electronPkg) -and (Test-Path $jestPkg)
}

function Test-ElectronBinary {
    $root = Get-RepoRoot
    return (Test-Path (Join-Path $root 'node_modules\electron\path.txt'))
}

function Ensure-Dependencies {
    $root = Get-RepoRoot
    Push-Location $root
    try {
        if (-not (Test-NodeModulesHealthy)) {
            Write-Step 'Installing npm dependencies (first run can take a minute)...'
            & npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install failed'; exit 1 }
            Write-Okay 'Dependencies installed'
        }
        else {
            Write-Okay 'Dependencies already installed'
        }

        if (-not (Test-ElectronBinary)) {
            Write-Step 'Downloading the Electron runtime...'
            & npm rebuild electron
            if ($LASTEXITCODE -ne 0) { Write-Fail 'Electron runtime download failed'; exit 1 }
            Write-Okay 'Electron runtime ready'
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-Npm {
    param([string]$Script)
    $root = Get-RepoRoot
    Push-Location $root
    try {
        & npm run $Script
        if ($LASTEXITCODE -ne 0) { Write-Fail "npm run $Script failed"; exit 1 }
    }
    finally {
        Pop-Location
    }
}
