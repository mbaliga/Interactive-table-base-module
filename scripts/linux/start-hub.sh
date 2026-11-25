#!/usr/bin/env bash
# Start the hub (serves the table app, the phone pages and the QR code; relays the table's TUIO; proxies configured data sources).
# Works from any folder. Extra arguments go to the hub, e.g.  ./start-hub.sh --port 9000
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/app-id.sh"
cd "$ROOT"
exec node hub/hub.mjs "$@"
