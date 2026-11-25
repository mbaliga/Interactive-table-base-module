import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, parseKeyFile, parseAdvertiseHost, publicSummary } from '../src/config';
import { lanCandidates, planPhoneUrl } from '../src/net';
import { tmpWebRoot } from './helpers';

const mk = (addr: string, family = 'IPv4', internal = false) => ({ address: addr, family, internal, netmask: '255.255.255.0', mac: '', cidr: null }) as any;

describe('loadConfig', () => {
  it('defaults, then file, then env, then flags', () => {
    const root = tmpWebRoot();
    fs.writeFileSync(path.join(root, 'hub.config.json'), JSON.stringify({ port: 9000, advertiseHost: 'from-file', qrNote: 'Join the Wi-Fi' }));
    const base = { hubDir: root, cwd: root, argv: ['--web-root', root] };
    expect(loadConfig({ ...base, env: {} }).port).toBe(9000);
    expect(loadConfig({ ...base, env: { HUB_PORT: '9100' } }).port).toBe(9100);
    expect(loadConfig({ ...base, env: { HUB_PORT: '9100' }, argv: [...base.argv, '--port', '9200'] }).port).toBe(9200);
    const c = loadConfig({ ...base, env: {} });
    expect(c.advertiseHost).toBe('from-file'); expect(c.qrNote).toBe('Join the Wi-Fi'); expect(c.udp.port).toBe(3333);
  });
  it('reads proxy keys from the environment or config/keys/<name>.txt, never from the JSON config', () => {
    const root = tmpWebRoot();
    const base = { hubDir: root, cwd: root, argv: ['--web-root', root] };
    const proxies = { 'weather-api': { base: 'https://api.example.org/', auth: {}, allow: [{ pattern: 'now', ttlSeconds: 60 }] } };
    fs.writeFileSync(path.join(root, 'hub.config.json'), JSON.stringify({ proxies }));
    expect(loadConfig({ ...base, env: {} }).proxies['weather-api']!.key).toBeNull();
    expect(loadConfig({ ...base, env: { HUB_KEY_WEATHER_API: ' abc12345 ' } }).proxies['weather-api']!.key).toBe('abc12345');
    fs.mkdirSync(path.join(root, 'config', 'keys'), { recursive: true }); fs.writeFileSync(path.join(root, 'config', 'keys', 'weather-api.txt'), 'filekey-0123456789\r\n');
    expect(loadConfig({ ...base, env: {} }).proxies['weather-api']!.key).toBe('filekey-0123456789');
    expect(loadConfig({ ...base, env: { HUB_KEY_WEATHER_API: 'envkey-0123456789' } }).proxies['weather-api']!.key).toBe('envkey-0123456789');
    expect(JSON.stringify(publicSummary(loadConfig({ ...base, env: {} })))).not.toContain('filekey');
    fs.writeFileSync(path.join(root, 'hub.config.json'), JSON.stringify({ proxies: { x: { ...proxies['weather-api'], key: 'oops' } } }));
    expect(() => loadConfig({ ...base, env: {} })).toThrow(/must not be stored/);
  });
  it('refuses broken proxy definitions with a readable message', () => {
    const root = tmpWebRoot(); const base = { hubDir: root, cwd: root, argv: ['--web-root', root], env: {} };
    for (const [bad, msg] of [[{ Bad_Name: { base: 'https://x/', allow: [{ pattern: 'a', ttlSeconds: 1 }] } }, /valid source name/], [{ a: { base: 'ftp://x/', allow: [{ pattern: 'a', ttlSeconds: 1 }] } }, /base/], [{ a: { base: 'https://x/', allow: [] } }, /allow/], [{ a: { base: 'https://x/', allow: [{ pattern: '(', ttlSeconds: 1 }] } }, /pattern/]] as const) {
      fs.writeFileSync(path.join(root, 'hub.config.json'), JSON.stringify({ proxies: bad }));
      expect(() => loadConfig(base)).toThrow(msg);
    }
  });
  it('reads the app identity from app.json, with a neutral fallback', () => {
    const root = tmpWebRoot(); const base = { hubDir: root, cwd: root, argv: ['--web-root', root], env: {} };
    expect(loadConfig(base).app.id).toBe('interactive-table');
    fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ id: 'forts-table', name: 'Forts Table', version: '1.2.3' }));
    expect(loadConfig(base).app).toEqual({ id: 'forts-table', name: 'Forts Table', version: '1.2.3' });
  });
  it('passes ui settings through, and offline can be set from file, env or flag', () => {
    const root = tmpWebRoot(); const base = { hubDir: root, cwd: root, argv: ['--web-root', root], env: {} };
    expect(loadConfig(base).offline).toBe(false);
    expect(loadConfig({ ...base, env: { HUB_OFFLINE: '1' } }).offline).toBe(true);
    expect(loadConfig({ ...base, argv: [...base.argv, '--offline'] }).offline).toBe(true);
    fs.writeFileSync(path.join(root, 'hub.config.json'), JSON.stringify({ offline: true, ui: { theme: 'dark' } }));
    expect(loadConfig(base)).toMatchObject({ offline: true, ui: { theme: 'dark' } });
  });
  it('validates ports and the phone URL', () => {
    const root = tmpWebRoot(); const base = { hubDir: root, cwd: root, argv: ['--web-root', root], env: {} };
    expect(() => loadConfig({ ...base, argv: [...base.argv, '--port', '99999'] })).toThrow(/Invalid port/);
    expect(() => loadConfig({ ...base, env: { HUB_PHONE_URL: 'ftp://x' } })).toThrow(/phoneUrl/);
  });
  it('finds the web root next to the bundle or in <repo>/dist', () => {
    const root = tmpWebRoot();
    const hubDir = path.join(root, 'hub'); fs.mkdirSync(hubDir);
    expect(loadConfig({ hubDir, cwd: os.tmpdir(), argv: [], env: {} }).webRoot).toBe(root);
  });
});

