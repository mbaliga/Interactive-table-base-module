# Bringing up a new table (hardware)

Every answer below becomes a value in `config/table.config.json`, not a code change.

| # | Question | Config key it sets |
|---|---|---|
| 1 | Panel size in millimetres, native resolution, orientation, host OS and GPU | `panel.*` (default: 55-inch 16:9, 1218 x 685 mm, 3840 x 2160) |
| 2 | TUIO 1.1, TUIO 2.0, or native OS touch as well? If native touch exists, Pointer Events already work for fingers; objects still need TUIO | `link.*` |
| 3 | How are objects recognised (printed fiducials, capacitive tags, IR footprints)? Which `cid` does each report? Stable across sessions? | `objects[].cid` |
| 4 | UDP host and port of the TUIO source | `link.udpHost`, `link.udpPort` (and the hub's `udp.port`) |
| 5 | Max simultaneous touches, latency, palm rejection in the driver? | `tracker.*` tuning |
| 6 | Is the sensor mirrored or rotated relative to the display (which edge is "top")? | `transform.flipX/flipY/rotate/crop` |

## Day-one checklist on the real table

1. Start the hub (`pnpm hub`, or `scripts/*/start-hub` from a release) and open `/table/input-debug.html?source=tuio` on the table.
2. Place each object: note the `cid` it reports; set `objects[].cid` in config.
3. Check orientation with a finger at each corner and an object turned clockwise; fix `transform`.
4. Open `/table/?source=tuio&dev=1`; the >_ button shows every raw event. Lift and replace objects quickly: the tracker holds a
   removal for `tracker.removeHoldMs` (200 ms) so a sensor dropout does not count as a lift.
5. Record a representative session as a regression fixture: `pnpm sim record recordings/day1.jsonl --ws ws://127.0.0.1:8080/tuio --seconds 120`.
6. Watch `/health` on the hub for TUIO packet counts.

## Without hardware

- `pnpm sim run all` sends scripted TUIO (six objects, rotation through the seam, flicker, quick returns, fingers) to UDP 3333.
- `pnpm sim replay recordings/day1.jsonl` replays a recording as a WebSocket source.
- The table's default mode is the on-screen dock, driven through the same pipeline as TUIO.
