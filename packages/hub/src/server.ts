import http from 'node:http';
import path from 'node:path';
import { TuioRelay } from '@itable/bridge';
import { loadConfig, publicSummary, type HubConfig } from './config';
import { lanCandidates, planPhoneUrl, type Candidate } from './net';
import { DataProxy } from './proxy';
import { qrSvg } from './qr';
import { serveStatic } from './static';

export const HUB_VERSION = '0.1.0';

export interface HubHandle {
  config: HubConfig;
  /** Resolves with the bound ports once listening. */
  start(): Promise<{ port: number; udpPort: number }>;
  stop(): Promise<void>;
  /** What /api/config reports (also used by tests). */
  info(): ReturnType<typeof buildInfo>;
}

function buildInfo(c: HubConfig, port: number, candidates: Candidate[]) {
  const plan = planPhoneUrl({ phoneUrl: c.phoneUrl, advertiseHost: c.advertiseHost, port, candidates, bindHost: c.host });
  return {
    version: HUB_VERSION, app: c.app,
    phoneUrl: plan.phoneUrl, phoneUrlSource: plan.source, phonesCanReach: plan.phonesCanReach, alternatives: plan.candidates,
    qrNote: c.qrNote, ui: { ...c.ui, idleSeconds: c.idleSeconds }, tuio: { path: '/tuio' },
    proxies: Object.fromEntries(Object.entries(c.proxies).map(([n, p]) => [n, { base: `/proxy/${n}/`, ready: !c.offline && (!p.auth || !!p.key) }])),
    offline: c.offline,
  };
}

const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

/**
 * The hub: one Node process per table. Serves the table app (/table/) and the phone pages (/phone/), the QR code that points
 * phones at them, allow-listed data proxies (/proxy/<name>/...), and relays TUIO from UDP to the table over WebSocket (/tuio).
 */
export function createHub(cfg: HubConfig, deps: { log?: (m: string) => void; interfaces?: () => Candidate[]; fetchImpl?: typeof fetch } = {}): HubHandle {
  const log = deps.log ?? ((m) => console.log(new Date().toISOString(), m));
  const relay = new TuioRelay({ udpHost: cfg.udp.host, udpPort: cfg.udp.port, staleMs: cfg.staleMs, rateLogMs: 0, log });
  const proxies = new Map(Object.entries(cfg.proxies).map(([name, def]) => [name, new DataProxy({ ...def, name, offline: cfg.offline, cacheDir: path.join(cfg.dataDir, 'cache'), log, fetchImpl: deps.fetchImpl })]));
  const started = Date.now();
  let boundPort = cfg.port;
  const cands = () => (deps.interfaces ?? lanCandidates)();
  const info = () => buildInfo(cfg, boundPort, cands());
  const tableRoot = path.join(cfg.webRoot, 'table'), phoneRoot = path.join(cfg.webRoot, 'phone');
  const json = (res: http.ServerResponse, code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
    const url = new URL(req.url ?? '/', 'http://hub');
    const p = url.pathname;
    try {
      if (p === '/health') return json(res, 200, { ok: true, app: cfg.app, version: HUB_VERSION, uptimeS: Math.round((Date.now() - started) / 1000), tuio: relay.stats(), proxies: Object.fromEntries([...proxies].map(([n, x]) => [n, x.status()])) });
      if (p === '/api/config') return json(res, 200, info());
      if (p === '/api/qr.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
        return void res.end(qrSvg(info().phoneUrl, { dark: url.searchParams.get('dark') ?? '#000000', light: url.searchParams.get('light') ?? '#ffffff', margin: 2 }));
      }
      const m = /^\/proxy\/([^/]+)\/(.*)$/s.exec(p);
      if (m) {
        const px = proxies.get(m[1]!);
        if (!px) return json(res, 404, { error: 'unknown data source' });
        return void await px.handle(req, res, m[2]!, url.search);
      }
      if (p === '/' || p === '/index.html') { res.writeHead(302, { location: '/table/' }); return void res.end(); }
      if (serveStatic(tableRoot, '/table/', req, res, p)) return;
      if (serveStatic(phoneRoot, '/phone/', req, res, p)) return;
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
    } catch (e) {
      log(`request error ${req.method} ${p}: ${(e as Error).message}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Server error');
    }
  });
  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] === '/tuio') relay.handleUpgrade(req, socket, head);
    else socket.destroy();
  });

  return {
    config: cfg, info,
    async start() {
      const udpPort = await relay.start();
      const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(cfg.port, cfg.host, () => resolve((server.address() as { port: number }).port));
      });
      boundPort = port;
      return { port, udpPort };
    },
    async stop() {
      await relay.stop();
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export { loadConfig, publicSummary };
