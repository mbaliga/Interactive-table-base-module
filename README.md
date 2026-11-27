# Interactive table base

The foundation for interactive-table apps: a touch table with physical objects (pucks) that people place and turn, a companion
page on visitors' phones opened from a QR code on the table, and everything needed to install it on a **Windows or Linux** PC
and leave it running. Build a new app by replacing the demo scenes (see **[docs/NEW-APP.md](docs/NEW-APP.md)**).

```
 objects ──TUIO/UDP──► hub ──ws /tuio──► table app (Chrome kiosk)       phone ──QR──► hub /phone/
                        │                  └ tracker (debounce, smoothing) → scenes
                        └── /proxy/<source>/ ──► data APIs (allow-listed, keys stay on the hub, cached for offline)
```

## Quick start

```bash
pnpm install
pnpm hub                 # the hub on :8080 (table, phone pages, QR, data proxies, TUIO relay); prints the address the QR carries
pnpm dev                 # the table with hot reload on :5173 (proxies /api, /proxy, /phone, /tuio to the hub)
pnpm sim run all         # scripted TUIO objects to UDP 3333 (open the table with ?source=tuio)
pnpm test                # unit + integration (real UDP / WebSocket / HTTP on localhost)
pnpm build               # dist/table, dist/phone, dist/hub/hub.mjs
pnpm e2e:all             # real-browser checks: dock gestures + idle reset, TUIO through the hub, QR -> phone
pnpm package             # release/<id>/ and release/<id>-<version>.zip  (Node 20.11+ is all the table PC needs)
pnpm smoke               # start the packaged hub and check what a visitor touches
```

The table opens in **simulated mode**: a dock of on-screen pucks along the bottom (drag one out to place it, drag its knob or use
the wheel or arrow keys to turn it, drag it back to lift it). `?source=tuio` reads real objects through the hub instead; `&dev=1`
adds the raw input panel and `window.__table`.

Install on a table PC: **[docs/DEPLOY.md](docs/DEPLOY.md)** (ships in the release zip as README.md). New hardware:
**[docs/HARDWARE.md](docs/HARDWARE.md)**.

## Layout

| Path | What |
|---|---|
| `app.json` | The app's id, name and version: names the release, the services, the kiosk profile (`pnpm new-app` sets it) |
| `config/table.config.json` | Panel size, sensor calibration, tracker tuning, and the objects (cid → role → scene key, rotation range) |
| `config/hub.config.example.json` | Hub settings and data-proxy sources (keys go in `config/keys/`, never in this file) |
| `apps/table/src/kit` | The table kit: stage scaling, input path, puck rings and labels, on-screen dock, QR badge, idle reset, dev panel |
| `apps/table/src/demo` | Demo scenes and background: **replace these** for a new app |
| `apps/table/input-debug.html` | Raw touches and objects on a plain surface, for calibrating a new table |
| `apps/phone` | The phone companion page (activities list), served at `/phone/` |
| `packages/input` | Input contract, calibration transform, tracker (removal debounce, one-euro smoothing, angle unwrapping) |
| `packages/bridge` | TUIO 1.1 over OSC/UDP decoder and WebSocket relay |
| `packages/sim` | TUIO simulator, scripted sessions, record and replay |
| `packages/hub` | The hub: static files, QR code, data proxies, TUIO relay, config, LAN address detection |
| `scripts` | Kiosk launcher, Windows (Task Scheduler) and Linux (systemd) installers, packager, smoke test, `new-app` |
| `tools/e2e` | Browser end-to-end checks against the built apps through the real hub |

## Licence

All rights reserved. No licence is granted; see [LICENSE](LICENSE).
