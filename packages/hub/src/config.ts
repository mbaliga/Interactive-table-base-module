import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { compileAllow, PROXY_NAME, type ProxyDef } from './proxy';

/** Identity of the app built on this base (app.json at the repo root, copied into every release). */
export interface AppInfo { id: string; name: string; version: string }

export interface HubConfig {
  host: string;
  port: number;
  app: AppInfo;
  /** Full URL the QR code should open (e.g. the phone pages hosted publicly). Null = this hub's /phone/ page on its LAN address. */
  phoneUrl: string | null;
  /** Force the host name or IP phones should use when phoneUrl is null (e.g. "192.168.1.20" or "table.local"). */
  advertiseHost: string | null;
  udp: { host: string; port: number };
  staleMs: number;
  /** Folder that contains table/ and phone/ (the built apps). */
  webRoot: string;
  /** Writable folder for the proxy cache and logs. */
  dataDir: string;
  /** No upstream calls at all: every proxy serves only what it has cached. */
  offline: boolean;
  /** Upstream data sources reachable at /proxy/<name>/..., with their keys (keys come from env/key files only). */
  proxies: Record<string, ProxyDef & { key: string | null }>;
  /** Optional line shown under the QR code, e.g. "Join the exhibit Wi-Fi first". */
  qrNote: string | null;
  /** Seconds without touch or puck activity before the table starts over and shows the attract screen (0 = never). */
  idleSeconds: number;
  /** Free-form settings passed through to the table and phone pages via /api/config (`ui`). Never put secrets here. */
  ui: Record<string, unknown>;
}

const DEFAULTS = {
  host: '0.0.0.0', port: 8080, phoneUrl: null, advertiseHost: null,
  udp: { host: '0.0.0.0', port: 3333 }, staleMs: 2000, qrNote: null, idleSeconds: 90,
};

type Env = Record<string, string | undefined>;
const truthy = (v: string | undefined) => v !== undefined && /^(1|true|yes|on)$/i.test(v);

/** Find the folder holding table/index.html: next to the hub bundle (release layout) or <repo>/dist (dev). */
export function findWebRoot(hubDir: string, cwd: string, env: Env = process.env): string {
  const cands = [env.HUB_WEB_ROOT, path.resolve(hubDir, '..'), path.resolve(hubDir, '../../dist'), path.resolve(hubDir, '../../../dist'), path.resolve(cwd, 'dist')].filter(Boolean) as string[];
  for (const c of cands) if (fs.existsSync(path.join(c, 'table', 'index.html'))) return c;
  return cands[0] ?? path.resolve(hubDir, '..');
}

