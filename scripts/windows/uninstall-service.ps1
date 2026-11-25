#Requires -RunAsAdministrator
# Remove what install-service.ps1 added. Files, data and logs are left in place.
param([int]$Port = 8080)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'app-id.ps1')
foreach ($t in $KioskTask, $HubTask) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $t -Confirm:$false; Write-Host "Removed task $t" }
}
Get-NetFirewallRule -DisplayName "$AppName hub (TCP $Port)" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Removed. Files, data and logs were left in place.'
