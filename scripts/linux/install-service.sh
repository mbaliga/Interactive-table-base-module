#!/usr/bin/env bash
# Install the hub as a systemd service (starts at boot, restarts on failure) and, optionally, the kiosk browser autostart.
#   sudo scripts/linux/install-service.sh [--port 8080] [--user <account>] [--no-kiosk] [--tuio]
# The service runs as --user (default: the account that called sudo). Logs: <install>/data/logs/hub.log and  journalctl -u <app id>-hub
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
source "$(dirname "${BASH_SOURCE[0]}")/app-id.sh"
PORT=8080; KIOSK=1; TUIO=''; RUN_USER="${SUDO_USER:-root}"
while [ $# -gt 0 ]; do case "$1" in --port) PORT="$2"; shift 2;; --user) RUN_USER="$2"; shift 2;; --no-kiosk) KIOSK=0; shift;; --tuio) TUIO='--tuio'; shift;; *) echo "unknown option $1" >&2; exit 1;; esac; done
NODE="$(command -v node)"
[ -f "$ROOT/hub/hub.mjs" ] || { echo "Cannot find $ROOT/hub/hub.mjs. Run this from an unpacked release folder." >&2; exit 1; }
UNIT="$APP_ID-hub"
mkdir -p "$ROOT/data/logs" "$ROOT/config/keys"
chown -R "$RUN_USER" "$ROOT/data"
# API keys (if any) readable only by the service account
for k in "$ROOT"/config/keys/*.txt; do [ -f "$k" ] && [ "$(basename "$k")" != "README.txt" ] && chmod 600 "$k" && chown "$RUN_USER" "$k"; done

cat > "/etc/systemd/system/$UNIT.service" <<UNIT
[Unit]
Description=$APP_NAME hub (table app, phone pages, QR, TUIO relay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$ROOT
ExecStart=$NODE $ROOT/hub/hub.mjs --port $PORT
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$ROOT/data

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$UNIT.service"
echo "Service installed: $UNIT (port $PORT)."

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" comment "$APP_NAME hub" && echo "ufw: allowed $PORT/tcp so phones can open the phone pages."
else
  echo "If a firewall is active, allow TCP $PORT so phones on the visitor Wi-Fi can open the phone pages."
fi

if [ "$KIOSK" -eq 1 ]; then
  HOME_DIR="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  AUTOSTART="$HOME_DIR/.config/autostart"
  sudo -u "$RUN_USER" mkdir -p "$AUTOSTART"
  cat > "$AUTOSTART/$APP_ID-kiosk.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=$APP_NAME kiosk
Exec=$ROOT/scripts/linux/start-kiosk.sh --hub http://localhost:$PORT $TUIO
X-GNOME-Autostart-enabled=true
DESK
  chown "$RUN_USER" "$AUTOSTART/$APP_ID-kiosk.desktop"
  echo "Kiosk autostart added for $RUN_USER (starts when that user's desktop session starts; enable auto-login for a table)."
fi
sleep 3
if curl -fsS "http://localhost:$PORT/api/config" >/dev/null 2>&1; then
  echo "Hub is up. QR code opens: $(curl -fsS "http://localhost:$PORT/api/config" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).phoneUrl))')"
else
  echo "Hub did not answer yet; see: journalctl -u $UNIT -n 50"
fi
