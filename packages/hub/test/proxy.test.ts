import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataProxy, compileAllow, type ProxyOptions } from '../src/proxy';

const KEY = 'TEST-KEY-not-a-real-api-key-1234';
const ALLOW = [
  { pattern: 'items', ttlSeconds: 6 * 3600 },
  { pattern: 'now', ttlSeconds: 5 * 60 },
  { pattern: 'item/[A-Za-z0-9_-]{1,40}', ttlSeconds: 1800 },
  { pattern: 'search\\?q=[a-z ]{1,20}', ttlSeconds: 60 },
];
const mkProxy = (over: Partial<ProxyOptions> = {}) => {
  const logs: string[] = []; let t = 1_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-'));
  const fetchImpl = vi.fn(async (_u?: any, _i?: any) => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
  const proxy = new DataProxy({ name: 'demo', base: 'https://upstream.invalid/rest/', auth: {}, allow: ALLOW, key: KEY, offline: false, timeoutMs: 500, cacheDir: dir, log: (m) => logs.push(m), fetchImpl: fetchImpl as any, now: () => t, ...over });
  return { proxy, logs, fetchImpl, dir, advance: (ms: number) => (t += ms) };
};

describe('allowlist', () => {
  it('matches whole endpoints only', () => {
    const { proxy } = mkProxy();
    for (const ok of ['items', 'now', 'item/abc-1', 'search?q=red fort']) expect(proxy.rule(ok), ok).toBeTruthy();
    for (const bad of ['', 'admin', '../items', 'items/../x', 'items?x=1', 'items/', 'item/', 'item/a/b', 'item/a.b', 'item/' + 'a'.repeat(41), 'http://evil/', 'ITEMS', 'xitems', 'itemsx', 'search?q=1']) expect(proxy.rule(bad), bad).toBeFalsy();
  });
  it('compileAllow rejects bad names, bases and patterns', () => {
    expect(() => compileAllow('Bad', { base: 'https://x/', allow: ALLOW })).toThrow(/name/);
    expect(() => compileAllow('ok', { base: 'file:///etc', allow: ALLOW })).toThrow(/base/);
    expect(() => compileAllow('ok', { base: 'https://x/', allow: [{ pattern: '[', ttlSeconds: 1 }] })).toThrow(/pattern/);
  });
});

describe('DataProxy', () => {
  it('sends the key upstream (header only), caches, and serves fresh copies without refetching', async () => {
    const { proxy, fetchImpl } = mkProxy();
    const a = await proxy.get('items'); expect(a?.how).toBe('live');
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe('https://upstream.invalid/rest/items'); expect(init.headers.Authorization).toBe(KEY); expect(String(url)).not.toContain(KEY);
    const b = await proxy.get('items'); expect(b?.how).toBe('fresh'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('supports a custom header with a prefix, or a query parameter', async () => {
    const h = mkProxy({ auth: { header: 'X-Api-Key', prefix: 'Bearer ' } }); await h.proxy.get('items');
    expect((h.fetchImpl.mock.calls[0] as any)[1].headers['X-Api-Key']).toBe('Bearer ' + KEY);
    const q = mkProxy({ auth: { query: 'api_key' } }); await q.proxy.get('search?q=red fort');
    const u = new URL((q.fetchImpl.mock.calls[0] as any)[0]);
    expect(u.pathname).toBe('/rest/search'); expect(u.searchParams.get('q')).toBe('red fort'); expect(u.searchParams.get('api_key')).toBe(KEY);
    expect((q.fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined();
  });
  it('coalesces concurrent requests into one upstream call', async () => {
    const { proxy, fetchImpl } = mkProxy();
    await Promise.all([proxy.get('now'), proxy.get('now'), proxy.get('now')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('serves the last good copy when upstream fails after the TTL, and survives a restart via the disk cache', async () => {
    const { proxy, fetchImpl, advance, dir } = mkProxy();
    await proxy.get('now'); await new Promise((r) => setTimeout(r, 30)); // let the disk write land
    advance(6 * 60e3); fetchImpl.mockImplementation(async () => { throw new Error('network down'); });
    expect((await proxy.get('now'))?.how).toBe('stale');
    const p2 = new DataProxy({ name: 'demo', base: 'https://x/', allow: ALLOW, key: KEY, offline: true, timeoutMs: 1, cacheDir: dir, now: () => 1_000_000 + 6 * 60e3 });
    expect((await p2.get('now'))?.how).toBe('stale'); // restart without network: cached data still shown
  });
  it('rejects non-JSON upstream bodies (captive portal HTML) and keeps the previous good copy', async () => {
    const { proxy, fetchImpl, advance } = mkProxy();
    await proxy.get('items'); advance(7 * 3600e3);
    fetchImpl.mockImplementation(async () => new Response('<html>please log in</html>', { status: 200 }));
    const r = await proxy.get('items'); expect(r?.how).toBe('stale'); expect(r?.body).toBe('{"ok":1}');
  });
  it('treats HTTP errors as failures', async () => {
    const { proxy, fetchImpl } = mkProxy(); fetchImpl.mockImplementation(async () => new Response('no', { status: 401 }));
    expect(await proxy.get('items')).toBeNull();
  });
  it('offline mode, and a keyed source without its key, never call upstream', async () => {
    for (const over of [{ offline: true }, { key: null }]) { const { proxy, fetchImpl } = mkProxy(over); expect(await proxy.get('items')).toBeNull(); expect(fetchImpl).not.toHaveBeenCalled(); }
  });
  it('a public source (no auth) is called without a key', async () => {
    const { proxy, fetchImpl } = mkProxy({ auth: undefined, key: null });
    expect((await proxy.get('items'))?.how).toBe('live'); expect((fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined();
  });
  it('never writes the key to logs, even when the upstream error message contains it', async () => {
    const { proxy, fetchImpl, logs } = mkProxy(); fetchImpl.mockImplementation(async () => { throw new Error(`bad header Authorization: ${KEY}`); });
    await proxy.get('items');
    expect(logs.join('\n')).not.toContain(KEY); expect(logs.join('\n')).toContain('***');
  });
  it('does not follow redirects (a redirect to another host would leak the key)', async () => {
    const { proxy, fetchImpl } = mkProxy(); await proxy.get('items');
    expect((fetchImpl.mock.calls[0] as any)[1].redirect).toBe('error');
  });
  it('limits concurrent upstream calls', async () => {
    const { proxy, fetchImpl } = mkProxy(); let live = 0, peak = 0;
    fetchImpl.mockImplementation(async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 20)); live--; return new Response('{"a":1}', { status: 200 }); });
    await Promise.all(['items', 'now', 'item/a', 'item/b', 'item/c', 'item/d', 'item/e', 'item/f'].map((e) => proxy.get(e)));
    expect(peak).toBeLessThanOrEqual(4); expect(fetchImpl).toHaveBeenCalledTimes(8);
  });
  it('after an upstream failure it backs off instead of retrying on every request', async () => {
    const { proxy, fetchImpl, advance } = mkProxy(); fetchImpl.mockImplementation(async () => { throw new Error('down'); });
    for (let i = 0; i < 10; i++) await proxy.get('items');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(61_000); await proxy.get('items'); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('refuses endpoints outside the allowlist without any upstream call', async () => {
    const { proxy, fetchImpl } = mkProxy(); expect(await proxy.get('admin')).toBeNull(); expect(fetchImpl).not.toHaveBeenCalled();
  });
});