describe('idleSeconds', () => {
  const root = tmpWebRoot(); const base = { hubDir: root, cwd: root, argv: ['--web-root', root] };
  it('defaults to 90, can be set by env or flag, 0 means never, and silly values are refused', () => {
    expect(loadConfig({ ...base, env: {} }).idleSeconds).toBe(90);
    expect(loadConfig({ ...base, env: { HUB_IDLE_SECONDS: '120' } }).idleSeconds).toBe(120);
    expect(loadConfig({ ...base, env: {}, argv: [...base.argv, '--idle-seconds', '0'] }).idleSeconds).toBe(0);
    for (const bad of ['5', '-1', 'abc']) expect(() => loadConfig({ ...base, env: { HUB_IDLE_SECONDS: bad } }), bad).toThrow(/idleSeconds/);
  });
});

describe('lanCandidates / planPhoneUrl', () => {
  it('Linux layout: prefers a physical LAN address over docker bridges and loopback', () => {
    const c = lanCandidates({ lo: [mk('127.0.0.1', 'IPv4', true)], docker0: [mk('172.17.0.1')], 'br-1a2b': [mk('172.18.0.1')], eth0: [mk('192.168.1.20')] } as any);
    expect(c[0]!.address).toBe('192.168.1.20');
    expect(c.map((x) => x.address)).not.toContain('127.0.0.1');
  });
  it('Windows layout: Wi-Fi/Ethernet beat vEthernet (WSL/Hyper-V), VirtualBox and APIPA addresses', () => {
    const c = lanCandidates({
      'vEthernet (WSL)': [mk('172.28.208.1')], 'VirtualBox Host-Only Network': [mk('192.168.56.1')], 'Wi-Fi': [mk('10.0.4.55')],
      Ethernet: [mk('169.254.10.2')], 'Loopback Pseudo-Interface 1': [mk('127.0.0.1', 'IPv4', true)],
    } as any);
    expect(c[0]).toMatchObject({ address: '10.0.4.55', iface: 'Wi-Fi' });
    expect(c.map((x) => x.address)).not.toContain('169.254.10.2');
  });
  it('ignores IPv6 and numeric family 4 is accepted (older Node)', () => {
    const c = lanCandidates({ en0: [mk('fe80::1', 'IPv6'), { ...mk('192.168.0.9'), family: 4 }] } as any);
    expect(c.map((x) => x.address)).toEqual(['192.168.0.9']);
  });
  it('plans the URL: configured > advertiseHost > LAN > localhost', () => {
    const candidates = lanCandidates({ eth0: [mk('192.168.1.20')] } as any);
    expect(planPhoneUrl({ phoneUrl: 'https://phone.example.org/app', advertiseHost: 'x', port: 8080, candidates })).toMatchObject({ phoneUrl: 'https://phone.example.org/app?src=table', source: 'configured' });
    expect(planPhoneUrl({ phoneUrl: 'https://phone.example.org/', advertiseHost: null, port: 8080, candidates }).phoneUrl).toBe('https://phone.example.org/?src=table');
    expect(planPhoneUrl({ phoneUrl: null, advertiseHost: 'table.local', port: 8080, candidates })).toMatchObject({ phoneUrl: 'http://table.local:8080/phone/?src=table', source: 'advertiseHost' });
    expect(planPhoneUrl({ phoneUrl: null, advertiseHost: null, port: 8080, candidates })).toMatchObject({ phoneUrl: 'http://192.168.1.20:8080/phone/?src=table', source: 'lan' });
    expect(planPhoneUrl({ phoneUrl: null, advertiseHost: null, port: 80, candidates })).toMatchObject({ phoneUrl: 'http://192.168.1.20/phone/?src=table' });
    expect(planPhoneUrl({ phoneUrl: null, advertiseHost: null, port: 8080, candidates: [] })).toMatchObject({ source: 'localhost' });
  });
});

