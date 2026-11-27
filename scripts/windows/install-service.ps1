#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the hub as a start-at-boot task and (optionally) the kiosk browser as a start-at-logon task.
.DESCRIPTION
  Uses Windows Task Scheduler, so no extra software is needed. The hub runs as SYSTEM, restarts itself if it stops,
  and logs to data\logs\hub.log. A Windows Firewall rule lets phones on the visitor Wi-Fi reach the phone pages.
  Task and rule names come from app.json ("<id>-hub", "<id>-kiosk"), so several table apps can live on one PC.
.PARAMETER Port       TCP port the hub listens on (default 8080).
.PARAMETER KioskUser  The account that is auto-logged-on at the table; the browser starts when it signs in.
.PARAMETER NoKiosk    Install only the hub.
.PARAMETER Tuio       Open the table in TUIO mode (physical pucks). Without it the on-screen dock is used.
.PARAMETER IncludePublicProfile  Also open the firewall on networks Windows classifies as "Public". Prefer setting the visitor Wi-Fi to Private.
.PARAMETER DisableSleep  Turn off sleep and screen blanking (recommended for a table).
#>
param(
  [int]$Port = 8080,
  [string]$KioskUser = $env:USERNAME,
  [switch]$NoKiosk,
  [switch]$Tuio,
  [switch]$IncludePublicProfile,
  [switch]$DisableSleep
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'app-id.ps1')
$hubJs = Join-Path $root 'hub\hub.mjs'
if (-not (Test-Path $hubJs)) { throw "Cannot find $hubJs. Run this from an unpacked release folder." }
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'Node.js 20.11 or newer is required (winget install OpenJS.NodeJS.LTS), then open a new PowerShell window.' }
$node = $nodeCmd.Source
if ($node -like "$env:USERPROFILE*") { Write-Warning "Node is installed under your user profile ($node). The SYSTEM account may not be able to run it; install Node for all users." }
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data\logs'), (Join-Path $root 'config\keys') | Out-Null

# API keys (if any) must only be readable by administrators and the service
foreach ($k in Get-ChildItem -Path (Join-Path $root 'config\keys') -Filter *.txt -ErrorAction SilentlyContinue) {
  if ($k.Name -eq 'README.txt') { continue }
  & icacls.exe $k.FullName /inheritance:r /grant:r 'SYSTEM:(R)' 'Administrators:(F)' | Out-Null
  Write-Host "Locked down config\keys\$($k.Name) (SYSTEM and Administrators only)."
}

# hub task: at boot, as SYSTEM, restart on failure
$hubAction = New-ScheduledTaskAction -Execute $node -Argument ('"{0}" --port {1}' -f $hubJs, $Port) -WorkingDirectory $root
$hubTrigger = New-ScheduledTaskTrigger -AtStartup
$hubPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$hubSettings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $HubTask -Description "$AppName hub" -Action $hubAction -Trigger $hubTrigger -Principal $hubPrincipal -Settings $hubSettings -Force | Out-Null
Write-Host "Registered task $HubTask (starts at boot)."

# kiosk task: when the table's user signs in
if (-not $NoKiosk) {
  $kArgs = '"{0}" --hub http://localhost:{1}' -f (Join-Path $root 'scripts\kiosk.mjs'), $Port
  if ($Tuio) { $kArgs += ' --tuio' }
  $kAction = New-ScheduledTaskAction -Execute $node -Argument $kArgs -WorkingDirectory $root
  $kTrigger = New-ScheduledTaskTrigger -AtLogOn -User $KioskUser
  $kPrincipal = New-ScheduledTaskPrincipal -UserId $KioskUser -LogonType Interactive
  $kSettings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $KioskTask -Description "$AppName kiosk browser" -Action $kAction -Trigger $kTrigger -Principal $kPrincipal -Settings $kSettings -Force | Out-Null
  Write-Host "Registered task $KioskTask (starts when $KioskUser signs in)."
}

# firewall: phones must reach the hub for the QR code to work
$ruleName = "$AppName hub (TCP $Port)"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$profiles = if ($IncludePublicProfile) { 'Private,Domain,Public' } else { 'Private,Domain' }
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile $profiles | Out-Null
Write-Host "Firewall: inbound TCP $Port allowed on $profiles networks."

if ($DisableSleep) {
  & powercfg.exe /change standby-timeout-ac 0; & powercfg.exe /change monitor-timeout-ac 0; & powercfg.exe /change hibernate-timeout-ac 0
  Write-Host 'Sleep and screen blanking disabled (on AC power).'
}

Start-ScheduledTask -TaskName $HubTask
Start-Sleep -Seconds 4
try { $h = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 5; Write-Host "Hub is up (version $($h.version))." } catch { Write-Warning "Hub did not answer yet; check $root\data\logs\hub.log" }
try { $c = Invoke-RestMethod -Uri "http://localhost:$Port/api/config" -TimeoutSec 5; Write-Host "QR code opens: $($c.phoneUrl)" } catch { }
Write-Host 'Done. Remove with scripts\windows\uninstall-service.ps1'
