# Building a new table app on this base

The base is a working table app (the demo) plus everything around it: input from physical objects (TUIO) and an on-screen
stand-in, a hub that serves the table and the phone pages, the QR code, idle reset, data proxies, kiosk launcher, installers for
Windows and Linux, a packager and tests. A new app replaces the **demo content** and keeps the rest.

## 1. Start the new repository

```bash
git clone <this repo> forts-table && cd forts-table
git remote set-url origin <your new repo>        # keep this repo as `upstream` if you want to pull kit fixes later
pnpm install
pnpm new-app forts-table "Forts Table"           # app.json id and name, page titles
```

## 2. Decide what the objects are

`config/table.config.json` → `objects`: one entry per physical object.

```json
{ "cid": 0, "role": 0, "key": "era", "label": "Era", "rotation": { "meaning": "century", "min": 1500, "max": 1900, "detents": 5 } }
```

- `cid` is the id the hardware reports for that object (find it with the input-debug page, see HARDWARE.md).
- `role` is the app's index for it (0, 1, 2, ...); `key` ties it to a scene.
- `rotation` maps turning the object onto a value: continuous (`detents: null`) from `min` to `max` over one full turn, or N click-stops
  (`detents: 5` gives options 0..4 and values evenly spaced from min to max).

The on-screen dock, the rings and the tests follow this file. Keep `panel` (millimetres and pixels) true to the real screen so
`t.mm()` sizes things correctly.

## 3. Write the scenes

A scene is what one object does (`apps/table/src/kit/types.ts` documents every field):

```ts
import type { Scene } from '../kit';

export const era: Scene = {
  key: 'era', color: '#ffd166', options: ['1500', '1600', '1700', '1800', '1900'],
  place(p, t) { /* object put down: p.x, p.y (stage px), p.angle, p.value, p.option */ },
  move(p, t) { /* moved or turned */ },
  remove(p, t) { /* lifted */ },
  tick(p, t, dt) { /* every frame while placed */ },
  draw(p, t) { t.g.fillRect(p.x - 5, p.y - 5, 10, 10); /* canvas, stage px */ },
  label: (p) => `Year ${p.value}`,     // text in the capsule next to the object
  reset(t) { /* the table is starting over */ },
};
```

Useful on the context `t`: `t.W`/`t.H` (stage size, default 1920 x 1080), `t.mm(50)` (50 mm in stage pixels), `t.puck('other-key')`
(read another object), `t.emit`/`t.on` (app events; the kit emits `puck:place`, `puck:move`, `puck:remove`, `table:reset`,
`idle:attract`), `t.beep()`, `t.release(key)`, `t.hub` (the hub's `/api/config`, including your `ui` settings).

A **background** draws under the scenes (a map, a plan, a timeline) and gets taps on the bare surface and attract-mode steps.

Then wire them in `apps/table/src/main.ts`:

```ts
createTable({ scenes: [era, fort, route], background: fortsMap, attract: { title: 'Place a marker on the map' } });
```

Delete `apps/table/src/demo/` once nothing imports it.

## 4. Phone pages

`apps/phone/src/main.ts` holds a list of activities (one page each). Replace the two demo activities with yours. They run on
the visitor's phone; nothing about them is sent back to the table unless you build that.

## 5. Live data (optional)

Declare each upstream API under `proxies` in `config/hub.config.json` (see the example file), with the exact endpoints allowed.
In the app:

```ts
import { fetchData } from './kit';
const r = await fetchData<Fort[]>('forts-api', 'forts?region=west');
if (r) show(r.data, r.how === 'stale' ? `Saved ${r.at.toLocaleDateString()}` : 'Live');
else show(BUNDLED_SAMPLE, 'Sample');
```

Always ship a bundled sample so the table works with no network, and label which one is on screen.

## 6. Check, package, install

```bash
pnpm dev          # table with hot reload (run `pnpm hub` in another terminal for QR, TUIO and proxies)
pnpm test         # unit + integration
pnpm build && pnpm e2e:all   # real-browser checks (update tools/e2e/table.ts if you changed the objects)
pnpm package      # release/<id>/ and release/<id>-<version>.zip
```

Install on the table PC with `docs/DEPLOY.md` (it ships inside the zip as README.md).

## What to keep, what to change

| Keep (the kit) | Change (your app) |
|---|---|
| `packages/*` (input, bridge, sim, hub) | `app.json`, `config/table.config.json` |
| `apps/table/src/kit/*` | `apps/table/src/main.ts`, your scenes and background (replace `src/demo/`) |
| `scripts/*` (kiosk, installers, packager, smoke) | `apps/phone/src/*` (activities, styles) |
| `tools/e2e/lib.ts`, `tools/e2e/tuio.ts`, `tools/e2e/qr-to-phone.ts` | `tools/e2e/table.ts` assertions about your scenes |

Fix kit bugs in this base repository first, then pull them into each app, so every table benefits.
