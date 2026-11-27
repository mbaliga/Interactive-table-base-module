// The table in TUIO mode, served BY THE HUB: physical objects arrive as UDP TUIO, are relayed over ws /tuio, debounced and smoothed
// by the tracker, and drive the same scenes. Uses the simulator's scripted sessions (flicker, return within 100/400 ms, rotation).
//   pnpm e2e:tuio   (needs `pnpm build`)
import { TuioSender, scenarios } from '@itable/sim';
import { check, finish, launch, sleep, startHub, watchErrors } from './lib';

const srv = await startHub();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = watchErrors(page);
const st = () => page.evaluate(() => (window as any).__table.state());
try {
  await page.goto(`${srv.base}/table/?source=tuio&dev=1&idle=12`);
  await page.waitForFunction(() => (window as any).__table?.input?.tuio?.state === 'open', null, { timeout: 15000 });
  check('the table in TUIO mode connects to /tuio on the hub by itself', true);
  check('no on-screen dock in TUIO mode', !(await page.locator('#dock').isVisible()));
  // count place/remove per role from the app's own event bus
  await page.evaluate(() => { const t = (window as any).__table; const c = (window as any).__c = { p: [0, 0, 0, 0, 0, 0], r: [0, 0, 0, 0, 0, 0] }; t.on('puck:place', (p: any) => c.p[p.role]++); t.on('puck:remove', (p: any) => c.r[p.role]++); });
  const counts = () => page.evaluate(() => (window as any).__c);
  const zero = () => page.evaluate(() => { const c = (window as any).__c; c.p.fill(0); c.r.fill(0); });
  const run = async (name: string) => { const s = new TuioSender({ port: srv.udpPort, fps: 60 }); s.start(); await zero(); await scenarios[name]!.run(s); await sleep(400); await s.stop(); return counts(); };

  // 1. two objects follow UDP
  const s = new TuioSender({ port: srv.udpPort, fps: 60 }); s.start();
  s.putObject(1, 3, 0.55, 0.45, 1.2); s.putObject(2, 5, 0.3, 0.6, 0);
  await sleep(700);
  let now = await st();
  check('objects with cid 3 and 5 place the probe and pin-b', now[3].on && now[5].on && !now[0].on && Math.abs(now[3].x - 0.55) < 0.02, JSON.stringify(now.map((x: any) => x.on)));
  const h = (await (await fetch(srv.base + '/health')).json()) as any;
  check('hub /health counts the TUIO packets and the connected table', h.tuio.packets > 10 && h.tuio.clients === 1, `packets=${h.tuio.packets} clients=${h.tuio.clients}`);
  s.putObject(9, 42, 0.5, 0.5, 0); await sleep(300);
  check('an object with an unknown cid is ignored', (await st()).filter((p: any) => p.on).length === 2);
  s.dropObject(1); s.dropObject(2); s.dropObject(9); await sleep(700);
  check('lifting the objects lifts the pucks', (await st()).every((p: any) => !p.on));
  await s.stop();

  // 2. debounce: dropouts shorter than the hold time never reach the app
  let c = await run('flicker');
  check('flicker: 8 dropouts, the selector is placed once and removed once', c.p[1] === 1 && c.r[1] === 1, JSON.stringify(c));
  c = await run('return-100');
  check('return within 100 ms: one placement', c.p[2] === 1 && c.r[2] === 1, JSON.stringify(c));
  c = await run('return-400');
  check('return after 400 ms: two placements', c.p[2] === 2 && c.r[2] === 2, JSON.stringify(c));

  // 3. rotation across the 0/360 seam and detent snapping
  const r = new TuioSender({ port: srv.udpPort, fps: 60 }); r.start();
  r.putObject(20, 1, 0.5, 0.5, (130 * Math.PI) / 180); await sleep(500);
  check('a detent object snaps to the nearest option (130 -> 120 degrees)', (await st())[1].angle === 120 && (await st())[1].option === 1);
  r.putObject(21, 0, 0.3, 0.3, (350 * Math.PI) / 180); await sleep(500);
  const angles: number[] = [];
  for (let a = 350; a <= 370; a += 2) { r.putObject(21, 0, 0.3, 0.3, ((a % 360) * Math.PI) / 180); await sleep(60); angles.push((await st())[0].angle); }
  const jumps = angles.slice(1).map((a, i) => Math.abs(((a - angles[i]! + 540) % 360) - 180));
  check('turning through the 0/360 seam never jumps', jumps.every((j) => j < 20), angles.map((a) => a.toFixed(0)).join(','));

  // 4. idle: a resting puck's sensor jitter must not keep the table awake; after the reset it stays ignored until lifted
  await page.evaluate(() => (window as any).__table.reset()); r.dropObject(20); r.dropObject(21); await sleep(400);
  r.putObject(30, 3, 0.5, 0.5, 0); await sleep(400);
  const t0 = Date.now();
  while (Date.now() - t0 < 16000 && !(await page.evaluate(() => (window as any).__table.idle.attract))) { r.putObject(30, 3, 0.5 + (Math.random() - 0.5) * 0.002, 0.5, 0); await sleep(100); }
  now = await st();
  check('a resting, jittering object does not stop the idle reset; its puck is released', (await page.evaluate(() => (window as any).__table.idle.attract)) && !now[3].on);
  r.putObject(30, 3, 0.52, 0.5, 0.1); await sleep(400);
  check('the released object stays ignored while it is still down', !(await st())[3].on);
  r.dropObject(30); await sleep(500); r.putObject(31, 3, 0.5, 0.5, 0); await sleep(500);
  check('lifted and placed again, it works again (and ends the attract screen)', (await st())[3].on && !(await page.evaluate(() => (window as any).__table.idle.attract)));
  r.dropObject(31); await sleep(300); await r.stop();
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { check('tuio e2e run', false, String((e as Error).stack ?? e)); }
await browser.close(); await srv.stop();
finish();
