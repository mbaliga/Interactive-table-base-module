import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { TuioSender } from '@itable/sim';
import { createHub, type HubHandle } from '../src/server';
import { tmpWebRoot, testConfig } from './helpers';
import type { HubConfig } from '../src/config';

const KEY = 'TEST-KEY-not-a-real-api-key-1234';
let hub: HubHandle | undefined;
afterEach(async () => { await hub?.stop(); hub = undefined; });

async function boot(over: Partial<HubConfig> = {}, fetchImpl?: typeof fetch) {
  const root = tmpWebRoot();
  hub = createHub(testConfig(root, { host: '0.0.0.0', ...over }), { log: () => {}, interfaces: () => [{ address: '192.168.7.7', iface: 'eth0', rank: 99 }], fetchImpl });
  const { port, udpPort } = await hub.start();
  return { base: `http://127.0.0.1:${port}`, port, udpPort, root };
}
const get = (u: string, init?: RequestInit) => fetch(u, { redirect: 'manual', ...init });

describe('hub HTTP', () => {
  it('serves the table, the phone pages, health and config; / redirects to the table', async () => {
    const { base, port } = await boot();
    expect((await get(base + '/')).status).toBe(302);
    expect(await (await get(base + '/table/')).text()).toContain('<title>table</title>');
    expect(await (await get(base + '/phone/?src=table')).text()).toContain('<title>phone</title>');
    expect((await get(base + '/table')).status).toBe(301);
    const h = await (await get(base + '/health')).json() as any; expect(h.ok).toBe(true); expect(h.tuio.udp).toBe('listening');
    const c = await (await get(base + '/api/config')).json() as any;
    expect(c.phoneUrl).toBe(`http://192.168.7.7:${port}/phone/?src=table`); expect(c.phoneUrlSource).toBe('lan'); expect(c.phonesCanReach).toBe(true);
    expect(c.proxies).toEqual({}); expect(c.ui).toEqual({ idleSeconds: 90 }); expect(c.app.id).toBe('test-table');
  });
  it('the QR endpoint returns an svg for the same URL /api/config reports', async () => {
    const { base } = await boot();
    const r = await get(base + '/api/qr.svg'); expect(r.headers.get('content-type')).toBe('image/svg+xml');
    expect((await r.text()).startsWith('<svg')).toBe(true);
  });
  it('the QR endpoint cannot be used to inject markup through its query string', async () => {
    const { base } = await boot();
    const t = await (await get(base + '/api/qr.svg?dark=%22%20onload%3D%22alert(1)&light=%22%3E%3Cscript%3E')).text();
    expect(t).not.toMatch(/onload|<script|alert/);
  });
  it('a loopback-only hub tells the table that phones cannot connect (no QR for an unreachable address)', async () => {
    const { base } = await boot({ host: '127.0.0.1' });
    const c = await (await get(base + '/api/config')).json() as any;
    expect(c.phonesCanReach).toBe(false); expect(c.phoneUrlSource).toBe('localhost');
  });
  it('configured phone URL wins (public hosting)', async () => {
    const { base } = await boot({ phoneUrl: 'https://phone.example.org/app' });
    expect(((await (await get(base + '/api/config')).json()) as any).phoneUrl).toBe('https://phone.example.org/app?src=table');
  });
  it('blocks path traversal and does not leak files outside the web roots', async () => {
    const { base } = await boot();
    for (const p of ['/table/../secret.txt', '/table/%2e%2e/secret.txt', '/table/..%2fsecret.txt', '/phone/%2e%2e%2fsecret.txt', '/table/a%5c..%5c..%5csecret.txt', '/table/%00']) {
      const r = await get(base + p); const t = await r.text();
      expect(t, p).not.toContain('TOP-SECRET'); expect([400, 404], p).toContain(r.status);
    }
    expect((await get(base + '/nope')).status).toBe(404);
  });
  it('only GET/HEAD on static files; security headers present', async () => {
    const { base } = await boot();
    expect((await get(base + '/table/', { method: 'POST' })).status).toBe(405);
    const r = await get(base + '/table/'); expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

const SRC = { base: 'https://upstream.invalid/rest/', auth: {}, allow: [{ pattern: 'items(/[a-z0-9-]{1,40})?', ttlSeconds: 300 }] };

describe('hub data proxy over HTTP', () => {
  it('proxies an allowed endpoint with the key kept server-side; never echoes it', async () => {
    const seen: any[] = [];
    const fetchImpl = (async (u: any, init: any) => { seen.push([String(u), init.headers.Authorization]); return new Response('{"features":[]}', { status: 200 }); }) as any;
    const { base } = await boot({ proxies: { demo: { ...SRC, key: KEY } } }, fetchImpl);
    const r = await get(base + '/proxy/demo/items', { headers: { Authorization: 'client-supplied' } });
    expect(r.status).toBe(200); expect(r.headers.get('x-hub-cache')).toBe('live');
    expect(await r.text()).toBe('{"features":[]}');
    expect(seen[0]).toEqual(['https://upstream.invalid/rest/items', KEY]); // the client's header was ignored
    const cfg = await (await get(base + '/api/config')).json() as any;
    expect(cfg.proxies).toEqual({ demo: { base: '/proxy/demo/', ready: true } });
    const everything = JSON.stringify([...r.headers.entries()]) + JSON.stringify(cfg) + (await (await get(base + '/health')).text());
    expect(everything).not.toContain(KEY);
  });
  it('404 for unknown sources and endpoints, 400 for traversal, 503 with no key, 405 for POST', async () => {
    const fetchImpl = (async () => { throw new Error('must not be called'); }) as any;
    const { base } = await boot({ proxies: { demo: { ...SRC, key: null } } }, fetchImpl);
    expect((await get(base + '/proxy/other/items')).status).toBe(404);
    expect((await get(base + '/proxy/demo/admin')).status).toBe(404);
    expect((await get(base + '/proxy/demo/items/..%2f..%2fadmin')).status).toBe(400);
    const r = await get(base + '/proxy/demo/items'); expect(r.status).toBe(503); expect(((await r.json()) as any).error).toMatch(/no key/);
    expect((await get(base + '/proxy/demo/items', { method: 'POST' })).status).toBe(405);
  });
  it('a public source (no auth) needs no key; offline mode never calls upstream', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response('[1]', { status: 200 }); }) as any;
    const { base } = await boot({ proxies: { open: { base: 'https://open.invalid/', allow: [{ pattern: 'list', ttlSeconds: 60 }], key: null } } }, fetchImpl);
    expect((await get(base + '/proxy/open/list')).status).toBe(200); expect(calls).toBe(1);
    await hub!.stop(); hub = undefined;
    const off = await boot({ offline: true, proxies: { open: { base: 'https://open.invalid/', allow: [{ pattern: 'list', ttlSeconds: 60 }], key: null } } }, fetchImpl);
    expect((await get(off.base + '/proxy/open/list')).status).toBe(503); expect(calls).toBe(1);
  });
});

describe('hub TUIO relay', () => {
  it('UDP from the simulator arrives on ws /tuio; other upgrade paths are refused', async () => {
    const { port, udpPort } = await boot();
    const msgs: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/tuio`); ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    const s = new TuioSender({ port: udpPort, fps: 60 }); s.start(); s.putObject(1, 3, 0.4, 0.4, 1);
    await new Promise((r) => setTimeout(r, 300)); await s.stop(); ws.close();
    expect(msgs.some((m) => m.type === 'event' && m.e.t === 'object:add' && m.e.o.cid === 3)).toBe(true);
    await expect(new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:${port}/other`); w.on('open', () => res('open')); w.on('error', rej); })).rejects.toBeTruthy();
  });
});