/** app.json next to the built apps (release) or at the repo root (dev). Falls back to a neutral identity. */
export function readAppInfo(webRoot: string, hubDir: string, cwd: string): AppInfo {
  for (const f of [path.join(webRoot, 'app.json'), path.resolve(webRoot, '..', 'app.json'), path.resolve(hubDir, '../../app.json'), path.resolve(hubDir, '../../../app.json'), path.join(cwd, 'app.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (typeof j.id === 'string' && typeof j.name === 'string') return { id: j.id, name: j.name, version: String(j.version ?? '0.0.0') };
    } catch { /* next */ }
  }
  return { id: 'interactive-table', name: 'Interactive Table', version: '0.0.0' };
}

/** Environment variable that holds the key for a proxy source: "weather-api" -> HUB_KEY_WEATHER_API. */
export const keyEnvName = (name: string) => 'HUB_KEY_' + name.toUpperCase().replace(/-/g, '_');

export interface LoadOptions { argv?: string[]; env?: Env; hubDir?: string; cwd?: string }

/**
 * Precedence: defaults < config file < environment < command line.
 * Config file: --config <path>, $HUB_CONFIG, or ./hub.config.json / <webRoot>/hub.config.json / <webRoot>/config/hub.config.json if present.
 * Proxy keys come from $HUB_KEY_<NAME> or a key file (<keysDir>/<name>.txt, keysDir = $HUB_KEYS_DIR or <webRoot>/config/keys);
 * they are never read from the JSON config, and a config file that contains one is refused.
 */
export function loadConfig(o: LoadOptions = {}): HubConfig {
  const argv = o.argv ?? process.argv.slice(2), env = o.env ?? process.env, cwd = o.cwd ?? process.cwd();
  const hubDir = o.hubDir ?? cwd;
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const webRoot = path.resolve(flag('web-root') ?? findWebRoot(hubDir, cwd, env));

  const fileCands = [flag('config'), env.HUB_CONFIG, path.join(cwd, 'hub.config.json'), path.join(webRoot, 'hub.config.json'), path.join(webRoot, 'config', 'hub.config.json')].filter(Boolean) as string[];
  const file = fileCands.find((f) => fs.existsSync(f));
  let fromFile: Record<string, any> = {};
  if (file) {
    try { fromFile = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(`Cannot read config ${file}: ${(e as Error).message}`); }
    for (const [n, d] of Object.entries((fromFile.proxies ?? {}) as Record<string, any>))
      if (d && typeof d === 'object' && ('key' in d || 'apiKey' in d || 'token' in d)) throw new Error(`${file}: proxies.${n}: keys must not be stored in the config file; use ${keyEnvName(n)} or config/keys/${n}.txt`);
  }

  const c: HubConfig = {
    host: fromFile.host ?? DEFAULTS.host, port: fromFile.port ?? DEFAULTS.port,
    app: readAppInfo(webRoot, hubDir, cwd),
    phoneUrl: fromFile.phoneUrl ?? DEFAULTS.phoneUrl, advertiseHost: fromFile.advertiseHost ?? DEFAULTS.advertiseHost,
    udp: { ...DEFAULTS.udp, ...fromFile.udp }, staleMs: fromFile.staleMs ?? DEFAULTS.staleMs, qrNote: fromFile.qrNote ?? DEFAULTS.qrNote, idleSeconds: fromFile.idleSeconds ?? DEFAULTS.idleSeconds,
    webRoot, dataDir: path.resolve(fromFile.dataDir ?? path.join(webRoot, 'data')),
    offline: !!fromFile.offline, proxies: {}, ui: { ...(fromFile.ui ?? {}) },
  };
  // environment
  if (env.HUB_HOST) c.host = env.HUB_HOST;
  if (env.HUB_PORT) c.port = Number(env.HUB_PORT);
  if (env.HUB_PHONE_URL) c.phoneUrl = env.HUB_PHONE_URL;
  if (env.HUB_ADVERTISE_HOST) c.advertiseHost = env.HUB_ADVERTISE_HOST;
  if (env.HUB_DATA_DIR) c.dataDir = path.resolve(env.HUB_DATA_DIR);
  if (env.TUIO_UDP_PORT) c.udp.port = Number(env.TUIO_UDP_PORT);
  if (env.HUB_QR_NOTE) c.qrNote = env.HUB_QR_NOTE;
  if (env.HUB_IDLE_SECONDS) c.idleSeconds = Number(env.HUB_IDLE_SECONDS);
  if (truthy(env.HUB_OFFLINE)) c.offline = true;
  // command line
  const n = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  c.host = flag('host') ?? c.host; c.port = n(flag('port')) ?? c.port;
  c.phoneUrl = flag('phone-url') ?? c.phoneUrl; c.advertiseHost = flag('advertise-host') ?? c.advertiseHost;
  c.udp.port = n(flag('udp-port')) ?? c.udp.port; c.dataDir = path.resolve(flag('data-dir') ?? c.dataDir);
  c.idleSeconds = n(flag('idle-seconds')) ?? c.idleSeconds;
  if (argv.includes('--offline')) c.offline = true;

  // proxy sources and their keys
  const keysDir = env.HUB_KEYS_DIR ?? path.join(webRoot, 'config', 'keys');
  for (const [name, def] of Object.entries((fromFile.proxies ?? {}) as Record<string, ProxyDef>)) {
    compileAllow(name, def); // throws with a readable message
    const keyFile = path.join(keysDir, `${name}.txt`);
    const key = env[keyEnvName(name)]?.trim() || (fs.existsSync(keyFile) ? parseKeyFile(fs.readFileSync(keyFile), (m) => console.warn(`[config] ${keyFile}: ${m}`)) : null) || null;
    c.proxies[name] = { ...def, key };
  }

  if (!Number.isFinite(c.idleSeconds) || c.idleSeconds < 0 || (c.idleSeconds > 0 && c.idleSeconds < 10)) throw new Error(`idleSeconds must be 0 (never) or at least 10 (got ${c.idleSeconds})`);
  for (const [k, v] of [['port', c.port], ['udp.port', c.udp.port]] as const)
    if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error(`Invalid ${k}: ${v}`);
  if (c.advertiseHost) c.advertiseHost = (() => { const a = parseAdvertiseHost(c.advertiseHost); return (a.host.includes(':') ? `[${a.host}]` : a.host) + (a.port ? ':' + a.port : ''); })();
  if (c.phoneUrl && !/^https?:\/\//i.test(c.phoneUrl)) throw new Error(`phoneUrl must start with http:// or https:// (got "${c.phoneUrl}")`);
  if (typeof c.ui !== 'object' || Array.isArray(c.ui)) throw new Error('ui must be an object');
  return c;
}

/**
 * Read a key from a text file the way an operator might have written it: UTF-8, or UTF-16 with a BOM (what Windows
 * PowerShell 5.1 produces for `echo KEY > key.txt`), comments (#) and blank lines allowed. Takes the first remaining line.
 * Returns null (and says why, without printing key material) if the file has no usable line.
 */
export function parseKeyFile(buf: Buffer, warn: (m: string) => void = () => {}): string | null {
  let text: string;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  else text = buf.toString('utf8').replace(/^﻿/, '');
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  if (!line) return null;
  if (!/^[\x21-\x7e]{8,400}$/.test(line)) { warn('key file ignored: the first line is not a plain key (printable characters, no spaces, 8-400 long)'); return null; }
  return line;
}

/** "table.local", "192.168.1.20:8080", "http://table.local/", "[fe80::1]:9000" -> host and optional port. */
export function parseAdvertiseHost(v: string): { host: string; port: number | null } {
  let t = v.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  let port: number | null = null;
  const m6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(t);
  if (m6) { t = m6[1]!; port = m6[2] ? Number(m6[2]) : null; }
  else if (net.isIPv6(t)) { /* bare IPv6 literal, no port */ }
  else { const m = /^(.*):(\d+)$/.exec(t); if (m) { t = m[1]!; port = Number(m[2]); } }
  if (!t || /[\s@]/.test(t) || (port !== null && (port < 1 || port > 65535))) throw new Error(`advertiseHost is not a host name or address: "${v}"`);
  return { host: t, port };
}

/** What is safe to print or return from /api/config: never a key, only whether one is configured. */
export function publicSummary(c: HubConfig) {
  return {
    app: c.app, host: c.host, port: c.port, udpPort: c.udp.port, webRoot: c.webRoot, dataDir: c.dataDir, offline: c.offline,
    proxies: Object.fromEntries(Object.entries(c.proxies).map(([n, p]) => [n, { base: p.base, needsKey: !!p.auth, keyConfigured: !!p.key }])),
    phoneUrl: c.phoneUrl, advertiseHost: c.advertiseHost,
  };
}

export { PROXY_NAME };
