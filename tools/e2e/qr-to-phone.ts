// The visitor flow: the QR badge is always on the table; DECODE it from a screenshot, open that URL on an emulated phone, and check
// the phone pages load from the hub with no external requests, then play one activity.
//   pnpm e2e:qr     (needs `pnpm build`)
import { createRequire } from 'node:module';
import { check, devices, finish, launch, startHub, watchErrors } from './lib';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const decode = (buf: Buffer) => { const png = PNG.sync.read(buf); return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data as string | undefined; };

const srv = await startHub('0.0.0.0');
const info = srv.hub.info();
const hubHost = new URL(info.phoneUrl).host;
console.log(`hub on :${srv.port}, QR should carry ${info.phoneUrl} (${info.phoneUrlSource})`);
const browser = await launch();
try {
  const desk = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const table = await desk.newPage(); const tableErrors = watchErrors(table);
  await table.goto(`http://127.0.0.1:${srv.port}/table/?dev=1`);
  await table.waitForSelector('#qrbadge.on img', { timeout: 10000 });
  await table.waitForFunction(() => { const i = document.querySelector('#qrbadge img') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; });
  const bb = (await table.locator('#qrbadge .qbi').boundingBox())!, stage = (await table.locator('#stage').boundingBox())!;
  check('the QR badge is on screen without pressing anything (bottom-left)', bb.x < stage.x + stage.width * 0.25 && bb.y > stage.y + stage.height * 0.7, JSON.stringify(bb));
  const fromBadge = decode(await table.locator('#qrbadge .qbi').screenshot());
  check('the badge decodes to the hub phone URL', fromBadge === info.phoneUrl, fromBadge ?? 'no code');
  // someone is using the table: the badge must stay visible and uncovered
  await table.evaluate(() => { const t = (window as any).__table; for (let r = 0; r < 6; r++) t.place(r, 0.15 + r * 0.14, 0.5, 0); });
  await table.waitForTimeout(500);
  const during = await table.evaluate(() => { const b = document.getElementById('qrbadge')!; const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(top); });
  check('the badge stays uncovered with every puck placed', during);
  await table.click('#qrbadge'); await table.waitForSelector('#qr.on .qimg img');
  await table.waitForFunction(() => { const i = document.querySelector('#qr .qimg img') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; });
  const decoded = decode(await table.locator('#qr .qimg').screenshot());
  check('tapping the badge opens the large code, which decodes to the same URL (?src=table)', decoded === info.phoneUrl && /[?&]src=table/.test(decoded ?? ''), decoded);
  const text = await table.locator('#qr .qt').innerText();
  check('the dialog shows the real address', text.includes(hubHost), text.replace(/\n/g, ' | '));
  await table.click('#qx');
  check('no table page errors', tableErrors.length === 0, tableErrors.join(' | '));

  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await phone.newPage(); const errs = watchErrors(p);
  const hosts = new Set<string>(); p.on('request', (r: any) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: */ } });
  const resp = await p.goto(decoded!, { waitUntil: 'load' });
  check('the phone gets the phone page (HTTP 200)', resp?.status() === 200, String(resp?.status()));
  await p.waitForSelector('#menu .card');
  check('the phone page lists its activities and shows the app name from the hub', (await p.locator('#menu .card').count()) >= 2 && (await p.locator('#name').textContent()) === info.app.name);
  check('it knows it was opened from the table', (await p.locator('#foot').textContent()) === 'Opened from the table');
  await p.locator('#menu .card').first().tap();
  await p.locator('#go').tap(); for (let i = 0; i < 5; i++) await p.locator('#go').tap();
  check('an activity starts and responds to taps', (await p.locator('#n').textContent()) === '5', await p.locator('#n').textContent());
  await p.waitForTimeout(500);
  check('every request went to the hub (no CDN, no fonts from elsewhere)', [...hosts].every((h) => h === hubHost), [...hosts].join(','));
  check('no phone page errors', errs.length === 0, errs.join(' | '));
  await phone.close(); await desk.close();
} catch (e) { check('qr-to-phone run', false, String((e as Error).stack ?? e)); }
await browser.close(); await srv.stop();
finish();
