// Start the table app full screen in Chrome/Chromium/Edge, wait for the hub first, and restart the browser if it exits.
//   node scripts/kiosk.mjs [--hub http://localhost:8080] [--tuio] [--browser <path>] [--windowed] [--once] [--dry-run]
//   --tuio  open the table in TUIO mode (physical pucks); without it the on-screen dock is used (simulated input)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, kioskArgs, tableUrl } from './kiosk-lib.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const hub = flag('hub', process.env.HUB_URL || 'http://localhost:8080');
const which = (n) => { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [n], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; };
const browser = findBrowser({ platform: process.platform, env: process.env, which, exists: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }, override: flag('browser', process.env.KIOSK_BROWSER) });
if (!browser) {
  console.error('No Chrome, Chromium or Edge found. Install one, or pass --browser <path> (or set KIOSK_BROWSER).');
  process.exit(2);
}
// app.json sits one folder up from this script both in the repo and in a release; its id names the browser profile
const appId = (() => { try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'app.json'), 'utf8')).id; } catch { return 'interactive-table'; } })();
const userDataDir = path.join(os.tmpdir(), `${appId}-kiosk`);
const args = kioskArgs({ url: tableUrl(hub, { tuio: argv.includes('--tuio') }), userDataDir, platform: process.platform, windowed: argv.includes('--windowed') });
if (argv.includes('--dry-run')) { console.log(JSON.stringify({ browser, args }, null, 2)); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForHub(timeoutS = 120) {
  for (let i = 0; i < timeoutS; i++) {
    try { const r = await fetch(hub.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(2000) }); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

let child, stopping = false;
const stop = () => { stopping = true; try { child?.kill(); } catch { /* gone */ } };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

console.log(`waiting for the hub at ${hub} ...`);
if (!(await waitForHub())) console.error('hub did not answer in 2 minutes; starting the browser anyway (it will retry on reload)');
let quick = 0;
while (!stopping) {
  // fresh profile: no "restore pages" bubble after a crash. On Windows helper processes can hold files for a moment, so retry and never let this stop the loop.
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { console.warn('could not clear the browser profile (continuing):', e.message); }
  console.log(`starting ${browser.kind}: ${browser.path}`);
  const t0 = Date.now();
  child = spawn(browser.path, args, { stdio: 'ignore' });
  const code = await new Promise((r) => { child.on('exit', r); child.on('error', (e) => { console.error('browser failed to start:', e.message); r(-1); }); });
  if (stopping || argv.includes('--once')) break;
  quick = Date.now() - t0 < 5000 ? quick + 1 : 0;
  if (quick >= 5) { console.error('browser keeps exiting immediately; giving up'); process.exit(1); }
  console.log(`browser exited (${code}); restarting in 3 s`);
  await sleep(3000);
}
