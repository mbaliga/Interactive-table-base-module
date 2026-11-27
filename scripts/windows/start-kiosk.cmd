@echo off
rem Open the table app full screen (Chrome, or Edge if Chrome is not installed). Extra arguments go to kiosk.mjs, e.g. --windowed
setlocal
pushd "%~dp0..\.."
where node >nul 2>nul || (echo Node.js 20.11 or newer is required. & popd & exit /b 2)
node scripts\kiosk.mjs %*
popd
