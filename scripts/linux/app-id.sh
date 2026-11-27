#!/usr/bin/env bash
# Sourced by the other scripts: reads the app identity from <release>/app.json (needs Node, which the hub needs anyway).
#   APP_ID   e.g. interactive-table   (names the systemd unit, the autostart entry and the kiosk profile)
#   APP_NAME e.g. Interactive Table
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v node >/dev/null || { echo "Node.js 20.11 or newer is required (https://nodejs.org or your package manager)." >&2; exit 2; }
APP_ID="$(node -e 'try{const a=require(process.argv[1]);process.stdout.write(/^[a-z][a-z0-9-]{1,40}$/.test(a.id)?a.id:"interactive-table")}catch{process.stdout.write("interactive-table")}' "$ROOT/app.json")"
APP_NAME="$(node -e 'try{process.stdout.write(String(require(process.argv[1]).name||"Interactive Table").replace(/[^ -~]/g,""))}catch{process.stdout.write("Interactive Table")}' "$ROOT/app.json")"
