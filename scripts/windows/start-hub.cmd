@echo off
rem Start the hub (serves the table app, the phone pages and the QR code; relays the table's TUIO; proxies configured data sources).
rem Works from any folder: paths are relative to this file. Extra arguments are passed to the hub, e.g.  start-hub.cmd --port 9000
setlocal
pushd "%~dp0..\.."
where node >nul 2>nul || (echo Node.js 20.11 or newer is required. Install it with:  winget install OpenJS.NodeJS.LTS & popd & exit /b 2)
node hub\hub.mjs %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
