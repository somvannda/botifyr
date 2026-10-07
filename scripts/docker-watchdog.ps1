<#
.SYNOPSIS
  Keeps the Botifyr Docker stack (postgres/cloud/web/admin) healthy.

.DESCRIPTION
  Checks the cloud health endpoint. If it is down, the script verifies the
  Docker engine and, when needed, restarts Docker Desktop, brings the stack
  back up, and re-checks. It is idempotent and cheap when everything is
  healthy, so it is safe to run on a schedule (every few minutes).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/docker-watchdog.ps1

.EXAMPLE
  # Register a task that runs it every 5 minutes at logon:
  schtasks /Create /TN BotifyrDockerWatchdog /SC MINUTE /MO 5 /F `
    /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"G:\Developments\botifyr.xyz\scripts\docker-watchdog.ps1\""
#>
[CmdletBinding()]
param(
  [string]$HealthUrl = "http://localhost:8787/health",
  [string]$RepoDir = "",
  [string]$LogPath = (Join-Path $env:TEMP "botifyr-docker-watchdog.log"),
  [int]$EngineWaitSeconds = 240,
  [switch]$Quiet
)

# $PSScriptRoot is not reliable inside the param block on Windows PowerShell,
# so resolve the repo directory here instead.
if ([string]::IsNullOrWhiteSpace($RepoDir)) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $RepoDir = Split-Path -Parent $scriptDir
}

function Write-Log([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  try { Add-Content -Path $LogPath -Value $line -ErrorAction Stop } catch {}
  if (-not $Quiet) { Write-Host $line }
}

function Test-Cloud {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 6
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Test-Engine {
  docker info *> $null 2>&1
  return ($LASTEXITCODE -eq 0)
}

function Restart-DockerDesktop {
  Write-Log "docker engine unavailable - restarting Docker Desktop"
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'com\.docker|docker-sandbox|Docker Desktop|docker' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  wsl --terminate docker-desktop 2>&1 | Out-Null
  Start-Sleep -Seconds 3

  $exe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  if (Test-Path $exe) {
    Start-Process $exe
  } else {
    Write-Log "Docker Desktop.exe not found at $exe"
    return $false
  }

  $steps = [math]::Ceiling($EngineWaitSeconds / 5)
  for ($i = 1; $i -le $steps; $i++) {
    if (Test-Engine) {
      Write-Log "docker engine ready after $($i * 5)s"
      return $true
    }
    Start-Sleep -Seconds 5
  }
  Write-Log "docker engine did not come back within ${EngineWaitSeconds}s"
  return $false
}

function Start-Stack {
  Push-Location $RepoDir
  try {
    # postgres first, then the rest, to avoid the cloud racing the database.
    docker compose up -d postgres 2>&1 | Out-Null
    Start-Sleep -Seconds 8
    docker compose up -d 2>&1 | Out-Null
  } finally {
    Pop-Location
  }
}

if (Test-Cloud) {
  Write-Log "ok - cloud healthy"
  exit 0
}

Write-Log "cloud is DOWN ($HealthUrl)"
if (-not (Test-Engine)) {
  if (-not (Restart-DockerDesktop)) { exit 1 }
}
Start-Stack

for ($i = 0; $i -lt 12; $i++) {
  if (Test-Cloud) {
    Write-Log "recovered - cloud healthy"
    exit 0
  }
  Start-Sleep -Seconds 5
}

Write-Log "cloud still down after the recovery attempt"
exit 1
