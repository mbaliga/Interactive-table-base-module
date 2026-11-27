// Release smoke test (runs the same on Windows and Linux, and in CI): start the BUILT hub and check everything a visitor touches.
//   node scripts/smoke.mjs [releaseDir]     (default: the folder this script sits in, i.e. the release; in the repo: release/<app id>)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const here = path.resolve(import.meta.dirname, '..');
const appOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'app.json'), 'utf8')); } catch { return null; } };
const rel = path.resolve(process.argv[2] ?? (fs.existsSync(path.join(here, 'hub', 'hub.mjs')) ? here : path.join(here, 'release', appOf(here)?.id ?? 'interactive-table')));
const hubJs = path.join(rel, 'hub', 'hub.mjs');
if (!fs.existsSync(hubJs)) { console.error(`no hub bundle at ${hubJs}; run "pnpm package" first`); process.exit(2); }
const app = appOf(rel);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'table-smoke-'));
const hub = spawn(process.execPath, [hubJs, '--port', '0', '--udp-port', '0', '--data-dir', data, '--offline'], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; hub.stdout.on('data', (d) => (out += d)); hub.stderr.on('data', (d) => (out += d));
const port = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('hub did not start:\n' + out)), 15000); const iv = setInterval(() => { const m = out.match(/table\s+http:\/\/localhost:(\d+)\/table\//); if (m) { clearTimeout(t); clearInterval(iv); res(+m[1]); } }, 100); hub.on('exit', () => rej(new Error('hub exited early:\n' + out))); });
const base = `http://127.0.0.1:${port}`;
const get = async (p, init) => fetch(base + p, { redirect: 'manual', ...init });
const assetsOf = async (html, at) => {
  const refs = [...html.matchAll(/(?:src|href)="(\.?\/?[^"#:]+\.(?:js|css|png|webp|svg|woff2))"/g)].map((m) => m[1]);
  let missing = 0; for (const r of refs) if ((await fetch(new URL(r, base + at))).status !== 200) { missing++; console.log('   missing asset', r); }
  return { n: refs.length, missing };
};
try {
  const h = await (await get('/health')).json(); check('health', h.ok === true && h.tuio.udp === 'listening');
  check('hub reports the app identity from app.json', !app || (h.app?.id === app.id && h.app?.name === app.name), JSON.stringify(h.app));
  const cfg = await (await get('/api/config')).json();
  check('config has a phone URL with ?src=table', /src=table/.test(cfg.phoneUrl), cfg.phoneUrl);
  const tbl = await (await get('/table/')).text();
  check('table page', tbl.includes('id="stage"') && tbl.includes('type="module"'));
  const ta = await assetsOf(tbl, '/table/'); check(`table assets resolve (${ta.n})`, ta.n > 0 && ta.missing === 0);
  const phone = await (await get('/phone/?src=table')).text();
  check('phone page', phone.includes('id="app"') && phone.includes('type="module"'));
  const pa = await assetsOf(phone, '/phone/'); check(`phone assets resolve (${pa.n})`, pa.n > 0 && pa.missing === 0);
  const qr = await (await get('/api/qr.svg')).text();
  const jsQR = require('jsqr');
  const n = +qr.match(/viewBox="0 0 (\d+)/)[1], sc = 6, px = new Uint8ClampedArray(n * sc * n * sc * 4).fill(255);
  for (const m of qr.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) { const [x, y, w] = [+m[1], +m[2], +m[3]]; for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < w * sc; xx++) { const o = ((y * sc + yy) * n * sc + x * sc + xx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; } }
  check('QR code decodes to the phone URL', jsQR(px, n * sc, n * sc)?.data === cfg.phoneUrl);
  check('unknown proxy source is refused', (await get('/proxy/nothing/here')).status === 404);
  check('path traversal is refused', (await get('/table/%2e%2e/hub/hub.mjs')).status !== 200);
} catch (e) { check('smoke run', false, String(e)); }
hub.kill(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(data, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed'); process.exit(failures ? 1 : 0);
