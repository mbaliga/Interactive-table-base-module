#!/usr/bin/env bash
# Remove what install-service.sh added. Files, data and logs are left in place.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
source "$(dirname "${BASH_SOURCE[0]}")/app-id.sh"
systemctl disable --now "$APP_ID-hub.service" 2>/dev/null || true
rm -f "/etc/systemd/system/$APP_ID-hub.service"; systemctl daemon-reload
RUN_USER="${SUDO_USER:-root}"; HOME_DIR="$(getent passwd "$RUN_USER" | cut -d: -f6)"
rm -f "$HOME_DIR/.config/autostart/$APP_ID-kiosk.desktop"
echo "Removed $APP_ID-hub and the kiosk autostart. Files, data and logs were left in place."
