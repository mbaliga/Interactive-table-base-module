// Shared helpers for the browser e2e scripts: a real hub serving the BUILT apps (dist/), a Chromium, and PASS/FAIL reporting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHub, loadConfig, type HubHandle } from '@itable/hub';

const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');

/** Chromium: $CHROMIUM_PATH, a pre-installed browser, or Playwright's own (after `pnpm exec playwright install chromium`). */
export function chromiumPath(): string | undefined {
  return process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
}
export const launch = () => chromium.launch({ executablePath: chromiumPath(), args: ['--disable-gpu'] });

let failures = 0;
export const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function finish(): never { console.log(failures ? `\n${failures} FAILED` : '\nall passed'); process.exit(failures ? 1 : 0); }

/** Start the real hub on free ports over dist/ (run `pnpm build` first). */
export async function startHub(host = '127.0.0.1'): Promise<{ hub: HubHandle; port: number; udpPort: number; base: string; stop(): Promise<void> }> {
  const webRoot = path.resolve(process.env.WEB_ROOT ?? 'dist');
  for (const d of ['table', 'phone']) if (!fs.existsSync(path.join(webRoot, d, 'index.html'))) { console.error(`Build first (pnpm build): ${webRoot}/${d} is missing`); process.exit(2); }
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-hub-'));
  const hub = createHub(loadConfig({ argv: ['--web-root', webRoot, '--port', '0', '--udp-port', '0', '--data-dir', data, '--offline', '--host', host], env: {}, hubDir: webRoot }), { log: () => {} });
  const { port, udpPort } = await hub.start();
  return { hub, port, udpPort, base: `http://127.0.0.1:${port}`, stop: async () => { await hub.stop(); fs.rmSync(data, { recursive: true, force: true }); } };
}

/** Collect page errors and console errors. */
export function watchErrors(page: any): string[] {
  const errs: string[] = [];
  page.on('pageerror', (e: Error) => errs.push(e.message));
  page.on('console', (m: any) => { if (m.type() === 'error') errs.push(m.text()); });
  return errs;
}
