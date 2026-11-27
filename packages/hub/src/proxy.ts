import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * One upstream data source the pages may reach through the hub, e.g. a weather or museum-collection API.
 * Configured in hub.config.json under `proxies.<name>`; the API key is NEVER in that file (see `loadProxyKey`).
 */
export interface ProxyDef {
  /** Upstream base URL, e.g. "https://api.example.org/v1/". */
  base: string;
  /**
   * The only endpoints the pages may ask for. Each `pattern` is a regular expression tested against the WHOLE endpoint
   * (the path below /proxy/<name>/, plus "?query" when the request has one). Anything else is refused: this is not an open proxy.
   */
  allow: Array<{ pattern: string; ttlSeconds: number }>;
  /**
   * Set this when the source needs a key: how the key is sent upstream. `{}` = header "Authorization" with no prefix;
   * `{ header: "X-Api-Key" }`, `{ prefix: "Bearer " }`, or `{ query: "api_key" }` for APIs that want it in the URL.
   * Without `auth` the source is treated as a public API and called without a key.
   */
  auth?: { header?: string; prefix?: string; query?: string };
  /** Extra fixed request headers (no secrets here: this file is not secret). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** How long a cached copy may still be served when the upstream is unreachable (default 14 days). */
  maxStaleSeconds?: number;
  /** Refuse anything that is not JSON (default true), so a captive-portal HTML page never becomes the "last good" copy. */
  jsonOnly?: boolean;
}

