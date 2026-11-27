# Dot-sourced by the other scripts: reads the app identity from <release>\app.json.
#   $AppId    e.g. interactive-table   (names the scheduled tasks, the firewall rule and the kiosk profile)
#   $AppName  e.g. Interactive Table
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$AppId = 'interactive-table'; $AppName = 'Interactive Table'
$appJson = Join-Path $root 'app.json'
if (Test-Path $appJson) {
  try {
    $a = Get-Content -Raw -Path $appJson | ConvertFrom-Json
    if ($a.id -match '^[a-z][a-z0-9-]{1,40}$') { $AppId = $a.id }
    if ($a.name) { $AppName = ($a.name -replace '[^ -~]', '') }
  } catch { Write-Warning "Could not read $appJson; using the default app id." }
}
$HubTask = "$AppId-hub"
$KioskTask = "$AppId-kiosk"
