@echo off
rem Hub in a minimised window, then the kiosk browser. Handy for a first test; use install-service.ps1 for the real installation.
setlocal
start "table hub" /min cmd /c "%~dp0start-hub.cmd"
call "%~dp0start-kiosk.cmd" %*