export interface ProxyOptions extends ProxyDef {
  name: string;
  key: string | null;
  offline: boolean;
  cacheDir: string;
  log?: (m: string) => void;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type ProxyResult = { body: string; type: string; how: 'fresh' | 'live' | 'stale'; at: number };

const MAX_BODY = 8 * 1024 * 1024;
const MAX_UPSTREAM = 4;          // concurrent upstream calls per source: a burst of visitors cannot hammer the API or its quota
const FAIL_BACKOFF_MS = 60_000;  // after a failure, serve what we have instead of retrying on every request
export const PROXY_NAME = /^[a-z][a-z0-9-]{0,31}$/;

interface Entry { at: number; status: number; type: string; body: string }

/** Compile and sanity-check a source definition (throws with a readable message). */
export function compileAllow(name: string, def: ProxyDef): Array<{ re: RegExp; ttlMs: number }> {
  if (!PROXY_NAME.test(name)) throw new Error(`proxies: "${name}" is not a valid source name (lowercase letters, digits, dashes)`);
  if (!/^https?:\/\//i.test(def.base ?? '')) throw new Error(`proxies.${name}.base must start with http:// or https://`);
  if (!Array.isArray(def.allow) || def.allow.length === 0) throw new Error(`proxies.${name}.allow must list at least one endpoint pattern`);
  return def.allow.map((a, i) => {
    let re: RegExp;
    try { re = new RegExp(`^(?:${a.pattern})$`); } catch (e) { throw new Error(`proxies.${name}.allow[${i}].pattern: ${(e as Error).message}`); }
    if (!(a.ttlSeconds >= 0)) throw new Error(`proxies.${name}.allow[${i}].ttlSeconds must be a number >= 0`);
    return { re, ttlMs: a.ttlSeconds * 1000 };
  });
}

/**
 * Server-side access to one upstream API. Browsers call /proxy/<name>/<endpoint> on the hub; the hub adds the key, caches every
 * good response to disk, and serves the last good copy when the upstream is unreachable. The key never leaves this process.
 */
export class DataProxy {
  private allow: Array<{ re: RegExp; ttlMs: number }>;
  private mem = new Map<string, Entry>();
  private failedAt = new Map<string, number>();
  private active = 0;
  private waiters: Array<() => void> = [];
  private inflight = new Map<string, Promise<ProxyResult | null>>();
  private now: () => number;
  private dir: string;
  constructor(private o: ProxyOptions) {
    this.allow = compileAllow(o.name, o);
    this.now = o.now ?? Date.now;
    this.dir = path.join(o.cacheDir, o.name);
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* reported on first write */ }
  }

  rule(ep: string) { return this.allow.find((a) => a.re.test(ep)); }
  status() { return { configured: !!this.o.key, offline: this.o.offline, cached: this.mem.size }; }

  private file(ep: string) { return path.join(this.dir, crypto.createHash('sha1').update(ep).digest('hex') + '.json'); }
  private async readDisk(ep: string): Promise<Entry | null> {
    try { const e = JSON.parse(await fsp.readFile(this.file(ep), 'utf8')) as Entry; return typeof e.at === 'number' && typeof e.body === 'string' ? { ...e, type: e.type ?? 'application/json' } : null; } catch { return null; }
  }
  private async writeDisk(ep: string, e: Entry) {
    const f = this.file(ep), tmp = f + '.' + process.pid + '.tmp';
    try { await fsp.writeFile(tmp, JSON.stringify(e)); await fsp.rename(tmp, f); }
    catch (err) { try { await fsp.writeFile(f, JSON.stringify(e)); } catch { this.o.log?.(`proxy ${this.o.name}: cache write failed: ${(err as Error).message}`); } try { await fsp.unlink(tmp); } catch { /* none */ } }
  }

  private async slot(): Promise<() => void> {
    if (this.active >= MAX_UPSTREAM) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    return () => { this.active--; this.waiters.shift()?.(); };
  }

  /** Upstream URL for an endpoint: path segments encoded one by one, the query re-serialised. Exported for tests. */
  upstreamUrl(ep: string): string {
    const [p, q] = ep.split(/\?(.*)/s, 2) as [string, string | undefined];
    const u = new URL(this.o.base.replace(/\/?$/, '/') + p.split('/').map(encodeURIComponent).join('/'));
    if (q) for (const [k, v] of new URLSearchParams(q)) u.searchParams.append(k, v);
    if (this.o.key && this.o.auth?.query) u.searchParams.set(this.o.auth.query, this.o.key);
    return u.toString();
  }

  private async upstream(ep: string): Promise<Entry | null> {
    if (this.o.offline || (this.o.auth && !this.o.key)) return null; // a source that needs a key is not called without one
    const failed = this.failedAt.get(ep);
    if (failed !== undefined && this.now() - failed < FAIL_BACKOFF_MS) return null;
    const release = await this.slot();
    try { return await this.fetchUpstream(ep); } finally { release(); }
  }

  private async fetchUpstream(ep: string): Promise<Entry | null> {
    const f = this.o.fetchImpl ?? fetch;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.o.timeoutMs ?? 8000);
    const headers: Record<string, string> = { Accept: 'application/json', ...this.o.headers };
    if (this.o.key && !this.o.auth?.query) headers[this.o.auth?.header ?? 'Authorization'] = (this.o.auth?.prefix ?? '') + this.o.key;
    const scrub = (s: string) => (this.o.key ? s.split(this.o.key).join('***') : s);
    try {
      const r = await f(this.upstreamUrl(ep), { headers, signal: ac.signal, redirect: 'error' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const body = await r.text();
      if (body.length > MAX_BODY) throw new Error('response too large');
      const type = (r.headers.get('content-type') ?? 'application/json').split(';')[0]!.trim();
      if (this.o.jsonOnly !== false) JSON.parse(body);
      this.failedAt.delete(ep);
      return { at: this.now(), status: 200, type: this.o.jsonOnly !== false ? 'application/json' : type, body };
    } catch (e) {
      this.failedAt.set(ep, this.now());
      this.o.log?.(`proxy ${this.o.name} ${scrub(ep)}: ${(e as Error).name === 'AbortError' ? 'timeout' : scrub((e as Error).message)}`);
      return null;
    } finally { clearTimeout(t); }
  }

  /** The body and how it was obtained, or null if nothing is available. Concurrent calls for one endpoint share one lookup. */
  get(ep: string): Promise<ProxyResult | null> {
    if (!this.rule(ep)) return Promise.resolve(null);
    let p = this.inflight.get(ep);
    if (!p) { p = this.lookup(ep).finally(() => this.inflight.delete(ep)); this.inflight.set(ep, p); }
    return p;
  }

  private async lookup(ep: string): Promise<ProxyResult | null> {
    const rule = this.rule(ep)!;
    const e = this.mem.get(ep) ?? await this.readDisk(ep);
    if (e) this.mem.set(ep, e);
    if (e && this.now() - e.at < rule.ttlMs) return { body: e.body, type: e.type, how: 'fresh', at: e.at };
    const fresh = await this.upstream(ep);
    if (fresh) { this.mem.set(ep, fresh); await this.writeDisk(ep, fresh); return { body: fresh.body, type: fresh.type, how: 'live', at: fresh.at }; }
    if (e && this.now() - e.at < (this.o.maxStaleSeconds ?? 14 * 86400) * 1000) return { body: e.body, type: e.type, how: 'stale', at: e.at };
    return null;
  }

  /** HTTP handler for GET /proxy/<name>/<endpoint>[?query]. `rest` is the raw path below /proxy/<name>/. */
  async handle(req: IncomingMessage, res: ServerResponse, rest: string, search: string): Promise<void> {
    const send = (code: number, obj: unknown, extra: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' }, { allow: 'GET' });
    let ep: string;
    try { ep = decodeURIComponent(rest); } catch { return send(400, { error: 'bad path' }); }
    if (ep.includes('\0') || ep.split('/').some((s) => s === '..' || s === '.')) return send(400, { error: 'bad path' });
    if (search.length > 1) ep += search;
    if (!this.rule(ep)) return send(404, { error: 'unknown endpoint' });
    const r = await this.get(ep);
    if (!r) return send(503, { error: this.o.offline ? 'hub is offline' : this.o.auth && !this.o.key ? `no key configured on the hub for "${this.o.name}"` : 'upstream unreachable and nothing cached' });
    res.writeHead(200, { 'content-type': r.type + '; charset=utf-8', 'cache-control': 'no-store', 'x-hub-cache': r.how, 'x-hub-data-at': new Date(r.at).toISOString() });
    res.end(r.body);
  }
}
