#!/usr/bin/env bash
# Open the table app full screen. Run it inside the table's desktop session. Extra arguments go to kiosk.mjs (--tuio, --windowed, --hub URL).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/app-id.sh"
# a table should never blank or sleep (X11; harmless if unavailable)
if [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null; then xset s off -dpms s noblank || true; fi
cd "$ROOT"
exec node scripts/kiosk.mjs "$@"