describe('parseKeyFile', () => {
  const K = 'ZZ-test-key-0123456789-qrstuvwxyz';
  it('reads a plain key with any line ending, a UTF-8 BOM, comments and blank lines', () => {
    for (const t of [K, K + '\n', K + '\r\n', '\uFEFF' + K, `# my key\n\n${K}\n`, `  ${K}  `]) expect(parseKeyFile(Buffer.from(t, 'utf8'))).toBe(K);
  });
  it('reads UTF-16 LE/BE with a BOM (what PowerShell 5.1 `echo KEY > key.txt` writes)', () => {
    expect(parseKeyFile(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(K + '\r\n', 'utf16le')]))).toBe(K);
    expect(parseKeyFile(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(K + '\n', 'utf16le').swap16()]))).toBe(K);
  });
  it('an unedited key.txt.example (comments only) means no key; junk is refused with a warning that holds no key material', () => {
    expect(parseKeyFile(Buffer.from('# a\n# b\n'))).toBeNull(); expect(parseKeyFile(Buffer.from(''))).toBeNull();
    const w: string[] = [];
    expect(parseKeyFile(Buffer.from('this whole line is a sentence'), (m) => w.push(m))).toBeNull();
    expect(parseKeyFile(Buffer.from('\u0000\u0001binary'), (m) => w.push(m))).toBeNull();
    expect(w.length).toBe(2); expect(w.join()).not.toContain('sentence');
  });
});

describe('advertiseHost', () => {
  it('accepts host, host:port, scheme and path, and IPv6 forms', () => {
    expect(parseAdvertiseHost('table.local')).toEqual({ host: 'table.local', port: null });
    expect(parseAdvertiseHost('192.168.1.20:8080')).toEqual({ host: '192.168.1.20', port: 8080 });
    expect(parseAdvertiseHost('http://table.local/')).toEqual({ host: 'table.local', port: null });
    expect(parseAdvertiseHost('https://t.example:8443/phone')).toEqual({ host: 't.example', port: 8443 });
    expect(parseAdvertiseHost('[fe80::1]:9000')).toEqual({ host: 'fe80::1', port: 9000 });
    expect(parseAdvertiseHost('fe80::1')).toEqual({ host: 'fe80::1', port: null });
  });
  it('rejects nonsense', () => { for (const bad of ['', 'a b', 'user@host', 'host:99999', 'host:0']) expect(() => parseAdvertiseHost(bad), bad).toThrow(/advertiseHost/); });
  it('loadConfig normalises it, and the QR URL is well-formed', () => {
    const root = tmpWebRoot(); const base = { hubDir: root, cwd: root, argv: ['--web-root', root], env: {} };
    const c = loadConfig({ ...base, env: { HUB_ADVERTISE_HOST: 'http://192.168.1.20:8080/' } });
    expect(c.advertiseHost).toBe('192.168.1.20:8080');
    const cands = lanCandidates({ eth0: [mk('10.0.0.5')] } as any);
    expect(planPhoneUrl({ phoneUrl: null, advertiseHost: c.advertiseHost, port: 9999, candidates: cands }).phoneUrl).toBe('http://192.168.1.20:8080/phone/?src=table');
    expect(planPhoneUrl({ phoneUrl: null, advertiseHost: 'fe80::1', port: 8080, candidates: cands }).phoneUrl).toBe('http://[fe80::1]:8080/phone/?src=table');
  });
});

describe('QR honesty when the bind address hides the hub from phones', () => {
  const candidates = lanCandidates({ eth0: [mk('192.168.1.20')], wlan0: [mk('10.0.0.5')] } as any);
  it('bound to loopback: no LAN address is advertised and phones are reported unable to connect', () => {
    for (const bindHost of ['127.0.0.1', 'localhost', '::1']) expect(planPhoneUrl({ phoneUrl: null, advertiseHost: null, port: 8080, candidates, bindHost })).toMatchObject({ source: 'localhost', phonesCanReach: false });
    expect(planPhoneUrl({ phoneUrl: null, advertiseHost: 'table.local', port: 8080, candidates, bindHost: '127.0.0.1' }).phonesCanReach).toBe(false);
  });
  it('bound to one address: only that address is offered', () => {
    const p = planPhoneUrl({ phoneUrl: null, advertiseHost: null, port: 8080, candidates, bindHost: '10.0.0.5' });
    expect(p.phoneUrl).toBe('http://10.0.0.5:8080/phone/?src=table'); expect(p.candidates).toEqual(['http://10.0.0.5:8080/phone/?src=table']); expect(p.phonesCanReach).toBe(true);
  });
  it('a configured public phone URL still works with a loopback-only hub', () => {
    expect(planPhoneUrl({ phoneUrl: 'https://phone.example.org/', advertiseHost: null, port: 8080, candidates, bindHost: '127.0.0.1' })).toMatchObject({ source: 'configured', phonesCanReach: true });
  });
  it('wildcard bind (the default) behaves as before', () => {
    for (const bindHost of ['0.0.0.0', '::']) expect(planPhoneUrl({ phoneUrl: null, advertiseHost: null, port: 8080, candidates, bindHost })).toMatchObject({ source: 'lan', phonesCanReach: true });
  });
});
